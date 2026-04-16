/**
 * companion-avatar.js — canvas-based avatar crop modal
 *
 * Two slots: orb (circle, 256×256 output) and sidebar (portrait 3:4, 300×400 output).
 * Drag to pan · scroll or pinch to zoom · +/− buttons for touchscreen.
 *
 * Exports used by companion.js:
 *   cpAvatarModalOpen(file)   — open crop modal with a File object
 *   cpAvatarGetOrbData()      — returns cropped orb data URL or null
 *   cpAvatarGetSidebarData()  — returns cropped sidebar data URL or null
 *   cpAvatarModalReset()      — clear both slots and previews
 *   cpAvatarZoom(delta)       — called by +/− buttons in the modal
 *   cpAvatarSetMode(mode)     — switch between 'orb' and 'sidebar'
 *   cpAvatarApply()           — crop and store the active slot
 *   cpAvatarDone()            — close modal
 *   cpAvatarRecrop(mode)      — re-open modal for an already-loaded image
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const AV_SIZE    = 360;   // canvas logical size (px, square)
const AV_ORB_R   = 150;   // orb circle radius in canvas px
const AV_SB_W    = 210;   // sidebar rect width in canvas px
const AV_SB_H    = 280;   // sidebar rect height  (3:4)
const AV_SB_RR   = 14;    // sidebar rect corner radius

const AV_OUT_ORB  = 512;  // orb output image size (square)
const AV_OUT_SB_W = 768;  // sidebar output width
const AV_OUT_SB_H = 1024; // sidebar output height (3:4)

// ── State ─────────────────────────────────────────────────────────────────────

let _avImg    = null;          // Image element of the uploaded source
let _avMode   = 'orb';         // 'orb' | 'sidebar'
let _avOrbData = null;         // cropped orb data URL (or null if not set)
let _avSbData  = null;         // cropped sidebar data URL (or null if not set)

// Per-mode independent pan + zoom — reset each time a new image is loaded
let _avSt = {
  orb:     { x: 0, y: 0, s: 1 },
  sidebar: { x: 0, y: 0, s: 1 },
};

let _avDrag       = false;
let _avDragOrigin = { x: 0, y: 0 };
let _avPinchDist  = null;

// ── Public API ────────────────────────────────────────────────────────────────

function cpAvatarModalOpen(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      _avImg = img;
      _avSt  = { orb: { x:0,y:0,s:1 }, sidebar: { x:0,y:0,s:1 } };
      _avFit('orb');
      _avFit('sidebar');
      _avMode = 'orb';
      _avUpdateUI();
      _avDraw();
      document.getElementById('cp-avatar-modal').style.display = '';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function cpAvatarRecrop(mode) {
  // Re-open modal for an image already loaded this session
  if (!_avImg) { cpAvatarBrowse(); return; }
  _avMode = mode;
  _avUpdateUI();
  _avDraw();
  document.getElementById('cp-avatar-modal').style.display = '';
}

function cpAvatarGetOrbData()     { return _avOrbData; }
function cpAvatarGetSidebarData() { return _avSbData;  }

function cpAvatarModalReset() {
  _avOrbData = null;
  _avSbData  = null;
  _avImg     = null;
  const op = document.getElementById('cp-av-orb-prev');
  const sp = document.getElementById('cp-av-sb-prev');
  if (op) op.innerHTML = '✦';
  if (sp) sp.innerHTML = '✦';
}

function cpAvatarZoom(delta) {
  // Multiplicative zoom so each step is a fixed % regardless of current zoom level
  _avSt[_avMode].s = Math.max(0.1, Math.min(10, _avSt[_avMode].s * (1 + delta)));
  _avDraw();
}

function cpAvatarSetMode(mode) {
  _avMode = mode;
  _avUpdateUI();
  _avDraw();
}

function cpAvatarApply() {
  if (!_avImg) return;
  const st    = _avSt[_avMode];
  const isOrb = _avMode === 'orb';
  const outW  = isOrb ? AV_OUT_ORB  : AV_OUT_SB_W;
  const outH  = isOrb ? AV_OUT_ORB  : AV_OUT_SB_H;
  const cropW = isOrb ? AV_ORB_R*2  : AV_SB_W;

  const out = document.createElement('canvas');
  out.width  = outW;
  out.height = outH;
  const ctx  = out.getContext('2d');

  // No canvas clipping — CSS handles border-radius/circle shaping in the UI.
  // Plain JPEG rectangle avoids black corners from transparent regions.

  // Map image from the canvas crop area to the output canvas
  const sc = outW / cropW;
  ctx.drawImage(
    _avImg,
    outW/2 + st.x * sc - _avImg.naturalWidth  * st.s * sc / 2,
    outH/2 + st.y * sc - _avImg.naturalHeight * st.s * sc / 2,
    _avImg.naturalWidth  * st.s * sc,
    _avImg.naturalHeight * st.s * sc,
  );

  const dataUrl = out.toDataURL('image/jpeg', 0.88);

  if (isOrb) {
    _avOrbData = dataUrl;
    const el = document.getElementById('cp-av-orb-prev');
    if (el) el.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    _avSbData = dataUrl;
    const el = document.getElementById('cp-av-sb-prev');
    if (el) el.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover">`;
  }

  _avUpdateUI();

  // Notify companion.js
  _cpAvatarChanged = true;
  if (typeof cpMarkDirty === 'function') cpMarkDirty();
  const rw = document.getElementById('cp-avatar-reset-wrap');
  if (rw) rw.style.display = 'inline';
}

function cpAvatarDone() {
  document.getElementById('cp-avatar-modal').style.display = 'none';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _avFit(mode) {
  if (!_avImg) return;
  const cw = mode === 'orb' ? AV_ORB_R * 2 : AV_SB_W;
  const ch = mode === 'orb' ? AV_ORB_R * 2 : AV_SB_H;
  // Scale to just cover the crop area
  _avSt[mode].s = Math.max(cw / _avImg.naturalWidth, ch / _avImg.naturalHeight);
  _avSt[mode].x = 0;
  _avSt[mode].y = 0;
}

function _avUpdateUI() {
  document.querySelectorAll('.cp-av-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === _avMode)
  );
  const oc = document.getElementById('cp-av-orb-check');
  const sc = document.getElementById('cp-av-sb-check');
  if (oc) oc.style.display = _avOrbData ? '' : 'none';
  if (sc) sc.style.display = _avSbData  ? '' : 'none';
}

function _avDraw() {
  const canvas = document.getElementById('cp-avatar-canvas');
  if (!canvas || !_avImg) return;
  const ctx = canvas.getContext('2d');
  const W = AV_SIZE, H = AV_SIZE, cx = W/2, cy = H/2;
  const st = _avSt[_avMode];

  ctx.clearRect(0, 0, W, H);

  // Subtle checkerboard so transparent source images are visible
  const cs = 12;
  for (let y = 0; y < H; y += cs) {
    for (let x = 0; x < W; x += cs) {
      ctx.fillStyle = ((x/cs + y/cs) % 2 === 0) ? '#2b2d38' : '#232530';
      ctx.fillRect(x, y, cs, cs);
    }
  }

  // Draw source image at current pan/zoom
  ctx.save();
  ctx.translate(cx + st.x, cy + st.y);
  ctx.scale(st.s, st.s);
  ctx.drawImage(_avImg, -_avImg.naturalWidth/2, -_avImg.naturalHeight/2);
  ctx.restore();

  // Dark mask — evenodd fills the outer rect MINUS the crop shape
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  if (_avMode === 'orb') {
    ctx.arc(cx, cy, AV_ORB_R, 0, Math.PI * 2);
  } else {
    _avRR(ctx, cx - AV_SB_W/2, cy - AV_SB_H/2, AV_SB_W, AV_SB_H, AV_SB_RR);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill('evenodd');
  ctx.restore();

  // Crop shape border
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (_avMode === 'orb') {
    ctx.arc(cx, cy, AV_ORB_R, 0, Math.PI * 2);
  } else {
    _avRR(ctx, cx - AV_SB_W/2, cy - AV_SB_H/2, AV_SB_W, AV_SB_H, AV_SB_RR);
  }
  ctx.stroke();
  ctx.restore();
}

// Rounded rect path — uses native roundRect if available, manual fallback otherwise
function _avRR(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);   ctx.arcTo(x+w, y,   x+w, y+r,   r);
    ctx.lineTo(x + w, y + h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x + r, y + h);   ctx.arcTo(x,   y+h, x,   y+h-r, r);
    ctx.lineTo(x, y + r);       ctx.arcTo(x,   y,   x+r, y,     r);
    ctx.closePath();
  }
}

// ── Pointer / touch events ────────────────────────────────────────────────────

function _avPos(e) {
  const canvas = document.getElementById('cp-avatar-canvas');
  const rect   = canvas.getBoundingClientRect();
  const src    = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * (AV_SIZE / rect.width),
    y: (src.clientY - rect.top)  * (AV_SIZE / rect.height),
  };
}

function _avOnDown(e) {
  if (e.touches && e.touches.length === 2) return;
  e.preventDefault();
  _avDrag = true;
  const p = _avPos(e);
  _avDragOrigin = { x: p.x - _avSt[_avMode].x, y: p.y - _avSt[_avMode].y };
}

function _avOnMove(e) {
  e.preventDefault();
  if (e.touches && e.touches.length === 2) {
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    if (_avPinchDist !== null) cpAvatarZoom((d - _avPinchDist) * 0.003);
    _avPinchDist = d;
    return;
  }
  if (!_avDrag) return;
  const p = _avPos(e);
  _avSt[_avMode].x = p.x - _avDragOrigin.x;
  _avSt[_avMode].y = p.y - _avDragOrigin.y;
  _avDraw();
}

function _avOnUp()    { _avDrag = false; _avPinchDist = null; }
function _avOnWheel(e) {
  e.preventDefault();
  cpAvatarZoom(e.deltaY < 0 ? 0.07 : -0.07);
}

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('cp-avatar-canvas');
  if (!canvas) return;
  canvas.addEventListener('mousedown',  _avOnDown,  { passive: false });
  canvas.addEventListener('mousemove',  _avOnMove,  { passive: false });
  canvas.addEventListener('mouseup',    _avOnUp);
  canvas.addEventListener('mouseleave', _avOnUp);
  canvas.addEventListener('wheel',      _avOnWheel, { passive: false });
  canvas.addEventListener('touchstart', _avOnDown,  { passive: false });
  canvas.addEventListener('touchmove',  _avOnMove,  { passive: false });
  canvas.addEventListener('touchend',   _avOnUp);
});
