// companion-presence.js — Presence tab: presets, state editor, preview orb, layout toggle
// Loaded after companion.js. Depends on: orb.js
//
// Exports (globals used by companion.js):
//   cpPresenceInit()
//   cpPresenceReset()
//   cpPresenceRenderPresets()
//   cpPresenceRenderState(state)
//   cpPresenceSwitchState(state, el)
//   cpPresenceToggleElement(elemId)
//   cpPresenceToggleColorPicker(elemId)
//   cpPresencePickColor(elemId, hex)
//   cpPresenceHexInput(elemId, val)
//   cpPresenceSetAlpha(elemId, val)
//   cpPresenceSlider(id, key, val, suffix)
//   cpPresenceNewPreset()
//   cpPresenceDeletePreset(name)
//   cpSetOrbLayout(mode)
//   _cpGetPresencePayload()   — called by companion.js cpSave()
//   CP_STATE_DEFAULTS         — read by companion-mood.js when built

// ── Swatch palette ─────────────────────────────────────────────────────────
// 8 hue columns × 5 lightness rows. Row 0 = lightest, row 4 = deepest.
const CP_SWATCHES = [
  ['#c4b5fd', '#93c5fd', '#67e8f9', '#6ee7b7', '#86efac', '#fde68a', '#fda4af', '#cbd5e1'],
  ['#a78bfa', '#60a5fa', '#22d3ee', '#34d399', '#4ade80', '#fbbf24', '#fb7185', '#94a3b8'],
  ['#818cf8', '#3b82f6', '#06b6d4', '#10b981', '#22c55e', '#f59e0b', '#f43f5e', '#64748b'],
  ['#6366f1', '#2563eb', '#0891b2', '#059669', '#16a34a', '#d97706', '#e11d48', '#475569'],
  ['#4f46e5', '#1d4ed8', '#0e7490', '#047857', '#15803d', '#b45309', '#be123c', '#334155'],
];

// ── Element definitions ────────────────────────────────────────────────────
// Each element maps to a group in the accordion. The 'colorKey' is the
// data field for the color pip. 'alphaKey' is the optional alpha field.
// 'sliders' are the speed/size controls shown inside the expanded body.
// 'animId' is the animation toggle id from orb.ANIMATIONS (if any).
const CP_ELEMENTS = [
  {
    id:       'orb',
    label:    'Orb',
    colorKey: 'edgeColor',
    alphaKey: null,
    animId:   'breathEnabled',
    sliders:  [
      { id: 'ps-orb-size',    key: 'orbSize',     min: 32, max: 80,  step: 1,   suffix: 'px', label: 'Size' },
      { id: 'ps-breath-speed', key: 'breathSpeed', min: 0.4, max: 7, step: 0.1, suffix: 's',  label: 'Breath speed' },
    ],
  },
  {
    id:       'dots',
    label:    'Dots',
    colorKey: 'dotColor',
    alphaKey: null,
    animId:   'dotsEnabled',
    sliders:  [
      { id: 'ps-dot-speed', key: 'dotSpeed', min: 0.3, max: 3, step: 0.1, suffix: 's', label: 'Speed' },
    ],
  },
  {
    id:       'glow',
    label:    'Glow',
    colorKey: 'glowColor',
    alphaKey: 'glowAlpha',
    animId:   'glowEnabled',
    sliders:  [
      { id: 'ps-glow-max',   key: 'glowMax',   min: 4,   max: 36, step: 1,   suffix: 'px', label: 'Intensity' },
      { id: 'ps-glow-speed', key: 'glowSpeed', min: 0.4, max: 6,  step: 0.1, suffix: 's',  label: 'Speed' },
    ],
  },
  {
    id:       'ring',
    label:    'Ring',
    colorKey: 'ringColor',
    alphaKey: 'ringAlpha',
    animId:   'ringEnabled',
    sliders:  [
      { id: 'ps-ring-speed', key: 'ringSpeed', min: 0.4, max: 5, step: 0.1, suffix: 's', label: 'Speed' },
    ],
  },
];

// ── State ──────────────────────────────────────────────────────────────────
let _cpPresenceData     = {};
let _cpActivePreset     = 'Default';
let _cpEditingState     = 'thinking';
let _cpPresenceDirty    = false;
let _cpPresenceInitDone = false;

// ── Defaults ───────────────────────────────────────────────────────────────
// glowColor/ringColor are now independent. Ring defaults to slightly more
// transparent so the glow feels dominant by default.
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

  // Sync layout toggle
  const currentMode = localStorage.getItem('orb_layout') || 'inline';
  document.querySelectorAll('.cp-layout-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === currentMode));

  // Build element accordion bodies (DOM structure)
  _cpBuildElementBodies();

  // Render preset chips + select active
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);

  // Mirror avatar into preview
  const avSrc = document.querySelector('#companion-avatar img')?.src;
  const previewIcon = document.getElementById('cpp-icon');
  if (previewIcon && avSrc) {
    previewIcon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  }
}

function cpPresenceReset() {
  _cpPresenceInitDone = false;
}

// ── Element accordion body builder ────────────────────────────────────────
// Injects the inner HTML for each element's body, including swatch grid,
// hex input, optional alpha slider, and speed sliders. Called once on init.
function _cpBuildElementBodies() {
  CP_ELEMENTS.forEach(elem => {
    const body = document.getElementById(`cp-elem-body-${elem.id}`);
    if (!body || body.dataset.built) return;

    let html = '';

    // Color picker section (collapsed by default — toggled by cpPresenceToggleColorPicker)
    html += `
      <div class="cp-color-picker-wrap" id="cp-picker-wrap-${elem.id}">
        <div class="cp-picker-header" onclick="cpPresenceToggleColorPicker('${elem.id}')">
          <div class="cp-picker-sq" id="cp-picker-sq-${elem.id}"></div>
          <span class="cp-picker-hex" id="cp-picker-hex-${elem.id}"></span>
          <span class="cp-picker-arr">▶</span>
        </div>
        <div class="cp-picker-body" id="cp-picker-body-${elem.id}">
          <div class="cp-swatch-grid" id="cp-swatch-grid-${elem.id}"></div>
          <div class="cp-color-input-row">
            <input class="cp-color-input" id="cp-color-input-${elem.id}" type="text" maxlength="7"
              oninput="cpPresenceHexInput('${elem.id}', this.value)" placeholder="#818cf8"/>
          </div>`;

    if (elem.alphaKey) {
      html += `
          <div class="cp-alpha-row">
            <span class="cp-alpha-lbl">Opacity</span>
            <div class="cp-alpha-track">
              <div class="cp-alpha-gradient" id="cp-alpha-gradient-${elem.id}"></div>
              <input class="cp-alpha-slider" type="range" id="cp-alpha-slider-${elem.id}"
                min="0" max="100" step="1"
                oninput="cpPresenceSetAlpha('${elem.id}', this.value)"/>
            </div>
            <span class="cp-alpha-val" id="cp-alpha-val-${elem.id}">40%</span>
          </div>`;
    }

    html += `
        </div>
      </div>`;

    // Speed sliders
    elem.sliders.forEach(sl => {
      html += `
      <div class="cp-slider-row">
        <span class="cp-slider-lbl">${sl.label}</span>
        <input class="cp-slider" type="range" id="${sl.id}"
          min="${sl.min}" max="${sl.max}" step="${sl.step}"
          oninput="cpPresenceSlider('${sl.id}','${sl.key}',this.value,'${sl.suffix}')"/>
        <span class="cp-slider-val" id="${sl.id}-val">—</span>
      </div>`;
    });

    body.innerHTML = html;
    body.dataset.built = '1';

    // Build swatch grid
    _cpBuildSwatchGrid(elem.id);
  });
}

function _cpBuildSwatchGrid(elemId) {
  const grid = document.getElementById(`cp-swatch-grid-${elemId}`);
  if (!grid || grid.children.length) return;

  CP_SWATCHES.forEach(row => {
    row.forEach(hex => {
      const sw = document.createElement('div');
      sw.className        = 'cp-swatch';
      sw.style.background = hex;
      sw.dataset.hex      = hex;
      sw.title            = hex;
      sw.onclick          = () => cpPresencePickColor(elemId, hex);
      grid.appendChild(sw);
    });
  });

  // Custom swatch with native color picker overlay
  const custom = document.createElement('div');
  custom.className = 'cp-swatch cp-swatch-custom';
  custom.title     = 'Custom color';
  custom.innerHTML = '✦';
  const native = document.createElement('input');
  native.type    = 'color';
  native.value   = '#818cf8';
  native.oninput = (e) => cpPresencePickColor(elemId, e.target.value);
  custom.appendChild(native);
  grid.appendChild(custom);
}

// ── Accordion toggle ───────────────────────────────────────────────────────
function cpPresenceToggleElement(elemId) {
  const el = document.getElementById(`cp-elem-${elemId}`);
  if (!el) return;
  el.classList.toggle('open');
}

function cpPresenceToggleColorPicker(elemId) {
  const wrap = document.getElementById(`cp-picker-wrap-${elemId}`);
  if (!wrap) return;
  wrap.classList.toggle('open');
  if (wrap.classList.contains('open')) _cpBuildSwatchGrid(elemId);
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

  // + New button
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

// ── State selector ─────────────────────────────────────────────────────────
function cpPresenceSwitchState(state, el) {
  _cpEditingState = state;
  document.querySelectorAll('.cp-state-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  const lbl = document.getElementById('cpp-state-label');
  if (lbl) lbl.textContent = state;
  cpPresenceRenderState(state);
}

// ── Render state into all controls ────────────────────────────────────────
function cpPresenceRenderState(state) {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  const s = Object.assign({}, CP_STATE_DEFAULTS[state] || CP_STATE_DEFAULTS.thinking, preset[state] || {});

  CP_ELEMENTS.forEach(elem => {
    const hex   = s[elem.colorKey] || '#818cf8';
    const alpha = elem.alphaKey ? (s[elem.alphaKey] !== undefined ? s[elem.alphaKey] : 0.4) : null;

    // Update header pip + hex
    _cpSetElemHeaderColor(elem.id, hex, alpha);

    // Update picker square + hex input
    const sq  = document.getElementById(`cp-picker-sq-${elem.id}`);
    const inp = document.getElementById(`cp-color-input-${elem.id}`);
    const phx = document.getElementById(`cp-picker-hex-${elem.id}`);
    if (sq)  sq.style.background = hex;
    if (inp) inp.value            = hex;
    if (phx) phx.textContent      = hex;

    // Update swatch highlight
    _cpUpdateSwatchActive(elem.id, hex);

    // Update native picker
    const native = document.querySelector(`#cp-swatch-grid-${elem.id} input[type="color"]`);
    if (native) native.value = cpColorToHex(hex);

    // Update alpha slider
    if (elem.alphaKey && alpha !== null) {
      const pct  = Math.round(alpha * 100);
      const sl   = document.getElementById(`cp-alpha-slider-${elem.id}`);
      const val  = document.getElementById(`cp-alpha-val-${elem.id}`);
      const grad = document.getElementById(`cp-alpha-gradient-${elem.id}`);
      if (sl)   sl.value          = pct;
      if (val)  val.textContent   = pct + '%';
      if (grad) grad.style.background = `linear-gradient(to right, transparent, ${hex})`;
    }

    // Update sliders
    elem.sliders.forEach(sl => {
      const el  = document.getElementById(sl.id);
      const lbl = document.getElementById(sl.id + '-val');
      if (el)  el.value         = s[sl.key];
      if (lbl) lbl.textContent  = s[sl.key] + sl.suffix;
    });

    // Update animation toggle on the element header
    const animId  = elem.animId;
    const enabled = animId ? s[animId] !== false : true;
    const togEl   = document.getElementById(`cp-elem-tog-${elem.id}`);
    if (togEl) {
      togEl.classList.toggle('on', enabled);
      togEl.classList.toggle('off', !enabled);
    }

    // Dots element: hide if state has no dots
    const elemRow = document.getElementById(`cp-elem-${elem.id}`);
    if (elemRow && elem.id === 'dots') {
      const hasDots = !orb.ANIMATIONS.find(a => a.id === 'dotsEnabled')?.states ||
                       orb.ANIMATIONS.find(a => a.id === 'dotsEnabled').states.includes(state);
      elemRow.style.opacity = hasDots ? '' : '0.4';
    }
  });

  cpPresenceUpdatePreview(s, state);
}

// Update the header-level color pip and hex display for an element row
function _cpSetElemHeaderColor(elemId, hex, alpha) {
  const pip  = document.getElementById(`cp-elem-pip-${elemId}`);
  const hexL = document.getElementById(`cp-elem-hex-${elemId}`);
  const alpL = document.getElementById(`cp-elem-alpha-${elemId}`);
  if (pip)  pip.style.background = hex;
  if (hexL) hexL.textContent     = hex;
  if (alpL) alpL.textContent     = alpha !== null ? Math.round(alpha * 100) + '%' : '';
}

function _cpUpdateSwatchActive(elemId, hex) {
  const grid = document.getElementById(`cp-swatch-grid-${elemId}`);
  if (!grid) return;
  const norm = hex.toLowerCase();
  grid.querySelectorAll('.cp-swatch:not(.cp-swatch-custom)').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.hex?.toLowerCase() === norm);
  });
}

// ── Color editing ──────────────────────────────────────────────────────────
function cpPresencePickColor(elemId, hex) {
  const elem = CP_ELEMENTS.find(e => e.id === elemId);
  if (!elem) return;

  _cpSetElemHeaderColor(elemId, hex, null);
  const sq  = document.getElementById(`cp-picker-sq-${elemId}`);
  const inp = document.getElementById(`cp-color-input-${elemId}`);
  const phx = document.getElementById(`cp-picker-hex-${elemId}`);
  if (sq)  sq.style.background = hex;
  if (inp) inp.value            = hex;
  if (phx) phx.textContent      = hex;

  _cpUpdateSwatchActive(elemId, hex);

  const grad = document.getElementById(`cp-alpha-gradient-${elemId}`);
  if (grad) grad.style.background = `linear-gradient(to right, transparent, ${hex})`;

  // Re-read alpha from current state to preserve it
  const s = _cpCurrentStateData();
  if (elem.alphaKey) {
    const alpha = s[elem.alphaKey] !== undefined ? s[elem.alphaKey] : 0.4;
    _cpSetElemHeaderColor(elemId, hex, alpha);
  }

  cpPresenceSetValue(elem.colorKey, hex);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceHexInput(elemId, val) {
  const hex = val.startsWith('#') ? val : '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) cpPresencePickColor(elemId, hex);
}

function cpPresenceSetAlpha(elemId, val) {
  const elem = CP_ELEMENTS.find(e => e.id === elemId);
  if (!elem?.alphaKey) return;

  const alpha = parseFloat(val) / 100;
  const lbl   = document.getElementById(`cp-alpha-val-${elemId}`);
  if (lbl) lbl.textContent = val + '%';

  // Update header alpha pill
  const s   = _cpCurrentStateData();
  const hex = s[elem.colorKey] || '#818cf8';
  _cpSetElemHeaderColor(elemId, hex, alpha);

  cpPresenceSetValue(elem.alphaKey, alpha);
  cpPresenceUpdatePreviewFromCurrent();
}

// ── Animation toggle (on the element header) ───────────────────────────────
function cpPresenceToggleAnim(elemId) {
  const elem = CP_ELEMENTS.find(e => e.id === elemId);
  if (!elem?.animId) return;
  const s       = _cpCurrentStateData();
  const enabled = s[elem.animId] !== false;
  cpPresenceSetValue(elem.animId, !enabled);
  const tog = document.getElementById(`cp-elem-tog-${elemId}`);
  if (tog) {
    tog.classList.toggle('on',  !enabled);
    tog.classList.toggle('off', enabled);
  }
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

function _cpCurrentStateData() {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  return Object.assign(
    {},
    CP_STATE_DEFAULTS[_cpEditingState] || CP_STATE_DEFAULTS.thinking,
    preset[_cpEditingState] || {}
  );
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

  const dotColor  = s.dotColor  || '#818cf8';
  const edgeColor = s.edgeColor || dotColor;
  const glowColor = s.glowColor || dotColor;
  const ringColor = s.ringColor || glowColor;
  const glowAlpha = s.glowAlpha !== undefined ? s.glowAlpha : 0.4;
  const ringAlpha = s.ringAlpha !== undefined ? s.ringAlpha : 0.3;

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
    if (!ringOn) ring.style.opacity = '0';
    else         ring.style.opacity = '';
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
