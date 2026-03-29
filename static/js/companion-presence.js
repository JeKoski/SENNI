// companion-presence.js — Presence tab: presets, state editor, preview orb, layout toggle
// Loaded after companion.js. Depends on: orb.js
//
// Exports (globals used by companion.js):
//   cpPresenceInit()         — called on window open and presence tab switch
//   cpPresenceReset()        — called on window close to allow re-init on next open
//   cpPresenceRenderPresets()
//   cpPresenceRenderState(state)
//   cpPresenceSwitchState(state, btn)
//   cpPresenceSlider(id, key, val, suffix)
//   cpPresenceSetColor(hex)
//   cpPresenceColorInput(val)
//   cpPresenceColorPick(hex)
//   cpPresenceNewPreset()
//   cpPresenceDeletePreset(name)
//   cpSetOrbLayout(mode)
//   _cpGetPresencePayload()  — called by companion.js cpSave()
//   CP_STATE_DEFAULTS        — read by companion-mood.js when built

// ── State ─────────────────────────────────────────────────────────────────────
let _cpPresenceData     = {};        // { presetName: { thinking:{...}, streaming:{...}, ... } }
let _cpActivePreset     = 'Default';
let _cpEditingState     = 'thinking';
let _cpPresenceDirty    = false;
let _cpPresenceInitDone = false;     // guard — prevents tab-switch from wiping edits

// ── Defaults ──────────────────────────────────────────────────────────────────
// Also referenced by companion-mood.js (moods share the same visual properties)
const CP_STATE_DEFAULTS = {
  thinking:  { glowColor:'rgba(129,140,248,0.4)',   glowMax:16, glowSpeed:2.0, ringSpeed:1.8, dotColor:'#818cf8', dotSpeed:1.2, breathSpeed:3.0, orbSize:52 },
  streaming: { glowColor:'rgba(109,212,168,0.35)',  glowMax:12, glowSpeed:2.5, ringSpeed:2.4, dotColor:'#6dd4a8', dotSpeed:1.4, breathSpeed:3.0, orbSize:52 },
  heartbeat: { glowColor:'rgba(167,139,250,0.45)',  glowMax:20, glowSpeed:1.4, ringSpeed:1.4, dotColor:'#a78bfa', dotSpeed:0.9, breathSpeed:2.0, orbSize:52 },
  chaos:     { glowColor:'rgba(251,191,36,0.5)',    glowMax:24, glowSpeed:0.8, ringSpeed:0.9, dotColor:'#fbbf24', dotSpeed:0.6, breathSpeed:0.6, orbSize:52 },
  idle:      { glowColor:'rgba(129,140,248,0.15)',  glowMax:6,  glowSpeed:4.0, ringSpeed:4.0, dotColor:'#818cf8', dotSpeed:2.0, breathSpeed:5.0, orbSize:52 },
};

// ── Init / reset ──────────────────────────────────────────────────────────────
function cpPresenceInit() {
  const cfg = cpSettings || {};

  _cpPresenceData = JSON.parse(JSON.stringify(
    cfg.presence_presets || { Default: JSON.parse(JSON.stringify(CP_STATE_DEFAULTS)) }
  ));

  _cpActivePreset = cfg.active_companion?.active_presence_preset
                 || cfg.config?.active_presence_preset
                 || cfg.active_presence_preset
                 || 'Default';

  // Ensure the active preset actually exists
  if (!_cpPresenceData[_cpActivePreset]) {
    _cpPresenceData[_cpActivePreset] = JSON.parse(JSON.stringify(CP_STATE_DEFAULTS));
  }

  _cpEditingState     = 'thinking';
  _cpPresenceInitDone = true;

  // Sync layout toggle to current mode
  const currentMode = localStorage.getItem('orb_layout') || 'inline';
  document.querySelectorAll('.cp-layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === currentMode));

  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);

  // Mirror companion avatar into the preview orb
  const avSrc = document.querySelector('#companion-avatar img')?.src;
  const previewIcon = document.getElementById('cpp-icon');
  if (previewIcon && avSrc) {
    previewIcon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  }
}

// Called by closeCompanionWindow() so the next open does a fresh init
function cpPresenceReset() {
  _cpPresenceInitDone = false;
}

// ── Preset list ───────────────────────────────────────────────────────────────
function cpPresenceRenderPresets() {
  const bar = document.getElementById('cp-preset-bar');
  if (!bar) return;
  bar.innerHTML = '';
  Object.keys(_cpPresenceData).forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'cp-preset-chip' + (name === _cpActivePreset ? ' active' : '');
    chip.innerHTML = `<span>${name}</span>`;
    if (name !== 'Default' && name !== 'Warm') {
      const del = document.createElement('span');
      del.className   = 'cp-preset-del';
      del.title       = 'Delete preset';
      del.textContent = '×';
      del.onclick = (e) => { e.stopPropagation(); cpPresenceDeletePreset(name); };
      chip.appendChild(del);
    }
    chip.addEventListener('click', () => cpPresenceSelectPreset(name));
    bar.appendChild(chip);
  });
}

function cpPresenceSelectPreset(name) {
  if (!_cpPresenceData[name]) return;
  _cpActivePreset = name;
  const badge = document.getElementById('cp-editing-preset-badge');
  if (badge) badge.textContent = name;
  document.querySelectorAll('.cp-preset-chip').forEach(c => {
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
  _cpActivePreset = n;
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(n);
  _cpPresenceDirty = true;
}

function cpPresenceDeletePreset(name) {
  if (name === 'Default' || name === 'Warm') return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  delete _cpPresenceData[name];
  if (_cpActivePreset === name) _cpActivePreset = 'Default';
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);
  _cpPresenceDirty = true;
}

// ── State editor ──────────────────────────────────────────────────────────────
function cpPresenceSwitchState(state, btn) {
  _cpEditingState = state;
  document.querySelectorAll('.cp-stab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const lbl = document.getElementById('cpp-state-label');
  if (lbl) lbl.textContent = state;
  cpPresenceRenderState(state);
}

function cpPresenceRenderState(state) {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  const s = Object.assign({}, CP_STATE_DEFAULTS[state] || CP_STATE_DEFAULTS.thinking, preset[state] || {});

  const setSlider = (id, val, suffix) => {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-val');
    if (el)  el.value = val;
    if (lbl) lbl.textContent = val + suffix;
  };
  setSlider('ps-glow-max',     s.glowMax,     'px');
  setSlider('ps-glow-speed',   s.glowSpeed,   's');
  setSlider('ps-ring-speed',   s.ringSpeed,   's');
  setSlider('ps-dot-speed',    s.dotSpeed,    's');
  setSlider('ps-breath-speed', s.breathSpeed, 's');
  setSlider('ps-orb-size',     s.orbSize,     'px');

  const color = s.dotColor || '#818cf8';
  const ci = document.getElementById('cp-color-input');
  const cp = document.getElementById('cp-color-picker');
  const cd = document.getElementById('cp-color-dot');
  if (ci) ci.value = color;
  if (cp) cp.value = cpColorToHex(color);
  if (cd) cd.style.background = color;

  cpPresenceUpdatePreview(s, state);
}

function cpPresenceSlider(id, key, val, suffix) {
  const lbl = document.getElementById(id + '-val');
  if (lbl) lbl.textContent = val + suffix;
  cpPresenceSetValue(key, parseFloat(val));
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceSetValue(key, val) {
  if (!_cpPresenceData[_cpActivePreset]) _cpPresenceData[_cpActivePreset] = {};
  if (!_cpPresenceData[_cpActivePreset][_cpEditingState]) {
    _cpPresenceData[_cpActivePreset][_cpEditingState] = {};
  }
  _cpPresenceData[_cpActivePreset][_cpEditingState][key] = val;
  _cpPresenceDirty = true;
}

// ── Color editor ──────────────────────────────────────────────────────────────
function cpPresenceSetColor(hex) {
  const rgba = _hexToRgba(hex, 0.4);
  cpPresenceSetValue('glowColor', rgba);
  cpPresenceSetValue('dotColor',  hex);
  const ci = document.getElementById('cp-color-input');
  const cd = document.getElementById('cp-color-dot');
  if (ci) ci.value = hex;
  if (cd) cd.style.background = hex;
  document.querySelectorAll('#cpp-dots span').forEach(s => s.style.background = hex);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceColorInput(val) {
  const hex = val.startsWith('#') ? val : '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const cp = document.getElementById('cp-color-picker');
    if (cp) cp.value = hex;
    cpPresenceSetColor(hex);
  }
}

function cpPresenceColorPick(hex) {
  cpPresenceSetColor(hex);
  const ci = document.getElementById('cp-color-input');
  if (ci) ci.value = hex;
}

// ── Preview orb ───────────────────────────────────────────────────────────────
function cpPresenceUpdatePreviewFromCurrent() {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  const s = Object.assign({}, CP_STATE_DEFAULTS[_cpEditingState], preset[_cpEditingState] || {});
  cpPresenceUpdatePreview(s, _cpEditingState);
}

function cpPresenceUpdatePreview(s, state) {
  const orbEl = document.getElementById('cpp-orb');
  const dots  = document.getElementById('cpp-dots');
  const icon  = document.getElementById('cpp-icon');
  const ring  = orbEl?.querySelector('.cpp-ring');
  if (!orbEl) return;

  const size = (s.orbSize || 52) + 'px';
  orbEl.style.width      = size;
  orbEl.style.height     = size;
  orbEl.style.background = cpDeriveGlowColor(s.dotColor || '#818cf8', 0.1);
  orbEl.style.border     = `2px solid ${cpDeriveGlowColor(s.dotColor || '#818cf8', 0.35)}`;
  orbEl.style.animation  = `cppGlow ${s.glowSpeed||2}s ease-in-out infinite, cppBreath ${s.breathSpeed||3}s ease-in-out infinite`;
  orbEl.style.setProperty('--cpp-glow-color', s.glowColor || 'rgba(129,140,248,0.4)');
  orbEl.style.setProperty('--cpp-glow-min',   '4px');
  orbEl.style.setProperty('--cpp-glow-max',   (s.glowMax || 16) + 'px');

  if (ring) {
    ring.style.animation = `cppRing ${s.ringSpeed||1.8}s ease-out infinite`;
    ring.style.setProperty('--cpp-ring-color', cpDeriveGlowColor(s.dotColor || '#818cf8', 0.3));
  }

  if (dots) {
    dots.style.width = size;
    dots.querySelectorAll('span').forEach((d, i) => {
      d.style.background = s.dotColor || '#818cf8';
      const delay = [0, 0.18, 0.36][i];
      d.style.animation  = `cppDot ${s.dotSpeed||1.2}s ease-in-out ${delay}s infinite`;
      d.style.opacity    = '1';
    });
  }

  if (icon) {
    icon.style.color    = s.dotColor || '#818cf8';
    icon.style.fontSize = Math.round((s.orbSize || 52) * 0.42) + 'px';
    const avSrc = document.querySelector('#companion-avatar img')?.src;
    if (avSrc && !icon.querySelector('img')) {
      icon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    }
  }
}

// ── Layout toggle ─────────────────────────────────────────────────────────────
function cpSetOrbLayout(mode) {
  orb.setMode(mode);
  document.querySelectorAll('.cp-layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
}

// ── Save payload (called by companion.js cpSave()) ────────────────────────────
function _cpGetPresencePayload() {
  return {
    presence_presets:       _cpPresenceData,
    active_presence_preset: _cpActivePreset,
  };
}

// ── Color helpers (also usable by companion-mood.js) ─────────────────────────
function cpColorToHex(color) {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  return color.startsWith('#') ? color : '#818cf8';
}

function cpDeriveGlowColor(color, alpha) {
  if (color.startsWith('#')) return _hexToRgba(color, alpha);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  return color;
}

function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
