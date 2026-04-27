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
  check:  { label: 'Continue \u2192', enabledFn: () => !!_checkDestination },
  engine: { label: 'Continue \u2192', enabledFn: () => !!enginePath },
  model:  { label: 'Continue \u2192', enabledFn: () => !_modelDownloading && (activeModelTab === 'browse' ? !!modelPath : (!!selectedModelCard || !!modelPath)) },
  extras: { label: 'Set up features \u2192', enabledFn: () => true },
};

// ── State ──────────────────────────────────────────────────────────────────
let currentStep      = 'intro';
let hwCategory       = '';      // 'gpu' | 'cpu'
let gpuBrand         = '';      // 'nvidia' | 'amd' | 'intel' | 'other'
let selectedBuild    = '';      // 'cuda' | 'vulkan' | 'sycl' | 'cpu'
let enginePath       = '';
let modelPath        = '';
let mmprojPath       = '';
let multimodal       = true;
let scanDone         = false;
let _scanResults     = [];
let selectedModelCard  = null;
let activeModelTab     = 'download';
let _downloadedModels  = {};   // id → {path, mmproj_path}
let featTts          = true;
let featMemory       = true;
let featTtsInstalled    = false;
let featMemoryInstalled = false;
let localInstall        = true;   // "Install locally for Senni" toggle
let _checkDestination = '';
let _lastDetected     = {};

// ── Navigation ────────────────────────────────────────────────────────────
function goTo(name) {
  document.getElementById('step-' + currentStep)?.classList.remove('active');
  currentStep = name;
  const el = document.getElementById('step-' + name);
  if (el) { el.classList.add('active'); el.style.animation = 'none'; el.offsetHeight; el.style.animation = ''; }
  _updateSenni(name);
  _updateNav(name);
  _updateFooter(name);
  if (name === 'extras') _loadExtrasStatus();
  if (name === 'boot') _startBoot();
  if (name === 'meet') { setTimeout(_animateMeetPortrait, 80); _initMeetStep(); }
}

function navBack() {
  const prev = BACK_MAP[currentStep];
  if (prev) goTo(prev);
}

function navContinue() {
  if (currentStep === 'check')  { _proceedFromCheck(); return; }
  if (currentStep === 'extras') { _installExtras(); return; }
  if (currentStep === 'model' && activeModelTab === 'download') {
    if (modelPath) { goTo('extras'); return; }  // already downloaded — just advance
    startModelDownload(); return;
  }
  const next = { engine: 'model', model: 'extras', extras: 'boot' };
  if (next[currentStep]) goTo(next[currentStep]);
}

function _proceedFromCheck() {
  if (!_checkDestination) return;
  if (_checkDestination === 'welcome') _buildWelcomeChips(_lastDetected);
  goTo(_checkDestination);
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
      continueBtn.style.display    = '';
      continueBtn.style.visibility = '';   // clear visibility:hidden set on init
      continueBtn.textContent      = contConf.label;
      continueBtn.disabled         = !contConf.enabledFn();
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

// ── Hardware selection ────────────────────────────────────────────────────
function selectHWCategory(cat) {
  hwCategory = cat;
  document.querySelectorAll('.hw-cat-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('hw-cat-' + cat)?.classList.add('selected');

  const brandsEl  = document.getElementById('hw-brands');
  const cpuEl     = document.getElementById('hw-cpu-note');
  const buildsEl  = document.getElementById('hw-builds');

  if (cat === 'cpu') {
    if (brandsEl) brandsEl.style.display = 'none';
    if (buildsEl) buildsEl.style.display = 'none';
    if (cpuEl)    cpuEl.style.display    = 'flex';
    // auto-select the cpu build card
    const cpuCard = document.querySelector('#hw-cpu-note .model-card');
    if (cpuCard) { cpuCard.classList.add('selected'); selectedBuild = 'cpu'; }
  } else {
    if (brandsEl) brandsEl.style.display = 'flex';
    if (cpuEl)    cpuEl.style.display    = 'none';
    if (!gpuBrand && buildsEl) buildsEl.style.display = 'none';
  }
  _updateEngineDlBtn();
  _refreshContinue();
}

function selectGPUBrand(brand) {
  gpuBrand = brand;
  document.querySelectorAll('.gpu-brand-chip').forEach(c => c.classList.remove('selected'));
  document.querySelector(`.gpu-brand-chip[data-brand="${brand}"]`)?.classList.add('selected');

  const buildsEl = document.getElementById('hw-builds');
  if (buildsEl) buildsEl.style.display = 'block';
  ['nvidia','amd','intel','other'].forEach(b => {
    const el = document.getElementById('hw-opts-' + b);
    if (el) el.style.display = b === brand ? 'block' : 'none';
  });

  // reset then auto-select first card for this brand
  document.querySelectorAll('#hw-builds .model-card').forEach(c => c.classList.remove('selected'));
  selectedBuild = '';
  const first = document.querySelector(`#hw-opts-${brand} .model-card`);
  if (first) { first.classList.add('selected'); selectedBuild = first.dataset.build; }

  _updateEngineDlBtn();
  _refreshContinue();
}

function selectBuildCard(el, build) {
  const parent = el.closest('#hw-opts-nvidia,#hw-opts-amd,#hw-opts-intel,#hw-opts-other,#hw-cpu-note');
  if (parent) parent.querySelectorAll('.model-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  selectedBuild = build;
  _updateEngineDlBtn();
}

function _updateEngineDlBtn() {
  const btn   = document.getElementById('engine-dl-btn');
  const label = document.getElementById('engine-dl-label');
  if (!btn) return;
  const labels = { cuda: 'Download CUDA engine \u2192', vulkan: 'Download Vulkan engine \u2192', sycl: 'Download SYCL engine \u2192', cpu: 'Download CPU engine \u2192' };
  btn.disabled = !selectedBuild;
  if (label) label.textContent = selectedBuild ? (labels[selectedBuild] || 'Download engine \u2192') : 'Select your hardware above, then download';
}

function setDetectedHW(gpu, buildType) {
  const isCpu = !gpu || gpu === 'cpu';
  const noteLabels = { nvidia: 'NVIDIA GPU detected', amd: 'AMD GPU detected', intel: 'Intel Arc detected', cpu: 'No discrete GPU \u2014 CPU mode' };
  const noteEl  = document.getElementById('detected-note');
  const labelEl = document.getElementById('detected-label');
  if (noteEl)  noteEl.style.display  = 'flex';
  if (labelEl) labelEl.textContent   = noteLabels[gpu] || (gpu ? gpu + ' detected' : 'No GPU detected');

  if (isCpu) {
    selectHWCategory('cpu');
  } else {
    selectHWCategory('gpu');
    selectGPUBrand(gpu === 'intel' ? 'intel' : gpu === 'amd' ? 'amd' : gpu === 'nvidia' ? 'nvidia' : 'other');
    // if status API gave us a specific build, override the auto-selected card
    if (buildType && buildType !== selectedBuild) {
      const card = document.querySelector(`#hw-opts-${gpuBrand} .model-card[data-build="${buildType}"]`);
      if (card) selectBuildCard(card, buildType);
    }
  }
}

// ── Engine download ────────────────────────────────────────────────────────
async function downloadEngine() {
  const prog   = document.getElementById('engine-dl-progress');
  const fill   = document.getElementById('engine-dl-fill');
  const status = document.getElementById('engine-dl-status');
  const eta    = document.getElementById('engine-dl-eta');
  prog.style.display = 'block';
  document.getElementById('engine-dl-btn').disabled = true;

  await _streamPost(
    '/api/setup/download-binary',
    { build_type: selectedBuild, gpu_type: gpuBrand },
    (msg) => {
      if (fill)   fill.style.width    = msg.pct + '%';
      if (status) status.textContent  = `Downloading\u2026 ${msg.pct}%`;
      if (eta)    eta.textContent     = _formatSpeed(msg.speed_bps);
    },
    (msg) => { if (status) status.textContent = msg.label || 'Working\u2026'; },
    (msg) => {
      enginePath = msg.path;
      setFileDisplay('engine', enginePath, true);
      if (fill)   fill.style.width   = '100%';
      if (status) status.textContent = 'Complete \u2713';
      if (eta)    eta.textContent    = '';
      setTimeout(_refreshContinue, 400);
    },
    (msg) => {
      if (status) status.textContent = '\u2717 ' + (msg.message || 'Download failed');
      document.getElementById('engine-dl-btn').disabled = false;
    },
  );
}

// ── Model tab switching ────────────────────────────────────────────────── */
function switchModelTab(tab) {
  activeModelTab = tab;
  document.getElementById('tab-download').classList.toggle('active', tab === 'download');
  document.getElementById('tab-browse').classList.toggle('active', tab === 'browse');
  document.getElementById('model-dl-tab').style.display     = tab === 'download' ? 'block' : 'none';
  document.getElementById('model-browse-tab').style.display = tab === 'browse'   ? 'block' : 'none';
  // mmproj picker only visible on browse tab when multimodal is on
  document.getElementById('mmproj-section').classList.toggle('visible', multimodal && tab === 'browse');
  _refreshContinue();
}

// ── Model status (downloaded models from status API) ─────────────────────
function _applyModelStatus(detected) {
  _downloadedModels = {};
  for (const m of (detected.downloaded_models || [])) {
    _downloadedModels[m.id] = m;
    const card = document.querySelector(`.model-card[data-model="${m.id}"]`);
    if (!card) continue;
    card.querySelector('.model-dl-btn')?.style.setProperty('display', 'none');
    const avail = card.querySelector('.model-available');
    if (avail) avail.style.display = '';
    // Downloaded cards never show the mm section on selection
  }

  // Auto-select card if current model_path matches a Senni-downloaded model.
  // Also pre-fill mmprojPath from the model's mmproj_path (mirrors selectModelCard click).
  if (detected.model_path) {
    for (const [id, info] of Object.entries(_downloadedModels)) {
      if (info.path === detected.model_path) {
        const card = document.querySelector(`.model-card[data-model="${id}"]`);
        if (card) { card.classList.add('selected'); selectedModelCard = id; }
        if (info.mmproj_path && !mmprojPath) {
          mmprojPath = info.mmproj_path;
          if (!multimodal) { multimodal = true; _syncMmToggles(); }
        }
        break;
      }
    }
  }
}

// ── Model card selection ──────────────────────────────────────────────────
function selectModelCard(el) {
  const id = el.dataset.model;

  // Downloaded card → switch to browse tab and fill paths
  if (_downloadedModels[id]) {
    const info = _downloadedModels[id];
    switchModelTab('browse');
    _applyPath('model', info.path);
    if (info.mmproj_path) {
      if (!multimodal) { multimodal = true; _syncMmToggles(); }
      _applyPath('mmproj', info.mmproj_path);
      document.getElementById('mmproj-section').classList.add('visible');
    }
    return;
  }

  // Normal (not yet downloaded) card selection
  document.querySelectorAll('.model-card').forEach(c => {
    c.classList.remove('selected');
    const btn = c.querySelector('.model-dl-btn');
    const mm  = c.querySelector('.model-card-mm');
    if (btn && !_downloadedModels[c.dataset.model]) btn.style.display = 'none';
    if (mm)  mm.style.display = 'none';
  });
  el.classList.add('selected');
  selectedModelCard = id;
  const btn = el.querySelector('.model-dl-btn');
  const mm  = el.querySelector('.model-card-mm');
  if (btn) btn.style.display = '';
  if (mm)  mm.style.display  = '';
  _syncMmToggles();
  _refreshContinue();
}

function _syncMmToggles() {
  document.querySelectorAll('.mm-toggle-track').forEach(t => t.classList.toggle('on', multimodal));
}

let _modelDownloadAbort = null;
let _modelDownloading   = false;

async function startModelDownload() {
  if (!selectedModelCard || _modelDownloading) return;
  _modelDownloading = true;
  document.getElementById('btn-continue').disabled = true;
  // Hide per-card button + mm toggle during download
  const activeCard = document.querySelector(`.model-card[data-model="${selectedModelCard}"]`);
  activeCard?.querySelector('.model-dl-btn')?.style.setProperty('display', 'none');
  activeCard?.querySelector('.model-card-mm')?.style.setProperty('display', 'none');
  document.querySelectorAll('.model-card').forEach(c => c.style.pointerEvents = 'none');

  const prog   = document.getElementById('model-dl-progress');
  const fill   = document.getElementById('model-dl-fill');
  const status = document.getElementById('model-dl-status');
  const eta    = document.getElementById('model-dl-eta');
  prog.style.display = 'block';

  _modelDownloadAbort = new AbortController();

  await _streamPost(
    '/api/setup/download-model',
    { model_id: selectedModelCard, include_mmproj: multimodal },
    (msg) => {
      if (fill)   fill.style.width   = msg.pct + '%';
      if (status) status.textContent = (msg.phase === 'mmproj' ? 'Vision projector\u2026 ' : 'Downloading\u2026 ') + msg.pct + '%';
      if (eta)    eta.textContent    = _formatSpeed(msg.speed_bps);
    },
    (msg) => { if (status) status.textContent = msg.label || 'Working\u2026'; },
    (msg) => {
      modelPath  = msg.path;
      if (msg.mmproj_path) mmprojPath = msg.mmproj_path;
      _modelDownloading   = false;
      _modelDownloadAbort = null;
      // Mark card as downloaded so Available badge shows on revisit
      _downloadedModels[selectedModelCard] = { id: selectedModelCard, path: modelPath, mmproj_path: mmprojPath };
      const doneCard = document.querySelector(`.model-card[data-model="${selectedModelCard}"]`);
      const avail = doneCard?.querySelector('.model-available');
      if (avail) avail.style.display = '';
      document.querySelectorAll('.model-card').forEach(c => c.style.pointerEvents = '');
      if (fill)   fill.style.width   = '100%';
      if (status) status.textContent = 'Complete \u2713';
      if (eta)    eta.textContent    = '';
      setTimeout(() => goTo('extras'), 600);
    },
    (msg) => {
      if (status) status.textContent = '\u2717 ' + (msg.message || 'Download failed');
      cancelModelDownload();
    },
    _modelDownloadAbort.signal,
  );
}

function cancelModelDownload() {
  if (_modelDownloadAbort) { _modelDownloadAbort.abort(); _modelDownloadAbort = null; }
  _modelDownloading = false;
  // Restore dl-btn and mm section hidden by startModelDownload (only if not already downloaded)
  if (selectedModelCard && !_downloadedModels[selectedModelCard]) {
    const card = document.querySelector(`.model-card[data-model="${selectedModelCard}"]`);
    card?.querySelector('.model-dl-btn')?.style.removeProperty('display');
    card?.querySelector('.model-card-mm')?.style.removeProperty('display');
  }
  document.getElementById('model-dl-progress').style.display = 'none';
  document.getElementById('model-dl-actions').style.display = 'flex';
  document.querySelectorAll('.model-card').forEach(c => c.style.pointerEvents = '');
  _refreshContinue();
}

// ── Extras / feature toggles ──────────────────────────────────────────────
async function _loadExtrasStatus() {
  try {
    const res  = await fetch('/api/setup/extras-status');
    const data = await res.json();
    _applyExtrasStatus(data);
  } catch(e) { /* non-critical — step still works without detection */ }
}

function _applyExtrasStatus(status) {
  // espeak — shown separately, not a feature card
  if (status.espeak) {
    const el = document.getElementById('espeak-status');
    if (el) {
      if (status.espeak.found) {
        el.textContent = `\u2713 espeak-ng found \u2014 ${status.espeak.path}`;
        el.style.color = '#6dd4a8';
      } else {
        el.textContent = '\u26a0 espeak-ng not found \u2014 voice may not work. Install espeak-ng and add it to PATH, or set the path in Settings.';
        el.style.color = '#fbbf24';
      }
      el.style.display = 'block';
    }
  }

  for (const key of ['tts', 'memory']) {
    const info = status[key];
    if (!info) continue;

    const localFound  = info.installed && info.source === 'local';
    const systemFound = info.installed && info.source === 'system';
    // Skip install if: already local, OR user explicitly chose not to install locally
    const skip = localFound || !localInstall;
    if (key === 'tts')    featTtsInstalled    = skip;
    if (key === 'memory') featMemoryInstalled = skip;

    const statusEl = document.getElementById(`${key}-feat-status`);
    const sizeEl   = document.getElementById(`${key}-feat-size`);

    if (statusEl) {
      if (localFound) {
        statusEl.textContent   = `\u2713 Installed locally \u2014 ${info.path}`;
        statusEl.style.display = 'block';
        statusEl.style.color   = '';
      } else if (!localInstall) {
        statusEl.textContent   = systemFound
          ? `\u2713 Using system install \u2014 ${info.path}`
          : `\u2014 Skipping \u2014 set up manually or enable local install`;
        statusEl.style.display = 'block';
        statusEl.style.color   = '#6dd4a8';
      } else if (systemFound) {
        statusEl.textContent   = `\u26a0 Found in system Python \u2014 will install local copy to ./features/packages/`;
        statusEl.style.display = 'block';
        statusEl.style.color   = '#fbbf24';
      } else {
        statusEl.style.display = 'none';
      }
    }
    if (sizeEl) {
      if (!sizeEl.dataset.original) sizeEl.dataset.original = sizeEl.textContent;
      sizeEl.textContent = skip ? 'Already installed' : sizeEl.dataset.original;
    }
  }
}

function toggleLocalInstall() {
  localInstall = !localInstall;
  document.getElementById('local-install-toggle').classList.toggle('on', localInstall);
  // Re-evaluate skip flags with current status
  _loadExtrasStatus();
}

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

async function _installExtras() {
  const needTts    = featTts    && !featTtsInstalled;
  const needMemory = featMemory && !featMemoryInstalled;
  if (!needTts && !needMemory) { goTo('boot'); return; }

  const prog   = document.getElementById('extras-dl-progress');
  const fill   = document.getElementById('extras-dl-fill');
  const status = document.getElementById('extras-dl-status');
  const eta    = document.getElementById('extras-dl-eta');
  const log    = document.getElementById('extras-pip-log');
  prog.style.display = 'block';
  if (log) { log.innerHTML = ''; log.style.display = 'block'; }
  // Indeterminate bar — no transition so it doesn't fake-sweep to 100%
  if (fill) { fill.classList.add('indeterminate'); fill.style.transition = 'none'; fill.style.width = '100%'; }
  document.getElementById('btn-continue').disabled = true;

  const _appendLog = (line) => {
    if (!log) return;
    const div = document.createElement('div');
    div.textContent = line;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  };

  await _streamPost(
    '/api/setup/install-extras',
    { tts: needTts, memory: needMemory },
    (msg) => { /* progress pct unused — bar is indeterminate */ },
    (msg) => {
      if (status) status.textContent = msg.label || 'Installing\u2026';
      if (eta && msg.step && msg.total) eta.textContent = `${msg.step} of ${msg.total}`;
    },
    () => {
      if (fill)   { fill.classList.remove('indeterminate'); fill.style.transition = ''; fill.style.width = '100%'; }
      if (status) status.textContent = 'Done \u2713';
      if (eta)    eta.textContent    = '';
      setTimeout(() => goTo('boot'), 600);
    },
    (msg) => {
      if (fill)   { fill.classList.remove('indeterminate'); fill.style.transition = ''; }
      if (status) status.textContent = '\u2717 ' + (msg.message || 'Install failed');
      document.getElementById('btn-continue').disabled = false;
    },
    null,
    (msg) => _appendLog(msg.line),
  );
}

// ── Multimodal ────────────────────────────────────────────────────────────
function toggleMultimodal() {
  multimodal = !multimodal;
  _syncMmToggles();
  const showPicker = multimodal && activeModelTab === 'browse';
  document.getElementById('mmproj-section').classList.toggle('visible', showPicker);
  if (showPicker && modelPath) fetchMmprojCandidates(modelPath);
  if (!multimodal) { mmprojPath = ''; setFileDisplay('mmproj', '', false); }
  _refreshContinue();
}

// ── File browser ──────────────────────────────────────────────────────────
async function browseFile(type) {
  const chipId = type === 'binary' ? 'engine-chip' : type + '-chip';
  const chip   = document.getElementById(chipId);
  if (chip) chip.style.opacity = '0.6';
  try {
    const knownPath = type === 'binary' ? enginePath : type === 'model' ? modelPath : mmprojPath;
    const startPath = knownPath
      ? knownPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/') || ''
      : '';
    const extensions = (type === 'model' || type === 'mmproj') ? ['.gguf'] : [];
    const titles     = { binary: 'Select llama-server binary', model: 'Select model file (.gguf)', mmproj: 'Select mmproj file (.gguf)' };
    const data = await fileBrowser.open({ title: titles[type] || 'Select file', mode: 'file', extensions, startPath });
    if (data.ok && data.path)            _applyPath(type, data.path);
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
    const filename = path ? path.split(/[\\/]/).pop() : '';
    chipName.textContent = filename || 'Click to select\u2026';
    chipName.title       = path || '';
    chip.classList.toggle('set',   !!isSet);
    chip.classList.toggle('empty', !isSet);
  }
  // Show full path below engine chip
  if (type === 'binary') {
    const pathDisplay = document.getElementById('engine-path-display');
    if (pathDisplay) {
      if (path && isSet) {
        const parts = path.replace(/\\/g, '/').split('/');
        const file  = parts.pop();
        const dir   = parts.join('/') + '/';
        pathDisplay.innerHTML      = `<span class="path-dir">${dir}</span><span class="path-file">${file}</span>`;
        pathDisplay.style.display  = 'block';
      } else {
        pathDisplay.style.display = 'none';
      }
    }
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

// ── Senni avatar ──────────────────────────────────────────────────────────
function _applySenniAvatar() {
  const url = '/api/companion/senni/avatar';
  ['senni-orb-icon', 'meet-portrait'].forEach(id => {
    const el = document.getElementById(id);
    if (!el || el.querySelector('img')) return;
    const img = document.createElement('img');
    img.src = url;
    img.onerror = () => img.remove();
    el.innerHTML = '';
    el.appendChild(img);
  });
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
    body: JSON.stringify({
      model_path: modelPath, mmproj_path: multimodal ? mmprojPath : '',
      gpu_type: gpuBrand, ngl: 99, port_bridge: 8000, port_model: 8081,
      tts_enabled: featTts, memory_enabled: featMemory,
    })
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
      const ok = document.createElement('div'); ok.className='log-ok'; ok.textContent='\u2713 Server is ready';
      logEl.appendChild(ok); logEl.scrollTop = logEl.scrollHeight;
      fetch('/api/setup/complete', { method: 'POST' }).catch(() => {});
      const _markBootDone = () => {
        ring.classList.add('done'); ring.textContent = '\u2713'; ring.style.display = 'flex';
        document.getElementById('boot-next-row').style.display = 'flex';
      };
      if (featTts) {
        _bootStartTts(logEl).then(_markBootDone);
      } else {
        _markBootDone();
      }
    }
  };
  es.onerror = () => { es.close(); showError('err-boot', 'Lost connection to boot log. Check Settings \u2192 Server if the issue persists.'); };
}

async function _bootStartTts(logEl) {
  function _logLine(cls, text) {
    const div = document.createElement('div');
    div.className = cls; div.textContent = text;
    logEl.appendChild(div); logEl.scrollTop = logEl.scrollHeight;
  }
  _logLine('log-info', '\u203a Starting voice system\u2026');
  try {
    const res  = await fetch('/api/tts/start', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      _logLine('log-ok', '\u2713 Voice ready');
    } else {
      _logLine('log-warn', '  Voice unavailable \u2014 ' + (data.reason || data.error || 'unknown'));
    }
  } catch {
    _logLine('log-warn', '  Voice startup failed');
  }
}

function _initMeetStep() {
  const btn = document.getElementById('hear-senni-btn');
  if (btn) btn.style.display = featTts ? 'inline-flex' : 'none';
}

async function hearSenni() {
  const btn = document.getElementById('hear-senni-btn');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Loading\u2026';
  try {
    const res = await fetch('/api/tts/speak', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text:   "Hi there. I'm Senni. It's good to finally meet you.",
        voices: { af_heart: 1.0 },
        speed:  1.0, lang: 'a',
      }),
    });
    if (res.ok && res.headers.get('content-type')?.includes('audio')) {
      const url   = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      btn.textContent = '\u266a Playing\u2026';
      audio.onended = () => { URL.revokeObjectURL(url); btn.disabled = false; btn.innerHTML = '\u25b6 Hear Senni'; };
      audio.play();
    } else {
      btn.disabled = false; btn.innerHTML = '\u25b6 Hear Senni';
    }
  } catch {
    btn.disabled = false; btn.innerHTML = '\u25b6 Hear Senni';
  }
}

// ── System check ──────────────────────────────────────────────────────────
async function runSystemCheck() {
  goTo('check');
  // Enable thinking dots on orb during scan
  document.getElementById('senni-orb-wrap').classList.add('thinking');

  await _delay(300);
  let detected = {};
  try { const res = await fetch('/api/setup/status'); detected = await res.json(); } catch {}

  await _delay(400);
  const gpu = detected.gpu || '';
  _resolveCheck('gpu', gpu ? 'ok' : 'missing',
    gpu ? `${gpu.toUpperCase()} GPU detected` : 'No GPU detected \u2014 CPU mode');
  setDetectedHW(gpu || 'cpu', detected.build_type || '');

  await _delay(350);
  const hasEngine = !!detected.binary_found;
  enginePath = detected.binary_path || '';
  _resolveCheck('engine', hasEngine ? 'ok' : 'missing',
    hasEngine ? enginePath.split(/[\\/]/).pop() : 'Not found \u2014 we\'ll get one');
  if (hasEngine) setFileDisplay('engine', enginePath, true);

  await _delay(300);
  const hasModel = !!detected.model_found;
  modelPath = detected.model_path || '';
  _resolveCheck('model', hasModel ? 'ok' : 'missing',
    hasModel ? modelPath.split(/[\\/]/).pop() : 'Not found \u2014 we\'ll pick one');
  if (hasModel) setFileDisplay('model', modelPath, true);

  // Pre-fill mmproj if already configured
  if (detected.mmproj_path) {
    mmprojPath = detected.mmproj_path;
    setFileDisplay('mmproj', mmprojPath, true);
    multimodal = true;
    _syncMmToggles();
  }

  // Apply downloaded model state to cards (marks Available, auto-selects active)
  _applyModelStatus(detected);

  if (detected.senni_companion) _applySenniAvatar();

  await _delay(700);
  document.getElementById('senni-orb-wrap').classList.remove('thinking');

  _lastDetected = detected;
  _checkDestination = (hasEngine && hasModel) ? 'welcome' : hasEngine ? 'model' : 'engine';
  _refreshContinue();
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
  if (detected.gpu)          items.push({ icon: '\u26a1', label: detected.gpu.toUpperCase() + ' GPU' });
  if (detected.binary_found) items.push({ icon: '\u2699\uFE0F', label: detected.binary_path.split(/[\\/]/).pop() });
  if (detected.model_found)  items.push({ icon: '\u{1F4E6}', label: detected.model_path.split(/[\\/]/).pop() });
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

// ── SSE via POST ───────────────────────────────────────────────────────────
// Streams a POST endpoint that emits `data: {...}` lines.
// Calls onProgress / onStatus / onDone / onError / onLog as each message type arrives.
async function _streamPost(url, body, onProgress, onStatus, onDone, onError, signal, onLog) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name !== 'AbortError') onError({ message: String(e) });
    return;
  }
  if (!res.ok) { onError({ message: `Server error ${res.status}` }); return; }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    let chunk;
    try { chunk = await reader.read(); } catch { break; }
    if (chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let msg;
      try { msg = JSON.parse(line.slice(6)); } catch { continue; }
      if      (msg.type === 'progress') onProgress(msg);
      else if (msg.type === 'status')   onStatus(msg);
      else if (msg.type === 'done')     { onDone(msg); return; }
      else if (msg.type === 'error')    { onError(msg); return; }
      else if (msg.type === 'log')      { if (typeof onLog === 'function') onLog(msg); }
    }
  }
}

function _formatSpeed(bps) {
  if (!bps) return '';
  if (bps >= 1024 * 1024) return (bps / 1024 / 1024).toFixed(1) + ' MB/s';
  if (bps >= 1024)        return (bps / 1024).toFixed(0) + ' KB/s';
  return bps + ' B/s';
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Apply initial Senni mood
  _updateSenni('intro');
  // Try avatar immediately — succeeds on rerun when companion folder already exists
  _applySenniAvatar();
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
