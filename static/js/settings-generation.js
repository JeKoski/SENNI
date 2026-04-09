// settings-generation.js — Settings panel: Generation tab
// Depends on: settings.js (spSettings, _spSetDirty, _spClearDirty,
//             spShowSavedToast, closeSettings)

// ── Populate ──────────────────────────────────────────────────────────────────
function spPopulateGeneration() {
  const gen = spSettings.config?.generation || {};
  const set = (id, lblId, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
    const lbl = document.getElementById(lblId);
    if (lbl) lbl.textContent = parseFloat(val).toFixed(id.includes('topk') || id.includes('tokens') ? 0 : 2);
  };
  set('sp-temperature',    'lbl-temp', gen.temperature    ?? 0.8);
  set('sp-top-p',          'lbl-topp', gen.top_p          ?? 0.95);
  set('sp-top-k',          'lbl-topk', gen.top_k          ?? 40);
  set('sp-repeat-penalty', 'lbl-rpen', gen.repeat_penalty ?? 1.1);
  document.getElementById('sp-max-tokens').value = gen.max_tokens ?? 1024;
  const mtr = document.getElementById('sp-max-tool-rounds');
  if (mtr) mtr.value = gen.max_tool_rounds ?? 8;
  const vmode = gen.vision_mode || 'always';
  document.querySelectorAll('#sp-vision-mode input[name="vision-mode"]').forEach(r => { r.checked = r.value === vmode; });
  const togMd = document.getElementById('tog-markdown');
  const mdEnabled = gen.markdown_enabled !== false;
  if (togMd) togMd.classList.toggle('on', mdEnabled);
  // Keep the renderer in sync — without this, opening Settings would leave
  // _markdownEnabled stale even though the toggle visually looks correct.
  if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(mdEnabled);
  const togCtrl = document.getElementById('tog-controls-visible');
  if (togCtrl) togCtrl.classList.toggle('on', localStorage.getItem('controls_always_visible') === 'true');
}

function spMarkGenerationDirty() { _spSetDirty('generation'); }

function spToggleControlsVisible(tog) {
  tog.classList.toggle('on');
  const val = tog.classList.contains('on');
  if (typeof setControlsAlwaysVisible === 'function') setControlsAlwaysVisible(val);
  _spSetDirty('generation');
}

function spResetGeneration() {
  if (!confirm('Reset all generation settings to defaults?')) return;
  spSettings.config = spSettings.config || {};
  spSettings.config.generation = {};
  spPopulateGeneration();
  _spSetDirty('generation');
}

function spToggleMarkdown(el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(enabled);
  if (typeof config !== 'undefined' && config.generation) config.generation.markdown_enabled = enabled;
  _spSetDirty('generation');
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function spSaveGeneration(andClose = false) {
  const gen = {
    temperature:      parseFloat(document.getElementById('sp-temperature')?.value)    ?? 0.8,
    top_p:            parseFloat(document.getElementById('sp-top-p')?.value)          ?? 0.95,
    top_k:            parseInt(document.getElementById('sp-top-k')?.value)            ?? 40,
    repeat_penalty:   parseFloat(document.getElementById('sp-repeat-penalty')?.value) ?? 1.1,
    max_tokens:       parseInt(document.getElementById('sp-max-tokens')?.value)       ?? 1024,
    max_tool_rounds:  parseInt(document.getElementById('sp-max-tool-rounds')?.value)  ?? 8,
    vision_mode:      document.querySelector('#sp-vision-mode input[name="vision-mode"]:checked')?.value || 'always',
    markdown_enabled: document.getElementById('tog-markdown')?.classList.contains('on') ?? true,
  };
  await fetch('/api/settings/generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gen),
  });
  if (spSettings.config) spSettings.config.generation = gen;
  _spClearDirty('generation');
  spShowSavedToast('Generation settings saved ✓');
  if (andClose) closeSettings();
}
