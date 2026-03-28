// orb.js — Companion orb module
// Owns: state, avatar, presence presets, mood blending, layout mode.
// No slot logic — companion bubbles are indented via CSS to align with the orb.
//
// Public API:
//   orb.init()
//   orb.setState(state)
//   orb.applyPreset(preset, mood?)
//   orb.syncAvatar()
//   orb.setMode(mode)   — 'inline' | 'strip'

const orb = (() => {

  // ── Internal state ────────────────────────────────────────────────────────
  let _state      = 'idle';
  let _presetData = null;   // { thinking:{...}, streaming:{...}, ... }
  let _moodData   = null;

  const BASE_STATES = ['idle', 'thinking', 'streaming', 'heartbeat', 'chaos'];

  function _el()   { return document.getElementById('companion-orb'); }
  function _msgs() { return document.getElementById('messages'); }

  // ── Presence: build CSS var overrides for a given state ───────────────────
  function _buildOverrides(state) {
    const overrides = {};
    _applyDataToOverrides(_presetData?.[state] || {}, overrides);
    if (_moodData) _applyDataToOverrides(_moodData, overrides);
    return overrides;
  }

  function _applyDataToOverrides(data, overrides) {
    if (data.glowColor)   overrides['--glow-color']   = data.glowColor;
    if (data.glowMax)     overrides['--glow-max']      = data.glowMax + 'px';
    if (data.glowSpeed)   overrides['--glow-speed']    = data.glowSpeed + 's';
    if (data.ringSpeed)   overrides['--ring-speed']    = data.ringSpeed + 's';
    if (data.dotColor)    overrides['--dot-color']     = data.dotColor;
    if (data.dotSpeed)    overrides['--dot-speed']     = data.dotSpeed + 's';
    if (data.breathSpeed) overrides['--breath-speed']  = data.breathSpeed + 's';
    if (data.orbSize) {
      const px = data.orbSize + 'px';
      overrides['--orb-size'] = px;
      // Keep :root in sync so companion bubble indent tracks orb size
      document.documentElement.style.setProperty('--orb-size', px);
    }
  }

  function _apply(orbEl, state, overrides) {
    if (!orbEl) return;
    orbEl.classList.remove(...BASE_STATES);
    orbEl.classList.add(BASE_STATES.includes(state) ? state : 'thinking');
    Object.entries(overrides).forEach(([prop, val]) => {
      orbEl.style.setProperty(prop.startsWith('--') ? prop : '--' + prop, val);
    });
  }

  // ── Public: init ─────────────────────────────────────────────────────────
  function init() {
    const saved = localStorage.getItem('orb_layout') || 'inline';
    _setModeClass(saved);

    const orbEl = _el();
    if (!orbEl) return;
    _apply(orbEl, 'idle', {});
    syncAvatar();

    // Scroll listener — shows scroll-to-bottom button when not at bottom
    const msgs = _msgs();
    if (msgs) {
      msgs.addEventListener('scroll', () => {
        const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
        document.body.classList.toggle('chat-scrolled-up', !atBottom);
      });
    }
  }

  // ── Public: setState ─────────────────────────────────────────────────────
  function setState(state) {
    _state = state;
    _apply(_el(), state, _buildOverrides(state));
  }

  // ── Public: applyPreset ──────────────────────────────────────────────────
  function applyPreset(preset, mood = null) {
    if (!preset) return;
    _moodData = mood || null;

    // Legacy flat format: { state:'idle', glowColor:..., ... }
    if (preset.state || preset.glowColor || preset.dotColor) {
      const targetState = preset.state || _state;
      if (!_presetData) _presetData = {};
      _presetData[targetState] = preset;
      setState(targetState);
      return;
    }

    // Full nested format: { thinking:{...}, idle:{...}, ... }
    _presetData = preset;
    setState(_state);
  }

  // ── Public: syncAvatar ───────────────────────────────────────────────────
  function syncAvatar() {
    const src  = document.querySelector('#companion-avatar img')?.src;
    const icon = document.getElementById('orb-icon');
    if (!icon) return;
    if (src) {
      icon.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    } else {
      icon.textContent = '✦';
    }
  }

  // ── Public: setMode ──────────────────────────────────────────────────────
  function setMode(mode) {
    localStorage.setItem('orb_layout', mode);
    _setModeClass(mode);
  }

  function _setModeClass(mode) {
    document.body.classList.toggle('orb-inline', mode === 'inline');
    document.body.classList.toggle('orb-strip',  mode === 'strip');
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return { init, setState, applyPreset, syncAvatar, setMode };

})();
