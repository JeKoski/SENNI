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

  // Update panel header
  const headerName = document.getElementById('cp-header-name');
  if (headerName) headerName.textContent = c.companion_name || 'Companion';
  const headerAv = document.getElementById('cp-header-avatar');
  if (headerAv) {
    headerAv.innerHTML = c.avatar_data
      ? `<img src="${c.avatar_data}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`
      : '✦';
  }

  const preview = document.getElementById('cp-avatar-preview');
  if (c.avatar_data) {
    preview.innerHTML = `<img src="${c.avatar_data}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  } else {
    preview.innerHTML = '✦';
  }
  document.getElementById('cp-crop-wrap').style.display = 'none';
  // Show/hide reset link
  const resetWrap = document.getElementById('cp-avatar-reset-wrap');
  if (resetWrap) resetWrap.style.display = c.avatar_data ? 'inline' : 'none';

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

  // ── Presence ──
  cpPresenceInit();

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
  // Dark overlay outside the circle using evenodd fill rule
  ctx.save();
  ctx.fillStyle = 'rgba(28,30,38,0.72)';
  ctx.beginPath();
  ctx.rect(0, 0, W, H);           // outer rectangle
  ctx.arc(W/2, H/2, W/2, 0, Math.PI*2, true); // circle cut-out (counter-clockwise = hole)
  ctx.fill('evenodd');
  // Circle border
  ctx.beginPath();
  ctx.arc(W/2, H/2, W/2 - 1, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(129,140,248,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
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
  const rw = document.getElementById('cp-avatar-reset-wrap');
  if (rw) rw.style.display = 'inline';
  if (cpSettings?.active_companion) cpSettings.active_companion.avatar_data = dataUrl;
}

// Crop drag
function cpCropStart(e) { _cpCropDragging = true; _cpCropDragStart = {x:e.clientX,y:e.clientY}; _cpCropPosStart = {x:_cpCropX,y:_cpCropY}; }
function cpCropMove(e)  { if (!_cpCropDragging) return; _cpCropX = _cpCropPosStart.x+(e.clientX-_cpCropDragStart.x); _cpCropY = _cpCropPosStart.y+(e.clientY-_cpCropDragStart.y); cpDrawCrop(); }
function cpCropEnd()    { _cpCropDragging = false; }

function cpAvatarReset() {
  const preview = document.getElementById('cp-avatar-preview');
  if (preview) preview.innerHTML = '✦';
  const rw = document.getElementById('cp-avatar-reset-wrap');
  if (rw) rw.style.display = 'none';
  document.getElementById('cp-crop-wrap').style.display = 'none';
  if (cpSettings?.active_companion) cpSettings.active_companion.avatar_data = '';
}

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
    set_active:               true,
    presence_presets:         _cpPresenceData,
    active_presence_preset:   _cpActivePreset,
  };

  try {
    await fetch('/api/settings/companion', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });

    // Update live UI
    const nameEl = document.getElementById('companion-name');
    if (nameEl) nameEl.textContent = body.companion_name || 'Companion';
    // Update sidebar avatar immediately — don't wait for page reload
    if (body.avatar_data) {
      const sidebarAv = document.getElementById('companion-avatar');
      if (sidebarAv) {
        sidebarAv.innerHTML = `<img src="${body.avatar_data}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
      }
    }
    // Update companion window header too
    const cpHeaderName = document.getElementById('cp-header-name');
    if (cpHeaderName) cpHeaderName.textContent = body.companion_name || 'Companion';
    const cpHeaderAv = document.getElementById('cp-header-avatar');
    if (cpHeaderAv && body.avatar_data) {
      cpHeaderAv.innerHTML = `<img src="${body.avatar_data}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
    }
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

    // Apply active preset to live orb immediately
    if (typeof applyPresencePreset === 'function' && _cpPresenceData[_cpActivePreset]) {
      const livePreset = _cpPresenceData[_cpActivePreset];
      applyPresencePreset({ state: 'idle', ...(livePreset.idle || {}) });
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

// ── Presence tab ──────────────────────────────────────────────────────────────
let _cpPresencePresets   = {};   // full merged preset library
let _cpActivePreset      = 'Default';
let _cpEditingState      = 'thinking';
let _cpPresenceDirty     = false; // unsaved changes

function cpPresenceInit() {
  // Called after cpLoad — populate presets from loaded settings
  _cpPresencePresets = JSON.parse(JSON.stringify(
    cpSettings?.presence_presets || { Default: {} }
  ));
  _cpActivePreset = cpSettings?.active_companion?.active_presence_preset || 'Default';
  cpPresenceRenderPresets();
  cpPresenceLoadState(_cpEditingState);
  cpPresenceSyncPreview(_cpEditingState);
  // Mirror companion avatar into preview
  const avSrc = document.querySelector('#companion-avatar img')?.src;
  const previewIcon = document.getElementById('cp-preview-icon');
  if (previewIcon && avSrc) {
    previewIcon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  }
}

function cpPresenceRenderPresets() {
  const bar = document.getElementById('cp-preset-bar');
  if (!bar) return;
  bar.innerHTML = '';
  const PROTECTED = ['Default','Warm'];  // factory presets can't be deleted
  Object.keys(_cpPresencePresets).forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'cp-preset-chip' + (name === _cpActivePreset ? ' active' : '');
    const label = document.createTextNode(name);
    chip.appendChild(label);
    if (!PROTECTED.includes(name)) {
      const del = document.createElement('span');
      del.className = 'cp-preset-del';
      del.textContent = '×';
      del.title = 'Delete preset';
      del.onclick = (e) => { e.stopPropagation(); cpPresenceDeletePreset(name); };
      chip.appendChild(del);
    }
    chip.addEventListener('click', () => cpPresenceSelectPreset(name));
    bar.appendChild(chip);
  });
}

function cpPresenceSelectPreset(name) {
  _cpActivePreset = name;
  cpPresenceRenderPresets();
  cpPresenceLoadState(_cpEditingState);
  cpPresenceSyncPreview(_cpEditingState);
  // Apply to live orb immediately for preview
  const stateVars = _cpGetStateVars(name, _cpEditingState);
  if (typeof applyPresencePreset === 'function') {
    applyPresencePreset({ state: _cpEditingState, ...stateVars });
  }
}

function cpPresenceNewPreset() {
  const name = prompt('New preset name:');
  if (!name?.trim()) return;
  const n = name.trim();
  if (_cpPresencePresets[n]) { alert('A preset with that name already exists.'); return; }
  // Clone Default as starting point
  _cpPresencePresets[n] = JSON.parse(JSON.stringify(_cpPresencePresets['Default'] || {}));
  _cpActivePreset = n;
  cpPresenceRenderPresets();
  cpPresenceLoadState(_cpEditingState);
  _cpPresenceDirty = true;
}

function cpPresenceDeletePreset(name) {
  if (!confirm(`Delete preset "${name}"?`)) return;
  delete _cpPresencePresets[name];
  if (_cpActivePreset === name) _cpActivePreset = 'Default';
  cpPresenceRenderPresets();
  cpPresenceLoadState(_cpEditingState);
  _cpPresenceDirty = true;
}

function cpPresencePreviewState(btn) {
  document.querySelectorAll('.cp-state-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _cpEditingState = btn.dataset.state;
  document.getElementById('cp-editing-state').textContent = _cpEditingState;
  document.getElementById('cp-preview-state-label').textContent = _cpEditingState;
  cpPresenceLoadState(_cpEditingState);
  cpPresenceSyncPreview(_cpEditingState);
}

function cpPresenceLoadState(state) {
  // Load the current preset's values for this state into the sliders/color
  const vars = _cpGetStateVars(_cpActivePreset, state);
  const set = (id, val, suffix) => {
    const el = document.getElementById(id);
    if (el) el.value = parseFloat(val) || el.value;
    const lbl = document.getElementById(id + '-val');
    if (lbl) lbl.textContent = (parseFloat(val) || parseFloat(el?.value)) + suffix;
  };
  set('cp-s-glow-max',    vars.glowMax    || 16,  'px');
  set('cp-s-glow-speed',  vars.glowSpeed  || 2.0, 's');
  set('cp-s-ring-speed',  vars.ringSpeed  || 1.8, 's');
  set('cp-s-dot-speed',   vars.dotSpeed   || 1.2, 's');
  set('cp-s-breath-speed',vars.breathSpeed|| 3.0, 's');
  set('cp-s-orb-size',    vars.orbSize    || 52,  'px');
  const color = vars.dotColor || '#818cf8';
  const ci = document.getElementById('cp-color-input');
  if (ci) ci.value = color;
  const cd = document.getElementById('cp-color-dot');
  if (cd) cd.style.background = color;
}

function cpPresenceSyncPreview(state) {
  // Update the mini preview orb
  const orb  = document.getElementById('cp-preview-orb');
  const dots = document.getElementById('cp-preview-dots');
  const lbl  = document.getElementById('cp-preview-state-label');
  if (!orb) return;
  const STATES = ['thinking','streaming','heartbeat','idle','chaos'];
  orb.classList.remove(...STATES);
  orb.classList.add(state);
  if (lbl) lbl.textContent = state;
  // Update dot color
  const vars  = _cpGetStateVars(_cpActivePreset, state);
  const color = vars.dotColor || '#818cf8';
  document.querySelectorAll('#cp-preview-dots span').forEach(s => s.style.background = color);
  // Update preview orb CSS vars
  if (vars.glowColor) orb.style.setProperty('--glow-color', vars.glowColor);
  if (vars.glowMax)   orb.style.setProperty('--glow-max',   vars.glowMax + 'px');
}

function cpPresenceColorInput(val) {
  const dot = document.getElementById('cp-color-dot');
  if (dot) dot.style.background = val;
  if (!/^#[0-9a-fA-F]{6}$/.test(val)) return;
  // Store in preset
  if (!_cpPresencePresets[_cpActivePreset]) _cpPresencePresets[_cpActivePreset] = {};
  if (!_cpPresencePresets[_cpActivePreset][_cpEditingState]) _cpPresencePresets[_cpActivePreset][_cpEditingState] = {};
  _cpPresencePresets[_cpActivePreset][_cpEditingState].dotColor   = val;
  _cpPresencePresets[_cpActivePreset][_cpEditingState].glowColor  = val.replace(/^#/, '') && _hexToRgba(val, 0.4);
  _cpPresenceDirty = true;
  // Live apply to real orb
  if (typeof setPresenceState === 'function') {
    setPresenceState(_cpEditingState, { '--dot-color': val, '--glow-color': _hexToRgba(val, 0.4) });
  }
  document.querySelectorAll('#cp-preview-dots span').forEach(s => s.style.background = val);
}

function cpPresenceSlide(key, val, unit) {
  if (!_cpPresencePresets[_cpActivePreset]) _cpPresencePresets[_cpActivePreset] = {};
  if (!_cpPresencePresets[_cpActivePreset][_cpEditingState]) _cpPresencePresets[_cpActivePreset][_cpEditingState] = {};
  _cpPresencePresets[_cpActivePreset][_cpEditingState][key] = parseFloat(val);
  _cpPresenceDirty = true;
  // Live apply CSS var to real orb
  const cssMap = {
    glowMax: '--glow-max', glowSpeed: '--glow-speed', ringSpeed: '--ring-speed',
    dotSpeed: '--dot-speed', breathSpeed: '--breath-speed', orbSize: '--orb-size',
  };
  const prop = cssMap[key];
  if (prop && typeof setPresenceState === 'function') {
    setPresenceState(_cpEditingState, { [prop]: val + unit });
  }
  // Also apply to preview
  const orb = document.getElementById('cp-preview-orb');
  if (orb && prop) orb.style.setProperty(prop, val + unit);
}

function _cpGetStateVars(presetName, state) {
  // Merge: DEFAULTS base → preset definition
  const presetLib   = cpSettings?.presence_presets || {};
  const defaultPreset = presetLib['Default'] || {};
  const namedPreset   = _cpPresencePresets[presetName] || presetLib[presetName] || {};
  return { ...(defaultPreset[state] || {}), ...(namedPreset[state] || {}) };
}

function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Called by cpSave — gather presence data to send to server
function _cpGetPresencePayload() {
  return {
    presence_presets:       _cpPresencePresets,
    active_presence_preset: _cpActivePreset,
  };
}

// ── Presence tab ──────────────────────────────────────────────────────────────
let _cpPresenceData     = {};  // { presetName: { thinking:{...}, streaming:{...}, ... } }
let _cpActivePreset     = 'Default';
let _cpEditingState     = 'thinking';
let _cpPresenceDirty    = false;

// Defaults for each state (used when creating a new preset or missing keys)
const CP_STATE_DEFAULTS = {
  thinking:  { glowColor:'rgba(129,140,248,0.4)',  glowMax:16, glowSpeed:2.0, ringSpeed:1.8, dotColor:'#818cf8', dotSpeed:1.2, breathSpeed:3.0, orbSize:52 },
  streaming: { glowColor:'rgba(109,212,168,0.35)', glowMax:12, glowSpeed:2.5, ringSpeed:2.4, dotColor:'#6dd4a8', dotSpeed:1.4, breathSpeed:3.0, orbSize:52 },
  heartbeat: { glowColor:'rgba(167,139,250,0.45)', glowMax:20, glowSpeed:1.4, ringSpeed:1.4, dotColor:'#a78bfa', dotSpeed:0.9, breathSpeed:2.0, orbSize:52 },
  chaos:     { glowColor:'rgba(251,191,36,0.5)',   glowMax:24, glowSpeed:0.8, ringSpeed:0.9, dotColor:'#fbbf24', dotSpeed:0.6, breathSpeed:0.6, orbSize:52 },
  idle:      { glowColor:'rgba(129,140,248,0.15)', glowMax:6,  glowSpeed:4.0, ringSpeed:4.0, dotColor:'#818cf8', dotSpeed:2.0, breathSpeed:5.0, orbSize:52 },
};

function cpPresenceInit() {
  // Pull presets from loaded cpSettings
  const cfg = cpSettings || {};
  _cpPresenceData  = JSON.parse(JSON.stringify(cfg.presence_presets || { Default: CP_STATE_DEFAULTS }));
  _cpActivePreset  = cfg.active_companion?.active_presence_preset || cfg.active_presence_preset || 'Default';
  _cpEditingState  = 'thinking';
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);
}

function cpPresenceRenderPresets() {
  const bar = document.getElementById('cp-preset-bar');
  if (!bar) return;
  bar.innerHTML = '';
  Object.keys(_cpPresenceData).forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'cp-preset-chip' + (name === _cpActivePreset ? ' active' : '');
    chip.innerHTML = `<span onclick="cpPresenceSelectPreset('${name}')">${name}</span>`;
    if (name !== 'Default') {
      const del = document.createElement('span');
      del.className = 'cp-preset-del';
      del.title = 'Delete preset';
      del.textContent = '×';
      del.onclick = (e) => { e.stopPropagation(); cpPresenceDeletePreset(name); };
      chip.appendChild(del);
    }
    bar.appendChild(chip);
  });
  // Add btn rendered by HTML
}

function cpPresenceSelectPreset(name) {
  if (!_cpPresenceData[name]) return;
  _cpActivePreset = name;
  // Update badge + chip highlights
  const badge = document.getElementById('cp-editing-preset-badge');
  if (badge) badge.textContent = name;
  document.querySelectorAll('.cp-preset-chip').forEach(c => {
    c.classList.toggle('active', c.querySelector('span')?.textContent === name);
  });
  // Re-render current state sliders
  cpPresenceRenderState(_cpEditingState);
}

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

  // Update sliders
  const setSlider = (id, val, suffix) => {
    const el = document.getElementById(id);
    const lbl = document.getElementById(id + '-val');
    if (el)  el.value = val;
    if (lbl) lbl.textContent = val + suffix;
  };
  setSlider('ps-glow-max',    s.glowMax,    'px');
  setSlider('ps-glow-speed',  s.glowSpeed,  's');
  setSlider('ps-ring-speed',  s.ringSpeed,  's');
  setSlider('ps-dot-speed',   s.dotSpeed,   's');
  setSlider('ps-breath-speed',s.breathSpeed,'s');
  setSlider('ps-orb-size',    s.orbSize,    'px');

  // Color
  const color = s.dotColor || '#818cf8';
  const ci = document.getElementById('cp-color-input');
  const cp = document.getElementById('cp-color-picker');
  const cd = document.getElementById('cp-color-dot');
  if (ci) ci.value = color;
  if (cp) cp.value = cpColorToHex(color);
  if (cd) cd.style.background = color;

  // Update live preview
  cpPresenceUpdatePreview(s, state);
}

function cpColorToHex(color) {
  // Convert rgba(...) to a usable hex for the color picker
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    return '#' + [m[1],m[2],m[3]].map(n => parseInt(n).toString(16).padStart(2,'0')).join('');
  }
  return color.startsWith('#') ? color.slice(0,7) : '#818cf8';
}

function cpPresenceColorInput(val) {
  const cd = document.getElementById('cp-color-dot');
  if (cd) cd.style.background = val;
  const cp = document.getElementById('cp-color-picker');
  if (cp && /^#[0-9a-fA-F]{6}$/.test(val)) cp.value = val;
  cpPresenceSetValue('dotColor', val);
  // Derive glowColor from dotColor with reduced opacity
  const gc = cpDeriveGlowColor(val, 0.4);
  cpPresenceSetValue('glowColor', gc);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceColorPick(hex) {
  const ci = document.getElementById('cp-color-input');
  if (ci) ci.value = hex;
  const cd = document.getElementById('cp-color-dot');
  if (cd) cd.style.background = hex;
  cpPresenceSetValue('dotColor', hex);
  const gc = cpDeriveGlowColor(hex, 0.4);
  cpPresenceSetValue('glowColor', gc);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpDeriveGlowColor(hex, alpha) {
  if (hex.startsWith('#') && hex.length >= 7) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}

function cpPresenceSlider(key, input) {
  const val = parseFloat(input.value);
  const lbl = document.getElementById(input.id + '-val');
  const unit = key === 'orbSize' || key === 'glowMax' ? 'px' : 's';
  if (lbl) lbl.textContent = val + unit;
  cpPresenceSetValue(key, val);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceSetValue(key, val) {
  if (!_cpPresenceData[_cpActivePreset]) return;
  if (!_cpPresenceData[_cpActivePreset][_cpEditingState]) {
    _cpPresenceData[_cpActivePreset][_cpEditingState] = {};
  }
  _cpPresenceData[_cpActivePreset][_cpEditingState][key] = val;
  _cpPresenceDirty = true;
}

function cpPresenceUpdatePreviewFromCurrent() {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  const s = Object.assign({}, CP_STATE_DEFAULTS[_cpEditingState], preset[_cpEditingState] || {});
  cpPresenceUpdatePreview(s, _cpEditingState);
}

let _cppAnimFrame = null;
function cpPresenceUpdatePreview(s, state) {
  const orb  = document.getElementById('cpp-orb');
  const dots = document.getElementById('cpp-dots');
  const icon = document.getElementById('cpp-icon');
  const ring = orb?.querySelector('.cpp-ring');
  if (!orb) return;

  const size = (s.orbSize || 52) + 'px';
  orb.style.cssText = `
    width:${size}; height:${size};
    background:${cpDeriveGlowColor(s.dotColor||'#818cf8', 0.1)};
    border:2px solid ${cpDeriveGlowColor(s.dotColor||'#818cf8', 0.35)};
    animation: cppGlow ${s.glowSpeed||2}s ease-in-out infinite,
               cppBreath ${s.breathSpeed||3}s ease-in-out infinite;
  `;
  orb.style.setProperty('--cpp-glow-color', s.glowColor || 'rgba(129,140,248,0.4)');
  orb.style.setProperty('--cpp-glow-min',   '4px');
  orb.style.setProperty('--cpp-glow-max',   (s.glowMax||16) + 'px');

  if (ring) {
    ring.style.cssText = `animation: cppRing ${s.ringSpeed||1.8}s ease-out infinite;`;
    ring.style.setProperty('--cpp-ring-color', cpDeriveGlowColor(s.dotColor||'#818cf8', 0.3));
  }

  // Dots
  if (dots) {
    dots.style.width = size;
    dots.querySelectorAll('span').forEach((d, i) => {
      d.style.background = s.dotColor || '#818cf8';
      const delay = [0, 0.18, 0.36][i];
      d.style.cssText += `animation: cppDot ${s.dotSpeed||1.2}s ease-in-out ${delay}s infinite; opacity:1;`;
    });
  }

  // Icon
  if (icon) {
    icon.style.color    = s.dotColor || '#818cf8';
    icon.style.fontSize = Math.round((s.orbSize||52) * 0.42) + 'px';
    // Mirror avatar if present
    const avSrc = document.querySelector('#companion-avatar img')?.src;
    if (avSrc && !icon.querySelector('img')) {
      icon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    }
  }
}

function cpPresenceNewPreset() {
  const name = prompt('Preset name:');
  if (!name || !name.trim()) return;
  const n = name.trim();
  if (_cpPresenceData[n]) { alert('A preset with that name already exists.'); return; }
  // Deep copy from Default
  _cpPresenceData[n] = JSON.parse(JSON.stringify(_cpPresenceData['Default'] || CP_STATE_DEFAULTS));
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(n);
  _cpPresenceDirty = true;
}

function cpPresenceDeletePreset(name) {
  if (name === 'Default') return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  delete _cpPresenceData[name];
  if (_cpActivePreset === name) _cpActivePreset = 'Default';
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);
  _cpPresenceDirty = true;
}
