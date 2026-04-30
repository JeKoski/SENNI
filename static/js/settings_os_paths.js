// settings_os_paths.js — Per-OS path management UI
// Renders the "Per-OS paths" section in the Server settings tab.
// Called by spPopulateServer() in settings.js after the main server fields are filled.
//
// Depends on: spSettings, spMarkServerDirty(), spShowSavedToast() from settings.js

// ── OS display helpers ────────────────────────────────────────────────────────

const OS_META = {
  Linux:   { label: '🐧 Linux',   accent: 'rgba(109,212,168,0.7)'  },
  Windows: { label: '🪟 Windows', accent: 'rgba(129,140,248,0.7)'  },
  Darwin:  { label: '🍎 macOS',   accent: 'rgba(251,191,36,0.7)'   },
};

function _currentOS() {
  const fromServer = spSettings?.platform;
  if (fromServer) return fromServer;
  const ua = navigator.userAgent;
  if (ua.includes('Win'))  return 'Windows';
  if (ua.includes('Mac'))  return 'Darwin';
  return 'Linux';
}

// ── Main render function (called by spPopulateServer) ─────────────────────────

function spRenderOsPaths(cfg) {
  let section = document.getElementById('sp-os-paths-section');
  if (!section) section = _createOsPathsSection();

  const modelPaths     = cfg?.model_paths      || {};
  const mmprojPaths    = cfg?.mmproj_paths     || {};
  const gpuTypes       = cfg?.gpu_types        || {};
  const serverBinaries = cfg?.server_binaries  || {};
  const currentOS      = _currentOS();

  // Show any OS that has at least one field, plus always show the current OS
  const allOS = new Set([
    ...Object.keys(modelPaths),
    ...Object.keys(mmprojPaths),
    ...Object.keys(gpuTypes),
    ...Object.keys(serverBinaries),
    currentOS,
  ]);
  const osList = ['Linux', 'Windows', 'Darwin'].filter(os => allOS.has(os));

  const listEl = document.getElementById('sp-os-paths-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (osList.length === 0) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--text-dim);padding:8px 0">No per-OS paths saved yet. Paths are saved automatically when you use SENNI on each platform.</div>';
    return;
  }

  osList.forEach(os => {
    const meta       = OS_META[os] || { label: os, accent: 'rgba(221,225,240,0.5)' };
    const isActive   = os === currentOS;
    const model      = modelPaths[os]     || '';
    const mmproj     = mmprojPaths[os]    || '';
    const gpu        = gpuTypes[os]       || '';
    const binary     = serverBinaries[os] || '';
    const modelName  = model  ? model.split(/[\\/]/).pop()  : '—';
    const mmprojName = mmproj ? mmproj.split(/[\\/]/).pop() : '';
    const binaryName = binary ? binary.split(/[\\/]/).pop() : '';

    const card = document.createElement('div');
    card.className = 'sp-os-card' + (isActive ? ' sp-os-card-active' : '');
    card.style.cssText = [
      'border-radius:12px',
      'border:1px solid ' + (isActive ? meta.accent.replace('0.7', '0.35') : 'rgba(140,145,220,0.12)'),
      'background:'       + (isActive ? 'rgba(129,140,248,0.05)' : 'rgba(255,255,255,0.02)'),
      'padding:12px 14px',
      'margin-bottom:8px',
      'font-size:12.5px',
    ].join(';');

    // Build the detail rows — only show rows that have a value (or show — for model always)
    const rows = [
      { label: 'Model',  value: model,  name: modelName,  always: true  },
      { label: 'mmproj', value: mmproj, name: mmprojName, always: false },
      { label: 'GPU',    value: gpu,    name: gpu,        always: false },
      { label: 'Binary', value: binary, name: binaryName, always: false },
    ];

    const rowsHtml = rows
      .filter(r => r.always || r.value)
      .map(r => `
        <span style="color:var(--text-dim)">${r.label}</span>
        <span class="sp-mono"
          style="color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
          title="${_esc(r.value)}">${_esc(r.name || '—')}</span>
      `).join('');

    const warningHtml = (isActive && !model) ? `
      <div style="margin-top:8px;font-size:11.5px;color:rgba(251,191,36,0.75);display:flex;align-items:center;gap:6px">
        ⚠ No model path saved for this OS yet. Save Server settings to register.
      </div>` : '';

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-weight:500;color:${meta.accent};font-size:12px">${meta.label}</span>
        ${isActive
          ? '<span style="font-size:10px;background:rgba(129,140,248,0.15);border:1px solid rgba(129,140,248,0.25);border-radius:20px;padding:2px 8px;color:var(--indigo)">current OS</span>'
          : `<button class="sp-btn-sm sp-btn-ghost"
               style="font-size:10px;padding:3px 9px;color:var(--red);border-color:rgba(248,113,113,0.25)"
               onclick="spRemoveOsEntry('${os}')">Remove</button>`
        }
      </div>
      <div style="display:grid;grid-template-columns:52px 1fr;gap:4px 10px;align-items:baseline">
        ${rowsHtml}
      </div>
      ${warningHtml}
    `;

    listEl.appendChild(card);
  });
}

// ── Remove a saved OS entry ───────────────────────────────────────────────────

async function spRemoveOsEntry(os) {
  if (!confirm(`Remove saved paths for ${OS_META[os]?.label || os}?\n\nThis only removes the stored path — it won't affect your files.`)) return;

  try {
    const res  = await fetch('/api/settings/os-paths', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ os }),
    });
    const data = await res.json();
    if (data.ok) {
      if (spSettings?.config) {
        delete spSettings.config.model_paths?.[os];
        delete spSettings.config.mmproj_paths?.[os];
        delete spSettings.config.gpu_types?.[os];
        delete spSettings.config.server_binaries?.[os];
      }
      spRenderOsPaths(spSettings?.config || {});
      spShowSavedToast(`${OS_META[os]?.label || os} paths removed`);
    } else {
      alert('Could not remove: ' + (data.error || 'unknown error'));
    }
  } catch (e) {
    alert('Request failed: ' + e.message);
  }
}

// ── Build the section DOM (one-time creation) ─────────────────────────────────

function _createOsPathsSection() {
  const tabServer = document.getElementById('tab-model');
  if (!tabServer) return null;

  const section = document.createElement('div');
  section.id = 'sp-os-paths-section';
  section.style.marginTop = '22px';
  section.innerHTML = `
    <div class="sp-section-label" style="display:flex;align-items:center;justify-content:space-between">
      Per-OS paths
      <span style="font-size:10px;color:var(--text-dim);font-weight:400;text-transform:none;letter-spacing:0">
        saved automatically on each platform
      </span>
    </div>
    <div id="sp-os-paths-list"></div>
  `;

  tabServer.appendChild(section);
  return section;
}

// ── Escape helper ─────────────────────────────────────────────────────────────

function _esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
