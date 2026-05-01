// companion-tools.js — Companion Settings: Tools tab (per-companion overrides)
// Depends on: companion.js (cpSettings, cpFolder, cpMarkDirty)

const _CP_TOOL_NAMES = [
  { name: 'memory',                desc: 'Read and write soul and mind markdown files' },
  { name: 'write_memory',          desc: 'Save a note to episodic memory (ChromaDB)' },
  { name: 'retrieve_memory',       desc: 'Query episodic memory for relevant notes' },
  { name: 'supersede_memory',      desc: 'Update or replace an existing episodic note' },
  { name: 'update_relational_state', desc: 'Update relational closeness and trust values' },
  { name: 'set_mood',              desc: 'Set the companion\'s active mood' },
  { name: 'web_search',            desc: 'Search the web for information' },
  { name: 'web_scrape',            desc: 'Fetch and read the contents of a URL' },
  { name: 'get_time',              desc: 'Get the current date and time' },
];

let _cpToolsInitDone = false;
let _cpToolsOverrides = {};   // { toolName: 'global' | 'on' | 'off' }

// ── Init ──────────────────────────────────────────────────────────────────────
function cpToolsInit() {
  if (_cpToolsInitDone) return;
  _cpToolsInitDone = true;

  // Read per-companion overrides (null/absent = inherit global)
  const perCompanion = cpSettings?.active_companion?.tools_enabled || {};
  _cpToolsOverrides = {};
  _CP_TOOL_NAMES.forEach(({ name }) => {
    const v = perCompanion[name];
    _cpToolsOverrides[name] = v === true ? 'on' : v === false ? 'off' : 'global';
  });

  _cpToolsRender();
}

function cpToolsReset() {
  _cpToolsInitDone = false;
  _cpToolsOverrides = {};
}

// ── Render ────────────────────────────────────────────────────────────────────
function _cpToolsRender() {
  const list = document.getElementById('cp-tools-list');
  if (!list) return;
  list.innerHTML = '';

  _CP_TOOL_NAMES.forEach(({ name, desc }) => {
    const state = _cpToolsOverrides[name] || 'global';
    const globalEnabled = cpSettings?.config?.tools_enabled?.[name] !== false;

    const row = document.createElement('div');
    row.className = 'cp-tool-row';
    row.innerHTML = `
      <span class="cp-tool-name-cp">${name}</span>
      <span class="cp-tool-desc-cp">${desc}</span>
      <div class="cp-tool-chips" id="cpt-chips-${name}">
        <button class="cp-tool-chip${state === 'global' ? ' active' : ''}" data-state="global"
          onclick="cpToolsSetState('${name}','global')" title="Inherit global (currently ${globalEnabled ? 'on' : 'off'})">Global</button>
        <button class="cp-tool-chip${state === 'on' ? ' active' : ''}" data-state="on"
          onclick="cpToolsSetState('${name}','on')">On</button>
        <button class="cp-tool-chip${state === 'off' ? ' active' : ''}" data-state="off"
          onclick="cpToolsSetState('${name}','off')">Off</button>
      </div>
    `;
    list.appendChild(row);
  });
}

// ── State change ──────────────────────────────────────────────────────────────
function cpToolsSetState(toolName, state) {
  _cpToolsOverrides[toolName] = state;
  const chips = document.querySelectorAll(`#cpt-chips-${toolName} .cp-tool-chip`);
  chips.forEach(c => c.classList.toggle('active', c.dataset.state === state));
  cpMarkDirty();
}

// ── Payload ───────────────────────────────────────────────────────────────────
function _cpGetToolsPayload() {
  // Only emit explicit overrides — omit 'global' entries so companion config
  // stays clean and the backend can default-inherit from global.
  const tools_enabled = {};
  let hasOverride = false;
  _CP_TOOL_NAMES.forEach(({ name }) => {
    const s = _cpToolsOverrides[name] || 'global';
    if (s === 'on')  { tools_enabled[name] = true;  hasOverride = true; }
    if (s === 'off') { tools_enabled[name] = false; hasOverride = true; }
  });
  // Always send the key (even if empty) so the backend knows to clear stale overrides
  return { companion_tools_enabled: tools_enabled };
}
