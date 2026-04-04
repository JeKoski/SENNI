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

  // mmproj path
  const mm  = cfg.mmproj_path || '';
  const mmd = document.getElementById('sp-mmproj-display');
  mmd.textContent = mm ? mm.split(/[\\\/]/).pop() : 'No mmproj';
  mmd.title       = mm;
  mmd.className   = 'sp-file-display' + (mm ? ' set' : '');

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
  spPopulateTts(spSettings.config?.tts || {});
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

// ── File browsing ──────────────────────────────────────────────────────────────
async function spBrowse(type) {
  const dispId = type === 'binary' ? 'sp-binary-display'
               : type === 'mmproj' ? 'sp-mmproj-display'
               :                     'sp-model-display';
  const disp = document.getElementById(dispId);
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
      if (disp) { disp.textContent = originalText; disp.className = originalClass; }
      _spShowPathFallback(type, dispId);
    } else {
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
    disp.textContent = path.split(/[\\\/]/).pop();
    disp.title       = path;
    disp.className   = 'sp-file-display set';
  }
  document.getElementById('sp-' + type + '-path-inp')?.remove();
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

// ── TTS path helpers ───────────────────────────────────────────────────────────

function spPopulateTts(tts) {
  const tog = document.getElementById('sp-tts-enabled');
  if (tog) tog.classList.toggle('on', !!tts.enabled);

  const _setDisp = (id, val, empty) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val ? val.split(/[\\/]/).pop() : empty;
    el.title       = val || '';
    el.className   = 'sp-file-display' + (val ? ' set' : '');
  };
  _setDisp('sp-tts-python-display', tts.python_path || '', 'Auto-detect');
  _setDisp('sp-tts-voices-display', tts.voices_path || '', 'Auto-detect');
  _setDisp('sp-tts-espeak-display', tts.espeak_path || '', 'Auto-detect');
}

async function spBrowseTts(type) {
  const dispId = type === 'python' ? 'sp-tts-python-display'
               : type === 'voices' ? 'sp-tts-voices-display'
               :                     'sp-tts-espeak-display';
  const disp = document.getElementById(dispId);
  if (!disp) return;

  const original = { text: disp.textContent, cls: disp.className };
  disp.textContent = '…';

  // For voices dir we want a folder picker — but tkinter only supports files.
  // Use a text fallback for the voices dir path; file picker for executables.
  const browseType = (type === 'voices') ? null : 'binary';

  if (browseType) {
    try {
      const res  = await fetch('/api/browse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: browseType }),
      });
      const data = await res.json();
      if (data.ok && data.path) {
        disp.textContent = data.path.split(/[\\/]/).pop();
        disp.title       = data.path;
        disp.className   = 'sp-file-display set';
        spMarkServerDirty();
        return;
      } else if (data.reason === 'cancelled') {
        disp.textContent = original.text; disp.className = original.cls;
        return;
      }
    } catch {}
  }

  // Fallback: inline text input
  disp.textContent = original.text; disp.className = original.cls;
  _spShowTtsPathInput(type, dispId, disp.title);
}

function _spShowTtsPathInput(type, dispId, currentVal) {
  const inputId = 'sp-tts-' + type + '-inp';
  document.getElementById(inputId)?.remove();
  const disp = document.getElementById(dispId);
  if (!disp) return;

  const placeholders = {
    python: '/usr/bin/python3 or C:\\Python312\\python.exe',
    voices: '/path/to/kokoro/voices',
    espeak: '/usr/bin/espeak-ng',
  };

  const inp = document.createElement('input');
  inp.type        = 'text';
  inp.id          = inputId;
  inp.placeholder = placeholders[type] || '/path/to/file';
  inp.value       = currentVal || '';
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
    disp.textContent = val ? val.split(/[\\/]/).pop() : 'Auto-detect';
    disp.title       = val;
    disp.className   = 'sp-file-display' + (val ? ' set' : '');
    spMarkServerDirty();
  });

  const row = disp?.closest('.sp-file-row');
  if (row) row.insertAdjacentElement('afterend', inp);
  inp.focus();
}

function spClearTtsPath(type) {
  const dispId  = type === 'python' ? 'sp-tts-python-display'
                : type === 'voices' ? 'sp-tts-voices-display'
                :                     'sp-tts-espeak-display';
  const inputId = 'sp-tts-' + type + '-inp';
  const disp = document.getElementById(dispId);
  if (disp) { disp.textContent = 'Auto-detect'; disp.title = ''; disp.className = 'sp-file-display'; }
  document.getElementById(inputId)?.remove();
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

  // Save TTS settings (separate endpoint — manages its own process lifecycle)
  await fetch('/api/settings/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled:     document.getElementById('sp-tts-enabled')?.classList.contains('on') ?? false,
      python_path: document.getElementById('sp-tts-python-display')?.title || '',
      voices_path: document.getElementById('sp-tts-voices-display')?.title || '',
      espeak_path: document.getElementById('sp-tts-espeak-display')?.title || '',
    }),
  });
  // Reload TTS status in the browser so the Voice tab and playback reflect new state
  if (typeof ttsReload === 'function') ttsReload();

  _spClearDirty('server');
  document.getElementById('sp-restart-note').style.display = 'none';
  spShowSavedToast('Server settings saved ✓ — restart required');
  if (andClose) closeSettings();
}

// ── Restart ────────────────────────────────────────────────────────────────────
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
    if (data.ok) { btn.textContent = '↺'; btn.disabled = false; }
  } catch (e) {
    btn.textContent = '↺'; btn.disabled = false;
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
