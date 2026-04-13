// companion-color-picker.js — Shared colour picker overlay for companion panel tabs.
// Loaded after companion-presence.js (needs CP_SWATCHES).
// No knowledge of Presence or Mood internals.
//
// Public API:
//   cpOpenColorPicker({ title, hex, onPick, onClose })
//   cpCloseColorPicker()

// ── State ──────────────────────────────────────────────────────────────────────
let _cpPickerOnPick  = null;
let _cpPickerOnClose = null;

// ── Public API ─────────────────────────────────────────────────────────────────
function cpOpenColorPicker({ title = 'Colour', hex = '#818cf8', onPick = null, onClose = null } = {}) {
  const overlay = document.getElementById('cp-color-overlay');
  if (!overlay) return;

  _cpPickerOnPick  = onPick;
  _cpPickerOnClose = onClose;

  // Title + initial hex + preview
  const titleEl   = overlay.querySelector('.cp-overlay-title');
  const hexInput  = overlay.querySelector('.cp-overlay-hex-input');
  const preview   = overlay.querySelector('.cp-overlay-preview');
  if (titleEl)  titleEl.textContent        = title;
  if (hexInput) hexInput.value             = hex;
  if (preview)  preview.style.background   = hex;

  // Build swatch grid once
  const grid = overlay.querySelector('.cp-overlay-swatch-grid');
  if (grid && !grid.dataset.built) {
    CP_SWATCHES.forEach(row => {
      row.forEach(swHex => {
        const sw            = document.createElement('div');
        sw.className        = 'cp-swatch';
        sw.style.background = swHex;
        sw.dataset.hex      = swHex;
        sw.title            = swHex;
        sw.onclick          = () => _cpPickerSetHex(swHex);
        grid.appendChild(sw);
      });
    });
    const custom     = document.createElement('div');
    custom.className = 'cp-swatch cp-swatch-custom';
    custom.title     = 'Custom colour';
    custom.innerHTML = '✦';
    const native     = document.createElement('input');
    native.type      = 'color';
    native.value     = '#818cf8';
    native.oninput   = (e) => _cpPickerSetHex(e.target.value);
    custom.appendChild(native);
    grid.appendChild(custom);
    grid.dataset.built = '1';
  }

  _cpPickerUpdateSwatchActive(hex);

  // Wire OK / Cancel — replace each time so stale handlers don't accumulate
  const okBtn     = overlay.querySelector('.cp-overlay-ok');
  const cancelBtn = overlay.querySelector('.cp-overlay-cancel');
  if (okBtn)     okBtn.onclick     = _cpPickerOK;
  if (cancelBtn) cancelBtn.onclick = cpCloseColorPicker;

  // Close on backdrop click
  overlay.onclick = (e) => { if (e.target === overlay) cpCloseColorPicker(); };

  overlay.classList.add('open');
}

function cpCloseColorPicker() {
  const overlay = document.getElementById('cp-color-overlay');
  if (overlay) overlay.classList.remove('open');
  if (typeof _cpPickerOnClose === 'function') _cpPickerOnClose();
  _cpPickerOnPick  = null;
  _cpPickerOnClose = null;
}

// ── Hex input (called from oninput on the overlay hex field) ───────────────────
// Must remain a named global so the existing oninput="cpPresenceOverlayHexInput()"
// attribute in chat.html continues to work. It delegates here.
function cpPickerHexInput(val) {
  const hex = val.startsWith('#') ? val : '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) _cpPickerSetHex(hex);
}

// ── Internal ───────────────────────────────────────────────────────────────────
function _cpPickerSetHex(hex) {
  const overlay  = document.getElementById('cp-color-overlay');
  if (!overlay) return;
  const hexInput = overlay.querySelector('.cp-overlay-hex-input');
  const preview  = overlay.querySelector('.cp-overlay-preview');
  if (hexInput) hexInput.value           = hex;
  if (preview)  preview.style.background = hex;
  _cpPickerUpdateSwatchActive(hex);
}

function _cpPickerUpdateSwatchActive(hex) {
  const overlay = document.getElementById('cp-color-overlay');
  if (!overlay) return;
  const norm = hex.toLowerCase();
  overlay.querySelectorAll('.cp-swatch:not(.cp-swatch-custom)').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.hex?.toLowerCase() === norm);
  });
}

function _cpPickerOK() {
  const overlay  = document.getElementById('cp-color-overlay');
  if (!overlay) return;
  const hexInput = overlay.querySelector('.cp-overlay-hex-input');
  const hex      = hexInput?.value || '#818cf8';
  if (/^#[0-9a-fA-F]{6}$/.test(hex) && typeof _cpPickerOnPick === 'function') {
    _cpPickerOnPick(hex);
  }
  cpCloseColorPicker();
}
