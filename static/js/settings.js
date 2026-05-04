// settings.js — Settings panel coordinator: shared state, open/close,
//               tab switching, load, toast, dirty tracking.
// Loaded before settings-server.js, settings-generation.js, settings-display.js,
//             settings-features.js, settings-tools.js, settings-companion.js.
//
// Tab logic lives in:
//   settings-server.js     — Model tab
//   settings-generation.js — Generation tab
//   settings-display.js    — Display tab
//   settings-features.js   — Features tab (TTS + ChromaDB)
//   settings-tools.js      — Tools tab
//   settings-companion.js  — Companion tab + About tab
//   settings_os_paths.js   — Per-OS paths section (inside Model tab)

// ── Shared state (read by all tab modules) ────────────────────────────────────
let spSettings        = null;
let spActiveFolder    = '';
let spCurrentSoulFile = null;
let spServerDirty     = false;
let spGenerationDirty = false;
let spDisplayDirty    = false;
let spFeaturesDirty   = false;
let spToolsDirty      = false;
let spCompanionDirty  = false;

// ── Dirty tracking — yellow buttons when unsaved changes exist ────────────────
function _spSetDirty(tab) {
  if (tab === 'model')      spServerDirty     = true;
  if (tab === 'generation') spGenerationDirty = true;
  if (tab === 'display')    spDisplayDirty    = true;
  if (tab === 'features')   spFeaturesDirty   = true;
  if (tab === 'tools')      spToolsDirty      = true;
  if (tab === 'companion')  spCompanionDirty  = true;
  _spUpdateFooterButtons();
}

function _spClearDirty(tab) {
  if (tab === 'model')      spServerDirty     = false;
  if (tab === 'generation') spGenerationDirty = false;
  if (tab === 'display')    spDisplayDirty    = false;
  if (tab === 'features')   spFeaturesDirty   = false;
  if (tab === 'tools')      spToolsDirty      = false;
  if (tab === 'companion')  spCompanionDirty  = false;
  _spUpdateFooterButtons();
}

function _spUpdateFooterButtons() {
  const map = {
    model:      spServerDirty,
    generation: spGenerationDirty,
    display:    spDisplayDirty,
    features:   spFeaturesDirty,
    tools:      spToolsDirty,
    companion:  spCompanionDirty,
  };
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
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.add('open');
  _spShowLoadingState(true);
  await spLoad();
  _spShowLoadingState(false);
  spSwitchTab('model');
}

function _spShowLoadingState(isLoading) {
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  // Elements to show/hide around the spinner
  const toggleEls = panel.querySelectorAll('.sp-tabs, .tab-body, .sp-footer-row');

  let spinner = panel.querySelector('.sp-loading-spinner');
  if (!spinner) {
    spinner = document.createElement('div');
    spinner.className = 'panel-loading-spinner sp-loading-spinner';
    // Insert after the header
    const header = panel.querySelector('.sp-header');
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

function closeSettings() {
  const anyDirty = spServerDirty || spGenerationDirty || spDisplayDirty || spFeaturesDirty || spToolsDirty || spCompanionDirty;
  if (anyDirty) {
    if (!confirm('You have unsaved changes. Close anyway?')) return;
  }
  spServerDirty = spGenerationDirty = spDisplayDirty = spFeaturesDirty = spToolsDirty = spCompanionDirty = false;
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
  ['model','generation','display','features','companion','tools'].forEach(tab => {
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
    spActiveFolder = spSettings.config?.companion_folder || 'senni';
    _spAvatarChanged = false;
    _spNewAvatarData = null;
    spPopulateServer();
    spPopulateGeneration();
    spPopulateDisplay();
    spPopulateFeatures();
    spPopulateTools();
    spPopulateCompanion();
    spPopulateAbout();
    spServerDirty = spGenerationDirty = spDisplayDirty = spFeaturesDirty = spToolsDirty = spCompanionDirty = false;
    _spUpdateFooterButtons();
  } catch(e) {
    console.warn('Settings load failed:', e);
  } finally {
    if (title) title.textContent = origTitle;
  }
}

// ── About tab — Tauri-only server controls ────────────────────────────────────

function spInitAboutTauri() {
  if (!window.__TAURI__) return;
  document.getElementById('tauri-server-section').style.display = '';
  window.__TAURI__.core.invoke('get_tauri_prefs_cmd').then(prefs => {
    const tog = document.getElementById('tog-show-console');
    if (tog) tog.classList.toggle('on', !!prefs?.show_console);
  }).catch(() => {});
  window.__TAURI__.core.invoke('get_log_file_path').then(path => {
    const el  = document.getElementById('server-log-path-row');
    const txt = document.getElementById('server-log-path');
    if (el && txt && path) { txt.textContent = path; el.style.display = ''; }
  }).catch(() => {});
}

async function openServerLog(forceOpen = false) {
  if (!window.__TAURI__) return;
  const overlay = document.getElementById('settings-overlay');
  if (!overlay?.classList.contains('open')) await openSettings();
  spSwitchTab('about');

  const panel      = document.getElementById('server-log-panel');
  const refreshBtn = document.getElementById('btn-refresh-log');
  if (!panel) return;

  if (!forceOpen && panel.style.display !== 'none') {
    panel.style.display = 'none';
    if (refreshBtn) refreshBtn.style.display = 'none';
    return;
  }

  panel.textContent = 'Loading…';
  panel.style.display = '';
  if (refreshBtn) refreshBtn.style.display = '';
  await _loadServerLog(panel);
}

async function refreshServerLog() {
  const panel = document.getElementById('server-log-panel');
  if (!panel || !window.__TAURI__) return;
  panel.textContent = 'Loading…';
  await _loadServerLog(panel);
}

async function _loadServerLog(panel) {
  try {
    const lines = await window.__TAURI__.core.invoke('get_sidecar_log');
    panel.textContent = lines.length ? lines.join('\n') : '(no output captured yet)';
    panel.scrollTop = panel.scrollHeight;
  } catch (e) {
    panel.textContent = `Error: ${e}`;
  }
}

function spToggleShowConsole(el) {
  if (!window.__TAURI__) return;
  el.classList.toggle('on');
  const note = document.getElementById('show-console-note');
  if (note) note.style.display = el.classList.contains('on') ? '' : 'none';
  window.__TAURI__.core.invoke('set_show_console', { value: el.classList.contains('on') }).catch(() => {});
}
