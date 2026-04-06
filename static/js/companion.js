// companion.js — Companion settings window: coordinator, identity, generation,
//               memory, heartbeat, avatar, save/load.
// Loaded before companion-presence.js.
// Depends on: orb.js, chat-ui.js
//
// Presence logic lives in companion-presence.js.
// Mood logic will live in companion-mood.js (future).

// ── State ─────────────────────────────────────────────────────────────────────
let cpSettings = null;   // loaded from /api/settings
let cpFolder   = '';     // active companion folder
let cpSoulFile = null;   // currently selected soul file name
let cpDirty    = false;  // unsaved changes flag

// ── Dirty tracking ────────────────────────────────────────────────────────────
function cpMarkDirty() {
  cpDirty = true;
  _cpUpdateFooterButtons();
}

function cpClearDirty() {
  cpDirty = false;
  _cpUpdateFooterButtons();
}

function _cpUpdateFooterButtons() {
  document.querySelectorAll('.companion-panel-footer .sp-btn-ghost, .companion-panel-footer .sp-btn-primary')
    .forEach(btn => {
      if (btn.textContent.includes('Apply') || btn.textContent.includes('Save')) {
        btn.style.background  = cpDirty ? 'rgba(251,191,36,0.15)' : '';
        btn.style.borderColor = cpDirty ? 'rgba(251,191,36,0.5)'  : '';
        btn.style.color       = cpDirty ? 'rgba(251,191,36,0.9)'  : '';
      }
    });
}

// ── Open / close ──────────────────────────────────────────────────────────────
async function openCompanionWindow() {
  const overlay = document.getElementById('companion-overlay');
  overlay.classList.add('open');
  _cpShowLoadingState(true);
  await cpLoad();
  _cpShowLoadingState(false);
  cpSwitchTab('identity');
}

function _cpShowLoadingState(isLoading) {
  const panel = document.querySelector('.companion-panel');
  if (!panel) return;

  const toggleEls = panel.querySelectorAll(
    '.companion-tabs-strip, .cp-tab-body, .companion-panel-footer'
  );
  let spinner = panel.querySelector('.cp-loading-spinner');
  if (!spinner) {
    spinner = document.createElement('div');
    spinner.className = 'panel-loading-spinner cp-loading-spinner';
    const header = panel.querySelector('.companion-panel-header');
    if (header) header.after(spinner);
    else panel.prepend(spinner);
  }

  if (isLoading) {
    spinner.style.display = 'flex';
    toggleEls.forEach(el => { el.style.visibility = 'hidden'; el.style.opacity = '0'; });
  } else {
    spinner.style.display = 'none';
    toggleEls.forEach(el => {
      el.style.visibility = '';
      el.style.transition = 'opacity 0.18s ease';
      el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = ''; }));
    });
  }
}

function closeCompanionWindow() {
  if (cpDirty) {
    if (!confirm('You have unsaved changes. Close anyway?')) return;
  }
  cpPresenceReset();  // allow fresh init on next open (defined in companion-presence.js)
  if (typeof cpTtsReset === 'function') cpTtsReset();
  if (typeof cpMemoryReset === 'function') cpMemoryReset();
  cpClearDirty();
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
    cpClearDirty();
    cpPopulate();
  } catch(e) { console.warn('cpLoad failed:', e); }
}

function cpPopulate() {
  const cfg = cpSettings || {};
  const c   = cfg.active_companion || {};
  const g   = c.generation || {};

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

  const resetWrap = document.getElementById('cp-avatar-reset-wrap');
  if (resetWrap) resetWrap.style.display = c.avatar_data ? 'inline' : 'none';

  const soulMode = c.soul_edit_mode || 'locked';
  document.querySelectorAll('#cp-soul-edit-mode input[name="cp-soul-edit"]').forEach(r => {
    r.checked = r.value === soulMode;
  });

  const frEl = document.getElementById('cp-force-read');
  if (frEl) frEl.classList.toggle('on', c.force_read_before_write !== false);

  // ── Generation ── (blank = inherit global)
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

  // ── Memory (soul files + ChromaDB settings) ──
  cpLoadSoulFiles();
  if (typeof cpMemoryPopulate === 'function') cpMemoryPopulate();

  // ── Presence ──
  cpPresenceInit();

  // ── Voice (TTS) ── populate if tab already initialised
  if (_cpTtsInitDone && typeof cpTtsPopulate === 'function') {
    cpTtsPopulate(c.tts || {});
  }

  // ── Heartbeat ──
  const hb = c.heartbeat || {};
  const hbTog = (id, val) => { const el = document.getElementById(id); if (el) el.classList.toggle('on', !!val); };
  hbTog('cp-hb-silent',   hb.silent_enabled);
  hbTog('cp-hb-message',  hb.message_enabled);
  hbTog('cp-hb-idle',     hb.idle_trigger);
  hbTog('cp-hb-conv-end', hb.conversation_end_trigger);
  hbTog('cp-hb-session',  hb.session_start_trigger);
  hbTog('cp-hb-ctx',      hb.context_threshold_trigger);
  const idleMin = document.getElementById('cp-hb-idle-min'); if (idleMin) idleMin.value = hb.idle_minutes         ?? 15;
  const ctxPct  = document.getElementById('cp-hb-ctx-pct');  if (ctxPct)  ctxPct.value  = hb.context_threshold_pct ?? 75;

  const instr    = hb.instructions || {};
  const instrVal = (key) => typeof instr === 'string' ? (key === 'default' ? instr : '') : (instr[key] || '');
  const instrIds = ['default','idle','conversation-end','session-start','context-threshold','manual'];
  instrIds.forEach(key => {
    const el = document.getElementById(`cp-hb-instr-${key}`);
    if (el) el.value = instrVal(key.replace('-', '_'));
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function cpSwitchTab(tab) {
  document.querySelectorAll('.cp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.cp-tab-body').forEach(b => b.classList.toggle('active', b.id === `cp-tab-${tab}`));
  if (tab === 'memory') {
    cpLoadSoulFiles();
    if (typeof cpMemoryInit === 'function') cpMemoryInit();
  }
  if (tab === 'presence') {
    // Only do a full init if presence data hasn't been loaded yet this session.
    // If already loaded (user made edits), just re-render so changes are preserved.
    if (!_cpPresenceInitDone) {
      cpPresenceInit();
    } else {
      cpPresenceRenderPresets();
      cpPresenceRenderState(_cpEditingState);
    }
  }
  if (tab === 'voice') {
    if (typeof cpTtsInit === 'function') cpTtsInit();
  }
}

// ── Avatar ────────────────────────────────────────────────────────────────────
let _cpCropper    = null;
let _cpAvatarFull = null;

function cpAvatarBrowse() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { if (inp.files[0]) cpAvatarLoad(inp.files[0]); };
  inp.click();
}

function cpAvatarDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) cpAvatarLoad(file);
}

function cpAvatarLoad(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    _cpAvatarFull = ev.target.result;
    const wrap = document.getElementById('cp-crop-wrap');
    const img  = document.getElementById('cp-crop-img');
    if (wrap && img) {
      img.src = _cpAvatarFull;
      wrap.style.display = 'block';
      if (_cpCropper) { _cpCropper.destroy(); _cpCropper = null; }
      if (typeof Cropper !== 'undefined') {
        _cpCropper = new Cropper(img, { aspectRatio: 1, viewMode: 1, autoCropArea: 0.8 });
      }
    }
  };
  reader.readAsDataURL(file);
}

function cpAvatarCrop() {
  if (!_cpCropper) {
    const preview = document.getElementById('cp-avatar-preview');
    if (preview && _cpAvatarFull) {
      preview.innerHTML = `<img src="${_cpAvatarFull}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    }
    document.getElementById('cp-crop-wrap').style.display = 'none';
    return;
  }
  const canvas = _cpCropper.getCroppedCanvas({ width: 256, height: 256 });
  const data   = canvas.toDataURL('image/jpeg', 0.85);
  const preview = document.getElementById('cp-avatar-preview');
  if (preview) preview.innerHTML = `<img src="${data}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  document.getElementById('cp-crop-wrap').style.display = 'none';
  _cpCropper.destroy(); _cpCropper = null;
  const resetWrap = document.getElementById('cp-avatar-reset-wrap');
  if (resetWrap) resetWrap.style.display = 'inline';
  cpMarkDirty();
}

function cpAvatarReset() {
  const preview = document.getElementById('cp-avatar-preview');
  if (preview) preview.innerHTML = '✦';
  const resetWrap = document.getElementById('cp-avatar-reset-wrap');
  if (resetWrap) resetWrap.style.display = 'none';
  cpMarkDirty();
}

function cpAvatarFile(input) {
  if (input.files[0]) cpAvatarLoad(input.files[0]);
}

// ── Soul files ────────────────────────────────────────────────────────────────
async function cpLoadSoulFiles() {
  try {
    const res   = await fetch(`/api/settings/soul/${cpFolder}`);
    const data  = await res.json();
    const files = data.files || {};
    const tabsEl = document.getElementById('cp-soul-tabs');
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    cpSoulFile = null;
    const contentEl = document.getElementById('cp-soul-content');
    const saveBtn   = document.getElementById('cp-soul-save-btn');
    if (contentEl) contentEl.value = '';
    if (saveBtn)   saveBtn.style.display = 'none';

    Object.keys(files).forEach(fname => {
      const tab = document.createElement('button');
      tab.className = 'cp-soul-tab';
      tab.textContent = fname;
      tab.onclick = () => {
        document.querySelectorAll('.cp-soul-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        cpSoulFile = fname;
        if (contentEl) contentEl.value = files[fname];
        if (saveBtn)   saveBtn.style.display = 'inline-flex';
      };
      tabsEl.appendChild(tab);
    });
  } catch(e) { console.warn('cpLoadSoulFiles failed:', e); }
}

async function cpSaveSoulFile() {
  if (!cpSoulFile) return;
  const content = document.getElementById('cp-soul-content')?.value || '';
  await fetch(`/api/settings/soul/${cpFolder}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: cpSoulFile, content }),
  });
  cpShowToast('Soul file saved ✓');
}

function cpNewSoulFile() {
  const name = prompt('File name (e.g. identity.md):');
  if (!name) return;
  const fname = name.endsWith('.md') || name.endsWith('.txt') ? name : name + '.md';
  const tabsEl    = document.getElementById('cp-soul-tabs');
  const contentEl = document.getElementById('cp-soul-content');
  const saveBtn   = document.getElementById('cp-soul-save-btn');
  const tab = document.createElement('button');
  tab.className = 'cp-soul-tab active';
  tab.textContent = fname;
  tab.onclick = () => {
    document.querySelectorAll('.cp-soul-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    cpSoulFile = fname;
    if (contentEl) contentEl.value = '';
    if (saveBtn)   saveBtn.style.display = 'inline-flex';
  };
  tabsEl?.appendChild(tab);
  cpSoulFile = fname;
  if (contentEl) contentEl.value = '';
  if (saveBtn)   saveBtn.style.display = 'inline-flex';
  document.querySelectorAll('.cp-soul-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function cpSave(andClose = false) {
  cpShowToast('Saving…');

  try {
    const g = {};
    const getGen = (id, key, parser) => {
      const v = document.getElementById(id)?.value;
      if (v !== '' && v !== undefined) g[key] = parser(v);
    };
    getGen('cp-g-temp',   'temperature',        parseFloat);
    getGen('cp-g-topp',   'top_p',              parseFloat);
    getGen('cp-g-topk',   'top_k',              parseInt);
    getGen('cp-g-minp',   'min_p',              parseFloat);
    getGen('cp-g-rpen',   'repeat_penalty',     parseFloat);
    getGen('cp-g-maxt',   'max_tokens',         parseInt);
    getGen('cp-g-pres',   'presence_penalty',   parseFloat);
    getGen('cp-g-freq',   'frequency_penalty',  parseFloat);
    getGen('cp-g-rounds', 'max_tool_rounds',    parseInt);
    getGen('cp-g-dry-m',  'dry_multiplier',     parseFloat);
    getGen('cp-g-dry-b',  'dry_base',           parseFloat);
    getGen('cp-g-dry-l',  'dry_allowed_length', parseInt);

    const tog = id => document.getElementById(id)?.classList.contains('on') ?? false;
    const hb = {
      silent_enabled:            tog('cp-hb-silent'),
      message_enabled:           tog('cp-hb-message'),
      idle_trigger:              tog('cp-hb-idle'),
      conversation_end_trigger:  tog('cp-hb-conv-end'),
      session_start_trigger:     tog('cp-hb-session'),
      context_threshold_trigger: tog('cp-hb-ctx'),
      idle_minutes:              parseInt(document.getElementById('cp-hb-idle-min')?.value) || 15,
      context_threshold_pct:     parseInt(document.getElementById('cp-hb-ctx-pct')?.value)  || 75,
      instructions: {
        default:           document.getElementById('cp-hb-instr-default')?.value           || '',
        idle:              document.getElementById('cp-hb-instr-idle')?.value              || '',
        conversation_end:  document.getElementById('cp-hb-instr-conversation-end')?.value  || '',
        session_start:     document.getElementById('cp-hb-instr-session-start')?.value     || '',
        context_threshold: document.getElementById('cp-hb-instr-context-threshold')?.value || '',
        manual:            document.getElementById('cp-hb-instr-manual')?.value            || '',
      },
    };

    const avatarImg  = document.getElementById('cp-avatar-preview')?.querySelector('img');
    const avatarData = avatarImg?.src || '';

    const body = {
      folder:                  cpFolder,
      companion_name:          document.getElementById('cp-companion-name')?.value.trim() || '',
      avatar_data:             avatarData,
      generation:              g,
      soul_edit_mode:          document.querySelector('#cp-soul-edit-mode input[name="cp-soul-edit"]:checked')?.value || 'locked',
      force_read_before_write: document.getElementById('cp-force-read')?.classList.contains('on') ?? true,
      heartbeat:               hb,
      ..._cpGetPresencePayload(),   // from companion-presence.js
      ...(typeof _cpGetMemoryPayload === 'function' ? _cpGetMemoryPayload() : {}),
      ...(typeof _cpGetTtsPayload === 'function' ? _cpGetTtsPayload() : {}),
      // ..._cpGetMoodPayload(),    // from companion-mood.js (future)
    };

    const res = await fetch('/api/settings/companion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.warn('cpSave failed:', await res.text()); cpShowToast('Save failed ✗'); return; }

    // ── Update cpSettings cache so reopening the window shows correct values ──
    if (cpSettings) {
      if (!cpSettings.active_companion) cpSettings.active_companion = {};
      cpSettings.active_companion.companion_name          = body.companion_name;
      cpSettings.active_companion.avatar_data             = body.avatar_data;
      cpSettings.active_companion.generation              = body.generation;
      cpSettings.active_companion.soul_edit_mode          = body.soul_edit_mode;
      cpSettings.active_companion.force_read_before_write = body.force_read_before_write;
      cpSettings.active_companion.heartbeat               = body.heartbeat;
      cpSettings.active_companion.active_presence_preset  = body.active_presence_preset;
      cpSettings.presence_presets                         = body.presence_presets;
      cpSettings.active_companion.tts                     = body.tts;
    }

    // ── Apply the active preset to the live orb right now ──
    if (typeof applyPresencePreset === 'function') {
      const livePreset = _cpPresenceData[_cpActivePreset];
      if (livePreset) applyPresencePreset(livePreset);
    }

    // ── Update sidebar immediately ──
    const nameEl = document.getElementById('companion-name');
    if (nameEl) nameEl.textContent = body.companion_name || 'Companion';
    const avatarEl = document.getElementById('companion-avatar');
    if (avatarEl) {
      avatarEl.innerHTML = body.avatar_data
        ? `<img src="${body.avatar_data}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`
        : '✦';
    }
    const cpHeaderName = document.getElementById('cp-header-name');
    if (cpHeaderName) cpHeaderName.textContent = body.companion_name || 'Companion';
    const cpHeaderAv = document.getElementById('cp-header-avatar');
    if (cpHeaderAv && body.avatar_data) {
      cpHeaderAv.innerHTML = `<img src="${body.avatar_data}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
    }
    if (typeof syncStatusAvatar === 'function') syncStatusAvatar();
    if (typeof heartbeatReload  === 'function') heartbeatReload();

    if (typeof config !== 'undefined') {
      config.force_read_before_write = body.force_read_before_write;
      if (body.generation && config.generation) Object.assign(config.generation, body.generation);
    }

    cpShowToast('Companion saved ✓');
    cpClearDirty();
    if (andClose) {
      cpPresenceReset();
      closeCompanionWindow();
    }

  } catch(e) {
    console.warn('cpSave failed:', e);
    cpShowToast('Save failed ✗');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _cpToastTimer = null;
function cpShowToast(msg) {
  let toast = document.getElementById('cp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cp-toast';
    toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#21232e;border:1px solid rgba(109,212,168,0.3);border-radius:10px;padding:8px 18px;font-size:13px;color:#6dd4a8;z-index:10000;pointer-events:none;transition:opacity .25s ease';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  if (_cpToastTimer) clearTimeout(_cpToastTimer);
  _cpToastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}
