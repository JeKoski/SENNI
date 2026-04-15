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
  let _presetData = null;
  let _moodData   = null;

  const BASE_STATES = ['idle', 'thinking', 'streaming', 'heartbeat', 'chaos'];

  function _el()   { return document.getElementById('companion-orb'); }
  function _msgs() { return document.getElementById('messages'); }

  // ── Animation registry ────────────────────────────────────────────────────
  // Each entry describes one toggleable animation effect.
  // Adding a new animation: add an entry here — UI generates automatically.
  //
  // Fields:
  //   id     — key stored in preset data (e.g. 'glowEnabled')
  //   label  — display name in UI
  //   target — CSS animations this controls (reference only)
  //   states — which orb states show this toggle (null = all)
  const ANIMATIONS = [
    { id: 'glowEnabled',    label: 'Glow',       target: 'orbGlow',              states: null },
    { id: 'breathEnabled',  label: 'Breathing',  target: 'orbBreath',            states: null },
    { id: 'ringEnabled',    label: 'Ring pulse',  target: 'ringPulse',            states: null },
    { id: 'dotsEnabled',    label: 'Dots',        target: 'dotBounce/dotStream',  states: ['thinking', 'streaming', 'heartbeat', 'chaos'] },
  ];

  // ── Color architecture ────────────────────────────────────────────────────
  // Five independent color/alpha properties per state:
  //   dotColor    — dots + icon tint           (hex)
  //   edgeColor   — orb border                 (hex)
  //   glowColor   — glow box-shadow            (hex)
  //   glowAlpha   — glow opacity               (0–1, default 0.4)
  //   ringColor   — ring pulse color           (hex, fully independent from glow)
  //   ringAlpha   — ring opacity               (0–1, default 0.3)
  //
  // Legacy formats are migrated on read via _migrateLegacyState():
  //   effectsColor/effectsAlpha (intermediate) → glowColor/ringColor split
  //   old single glowColor rgba string         → dotColor fallback

  function _migrateLegacyState(s) {
    // effectsColor (intermediate format from earlier this session) → split
    if (s.effectsColor && !s.glowColor) {
      s.glowColor = s.effectsColor;
      if (!s.ringColor) s.ringColor = s.effectsColor;
    }
    if (s.effectsAlpha !== undefined) {
      if (s.glowAlpha === undefined) s.glowAlpha = s.effectsAlpha;
      if (s.ringAlpha === undefined) s.ringAlpha = Math.min(s.effectsAlpha * 0.75, 1);
    }

    // Fill any still-missing fields
    const base = s.dotColor || '#818cf8';
    if (!s.edgeColor)             s.edgeColor  = base;
    if (!s.glowColor)             s.glowColor  = base;
    if (!s.ringColor)             s.ringColor  = s.glowColor;
    if (s.glowAlpha === undefined) s.glowAlpha = 0.4;
    if (s.ringAlpha === undefined) s.ringAlpha = 0.3;

    return s;
  }

  // ── Presence: build CSS var overrides for a given state ───────────────────
  function _buildOverrides(state) {
    const overrides = {};
    const presenceState = _presetData?.[state] || {};
    _applyDataToOverrides(_migrateLegacyState({...presenceState}), overrides);
    if (_moodData) _applyMoodToOverrides({..._moodData}, overrides);
    return overrides;
  }

  function _applyDataToOverrides(data, overrides) {
    const dotColor  = data.dotColor  || '#818cf8';
    const edgeColor = data.edgeColor || dotColor;
    const glowColor = data.glowColor || dotColor;
    const ringColor = data.ringColor || glowColor;
    const glowAlpha = data.glowAlpha !== undefined ? data.glowAlpha : 0.4;
    const ringAlpha = data.ringAlpha !== undefined ? data.ringAlpha : 0.3;

    overrides['--dot-color']  = dotColor;
    overrides['--orb-border'] = _hexToRgba(edgeColor, 0.35);
    overrides['--orb-bg']     = _hexToRgba(glowColor, 0.08);
    overrides['--glow-color'] = _hexToRgba(glowColor, glowAlpha);
    overrides['--ring-color'] = _hexToRgba(ringColor, ringAlpha);

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

    ANIMATIONS.forEach(anim => {
      overrides['--anim-' + anim.id] = data[anim.id] !== false ? '1' : '0';
    });
  }

  function _applyMoodToOverrides(mood, overrides) {
    if (!mood._enabled) return;
    if (mood._enabled.dotColor  && mood.dotColor)  overrides['--dot-color']  = mood.dotColor;
    if (mood._enabled.edgeColor && mood.edgeColor) overrides['--orb-border'] = _hexToRgba(mood.edgeColor, 0.35);
    if (mood._enabled.glowColor && mood.glowColor) {
      const a = mood.glowAlpha !== undefined ? mood.glowAlpha : 0.4;
      overrides['--glow-color'] = _hexToRgba(mood.glowColor, a);
      overrides['--orb-bg']     = _hexToRgba(mood.glowColor, 0.08);
    }
    if (mood._enabled.ringColor && mood.ringColor) {
      const a = mood.ringAlpha !== undefined ? mood.ringAlpha : 0.3;
      overrides['--ring-color'] = _hexToRgba(mood.ringColor, a);
    }
    const numKeys = ['glowMax','glowSpeed','ringSpeed','dotSpeed','breathSpeed'];
    const cssKeys = ['--glow-max','--glow-speed','--ring-speed','--dot-speed','--breath-speed'];
    const sfxKeys = ['px','s','s','s','s'];
    numKeys.forEach((k, i) => {
      if (mood._enabled[k] && mood[k] !== undefined) overrides[cssKeys[i]] = mood[k] + sfxKeys[i];
    });
    if (mood._enabled.orbSize && mood.orbSize !== undefined) {
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
    // Propagate color vars to :root so other elements (e.g. sidebar avatar
    // border) can consume them without being inside the orb subtree.
    ['--orb-border', '--glow-color'].forEach(prop => {
      if (prop in overrides) document.documentElement.style.setProperty(prop, overrides[prop]);
    });
    ANIMATIONS.forEach(anim => {
      const attr = 'data-no-' + anim.id.replace('Enabled', '').toLowerCase();
      if (overrides['--anim-' + anim.id] === '0') {
        orbEl.setAttribute(attr, '');
      } else {
        orbEl.removeAttribute(attr);
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
  // mood argument:
  //   omitted / KEEP_MOOD — preserve whatever _moodData is already set
  //   null               — explicitly clear the mood layer
  //   object             — set a new mood
  const KEEP_MOOD = Symbol('keep');
  function applyPreset(preset, mood = KEEP_MOOD) {
    if (!preset) return;
    if (mood !== KEEP_MOOD) _moodData = mood || null;
    if (preset.state || preset.glowColor || preset.dotColor) {
      const targetState = preset.state || _state;
      if (!_presetData) _presetData = {};
      _presetData[targetState] = preset;
      setState(targetState);
      return;
    }
    _presetData = preset;
    setState(_state);
  }

  // ── Public: setAvatar ─────────────────────────────────────────────────────
  // Set orb avatar directly from a URL — used when orb has its own crop.
  function setAvatar(src) {
    const icon = document.getElementById('orb-icon');
    if (!icon) return;
    if (src) {
      icon.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    } else {
      icon.textContent = '✦';
    }
  }

  // ── Public: syncAvatar ────────────────────────────────────────────────────
  // Sync orb avatar from the sidebar #companion-avatar element.
  // Used on page load when separate orb URL is not yet known.
  function syncAvatar() {
    const src = document.querySelector('#companion-avatar img')?.src;
    setAvatar(src || '');
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

  function _hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return `rgba(129,140,248,${alpha})`;
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return { init, setState, applyPreset, setAvatar, syncAvatar, setMode, ANIMATIONS };

})();
