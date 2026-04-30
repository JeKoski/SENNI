// settings-display.js — Settings panel: Display tab
// Depends on: settings.js (spSettings, _spSetDirty, _spClearDirty, spShowSavedToast, closeSettings)

// ── Populate ──────────────────────────────────────────────────────────────────
function spPopulateDisplay() {
  const gen   = spSettings.config?.generation || {};
  const pills = spSettings.config?.tool_pills  || {};
  const cfg   = spSettings.config || {};

  // Chat display toggles
  const togMd = document.getElementById('tog-markdown');
  const mdEnabled = gen.markdown_enabled !== false;
  if (togMd) togMd.classList.toggle('on', mdEnabled);
  // Keep renderer in sync when settings opens
  if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(mdEnabled);

  const togThink = document.getElementById('tog-thinking-autoopen');
  if (togThink) togThink.classList.toggle('on', gen.thinking_autoopen === true);

  const togCtrl = document.getElementById('tog-controls-visible');
  if (togCtrl) togCtrl.classList.toggle('on', localStorage.getItem('controls_always_visible') === 'true');

  // Tool pill toggles — default true except episodic_read
  const pillDefaults = {
    memory_writes:  true,
    mood:           true,
    relational:     true,
    episodic_write: true,
    episodic_read:  false,
    web:            true,
    other:          true,
  };
  Object.entries(pillDefaults).forEach(([key, def]) => {
    const togId = 'tog-pills-' + key.replace(/_/g, '-');
    const tog   = document.getElementById(togId);
    if (tog) tog.classList.toggle('on', pills[key] !== undefined ? !!pills[key] : def);
  });

  // Developer toggle
  const togTech = document.getElementById('tog-technical-details');
  if (togTech) togTech.classList.toggle('on', !!cfg.show_technical_details);
}

function spMarkDisplayDirty() { _spSetDirty('display'); }

function spToggleMarkdown(el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(enabled);
  if (typeof config !== 'undefined' && config.generation) config.generation.markdown_enabled = enabled;
  _spSetDirty('display');
}

function spToggleThinkingAutoopen(el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  if (typeof config !== 'undefined' && config.generation) config.generation.thinking_autoopen = enabled;
  _spSetDirty('display');
}

function spToggleControlsVisible(tog) {
  tog.classList.toggle('on');
  const val = tog.classList.contains('on');
  if (typeof setControlsAlwaysVisible === 'function') setControlsAlwaysVisible(val);
  _spSetDirty('display');
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function spSaveDisplay(andClose = false) {
  const tog = id => document.getElementById(id)?.classList.contains('on');

  // Generation keys that live here (no restart needed)
  const genPatch = {
    markdown_enabled:  tog('tog-markdown')         ?? true,
    thinking_autoopen: tog('tog-thinking-autoopen') ?? false,
  };
  await fetch('/api/settings/generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(genPatch),
  });
  if (spSettings.config?.generation) Object.assign(spSettings.config.generation, genPatch);

  // Display-specific keys
  const displayPatch = {
    show_technical_details: tog('tog-technical-details') ?? false,
    tool_pills: {
      memory_writes:  tog('tog-pills-memory-writes')  ?? true,
      mood:           tog('tog-pills-mood')            ?? true,
      relational:     tog('tog-pills-relational')      ?? true,
      episodic_write: tog('tog-pills-episodic-write')  ?? true,
      episodic_read:  tog('tog-pills-episodic-read')   ?? false,
      web:            tog('tog-pills-web')             ?? true,
      other:          tog('tog-pills-other')           ?? true,
    },
  };
  await fetch('/api/settings/display', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(displayPatch),
  });
  if (spSettings.config) {
    spSettings.config.show_technical_details = displayPatch.show_technical_details;
    spSettings.config.tool_pills = displayPatch.tool_pills;
  }

  // Propagate tool_pills to message-renderer if loaded
  if (typeof config !== 'undefined') {
    config.tool_pills = displayPatch.tool_pills;
    config.show_technical_details = displayPatch.show_technical_details;
  }

  _spClearDirty('display');
  spShowSavedToast('Display settings saved ✓');
  if (andClose) closeSettings();
}
