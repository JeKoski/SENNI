// orb.js — Companion orb module
// Owns: state, avatar, presence presets, mood blending, layout mode,
//       animation registry.
//
// Public API:
//   orb.init()
//   orb.setState(state)
//   orb.applyPreset(preset, mood?)
//   orb.syncAvatar()
//   orb.setMode(mode)        — 'inline' | 'strip'
//   orb.ANIMATIONS           — registry, read by companion-presence.js / companion-mood.js

const orb = (() => {

  // ── Internal state ────────────────────────────────────────────────────────
  let _state      = 'idle';
  let _presetData = null;   // { thinking:{...}, streaming:{...}, ... }
  let _moodData   = null;

  const BASE_STATES = ['idle', 'thinking', 'streaming', 'heartbeat', 'chaos'];

  function _el()   { return document.getElementById('companion-orb'); }
  function _msgs() { return document.getElementById('messages'); }

  // ── Animation registry ────────────────────────────────────────────────────
  // Each entry describes one toggleable animation effect.
  // Adding a new animation: add an entry here — the UI generates automatically.
  //
  // Fields:
  //   id          — key stored in preset data (e.g. 'glowEnabled')
  //   label       — display name in the UI
  //   target      — which CSS animations this toggle controls (for reference)
  //   states      — which orb states show this toggle (null = all states)
  const ANIMATIONS = [
    {
      id:     'glowEnabled',
      label:  'Glow',
      target: 'orbGlow',
      states: null,
    },
    {
      id:     'breathEnabled',
      label:  'Breathing',
      target: 'orbBreath',
      states: null,
    },
    {
      id:     'ringEnabled',
      label:  'Ring pulse',
      target: 'ringPulse',
      states: null,
    },
    {
      id:     'dotsEnabled',
      label:  'Dots',
      target: 'dotBounce / dotStream',
      states: ['thinking', 'streaming', 'heartbeat', 'chaos'],
    },
  ];

  // ── Color architecture ────────────────────────────────────────────────────
  // Three independent color properties per state:
  //   dotColor     — dots above orb + icon tint             (hex)
  //   edgeColor    — orb border                             (hex)
  //   effectsColor — glow box-shadow + ring                 (hex)
  //   effectsAlpha — glow/ring opacity multiplier           (0–1, default 0.4)
  //
  // Legacy single-color presets (glowColor/dotColor only) are still supported
  // via _migrateLegacyState() — they're upgraded on read, never on write.

  function _migrateLegacyState(s) {
    // If a state only has the old glowColor+dotColor, synthesise the new fields
    if (!s.edgeColor) {
      s.edgeColor = s.dotColor || '#818cf8';
    }
    if (!s.effectsColor) {
      // Reverse-derive hex from old glowColor rgba if possible
      if (s.glowColor) {
        const m = s.glowColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
          s.effectsColor = '#' + [m[1],m[2],m[3]].map(n =>
            parseInt(n).toString(16).padStart(2,'0')).join('');
          if (!s.effectsAlpha) s.effectsAlpha = 0.4;
        }
      }
      if (!s.effectsColor) s.effectsColor = s.dotColor || '#818cf8';
    }
    if (s.effectsAlpha === undefined) s.effectsAlpha = 0.4;
    return s;
  }

  // ── Presence: build CSS var overrides for a given state ───────────────────
  function _buildOverrides(state) {
    const overrides = {};
    const presenceState = _presetData?.[state] || {};
    _applyDataToOverrides(_migrateLegacyState({...presenceState}), overrides);

    // Mood is additive — only apply enabled properties
    if (_moodData) {
      const mood = {..._moodData};
      _applyMoodToOverrides(mood, overrides);
    }
    return overrides;
  }

  function _applyDataToOverrides(data, overrides) {
    const dotColor     = data.dotColor     || '#818cf8';
    const edgeColor    = data.edgeColor    || dotColor;
    const effectsColor = data.effectsColor || dotColor;
    const effectsAlpha = data.effectsAlpha !== undefined ? data.effectsAlpha : 0.4;

    const effectsRgba  = _hexToRgba(effectsColor, effectsAlpha);
    const edgeRgba     = _hexToRgba(edgeColor, 0.35);
    const bgRgba       = _hexToRgba(effectsColor, 0.08);

    overrides['--dot-color']    = dotColor;
    overrides['--orb-border']   = edgeRgba;
    overrides['--orb-bg']       = bgRgba;
    overrides['--glow-color']   = effectsRgba;
    overrides['--ring-color']   = _hexToRgba(effectsColor, effectsAlpha * 0.75);

    if (data.glowMax)     overrides['--glow-max']     = data.glowMax + 'px';
    if (data.glowSpeed)   overrides['--glow-speed']   = data.glowSpeed + 's';
    if (data.ringSpeed)   overrides['--ring-speed']   = data.ringSpeed + 's';
    if (data.dotSpeed)    overrides['--dot-speed']    = data.dotSpeed + 's';
    if (data.breathSpeed) overrides['--breath-speed'] = data.breathSpeed + 's';
    if (data.orbSize) {
      const px = data.orbSize + 'px';
      overrides['--orb-size'] = px;
      document.documentElement.style.setProperty('--orb-size', px);
    }

    // Animation toggles — each defaults to enabled (true) if not set
    ANIMATIONS.forEach(anim => {
      const enabled = data[anim.id] !== false; // undefined → enabled
      overrides['--anim-' + anim.id] = enabled ? '1' : '0';
    });
  }

  // Mood override — only applies properties that have their _enabled flag set
  function _applyMoodToOverrides(mood, overrides) {
    if (!mood._enabled) return;

    if (mood._enabled.dotColor     && mood.dotColor)     overrides['--dot-color']  = mood.dotColor;
    if (mood._enabled.edgeColor    && mood.edgeColor)    overrides['--orb-border'] = _hexToRgba(mood.edgeColor, 0.35);
    if (mood._enabled.effectsColor && mood.effectsColor) {
      const alpha = mood.effectsAlpha !== undefined ? mood.effectsAlpha : 0.4;
      overrides['--glow-color']  = _hexToRgba(mood.effectsColor, alpha);
      overrides['--ring-color']  = _hexToRgba(mood.effectsColor, alpha * 0.75);
      overrides['--orb-bg']      = _hexToRgba(mood.effectsColor, 0.08);
    }
    if (mood._enabled.glowMax     && mood.glowMax     !== undefined) overrides['--glow-max']     = mood.glowMax + 'px';
    if (mood._enabled.glowSpeed   && mood.glowSpeed   !== undefined) overrides['--glow-speed']   = mood.glowSpeed + 's';
    if (mood._enabled.ringSpeed   && mood.ringSpeed   !== undefined) overrides['--ring-speed']   = mood.ringSpeed + 's';
    if (mood._enabled.dotSpeed    && mood.dotSpeed    !== undefined) overrides['--dot-speed']    = mood.dotSpeed + 's';
    if (mood._enabled.breathSpeed && mood.breathSpeed !== undefined) overrides['--breath-speed'] = mood.breathSpeed + 's';
    if (mood._enabled.orbSize     && mood.orbSize     !== undefined) {
      const px = mood.orbSize + 'px';
      overrides['--orb-size'] = px;
      document.documentElement.style.setProperty('--orb-size', px);
    }

    ANIMATIONS.forEach(anim => {
      if (mood._enabled[anim.id] && mood[anim.id] !== undefined) {
        overrides['--anim-' + anim.id] = mood[anim.id] ? '1' : '0';
      }
    });
  }

  function _apply(orbEl, state, overrides) {
    if (!orbEl) return;
    orbEl.classList.remove(...BASE_STATES);
    orbEl.classList.add(BASE_STATES.includes(state) ? state : 'thinking');
    Object.entries(overrides).forEach(([prop, val]) => {
      orbEl.style.setProperty(prop.startsWith('--') ? prop : '--' + prop, val);
    });
    // Set data attributes so CSS animation toggle rules can target them
    // data-no-glow, data-no-breath, data-no-ring, data-no-dots
    ANIMATIONS.forEach(anim => {
      const enabled = overrides['--anim-' + anim.id] !== '0';
      const attr    = 'data-no-' + anim.id.replace('Enabled', '').toLowerCase();
      if (enabled) {
        orbEl.removeAttribute(attr);
      } else {
        orbEl.setAttribute(attr, '');
      }
    });
  }

  // ── Public: init ──────────────────────────────────────────────────────────
  function init() {
    const saved = localStorage.getItem('orb_layout') || 'inline';
    _setModeClass(saved);

    const orbEl = _el();
    if (!orbEl) return;
    _apply(orbEl, 'idle', {});
    syncAvatar();

    const msgs = _msgs();
    if (msgs) {
      msgs.addEventListener('scroll', () => {
        const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
        document.body.classList.toggle('chat-scrolled-up', !atBottom);
      });
    }
  }

  // ── Public: setState ──────────────────────────────────────────────────────
  function setState(state) {
    _state = state;
    _apply(_el(), state, _buildOverrides(state));
  }

  // ── Public: applyPreset ───────────────────────────────────────────────────
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

  // ── Public: syncAvatar ────────────────────────────────────────────────────
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

  // ── Public: setMode ───────────────────────────────────────────────────────
  function setMode(mode) {
    localStorage.setItem('orb_layout', mode);
    _setModeClass(mode);
  }

  function _setModeClass(mode) {
    document.body.classList.toggle('orb-inline', mode === 'inline');
    document.body.classList.toggle('orb-strip',  mode === 'strip');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return `rgba(129,140,248,${alpha})`;
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return { init, setState, applyPreset, syncAvatar, setMode, ANIMATIONS };

})();
