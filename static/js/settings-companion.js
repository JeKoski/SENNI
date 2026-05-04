// settings-companion.js — Settings panel: Companion tab + About tab
// Depends on: settings.js (spSettings, spActiveFolder, spCurrentSoulFile,
//             _spSetDirty, _spClearDirty, spShowSavedToast, closeSettings, spLoad)

// ── Avatar crop state ─────────────────────────────────────────────────────────
let spCropImg         = null;
let spCropX           = 0;
let spCropY           = 0;
let spCropScale       = 1;
let spCropDragging    = false;
let spCropDragStart   = null;
let spCropPosStart    = null;
let _spAvatarChanged  = false;  // true if user cropped a new avatar this session
let _spNewAvatarData  = null;   // data URL of newly cropped avatar

// ── Populate ──────────────────────────────────────────────────────────────────
// NOTE: The Settings panel companion tab only contains the companion list
// (#sp-companion-list) and a button to open the Companion Window.
// All other companion fields (name, avatar, heartbeat, soul files, etc.)
// live in the Companion Window — cpPopulateCompanion() handles those.
// DO NOT reference those IDs here; they don't exist in this context.
function spPopulateCompanion() {
  const companions = spSettings.companions || [];
  const listEl = document.getElementById('sp-companion-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  companions.forEach(c => {
    const item     = document.createElement('div');
    const isActive = c.folder === spActiveFolder;
    item.className = 'sp-companion-item' + (isActive ? ' active-companion' : '');
    const avSrc = c.avatar_url
      ? (c.avatar_url.startsWith('data:') ? c.avatar_url : `${c.avatar_url}?v=${Date.now()}`)
      : '';
    const avatarHtml = avSrc
      ? `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : '✦';
    item.innerHTML = `
      <div class="sp-mini-avatar">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <div class="sp-companion-name">${c.name}</div>
        <div class="sp-companion-folder">${c.folder}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${isActive
          ? '<span style="font-size:10px;color:var(--indigo);opacity:0.7">active</span>'
          : `<button class="sp-btn-sm" onclick="spSwitchCompanion('${c.folder}')">Switch</button>
             <button class="sp-btn-sm sp-btn-ghost" style="color:var(--red);border-color:rgba(248,113,113,0.25)"
               onclick="spDeleteCompanion('${c.folder}','${c.name}')">✕</button>`
        }
      </div>`;
    listEl.appendChild(item);
  });
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function spSaveCompanion(andClose = false) {
  const nameEl = document.getElementById('sp-companion-name-input');
  const name   = nameEl?.value?.trim() || '';

  const frc      = document.getElementById('tog-force-read');
  const soulMode = document.getElementById('sp-soul-mode')?.value || 'locked';

  const hbPayload = {
    silent_enabled:            document.getElementById('hb-tog-silent')?.classList.contains('on')     || false,
    message_enabled:           document.getElementById('hb-tog-message')?.classList.contains('on')    || false,
    idle_trigger:              document.getElementById('hb-tog-idle')?.classList.contains('on')       || false,
    idle_minutes:              parseInt(document.getElementById('hb-idle-minutes')?.value) || 15,
    conversation_end_trigger:  document.getElementById('hb-tog-conv-end')?.classList.contains('on')   || false,
    session_start_trigger:     document.getElementById('hb-tog-sess-start')?.classList.contains('on') || false,
    context_threshold_trigger: document.getElementById('hb-tog-ctx')?.classList.contains('on')        || false,
    context_threshold_pct:     parseInt(document.getElementById('hb-ctx-pct')?.value) || 75,
    instructions: _spGetHeartbeatInstructions(),
  };

  await fetch('/api/settings/companion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder:                  spActiveFolder,
      companion_name:          name,
      ...(_spAvatarChanged ? { avatar_data: _spNewAvatarData } : {}),
      soul_edit_mode:          soulMode,
      force_read_before_write: frc ? frc.classList.contains('on') : true,
      heartbeat:               hbPayload,
    }),
  });

  if (spSettings.config) spSettings.config.companion_name = name;
  if (typeof companionName !== 'undefined') {
    companionName = name;
    document.getElementById('companion-name').textContent = name;
    document.title = name;
  }

  if (_spAvatarChanged) {
    // Update cached avatar_url to server URL now that save succeeded
    const companions = spSettings?.companions || [];
    const c = companions.find(x => x.folder === spActiveFolder);
    if (c) c.avatar_url = _spNewAvatarData ? `/api/companion/${spActiveFolder}/avatar` : '';
    _spAvatarChanged = false;
    _spNewAvatarData = null;
  }

  _spClearDirty('companion');
  spShowSavedToast('Companion settings saved ✓');

  // Reload heartbeat config live so changes take effect without a page refresh
  if (typeof heartbeatReload === 'function') heartbeatReload();

  if (andClose) closeSettings();
}

function _spGetHeartbeatInstructions() {
  const g = (id) => document.getElementById(id)?.value || '';
  return {
    default:           g('hb-instr-default'),
    idle:              g('hb-instr-idle'),
    conversation_end:  g('hb-instr-conversation-end'),
    session_start:     g('hb-instr-session-start'),
    context_threshold: g('hb-instr-context-threshold'),
    manual:            g('hb-instr-manual'),
  };
}

// ── Companion switching / creation / deletion ──────────────────────────────────
let _switchingCompanion = false;

async function spSwitchCompanion(folder) {
  if (_switchingCompanion) return;
  _switchingCompanion = true;

  const overlay = document.createElement('div');
  overlay.id = 'companion-switch-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:"DM Sans",sans-serif;color:#eef0fb;font-size:15px';
  overlay.textContent = 'Switching companion…';
  document.body.appendChild(overlay);

  try {
    await fetch('/api/settings/companion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, set_active: true }),
    });
    window.location.reload();
  } catch (e) {
    document.getElementById('companion-switch-overlay')?.remove();
    _switchingCompanion = false;
    alert('Could not switch companion: ' + e.message);
  }
}

async function spNewCompanion() {
  const name = prompt('New companion name:');
  if (!name) return;
  const res  = await fetch('/api/settings/companion/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (data.ok) await spLoad();
}

async function spDeleteCompanion(folder, name) {
  if (!confirm(`Delete companion "${name}"? This cannot be undone.`)) return;
  const res  = await fetch(`/api/companions/${folder}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.ok) {
    await spLoad();
  } else {
    alert('Could not delete: ' + (data.error || 'unknown error'));
  }
}

// ── About tab ─────────────────────────────────────────────────────────────────
function spPopulateAbout() {
  const cfg = spSettings.config || {};
  document.getElementById('about-model').textContent     = cfg.model_path?.split(/[\\\/]/).pop() || '—';
  document.getElementById('about-gpu').textContent       = cfg.gpu_type || '—';
  document.getElementById('about-ports').textContent     = `Bridge :${cfg.port_bridge||8000} · Model :${cfg.port_model||8081}`;
  document.getElementById('about-companion').textContent = `${cfg.companion_name||'—'} (${cfg.companion_folder||'default'})`;
  document.getElementById('about-paths').innerHTML =
    `model: ${cfg.model_path||'—'}\n` +
    (cfg.mmproj_path   ? `mmproj: ${cfg.mmproj_path}\n`   : '') +
    (cfg.server_binary ? `binary: ${cfg.server_binary}\n` : '');

  // Show Tauri-only server controls when running inside Tauri
  if (window.__TAURI__) {
    document.getElementById('tauri-server-section').style.display = '';
    window.__TAURI__.core.invoke('get_tauri_prefs_cmd').then(prefs => {
      const tog = document.getElementById('tog-show-console');
      if (tog) tog.classList.toggle('on', !!prefs?.show_console);
    }).catch(() => {});
  }
}

// ── Tauri server log + console toggle ─────────────────────────────────────────

async function openServerLog(forceOpen = false) {
  if (!window.__TAURI__) return;
  // Make sure Settings is open and About tab is active
  const overlay = document.getElementById('settings-overlay');
  if (!overlay?.classList.contains('open')) await openSettings();
  spSwitchTab('about');

  const panel = document.getElementById('server-log-panel');
  if (!panel) return;

  // Toggle unless forced open by tray
  if (!forceOpen && panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }

  panel.textContent = 'Loading…';
  panel.style.display = '';

  try {
    const lines = await window.__TAURI__.core.invoke('get_sidecar_log');
    panel.textContent = lines.length ? lines.join('\n') : '(no output captured yet)';
    // Scroll to bottom so newest lines are visible
    panel.scrollTop = panel.scrollHeight;
  } catch (e) {
    panel.textContent = `Error: ${e}`;
  }
}

function spToggleShowConsole(el) {
  if (!window.__TAURI__) return;
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  const note = document.getElementById('show-console-note');
  if (note) note.style.display = enabled ? '' : 'none';
  window.__TAURI__.core.invoke('set_show_console', { value: enabled }).catch(() => {});
}

// ── Avatar crop ────────────────────────────────────────────────────────────────
function spAvatarBrowse() { document.getElementById('sp-avatar-input')?.click(); }

function spAvatarPick(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => spAvatarStartCrop(ev.target.result);
  reader.readAsDataURL(file);
  input.value = '';
}

function spAvatarDrop(e) {
  e.preventDefault();
  document.getElementById('sp-avatar-zone')?.classList.remove('drag-over');
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => spAvatarStartCrop(ev.target.result);
  reader.readAsDataURL(file);
}

function spAvatarStartCrop(src) {
  const wrap = document.getElementById('sp-crop-wrap');
  if (!wrap) return;
  wrap.style.display = 'flex';
  spCropImg = new Image();
  spCropImg.onload = () => {
    spCropX     = 0;
    spCropY     = 0;
    spCropScale = 1;
    spDrawCrop();
  };
  spCropImg.src = src;
}

function spDrawCrop() {
  const canvas = document.getElementById('sp-crop-canvas');
  if (!canvas || !spCropImg) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(spCropImg, spCropX, spCropY, spCropImg.width * spCropScale, spCropImg.height * spCropScale);
  ctx.beginPath();
  ctx.arc(canvas.width/2, canvas.height/2, canvas.width/2, 0, Math.PI*2);
  ctx.strokeStyle = 'rgba(129,140,248,0.8)';
  ctx.lineWidth   = 2;
  ctx.stroke();
}

function spCropMouseDown(e) {
  spCropDragging  = true;
  spCropDragStart = { x: e.clientX, y: e.clientY };
  spCropPosStart  = { x: spCropX, y: spCropY };
}

function spCropMouseMove(e) {
  if (!spCropDragging) return;
  spCropX = spCropPosStart.x + (e.clientX - spCropDragStart.x);
  spCropY = spCropPosStart.y + (e.clientY - spCropDragStart.y);
  spDrawCrop();
}

function spCropMouseUp() { spCropDragging = false; }

function spCropWheel(e) {
  e.preventDefault();
  spCropScale = Math.max(0.1, Math.min(5, spCropScale - e.deltaY * 0.001));
  spDrawCrop();
}

function spCropApply() {
  if (!spCropImg) return;
  const out = document.createElement('canvas');
  out.width = out.height = 240;
  const ctx = out.getContext('2d');
  ctx.beginPath(); ctx.arc(120, 120, 120, 0, Math.PI*2); ctx.clip();
  ctx.drawImage(spCropImg, spCropX, spCropY, spCropImg.width * spCropScale, spCropImg.height * spCropScale);
  const dataUrl = out.toDataURL('image/png');

  const preview = document.getElementById('sp-avatar-preview');
  preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;

  const sidebarAvatar = document.getElementById('companion-avatar');
  if (sidebarAvatar) {
    sidebarAvatar.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover"/>`;
  }

  _spAvatarChanged = true;
  _spNewAvatarData = dataUrl;

  // Update cached avatar_url so spPopulateCompanion shows the new preview
  const companions = spSettings?.companions || [];
  const c = companions.find(x => x.folder === spActiveFolder);
  if (c) c.avatar_url = dataUrl; // temporary data URL for preview only

  spPopulateCompanion();
  document.getElementById('sp-crop-wrap').style.display = 'none';
  _spSetDirty('companion');
}

document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('sp-avatar-zone');
  if (zone) {
    zone.addEventListener('dragenter', () => zone.classList.add('drag-over'));
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  }
});

// ── Soul file editor ───────────────────────────────────────────────────────────
async function spLoadSoulFiles() {
  const folder = spActiveFolder;
  const wrap   = document.getElementById('sp-soul-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:4px 0">Loading…</div>';

  try {
    const res   = await fetch(`/api/settings/soul/${folder}`);
    const data  = await res.json();
    const files = data.files || {};

    wrap.innerHTML = '';
    if (!Object.keys(files).length) {
      wrap.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:4px 0">No soul files yet.</div>';
      return;
    }

    Object.entries(files).forEach(([fname, content]) => {
      const btn = document.createElement('button');
      btn.className = 'sp-soul-btn' + (spCurrentSoulFile === fname ? ' active' : '');
      btn.textContent = fname;
      btn.onclick = () => spEditSoulFile(fname, content);
      wrap.appendChild(btn);
    });
  } catch (e) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--red);padding:4px 0">Could not load soul files.</div>';
  }
}

function spEditSoulFile(fname, content) {
  spCurrentSoulFile = fname;
  document.querySelectorAll('.sp-soul-btn').forEach(b =>
    b.classList.toggle('active', b.textContent === fname));
  const editor = document.getElementById('sp-soul-editor');
  const nameEl = document.getElementById('sp-soul-filename');
  if (editor) editor.value = content;
  if (nameEl) nameEl.textContent = fname;
  const editorWrap = document.getElementById('sp-soul-editor-wrap');
  if (editorWrap) editorWrap.style.display = 'flex';
}

async function spSaveSoulFile() {
  const fname   = spCurrentSoulFile;
  const content = document.getElementById('sp-soul-editor')?.value || '';
  if (!fname) return;
  await fetch(`/api/settings/soul/${spActiveFolder}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ filename: fname, content }),
  });
  spShowSavedToast(`${fname} saved ✓`);
}

async function spDeleteSoulFile() {
  const fname = spCurrentSoulFile;
  if (!fname || !confirm(`Delete ${fname}? This cannot be undone.`)) return;
  const res  = await fetch(`/api/settings/soul/${spActiveFolder}/delete`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ filename: fname }),
  });
  const data = await res.json();
  if (data.ok) {
    spCurrentSoulFile = null;
    document.getElementById('sp-soul-editor-wrap').style.display = 'none';
    spLoadSoulFiles();
  } else {
    alert(data.error || 'Could not delete.');
  }
}
