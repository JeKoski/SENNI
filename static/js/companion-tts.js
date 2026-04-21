// companion-tts.js — Companion settings: Voice (TTS) tab
// Loaded after companion.js and tts.js.
//
// Exports used by companion.js:
//   cpTtsInit()              — called when TTS tab is opened
//   cpTtsReset()             — called on companion window close (allows fresh init)
//   _cpGetTtsPayload()       — called by cpSave() to include TTS in save body
//
// cpTtsPopulate() is called eagerly from cpPopulate() on every window open so
// that _cpTtsSlots is always populated before cpSave() runs, even if the user
// never opens the Voice tab. The voice <select> dropdowns are only rendered
// when the tab is actually opened (cpTtsInit → _cpTtsRenderAll).
//
// Max 5 voice blend slots. Weights are displayed as percentages and normalised
// on save. The server handles the actual normalisation too, but we show it live.

const CP_TTS_MAX_SLOTS = 5;

let _cpTtsInitDone   = false;
let _cpTtsVoiceList  = [];   // available voices from server
let _cpTtsSlots      = [];   // [{voice, weight}] — current UI state
let _cpTtsEnabled    = false;
let _cpTtsUnavailable = false;

// ── Init / reset ───────────────────────────────────────────────────────────────

async function cpTtsInit() {
  if (_cpTtsInitDone) return;
  _cpTtsInitDone = true;

  // Fetch status + available voices
  try {
    const res  = await fetch('/api/tts/status');
    const data = await res.json();
    _cpTtsUnavailable = !data.available && data.reason === 'tts_unavailable';
    _cpTtsVoiceList   = data.voices || ttsGetVoices() || [];
  } catch {
    _cpTtsVoiceList = ttsGetVoices() || [];
  }

  // Re-render slots now that we have the real voice list.
  // _cpTtsSlots was already populated by cpTtsPopulate() on window open.
  _cpTtsRenderAll();
}

function cpTtsReset() {
  _cpTtsInitDone = false;
  _cpTtsSlots    = [];
}

// ── Populate from settings ─────────────────────────────────────────────────────
// Called eagerly from cpPopulate() on every window open so _cpTtsSlots is
// always ready for cpSave(), regardless of whether the Voice tab is opened.

function cpTtsPopulate(ttsCfg) {
  // ttsCfg = active_companion.tts from /api/settings
  const blend = ttsCfg?.voice_blend || { 'af_heart': 1.0 };
  _cpTtsEnabled = !!(ttsCfg?.enabled ?? false);

  // Convert blend dict → slot array
  _cpTtsSlots = Object.entries(blend).map(([voice, weight]) => ({
    voice,
    weight: Number(weight) || 0,
  }));

  // Ensure at least one slot
  if (_cpTtsSlots.length === 0) {
    _cpTtsSlots = [{ voice: _cpTtsVoiceList[0] || 'af_heart', weight: 1.0 }];
  }

  const speedEl = document.getElementById('cp-tts-speed');
  const pitchEl = document.getElementById('cp-tts-pitch');
  if (speedEl) speedEl.value = ttsCfg?.speed ?? 1.0;
  if (pitchEl) pitchEl.value = ttsCfg?.pitch ?? 1.0;

  // Only re-render the tab UI if the tab has already been opened.
  // If not, _cpTtsRenderAll() will pick up _cpTtsSlots when the tab opens.
  if (_cpTtsInitDone) {
    _cpTtsRenderSlots();
    _cpTtsUpdateWeightDisplay();
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────

function _cpTtsRenderAll() {
  const unavailEl = document.getElementById('cp-tts-unavailable');
  const contentEl = document.getElementById('cp-tts-content');
  if (!unavailEl || !contentEl) return;

  if (_cpTtsUnavailable) {
    unavailEl.style.display = 'block';
    contentEl.style.display = 'none';
    return;
  }

  unavailEl.style.display = 'none';
  contentEl.style.display = 'block';

  // Warn if TTS is available but no voices were discovered
  let noVoicesWarn = contentEl.querySelector('.cp-tts-no-voices');
  if (_cpTtsInitDone && _cpTtsVoiceList.length === 0) {
    if (!noVoicesWarn) {
      noVoicesWarn = document.createElement('div');
      noVoicesWarn.className = 'cp-tts-no-voices cp-tts-unavailable';
      noVoicesWarn.innerHTML = '<strong>No voices discovered.</strong> Kokoro may be installed but voice files are missing. Try restarting SENNI or reinstalling Kokoro.';
      contentEl.insertBefore(noVoicesWarn, contentEl.firstChild);
    }
  } else if (noVoicesWarn) {
    noVoicesWarn.remove();
  }

  // If cpTtsPopulate() was already called (from cpPopulate on window open),
  // _cpTtsSlots already has the right data — just render them.
  // Otherwise fall back to reading from cpSettings directly.
  if (_cpTtsSlots.length === 0) {
    const tts = cpSettings?.active_companion?.tts;
    if (tts) cpTtsPopulate(tts);
  } else {
    _cpTtsRenderSlots();
    _cpTtsUpdateWeightDisplay();
  }
}

function _cpTtsRenderSlots() {
  const container = document.getElementById('cp-tts-blend-slots');
  if (!container) return;
  container.innerHTML = '';

  _cpTtsSlots.forEach((slot, i) => {
    const row = document.createElement('div');
    row.className = 'cp-tts-slot';
    row.dataset.idx = i;

    // Voice select
    const sel = document.createElement('select');
    sel.className = 'cp-tts-voice-select cp-input';
    const voices = _cpTtsVoiceList.length > 0 ? _cpTtsVoiceList : _cpTtsFallbackVoices();
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value       = v;
      opt.textContent = v;
      if (v === slot.voice) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      _cpTtsSlots[i].voice = sel.value;
      cpMarkDirty();
    });

    // Weight slider
    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'cp-tts-weight-wrap';

    const slider = document.createElement('input');
    slider.type      = 'range';
    slider.className = 'cp-tts-weight-slider';
    slider.min       = 0;
    slider.max       = 100;
    slider.step      = 1;
    slider.value     = Math.round(slot.weight * 100);
    slider.addEventListener('input', () => {
      _cpTtsSlots[i].weight = parseInt(slider.value) / 100;
      _cpTtsUpdateWeightDisplay();
      cpMarkDirty();
    });

    const pct = document.createElement('span');
    pct.className = 'cp-tts-weight-pct';
    pct.id        = `cp-tts-pct-${i}`;
    pct.textContent = Math.round(slot.weight * 100) + '%';

    sliderWrap.appendChild(slider);
    sliderWrap.appendChild(pct);

    // Remove button (only shown when more than 1 slot)
    const removeBtn = document.createElement('button');
    removeBtn.className   = 'cp-tts-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title       = 'Remove voice';
    removeBtn.style.display = _cpTtsSlots.length > 1 ? 'flex' : 'none';
    removeBtn.addEventListener('click', () => {
      _cpTtsSlots.splice(i, 1);
      _cpTtsRenderSlots();
      _cpTtsUpdateWeightDisplay();
      cpMarkDirty();
    });

    row.appendChild(sel);
    row.appendChild(sliderWrap);
    row.appendChild(removeBtn);
    container.appendChild(row);
  });

  // Add voice button
  const addBtn = document.getElementById('cp-tts-add-voice');
  if (addBtn) {
    addBtn.style.display = _cpTtsSlots.length < CP_TTS_MAX_SLOTS ? 'inline-flex' : 'none';
  }
}

function _cpTtsUpdateWeightDisplay() {
  // Show normalised percentages live
  const total = _cpTtsSlots.reduce((s, slot) => s + slot.weight, 0);
  _cpTtsSlots.forEach((slot, i) => {
    const pctEl = document.getElementById(`cp-tts-pct-${i}`);
    if (!pctEl) return;
    const norm = total > 0 ? Math.round((slot.weight / total) * 100) : 0;
    pctEl.textContent = norm + '%';
  });
}

function _cpTtsFallbackVoices() {
  // Hardcoded fallback list if server hasn't returned voices yet
  return [
    'af_heart','af_bella','af_sarah','af_sky','af_nicole',
    'af_aoede','af_kore','am_adam','am_michael','am_echo',
    'bf_emma','bf_isabella','bm_george','bm_lewis',
  ];
}

// ── Add voice slot ─────────────────────────────────────────────────────────────

function cpTtsAddVoice() {
  if (_cpTtsSlots.length >= CP_TTS_MAX_SLOTS) return;
  const voices = _cpTtsVoiceList.length > 0 ? _cpTtsVoiceList : _cpTtsFallbackVoices();
  // Pick a voice not already in use, or just the first
  const used   = new Set(_cpTtsSlots.map(s => s.voice));
  const next   = voices.find(v => !used.has(v)) || voices[0] || 'af_heart';
  _cpTtsSlots.push({ voice: next, weight: 0.3 });
  _cpTtsRenderSlots();
  _cpTtsUpdateWeightDisplay();
  cpMarkDirty();
}

// ── Preview ────────────────────────────────────────────────────────────────────

async function cpTtsPreview() {
  const btn = document.getElementById('cp-tts-preview-btn');
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  const textEl = document.getElementById('cp-tts-preview-text');
  const text   = textEl?.value?.trim() || 'Hello! This is a preview of my voice.';
  const voices = _cpGetNormalisedBlend();
  const speed  = parseFloat(document.getElementById('cp-tts-speed')?.value) || 1.0;
  const pitch  = parseFloat(document.getElementById('cp-tts-pitch')?.value) || 1.0;

  await ttsPreview(text, voices, speed, pitch);

  if (btn) { btn.textContent = '▶ Preview'; btn.disabled = false; }
}

// ── Payload ────────────────────────────────────────────────────────────────────

function _cpGetNormalisedBlend() {
  const total = _cpTtsSlots.reduce((s, slot) => s + slot.weight, 0);
  if (total <= 0) return { af_heart: 1.0 };
  const blend = {};
  _cpTtsSlots.forEach(slot => {
    if (slot.weight > 0) blend[slot.voice] = slot.weight / total;
  });
  return blend;
}

function _cpGetTtsPayload() {
  const speed = parseFloat(document.getElementById('cp-tts-speed')?.value) || 1.0;
  const pitch = parseFloat(document.getElementById('cp-tts-pitch')?.value) || 1.0;
  return {
    tts: {
      voice_blend: _cpGetNormalisedBlend(),
      speed,
      pitch,
    },
  };
}
