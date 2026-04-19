// ── Senni guide copy + mood per step ──────────────────────────────────────
const SENNI_GUIDE = {
  intro:   { mood: 'Warm',        color: '#6dd4a8', text: 'Hi. Let\u2019s get you set up \u2014 it won\u2019t take long.' },
  check:   { mood: 'Curious',     color: '#67e8f9', text: 'Let me take a quick look at your setup\u2026' },
  welcome: { mood: 'Warm',        color: '#6dd4a8', text: 'Good to see you. Everything\u2019s looking good.' },
  engine:  { mood: 'Focused',     color: '#93c5fd', text: 'I need a small engine to run on. I\u2019ll grab the right one for your hardware.' },
  model:   { mood: 'Playful',     color: '#c084fc', text: 'This is basically picking my brain. Literally. Choose whichever sounds right.' },
  extras:  { mood: 'Thoughtful',  color: '#fbbf24', text: 'A couple of optional extras. Voice lets me speak to you. Memory means I\u2019ll actually remember you.' },
  boot:    { mood: 'Anticipating',color: '#818cf8', text: 'Almost there. I\u2019m waking up now \u2014 just a moment.' },
  meet:    { mood: 'Ready',       color: '#6dd4a8', text: 'I\u2019m here.' },
};

// Steps that appear in the top nav (numbered)
const NAV_STEPS = ['engine', 'model', 'extras', 'boot'];

// Steps with a Back button in the footer
const BACK_MAP = { model: 'engine', extras: 'model', boot: 'extras' };

// Steps with a Continue button in the footer
const CONTINUE_MAP = {
  engine: { label: 'Continue \u2192', enabledFn: () => !!enginePath },
  model:  { label: 'Continue \u2192', enabledFn: () => activeModelTab === 'browse' ? !!modelPath : !!selectedModelCard },
  extras: { label: 'Set up features \u2192', enabledFn: () => true },
};

// ── State ──────────────────────────────────────────────────────────────────
let currentStep      = 'intro';
let selectedGPU      = '';
let enginePath       = '';
let modelPath        = '';
let mmprojPath       = '';
let multimodal       = false;
let scanDone         = false;
let _scanResults     = [];
let selectedModelCard = null;
let activeModelTab   = 'download';
let featTts          = true;
let featMemory       = true;

// ── Navigation ────────────────────────────────────────────────────────────
function goTo(name) {
  document.getElementById('step-' + currentStep)?.classList.remove('active');
  currentStep = name;
  const el = document.getElementById('step-' + name);
  if (el) { el.classList.add('active'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; }
  _updateSenni(name);
  _updateNav(name);
  _updateFooter(name);
  if (name === 'boot') _startBoot();
  if (name === 'meet') setTimeout(_animateMeetPortrait, 80);
}

function navBack() {
  const prev = BACK_MAP[currentStep];
  if (prev) goTo(prev);
}

function navContinue() {
  if (currentStep === 'extras') { _installExtras(); return; }
  if (currentStep === 'model' && activeModelTab === 'download') { startModelDownload(); return; }
  const next = { engine: 'model', model: 'extras', extras: 'boot' };
  if (next[currentStep]) goTo(next[currentStep]);
}

// ── Intro screen ──────────────────────────────────────────────────────────
function startSetup() {
  _flipIntroToPanel();  // animate Senni panel from center to side
  runSystemCheck();     // shows step-check and auto-routes
}

// FLIP: captures current panel position (intro = centered), removes .intro
// class so panel snaps to its normal position, then plays transform from
// captured → natural to create the smooth move-to-left-side animation.
function _flipIntroToPanel() {
  const panel = document.getElementById('senni-panel');
  const pair  = document.getElementById('wiz-pair');

  const from = panel.getBoundingClientRect();

  pair.classList.remove('intro');
  panel.offsetHeight; // force reflow so new layout is calculated

  const to = panel.getBoundingClientRect();

  const dx    = from.left - to.left;
  const dy    = from.top  - to.top;
  const scale = from.width / to.width;

  // Start from the "intro" position
  panel.style.transition      = 'none';
  panel.style.transformOrigin = 'top left';
  panel.style.transform       = `translate(${dx}px, ${dy}px) scale(${scale})`;

  // Animate to natural position
  requestAnimationFrame(() => requestAnimationFrame(() => {
    panel.style.transition = 'transform .72s cubic-bezier(.22,1,.36,1)';
    panel.style.transform  = 'none';
  }));

  // Clean up inline styles after animation
  setTimeout(() => {
    panel.style.transition      = '';
    panel.style.transform       = '';
    panel.style.transformOrigin = '';
  }, 900);
}

// ── Senni panel ───────────────────────────────────────────────────────────
function _updateSenni(step) {
  const guide = SENNI_GUIDE[step];
  if (!guide) return;

  // Re-animate speech text (new text fades in)
  const speechEl = document.getElementById('senni-speech-text');
  if (speechEl) {
    speechEl.style.animation = 'none';
    speechEl.offsetHeight;
    speechEl.textContent = guide.text;
    speechEl.style.animation = '';
  }

  // Mood label + dot color
  const moodLabel = document.getElementById('senni-mood-label');
  const moodDot   = document.getElementById('senni-mood-dot');
  if (moodLabel) moodLabel.textContent = guide.mood;
  if (moodDot)   moodDot.style.background = guide.color;

  // Apply orb colors from mood — matches how app orb.js applies mood colors
  _applyOrbMood(guide.color);
}

// Convert hex color to rgba string
function _hex2rgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Apply a mood color to the Senni orb CSS variables
function _applyOrbMood(color) {
  const orb = document.getElementById('senni-orb-body');
  if (!orb) return;
  orb.style.setProperty('--s-orb-bg',     _hex2rgba(color, 0.10));
  orb.style.setProperty('--s-orb-border', _hex2rgba(color, 0.45));
  orb.style.setProperty('--s-glow-color', _hex2rgba(color, 0.30));
  orb.style.setProperty('--s-ring-color', _hex2rgba(color, 0.40));
  // Update dot color on the orb-wrap
  const wrap = document.getElementById('senni-orb-wrap');
  if (wrap) wrap.style.setProperty('--s-dot-color', color);
}

// ── Top nav dots ──────────────────────────────────────────────────────────
function _updateNav(step) {
  const idx = NAV_STEPS.indexOf(step);
  NAV_STEPS.forEach((s, i) => {
    const dot  = document.getElementById('dot-' + s);
    const item = document.getElementById('nav-' + s);
    if (!dot || !item) return;
    if (i < idx)       { dot.className = 'wiz-step-dot done';   item.className = 'step-item done'; }
    else if (i === idx){ dot.className = 'wiz-step-dot active'; item.className = 'step-item active'; }
    else               { dot.className = 'wiz-step-dot';        item.className = 'step-item'; }
  });
}

// ── Footer ─────────────────────────────────────────────────────────────── */
function _updateFooter(step) {
  const backBtn     = document.getElementById('btn-back');
  const continueBtn = document.getElementById('btn-continue');
  const counter     = document.getElementById('step-counter');

  const hasPrev = !!BACK_MAP[step];
  if (backBtn) backBtn.style.visibility = hasPrev ? 'visible' : 'hidden';

  const contConf = CONTINUE_MAP[step];
  if (continueBtn) {
    if (contConf) {
      continueBtn.style.display = '';
      continueBtn.textContent   = contConf.label;
      continueBtn.disabled      = !contConf.enabledFn();
    } else {
      continueBtn.style.display = 'none';
    }
  }

  const idx = NAV_STEPS.indexOf(step);
  if (counter) counter.textContent = idx >= 0 ? `Step ${idx + 1} of ${NAV_STEPS.length}` : '';
}

function _refreshContinue() {
  const contConf = CONTINUE_MAP[currentStep];
  const btn = document.getElementById('btn-continue');
  if (btn && contConf) btn.disabled = !contConf.enabledFn();
}

// ── GPU ───────────────────────────────────────────────────────────────────
function selectGPU(el) {
  document.querySelectorAll('.gpu-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedGPU = el.dataset.gpu;

  document.getElementById('amd-rocm-note').style.display = selectedGPU === 'amd' ? 'flex' : 'none';

  const labels = {
    nvidia: 'Download CUDA engine (NVIDIA) \u2192',
    amd:    'Download Vulkan engine (AMD) \u2192',
    intel:  'Download SYCL engine (Intel Arc) \u2192',
    cpu:    'Download CPU engine \u2192',
  };
  document.getElementById('engine-dl-label').textContent = labels[selectedGPU] || 'Download engine \u2192';
  document.getElementById('engine-dl-btn').disabled = false;

  _refreshContinue();
}

function setDetectedGPU(gpu) {
  selectedGPU = gpu;
  document.querySelectorAll('.gpu-chip').forEach(c =>
    c.classList.toggle('selected', c.dataset.gpu === gpu)
  );
  const labels = { intel: 'Intel GPU detected', nvidia: 'NVIDIA GPU detected', amd: 'AMD GPU detected (Vulkan build)', cpu: 'No discrete GPU — CPU mode' };
  document.getElementById('detected-label').textContent = labels[gpu] || gpu;
  document.getElementById('detected-note').style.display = 'flex';
  if (gpu === 'amd') document.getElementById('amd-rocm-note').style.display = 'flex';

  const dlLabels = {
    nvidia: 'Download CUDA engine (NVIDIA) \u2192',
    amd:    'Download Vulkan engine (AMD) \u2192',
    intel:  'Download SYCL engine (Intel Arc) \u2192',
    cpu:    'Download CPU engine \u2192',
  };
  document.getElementById('engine-dl-label').textContent = dlLabels[gpu] || 'Download engine \u2192';
  document.getElementById('engine-dl-btn').disabled = false;
}

// ── Engine download (stub for Phase 1) ────────────────────────────────────
function downloadEngine() {
  const prog = document.getElementById('engine-dl-progress');
  prog.style.display = 'block';
  document.getElementById('engine-dl-btn').disabled = true;
  _stubProgress('engine-dl-fill', 'engine-dl-status', 'engine-dl-eta', () => {
    enginePath = '/stubs/llama-server';
    setFileDisplay('engine', enginePath, true);
    _refreshContinue();
  });
}

// ── Model tab switching ────────────────────────────────────────────────── */
function switchModelTab(tab) {
  activeModelTab = tab;
  document.getElementById('tab-download').classList.toggle('active', tab === 'download');
  document.getElementById('tab-browse').classList.toggle('active', tab === 'browse');
  document.getElementById('model-dl-tab').style.display     = tab === 'download' ? 'block' : 'none';
  document.getElementById('model-browse-tab').style.display = tab === 'browse'   ? 'block' : 'none';
  _refreshContinue();
}

// ── Model card selection ──────────────────────────────────────────────────
function selectModelCard(el) {
  document.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedModelCard = el.dataset.model;
  // Also enable the Download button
  document.getElementById('btn-model-dl-next').disabled = false;
  _refreshContinue();
}

function startModelDownload() {
  if (!selectedModelCard) return;
  document.getElementById('model-dl-actions').style.display = 'none';
  document.querySelectorAll('.model-card').forEach(c => c.style.pointerEvents = 'none');
  document.getElementById('model-dl-progress').style.display = 'block';
  _stubProgress('model-dl-fill', 'model-dl-status', 'model-dl-eta', () => {
    modelPath = '/stubs/model.gguf';
    goTo('extras');
  });
}

function cancelModelDownload() {
  document.getElementById('model-dl-progress').style.display = 'none';
  document.getElementById('model-dl-actions').style.display = 'flex';
  document.querySelectorAll('.model-card').forEach(c => c.style.pointerEvents = '');
}

// ── Extras / feature toggles ──────────────────────────────────────────────
function toggleFeature(feat) {
  if (feat === 'tts') {
    featTts = !featTts;
    document.getElementById('tts-toggle').classList.toggle('on', featTts);
    document.getElementById('feat-tts').classList.toggle('enabled', featTts);
  } else {
    featMemory = !featMemory;
    document.getElementById('memory-toggle').classList.toggle('on', featMemory);
    document.getElementById('feat-memory').classList.toggle('enabled', featMemory);
  }
}

function _installExtras() {
  if (!featTts && !featMemory) { goTo('boot'); return; }
  const prog = document.getElementById('extras-dl-progress');
  prog.style.display = 'block';
  document.getElementById('btn-continue').disabled = true;
  _stubProgress('extras-dl-fill', 'extras-dl-status', 'extras-dl-eta', () => goTo('boot'));
}

// ── Multimodal ────────────────────────────────────────────────────────────
function toggleMultimodal() {
  multimodal = !multimodal;
  document.getElementById('mm-toggle').classList.toggle('on', multimodal);
  document.getElementById('mmproj-section').classList.toggle('visible', multimodal);
  if (multimodal && modelPath) fetchMmprojCandidates(modelPath);
  if (!multimodal) { mmprojPath = ''; setFileDisplay('mmproj', '', false); }
  _refreshContinue();
}

// ── File browser ──────────────────────────────────────────────────────────
async function browseFile(type) {
  const chipId = type === 'binary' ? 'engine-chip' : type + '-chip';
  const chip   = document.getElementById(chipId);
  if (chip) chip.style.opacity = '0.6';
  try {
    const res  = await fetch('/api/browse', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ type }) });
    const data = await res.json();
    if (data.ok && data.path)      _applyPath(type, data.path);
    else if (data.reason !== 'cancelled') _showPathFallback(type);
  } catch (e) { _showPathFallback(type); }
  finally     { if (chip) chip.style.opacity = '1'; }
}

function _applyPath(type, path) {
  if (type === 'binary') {
    enginePath = path; setFileDisplay('engine', path, true);
  } else if (type === 'model') {
    modelPath = path; setFileDisplay('model', path, true);
    if (multimodal) fetchMmprojCandidates(path);
  } else {
    mmprojPath = path; setFileDisplay('mmproj', path, true);
  }
  document.getElementById((type === 'binary' ? 'engine' : type) + '-path-wrap')?.remove();
  _refreshContinue();
}

function _showPathFallback(type) {
  const chipId = type === 'binary' ? 'engine-chip' : type + '-chip';
  const rowId  = type === 'binary' ? 'engine-chip-row' : type + '-chip-row';
  const wrapId = (type === 'binary' ? 'engine' : type) + '-path-wrap';
  document.getElementById(wrapId)?.remove();
  const chip = document.getElementById(chipId);
  if (!chip) return;
  const label = type === 'binary' ? 'llama-server binary' : type === 'model' ? 'model (.gguf)' : 'mmproj (.gguf)';
  const wrap = document.createElement('div');
  wrap.id = wrapId; wrap.style.cssText = 'margin-top:8px';
  wrap.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:5px">Couldn\u2019t open file picker \u2014 paste the full path to your ${label}:</div>
    <input id="${wrapId}-input" type="text" placeholder="${type === 'binary' ? '/path/to/llama-server' : '/path/to/file.gguf'}"
      style="width:100%;background:rgba(0,0,0,0.2);border:1px solid rgba(129,140,248,0.3);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:12px;padding:10px 13px;outline:none;box-sizing:border-box"/>`;
  const row = document.getElementById(rowId);
  if (row) row.insertAdjacentElement('afterend', wrap);
  wrap.querySelector('input').addEventListener('input', e => _applyPath(type, e.target.value.trim()));
  wrap.querySelector('input').focus();
}

function onNativePick(input, type) {
  const file = input.files?.[0]; if (!file) return; input.value = '';
  const match = (_scanResults||[]).find(f => f.name === file.name);
  if (match) { _applyPath(type, match.path); return; }
  setFileDisplay(type, file.name, false); _showPathFallback(type);
}

function setFileDisplay(type, path, isSet) {
  const chipId     = type === 'binary' ? 'engine-chip' : type + '-chip';
  const chipNameId = type === 'binary' ? 'engine-chip-name' : type + '-chip-name';
  const chip     = document.getElementById(chipId);
  const chipName = document.getElementById(chipNameId);
  if (chip && chipName) {
    chipName.textContent = path ? path.split(/[\\/]/).pop() : 'Click to select\u2026';
    chipName.title       = path || '';
    chip.classList.toggle('set',   !!isSet);
    chip.classList.toggle('empty', !isSet);
  }
}

// ── Scan ──────────────────────────────────────────────────────────────────
async function scanForModels() {
  const btn = document.getElementById('scan-btn');
  if (scanDone) { document.getElementById('scan-results').classList.toggle('visible'); return; }
  btn.innerHTML = '<span class="mini-spin"></span> Scanning\u2026'; btn.disabled = true;
  try {
    const res  = await fetch('/api/scan/models');
    const data = await res.json();
    _scanResults = data.gguf_files || []; renderScanResults(_scanResults); scanDone = true;
  } catch (e) { _scanResults = []; renderScanResults([]); scanDone = true; }
  btn.innerHTML = 'Show / hide results'; btn.disabled = false;
}

function renderScanResults(files) {
  const wrap = document.getElementById('scan-results'); wrap.innerHTML = '';
  if (!files.length) { wrap.innerHTML = '<div class="scan-empty">No .gguf files found in common locations.</div>'; }
  else files.forEach(f => {
    const item = document.createElement('div'); item.className = 'scan-item';
    item.innerHTML = `<div style="min-width:0;overflow:hidden"><div class="scan-name">${f.name}</div><div class="scan-path" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.path}</div></div><div class="scan-size">${f.size_gb} GB</div>`;
    item.onclick = () => { document.querySelectorAll('.scan-item').forEach(i=>i.classList.remove('selected')); item.classList.add('selected'); _applyPath('model', f.path); };
    wrap.appendChild(item);
  });
  wrap.classList.add('visible');
}

async function fetchMmprojCandidates(forModelPath) {
  try {
    const res  = await fetch('/api/mmproj-candidates?model_path=' + encodeURIComponent(forModelPath));
    const data = await res.json();
    const list = data.candidates || [];
    const wrap = document.getElementById('mmproj-candidates-wrap');
    const listEl = document.getElementById('mmproj-candidate-list');
    listEl.innerHTML = '';
    if (!list.length) { wrap.style.display = 'none'; return; }
    list.forEach(c => {
      const item = document.createElement('div'); item.className = 'candidate-item';
      item.textContent = c.name; item.title = c.path;
      item.onclick = () => { listEl.querySelectorAll('.candidate-item').forEach(d=>d.classList.remove('selected')); item.classList.add('selected'); _applyPath('mmproj', c.path); };
      listEl.appendChild(item);
    });
    wrap.style.display = 'block';
  } catch (e) { /* non-critical */ }
}

// ── Meet Senni ────────────────────────────────────────────────────────────
function meetSenni() {
  window.location.href = '/chat';
}

// FLIP: animate meet portrait from senni panel position to its natural position.
// Also fades the panel so it doesn't feel like two Sennis.
function _animateMeetPortrait() {
  const panelOrb   = document.getElementById('senni-orb-body');
  const meetPortrait = document.getElementById('meet-portrait');
  if (!panelOrb || !meetPortrait) return;

  const from = panelOrb.getBoundingClientRect();
  const to   = meetPortrait.getBoundingClientRect();

  const dx    = from.left - to.left;
  const dy    = from.top  - to.top;
  const scale = from.width / to.width;

  meetPortrait.style.transition      = 'none';
  meetPortrait.style.transformOrigin = 'top left';
  meetPortrait.style.transform       = `translate(${dx}px, ${dy}px) scale(${scale})`;

  requestAnimationFrame(() => requestAnimationFrame(() => {
    meetPortrait.style.transition = 'transform .72s cubic-bezier(.22,1,.36,1)';
    meetPortrait.style.transform  = 'none';
  }));

  // Fade the panel orb as portrait "travels over"
  const panel = document.getElementById('senni-panel');
  if (panel) {
    panel.style.transition = 'opacity .5s ease';
    panel.style.opacity = '0.15';
  }

  setTimeout(() => {
    meetPortrait.style.transition      = '';
    meetPortrait.style.transformOrigin = '';
  }, 900);
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function startBoot() { goTo('boot'); }

async function _startBoot() {
  clearError('err-boot');
  try { await fetch('/api/shutdown-model', { method: 'POST' }); } catch {}
  const res = await fetch('/api/setup', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ model_path: modelPath, mmproj_path: multimodal ? mmprojPath : '', gpu_type: selectedGPU, ngl: 99, port_bridge: 8000, port_model: 8081 })
  });
  if (!res.ok) { showError('err-boot', 'Could not save config. Is the server running?'); return; }
  await fetch('/api/boot', { method: 'POST' });
  streamBootLog();
}

function streamBootLog() {
  const logEl = document.getElementById('boot-log');
  const ring  = document.getElementById('boot-ring');
  logEl.innerHTML = '';
  const es = new EventSource('/api/boot/log');
  es.onmessage = ({ data: raw }) => {
    const data = JSON.parse(raw);
    if (data.line !== undefined) {
      const div = document.createElement('div');
      const lower = data.line.toLowerCase();
      if      (lower.includes('error') || lower.includes('failed')) { div.className='log-err';  div.textContent='\u2717 '+data.line; }
      else if (lower.includes('warn'))                               { div.className='log-warn'; div.textContent='  '+data.line; }
      else if (lower.includes('load') || lower.includes('layer'))   { div.className='log-info'; div.textContent='\u203a '+data.line; }
      else                                                           {                           div.textContent='  '+data.line; }
      logEl.appendChild(div); logEl.scrollTop = logEl.scrollHeight;
    }
    if (data.ready) {
      es.close();
      ring.classList.add('done'); ring.textContent = '\u2713'; ring.style.display = 'flex';
      const ok = document.createElement('div'); ok.className='log-ok'; ok.textContent='\u2713 Server is ready';
      logEl.appendChild(ok); logEl.scrollTop = logEl.scrollHeight;
      document.getElementById('boot-next-row').style.display = 'flex';
    }
  };
  es.onerror = () => { es.close(); showError('err-boot', 'Lost connection to boot log. Check Settings \u2192 Server if the issue persists.'); };
}

// ── System check ──────────────────────────────────────────────────────────
async function runSystemCheck() {
  goTo('check');
  // Enable thinking dots on orb during scan
  document.getElementById('senni-orb-wrap').classList.add('thinking');

  await _delay(300);
  let detected = {};
  try { const res = await fetch('/api/scan'); detected = await res.json(); } catch {}

  await _delay(400);
  _resolveCheck('gpu', detected.gpu_detected ? 'ok' : 'missing',
    detected.gpu_detected ? `${detected.gpu_detected.toUpperCase()} GPU detected` : 'No GPU detected \u2014 CPU mode');
  if (detected.gpu_detected) setDetectedGPU(detected.gpu_detected);
  else setDetectedGPU('cpu'); // safe default so engine step isn't stuck

  await _delay(350);
  const hasEngine = !!(detected.server_binary);
  enginePath = detected.server_binary || '';
  _resolveCheck('engine', hasEngine ? 'ok' : 'missing',
    hasEngine ? detected.server_binary.split(/[\\/]/).pop() : 'Not found \u2014 we\'ll get one');
  if (hasEngine) setFileDisplay('engine', enginePath, true);

  await _delay(300);
  const hasModel = !!(detected.model_path);
  modelPath = detected.model_path || '';
  _resolveCheck('model', hasModel ? 'ok' : 'missing',
    hasModel ? detected.model_path.split(/[\\/]/).pop() : 'Not found \u2014 we\'ll pick one');
  if (hasModel) setFileDisplay('model', modelPath, true);

  await _delay(700);
  document.getElementById('senni-orb-wrap').classList.remove('thinking');

  if (hasEngine && hasModel) {
    _buildWelcomeChips(detected);
    goTo('welcome');
  } else if (hasEngine) {
    goTo('model');
  } else {
    goTo('engine');
  }
}

function _resolveCheck(id, state, subText) {
  const icon = document.getElementById('chk-' + id + '-icon');
  const sub  = document.getElementById('chk-' + id + '-sub');
  if (icon) { icon.innerHTML = state === 'ok' ? '\u2713' : '\u25cb'; icon.className = 'check-icon ' + state; }
  if (sub)  sub.textContent = subText;
}

function _buildWelcomeChips(detected) {
  const wrap = document.getElementById('welcome-chips'); wrap.innerHTML = '';
  const items = [];
  if (detected.gpu_detected)  items.push({ icon: '\u26a1', label: detected.gpu_detected.toUpperCase() + ' GPU' });
  if (detected.server_binary) items.push({ icon: '\u2699\uFE0F', label: detected.server_binary.split(/[\\/]/).pop() });
  if (detected.model_path)    items.push({ icon: '\u{1F4E6}', label: detected.model_path.split(/[\\/]/).pop() });
  items.forEach(({ icon, label }) => {
    wrap.insertAdjacentHTML('beforeend', `<div class="summary-chip"><span class="summary-chip-icon">${icon}</span><span class="summary-chip-label">${label}</span></div>`);
  });
}

// ── Errors ────────────────────────────────────────────────────────────────
function showError(id, msg) { const e=document.getElementById(id); if(e){e.textContent=msg;e.classList.add('visible');} }
function clearError(id)     { const e=document.getElementById(id); if(e){e.textContent='';e.classList.remove('visible');} }

// ── Stub download animation ───────────────────────────────────────────────
function _stubProgress(fillId, statusId, etaId, onDone) {
  let pct = 0;
  const fill=document.getElementById(fillId), status=document.getElementById(statusId), eta=document.getElementById(etaId);
  const tick = setInterval(() => {
    pct = Math.min(pct + Math.random()*7, 98);
    if (fill)   fill.style.width = pct + '%';
    if (status) status.textContent = `Downloading\u2026 ${Math.round(pct)}%`;
    if (eta)    eta.textContent    = `${(Math.random()*5+1).toFixed(1)} MB/s`;
    if (pct >= 98) {
      clearInterval(tick);
      if (fill)   fill.style.width = '100%';
      if (status) status.textContent = 'Complete \u2713';
      if (eta)    eta.textContent    = '';
      setTimeout(onDone, 500);
    }
  }, 200);
}

function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Apply initial Senni mood
  _updateSenni('intro');
  // Feature cards start enabled
  document.getElementById('feat-tts').classList.add('enabled');
  document.getElementById('feat-memory').classList.add('enabled');
  // Footer hidden on intro (uses its own inline button)
  document.getElementById('btn-continue').style.visibility = 'hidden';
  document.getElementById('btn-back').style.visibility    = 'hidden';

  // ?rerun=1 (from Settings → About → Re-run wizard): skip the intro screen,
  // go straight to system check so returning users aren't shown first-run copy.
  if (new URLSearchParams(window.location.search).get('rerun')) {
    startSetup();
  }
});
