// companion.js — Dedicated companion settings window
// Opens via gear icon next to companion name in sidebar
// Tabs: Identity | Generation | Memory | Heartbeat | Presence

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
  _cpPresenceInitDone = false;  // reset so next open re-fetches fresh data
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
  if (tab === 'memory') cpLoadSoulFiles();
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
  cpDirty = true;
}

function cpAvatarReset() {
  const preview = document.getElementById('cp-avatar-preview');
  if (preview) preview.innerHTML = '✦';
  const resetWrap = document.getElementById('cp-avatar-reset-wrap');
  if (resetWrap) resetWrap.style.display = 'none';
  cpDirty = true;
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
  // Show toast immediately so UI feels responsive
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
      ..._cpGetPresencePayload(),
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
    }

    // ── Apply the active preset to the live orb right now ──
    if (typeof applyPresencePreset === 'function') {
      const livePreset = _cpPresenceData[_cpActivePreset];
      if (livePreset) {
        const orbEl      = document.getElementById('companion-orb');
        const states     = ['thinking', 'streaming', 'heartbeat', 'chaos', 'idle'];
        const activeState = states.find(s => orbEl?.classList.contains(s)) || 'idle';
        const stateData   = livePreset[activeState] || livePreset.thinking || {};
        applyPresencePreset({ state: activeState, ...stateData });
      }
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
    if (andClose) {
      _cpPresenceInitDone = false;
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

// ── Presence tab ──────────────────────────────────────────────────────────────
let _cpPresenceData    = {};        // { presetName: { thinking:{...}, streaming:{...}, ... } }
let _cpActivePreset    = 'Default';
let _cpEditingState    = 'thinking';
let _cpPresenceDirty   = false;
let _cpPresenceInitDone = false;    // guard — prevents tab-switch from wiping edits

const CP_STATE_DEFAULTS = {
  thinking:  { glowColor:'rgba(129,140,248,0.4)',   glowMax:16, glowSpeed:2.0, ringSpeed:1.8, dotColor:'#818cf8', dotSpeed:1.2, breathSpeed:3.0, orbSize:52 },
  streaming: { glowColor:'rgba(109,212,168,0.35)',  glowMax:12, glowSpeed:2.5, ringSpeed:2.4, dotColor:'#6dd4a8', dotSpeed:1.4, breathSpeed:3.0, orbSize:52 },
  heartbeat: { glowColor:'rgba(167,139,250,0.45)',  glowMax:20, glowSpeed:1.4, ringSpeed:1.4, dotColor:'#a78bfa', dotSpeed:0.9, breathSpeed:2.0, orbSize:52 },
  chaos:     { glowColor:'rgba(251,191,36,0.5)',    glowMax:24, glowSpeed:0.8, ringSpeed:0.9, dotColor:'#fbbf24', dotSpeed:0.6, breathSpeed:0.6, orbSize:52 },
  idle:      { glowColor:'rgba(129,140,248,0.15)',  glowMax:6,  glowSpeed:4.0, ringSpeed:4.0, dotColor:'#818cf8', dotSpeed:2.0, breathSpeed:5.0, orbSize:52 },
};

function cpPresenceInit() {
  const cfg = cpSettings || {};

  _cpPresenceData = JSON.parse(JSON.stringify(
    cfg.presence_presets || { Default: JSON.parse(JSON.stringify(CP_STATE_DEFAULTS)) }
  ));

  _cpActivePreset = cfg.active_companion?.active_presence_preset
                 || cfg.config?.active_presence_preset
                 || cfg.active_presence_preset
                 || 'Default';

  // Ensure the active preset actually exists
  if (!_cpPresenceData[_cpActivePreset]) {
    _cpPresenceData[_cpActivePreset] = JSON.parse(JSON.stringify(CP_STATE_DEFAULTS));
  }

  _cpEditingState     = 'thinking';
  _cpPresenceInitDone = true;

  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);

  // Mirror companion avatar into the preview orb
  const avSrc = document.querySelector('#companion-avatar img')?.src;
  const previewIcon = document.getElementById('cpp-icon');
  if (previewIcon && avSrc) {
    previewIcon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  }
}

function cpPresenceRenderPresets() {
  const bar = document.getElementById('cp-preset-bar');
  if (!bar) return;
  bar.innerHTML = '';
  Object.keys(_cpPresenceData).forEach(name => {
    const chip = document.createElement('div');
    chip.className = 'cp-preset-chip' + (name === _cpActivePreset ? ' active' : '');
    chip.innerHTML = `<span>${name}</span>`;
    if (name !== 'Default' && name !== 'Warm') {
      const del = document.createElement('span');
      del.className = 'cp-preset-del';
      del.title = 'Delete preset';
      del.textContent = '×';
      del.onclick = (e) => { e.stopPropagation(); cpPresenceDeletePreset(name); };
      chip.appendChild(del);
    }
    chip.addEventListener('click', () => cpPresenceSelectPreset(name));
    bar.appendChild(chip);
  });
}

function cpPresenceSelectPreset(name) {
  if (!_cpPresenceData[name]) return;
  _cpActivePreset = name;
  const badge = document.getElementById('cp-editing-preset-badge');
  if (badge) badge.textContent = name;
  document.querySelectorAll('.cp-preset-chip').forEach(c => {
    c.classList.toggle('active', c.querySelector('span')?.textContent === name);
  });
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

  const setSlider = (id, val, suffix) => {
    const el  = document.getElementById(id);
    const lbl = document.getElementById(id + '-val');
    if (el)  el.value = val;
    if (lbl) lbl.textContent = val + suffix;
  };
  setSlider('ps-glow-max',     s.glowMax,     'px');
  setSlider('ps-glow-speed',   s.glowSpeed,   's');
  setSlider('ps-ring-speed',   s.ringSpeed,   's');
  setSlider('ps-dot-speed',    s.dotSpeed,    's');
  setSlider('ps-breath-speed', s.breathSpeed, 's');
  setSlider('ps-orb-size',     s.orbSize,     'px');

  const color = s.dotColor || '#818cf8';
  const ci = document.getElementById('cp-color-input');
  const cp = document.getElementById('cp-color-picker');
  const cd = document.getElementById('cp-color-dot');
  if (ci) ci.value = color;
  if (cp) cp.value = cpColorToHex(color);
  if (cd) cd.style.background = color;

  cpPresenceUpdatePreview(s, state);
}

function cpPresenceSlider(id, key, val, suffix) {
  const lbl = document.getElementById(id + '-val');
  if (lbl) lbl.textContent = val + suffix;
  cpPresenceSetValue(key, parseFloat(val));
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceSetValue(key, val) {
  if (!_cpPresenceData[_cpActivePreset]) _cpPresenceData[_cpActivePreset] = {};
  if (!_cpPresenceData[_cpActivePreset][_cpEditingState]) {
    _cpPresenceData[_cpActivePreset][_cpEditingState] = {};
  }
  _cpPresenceData[_cpActivePreset][_cpEditingState][key] = val;
  _cpPresenceDirty = true;
}

function cpPresenceSetColor(hex) {
  const rgba = _hexToRgba(hex, 0.4);
  cpPresenceSetValue('glowColor', rgba);
  cpPresenceSetValue('dotColor',  hex);
  const ci = document.getElementById('cp-color-input');
  const cd = document.getElementById('cp-color-dot');
  if (ci) ci.value = hex;
  if (cd) cd.style.background = hex;
  document.querySelectorAll('#cpp-dots span').forEach(s => s.style.background = hex);
  cpPresenceUpdatePreviewFromCurrent();
}

function cpPresenceColorInput(val) {
  const hex = val.startsWith('#') ? val : '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
    const cp = document.getElementById('cp-color-picker');
    if (cp) cp.value = hex;
    cpPresenceSetColor(hex);
  }
}

function cpPresenceColorPick(hex) {
  cpPresenceSetColor(hex);
  const ci = document.getElementById('cp-color-input');
  if (ci) ci.value = hex;
}

function cpPresenceUpdatePreviewFromCurrent() {
  const preset = _cpPresenceData[_cpActivePreset] || {};
  const s = Object.assign({}, CP_STATE_DEFAULTS[_cpEditingState], preset[_cpEditingState] || {});
  cpPresenceUpdatePreview(s, _cpEditingState);
}

function cpPresenceUpdatePreview(s, state) {
  const orb  = document.getElementById('cpp-orb');
  const dots = document.getElementById('cpp-dots');
  const icon = document.getElementById('cpp-icon');
  const ring = orb?.querySelector('.cpp-ring');
  if (!orb) return;

  const size = (s.orbSize || 52) + 'px';
  orb.style.width  = size;
  orb.style.height = size;
  orb.style.background = cpDeriveGlowColor(s.dotColor || '#818cf8', 0.1);
  orb.style.border     = `2px solid ${cpDeriveGlowColor(s.dotColor || '#818cf8', 0.35)}`;
  orb.style.animation  = `cppGlow ${s.glowSpeed||2}s ease-in-out infinite, cppBreath ${s.breathSpeed||3}s ease-in-out infinite`;
  orb.style.setProperty('--cpp-glow-color', s.glowColor || 'rgba(129,140,248,0.4)');
  orb.style.setProperty('--cpp-glow-min',   '4px');
  orb.style.setProperty('--cpp-glow-max',   (s.glowMax || 16) + 'px');

  if (ring) {
    ring.style.animation = `cppRing ${s.ringSpeed||1.8}s ease-out infinite`;
    ring.style.setProperty('--cpp-ring-color', cpDeriveGlowColor(s.dotColor || '#818cf8', 0.3));
  }

  if (dots) {
    dots.style.width = size;
    dots.querySelectorAll('span').forEach((d, i) => {
      d.style.background = s.dotColor || '#818cf8';
      const delay = [0, 0.18, 0.36][i];
      d.style.animation = `cppDot ${s.dotSpeed||1.2}s ease-in-out ${delay}s infinite`;
      d.style.opacity = '1';
    });
  }

  if (icon) {
    icon.style.color    = s.dotColor || '#818cf8';
    icon.style.fontSize = Math.round((s.orbSize || 52) * 0.42) + 'px';
    const avSrc = document.querySelector('#companion-avatar img')?.src;
    if (avSrc && !icon.querySelector('img')) {
      icon.innerHTML = `<img src="${avSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    }
  }
}

function cpPresenceNewPreset() {
  const name = prompt('Preset name:');
  if (!name?.trim()) return;
  const n = name.trim();
  if (_cpPresenceData[n]) { alert('A preset with that name already exists.'); return; }
  _cpPresenceData[n] = JSON.parse(JSON.stringify(_cpPresenceData['Default'] || CP_STATE_DEFAULTS));
  _cpActivePreset = n;
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(n);
  _cpPresenceDirty = true;
}

function cpPresenceDeletePreset(name) {
  if (name === 'Default' || name === 'Warm') return;
  if (!confirm(`Delete preset "${name}"?`)) return;
  delete _cpPresenceData[name];
  if (_cpActivePreset === name) _cpActivePreset = 'Default';
  cpPresenceRenderPresets();
  cpPresenceSelectPreset(_cpActivePreset);
  _cpPresenceDirty = true;
}

// ── Presence helpers ──────────────────────────────────────────────────────────
function cpColorToHex(color) {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  return color.startsWith('#') ? color : '#818cf8';
}

function cpDeriveGlowColor(color, alpha) {
  if (color.startsWith('#')) return _hexToRgba(color, alpha);
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;
  return color;
}

function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _cpGetPresencePayload() {
  return {
    presence_presets:       _cpPresenceData,
    active_presence_preset: _cpActivePreset,
  };
}
