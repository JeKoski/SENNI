/* mood-pill.js — Mood pill UI
   Shows the active mood name next to the orb, right side, bottom-aligned.

   DOM: #mood-pill sits inside #orb-home, as a sibling of #companion-orb.
   The pill is driven entirely by moodPill.update(moodName, dotColor, edgeColor)
   called from whoever sets active mood (companion.js / status poll).

   Visibility modes (stored in companion config as mood_pill_visibility):
     "always" — visible whenever a non-Neutral/non-null mood is active
     "fade"   — fades in on mood change, fades out after FADE_HOLD_MS
     "hide"   — never shown

   Per-mood pill_icon field (future):
     "dot"    — coloured dot (current default)
     null     — no icon
     <key>    — icon from a future icon library

   Public API:
     moodPill.update(moodName, dotColor, edgeColor)
       Call whenever active mood changes. Pass null/'' to clear.
     moodPill.setVisibility(mode)
       'always' | 'fade' | 'hide'. Persists to _visMode.
     moodPill.getVisibility()
       Returns current mode string.
*/

const moodPill = (() => {

  const FADE_HOLD_MS = 4000;
  const NEUTRAL_NAME = 'Neutral';

  let _visMode   = 'always';
  let _fadeTimer = null;
  let _current   = null; // { name, dotColor, edgeColor }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _el() { return document.getElementById('mood-pill'); }

  function _hexToRgba(hex, a) {
    if (!hex || !hex.startsWith('#')) return `rgba(129,140,248,${a})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function _isNeutralOrEmpty(name) {
    return !name || name === NEUTRAL_NAME;
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function _render(name, dotColor, edgeColor) {
    const pill = _el();
    if (!pill) return;

    const iconEl = pill.querySelector('.mp-icon');
    const nameEl = pill.querySelector('.mp-name');

    pill.style.background   = _hexToRgba(dotColor, 0.13);
    pill.style.borderColor  = edgeColor;
    pill.style.color        = _hexToRgba(dotColor, 0.9);
    if (iconEl) iconEl.style.background = dotColor;
    if (nameEl) nameEl.textContent = name;
  }

  // ── Visibility logic ───────────────────────────────────────────────────────

  function _show() {
    const pill = _el();
    if (!pill) return;
    pill.classList.remove('mp-hidden');
    pill.classList.add('mp-visible');
  }

  function _hide() {
    const pill = _el();
    if (!pill) return;
    pill.classList.remove('mp-visible');
    pill.classList.add('mp-hidden');
  }

  function _applyVisibility(isChange) {
    if (_fadeTimer) { clearTimeout(_fadeTimer); _fadeTimer = null; }

    const empty = _isNeutralOrEmpty(_current?.name);

    if (_visMode === 'hide' || empty) {
      _hide();
      return;
    }

    if (_visMode === 'always') {
      _show();
      return;
    }

    if (_visMode === 'fade') {
      if (isChange) {
        _show();
        _fadeTimer = setTimeout(_hide, FADE_HOLD_MS);
      }
      // If not a change (e.g. setVisibility called mid-session), leave as-is
    }
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  function update(moodName, dotColor, edgeColor) {
    const isChange = moodName !== _current?.name;
    _current = moodName ? { name: moodName, dotColor, edgeColor } : null;

    if (_isNeutralOrEmpty(moodName)) {
      _hide();
      return;
    }

    _render(moodName, dotColor, edgeColor);
    _applyVisibility(isChange);
  }

  function setVisibility(mode) {
    if (!['always', 'fade', 'hide'].includes(mode)) return;
    _visMode = mode;
    // Re-apply to current state; treat as non-change so fade doesn't re-trigger
    _applyVisibility(false);
  }

  function getVisibility() { return _visMode; }

  return { update, setVisibility, getVisibility };

})();
