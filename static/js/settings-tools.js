// settings-tools.js — Settings panel: Tools tab
// Depends on: settings.js (spSettings, _spSetDirty, _spClearDirty, spShowSavedToast, closeSettings)

const _TOOL_NAMES = [
  'memory', 'write_memory', 'retrieve_memory', 'supersede_memory',
  'update_relational_state', 'set_mood', 'web_search', 'web_scrape', 'get_time',
];

// ── Populate ──────────────────────────────────────────────────────────────────
function spPopulateTools() {
  const enabled = spSettings.config?.tools_enabled || {};
  _TOOL_NAMES.forEach(name => {
    const tog = document.getElementById('tool-tog-' + name);
    if (!tog) return;
    // Default all tools enabled
    tog.classList.toggle('on', enabled[name] !== false);
  });
}

function spMarkToolsDirty() { _spSetDirty('tools'); }

// ── Save ──────────────────────────────────────────────────────────────────────
async function spSaveTools(andClose = false) {
  const toolsEnabled = {};
  _TOOL_NAMES.forEach(name => {
    const tog = document.getElementById('tool-tog-' + name);
    toolsEnabled[name] = tog ? tog.classList.contains('on') : true;
  });

  await fetch('/api/settings/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tools_enabled: toolsEnabled }),
  });
  if (spSettings.config) spSettings.config.tools_enabled = toolsEnabled;

  _spClearDirty('tools');
  spShowSavedToast('Tool settings saved ✓');
  if (andClose) closeSettings();
}
