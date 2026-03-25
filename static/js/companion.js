// companion.js — Dedicated companion settings window
// Opens via gear icon next to companion name in sidebar
// Tabs: Identity | Generation | Memory | Heartbeat | Presence (future)

// ── State ─────────────────────────────────────────────────────────────────────
let cpSettings    = null;   // loaded from /api/settings
let cpFolder      = '';     // active companion folder
let cpSoulFile    = null;   // currently selected soul file name
let cpDirty       = false;  // unsaved changes flag

// ── Open / close ──────────────────────────────────────────────────────────────
async function openCompanionWindow() {
  document.getElementById('companion-overlay').classList.add('open');
  await cpLoad();
  cpSwitchTab('identity');
}

function closeCompanionWindow() {
  document.getElementById('companion-overlay').classList.remove('open');
}

function closeCompanionIfBg(e) {
  if (e.target === document.getElementById('companion-overlay')) closeCompanionWindow();
}

// ── Load settings ─────────────────────────────────────────────────────────────
async function cpLoad() {
  try {
    const res  = await fetch('/api/settings');
    cpSettings = await res.json();
    cpFolder   = cpSettings.config?.companion_folder || 'default';
    cpPopulate();
  } catch(e) { console.warn('cpLoad failed:', e); }
}

function cpPopulate() {
  const cfg = cpSettings || {};
  const c   = cfg.active_companion || {};
  const g   = c.generation || {};
  const gl  = cfg.config?.generation || {};

  // ── Identity ──
  document.getElementById('cp-companion-name').value = c.companion_name || '';

  const preview = document.getElementById('cp-avatar-preview');
  if (c.avatar_data) {
    preview.innerHTML = `<img src="${c.avatar_data}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  } else {
    preview.innerHTML = '✦';
  }
  document.getElementById('cp-crop-wrap').style.display = 'none';

  const soulMode = c.soul_edit_mode || 'locked';
  document.querySelectorAll('#cp-soul-edit-mode input[name="cp-soul-edit"]').forEach(r => {
    r.checked = r.value === soulMode;
  });

  const frEl = document.getElementById('cp-force-read');
  if (frEl) frEl.classList.toggle('on', c.force_read_before_write !== false);

  // ── Generation ── (show only actual overrides — blank = inherit global)
  const setGen = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.value = g[key] !== undefined ? g[key] : '';
  };
  setGen('cp-g-temp',   'temperature');
  setGen('cp-g-topp',   'top_p');
  setGen('cp-g-topk',   'top_k');
  setGen('cp-g-minp',   'min_p');
  setGen('cp-g-rpen',   'repeat_penalty');
  setGen('cp-g-maxt',   'max_tokens');
  setGen('cp-g-pres',   'presence_penalty');
  setGen('cp-g-freq',   'frequency_penalty');
  setGen('cp-g-rounds', 'max_tool_rounds');
  setGen('cp-g-dry-m',  'dry_multiplier');
  setGen('cp-g-dry-b',  'dry_base');
  setGen('cp-g-dry-l',  'dry_allowed_length');

  // ── Memory (soul files) ──
  cpLoadSoulFiles();

  // ── Heartbeat ──
  const hb = c.heartbeat || {};
  const hbTog = (id, val) => { const el = document.getElementById(id); if (el) el.classList.toggle('on', !!val); };
  hbTog('cp-hb-silent',   hb.silent_enabled);
  hbTog('cp-hb-message',  hb.message_enabled);
  hbTog('cp-hb-idle',     hb.idle_trigger);
  hbTog('cp-hb-conv-end', hb.conversation_end_trigger);
  hbTog('cp-hb-session',  hb.session_start_trigger);
  hbTog('cp-hb-ctx',      hb.context_threshold_trigger);
  const idleMin = document.getElementById('cp-hb-idle-min');  if (idleMin) idleMin.value = hb.idle_minutes ?? 15;
  const ctxPct  = document.getElementById('cp-hb-ctx-pct');   if (ctxPct)  ctxPct.value  = hb.context_threshold_pct ?? 75;

  const instr = hb.instructions || {};
  const instrVal = (key) => typeof instr === 'string' ? (key === 'default' ? instr : '') : (instr[key] || '');
  ['default','idle','conversation_end','session_start','context_threshold','manual'].forEach(key => {
    const el = document.getElementById('cp-hb-instr-' + key.replace('_', '-'));
    if (el) el.value = instrVal(key);
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function cpSwitchTab(name) {
  document.querySelectorAll('.cp-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.cp-tab-body').forEach(b =>
    b.classList.toggle('active', b.id === 'cp-tab-' + name));
}

// ── Soul files (Memory tab) ───────────────────────────────────────────────────
async function cpLoadSoulFiles() {
  const folder = cpFolder;
  try {
    const res  = await fetch(`/api/settings/soul/${folder}`);
    const data = await res.json();
    const files = data.files || {};
    const tabs  = document.getElementById('cp-soul-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    cpSoulFile = null;
    document.getElementById('cp-soul-content').value = '';
    document.getElementById('cp-soul-save-btn').style.display = 'none';
    Object.entries(files).forEach(([fname, content]) => {
      const btn = document.createElement('button');
      btn.className = 'cp-soul-tab';
      btn.textContent = fname;
      btn.onclick = () => {
        cpSoulFile = fname;
        document.getElementById('cp-soul-content').value = content;
        document.getElementById('cp-soul-save-btn').style.display = 'inline-flex';
        document.querySelectorAll('.cp-soul-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
      };
      tabs.appendChild(btn);
    });
  } catch(e) { console.warn('cpLoadSoulFiles failed:', e); }
}

async function cpSaveSoulFile() {
  if (!cpSoulFile) return;
  const content = document.getElementById('cp-soul-content').value;
  try {
    await fetch(`/api/settings/soul/${cpFolder}`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ filename: cpSoulFile, content }),
    });
    cpShowToast('Soul file saved ✓');
    if (typeof reloadSoulFiles === 'function') reloadSoulFiles();
  } catch(e) { console.warn('cpSaveSoulFile failed:', e); }
}

async function cpNewSoulFile() {
  const name = prompt('New file name (e.g. notes.md):');
  if (!name || !name.trim()) return;
  const fname = name.trim().endsWith('.md') ? name.trim() : name.trim() + '.md';
  await fetch(`/api/settings/soul/${cpFolder}`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ filename: fname, content: '' }),
  });
  await cpLoadSoulFiles();
}

// ── Avatar cropping (same logic as settings.js) ───────────────────────────────
let _cpCropImg = null, _cpCropX = 0, _cpCropY = 0, _cpCropScale = 1, _cpCropDragging = false, _cpCropDragStart = null, _cpCropPosStart = null;

function cpAvatarBrowse() { document.getElementById('cp-avatar-file').click(); }

function cpAvatarFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => cpStartCrop(e.target.result);
  reader.readAsDataURL(file);
}

function cpAvatarDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => cpStartCrop(ev.target.result);
  reader.readAsDataURL(file);
}

function cpStartCrop(src) {
  _cpCropImg = new Image();
  _cpCropImg.onload = () => {
    _cpCropScale = 1; _cpCropX = 0; _cpCropY = 0;
    document.getElementById('cp-crop-wrap').style.display = 'block';
    cpDrawCrop();
  };
  _cpCropImg.src = src;
}

function cpDrawCrop() {
  const canvas = document.getElementById('cp-crop-canvas');
  const ctx = canvas.getContext('2d');
  const W = 240, H = 240;
  ctx.clearRect(0, 0, W, H);
  const scale = _cpCropScale * Math.min(W / _cpCropImg.width, H / _cpCropImg.height);
  const iw = _cpCropImg.width * scale, ih = _cpCropImg.height * scale;
  ctx.drawImage(_cpCropImg, _cpCropX + (W - iw) / 2, _cpCropY + (H - ih) / 2, iw, ih);
  ctx.save();
  ctx.beginPath();
  ctx.arc(W/2, H/2, W/2, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(33,35,46,0.55)';
  ctx.fillRule = 'evenodd';
  ctx.rect(0, 0, W, H);
  ctx.fill();
  ctx.restore();
}

function cpCropZoom(delta) { _cpCropScale = Math.max(0.3, Math.min(4, _cpCropScale + delta)); cpDrawCrop(); }

function cpCropConfirm() {
  const canvas = document.getElementById('cp-crop-canvas');
  const out = document.createElement('canvas'); out.width = out.height = 200;
  const ctx = out.getContext('2d');
  ctx.beginPath(); ctx.arc(100, 100, 100, 0, Math.PI*2); ctx.clip();
  ctx.drawImage(canvas, 0, 0, 240, 240, 0, 0, 200, 200);
  const dataUrl = out.toDataURL('image/png');
  document.getElementById('cp-avatar-preview').innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  document.getElementById('cp-crop-wrap').style.display = 'none';
  if (cpSettings?.active_companion) cpSettings.active_companion.avatar_data = dataUrl;
}

// Crop drag
function cpCropStart(e) { _cpCropDragging = true; _cpCropDragStart = {x:e.clientX,y:e.clientY}; _cpCropPosStart = {x:_cpCropX,y:_cpCropY}; }
function cpCropMove(e)  { if (!_cpCropDragging) return; _cpCropX = _cpCropPosStart.x+(e.clientX-_cpCropDragStart.x); _cpCropY = _cpCropPosStart.y+(e.clientY-_cpCropDragStart.y); cpDrawCrop(); }
function cpCropEnd()    { _cpCropDragging = false; }

// ── Save ──────────────────────────────────────────────────────────────────────
async function cpSave(andClose = false) {
  const gen = {};
  const readNum = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? parseFloat(el.value) : undefined; };
  const readInt = (id) => { const el = document.getElementById(id); return el && el.value !== '' ? parseInt(el.value)   : undefined; };
  const g = {
    temperature:         readNum('cp-g-temp'),
    top_p:               readNum('cp-g-topp'),
    top_k:               readInt('cp-g-topk'),
    min_p:               readNum('cp-g-minp'),
    repeat_penalty:      readNum('cp-g-rpen'),
    max_tokens:          readInt('cp-g-maxt'),
    presence_penalty:    readNum('cp-g-pres'),
    frequency_penalty:   readNum('cp-g-freq'),
    max_tool_rounds:     readInt('cp-g-rounds'),
    dry_multiplier:      readNum('cp-g-dry-m'),
    dry_base:            readNum('cp-g-dry-b'),
    dry_allowed_length:  readInt('cp-g-dry-l'),
  };
  // Remove undefined keys
  Object.keys(g).forEach(k => g[k] === undefined && delete g[k]);

  const getInstr = (key) => document.getElementById('cp-hb-instr-' + key.replace('_','-'))?.value || '';

  const body = {
    folder:         cpFolder,
    companion_name: document.getElementById('cp-companion-name').value.trim(),
    avatar_data:    document.getElementById('cp-avatar-preview').querySelector('img')?.src || '',
    generation:     g,
    soul_edit_mode: document.querySelector('#cp-soul-edit-mode input[name="cp-soul-edit"]:checked')?.value || 'locked',
    force_read_before_write: document.getElementById('cp-force-read')?.classList.contains('on') ?? true,
    heartbeat: {
      silent_enabled:            document.getElementById('cp-hb-silent')?.classList.contains('on')   || false,
      message_enabled:           document.getElementById('cp-hb-message')?.classList.contains('on')  || false,
      idle_trigger:              document.getElementById('cp-hb-idle')?.classList.contains('on')     || false,
      idle_minutes:              parseInt(document.getElementById('cp-hb-idle-min')?.value) || 15,
      conversation_end_trigger:  document.getElementById('cp-hb-conv-end')?.classList.contains('on') || false,
      session_start_trigger:     document.getElementById('cp-hb-session')?.classList.contains('on')  || false,
      context_threshold_trigger: document.getElementById('cp-hb-ctx')?.classList.contains('on')      || false,
      context_threshold_pct:     parseInt(document.getElementById('cp-hb-ctx-pct')?.value) || 75,
      instructions: {
        default:           getInstr('default'),
        idle:              getInstr('idle'),
        conversation_end:  getInstr('conversation-end'),
        session_start:     getInstr('session-start'),
        context_threshold: getInstr('context-threshold'),
        manual:            getInstr('manual'),
      },
    },
    set_active: true,
  };

  try {
    await fetch('/api/settings/companion', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });

    // Update live UI
    const nameEl = document.getElementById('companion-name');
    if (nameEl) nameEl.textContent = body.companion_name || 'Companion';
    if (typeof syncStatusAvatar === 'function') syncStatusAvatar();
    if (typeof heartbeatReload  === 'function') heartbeatReload();

    // Update config for live gen settings
    if (typeof config !== 'undefined') {
      config.force_read_before_write = body.force_read_before_write;
      if (body.generation && config.generation) {
        Object.assign(config.generation, body.generation);
      }
    }

    // Update cpSettings cache
    if (cpSettings?.active_companion) {
      cpSettings.active_companion.companion_name          = body.companion_name;
      cpSettings.active_companion.generation              = g;
      cpSettings.active_companion.soul_edit_mode          = body.soul_edit_mode;
      cpSettings.active_companion.force_read_before_write = body.force_read_before_write;
      cpSettings.active_companion.heartbeat               = body.heartbeat;
    }

    cpShowToast('Companion saved ✓');
    if (andClose) closeCompanionWindow();
  } catch(e) { console.warn('cpSave failed:', e); }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _cpToastTimer = null;
function cpShowToast(msg) {
  if (_cpToastTimer) clearTimeout(_cpToastTimer);
  let toast = document.getElementById('cp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cp-toast';
    toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#21232e;border:1px solid rgba(109,212,168,0.3);border-radius:10px;padding:8px 18px;font-size:13px;color:#6dd4a8;z-index:10000;pointer-events:none;transition:opacity .25s ease';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  _cpToastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}
