// settings.js — Settings panel (Server / Generation / Companion / About tabs)

// ── Built-in server args definition ──────────────────────────────────────────
const BUILTIN_ARGS = [
  { key:'ngl',              flag:'-ngl',                desc:'GPU layers to offload',                              type:'number', default:99,            defaultOn:true  },
  { key:'ctx',              flag:'-c',                  desc:'Context window size',                                type:'number', default:16384,          defaultOn:true  },
  { key:'np',               flag:'-np',                 desc:'Parallel slots',                                    type:'number', default:1,              defaultOn:true  },
  { key:'ctk',              flag:'-ctk',                desc:'KV cache key quantisation',                         type:'text',   default:'q8_0',         defaultOn:true  },
  { key:'ctv',              flag:'-ctv',                desc:'KV cache value quantisation',                       type:'text',   default:'q8_0',         defaultOn:true  },
  { key:'jinja',            flag:'--jinja',             desc:'Jinja2 chat templates (required for most models)',   type:'flag',   default:null,           defaultOn:true  },
  { key:'reasoning_format', flag:'--reasoning-format',  desc:'Thinking format (deepseek for Qwen3)',               type:'text',   default:'deepseek',     defaultOn:true  },
  { key:'cache_reuse',      flag:'--cache-reuse',       desc:'Reuse KV cache across turns (reduces re-processing)',type:'number', default:256,            defaultOn:true  },
  { key:'batch',            flag:'-b',                  desc:'Batch size (prompt processing)',                     type:'number', default:256,            defaultOn:true  },
  { key:'ubatch',           flag:'-ub',                 desc:'Micro-batch size',                                  type:'number', default:256,            defaultOn:true  },
  { key:'flash_attn',       flag:'--flash-attn',        desc:'Flash attention — big speed win, needs compatible GPU', type:'flag', default:null,          defaultOn:false },
  { key:'prompt_cache',     flag:'--prompt-cache',      desc:'Persist KV cache to disk (faster cold starts)',      type:'text',   default:'senni.cache',  defaultOn:false },
  { key:'mlock',            flag:'--mlock',             desc:'Lock model in RAM — prevents swapping',             type:'flag',   default:null,           defaultOn:false },
  { key:'no_mmap',          flag:'--no-mmap',           desc:'Disable memory mapping',                            type:'flag',   default:null,           defaultOn:false },
  { key:'threads',          flag:'-t',                  desc:'Thread count (0 = auto)',                           type:'number', default:0,              defaultOn:false },
];

// ── State ─────────────────────────────────────────────────────────────────────
let spSettings        = null;
let spActiveFolder    = '';
let spCropImg         = null;
let spCropX           = 0;
let spCropY           = 0;
let spCropScale       = 1;
let spCropDragging    = false;
let spCropDragStart   = null;
let spCropPosStart    = null;
let spCurrentSoulFile = null;
let spServerDirty     = false;
let spGenerationDirty = false;
let spCompanionDirty  = false;

// ── Dirty tracking — yellow buttons when unsaved changes exist ────────────────
function _spSetDirty(tab) {
  if (tab === 'server')     spServerDirty     = true;
  if (tab === 'generation') spGenerationDirty = true;
  if (tab === 'companion')  spCompanionDirty  = true;
  _spUpdateFooterButtons();
}

function _spClearDirty(tab) {
  if (tab === 'server')     spServerDirty     = false;
  if (tab === 'generation') spGenerationDirty = false;
  if (tab === 'companion')  spCompanionDirty  = false;
  _spUpdateFooterButtons();
}

function _spUpdateFooterButtons() {
  const map = { server: spServerDirty, generation: spGenerationDirty, companion: spCompanionDirty };
  Object.entries(map).forEach(([tab, dirty]) => {
    const footer = document.getElementById('sp-footer-' + tab);
    if (!footer) return;
    footer.querySelectorAll('.sp-btn-ghost, .sp-btn-primary').forEach(btn => {
      if (btn.textContent.includes('Apply') || btn.textContent.includes('Save')) {
        btn.style.background  = dirty ? 'rgba(251,191,36,0.15)' : '';
        btn.style.borderColor = dirty ? 'rgba(251,191,36,0.5)'  : '';
        btn.style.color       = dirty ? 'rgba(251,191,36,0.9)'  : '';
      }
    });
  });
}

// ── Open / close ──────────────────────────────────────────────────────────────
async function openSettings() {
  document.getElementById('settings-overlay').classList.add('open');
  await spLoad();
  spSwitchTab('server');
}

function closeSettings() {
  const anyDirty = spServerDirty || spGenerationDirty || spCompanionDirty;
  if (anyDirty) {
    if (!confirm('You have unsaved changes. Close anyway?')) return;
  }
  spServerDirty = spGenerationDirty = spCompanionDirty = false;
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
  ['server','generation','companion'].forEach(tab => {
    const f = document.getElementById('sp-footer-' + tab);
    if (f) f.style.display = (tab === name) ? 'flex' : 'none';
  });
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function spShowSavedToast(msg = 'Saved ✓') {
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
  let toast = document.getElementById('sp-saved-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'sp-saved-toast';
    toast.style.cssText = [
      'position:fixed','bottom:28px','left:50%','transform:translateX(-50%)',
      'background:#21232e','border:1px solid rgba(109,212,168,0.3)',
      'color:rgba(109,212,168,0.9)','font-family:"DM Sans",sans-serif',
      'font-size:13px','font-weight:500','padding:9px 20px',
      'border-radius:20px','z-index:10000',
      'animation:spToastIn .2s ease both',
      'pointer-events:none','transition:opacity .2s',
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

// ── Load — always fetches fresh from server ───────────────────────────────────
async function spLoad() {
  const title = document.querySelector('.sp-title');
  const origTitle = title?.textContent || 'Settings';
  if (title) title.textContent = 'Loading…';

  try {
    const res  = await fetch('/api/settings');
    spSettings = await res.json();
    spActiveFolder = spSettings.config?.companion_folder || 'default';
    spPopulateServer();
    spPopulateGeneration();
    spPopulateCompanion();
    spPopulateAbout();
    spServerDirty = spGenerationDirty = spCompanionDirty = false;
    _spUpdateFooterButtons();
  } catch(e) {
    console.warn('Settings load failed:', e);
  } finally {
    if (title) title.textContent = origTitle;
  }
}

// ── Server tab ────────────────────────────────────────────────────────────────
let _spScanResults = [];

function spPopulateServer() {
  const cfg = spSettings.config || {};

  // Pre-fetch scan results for the fallback path match
  fetch('/api/scan/models').then(r => r.json()).then(d => {
    _spScanResults = d.gguf_files || [];
  }).catch(() => {});

  // Model path
  const mp = cfg.model_path || '';
  const md = document.getElementById('sp-model-display');
  md.textContent = mp ? mp.split(/[\\/]/).pop() : '—';
  md.title       = mp;
  md.className   = 'sp-file-display' + (mp ? ' set' : '');

  // mmproj path
  const mm  = cfg.mmproj_path || '';
  const mmd = document.getElementById('sp-mmproj-display');
  mmd.textContent = mm ? mm.split(/[\\/]/).pop() : 'No mmproj';
  mmd.title       = mm;
  mmd.className   = 'sp-file-display' + (mm ? ' set' : '');

  // llama-server binary path
  const bin = cfg.server_binary || '';
  const bnd = document.getElementById('sp-binary-display');
  if (bnd) {
    bnd.textContent = bin ? bin.split(/[\\/]/).pop() : 'Auto-detect';
    bnd.title       = bin;
    bnd.className   = 'sp-file-display' + (bin ? ' set' : '');
  }

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
        oninput="spMarkServerDirty()"
      />`;
    wrap.appendChild(row);
  });

  // Custom args
  const customWrap = document.getElementById('sp-custom-args');
  customWrap.innerHTML = '';
  (cfg.server_args_custom || []).forEach(c => spAddCustomArg(c.flag, c.value, c.enabled !== false));

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
  _spSetDirty('server');
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

// ── File browsing — uses native OS picker via /api/browse ────────────────────
// Falls back to a manual text input if the server-side dialog isn't available.

async function spBrowse(type) {
  // type: 'model' | 'mmproj' | 'binary'
  const dispId = type === 'binary' ? 'sp-binary-display'
               : type === 'mmproj' ? 'sp-mmproj-display'
               :                     'sp-model-display';
  const disp = document.getElementById(dispId);

  // Show a brief loading state on the display element
  const originalText  = disp?.textContent;
  const originalClass = disp?.className;
  if (disp) { disp.textContent = '…'; }

  try {
    const res  = await fetch('/api/browse', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type }),
    });
    const data = await res.json();

    if (data.ok && data.path) {
      _spApplyBrowsedPath(type, data.path);
    } else if (data.reason !== 'cancelled') {
      // Server-side dialog not available — show manual text input
      if (disp) { disp.textContent = originalText; disp.className = originalClass; }
      _spShowPathFallback(type, dispId);
    } else {
      // User cancelled — restore display
      if (disp) { disp.textContent = originalText; disp.className = originalClass; }
    }
  } catch (e) {
    if (disp) { disp.textContent = originalText; disp.className = originalClass; }
    _spShowPathFallback(type, dispId);
  }
}

function _spApplyBrowsedPath(type, path) {
  const dispId = type === 'binary' ? 'sp-binary-display'
               : type === 'mmproj' ? 'sp-mmproj-display'
               :                     'sp-model-display';
  const disp = document.getElementById(dispId);
  if (disp) {
    disp.textContent = path.split(/[\\/]/).pop();
    disp.title       = path;
    disp.className   = 'sp-file-display set';
  }
  // Remove any stale fallback input for this type
  document.getElementById('sp-' + type + '-path-inp')?.remove();
  spMarkServerDirty();
}

function _spShowPathFallback(type, dispId) {
  // Remove any existing fallback input for this type first
  document.getElementById('sp-' + type + '-path-inp')?.remove();

  const disp = document.getElementById(dispId);
  if (!disp) return;

  const placeholders = {
    model:  '/path/to/model.gguf',
    mmproj: '/path/to/mmproj.gguf',
    binary: 'C:\\path\\to\\llama-server.exe',
  };

  const inp = document.createElement('input');
  inp.type        = 'text';
  inp.id          = 'sp-' + type + '-path-inp';
  inp.placeholder = placeholders[type] || '/path/to/file';
  inp.value       = disp.title || '';
  inp.style.cssText = [
    'width:100%', 'margin-top:6px',
    'background:rgba(0,0,0,0.2)',
    'border:1px solid rgba(129,140,248,0.3)',
    'border-radius:9px', 'color:var(--text)',
    'font-family:"DM Mono",monospace', 'font-size:12px',
    'padding:9px 12px', 'outline:none', 'display:block',
  ].join(';');

  inp.addEventListener('input', () => {
    const val = inp.value.trim();
    if (disp) {
      disp.textContent = val ? val.split(/[\\/]/).pop() : (type === 'binary' ? 'Auto-detect' : type === 'mmproj' ? 'No mmproj' : '—');
      disp.title       = val;
      disp.className   = 'sp-file-display' + (val ? ' set' : '');
    }
    spMarkServerDirty();
  });

  const row = disp?.closest('.sp-file-row');
  if (row) row.insertAdjacentElement('afterend', inp);
  inp.focus();
}

// Legacy: only called by the hidden <input type="file"> elements which remain
// as a last-resort fallback. Uses scan results to resolve full path if possible.
function spNativePick(input, type) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  const dispId = type === 'binary' ? 'sp-binary-display'
               : type === 'mmproj' ? 'sp-mmproj-display'
               :                     'sp-model-display';
  const disp = document.getElementById(dispId);
  document.getElementById('sp-' + type + '-path-inp')?.remove();

  const match = (_spScanResults || []).find(f => f.name === file.name);
  if (match) {
    _spApplyBrowsedPath(type, match.path);
    return;
  }

  // Name only, no full path — show it dimmed and open the fallback input
  if (disp) { disp.textContent = file.name; disp.className = 'sp-file-display'; }
  _spShowPathFallback(type, dispId);
}

function spClearMmproj() {
  const d = document.getElementById('sp-mmproj-display');
  d.textContent = 'No mmproj'; d.title = ''; d.className = 'sp-file-display';
  document.getElementById('sp-mmproj-path-inp')?.remove();
  spMarkServerDirty();
}

function spClearBinary() {
  const d = document.getElementById('sp-binary-display');
  if (d) { d.textContent = 'Auto-detect'; d.title = ''; d.className = 'sp-file-display'; }
  document.getElementById('sp-binary-path-inp')?.remove();
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_path:         document.getElementById('sp-model-display').title  || '',
      mmproj_path:        document.getElementById('sp-mmproj-display').title || '',
      server_binary:      document.getElementById('sp-binary-display')?.title || '',
      gpu_type:           document.getElementById('sp-gpu').value,
      port_bridge:        parseInt(document.getElementById('sp-port-bridge').value) || 8000,
      port_model:         parseInt(document.getElementById('sp-port-model').value)  || 8081,
      server_args:        serverArgs,
      server_args_custom: customArgs,
    }),
  });

  _spClearDirty('server');
  document.getElementById('sp-restart-note').style.display = 'none';
  spShowSavedToast('Server settings saved ✓ — restart required');
  if (andClose) closeSettings();
}

// ── Generation tab ────────────────────────────────────────────────────────────
function spPopulateGeneration() {
  const gen = spSettings.config?.generation || {};
  const set = (id, lblId, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
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
  const vmode = gen.vision_mode || 'always';
  document.querySelectorAll('#sp-vision-mode input[name="vision-mode"]').forEach(r => { r.checked = r.value === vmode; });
  const togMd = document.getElementById('tog-markdown');
  if (togMd) togMd.classList.toggle('on', gen.markdown_enabled !== false);
  const togCtrl = document.getElementById('tog-controls-visible');
  if (togCtrl) togCtrl.classList.toggle('on', localStorage.getItem('controls_always_visible') === 'true');
}

function spMarkGenerationDirty() { _spSetDirty('generation'); }

function spToggleControlsVisible(tog) {
  tog.classList.toggle('on');
  const val = tog.classList.contains('on');
  if (typeof setControlsAlwaysVisible === 'function') setControlsAlwaysVisible(val);
  _spSetDirty('generation');
}

function spResetGeneration() {
  if (!confirm('Reset all generation settings to defaults?')) return;
  spSettings.config = spSettings.config || {};
  spSettings.config.generation = {};
  spPopulateGeneration();
  _spSetDirty('generation');
}

async function spSaveGeneration(andClose = false) {
  const gen = {
    temperature:     parseFloat(document.getElementById('sp-temperature')?.value)    ?? 0.8,
    top_p:           parseFloat(document.getElementById('sp-top-p')?.value)          ?? 0.95,
    top_k:           parseInt(document.getElementById('sp-top-k')?.value)            ?? 40,
    repeat_penalty:  parseFloat(document.getElementById('sp-repeat-penalty')?.value) ?? 1.1,
    max_tokens:      parseInt(document.getElementById('sp-max-tokens')?.value)       ?? 1024,
    max_tool_rounds: parseInt(document.getElementById('sp-max-tool-rounds')?.value)  ?? 8,
    vision_mode:     document.querySelector('#sp-vision-mode input[name="vision-mode"]:checked')?.value || 'always',
    markdown_enabled: document.getElementById('tog-markdown')?.classList.contains('on') ?? true,
  };
  await fetch('/api/settings/generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gen),
  });
  if (spSettings.config) spSettings.config.generation = gen;
  _spClearDirty('generation');
  spShowSavedToast('Generation settings saved ✓');
  if (andClose) closeSettings();
}

function spToggleMarkdown(el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(enabled);
  if (typeof config !== 'undefined' && config.generation) config.generation.markdown_enabled = enabled;
  _spSetDirty('generation');
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
          ? '<span style="font-size:10px;color:var(--indigo);opacity:0.7">active</span>'
          : `<button class="sp-btn-sm" onclick="spSwitchCompanion('${c.folder}')">Switch</button>
             <button class="sp-btn-sm sp-btn-ghost" style="color:var(--red);border-color:rgba(248,113,113,0.25)"
               onclick="spDeleteCompanion('${c.folder}','${c.name}')">✕</button>`
        }
      </div>`;
    listEl.appendChild(item);
  });

  const active = spSettings.active_companion || {};
  document.getElementById('sp-companion-name-input').value = active.companion_name || '';

  const preview = document.getElementById('sp-avatar-preview');
  if (preview) {
    const data = spSettings.companions?.find(c => c.folder === spActiveFolder)?.avatar_data || '';
    preview.innerHTML = data
      ? `<img src="${data}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : '✦';
  }

  const frc = document.getElementById('tog-force-read');
  if (frc) frc.classList.toggle('on', active.force_read_before_write !== false);

  const soulModeEl = document.getElementById('sp-soul-mode');
  if (soulModeEl) soulModeEl.value = active.soul_edit_mode || 'locked';

  // Heartbeat toggles
  const hb = active.heartbeat || {};
  const setTog = (id, val) => document.getElementById(id)?.classList.toggle('on', !!val);
  setTog('hb-tog-silent',   hb.silent_enabled);
  setTog('hb-tog-message',  hb.message_enabled);
  setTog('hb-tog-idle',     hb.idle_trigger);
  setTog('hb-tog-conv-end', hb.conversation_end_trigger);
  setTog('hb-tog-sess-start',hb.session_start_trigger);
  setTog('hb-tog-ctx',      hb.context_threshold_trigger);
  const idleMin = document.getElementById('hb-idle-minutes');
  if (idleMin) idleMin.value = hb.idle_minutes ?? 15;
  const ctxPct = document.getElementById('hb-ctx-pct');
  if (ctxPct) ctxPct.value = hb.context_threshold_pct ?? 75;

  const instr = hb.instructions || {};
  const setInstr = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setInstr('hb-instr-default',           instr.default           || '');
  setInstr('hb-instr-idle',              instr.idle              || '');
  setInstr('hb-instr-conversation-end',  instr.conversation_end  || '');
  setInstr('hb-instr-session-start',     instr.session_start     || '');
  setInstr('hb-instr-context-threshold', instr.context_threshold || '');
  setInstr('hb-instr-manual',            instr.manual            || '');

  // Soul files
  spLoadSoulFiles();
}

async function spSaveCompanion(andClose = false) {
  const nameEl = document.getElementById('sp-companion-name-input');
  const name   = nameEl?.value?.trim() || '';

  const companions = spSettings.companions || [];
  const avatarData = companions.find(c => c.folder === spActiveFolder)?.avatar_data || '';

  const frc      = document.getElementById('tog-force-read');
  const soulMode = document.getElementById('sp-soul-mode')?.value || 'locked';

  const hbPayload = {
    silent_enabled:            document.getElementById('hb-tog-silent')?.classList.contains('on')    || false,
    message_enabled:           document.getElementById('hb-tog-message')?.classList.contains('on')   || false,
    idle_trigger:              document.getElementById('hb-tog-idle')?.classList.contains('on')      || false,
    idle_minutes:              parseInt(document.getElementById('hb-idle-minutes')?.value) || 15,
    conversation_end_trigger:  document.getElementById('hb-tog-conv-end')?.classList.contains('on')  || false,
    session_start_trigger:     document.getElementById('hb-tog-sess-start')?.classList.contains('on')|| false,
    context_threshold_trigger: document.getElementById('hb-tog-ctx')?.classList.contains('on')       || false,
    context_threshold_pct:     parseInt(document.getElementById('hb-ctx-pct')?.value) || 75,
    instructions: _spGetHeartbeatInstructions(),
  };

  await fetch('/api/settings/companion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folder:                spActiveFolder,
      companion_name:        name,
      avatar_data:           avatarData,
      soul_edit_mode:        soulMode,
      force_read_before_write: frc ? frc.classList.contains('on') : true,
      heartbeat:             hbPayload,
    }),
  });

  if (spSettings.config) spSettings.config.companion_name = name;
  if (typeof companionName !== 'undefined') {
    companionName = name;
    document.getElementById('companion-name').textContent = name;
    document.title = name;
  }

  _spClearDirty('companion');
  spShowSavedToast('Companion settings saved ✓');
  if (andClose) closeSettings();
}

// ── Companion switching / creation / deletion ─────────────────────────────────
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
  document.getElementById('about-model').textContent     = cfg.model_path?.split(/[\\/]/).pop() || '—';
  document.getElementById('about-gpu').textContent       = cfg.gpu_type || '—';
  document.getElementById('about-ports').textContent     = `Bridge :${cfg.port_bridge||8000} · Model :${cfg.port_model||8081}`;
  document.getElementById('about-companion').textContent = `${cfg.companion_name||'—'} (${cfg.companion_folder||'default'})`;
  document.getElementById('about-paths').innerHTML =
    `model: ${cfg.model_path||'—'}\n` +
    (cfg.mmproj_path   ? `mmproj: ${cfg.mmproj_path}\n`         : '') +
    (cfg.server_binary ? `binary: ${cfg.server_binary}\n`       : '');
}

// ── Avatar (companion settings tab) ──────────────────────────────────────────
let spCropDragging2 = false;

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
    sidebarAvatar.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
  }

  const companions = spSettings?.companions || [];
  const c = companions.find(x => x.folder === spActiveFolder);
  if (c) c.avatar_data = dataUrl;

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

// ── Restart server ────────────────────────────────────────────────────────────
async function restartServer() {
  const btn = document.getElementById('restart-btn');
  btn.textContent = '…';
  btn.disabled = true;
  try {
    const res  = await fetch('/api/boot', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (data.ok) {
      btn.textContent = '↺';
      btn.disabled = false;
    }
  } catch (e) {
    btn.textContent = '↺';
    btn.disabled = false;
  }
}

async function spRestartServer() {
  if (!confirm('Restart llama-server with current settings?')) return;
  spShowSavedToast('Restarting…');
  await fetch('/api/boot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true }),
  });
}

async function spFactoryReset() {
  if (!confirm('Factory reset? This will delete ALL companions, history, and settings. This cannot be undone.')) return;
  await fetch('/api/factory-reset', { method: 'POST' });
  window.location.reload();
}

// ── Soul file editor ──────────────────────────────────────────────────────────
async function spLoadSoulFiles() {
  const folder  = spActiveFolder;
  const wrap    = document.getElementById('sp-soul-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:4px 0">Loading…</div>';

  try {
    const res  = await fetch(`/api/settings/soul/${folder}`);
    const data = await res.json();
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
  const editor  = document.getElementById('sp-soul-editor');
  const nameEl  = document.getElementById('sp-soul-filename');
  if (editor) editor.value   = content;
  if (nameEl) nameEl.textContent = fname;
  document.getElementById('sp-soul-editor-wrap')?.style && (document.getElementById('sp-soul-editor-wrap').style.display = 'flex');
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
