// settings-server.js — Settings panel: Server tab
// Depends on: settings.js (spSettings, spActiveFolder, _spSetDirty, _spClearDirty,
//             spShowSavedToast, closeSettings)
//             settings_os_paths.js (spRenderOsPaths)

// ── Built-in server args definition ───────────────────────────────────────────
const BUILTIN_ARGS = [
  { key:'ngl',              flag:'-ngl',                desc:'GPU layers to offload',                               type:'number', default:99,            defaultOn:true  },
  { key:'ctx',              flag:'-c',                  desc:'Context window size',                                 type:'number', default:16384,          defaultOn:true  },
  { key:'np',               flag:'-np',                 desc:'Parallel slots',                                     type:'number', default:1,              defaultOn:true  },
  { key:'ctk',              flag:'-ctk',                desc:'KV cache key quantisation',                          type:'text',   default:'q8_0',         defaultOn:true  },
  { key:'ctv',              flag:'-ctv',                desc:'KV cache value quantisation',                        type:'text',   default:'q8_0',         defaultOn:true  },
  { key:'jinja',            flag:'--jinja',             desc:'Jinja2 chat templates (required for most models)',    type:'flag',   default:null,           defaultOn:true  },
  { key:'reasoning_format', flag:'--reasoning-format',  desc:'Thinking format (deepseek for Qwen3)',                type:'text',   default:'deepseek',     defaultOn:true  },
  { key:'cache_reuse',      flag:'--cache-reuse',       desc:'Reuse KV cache across turns (reduces re-processing)',type:'number', default:256,            defaultOn:true  },
  { key:'batch',            flag:'-b',                  desc:'Batch size (prompt processing)',                      type:'number', default:256,            defaultOn:true  },
  { key:'ubatch',           flag:'-ub',                 desc:'Micro-batch size',                                   type:'number', default:256,            defaultOn:true  },
  { key:'flash_attn',       flag:'--flash-attn',        desc:'Flash attention — big speed win, needs compatible GPU', type:'flag', default:null,          defaultOn:false },
  { key:'prompt_cache',     flag:'--prompt-cache',      desc:'Persist KV cache to disk (faster cold starts)',       type:'text',   default:'senni.cache',  defaultOn:false },
  { key:'mlock',            flag:'--mlock',             desc:'Lock model in RAM — prevents swapping',              type:'flag',   default:null,           defaultOn:false },
  { key:'no_mmap',          flag:'--no-mmap',           desc:'Disable memory mapping',                             type:'flag',   default:null,           defaultOn:false },
  { key:'threads',          flag:'-t',                  desc:'Thread count (0 = auto)',                            type:'number', default:0,              defaultOn:false },
];

// ── State ─────────────────────────────────────────────────────────────────────
let _spScanResults = [];

// ── Multimodal toggle ─────────────────────────────────────────────────────────
function spToggleMultimodal() {
  const tog     = document.getElementById('sp-mm-toggle');
  const section = document.getElementById('sp-mmproj-section');
  if (!tog || !section) return;

  const nowOn = !tog.classList.contains('on');
  tog.classList.toggle('on', nowOn);
  section.style.display = nowOn ? 'block' : 'none';

  // Toggling off clears the mmproj path so it saves as empty
  if (!nowOn) {
    const d = document.getElementById('sp-mmproj-display');
    if (d) { d.textContent = 'No mmproj'; d.title = ''; d.className = 'sp-file-display'; }
    document.getElementById('sp-mmproj-path-inp')?.remove();
  }
  spMarkServerDirty();
}

// ── Populate ──────────────────────────────────────────────────────────────────
function spPopulateServer() {
  const cfg = spSettings.config || {};

  // Pre-fetch scan results for the fallback path match
  fetch('/api/scan/models').then(r => r.json()).then(d => {
    _spScanResults = d.gguf_files || [];
  }).catch(() => {});

  // Model path
  const mp = cfg.model_path || '';
  const md = document.getElementById('sp-model-display');
  md.textContent = mp ? mp.split(/[\\\/]/).pop() : '—';
  md.title       = mp;
  md.className   = 'sp-file-display' + (mp ? ' set' : '');

  // mmproj path + multimodal toggle
  const mm      = cfg.mmproj_path || '';
  const mmOn    = !!mm;
  const mmTog   = document.getElementById('sp-mm-toggle');
  const mmSec   = document.getElementById('sp-mmproj-section');
  if (mmTog) mmTog.classList.toggle('on', mmOn);
  if (mmSec) mmSec.style.display = mmOn ? 'block' : 'none';
  const mmd = document.getElementById('sp-mmproj-display');
  if (mmd) {
    mmd.textContent = mm ? mm.split(/[\\\/]/).pop() : 'No mmproj';
    mmd.title       = mm;
    mmd.className   = 'sp-file-display' + (mm ? ' set' : '');
  }

  // llama-server binary path
  const bin = cfg.server_binary || '';
  const bnd = document.getElementById('sp-binary-display');
  if (bnd) {
    bnd.textContent = bin ? bin.split(/[\\\/]/).pop() : 'Auto-detect';
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
  _spSetDirty('model');
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

// ── File browsing ──────────────────────────────────────────────────────────────
async function spBrowse(type) {
  const dispId = type === 'binary' ? 'sp-binary-display'
               : type === 'mmproj' ? 'sp-mmproj-display'
               :                     'sp-model-display';
  const disp = document.getElementById(dispId);
  const originalText  = disp?.textContent;
  const originalClass = disp?.className;
  if (disp) disp.textContent = '…';

  const titles = { binary: 'Select llama-server binary', model: 'Select model file (.gguf)', mmproj: 'Select mmproj file (.gguf)' };
  const extensions = (type === 'model' || type === 'mmproj') ? ['.gguf'] : [];

  try {
    const res  = await fetch('/api/browse', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }) });
    const data = await res.json();
    if (data.ok && data.path) {
      _spApplyBrowsedPath(type, data.path);
    } else {
      if (disp) { disp.textContent = originalText; disp.className = originalClass; }
    }
  } catch (e) {
    if (disp) { disp.textContent = originalText; disp.className = originalClass; }
  }
}

function _spApplyBrowsedPath(type, path) {
  const dispId = type === 'binary' ? 'sp-binary-display'
               : type === 'mmproj' ? 'sp-mmproj-display'
               :                     'sp-model-display';
  const disp = document.getElementById(dispId);
  if (disp) {
    disp.textContent = path.split(/[\\\/]/).pop();
    disp.title       = path;
    disp.className   = 'sp-file-display set';
  }
  document.getElementById('sp-' + type + '-path-inp')?.remove();
  // Selecting an mmproj file implicitly enables multimodal
  if (type === 'mmproj') {
    const tog = document.getElementById('sp-mm-toggle');
    const sec = document.getElementById('sp-mmproj-section');
    if (tog) tog.classList.add('on');
    if (sec) sec.style.display = 'block';
  }
  spMarkServerDirty();
}

function _spShowPathFallback(type, dispId) {
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
      disp.textContent = val ? val.split(/[\\\/]/).pop() : (type === 'binary' ? 'Auto-detect' : type === 'mmproj' ? 'No mmproj' : '—');
      disp.title       = val;
      disp.className   = 'sp-file-display' + (val ? ' set' : '');
    }
    spMarkServerDirty();
  });

  const row = disp?.closest('.sp-file-row');
  if (row) row.insertAdjacentElement('afterend', inp);
  inp.focus();
}

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

  if (disp) { disp.textContent = file.name; disp.className = 'sp-file-display'; }
  _spShowPathFallback(type, dispId);
}

function spClearMmproj() {
  const d = document.getElementById('sp-mmproj-display');
  if (d) { d.textContent = 'No mmproj'; d.title = ''; d.className = 'sp-file-display'; }
  document.getElementById('sp-mmproj-path-inp')?.remove();
  // Clearing the mmproj file means multimodal is off
  const tog = document.getElementById('sp-mm-toggle');
  const sec = document.getElementById('sp-mmproj-section');
  if (tog) tog.classList.remove('on');
  if (sec) sec.style.display = 'none';
  spMarkServerDirty();
}

function spClearBinary() {
  const d = document.getElementById('sp-binary-display');
  if (d) { d.textContent = 'Auto-detect'; d.title = ''; d.className = 'sp-file-display'; }
  document.getElementById('sp-binary-path-inp')?.remove();
  spMarkServerDirty();
}

// ── Save ──────────────────────────────────────────────────────────────────────
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

  _spClearDirty('model');
  document.getElementById('sp-restart-note').style.display = 'none';
  spShowSavedToast('Server settings saved ✓ — restart required');
  if (andClose) closeSettings();
}

// ── Restart ────────────────────────────────────────────────────────────────────
async function restartServer() {
  const btn = document.getElementById('restart-btn');
  btn.textContent = '… Restarting';
  btn.disabled = true;
  showRestartOverlay();
  try {
    await fetch('/api/boot', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ force: true }),
    });
  } catch (e) {
    btn.textContent = '↺ Restart'; btn.disabled = false;
    hideRestartOverlay();
    return;
  }
  watchBootLog(hideRestartOverlay);
}

async function spRunDiagnostics() {
  const btn = document.getElementById('btn-run-diagnostics');
  const out = document.getElementById('diagnostics-results');
  btn.disabled = true;
  btn.textContent = '⬡ Running…';
  out.style.display = 'none';

  let data;
  try {
    const res = await fetch('/api/diagnostics');
    data = await res.json();
  } catch (e) {
    out.innerHTML = `<div class="sp-mono-block" style="color:var(--red)">Failed to reach /api/diagnostics: ${e.message}</div>`;
    out.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '⬡ Run diagnostics';
    return;
  }

  const rows = data.checks.map(c => {
    const ok = c.ok;
    const color = ok ? 'var(--text-muted)' : 'var(--red)';
    const badge = ok
      ? '<span style="color:#4ade80;font-weight:600">PASS</span>'
      : '<span style="color:var(--red);font-weight:600">FAIL</span>';
    const detail = c.detail ? `<span style="opacity:0.6">  — ${c.detail}</span>` : '';
    return `<div style="color:${color}">[${badge}]  ${c.name}${detail}</div>`;
  }).join('');

  const summary = `<div style="margin-bottom:8px;font-weight:600;color:${data.failed ? 'var(--red)' : '#4ade80'}">` +
    `${data.passed} passed, ${data.failed} failed</div>`;

  out.innerHTML = `<div class="sp-mono-block">${summary}${rows}</div>`;
  out.style.display = 'block';
  btn.disabled = false;
  btn.textContent = '⬡ Run diagnostics';
}

async function spRestartServer() {
  if (!confirm('Restart llama-server with current settings?')) return;
  closeSettings();
  showRestartOverlay();
  try {
    await fetch('/api/boot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
  } catch (e) {
    hideRestartOverlay();
    return;
  }
  watchBootLog(hideRestartOverlay);
}

async function spFactoryReset() {
  if (!confirm('Factory reset? This will delete ALL companions, history, and settings. This cannot be undone.')) return;
  await fetch('/api/factory-reset', { method: 'POST' });
  // Wipe all chat history and tab state stored in localStorage.
  // Keys are companion-scoped (e.g. chat_tabs_default, chat_history_default)
  // so we iterate and remove anything matching those prefixes.
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('chat_tabs_') || key.startsWith('chat_history_') || key === 'sidebar_width')) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) { console.warn('Could not clear localStorage on factory reset:', e); }
  window.location.reload();
}
