// companion-presence.js — Presence tab: presets, state editor, preview orb, layout toggle
// Loaded after companion.js. Depends on: orb.js
//
// Exports (globals used by companion.js):
//   cpPresenceInit()
//   cpPresenceReset()
//   cpPresenceRenderPresets()
//   cpPresenceRenderState(state)
//   cpPresenceSwitchState(state, btn)
//   cpPresenceSlider(id, key, val, suffix)
//   cpPresenceSetColor(channel, hex)
//   cpPresenceColorInput(channel, val)
//   cpPresenceColorPick(channel, hex)
//   cpPresenceSetAlpha(val)
//   cpPresenceToggleAnim(animId)
//   cpPresenceNewPreset()
//   cpPresenceDeletePreset(name)
//   cpSetOrbLayout(mode)
//   _cpGetPresencePayload()   — called by companion.js cpSave()
//   CP_STATE_DEFAULTS         — read by companion-mood.js when built

// ── Swatch palette ─────────────────────────────────────────────────────────
// 8 hue columns × 5 lightness rows.
// Row 0 = lightest/pastel, row 4 = deepest/rich.
const CP_SWATCHES = [
  // violet      blue        cyan        teal        green       amber       rose        neutral
  ['#c4b5fd', '#93c5fd', '#67e8f9', '#6ee7b7', '#86efac', '#fde68a', '#fda4af', '#cbd5e1'],
  ['#a78bfa', '#60a5fa', '#22d3ee', '#34d399', '#4ade80', '#fbbf24', '#fb7185', '#94a3b8'],
  ['#818cf8', '#3b82f6', '#06b6d4', '#10b981', '#22c55e', '#f59e0b', '#f43f5e', '#64748b'],
  ['#6366f1', '#2563eb', '#0891b2', '#059669', '#16a34a', '#d97706', '#e11d48', '#475569'],
  ['#4f46e5', '#1d4ed8', '#0e7490', '#047857', '#15803d', '#b45309', '#be123c', '#334155'],
];

// ── State ──────────────────────────────────────────────────────────────────
let _cpPresenceData     = {};
let _cpActivePreset     = 'Default';
let _cpEditingState     = 'thinking';
let _cpPresenceDirty    = false;
let _cpPresenceInitDone = false;

// ── Defaults ───────────────────────────────────────────────────────────────
// Color architecture: dotColor (dots+icon), edgeColor (border), effectsColor+effectsAlpha (glow+ring)
// Animation toggles default to true (enabled) — absent key = enabled.
const CP_STATE_DEFAULTS = {
  thinking:  { dotColor:'#818cf8', edgeColor:'#818cf8', effectsColor:'#818cf8', effectsAlpha:0.40, glowMax:16, glowSpeed:2.0, ringSpeed:1.8, dotSpeed:1.2, breathSpeed:3.0, orbSize:52 },
  streaming: { dotColor:'#6dd4a8', edgeColor:'#6dd4a8', effectsColor:'#6dd4a8', effectsAlpha:0.35, glowMax:12, glowSpeed:2.5, ringSpeed:2.4, dotSpeed:1.4, breathSpeed:3.0, orbSize:52 },
  heartbeat: { dotColor:'#a78bfa', edgeColor:'#a78bfa', effectsColor:'#a78bfa', effectsAlpha:0.45, glowMax:20, glowSpeed:1.4, ringSpeed:1.4, dotSpeed:0.9, breathSpeed:2.0, orbSize:52 },
  chaos:     { dotColor:'#fbbf24', edgeColor:'#fbbf24', effectsColor:'#fbbf24', effectsAlpha:0.50, glowMax:24, glowSpeed:0.8, ringSpeed:0.9, dotSpeed:0.6, breathSpeed:0.6, orbSize:52 },
  idle:      { dotColor:'#818cf8', edgeColor:'#818cf8', effectsColor:'#818cf8', effectsAlpha:0.15, glowMax:6,  glowSpeed:4.0, ringSpeed:4.0, dotSpeed:2.0, breathSpeed:5.0, orbSize:52 },
};

// ── Init / reset ───────────────────────────────────────────────────────────
function cpPresenceInit() {
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

  _cpBuildSwatches();
  _cpBuildAnimToggles();
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);

  const avSrc = document.querySelector('#companion-avatar img')?.src;
  const previewIcon = document.getElementById('cpp-icon');
  if (previewIcon && avSrc) {
    previewIcon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  }
}

function cpPresenceReset() {
  _cpPresenceInitDone = false;
}

// ── Swatch grid builder ────────────────────────────────────────────────────
// Builds the swatch grid for a given color channel container.
// Called once on init — grids are static, only active highlighting changes.
function _cpBuildSwatches() {
  ['dot', 'edge', 'effects'].forEach(channel => {
    const grid = document.getElementById(`cp-swatch-grid-${channel}`);
    if (!grid) return;
    grid.innerHTML = '';

    CP_SWATCHES.forEach(row => {
      row.forEach(hex => {
        const sw = document.createElement('div');
        sw.className    = 'cp-swatch';
        sw.style.background = hex;
        sw.dataset.hex  = hex;
        sw.title        = hex;
        sw.onclick      = () => cpPresenceSetColor(channel, hex);
        grid.appendChild(sw);
      });
    });

    // Custom swatch — overlays native color picker
    const custom = document.createElement('div');
    custom.className = 'cp-swatch cp-swatch-custom';
    custom.title = 'Custom color';
    custom.innerHTML = '✦';
    const nativePicker = document.createElement('input');
    nativePicker.type  = 'color';
    nativePicker.id    = `cp-color-picker-${channel}`;
    nativePicker.value = '#818cf8';
    nativePicker.oninput = (e) => cpPresenceColorPick(channel, e.target.value);
    custom.appendChild(nativePicker);
    grid.appendChild(custom);
  });
}

// Update active swatch highlight for a channel
function _cpUpdateSwatchActive(channel, hex) {
  const grid = document.getElementById(`cp-swatch-grid-${channel}`);
  if (!grid) return;
  const normHex = hex.toLowerCase();
  grid.querySelectorAll('.cp-swatch:not(.cp-swatch-custom)').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.hex.toLowerCase() === normHex);
  });
  // Sync native picker value in case we're restoring from data
  const picker = document.getElementById(`cp-color-picker-${channel}`);
  if (picker) picker.value = cpColorToHex(hex);
}

// ── Animation toggle builder ───────────────────────────────────────────────
// Builds animation toggle buttons from orb.ANIMATIONS registry.
// Only shows toggles relevant to the current editing state.
function _cpBuildAnimToggles() {
  const container = document.getElementById('cp-anim-toggles');
  if (!container) return;
  container.innerHTML = '';

  orb.ANIMATIONS.forEach(anim => {
    const btn = document.createElement('button');
    btn.className   = 'cp-anim-toggle active';
    btn.id          = `cp-anim-toggle-${anim.id}`;
    btn.dataset.id  = anim.id;
    btn.innerHTML   = `<span class="cp-anim-dot"></span>${anim.label}`;
    btn.onclick     = () => cpPresenceToggleAnim(anim.id);
    container.appendChild(btn);
  });
}

// Update toggle visibility and state for the current editing state
function _cpRefreshAnimToggles(stateData) {
  orb.ANIMATIONS.forEach(anim => {
    const btn = document.getElementById(`cp-anim-toggle-${anim.id}`);
    if (!btn) return;

    // Show/hide based on which states this animation applies to
    const relevant = !anim.states || anim.states.includes(_cpEditingState);
    btn.style.display = relevant ? '' : 'none';

    // Active = enabled (default true if not set)
    const enabled = stateData[anim.id] !== false;
    btn.classList.toggle('active', enabled);
  });
}

// ── Preset list ───────────────────────────────────────────────────────────
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

// ── State editor ───────────────────────────────────────────────────────────
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

  // Three independent color channels
  _cpSetColorUI('dot',     s.dotColor     || '#818cf8');
  _cpSetColorUI('edge',    s.edgeColor    || s.dotColor || '#818cf8');
  _cpSetColorUI('effects', s.effectsColor || s.dotColor || '#818cf8');

  // Alpha slider for effects channel
  const alpha    = s.effectsAlpha !== undefined ? s.effectsAlpha : 0.4;
  const alphaEl  = document.getElementById('ps-effects-alpha');
  const alphaVal = document.getElementById('ps-effects-alpha-val');
  if (alphaEl)  alphaEl.value = Math.round(alpha * 100);
  if (alphaVal) alphaVal.textContent = Math.round(alpha * 100) + '%';
  _cpUpdateAlphaGradient(s.effectsColor || s.dotColor || '#818cf8');

  // Animation toggles
  _cpRefreshAnimToggles(s);

  cpPresenceUpdatePreview(s, state);
}

// Sync a single color channel's UI (dot, swatch highlight, hex input)
function _cpSetColorUI(channel, hex) {
  const dot   = document.getElementById(`cp-color-dot-${channel}`);
  const input = document.getElementById(`cp-color-input-${channel}`);
  if (dot)   dot.style.background = hex;
  if (input) input.value = hex;
  _cpUpdateSwatchActive(channel, hex);
}

// ── Color editor ───────────────────────────────────────────────────────────
// channel: 'dot' | 'edge' | 'effects'
function cpPresenceSetColor(channel, hex) {
  _cpSetColorUI(channel, hex);
  const keyMap = { dot: 'dotColor', edge: 'edgeColor', effects: 'effectsColor' };
  cpPresenceSetValue(keyMap[channel], hex);
  if (channel === 'effects') _cpUpdateAlphaGradient(hex);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceColorInput(channel, val) {
  const hex = val.startsWith('#') ? val : '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    cpPresenceSetColor(channel, hex);
  }
}

function cpPresenceColorPick(channel, hex) {
  cpPresenceSetColor(channel, hex);
}

function cpPresenceSetAlpha(val) {
  const alpha = parseFloat(val) / 100;
  const lbl   = document.getElementById('ps-effects-alpha-val');
  if (lbl) lbl.textContent = val + '%';
  cpPresenceSetValue('effectsAlpha', alpha);

  // Update gradient track color
  const s = _cpCurrentStateData();
  _cpUpdateAlphaGradient(s.effectsColor || s.dotColor || '#818cf8');
  cpPresenceUpdatePreviewFromCurrent();
}

function _cpUpdateAlphaGradient(hex) {
  const grad = document.getElementById('cp-alpha-gradient');
  if (grad) grad.style.background = `linear-gradient(to right, transparent, ${hex})`;
}

// ── Animation toggle ───────────────────────────────────────────────────────
function cpPresenceToggleAnim(animId) {
  const s = _cpCurrentStateData();
  const currentlyEnabled = s[animId] !== false;
  cpPresenceSetValue(animId, !currentlyEnabled);
  const btn = document.getElementById(`cp-anim-toggle-${animId}`);
  if (btn) btn.classList.toggle('active', !currentlyEnabled);
  cpPresenceUpdatePreviewFromCurrent();
}

// ── Slider ─────────────────────────────────────────────────────────────────
function cpPresenceSlider(id, key, val, suffix) {
  const lbl = document.getElementById(id + '-val');
  if (lbl) lbl.textContent = val + suffix;
  cpPresenceSetValue(key, parseFloat(val));
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
}

// Helper: current state data merged with defaults
function _cpCurrentStateData() {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  return Object.assign({}, CP_STATE_DEFAULTS[_cpEditingState] || CP_STATE_DEFAULTS.thinking, preset[_cpEditingState] || {});
}

// ── Preview orb ────────────────────────────────────────────────────────────
function cpPresenceUpdatePreviewFromCurrent() {
  cpPresenceUpdatePreview(_cpCurrentStateData(), _cpEditingState);
}

function cpPresenceUpdatePreview(s, state) {
  const orbEl = document.getElementById('cpp-orb');
  const dots  = document.getElementById('cpp-dots');
  const icon  = document.getElementById('cpp-icon');
  const ring  = orbEl?.querySelector('.cpp-ring');
  if (!orbEl) return;

  const dotColor     = s.dotColor     || '#818cf8';
  const edgeColor    = s.edgeColor    || dotColor;
  const effectsColor = s.effectsColor || dotColor;
  const effectsAlpha = s.effectsAlpha !== undefined ? s.effectsAlpha : 0.4;

  const size = (s.orbSize || 52) + 'px';
  orbEl.style.width      = size;
  orbEl.style.height     = size;
  orbEl.style.background = cpDeriveGlowColor(effectsColor, 0.08);
  orbEl.style.border     = `2px solid ${cpDeriveGlowColor(edgeColor, 0.35)}`;
  orbEl.style.setProperty('--cpp-glow-color', cpDeriveGlowColor(effectsColor, effectsAlpha));
  orbEl.style.setProperty('--cpp-glow-min',   '4px');
  orbEl.style.setProperty('--cpp-glow-max',   (s.glowMax || 16) + 'px');

  // Respect animation toggles in preview
  const glowOn   = s.glowEnabled    !== false;
  const breathOn = s.breathEnabled  !== false;
  const ringOn   = s.ringEnabled    !== false;
  const dotsOn   = s.dotsEnabled    !== false;

  let bodyAnim = [];
  if (glowOn)   bodyAnim.push(`cppGlow ${s.glowSpeed||2}s ease-in-out infinite`);
  if (breathOn) bodyAnim.push(`cppBreath ${s.breathSpeed||3}s ease-in-out infinite`);
  orbEl.style.animation = bodyAnim.join(', ') || 'none';

  if (ring) {
    ring.style.setProperty('--cpp-ring-color', cpDeriveGlowColor(effectsColor, effectsAlpha * 0.75));
    ring.style.animation = ringOn ? `cppRing ${s.ringSpeed||1.8}s ease-out infinite` : 'none';
    if (!ringOn) ring.style.opacity = '0';
  }

  if (dots) {
    dots.style.width = size;
    dots.querySelectorAll('span').forEach((d, i) => {
      d.style.background = dotColor;
      if (dotsOn) {
        const delay = [0, 0.18, 0.36][i];
        d.style.animation = `cppDot ${s.dotSpeed||1.2}s ease-in-out ${delay}s infinite`;
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
}

// ── Save payload (called by companion.js cpSave()) ─────────────────────────
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
