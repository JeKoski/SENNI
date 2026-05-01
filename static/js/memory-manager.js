// memory-manager.js — Memory Manager floating modal
// Phase 1: soul/mind file editor
// Depends on: companion.js (cpFolder, cpShowToast)

let _mmSoulFile    = null;   // currently selected file name
let _mmSoulFiles   = {};     // { fname: content }
let _mmFolder      = '';     // companion folder at time of open

// ── Open / close ──────────────────────────────────────────────────────────────
async function openMemoryManager() {
  _mmFolder = cpFolder || '';
  const overlay = document.getElementById('mm-overlay');
  if (!overlay) return;

  // Update companion label
  const name = cpSettings?.active_companion?.companion_name || _mmFolder || '—';
  const labelEl = document.getElementById('mm-companion-label');
  if (labelEl) labelEl.textContent = name;
  const footerLabel = document.getElementById('mm-footer-label');
  if (footerLabel) footerLabel.textContent = `folder: ${_mmFolder}`;

  overlay.classList.add('open');
  await _mmLoadSoulFiles();
}

function closeMemoryManager() {
  document.getElementById('mm-overlay')?.classList.remove('open');
  _mmSoulFile  = null;
  _mmSoulFiles = {};
}

// ── Load files ────────────────────────────────────────────────────────────────
async function _mmLoadSoulFiles() {
  try {
    const res  = await fetch(`/api/settings/soul/${_mmFolder}`);
    const data = await res.json();
    _mmSoulFiles = data.files || {};
    _mmRenderTabs();
  } catch(e) {
    console.warn('_mmLoadSoulFiles failed:', e);
  }
}

function _mmRenderTabs() {
  const tabsEl    = document.getElementById('mm-soul-tabs');
  const contentEl = document.getElementById('mm-soul-content');
  const saveBtn   = document.getElementById('mm-save-btn');
  if (!tabsEl) return;

  tabsEl.innerHTML = '';
  _mmSoulFile = null;
  if (contentEl) contentEl.value = '';
  if (saveBtn)   saveBtn.style.display = 'none';

  Object.keys(_mmSoulFiles).forEach(fname => {
    const tab = document.createElement('button');
    tab.className = 'cp-soul-tab';
    tab.textContent = fname;
    tab.onclick = () => {
      tabsEl.querySelectorAll('.cp-soul-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      _mmSoulFile = fname;
      if (contentEl) {
        contentEl.value = _mmSoulFiles[fname];
        contentEl.dispatchEvent(new Event('input'));   // shows save btn
      }
    };
    tabsEl.appendChild(tab);
  });
}

// ── Save / new ────────────────────────────────────────────────────────────────
async function mmSaveSoulFile() {
  if (!_mmSoulFile) return;
  const content = document.getElementById('mm-soul-content')?.value || '';
  try {
    await fetch(`/api/settings/soul/${_mmFolder}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: _mmSoulFile, content }),
    });
    _mmSoulFiles[_mmSoulFile] = content;   // update local cache
    const saveBtn = document.getElementById('mm-save-btn');
    if (saveBtn) saveBtn.style.display = 'none';
    if (typeof cpShowToast === 'function') cpShowToast(`${_mmSoulFile} saved ✓`);
  } catch(e) {
    console.warn('mmSaveSoulFile failed:', e);
    if (typeof cpShowToast === 'function') cpShowToast('Save failed ✗');
  }
}

async function mmNewSoulFile() {
  const name = prompt('File name (e.g. notes.md):');
  if (!name) return;
  const fname = (name.endsWith('.md') || name.endsWith('.txt')) ? name : name + '.md';
  _mmSoulFiles[fname] = '';
  _mmRenderTabs();
  // Auto-select the new file
  const tabsEl = document.getElementById('mm-soul-tabs');
  const newTab = tabsEl?.querySelector(`.cp-soul-tab:last-child`);
  if (newTab) newTab.click();
}
