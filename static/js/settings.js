// settings.js — Settings panel coordinator: shared state, open/close,
//               tab switching, load, toast, dirty tracking.
// Loaded before settings-server.js, settings-generation.js, settings-companion.js.
//
// Tab logic lives in:
//   settings-server.js     — Server tab
//   settings-generation.js — Generation tab
//   settings-companion.js  — Companion tab + About tab
//   settings_os_paths.js   — Per-OS paths section (inside Server tab)

// ── Shared state (read by all tab modules) ────────────────────────────────────
let spSettings        = null;
let spActiveFolder    = '';
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
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.add('open');
  _spShowLoadingState(true);
  await spLoad();
  _spShowLoadingState(false);
  spSwitchTab('server');
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
