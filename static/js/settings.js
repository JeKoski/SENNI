// ── Settings panel ────────────────────────────────────────────────────────────

const BUILTIN_ARGS = [
  // Core — always recommended on
  { key:'ngl',              flag:'-ngl',                desc:'GPU layers to offload',                   type:'number', default:99,            defaultOn:true  },
  { key:'ctx',              flag:'-c',                  desc:'Context window size',                     type:'number', default:16384,          defaultOn:true  },
  { key:'np',               flag:'-np',                 desc:'Parallel slots',                          type:'number', default:1,              defaultOn:true  },
  { key:'ctk',              flag:'-ctk',                desc:'KV cache key quantisation',               type:'text',   default:'q8_0',         defaultOn:true  },
  { key:'ctv',              flag:'-ctv',                desc:'KV cache value quantisation',             type:'text',   default:'q8_0',         defaultOn:true  },
  { key:'jinja',            flag:'--jinja',             desc:'Jinja2 chat templates (required for most models)', type:'flag', default:null,   defaultOn:true  },
  { key:'reasoning_format', flag:'--reasoning-format',  desc:'Thinking format (deepseek for Qwen3)',    type:'text',   default:'deepseek',    defaultOn:true  },
  // KV cache / performance — on by default, broadly safe
  { key:'cache_reuse',      flag:'--cache-reuse',       desc:'Reuse KV cache across turns (reduces re-processing)', type:'number', default:256, defaultOn:true },
  { key:'batch',            flag:'-b',                  desc:'Batch size (prompt processing)',          type:'number', default:256,            defaultOn:true  },
  { key:'ubatch',           flag:'-ub',                 desc:'Micro-batch size',                        type:'number', default:256,            defaultOn:true  },
  // Off by default — hardware/situation dependent
  { key:'flash_attn',       flag:'--flash-attn',        desc:'Flash attention — big speed win, needs compatible GPU', type:'flag', default:null, defaultOn:false },
  { key:'prompt_cache',     flag:'--prompt-cache',      desc:'Persist KV cache to disk (faster cold starts)', type:'text', default:'senni.cache', defaultOn:false },
  { key:'mlock',            flag:'--mlock',             desc:'Lock model in RAM — prevents swapping',   type:'flag',   default:null,          defaultOn:false },
  { key:'no_mmap',          flag:'--no-mmap',           desc:'Disable memory mapping',                 type:'flag',   default:null,          defaultOn:false },
  { key:'threads',          flag:'-t',                  desc:'Thread count (0 = auto)',                 type:'number', default:0,             defaultOn:false },
];

let spSettings       = null;   // full settings object from /api/settings
let spActiveFolder   = '';
let spCropImg        = null;   // raw Image for cropping
let spCropX          = 0;
let spCropY          = 0;
let spCropScale      = 1;
let spCropDragging   = false;
let spCropDragStart  = null;
let spCropPosStart   = null;
let spCurrentSoulFile = null;
let spServerDirty    = false;

async function openSettings() {
  document.getElementById('settings-overlay').classList.add('open');
  await spLoad();
  spSwitchTab('server');  // ensure a tab is always visible on open
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

function closeSettingsIfBg(e) {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
}

function spSwitchTab(name) {
  document.querySelectorAll('.sp-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-body').forEach(b =>
    b.classList.toggle('active', b.id === 'tab-' + name));
  // Show the matching sticky footer, hide others
  ['server','generation','companion'].forEach(tab => {
    const f = document.getElementById('sp-footer-' + tab);
    if (f) f.style.display = (tab === name) ? 'flex' : 'none';
  });
}

// ── Saved toast ───────────────────────────────────────────────────────────────
let _toastTimer = null;

function spShowSavedToast(msg = 'Saved ✓') {
  // Cancel any pending hide timer and reuse existing toast if present
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

  let toast = document.getElementById('sp-saved-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sp-saved-toast';
    toast.style.cssText = [
      'position:fixed','bottom:28px','left:50%','transform:translateX(-50%) translateY(0)',
      'background:#21232e','border:1px solid rgba(109,212,168,0.3)',
      'color:rgba(109,212,168,0.9)','font-family:"DM Sans",sans-serif',
      'font-size:13px','font-weight:500','padding:9px 20px',
      'border-radius:20px','z-index:10000',
      'animation:spToastIn .2s ease both',
      'pointer-events:none','transition:opacity .2s'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.animation = 'none';
  toast.style.opacity   = '1';

  _toastTimer = setTimeout(() => {
    toast.style.animation = 'spToastOut .3s ease forwards';
    _toastTimer = setTimeout(() => { toast.remove(); _toastTimer = null; }, 300);
  }, 1800);
}

async function spLoad() {
  try {
    const res  = await fetch('/api/settings');
    spSettings = await res.json();
    spActiveFolder = spSettings.config?.companion_folder || 'default';
    spPopulateServer();
    spPopulateGeneration();
    spPopulateCompanion();
    spPopulateAbout();
  } catch(e) { console.warn('Settings load failed:', e); }
}

// ── Server tab ────────────────────────────────────────────────────────────────
function spPopulateServer() {
  const cfg = spSettings.config || {};

  // Pre-load scan results for the native file picker auto-match
  fetch('/api/scan/models').then(r => r.json()).then(d => { _spScanResults = d.gguf_files || []; }).catch(() => {});

  // Model / mmproj
  const mp = cfg.model_path || '';
  const md = document.getElementById('sp-model-display');
  md.textContent = mp ? mp.split(/[\\/]/).pop() : '—';
  md.title = mp;
  md.className = 'sp-file-display' + (mp ? ' set' : '');

  const mm = cfg.mmproj_path || '';
  const mmd = document.getElementById('sp-mmproj-display');
  mmd.textContent = mm ? mm.split(/[\\/]/).pop() : 'No mmproj';
  mmd.title = mm;
  mmd.className = 'sp-file-display' + (mm ? ' set' : '');

  document.getElementById('sp-gpu').value         = cfg.gpu_type    || 'cpu';
  document.getElementById('sp-port-bridge').value = cfg.port_bridge || 8000;
  document.getElementById('sp-port-model').value  = cfg.port_model  || 8081;

  // Built-in args
  const savedArgs = cfg.server_args || {};
  const wrap = document.getElementById('sp-builtin-args');
  wrap.innerHTML = '';
  BUILTIN_ARGS.forEach(arg => {
    const saved   = savedArgs[arg.key] || {};
    const enabled = saved.enabled !== undefined ? saved.enabled : (arg.defaultOn !== false);
    const val     = saved.value   !== undefined ? saved.value   : arg.default;
    const isFlag  = arg.type === 'flag';

    const row = document.createElement('div');
    row.className = 'sp-arg-row' + (enabled ? '' : ' disabled');
    row.id = 'arg-row-' + arg.key;
    row.innerHTML = `
      <div class="sp-tog ${enabled ? 'on' : ''}" onclick="spToggleArg('${arg.key}', this)"></div>
      <div class="sp-arg-flag">${arg.flag}</div>
      <div class="sp-arg-desc">${arg.desc}</div>
      <input class="sp-arg-val ${isFlag ? 'flag-only' : (arg.type==='text' ? 'wide' : '')}"
        id="arg-val-${arg.key}"
        type="${isFlag ? 'text' : arg.type}"
        value="${isFlag ? '' : (val ?? '')}"
        placeholder="${isFlag ? '(flag)' : ''}"
        ${isFlag ? 'disabled' : ''}
      />`;
    wrap.appendChild(row);
  });

  // Custom args
  const customWrap = document.getElementById('sp-custom-args');
  customWrap.innerHTML = '';
  (cfg.server_args_custom || []).forEach(c => spAddCustomArg(c.flag, c.value, c.enabled !== false));

  spServerDirty = false;
  document.getElementById('sp-restart-note').style.display = 'none';
  spRenderOsPaths(spSettings.config);
}

function spToggleArg(key, tog) {
  tog.classList.toggle('on');
  const row = document.getElementById('arg-row-' + key);
  const on  = tog.classList.contains('on');
  row.classList.toggle('disabled', !on);
  const inp = document.getElementById('arg-val-' + key);
  if (inp) { const isFlag = inp.classList.contains('flag-only'); if (!isFlag) inp.disabled = !on; }
  spMarkServerDirty();
}

function spMarkServerDirty() {
  spServerDirty = true;
  document.getElementById('sp-restart-note').style.display = 'flex';
}

function spAddCustomArg(flag='', value='', enabled=true) {
  const wrap = document.getElementById('sp-custom-args');
  const row  = document.createElement('div');
  row.className = 'sp-custom-row';
  row.innerHTML = `
    <div class="sp-tog ${enabled ? 'on' : ''}" onclick="this.classList.toggle('on');spMarkServerDirty()"></div>
    <input class="sp-custom-flag" value="${flag}" placeholder="--flag" oninput="spMarkServerDirty()"/>
    <input class="sp-custom-val"  value="${value}" placeholder="value (optional)" oninput="spMarkServerDirty()"/>
    <button class="sp-del-btn" onclick="this.parentElement.remove();spMarkServerDirty()">×</button>`;
  wrap.appendChild(row);
  if (!flag) row.querySelector('.sp-custom-flag').focus();
}

function spBrowse(type) {
  // Trigger native OS file picker (opens GNOME Files / Finder / Explorer)
  document.getElementById('pick-' + type)?.click();
}

// Called when native file picker returns a selection
function spNativePick(input, type) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  const nameOnly = file.name;
  const dispId   = 'sp-' + (type === 'model' ? 'model' : 'mmproj') + '-display';
  const disp     = document.getElementById(dispId);

  // Remove any existing path input for this type
  document.getElementById('sp-' + type + '-path-inp')?.remove();

  // Try to match from scan results (zero extra typing)
  const scanResults = _spScanResults || [];
  const match = scanResults.find(f => f.name === nameOnly);
  if (match) {
    if (disp) {
      disp.textContent = nameOnly;
      disp.title       = match.path;
      disp.className   = 'sp-file-display set';
    }
    spMarkServerDirty();
    return;
  }

  // Not in scan — show filename and ask for full path
  if (disp) { disp.textContent = nameOnly; disp.className = 'sp-file-display'; }

  const inp = document.createElement('input');
  inp.type        = 'text';
  inp.id          = 'sp-' + type + '-path-inp';
  inp.placeholder = `/path/to/${nameOnly}`;
  inp.style.cssText = 'width:100%;margin-top:6px;background:rgba(0,0,0,0.2);border:1px solid rgba(129,140,248,0.3);border-radius:9px;color:var(--text);font-family:"DM Mono",monospace;font-size:12px;padding:9px 12px;outline:none;display:block';

  inp.addEventListener('input', () => {
    const val = inp.value.trim();
    if (disp) {
      disp.textContent = val ? val.split(/[\/]/).pop() : nameOnly;
      disp.title       = val;
      disp.className   = 'sp-file-display' + (val ? ' set' : '');
    }
    spMarkServerDirty();
  });

  const row = disp?.closest('.sp-file-row');
  if (row) row.insertAdjacentElement('afterend', inp);
  inp.focus();
}

// Cache scan results for file picker auto-match
let _spScanResults = [];

function spClearMmproj() {
  const d = document.getElementById('sp-mmproj-display');
  d.textContent = 'No mmproj'; d.title = ''; d.className = 'sp-file-display';
  spMarkServerDirty();
}

async function spSaveServer(andClose = false) {
  const serverArgs = {};
  BUILTIN_ARGS.forEach(arg => {
    const tog = document.querySelector(`#arg-row-${arg.key} .sp-tog`);
    const inp = document.getElementById('arg-val-' + arg.key);
    serverArgs[arg.key] = {
      flag:    arg.flag,
      enabled: tog ? tog.classList.contains('on') : false,
      value:   arg.type === 'flag' ? null : (inp ? (arg.type==='number' ? Number(inp.value)||null : inp.value||null) : null),
    };
  });

  const customArgs = [];
  document.querySelectorAll('#sp-custom-args .sp-custom-row').forEach(row => {
    const tog   = row.querySelector('.sp-tog');
    const flag  = row.querySelector('.sp-custom-flag')?.value?.trim();
    const value = row.querySelector('.sp-custom-val')?.value?.trim();
    if (flag) customArgs.push({ flag, value: value||null, enabled: tog?.classList.contains('on') ?? true });
  });

  await fetch('/api/settings/server', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model_path:         document.getElementById('sp-model-display').title || '',
      mmproj_path:        document.getElementById('sp-mmproj-display').title || '',
      gpu_type:           document.getElementById('sp-gpu').value,
      port_bridge:        parseInt(document.getElementById('sp-port-bridge').value) || 8000,
      port_model:         parseInt(document.getElementById('sp-port-model').value)  || 8081,
      server_args:        serverArgs,
      server_args_custom: customArgs,
    })
  });

  spServerDirty = false;
  spShowSavedToast("Server settings saved ✓ — restart required");
  if (andClose) closeSettings();
}

// ── Generation tab ────────────────────────────────────────────────────────────
function spPopulateGeneration() {
  const gen = spSettings.config?.generation || {};
  const set = (id, lblId, val) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; }
    const lbl = document.getElementById(lblId);
    if (lbl) lbl.textContent = parseFloat(val).toFixed(id.includes('topk') || id.includes('tokens') ? 0 : 2);
  };
  set('sp-temperature',    'lbl-temp', gen.temperature    ?? 0.8);
  set('sp-top-p',          'lbl-topp', gen.top_p          ?? 0.95);
  set('sp-top-k',          'lbl-topk', gen.top_k          ?? 40);
  set('sp-repeat-penalty', 'lbl-rpen', gen.repeat_penalty ?? 1.1);
  document.getElementById('sp-max-tokens').value = gen.max_tokens ?? 1024;
  const mtr = document.getElementById('sp-max-tool-rounds');
  if (mtr) mtr.value = gen.max_tool_rounds ?? 8;
  // Vision mode
  const vmode = gen.vision_mode || 'always';
  document.querySelectorAll('#sp-vision-mode input[name="vision-mode"]').forEach(r => {
    r.checked = r.value === vmode;
  });
  const togMd = document.getElementById('tog-markdown');
  if (togMd) togMd.classList.toggle('on', !!gen.markdown_enabled);
  const tog = document.getElementById('tog-controls-visible');
  if (tog) tog.classList.toggle('on', localStorage.getItem('controls_always_visible') === 'true');
}

async function spSaveGeneration(andClose = false) {
  const body = {
    temperature:    parseFloat(document.getElementById('sp-temperature').value),
    top_p:          parseFloat(document.getElementById('sp-top-p').value),
    top_k:          parseInt(document.getElementById('sp-top-k').value),
    repeat_penalty: parseFloat(document.getElementById('sp-repeat-penalty').value),
    max_tokens:      parseInt(document.getElementById('sp-max-tokens').value),
    max_tool_rounds: parseInt(document.getElementById('sp-max-tool-rounds').value) || 8,
    vision_mode:      document.querySelector('#sp-vision-mode input[name="vision-mode"]:checked')?.value || 'always',
    markdown_enabled: document.getElementById('tog-markdown')?.classList.contains('on') || false,
  };
  await fetch('/api/settings/generation', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  // Update live config used by chat
  if (spSettings.config) spSettings.config.generation = body;
  spShowSavedToast("Generation settings saved ✓");
  // Sync vision_mode (and other gen settings) back to global config used by chat.js
  if (typeof config !== 'undefined' && config.generation) {
    config.generation = { ...config.generation, ...body };
  }
  if (andClose) closeSettings();
}

function spToggleControlsVisible(tog) {
  tog.classList.toggle('on');
  const val = tog.classList.contains('on');
  if (typeof setControlsAlwaysVisible === 'function') setControlsAlwaysVisible(val);
}

function spResetGeneration() {
  const d = spSettings.defaults?.generation || {};
  document.getElementById('sp-temperature').value    = d.temperature    ?? 0.8;
  document.getElementById('sp-top-p').value          = d.top_p          ?? 0.95;
  document.getElementById('sp-top-k').value          = d.top_k          ?? 40;
  document.getElementById('sp-repeat-penalty').value = d.repeat_penalty ?? 1.1;
  document.getElementById('sp-max-tokens').value     = d.max_tokens      ?? 1024;
  ['lbl-temp','lbl-topp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = parseFloat(el.textContent || 0).toFixed(2);
  });
  spPopulateGeneration();
}

// ── Companion tab ─────────────────────────────────────────────────────────────
function spPopulateCompanion() {
  const companions = spSettings.companions || [];
  const listEl = document.getElementById('sp-companion-list');
  listEl.innerHTML = '';
  companions.forEach(c => {
    const item     = document.createElement('div');
    const isActive = c.folder === spActiveFolder;
    item.className = 'sp-companion-item' + (isActive ? ' active-companion' : '');
    const avatarHtml = c.avatar_data
      ? `<img src="${c.avatar_data}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : '✦';
    item.innerHTML = `
      <div class="sp-mini-avatar">${avatarHtml}</div>
      <div style="flex:1;min-width:0">
        <div class="sp-companion-name">${c.name}</div>
        <div class="sp-companion-folder">${c.folder}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${isActive
          ? `<span style="font-size:11px;color:var(--green)">active</span>`
          : `<button class="sp-btn-sm" onclick="spSetActiveCompanion('${c.folder}');event.stopPropagation()">Switch</button>
             <button class="sp-btn-sm" style="background:rgba(248,113,113,0.1);border-color:rgba(248,113,113,0.25);color:var(--red)" onclick="spConfirmDeleteCompanion('${c.folder}','${c.name.replace(/'/g,"\'")}');event.stopPropagation()">Delete</button>`
        }
      </div>
    `;
    item.onclick = () => spEditCompanion(c.folder);
    listEl.appendChild(item);
  });

  spEditCompanion(spActiveFolder);
}

async function spEditCompanion(folder) {
  spActiveFolder = folder;
  // Reuse already-loaded settings instead of fetching again
  const cfg = spSettings || {};
  const companions = cfg.companions || [];
  const c = companions.find(x => x.folder === folder) || {};
  const companionCfg = cfg.active_companion || {};

  document.getElementById('sp-companion-name').value = c.name || '';

  // Avatar
  const preview = document.getElementById('sp-avatar-preview');
  if (c.avatar_data) {
    preview.innerHTML = `<img src="${c.avatar_data}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
  } else {
    preview.innerHTML = '✦';
  }
  document.getElementById('sp-crop-wrap').style.display = 'none';

  // Overrides — show only fields the companion has explicitly set (blank = inherits global)
  // companionCfg.generation now contains only the override keys, not the full merged set
  const gen = companionCfg.generation || {};
  document.getElementById('sp-c-temp').value = gen.temperature    !== undefined ? gen.temperature    : '';
  document.getElementById('sp-c-topp').value = gen.top_p          !== undefined ? gen.top_p          : '';
  document.getElementById('sp-c-rpen').value = gen.repeat_penalty !== undefined ? gen.repeat_penalty : '';
  document.getElementById('sp-c-maxt').value = gen.max_tokens     !== undefined ? gen.max_tokens     : '';

  // Force read toggle
  const frEl = document.getElementById('tog-force-read');
  if (frEl) frEl.classList.toggle('on', companionCfg.force_read_before_write !== false);

  // Soul edit mode
  const soulMode = companionCfg.soul_edit_mode || 'locked';
  document.querySelectorAll('#sp-soul-edit-mode input[name="soul-edit"]').forEach(r => {
    r.checked = r.value === soulMode;
  });

  // Heartbeat settings
  const hb = companionCfg.heartbeat || {};
  const hbTog = (id, val) => { const el = document.getElementById(id); if (el) el.classList.toggle('on', !!val); };
  hbTog('hb-silent',   hb.silent_enabled);
  hbTog('hb-message',  hb.message_enabled);
  hbTog('hb-idle',     hb.idle_trigger);
  hbTog('hb-conv-end', hb.conversation_end_trigger);
  hbTog('hb-session',  hb.session_start_trigger);
  hbTog('hb-ctx',      hb.context_threshold_trigger);
  const idleMin = document.getElementById('hb-idle-min');  if (idleMin) idleMin.value = hb.idle_minutes ?? 15;
  const ctxPct  = document.getElementById('hb-ctx-pct');   if (ctxPct)  ctxPct.value  = hb.context_threshold_pct ?? 75;
  // Per-trigger instructions (handle both old string format and new object format)
  const instr = hb.instructions || {};
  const instrVal = (key) => typeof instr === 'string' ? (key === 'default' ? instr : '') : (instr[key] || '');
  const setInstr = (id, key) => { const el = document.getElementById(id); if (el) el.value = instrVal(key); };
  setInstr('hb-instr-default',           'default');
  setInstr('hb-instr-idle',              'idle');
  setInstr('hb-instr-conversation-end',  'conversation_end');
  setInstr('hb-instr-session-start',     'session_start');
  setInstr('hb-instr-context-threshold', 'context_threshold');
  setInstr('hb-instr-manual',            'manual');
  // Show manual trigger button if heartbeat is enabled
  const manBtn = document.getElementById('hb-manual-btn');
  if (manBtn) manBtn.style.display = (hb.silent_enabled || hb.message_enabled) ? '' : 'none';

  // Soul files
  await spLoadSoulFiles(folder);
}

async function spLoadSoulFiles(folder) {
  try {
    const res  = await fetch(`/api/settings/soul/${folder}`);
    const data = await res.json();
    const files = data.files || {};
    const tabsEl = document.getElementById('sp-soul-tabs');
    tabsEl.innerHTML = '';
    spCurrentSoulFile = null;
    document.getElementById('sp-soul-content').value = '';
    document.getElementById('sp-soul-save-btn').style.display = 'none';

    Object.keys(files).forEach(fname => {
      const tab = document.createElement('button');
      tab.className = 'sp-soul-tab';
      tab.textContent = fname;
      tab.onclick = () => {
        document.querySelectorAll('.sp-soul-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        spCurrentSoulFile = fname;
        document.getElementById('sp-soul-content').value = files[fname];
        document.getElementById('sp-soul-save-btn').style.display = 'inline-flex';
      };
      tabsEl.appendChild(tab);
    });
  } catch(e) {}
}

async function spSaveSoulFile() {
  if (!spCurrentSoulFile) return;
  const content = document.getElementById('sp-soul-content').value;
  await fetch(`/api/settings/soul/${spActiveFolder}`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ filename: spCurrentSoulFile, content })
  });
}

function spNewSoulFile() {
  const name = prompt('File name (e.g. identity.md):');
  if (!name) return;
  const fname = name.endsWith('.md') || name.endsWith('.txt') ? name : name + '.md';
  const tabsEl = document.getElementById('sp-soul-tabs');
  const tab = document.createElement('button');
  tab.className = 'sp-soul-tab active';
  tab.textContent = fname;
  tab.onclick = () => {
    document.querySelectorAll('.sp-soul-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    spCurrentSoulFile = fname;
    document.getElementById('sp-soul-save-btn').style.display = 'inline-flex';
  };
  tabsEl.appendChild(tab);
  spCurrentSoulFile = fname;
  document.getElementById('sp-soul-content').value = '';
  document.getElementById('sp-soul-save-btn').style.display = 'inline-flex';
  document.querySelectorAll('.sp-soul-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
}

async function spSaveCompanion(andClose = false) {
  // Old companion editor is now hidden — use the companion window instead.
  // Guard: if editor is hidden, redirect to companion window rather than wiping settings.
  const editor = document.getElementById('sp-companion-editor');
  if (!editor || editor.style.display === 'none') {
    if (andClose) closeSettings();
    // Don't save anything — companion window owns all saves now
    return;
  }
  // Only save fields the user has explicitly set — blank = inherit from global
  const gen = {};
  const t = parseFloat(document.getElementById('sp-c-temp').value);
  const p = parseFloat(document.getElementById('sp-c-topp').value);
  const r = parseFloat(document.getElementById('sp-c-rpen').value);
  const m = parseInt(document.getElementById('sp-c-maxt').value);
  if (!isNaN(t) && document.getElementById('sp-c-temp').value !== '') gen.temperature    = t;
  if (!isNaN(p) && document.getElementById('sp-c-topp').value !== '') gen.top_p          = p;
  if (!isNaN(r) && document.getElementById('sp-c-rpen').value !== '') gen.repeat_penalty = r;
  if (!isNaN(m) && document.getElementById('sp-c-maxt').value !== '') gen.max_tokens     = m;

  // Save only the overrides — server merges with global at request time
  const merged = gen;

  await fetch('/api/settings/companion', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      folder:          spActiveFolder,
      companion_name:  document.getElementById('sp-companion-name').value.trim(),
      avatar_data:     document.getElementById('sp-avatar-preview').querySelector('img')?.src || '',
      generation:      merged,
      soul_edit_mode:           document.querySelector('#sp-soul-edit-mode input[name="soul-edit"]:checked')?.value || 'locked',
      force_read_before_write:  document.getElementById('tog-force-read')?.classList.contains('on') ?? true,
      heartbeat: {
        silent_enabled:            document.getElementById('hb-silent')?.classList.contains('on')   || false,
        message_enabled:           document.getElementById('hb-message')?.classList.contains('on')  || false,
        idle_trigger:              document.getElementById('hb-idle')?.classList.contains('on')     || false,
        idle_minutes:              parseInt(document.getElementById('hb-idle-min')?.value) || 15,
        conversation_end_trigger:  document.getElementById('hb-conv-end')?.classList.contains('on') || false,
        session_start_trigger:     document.getElementById('hb-session')?.classList.contains('on')  || false,
        context_threshold_trigger: document.getElementById('hb-ctx')?.classList.contains('on')      || false,
        context_threshold_pct:     parseInt(document.getElementById('hb-ctx-pct')?.value) || 75,
        instructions:              _spGetHeartbeatInstructions(),
      },
      set_active:      true,
    })
  });

  // Update sidebar
  document.getElementById('companion-name').textContent =
    document.getElementById('sp-companion-name').value.trim() || 'Companion';

  // Update spSettings cache so spPopulateCompanion re-renders with new values
  if (spSettings?.active_companion) {
    spSettings.active_companion.companion_name  = document.getElementById('sp-companion-name').value.trim();
    spSettings.active_companion.generation      = gen;  // save the actual overrides object
    spSettings.active_companion.soul_edit_mode          = document.querySelector('#sp-soul-edit-mode input[name="soul-edit"]:checked')?.value || 'locked';
    spSettings.active_companion.force_read_before_write  = document.getElementById('tog-force-read')?.classList.contains('on') ?? true;
    spSettings.active_companion.heartbeat = {
      silent_enabled:            document.getElementById('hb-silent')?.classList.contains('on')   || false,
      message_enabled:           document.getElementById('hb-message')?.classList.contains('on')  || false,
      idle_trigger:              document.getElementById('hb-idle')?.classList.contains('on')     || false,
      idle_minutes:              parseInt(document.getElementById('hb-idle-min')?.value) || 15,
      conversation_end_trigger:  document.getElementById('hb-conv-end')?.classList.contains('on') || false,
      session_start_trigger:     document.getElementById('hb-session')?.classList.contains('on')  || false,
      context_threshold_trigger: document.getElementById('hb-ctx')?.classList.contains('on')      || false,
      context_threshold_pct:     parseInt(document.getElementById('hb-ctx-pct')?.value) || 75,
      instructions:              _spGetHeartbeatInstructions(),
    };
  }

  // Refresh companion list only (not full reload — avoids delay)
  spPopulateCompanion();
  if (typeof syncStatusAvatar === "function") syncStatusAvatar();
  spShowSavedToast("Companion saved ✓");
  if (typeof heartbeatReload === "function") heartbeatReload();
  if (andClose) closeSettings();
}

let _switchingCompanion = false;

async function spSetActiveCompanion(folder) {
  if (_switchingCompanion) return;  // prevent rapid switches
  _switchingCompanion = true;

  // Show loading overlay over the whole page
  const overlay = document.createElement('div');
  overlay.id = 'companion-switch-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px';
  overlay.innerHTML = `
    <div style="width:32px;height:32px;border-radius:50%;border:2px solid rgba(129,140,248,0.2);border-top-color:#818cf8;animation:spin .8s linear infinite"></div>
    <div style="font-family:'DM Sans',sans-serif;font-size:14px;color:rgba(165,180,252,0.7)">Switching companion…</div>`;
  document.body.appendChild(overlay);

  try {
    await fetch('/api/settings/companion', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ folder, set_active: true })
    });
    spActiveFolder = folder;

    // Close settings panel then do a full page reload so chat context, soul files,
    // companion name, avatar and history all update correctly
    closeSettings?.();
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
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name })
  });
  const data = await res.json();
  if (data.ok) await spLoad();
}

// ── About tab ─────────────────────────────────────────────────────────────────
function spPopulateAbout() {
  const cfg = spSettings.config || {};
  document.getElementById('about-model').textContent     = cfg.model_path?.split(/[\\/]/).pop() || '—';
  document.getElementById('about-gpu').textContent       = cfg.gpu_type || '—';
  document.getElementById('about-ports').textContent     = `Bridge :${cfg.port_bridge||8000} · Model :${cfg.port_model||8081}`;
  document.getElementById('about-companion').textContent = `${cfg.companion_name||'—'} (${cfg.companion_folder||'default'})`;
  document.getElementById('about-paths').innerHTML =
    `model: ${cfg.model_path||'—'}\n` +
    (cfg.mmproj_path ? `mmproj: ${cfg.mmproj_path}\n` : '') +
    `companions/: ${cfg.companion_folder||'default'}`;
}

// ── Avatar crop ───────────────────────────────────────────────────────────────
function spAvatarBrowse() { document.getElementById('sp-avatar-file').click(); }

function spAvatarDrop(e) {
  e.preventDefault();
  document.getElementById('sp-avatar-zone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) spLoadAvatarFile(file);
}

function spAvatarFile(input) {
  const file = input.files[0];
  if (file) spLoadAvatarFile(file);
  input.value = '';
}

function spLoadAvatarFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      spCropImg   = img;
      spCropScale = Math.max(240/img.width, 240/img.height);
      spCropX     = (240 - img.width  * spCropScale) / 2;
      spCropY     = (240 - img.height * spCropScale) / 2;
      document.getElementById('sp-crop-wrap').style.display = 'block';
      spDrawCrop();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function spDrawCrop() {
  const canvas = document.getElementById('sp-crop-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, 240, 240);

  // Circular clip
  ctx.save();
  ctx.beginPath();
  ctx.arc(120, 120, 120, 0, Math.PI*2);
  ctx.clip();
  ctx.drawImage(spCropImg, spCropX, spCropY, spCropImg.width*spCropScale, spCropImg.height*spCropScale);
  ctx.restore();

  // Dim outside circle
  ctx.fillStyle = 'rgba(28,30,38,0.55)';
  ctx.fillRect(0,0,240,240);
  ctx.save();
  ctx.beginPath();
  ctx.arc(120,120,120,0,Math.PI*2);
  ctx.clip();
  ctx.clearRect(0,0,240,240);
  ctx.drawImage(spCropImg, spCropX, spCropY, spCropImg.width*spCropScale, spCropImg.height*spCropScale);
  ctx.restore();

  // Guide ring
  ctx.beginPath();
  ctx.arc(120,120,119,0,Math.PI*2);
  ctx.strokeStyle='rgba(129,140,248,0.5)';
  ctx.lineWidth=1.5; ctx.stroke();
}

function cropStart(e) {
  spCropDragging  = true;
  spCropDragStart = {x: e.clientX, y: e.clientY};
  spCropPosStart  = {x: spCropX,   y: spCropY};
}
function cropMove(e) {
  if (!spCropDragging) return;
  spCropX = spCropPosStart.x + (e.clientX - spCropDragStart.x);
  spCropY = spCropPosStart.y + (e.clientY - spCropDragStart.y);
  spDrawCrop();
}
function cropEnd() { spCropDragging = false; }
function cropTouchStart(e) { cropStart(e.touches[0]); }
function cropTouchMove(e)  { e.preventDefault(); cropMove(e.touches[0]); }

function spCropZoom(delta) {
  spCropScale = Math.max(0.1, spCropScale + delta);
  spDrawCrop();
}

function spCropConfirm() {
  const canvas = document.getElementById('sp-crop-canvas');
  const out    = document.createElement('canvas');
  out.width = out.height = 240;
  const ctx = out.getContext('2d');
  ctx.beginPath(); ctx.arc(120,120,120,0,Math.PI*2); ctx.clip();
  ctx.drawImage(spCropImg, spCropX, spCropY, spCropImg.width*spCropScale, spCropImg.height*spCropScale);
  const dataUrl = out.toDataURL('image/png');

  // Update preview in settings
  const preview = document.getElementById('sp-avatar-preview');
  preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;

  // Update sidebar avatar immediately
  const sidebarAvatar = document.getElementById('companion-avatar');
  if (sidebarAvatar) {
    sidebarAvatar.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
  }

  // Update spSettings cache so companion list re-renders with new avatar
  const companions = spSettings?.companions || [];
  const c = companions.find(x => x.folder === spActiveFolder);
  if (c) c.avatar_data = dataUrl;

  // Re-render the companion list so the card thumbnail updates immediately
  spPopulateCompanion();

  document.getElementById('sp-crop-wrap').style.display = 'none';
}

// ── Avatar drag-over highlight ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('sp-avatar-zone');
  if (zone) {
    zone.addEventListener('dragenter', () => zone.classList.add('drag-over'));
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  }
});

// ── Restart server ────────────────────────────────────────────────────────────
async function restartServer() {
  const btn = document.getElementById('restart-btn');
  btn.textContent = '…';
  btn.disabled = true;

  try {
    const res  = await fetch('/api/boot', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({force:true}) });
    const data = await res.json();

    if (!data.ok) {
      appendSystemNote(`Could not restart: ${data.error || 'unknown error'}`);
      btn.textContent = '↺';
      btn.disabled = false;
      return;
    }

    // Close settings and show boot overlay as a loading blocker
    closeSettings();
    showBootOverlay('Restarting model server…');
    disableInput();

    // watchBootLog is defined in chat.js and shared across both files
    watchBootLog(async () => {
      hideBootOverlay();
      appendSystemNote('Model server ready ✓');
      await loadStatus();
      enableInput();
    });

  } catch (e) {
    appendSystemNote(`Restart failed: ${e.message}`);
    btn.textContent = '↺';
    btn.disabled = false;
  }
}

function spToggleMarkdown(el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  // Update rendering immediately via chat.js function
  if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(enabled);
  // Persist in generation config
  if (typeof config !== 'undefined' && config.generation) {
    config.generation.markdown_enabled = enabled;
  }
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

// watchBootLog() is defined in chat.js

// ── Companion delete ──────────────────────────────────────────────────────────
function spConfirmDeleteCompanion(folder, name) {
  const id    = 'modal-del-' + Date.now();
  const close = () => document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.id = id;
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#21232e;border:1px solid rgba(248,113,113,0.3);border-radius:20px;padding:32px 36px;max-width:380px;width:90%;text-align:center">
      <div style="font-family:'Lora',serif;font-size:18px;color:#eef0fb;margin-bottom:10px">Delete companion?</div>
      <p style="font-size:13.5px;color:var(--text-muted);line-height:1.6;margin-bottom:20px">
        This will permanently delete <strong style="color:var(--text)">${name}</strong> and all their memory files. This cannot be undone.
      </p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="${id}-cancel"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--border);border-radius:10px;color:var(--text-muted);font-family:inherit;font-size:13px;padding:10px 20px;cursor:pointer">Cancel</button>
        <button id="${id}-confirm"
          style="background:linear-gradient(135deg,#dc2626,#b91c1c);border:none;border-radius:10px;color:#fff;font-family:inherit;font-size:13px;font-weight:500;padding:10px 20px;cursor:pointer">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById(id + '-cancel').onclick  = close;
  document.getElementById(id + '-confirm').onclick = () => { close(); spDeleteCompanion(folder); };
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
}

async function spDeleteCompanion(folder) {
  const res  = await fetch(`/api/companions/${folder}`, { method: 'DELETE' });
  const data = await res.json();
  if (!data.ok) { alert('Could not delete: ' + (data.error || 'unknown error')); return; }
  await spLoad();
}

// ── Factory reset ─────────────────────────────────────────────────────────────
function spFactoryReset() {
  const id    = 'modal-reset-' + Date.now();
  const close = () => document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.id = id;
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#21232e;border:1px solid rgba(248,113,113,0.35);border-radius:20px;padding:36px 40px;max-width:420px;width:90%;text-align:center">
      <div style="font-family:'Lora',serif;font-size:20px;color:#eef0fb;margin-bottom:12px">Factory reset</div>
      <p style="font-size:13.5px;color:var(--text-muted);line-height:1.6;margin-bottom:8px">This will permanently delete:</p>
      <ul style="font-size:13px;color:var(--text-muted);text-align:left;margin:0 auto 20px;display:inline-block;line-height:1.9">
        <li>All companions and their memory files</li>
        <li>All conversation history</li>
        <li>All configuration and settings</li>
      </ul>
      <p style="font-size:13px;color:var(--red);margin-bottom:22px;font-weight:500">This cannot be undone.</p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="${id}-cancel"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--border);border-radius:10px;color:var(--text-muted);font-family:inherit;font-size:14px;padding:11px 24px;cursor:pointer">Cancel</button>
        <button id="${id}-confirm"
          style="background:linear-gradient(135deg,#dc2626,#b91c1c);border:none;border-radius:10px;color:#fff;font-family:inherit;font-size:14px;font-weight:500;padding:11px 24px;cursor:pointer">Reset everything</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById(id + '-cancel').onclick  = close;
  document.getElementById(id + '-confirm').onclick = () => { close(); spExecuteFactoryReset(); };
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
}

async function spExecuteFactoryReset() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith('chat_history_')).forEach(k => localStorage.removeItem(k));
    const res  = await fetch('/api/factory-reset', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) { alert('Reset failed: ' + (data.errors || []).join(', ')); return; }
    window.location.href = '/wizard';
  } catch (e) { alert('Reset failed: ' + e.message); }
}

// Alias used by settings panel buttons
const spRestartServer = restartServer;
