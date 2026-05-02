// companion-switcher.js — Companion switcher popover above sidebar footer

let _csOpen = false;

function openCompanionSwitcher(e) {
  e?.stopPropagation();
  if (_csOpen) { closeCompanionSwitcher(); return; }
  const popover = document.getElementById('companions-popover');
  if (!popover) return;
  // Fetch fresh list so it's always current
  fetch('/api/settings')
    .then(r => r.json())
    .then(data => {
      _renderCompanionSwitcher(data.companions || [], data.config?.companion_folder || '');
      popover.classList.add('open');
      _csOpen = true;
      setTimeout(() => document.addEventListener('click', _csOutsideClick), 0);
    })
    .catch(err => console.error('[companion-switcher]', err));
}

function closeCompanionSwitcher() {
  _csOpen = false;
  document.getElementById('companions-popover')?.classList.remove('open');
  document.removeEventListener('click', _csOutsideClick);
}

function _csOutsideClick(e) {
  const popover = document.getElementById('companions-popover');
  const btn = document.getElementById('companions-btn');
  if (popover && !popover.contains(e.target) && !btn?.contains(e.target)) {
    closeCompanionSwitcher();
  }
}

function _renderCompanionSwitcher(companions, activeFolder) {
  const list = document.getElementById('companions-popover-list');
  if (!list) return;
  if (!companions.length) {
    list.innerHTML = '<div class="companions-popover-empty">No companions found</div>';
    return;
  }
  list.innerHTML = companions.map(c => {
    const isActive = c.folder === activeFolder;
    const safeFolder = (c.folder || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const safeName = _csEsc(c.name || c.folder);
    return `<div class="companions-popover-row${isActive ? ' active' : ''}" onclick="_csSwitchTo('${safeFolder}')">
      <span class="companions-popover-name">${safeName}</span>
      ${isActive ? '<span class="companions-popover-badge">active</span>' : ''}
    </div>`;
  }).join('');
}

async function _csSwitchTo(folder) {
  closeCompanionSwitcher();
  if (!folder || folder === (config?.companion_folder || '')) return;
  try {
    await fetch('/api/settings/companion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, set_active: true }),
    });
    window.location.reload();
  } catch (err) {
    console.error('[companion-switcher] switch failed:', err);
  }
}

function _csEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
