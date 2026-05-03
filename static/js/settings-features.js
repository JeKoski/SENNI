// settings-features.js — Settings panel: Features tab (TTS + ChromaDB)
// Depends on: settings.js (spSettings, _spSetDirty, _spClearDirty, spShowSavedToast, closeSettings)

// ── Accordion toggle ───────────────────────────────────────────────────────────
function spToggleAccordion(id) {
  document.getElementById(id)?.classList.toggle('open');
}

// ── Populate ──────────────────────────────────────────────────────────────────
function spPopulateFeatures() {
  const tts    = spSettings.config?.tts    || {};
  const memory = spSettings.config?.memory || {};

  // TTS
  _spFeatSetDisp('sp-tts-python-display', tts.python_path || '', 'Auto-detect');
  _spFeatSetDisp('sp-tts-voices-display', tts.voices_path || '', 'Auto-detect');
  _spFeatSetDisp('sp-tts-espeak-display', tts.espeak_path || '', 'Auto-detect');
  const ttsTog = document.getElementById('sp-tts-enabled');
  if (ttsTog) ttsTog.classList.toggle('on', !!tts.enabled);

  // TTS status badge (config-based; runtime check below)
  const ttsStatus = document.getElementById('feat-status-tts');
  if (ttsStatus) {
    if (tts.enabled) {
      ttsStatus.textContent = 'enabled';
      ttsStatus.className = 'sp-feat-status active';
    } else {
      ttsStatus.textContent = 'disabled';
      ttsStatus.className = 'sp-feat-status inactive';
    }
  }

  // Fetch live TTS runtime status to surface error messages
  if (tts.enabled) {
    fetch('/api/tts/status').then(r => r.json()).then(data => {
      const hint = document.getElementById('sp-tts-error-hint');
      if (!hint) return;
      if (!data.available && data.reason === 'tts_unavailable' && data.error) {
        hint.textContent = '⚠ ' + data.error;
        hint.style.display = 'block';
        if (ttsStatus) { ttsStatus.textContent = 'error'; ttsStatus.className = 'sp-feat-status error'; }
      } else if (data.available) {
        hint.style.display = 'none';
        if (ttsStatus) { ttsStatus.textContent = 'running'; ttsStatus.className = 'sp-feat-status active'; }
      } else {
        hint.style.display = 'none';
      }
    }).catch(() => {});
  } else {
    const hint = document.getElementById('sp-tts-error-hint');
    if (hint) hint.style.display = 'none';
  }

  // ChromaDB
  const chromaTog = document.getElementById('sp-chroma-enabled');
  if (chromaTog) chromaTog.classList.toggle('on', memory.enabled !== false);

  const chromaStatus = document.getElementById('feat-status-chroma');
  if (chromaStatus) {
    if (memory.enabled !== false) {
      chromaStatus.textContent = 'enabled';
      chromaStatus.className = 'sp-feat-status active';
    } else {
      chromaStatus.textContent = 'disabled';
      chromaStatus.className = 'sp-feat-status inactive';
    }
  }
}

function _spFeatSetDisp(id, val, empty) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val ? val.split(/[\\/]/).pop() : empty;
  el.title       = val || '';
  el.className   = 'sp-file-display' + (val ? ' set' : '');
}

function spMarkFeaturesDirty() { _spSetDirty('features'); }

// ── TTS path helpers (moved from settings-server.js) ──────────────────────────

async function spBrowseTts(type) {
  const dispId = type === 'python' ? 'sp-tts-python-display'
               : type === 'voices' ? 'sp-tts-voices-display'
               :                     'sp-tts-espeak-display';
  const disp = document.getElementById(dispId);
  if (!disp) return;

  const original = { text: disp.textContent, cls: disp.className };
  disp.textContent = '…';

  const isFolder = type === 'voices';
  const titles   = { voices: 'Select Kokoro voices folder', python: 'Select Python executable', espeak: 'Select espeak-ng binary' };

  try {
    const browseType = isFolder ? 'folder' : type;
    const res  = await fetch('/api/browse', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: browseType, title: titles[type] }) });
    const data = await res.json();
    if (data.ok && data.path) {
      disp.textContent = data.path.split(/[\\/]/).pop();
      disp.title       = data.path;
      disp.className   = 'sp-file-display set';
      spMarkFeaturesDirty();
      return;
    }
    disp.textContent = original.text; disp.className = original.cls;
  } catch {
    disp.textContent = original.text; disp.className = original.cls;
    _spShowTtsPathInput(type, dispId, disp.title);
  }
}

function _spShowTtsPathInput(type, dispId, currentVal) {
  const inputId = 'sp-tts-' + type + '-inp';
  document.getElementById(inputId)?.remove();
  const disp = document.getElementById(dispId);
  if (!disp) return;

  const placeholders = {
    python: '/usr/bin/python3 or C:\\Python312\\python.exe',
    voices: '/path/to/kokoro/voices',
    espeak: '/usr/bin/espeak-ng',
  };

  const inp = document.createElement('input');
  inp.type        = 'text';
  inp.id          = inputId;
  inp.placeholder = placeholders[type] || '/path/to/file';
  inp.value       = currentVal || '';
  inp.className   = 'sp-input';
  inp.style.marginTop = '6px';
  inp.addEventListener('input', () => {
    const val = inp.value.trim();
    disp.textContent = val ? val.split(/[\\/]/).pop() : 'Auto-detect';
    disp.title       = val;
    disp.className   = 'sp-file-display' + (val ? ' set' : '');
    spMarkFeaturesDirty();
  });

  const row = disp?.closest('.sp-file-row');
  if (row) row.insertAdjacentElement('afterend', inp);
  inp.focus();
}

function spClearTtsPath(type) {
  const dispId  = type === 'python' ? 'sp-tts-python-display'
                : type === 'voices' ? 'sp-tts-voices-display'
                :                     'sp-tts-espeak-display';
  const inputId = 'sp-tts-' + type + '-inp';
  const disp = document.getElementById(dispId);
  if (disp) { disp.textContent = 'Auto-detect'; disp.title = ''; disp.className = 'sp-file-display'; }
  document.getElementById(inputId)?.remove();
  spMarkFeaturesDirty();
}

async function spFillTtsDefault(type) {
  const dispId = type === 'python' ? 'sp-tts-python-display'
               : type === 'voices' ? 'sp-tts-voices-display'
               :                     'sp-tts-espeak-display';
  const disp = document.getElementById(dispId);
  if (!disp) return;

  const original = { text: disp.textContent, cls: disp.className };
  disp.textContent = '…';

  try {
    const endpoint = type === 'python' ? '/api/tts/python-default' : '/api/tts/espeak-default';
    const res  = await fetch(endpoint);
    const data = await res.json();
    if (data.ok && data.path) {
      disp.textContent = data.path.split(/[\\/]/).pop();
      disp.title       = data.path;
      disp.className   = 'sp-file-display set';
      spMarkFeaturesDirty();
      if (data.version) {
        const row = disp.closest('.sp-file-row');
        let hint = row?.parentElement?.querySelector('.sp-tts-version-hint');
        if (!hint) {
          hint = document.createElement('div');
          hint.className = 'sp-tts-version-hint';
          hint.style.cssText = 'font-size:11px;color:var(--text-dim);margin-top:3px;font-family:"DM Mono",monospace';
          row?.insertAdjacentElement('afterend', hint);
        }
        hint.textContent = data.version;
      }
    } else {
      disp.textContent = original.text; disp.className = original.cls;
      const row = disp.closest('.sp-file-row');
      let hint = row?.parentElement?.querySelector('.sp-tts-version-hint');
      if (hint) hint.textContent = 'Not found in default locations';
    }
  } catch {
    disp.textContent = original.text; disp.className = original.cls;
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function spSaveFeatures(andClose = false) {
  // TTS
  await fetch('/api/settings/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled:     document.getElementById('sp-tts-enabled')?.classList.contains('on') ?? false,
      python_path: document.getElementById('sp-tts-python-display')?.title || '',
      voices_path: document.getElementById('sp-tts-voices-display')?.title || '',
      espeak_path: document.getElementById('sp-tts-espeak-display')?.title || '',
    }),
  });
  if (typeof ttsReload === 'function') ttsReload();

  // ChromaDB
  const chromaEnabled = document.getElementById('sp-chroma-enabled')?.classList.contains('on') ?? true;
  await fetch('/api/settings/features', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memory_enabled: chromaEnabled }),
  });
  if (spSettings.config?.memory) spSettings.config.memory.enabled = chromaEnabled;

  _spClearDirty('features');
  spShowSavedToast('Features saved ✓');
  if (andClose) closeSettings();
}
