// companion-presence.js — Presence tab: presets, state editor, preview orb, layout toggle
// Loaded after companion.js. Depends on: orb.js
// Colour picker delegated to companion-color-picker.js (loaded after this file).
//
// Exports (globals used by companion.js and companion-mood.js):
//   cpPresenceInit()
//   cpPresenceReset()
//   cpPresenceRenderPresets()
//   cpPresenceRenderState(state)
//   cpPresenceSwitchState(state, el)
//   cpPresenceToggleElement(elemId)
//   cpPresenceToggleAnim(elemId)
//   cpPresenceOpenColorPicker(elemId)   — thin wrapper → cpOpenColorPicker()
//   cpPresencePickColor(elemId, hex)
//   cpPresenceSlider(id, key, val)
//   cpPresenceOverlayHexInput(val)      — kept for chat.html oninput attr compat
//   cpPresenceNewPreset()
//   cpPresenceDeletePreset(name)
//   cpSetOrbLayout(mode)
//   _cpGetPresencePayload()             — called by companion.js cpSave()
//   CP_STATE_DEFAULTS                   — read by companion-mood.js
//   CP_ELEMENTS                         — read by companion-mood.js
//   CP_SWATCHES                         — read by companion-color-picker.js

// ── Swatch palette ─────────────────────────────────────────────────────────
const CP_SWATCHES = [
  ['#c4b5fd', '#93c5fd', '#67e8f9', '#6ee7b7', '#86efac', '#fde68a', '#fda4af', '#cbd5e1'],
  ['#a78bfa', '#60a5fa', '#22d3ee', '#34d399', '#4ade80', '#fbbf24', '#fb7185', '#94a3b8'],
  ['#818cf8', '#3b82f6', '#06b6d4', '#10b981', '#22c55e', '#f59e0b', '#f43f5e', '#64748b'],
  ['#6366f1', '#2563eb', '#0891b2', '#059669', '#16a34a', '#d97706', '#e11d48', '#475569'],
  ['#4f46e5', '#1d4ed8', '#0e7490', '#047857', '#15803d', '#b45309', '#be123c', '#334155'],
];

// ── Slider scale conversion — UI layer only ────────────────────────────────
// Sliders display 0–100 integers. Config stores real CSS values (seconds,
// pixels, 0–1 floats) — same format as always, unchanged everywhere else.
// These functions are the only translation layer.

const CP_SPEED_RANGES = {
  breathSpeed: { minS: 0.4, maxS: 7.0 },
  dotSpeed:    { minS: 0.3, maxS: 3.0 },
  glowSpeed:   { minS: 0.4, maxS: 6.0 },
  ringSpeed:   { minS: 0.4, maxS: 5.0 },
};

// Stored seconds → 0–100 display value (0 = slow, 100 = fast)
function _cpSecsToSlider(secs, minS, maxS) {
  const t = (maxS - secs) / (maxS - minS);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

// 0–100 slider → stored seconds
function _cpSliderToSecs(val, minS, maxS) {
  const t = Math.max(0, Math.min(100, val)) / 100;
  return parseFloat((maxS - t * (maxS - minS)).toFixed(2));
}

// Stored px (32–160) → 0–100 display value
function _cpSizeToSlider(px) {
  return Math.round(Math.max(0, Math.min(1, (px - 32) / 128)) * 100);
}

// 0–100 slider → stored px
function _cpSliderToSize(val) {
  return Math.round(32 + (Math.max(0, Math.min(100, val)) / 100) * 128);
}

// Stored px (4–36) → 0–100 display value
function _cpIntensityToSlider(px) {
  return Math.round(Math.max(0, Math.min(1, (px - 4) / 32)) * 100);
}

// 0–100 slider → stored px
function _cpSliderToIntensity(val) {
  return Math.round(4 + (Math.max(0, Math.min(100, val)) / 100) * 32);
}

// Stored 0.0–1.0 float → 0–100 display value
function _cpAlphaToSlider(a) {
  return Math.round(Math.max(0, Math.min(1, a)) * 100);
}

// 0–100 slider → stored 0.0–1.0 float
function _cpSliderToAlpha(val) {
  return parseFloat((Math.max(0, Math.min(100, val)) / 100).toFixed(2));
}

// ── Element definitions ────────────────────────────────────────────────────
// colorKey: config field for the colour pip.
// animId:   boolean config field the group toggle controls. null = no group toggle (Orb).
// sliders:  property rows inside the expanded body. Each has:
//   id, key, label
//   toSlider(cssVal)    — converts stored CSS value to 0–100 display integer
//   fromSlider(intVal)  — converts 0–100 display integer to stored CSS value
//   format(displayVal)  — formats the display integer for the label
//   isBreath: true      — row gets its own inline toggle (Breathing on Orb)
const CP_ELEMENTS = [
  {
    id:       'orb',
    label:    'Orb',
    colorKey: 'edgeColor',
    animId:   null,
    sliders: [
      {
        id: 'ps-orb-size', key: 'orbSize', label: 'Size',
        toSlider:   (v) => _cpSizeToSlider(v),
        fromSlider: (v) => _cpSliderToSize(v),
        format:     (v) => Math.round(v),
      },
      {
        id: 'ps-breath-speed', key: 'breathSpeed', label: 'Breathing',
        toSlider:   (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.breathSpeed.minS, CP_SPEED_RANGES.breathSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.breathSpeed.minS, CP_SPEED_RANGES.breathSpeed.maxS),
        format:     (v) => Math.round(v),
        isBreath:   true,
      },
    ],
  },
  {
    id:       'dots',
    label:    'Dots',
    colorKey: 'dotColor',
    animId:   'dotsEnabled',
    sliders: [
      {
        id: 'ps-dot-speed', key: 'dotSpeed', label: 'Speed',
        toSlider:   (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.dotSpeed.minS, CP_SPEED_RANGES.dotSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.dotSpeed.minS, CP_SPEED_RANGES.dotSpeed.maxS),
        format:     (v) => Math.round(v),
      },
    ],
  },
  {
    id:       'glow',
    label:    'Glow',
    colorKey: 'glowColor',
    animId:   'glowEnabled',
    sliders: [
      {
        id: 'ps-glow-opacity', key: 'glowAlpha', label: 'Opacity',
        toSlider:   (v) => _cpAlphaToSlider(v),
        fromSlider: (v) => _cpSliderToAlpha(v),
        format:     (v) => Math.round(v) + '%',
      },
      {
        id: 'ps-glow-speed', key: 'glowSpeed', label: 'Speed',
        toSlider:   (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.glowSpeed.minS, CP_SPEED_RANGES.glowSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.glowSpeed.minS, CP_SPEED_RANGES.glowSpeed.maxS),
        format:     (v) => Math.round(v),
      },
      {
        id: 'ps-glow-intensity', key: 'glowMax', label: 'Intensity',
        toSlider:   (v) => _cpIntensityToSlider(v),
        fromSlider: (v) => _cpSliderToIntensity(v),
        format:     (v) => Math.round(v),
      },
    ],
  },
  {
    id:       'ring',
    label:    'Ring',
    colorKey: 'ringColor',
    animId:   'ringEnabled',
    sliders: [
      {
        id: 'ps-ring-opacity', key: 'ringAlpha', label: 'Opacity',
        toSlider:   (v) => _cpAlphaToSlider(v),
        fromSlider: (v) => _cpSliderToAlpha(v),
        format:     (v) => Math.round(v) + '%',
      },
      {
        id: 'ps-ring-speed', key: 'ringSpeed', label: 'Speed',
        toSlider:   (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.ringSpeed.minS, CP_SPEED_RANGES.ringSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.ringSpeed.minS, CP_SPEED_RANGES.ringSpeed.maxS),
        format:     (v) => Math.round(v),
      },
    ],
  },
];

// ── State ──────────────────────────────────────────────────────────────────
let _cpPresenceData     = {};
let _cpActivePreset     = 'Default';
let _cpEditingState     = 'thinking';
let _cpPresenceDirty    = false;
let _cpPresenceInitDone = false;

// ── Defaults — real CSS values, unchanged from original ────────────────────
const CP_STATE_DEFAULTS = {
  thinking:  { dotColor:'#818cf8', edgeColor:'#818cf8', glowColor:'#818cf8', glowAlpha:0.40, ringColor:'#818cf8', ringAlpha:0.28, glowMax:16, glowSpeed:2.0, ringSpeed:1.8, dotSpeed:1.2, breathSpeed:3.0, orbSize:52 },
  streaming: { dotColor:'#6dd4a8', edgeColor:'#6dd4a8', glowColor:'#6dd4a8', glowAlpha:0.35, ringColor:'#6dd4a8', ringAlpha:0.22, glowMax:12, glowSpeed:2.5, ringSpeed:2.4, dotSpeed:1.4, breathSpeed:3.0, orbSize:52 },
  heartbeat: { dotColor:'#a78bfa', edgeColor:'#a78bfa', glowColor:'#a78bfa', glowAlpha:0.45, ringColor:'#a78bfa', ringAlpha:0.30, glowMax:20, glowSpeed:1.4, ringSpeed:1.4, dotSpeed:0.9, breathSpeed:2.0, orbSize:52 },
  chaos:     { dotColor:'#fbbf24', edgeColor:'#fbbf24', glowColor:'#fbbf24', glowAlpha:0.50, ringColor:'#fbbf24', ringAlpha:0.35, glowMax:24, glowSpeed:0.8, ringSpeed:0.9, dotSpeed:0.6, breathSpeed:0.6, orbSize:52 },
  idle:      { dotColor:'#818cf8', edgeColor:'#818cf8', glowColor:'#818cf8', glowAlpha:0.15, ringColor:'#818cf8', ringAlpha:0.12, glowMax:6,  glowSpeed:4.0, ringSpeed:4.0, dotSpeed:2.0, breathSpeed:5.0, orbSize:52 },
};

// ── Init / reset ───────────────────────────────────────────────────────────
function cpPresenceInit() {
  if (_cpPresenceInitDone) return;
  const cfg = cpSettings || {};

  _cpPresenceData = JSON.parse(JSON.stringify(
    cfg.presence_presets || { Default: JSON.parse(JSON.stringify(CP_STATE_DEFAULTS)) }
  ));

  _cpActivePreset = cfg.active_companion?.active_presence_preset
                 || cfg.config?.active_presence_preset
                 || cfg.active_presence_preset
                 || 'Default';

  if (!_cpPresenceData[_cpActivePreset]) {
    _cpPresenceData[_cpActivePreset] = JSON.parse(JSON.stringify(CP_STATE_DEFAULTS));
  }

  _cpEditingState     = 'thinking';
  _cpPresenceInitDone = true;

  const currentMode = localStorage.getItem('orb_layout') || 'inline';
  document.querySelectorAll('.cp-layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === currentMode));

  _cpBuildElementBodies();
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);
  _cpSyncStateChips(_cpEditingState);

  const avSrc = document.querySelector('#companion-avatar img')?.src;
  const previewIcon = document.getElementById('cpp-icon');
  if (previewIcon && avSrc) {
    previewIcon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  }
}

function cpPresenceReset() {
  _cpPresenceInitDone = false;
}

// ── Element accordion body builder ─────────────────────────────────────────
function _cpBuildElementBodies() {
  CP_ELEMENTS.forEach(elem => {
    const body = document.getElementById(`cp-elem-body-${elem.id}`);
    if (!body || body.dataset.built) return;

    let html = '';

    // Colour row — spacer keeps labels aligned with toggle rows
    html += `
      <div class="cp-prop-row">
        <div class="cp-prop-tog-space"></div>
        <span class="cp-prop-label">Colour</span>
        <div class="cp-prop-pip" id="cp-prop-pip-${elem.id}"
             onclick="cpPresenceOpenColorPicker('${elem.id}')"></div>
        <span class="cp-prop-hex" id="cp-prop-hex-${elem.id}"></span>
      </div>`;

    elem.sliders.forEach(sl => {
      if (sl.isBreath) {
        html += `
      <div class="cp-prop-row">
        <div class="cp-elem-tog on" id="cp-breath-tog-${elem.id}"
             onclick="cpPresenceToggleAnim('${elem.id}')"></div>
        <span class="cp-prop-label">${sl.label}</span>
        <div class="cp-prop-slider-wrap">
          <input class="cp-prop-slider" type="range" id="${sl.id}"
            min="0" max="100" step="1"
            oninput="cpPresenceSlider('${sl.id}','${sl.key}',this.value)"/>
        </div>
        <span class="cp-prop-val" id="${sl.id}-val">—</span>
      </div>`;
      } else {
        html += `
      <div class="cp-prop-row">
        <div class="cp-prop-tog-space"></div>
        <span class="cp-prop-label">${sl.label}</span>
        <div class="cp-prop-slider-wrap">
          <input class="cp-prop-slider" type="range" id="${sl.id}"
            min="0" max="100" step="1"
            oninput="cpPresenceSlider('${sl.id}','${sl.key}',this.value)"/>
        </div>
        <span class="cp-prop-val" id="${sl.id}-val">—</span>
      </div>`;
      }
    });

    body.innerHTML = html;
    body.dataset.built = '1';
  });
}

// ── Accordion toggle ───────────────────────────────────────────────────────
function cpPresenceToggleElement(elemId) {
  const el = document.getElementById(`cp-elem-${elemId}`);
  if (!el) return;
  el.classList.toggle('open');
}

// ── Preset list ────────────────────────────────────────────────────────────
function cpPresenceRenderPresets() {
  const bar = document.getElementById('cp-preset-bar');
  if (!bar) return;
  bar.innerHTML = '';

  Object.keys(_cpPresenceData).forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'cp-presence-chip' + (name === _cpActivePreset ? ' active' : '');

    const label = document.createElement('span');
    label.textContent = name;
    chip.appendChild(label);

    if (name !== 'Default' && name !== 'Warm') {
      const del = document.createElement('span');
      del.className   = 'cp-presence-chip-del';
      del.textContent = '×';
      del.onclick     = (e) => { e.stopPropagation(); cpPresenceDeletePreset(name); };
      chip.appendChild(del);
    }

    chip.addEventListener('click', () => cpPresenceSelectPreset(name));
    bar.appendChild(chip);
  });

  const addBtn = document.createElement('button');
  addBtn.className   = 'cp-presence-chip-new';
  addBtn.textContent = '+ New';
  addBtn.onclick     = cpPresenceNewPreset;
  bar.appendChild(addBtn);
}

function cpPresenceSelectPreset(name) {
  if (!_cpPresenceData[name]) return;
  _cpActivePreset = name;
  document.querySelectorAll('.cp-presence-chip').forEach(c => {
    c.classList.toggle('active', c.querySelector('span')?.textContent === name);
  });
  cpPresenceRenderState(_cpEditingState);
}

function cpPresenceNewPreset() {
  const name = prompt('Preset name:');
  if (!name?.trim()) return;
  const n = name.trim();
  if (_cpPresenceData[n]) { alert('A preset with that name already exists.'); return; }
  _cpPresenceData[n] = JSON.parse(JSON.stringify(_cpPresenceData['Default'] || CP_STATE_DEFAULTS));
  _cpActivePreset    = n;
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(n);
  _cpPresenceDirty = true;
  if (typeof cpMarkDirty === 'function') cpMarkDirty();
}

function cpPresenceDeletePreset(name) {
  if (name === 'Default' || name === 'Warm') return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  delete _cpPresenceData[name];
  if (_cpActivePreset === name) _cpActivePreset = 'Default';
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);
  _cpPresenceDirty = true;
  if (typeof cpMarkDirty === 'function') cpMarkDirty();
}

// ── State selector ─────────────────────────────────────────────────────────
function _cpSyncStateChips(state) {
  document.querySelectorAll('.cp-state-chip').forEach(c => {
    const match = (c.getAttribute('onclick') || '').match(/cpPresenceSwitchState\('([^']+)'/);
    const chipState = match ? match[1] : null;
    c.classList.toggle('active', chipState === state);
  });
  const lbl = document.getElementById('cpp-state-label');
  if (lbl) lbl.textContent = state;
}

function cpPresenceSwitchState(state, el) {
  _cpEditingState = state;
  _cpSyncStateChips(state);
  cpPresenceRenderState(state);
}

// ── Render state into all controls ────────────────────────────────────────
// Reads real CSS values from data, converts to 0–100 for slider display only.
function cpPresenceRenderState(state) {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  const s = Object.assign({}, CP_STATE_DEFAULTS[state] || CP_STATE_DEFAULTS.thinking, preset[state] || {});

  CP_ELEMENTS.forEach(elem => {
    const hex = s[elem.colorKey] || '#818cf8';

    const pip  = document.getElementById(`cp-prop-pip-${elem.id}`);
    const hexL = document.getElementById(`cp-prop-hex-${elem.id}`);
    if (pip)  pip.style.background = hex;
    if (hexL) hexL.textContent     = hex;

    // Sliders: convert real CSS value → 0–100 for display
    elem.sliders.forEach(sl => {
      const input  = document.getElementById(sl.id);
      const lbl    = document.getElementById(sl.id + '-val');
      const rawVal = s[sl.key];
      if (rawVal === undefined) return;
      const displayVal = sl.toSlider(rawVal);
      if (input) input.value     = displayVal;
      if (lbl)   lbl.textContent = sl.format(displayVal);
    });

    // Group toggle (Dots/Glow/Ring) or breath toggle (Orb)
    if (elem.animId) {
      const enabled = s[elem.animId] !== false;
      const tog  = document.getElementById(`cp-elem-tog-${elem.id}`);
      const body = document.getElementById(`cp-elem-body-${elem.id}`);
      if (tog)  { tog.classList.toggle('on', enabled);  tog.classList.toggle('off', !enabled); }
      if (body) body.style.opacity = enabled ? '' : '0.4';
    } else {
      const breathEnabled = s['breathEnabled'] !== false;
      const tog = document.getElementById(`cp-breath-tog-${elem.id}`);
      if (tog) { tog.classList.toggle('on', breathEnabled); tog.classList.toggle('off', !breathEnabled); }
    }

    // Dots: dim if this state doesn't use dots
    const elemRow = document.getElementById(`cp-elem-${elem.id}`);
    if (elemRow && elem.id === 'dots') {
      const hasDots = !orb.ANIMATIONS.find(a => a.id === 'dotsEnabled')?.states ||
                       orb.ANIMATIONS.find(a => a.id === 'dotsEnabled').states.includes(state);
      elemRow.style.opacity = hasDots ? '' : '0.4';
    }
  });

  cpPresenceUpdatePreview(s, state);
}

// ── Colour picker — delegates to companion-color-picker.js ─────────────────
function cpPresenceOpenColorPicker(elemId) {
  const elem = CP_ELEMENTS.find(e => e.id === elemId);
  if (!elem) return;
  const s   = _cpCurrentStateData();
  const hex = s[elem.colorKey] || '#818cf8';
  cpOpenColorPicker({
    title:   elem.label + ' colour',
    hex,
    onPick:  (picked) => cpPresencePickColor(elemId, picked),
  });
}

// Kept for backward compat — chat.html still has oninput="cpPresenceOverlayHexInput()"
function cpPresenceOverlayHexInput(val) {
  cpPickerHexInput(val);
}

function cpPresencePickColor(elemId, hex) {
  const elem = CP_ELEMENTS.find(e => e.id === elemId);
  if (!elem) return;
  const pip  = document.getElementById(`cp-prop-pip-${elemId}`);
  const hexL = document.getElementById(`cp-prop-hex-${elemId}`);
  if (pip)  pip.style.background = hex;
  if (hexL) hexL.textContent     = hex;
  cpPresenceSetValue(elem.colorKey, hex);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceHexInput(elemId, val) {
  const hex = val.startsWith('#') ? val : '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) cpPresencePickColor(elemId, hex);
}

// ── Animation toggle ───────────────────────────────────────────────────────
function cpPresenceToggleAnim(elemId) {
  const elem    = CP_ELEMENTS.find(e => e.id === elemId);
  if (!elem) return;
  const animKey = elem.animId || 'breathEnabled';
  const s       = _cpCurrentStateData();
  const enabled = s[animKey] !== false;
  cpPresenceSetValue(animKey, !enabled);

  if (elem.animId) {
    const tog  = document.getElementById(`cp-elem-tog-${elemId}`);
    const body = document.getElementById(`cp-elem-body-${elemId}`);
    if (tog)  { tog.classList.toggle('on', !enabled);  tog.classList.toggle('off', enabled); }
    if (body) body.style.opacity = !enabled ? '' : '0.4';
  } else {
    const tog = document.getElementById(`cp-breath-tog-${elemId}`);
    if (tog) { tog.classList.toggle('on', !enabled); tog.classList.toggle('off', enabled); }
  }
  cpPresenceUpdatePreviewFromCurrent();
}

// ── Slider ─────────────────────────────────────────────────────────────────
// displayVal is the 0–100 integer from the range input.
// fromSlider converts it to the real CSS value before storing.
function cpPresenceSlider(id, key, displayVal) {
  const sl = CP_ELEMENTS.flatMap(e => e.sliders).find(s => s.id === id);
  if (!sl) return;
  const cssVal = sl.fromSlider(parseFloat(displayVal));
  const lbl    = document.getElementById(id + '-val');
  if (lbl) lbl.textContent = sl.format(parseFloat(displayVal));
  cpPresenceSetValue(key, cssVal);
  cpPresenceUpdatePreviewFromCurrent();
}

// ── Value write ────────────────────────────────────────────────────────────
function cpPresenceSetValue(key, val) {
  if (!_cpPresenceData[_cpActivePreset]) _cpPresenceData[_cpActivePreset] = {};
  if (!_cpPresenceData[_cpActivePreset][_cpEditingState]) {
    _cpPresenceData[_cpActivePreset][_cpEditingState] = {};
  }
  _cpPresenceData[_cpActivePreset][_cpEditingState][key] = val;
  _cpPresenceDirty = true;
  if (typeof cpMarkDirty === 'function') cpMarkDirty();
}

function _cpCurrentStateData() {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  return Object.assign(
    {},
    CP_STATE_DEFAULTS[_cpEditingState] || CP_STATE_DEFAULTS.thinking,
    preset[_cpEditingState] || {}
  );
}

// ── Preview orb ────────────────────────────────────────────────────────────
// Uses real CSS values directly — no conversion needed.
function cpPresenceUpdatePreviewFromCurrent() {
  cpPresenceUpdatePreview(_cpCurrentStateData(), _cpEditingState);
}

function cpPresenceUpdatePreview(s, state) {
  const orbEl = document.getElementById('cpp-orb');
  const dots  = document.getElementById('cpp-dots');
  const icon  = document.getElementById('cpp-icon');
  const ring  = orbEl?.querySelector('.cpp-ring');
  if (!orbEl) return;

  const dotColor  = s.dotColor  || '#818cf8';
  const edgeColor = s.edgeColor || dotColor;
  const glowColor = s.glowColor || dotColor;
  const ringColor = s.ringColor || glowColor;
  const glowAlpha = s.glowAlpha !== undefined ? s.glowAlpha : 0.4;
  const ringAlpha = s.ringAlpha !== undefined ? s.ringAlpha : 0.28;

  const size = (s.orbSize || 52) + 'px';
  orbEl.style.width  = size;
  orbEl.style.height = size;
  orbEl.style.background = cpDeriveGlowColor(glowColor, 0.08);
  orbEl.style.border     = `2px solid ${cpDeriveGlowColor(edgeColor, 0.35)}`;
  orbEl.style.setProperty('--cpp-glow-color', cpDeriveGlowColor(glowColor, glowAlpha));
  orbEl.style.setProperty('--cpp-glow-min',   '4px');
  orbEl.style.setProperty('--cpp-glow-max',   (s.glowMax || 16) + 'px');

  const glowOn   = s.glowEnabled   !== false;
  const breathOn = s.breathEnabled !== false;
  const ringOn   = s.ringEnabled   !== false;
  const dotsOn   = s.dotsEnabled   !== false;

  const bodyAnim = [];
  if (glowOn)   bodyAnim.push(`cppGlow ${s.glowSpeed || 2}s ease-in-out infinite`);
  if (breathOn) bodyAnim.push(`cppBreath ${s.breathSpeed || 3}s ease-in-out infinite`);
  orbEl.style.animation = bodyAnim.join(', ') || 'none';

  if (ring) {
    ring.style.setProperty('--cpp-ring-color', cpDeriveGlowColor(ringColor, ringAlpha));
    ring.style.animation = ringOn ? `cppRing ${s.ringSpeed || 1.8}s ease-out infinite` : 'none';
    ring.style.opacity   = ringOn ? '' : '0';
  }

  if (dots) {
    dots.style.width = size;
    dots.querySelectorAll('span').forEach((d, i) => {
      d.style.background = dotColor;
      if (dotsOn) {
        const delay = [0, 0.18, 0.36][i];
        d.style.animation = `cppDot ${s.dotSpeed || 1.2}s ease-in-out ${delay}s infinite`;
        d.style.opacity   = '1';
      } else {
        d.style.animation = 'none';
        d.style.opacity   = '0.08';
      }
    });
  }

  if (icon) {
    icon.style.color    = dotColor;
    icon.style.fontSize = Math.round((s.orbSize || 52) * 0.42) + 'px';
    const avSrc = document.querySelector('#companion-avatar img')?.src;
    if (avSrc && !icon.querySelector('img')) {
      icon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    }
  }
}

// ── Layout toggle ──────────────────────────────────────────────────────────
function cpSetOrbLayout(mode) {
  orb.setMode(mode);
  document.querySelectorAll('.cp-layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  if (typeof cpMarkDirty === 'function') cpMarkDirty();
}

// ── Save payload ───────────────────────────────────────────────────────────
function _cpGetPresencePayload() {
  return {
    presence_presets:       _cpPresenceData,
    active_presence_preset: _cpActivePreset,
  };
}

// ── Color helpers (also usable by companion-mood.js) ──────────────────────
function cpColorToHex(color) {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  return color.startsWith('#') ? color : '#818cf8';
}

function cpDeriveGlowColor(color, alpha) {
  if (color.startsWith('#')) return _cpHexToRgba(color, alpha);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  return color;
}

function _cpHexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
