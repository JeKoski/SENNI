// companion-mood.js — Mood tab: card list, per-property overrides, TTS section,
//                     pill visibility, save payload.
// Loaded after companion-color-picker.js.
// Depends on globals from companion-presence.js:
//   CP_SWATCHES, CP_ELEMENTS, CP_SPEED_RANGES,
//   _cpSecsToSlider, _cpSliderToSecs, _cpSizeToSlider, _cpSliderToSize,
//   _cpIntensityToSlider, _cpSliderToIntensity, _cpAlphaToSlider, _cpSliderToAlpha,
//   cpDeriveGlowColor, cpColorToHex
// Depends on globals from companion-color-picker.js:
//   cpOpenColorPicker
// Depends on globals from companion.js:
//   cpSettings, cpFolder, cpMarkDirty, cpShowToast
// Depends on globals from mood-pill.js:
//   moodPill
//
// Exports:
//   cpMoodInit()
//   cpMoodReset()
//   _cpGetMoodPayload()   — called by companion.js cpSave()

// ── State ──────────────────────────────────────────────────────────────────────
let _cpMoodData           = {};      // deep clone of config moods dict
let _cpActiveMood         = null;    // string name or null
let _cpMoodPillVisibility = 'always';
let _cpMoodInitDone       = false;

// ── Default mood seed — used when creating a new mood ─────────────────────────
function _cpMoodSeed(name = 'New Mood') {
  return {
    enabled:     true,
    in_rotation: true,
    description: '',
    pill_icon:   'dot',
    orb:   { edgeColor: { enabled: false, value: '#818cf8' }, breathing: { enabled: false, value: 3.0 }, size: { enabled: false, value: 52 } },
    glow:  { color: { enabled: false, value: '#818cf8' }, opacity: { enabled: false, value: 0.35 }, speed: { enabled: false, value: 2.0 }, intensity: { enabled: false, value: 16 } },
    ring:  { color: { enabled: false, value: '#818cf8' }, opacity: { enabled: false, value: 0.28 }, speed: { enabled: false, value: 1.8 }, intensity: { enabled: false, value: 16 } },
    dots:  { color: { enabled: false, value: '#818cf8' }, speed: { enabled: false, value: 1.2 } },
    tts:   { enabled: false, voice_blend: {}, speed: 1.0, pitch: 1.0 },
    _groupEnabled: { orb: true, glow: true, ring: true, dots: true, tts: true },
  };
}

// ── Default moods — seeded when config has none ────────────────────────────────
const CM_DEFAULT_MOODS = {
  Neutral:     { description: 'Default conversational state, no strong emotion.',         pill_icon: 'dot', dot_color: '#818cf8' },
  Playful:     { description: 'Playful, teasing, excited, joking around — light and warm energy.', pill_icon: 'dot', dot_color: '#6dd4a8' },
  Focused:     { description: 'Calm, attentive, working through something carefully.',     pill_icon: 'dot', dot_color: '#93c5fd' },
  Melancholy:  { description: 'Quiet, inward, a little heavy.',                           pill_icon: 'dot', dot_color: '#a78bfa' },
  Annoyed:     { description: 'Restless, impatient, something is grating.',               pill_icon: 'dot', dot_color: '#fbbf24' },
  Flustered:   { description: 'Caught off guard, embarrassed, overwhelmed.',              pill_icon: 'dot', dot_color: '#fb7185' },
  Affectionate:{ description: 'Warm, close, tender.',                                     pill_icon: 'dot', dot_color: '#f9a8d4' },
  Curious:     { description: 'Alert, exploratory, interested in something new.',         pill_icon: 'dot', dot_color: '#67e8f9' },
};

// ── Group definitions — what properties live in each visual group ──────────────
const CM_GROUPS = [
  {
    id: 'orb', label: 'Orb',
    props: [
      { key: 'edgeColor', label: 'Colour',   type: 'color' },
      { key: 'breathing', label: 'Breathing', type: 'slider',
        toSlider: (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.breathSpeed.minS, CP_SPEED_RANGES.breathSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.breathSpeed.minS, CP_SPEED_RANGES.breathSpeed.maxS),
        format: (v) => Math.round(v) },
      { key: 'size',      label: 'Size',      type: 'slider',
        toSlider: (v) => _cpSizeToSlider(v),
        fromSlider: (v) => _cpSliderToSize(v),
        format: (v) => Math.round(v) },
    ],
  },
  {
    id: 'glow', label: 'Glow',
    props: [
      { key: 'color',     label: 'Colour',    type: 'color' },
      { key: 'opacity',   label: 'Opacity',   type: 'slider',
        toSlider: (v) => _cpAlphaToSlider(v),
        fromSlider: (v) => _cpSliderToAlpha(v),
        format: (v) => Math.round(v) + '%' },
      { key: 'speed',     label: 'Speed',     type: 'slider',
        toSlider: (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.glowSpeed.minS, CP_SPEED_RANGES.glowSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.glowSpeed.minS, CP_SPEED_RANGES.glowSpeed.maxS),
        format: (v) => Math.round(v) },
      { key: 'intensity', label: 'Intensity', type: 'slider',
        toSlider: (v) => _cpIntensityToSlider(v),
        fromSlider: (v) => _cpSliderToIntensity(v),
        format: (v) => Math.round(v) },
    ],
  },
  {
    id: 'ring', label: 'Ring',
    props: [
      { key: 'color',     label: 'Colour',    type: 'color' },
      { key: 'opacity',   label: 'Opacity',   type: 'slider',
        toSlider: (v) => _cpAlphaToSlider(v),
        fromSlider: (v) => _cpSliderToAlpha(v),
        format: (v) => Math.round(v) + '%' },
      { key: 'speed',     label: 'Speed',     type: 'slider',
        toSlider: (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.ringSpeed.minS, CP_SPEED_RANGES.ringSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.ringSpeed.minS, CP_SPEED_RANGES.ringSpeed.maxS),
        format: (v) => Math.round(v) },
      { key: 'intensity', label: 'Intensity', type: 'slider',
        toSlider: (v) => _cpIntensityToSlider(v),
        fromSlider: (v) => _cpSliderToIntensity(v),
        format: (v) => Math.round(v) },
    ],
  },
  {
    id: 'dots', label: 'Dots',
    props: [
      { key: 'color', label: 'Colour', type: 'color' },
      { key: 'speed', label: 'Speed',  type: 'slider',
        toSlider: (v) => _cpSecsToSlider(v, CP_SPEED_RANGES.dotSpeed.minS, CP_SPEED_RANGES.dotSpeed.maxS),
        fromSlider: (v) => _cpSliderToSecs(v, CP_SPEED_RANGES.dotSpeed.minS, CP_SPEED_RANGES.dotSpeed.maxS),
        format: (v) => Math.round(v) },
    ],
  },
];

// ── Init / reset ───────────────────────────────────────────────────────────────
function cpMoodInit() {
  if (_cpMoodInitDone) return;
  _cpMoodInitDone = true;

  const cfg = cpSettings || {};
  const c   = cfg.active_companion || {};

  // Deep clone moods from config, seeding defaults if empty
  if (c.moods && Object.keys(c.moods).length > 0) {
    _cpMoodData = JSON.parse(JSON.stringify(c.moods));
    // Ensure _groupEnabled exists on all moods (older configs may lack it)
    Object.values(_cpMoodData).forEach(m => {
      if (!m._groupEnabled) m._groupEnabled = { orb: true, glow: true, ring: true, dots: true, tts: true };
    });
  } else {
    _cpMoodData = _cpBuildDefaultMoods();
  }

  _cpActiveMood         = c.active_mood         ?? null;
  _cpMoodPillVisibility = c.mood_pill_visibility ?? 'always';

  _cpMoodRender();
}

function cpMoodReset() {
  _cpMoodInitDone = false;
  _cpMoodData     = {};
  _cpActiveMood   = null;
}

// ── Build default moods ────────────────────────────────────────────────────────
function _cpBuildDefaultMoods() {
  const out = {};
  Object.entries(CM_DEFAULT_MOODS).forEach(([name, meta]) => {
    const m = _cpMoodSeed(name);
    m.description = meta.description;
    m.pill_icon   = meta.pill_icon;
    // Neutral gets no overrides — all others get a colour hint on orb
    if (name !== 'Neutral') {
      m.orb.edgeColor = { enabled: true,  value: meta.dot_color };
      m.glow.color    = { enabled: true,  value: meta.dot_color };
      m.dots.color    = { enabled: true,  value: meta.dot_color };
    }
    out[name] = m;
  });
  return out;
}

// ── Render ─────────────────────────────────────────────────────────────────────
function _cpMoodRender() {
  const tab = document.getElementById('cp-tab-mood');
  if (!tab) return;

  tab.innerHTML = '';

  // ── Active mood row ──
  const activeRow = document.createElement('div');
  activeRow.className = 'cm-active-row';
  activeRow.innerHTML = `
    <span class="cp-section" style="padding-top:0;margin-bottom:0">Active mood</span>
    <div class="cm-active-badge" id="cm-active-badge">${_cpActiveMood || 'None'}</div>
    <button class="cm-clear-btn" id="cm-clear-btn" onclick="cpMoodClearActive()"
      style="${_cpActiveMood ? '' : 'visibility:hidden'}">Clear</button>`;
  tab.appendChild(activeRow);

  // ── Pill visibility row ──
  const pillRow = document.createElement('div');
  pillRow.className = 'cm-pill-row';
  pillRow.innerHTML = `
    <span class="cp-prop-label" style="width:auto;flex-shrink:0">Mood pill</span>
    <div class="cm-seg-toggle" id="cm-pill-vis-toggle">
      <button class="cm-seg-btn${_cpMoodPillVisibility==='always'?' active':''}" onclick="cpMoodSetPillVis('always')">Always</button>
      <button class="cm-seg-btn${_cpMoodPillVisibility==='fade'  ?' active':''}" onclick="cpMoodSetPillVis('fade')">Fade</button>
      <button class="cm-seg-btn${_cpMoodPillVisibility==='hide'  ?' active':''}" onclick="cpMoodSetPillVis('hide')">Hide</button>
    </div>`;
  tab.appendChild(pillRow);

  // ── Mood card list ──
  const list = document.createElement('div');
  list.className = 'cm-card-list';
  list.id = 'cm-card-list';
  Object.keys(_cpMoodData).forEach(name => {
    list.appendChild(_cpMoodBuildCard(name));
  });

  // + New mood button
  const addBtn = document.createElement('button');
  addBtn.className = 'cm-add-btn';
  addBtn.innerHTML = '+ New mood';
  addBtn.onclick   = cpMoodNewMood;
  list.appendChild(addBtn);

  tab.appendChild(list);
}

// ── Card builder ───────────────────────────────────────────────────────────────
function _cpMoodBuildCard(name) {
  const mood   = _cpMoodData[name];
  const isOpen = false;
  const dotColor = _cpMoodDotColor(name);

  const card = document.createElement('div');
  card.className = 'cm-card';
  card.id        = `cm-card-${_cpSafeId(name)}`;

  // ── Card header ──
  const header = document.createElement('div');
  header.className = 'cm-card-header';
  header.onclick   = () => _cpMoodToggleCard(name);
  header.innerHTML = `
    <div class="cm-card-header-left">
      <div class="cm-dot" style="background:${dotColor}"></div>
      <span class="cm-card-name">${name}</span>
      <span class="cm-card-desc-preview" id="cm-desc-prev-${_cpSafeId(name)}">${_cpTruncate(mood.description, 42)}</span>
    </div>
    <div class="cm-card-header-right">
      <span class="cm-rotation-label">Rotation</span>
      <div class="cp-elem-tog ${mood.in_rotation ? 'on' : 'off'}" id="cm-rot-tog-${_cpSafeId(name)}"
           onclick="event.stopPropagation();cpMoodToggleRotation('${name}')"></div>
      <div class="cp-elem-chevron" id="cm-chev-${_cpSafeId(name)}">▶</div>
    </div>`;
  card.appendChild(header);

  // ── Card body (built lazily on first expand) ──
  const body = document.createElement('div');
  body.className = 'cm-card-body';
  body.id        = `cm-body-${_cpSafeId(name)}`;
  body.style.display = 'none';
  card.appendChild(body);

  return card;
}

// ── Card expand/collapse ───────────────────────────────────────────────────────
function _cpMoodToggleCard(name) {
  const safeId = _cpSafeId(name);
  const body   = document.getElementById(`cm-body-${safeId}`);
  const chev   = document.getElementById(`cm-chev-${safeId}`);
  const card   = document.getElementById(`cm-card-${safeId}`);
  if (!body) return;

  const opening = body.style.display === 'none';

  // Build body lazily
  if (opening && !body.dataset.built) {
    _cpMoodBuildCardBody(name, body);
    body.dataset.built = '1';
  }

  body.style.display = opening ? 'block' : 'none';
  card?.classList.toggle('open', opening);
  if (chev) chev.style.transform = opening ? 'rotate(90deg)' : '';
}

// ── Card body builder ──────────────────────────────────────────────────────────
function _cpMoodBuildCardBody(name, bodyEl) {
  const mood   = _cpMoodData[name];
  const safeId = _cpSafeId(name);

  bodyEl.innerHTML = '';

  // Description
  const descWrap = document.createElement('div');
  descWrap.className = 'cm-body-section';
  descWrap.innerHTML = `
    <div class="cp-field-label" style="margin-bottom:5px">Description
      <span class="cp-note">shown in system prompt</span>
    </div>
    <textarea class="cp-textarea" id="cm-desc-${safeId}" rows="2"
      oninput="cpMoodSetDescription('${name}',this.value)"
      >${mood.description || ''}</textarea>`;
  bodyEl.appendChild(descWrap);

  // Activate button
  const activateWrap = document.createElement('div');
  activateWrap.className = 'cm-activate-row';
  const isActive = _cpActiveMood === name;
  activateWrap.innerHTML = `
    <button class="cm-activate-btn${isActive ? ' active' : ''}" id="cm-act-btn-${safeId}"
      onclick="cpMoodSetActive('${name}')">
      ${isActive ? '✦ Active' : 'Set active'}
    </button>
    ${name !== 'Neutral' ? `<button class="cm-delete-btn" onclick="cpMoodDelete('${name}')">Delete</button>` : ''}`;
  bodyEl.appendChild(activateWrap);

  // Visual groups
  CM_GROUPS.forEach(group => {
    bodyEl.appendChild(_cpMoodBuildGroup(name, group));
  });

  // TTS / Voice section
  bodyEl.appendChild(_cpMoodBuildTtsSection(name));
}

// ── Group builder ──────────────────────────────────────────────────────────────
function _cpMoodBuildGroup(moodName, group) {
  const mood        = _cpMoodData[moodName];
  const groupData   = mood[group.id] || {};
  const safeId      = _cpSafeId(moodName);
  const groupEnabled = mood._groupEnabled?.[group.id] !== false;

  const wrap = document.createElement('div');
  wrap.className = 'cm-group';
  wrap.id        = `cm-group-${safeId}-${group.id}`;

  // Count enabled props
  const enabledCount = group.props.filter(p => groupData[p.key]?.enabled).length;

  // Group header
  const hdr = document.createElement('div');
  hdr.className = 'cm-group-header';
  hdr.onclick   = () => _cpMoodToggleGroup(moodName, group.id);
  hdr.innerHTML = `
    <div class="cm-group-header-left">
      <div class="cp-elem-chevron" id="cm-gchev-${safeId}-${group.id}">▶</div>
      <span class="cm-group-name">${group.label}</span>
      <span class="cm-group-count" id="cm-gcount-${safeId}-${group.id}">${enabledCount}/${group.props.length}</span>
    </div>
    <div class="cm-group-header-right" onclick="event.stopPropagation()">
      <div class="cp-elem-tog ${groupEnabled ? 'on' : 'off'}" id="cm-gtog-${safeId}-${group.id}"
           onclick="cpMoodToggleGroupEnabled('${moodName}','${group.id}')"></div>
    </div>`;
  wrap.appendChild(hdr);

  // Group body
  const gbody = document.createElement('div');
  gbody.className = 'cm-group-body';
  gbody.id        = `cm-gbody-${safeId}-${group.id}`;
  gbody.style.display = 'none';

  group.props.forEach(prop => {
    gbody.appendChild(_cpMoodBuildPropRow(moodName, group.id, prop, groupEnabled));
  });

  wrap.appendChild(gbody);
  return wrap;
}

// ── Property row builder ───────────────────────────────────────────────────────
function _cpMoodBuildPropRow(moodName, groupId, prop, groupEnabled) {
  const mood      = _cpMoodData[moodName];
  const groupData = mood[groupId] || {};
  const propData  = groupData[prop.key] || { enabled: false, value: null };
  const safeId    = _cpSafeId(moodName);
  const rowId     = `cm-prop-${safeId}-${groupId}-${prop.key}`;
  const enabled   = propData.enabled && groupEnabled;

  const row = document.createElement('div');
  row.className = `cp-prop-row cm-prop-row${enabled ? '' : ' cm-prop-disabled'}`;
  row.id        = rowId;

  // Per-property enable toggle
  const tog = document.createElement('div');
  tog.className = `cp-elem-tog cm-prop-tog ${propData.enabled ? 'on' : 'off'}`;
  tog.id        = `cm-ptog-${safeId}-${groupId}-${prop.key}`;
  tog.onclick   = () => cpMoodToggleProp(moodName, groupId, prop.key);
  row.appendChild(tog);

  // Label
  const label = document.createElement('span');
  label.className   = 'cp-prop-label';
  label.textContent = prop.label;
  row.appendChild(label);

  if (prop.type === 'color') {
    const val = propData.value || '#818cf8';

    const pip = document.createElement('div');
    pip.className      = 'cp-prop-pip';
    pip.id             = `cm-pip-${safeId}-${groupId}-${prop.key}`;
    pip.style.background = val;
    pip.onclick        = () => {
      if (!propData.enabled) return;
      cpOpenColorPicker({
        title:  prop.label + ' colour',
        hex:    _cpMoodData[moodName]?.[groupId]?.[prop.key]?.value || '#818cf8',
        onPick: (hex) => cpMoodSetColor(moodName, groupId, prop.key, hex),
      });
    };
    row.appendChild(pip);

    const hexSpan = document.createElement('span');
    hexSpan.className   = 'cp-prop-hex';
    hexSpan.id          = `cm-hex-${safeId}-${groupId}-${prop.key}`;
    hexSpan.textContent = val;
    row.appendChild(hexSpan);

  } else if (prop.type === 'slider') {
    const val        = propData.value ?? 1;
    const displayVal = prop.toSlider(val);

    const sliderWrap = document.createElement('div');
    sliderWrap.className = 'cp-prop-slider-wrap';

    const slider = document.createElement('input');
    slider.type      = 'range';
    slider.className = 'cp-prop-slider';
    slider.id        = `cm-sl-${safeId}-${groupId}-${prop.key}`;
    slider.min       = 0; slider.max = 100; slider.step = 1;
    slider.value     = displayVal;
    slider.oninput   = (e) => cpMoodSlider(moodName, groupId, prop, e.target.value);
    sliderWrap.appendChild(slider);
    row.appendChild(sliderWrap);

    const valSpan = document.createElement('span');
    valSpan.className   = 'cp-prop-val';
    valSpan.id          = `cm-slv-${safeId}-${groupId}-${prop.key}`;
    valSpan.textContent = prop.format(displayVal);
    row.appendChild(valSpan);
  }

  // Grey out inert rows (no pointer events handled via CSS class)
  if (!enabled) row.classList.add('cm-prop-disabled');

  return row;
}

// ── TTS section builder ────────────────────────────────────────────────────────
function _cpMoodBuildTtsSection(moodName) {
  const mood    = _cpMoodData[moodName];
  const tts     = mood.tts || {};
  const safeId  = _cpSafeId(moodName);
  const enabled = mood._groupEnabled?.tts !== false && tts.enabled;

  const wrap = document.createElement('div');
  wrap.className = 'cm-group';
  wrap.id        = `cm-group-${safeId}-tts`;

  const hdr = document.createElement('div');
  hdr.className = 'cm-group-header';
  hdr.onclick   = () => _cpMoodToggleGroup(moodName, 'tts');
  hdr.innerHTML = `
    <div class="cm-group-header-left">
      <div class="cp-elem-chevron" id="cm-gchev-${safeId}-tts">▶</div>
      <span class="cm-group-name">Voice</span>
    </div>
    <div class="cm-group-header-right" onclick="event.stopPropagation()">
      <div class="cp-elem-tog ${tts.enabled ? 'on' : 'off'}" id="cm-gtog-${safeId}-tts"
           onclick="cpMoodToggleTts('${moodName}')"></div>
    </div>`;
  wrap.appendChild(hdr);

  const gbody = document.createElement('div');
  gbody.className = 'cm-group-body cm-tts-body';
  gbody.id        = `cm-gbody-${safeId}-tts`;
  gbody.style.display = 'none';

  // Voice blend slots
  const blendWrap = document.createElement('div');
  blendWrap.id        = `cm-tts-blend-${safeId}`;
  blendWrap.className = 'cm-tts-blend';
  const voices = Object.entries(tts.voice_blend || {});
  if (voices.length === 0) {
    // Add one empty slot by default
    blendWrap.appendChild(_cpMoodBuildVoiceSlot(moodName, '', 1.0));
  } else {
    voices.forEach(([voice, weight]) => blendWrap.appendChild(_cpMoodBuildVoiceSlot(moodName, voice, weight)));
  }
  gbody.appendChild(blendWrap);

  const addVoiceBtn = document.createElement('button');
  addVoiceBtn.className   = 'cp-add-btn';
  addVoiceBtn.textContent = '+ Add voice';
  addVoiceBtn.style.marginBottom = '10px';
  addVoiceBtn.onclick = () => cpMoodAddVoice(moodName);
  gbody.appendChild(addVoiceBtn);

  // Speed
  const speedRow = document.createElement('div');
  speedRow.className = 'cp-prop-row';
  speedRow.innerHTML = `
    <div class="cp-prop-tog-space"></div>
    <span class="cp-prop-label">Speed</span>
    <div class="cp-prop-slider-wrap">
      <input class="cp-prop-slider" type="range" id="cm-tts-speed-${safeId}"
        min="50" max="200" step="5" value="${Math.round((tts.speed ?? 1.0) * 100)}"
        oninput="cpMoodTtsSpeed('${moodName}',this.value)"/>
    </div>
    <span class="cp-prop-val" id="cm-tts-speedv-${safeId}">${(tts.speed ?? 1.0).toFixed(2)}×</span>`;
  gbody.appendChild(speedRow);

  // Pitch
  const pitchRow = document.createElement('div');
  pitchRow.className = 'cp-prop-row';
  pitchRow.innerHTML = `
    <div class="cp-prop-tog-space"></div>
    <span class="cp-prop-label">Pitch</span>
    <div class="cp-prop-slider-wrap">
      <input class="cp-prop-slider" type="range" id="cm-tts-pitch-${safeId}"
        min="50" max="200" step="5" value="${Math.round((tts.pitch ?? 1.0) * 100)}"
        oninput="cpMoodTtsPitch('${moodName}',this.value)"/>
    </div>
    <span class="cp-prop-val" id="cm-tts-pitchv-${safeId}">${(tts.pitch ?? 1.0).toFixed(2)}×</span>`;
  gbody.appendChild(pitchRow);

  // Reset to companion default link
  const resetLink = document.createElement('div');
  resetLink.style.cssText = 'text-align:right;margin-top:6px';
  resetLink.innerHTML = `<span class="cp-link-muted" onclick="cpMoodTtsResetToCompanion('${moodName}')">reset to companion default</span>`;
  gbody.appendChild(resetLink);

  wrap.appendChild(gbody);
  return wrap;
}

function _cpMoodBuildVoiceSlot(moodName, voice, weight) {
  const safeId  = _cpSafeId(moodName);
  const slot    = document.createElement('div');
  slot.className = 'cp-tts-slot';

  // Get available voices from the companion TTS voices list
  const voiceOptions = _cpMoodGetVoiceOptions(voice);

  slot.innerHTML = `
    <select class="cp-input cp-tts-voice-select" style="flex:1;min-width:0"
      onchange="cpMoodSyncVoiceBlend('${moodName}')">${voiceOptions}</select>
    <div class="cp-tts-weight-wrap">
      <input class="cp-tts-weight-slider" type="range" min="0" max="100" step="1"
        value="${Math.round(weight * 100)}"
        oninput="this.nextElementSibling.textContent=Math.round(this.value)+'%';cpMoodSyncVoiceBlend('${moodName}')"/>
      <span class="cp-tts-weight-pct">${Math.round(weight * 100)}%</span>
    </div>
    <button class="cp-tts-remove-btn" onclick="cpMoodRemoveVoiceSlot(this,'${moodName}')">×</button>`;
  return slot;
}

function _cpMoodGetVoiceOptions(selected) {
  // Read voice list from companion TTS settings if available
  const ttsVoices = cpSettings?.active_companion?.tts?.voice_blend
    ? Object.keys(cpSettings.active_companion.tts.voice_blend)
    : [];
  // Fallback common voices
  const fallback = ['af_heart', 'af_sky', 'af_bella', 'af_nicole', 'am_adam', 'am_michael'];
  const all = [...new Set([...ttsVoices, ...fallback])];
  return all.map(v => `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`).join('');
}

// ── Group accordion toggle ─────────────────────────────────────────────────────
function _cpMoodToggleGroup(moodName, groupId) {
  const safeId = _cpSafeId(moodName);
  const gbody  = document.getElementById(`cm-gbody-${safeId}-${groupId}`);
  const chev   = document.getElementById(`cm-gchev-${safeId}-${groupId}`);
  if (!gbody) return;
  const opening = gbody.style.display === 'none';
  gbody.style.display = opening ? 'block' : 'none';
  if (chev) chev.style.transform = opening ? 'rotate(90deg)' : '';
}

// ── Public interaction handlers ────────────────────────────────────────────────

function cpMoodToggleRotation(name) {
  if (!_cpMoodData[name]) return;
  _cpMoodData[name].in_rotation = !_cpMoodData[name].in_rotation;
  const tog = document.getElementById(`cm-rot-tog-${_cpSafeId(name)}`);
  if (tog) {
    tog.classList.toggle('on',  _cpMoodData[name].in_rotation);
    tog.classList.toggle('off', !_cpMoodData[name].in_rotation);
  }
  cpMarkDirty();
}

function cpMoodSetActive(name) {
  const prev = _cpActiveMood;
  _cpActiveMood = (_cpActiveMood === name) ? null : name;

  // Update all activate buttons
  Object.keys(_cpMoodData).forEach(n => {
    const btn = document.getElementById(`cm-act-btn-${_cpSafeId(n)}`);
    if (btn) {
      const active = _cpActiveMood === n;
      btn.classList.toggle('active', active);
      btn.textContent = active ? '✦ Active' : 'Set active';
    }
  });

  // Update active badge + clear button
  const badge    = document.getElementById('cm-active-badge');
  const clearBtn = document.getElementById('cm-clear-btn');
  if (badge)    badge.textContent          = _cpActiveMood || 'None';
  if (clearBtn) clearBtn.style.visibility  = _cpActiveMood ? 'visible' : 'hidden';

  // Optimistic orb + pill update — reflects the new mood immediately in the UI
  // without waiting for a save. _applyMoodToOrb also updates config.active_mood
  // so the system prompt stays in sync for the next send.
  if (typeof _applyMoodToOrb === 'function') {
    _applyMoodToOrb(_cpActiveMood);
  } else if (typeof moodPill !== 'undefined') {
    // Fallback: pill only (shouldn't happen if chat.js loaded correctly)
    if (_cpActiveMood) moodPill.update(_cpActiveMood, _cpMoodDotColor(_cpActiveMood), _cpMoodDotColor(_cpActiveMood));
    else               moodPill.update(null);
  }

  cpMarkDirty();
}

function cpMoodClearActive() {
  cpMoodSetActive(_cpActiveMood); // toggle off
}

function cpMoodToggleGroupEnabled(moodName, groupId) {
  const mood = _cpMoodData[moodName];
  if (!mood) return;
  if (!mood._groupEnabled) mood._groupEnabled = {};
  mood._groupEnabled[groupId] = !mood._groupEnabled[groupId];
  const on = mood._groupEnabled[groupId];

  const safeId = _cpSafeId(moodName);
  const tog    = document.getElementById(`cm-gtog-${safeId}-${groupId}`);
  if (tog) { tog.classList.toggle('on', on); tog.classList.toggle('off', !on); }

  // Update all prop rows in this group — grey out / restore
  const group = CM_GROUPS.find(g => g.id === groupId);
  if (group) {
    group.props.forEach(prop => {
      const propEnabled = mood[groupId]?.[prop.key]?.enabled && on;
      _cpMoodSetRowEnabled(moodName, groupId, prop.key, propEnabled);
    });
  }
  cpMarkDirty();
}

function cpMoodToggleTts(moodName) {
  const mood = _cpMoodData[moodName];
  if (!mood) return;
  if (!mood.tts) mood.tts = { enabled: false, voice_blend: {}, speed: 1.0, pitch: 1.0 };
  mood.tts.enabled = !mood.tts.enabled;

  const safeId = _cpSafeId(moodName);
  const tog    = document.getElementById(`cm-gtog-${safeId}-tts`);
  if (tog) { tog.classList.toggle('on', mood.tts.enabled); tog.classList.toggle('off', !mood.tts.enabled); }
  cpMarkDirty();
}

function cpMoodToggleProp(moodName, groupId, propKey) {
  const mood = _cpMoodData[moodName];
  if (!mood?.[groupId]?.[propKey]) return;
  mood[groupId][propKey].enabled = !mood[groupId][propKey].enabled;
  const on        = mood[groupId][propKey].enabled;
  const safeId    = _cpSafeId(moodName);
  const groupOn   = mood._groupEnabled?.[groupId] !== false;

  const tog = document.getElementById(`cm-ptog-${safeId}-${groupId}-${propKey}`);
  if (tog) { tog.classList.toggle('on', on); tog.classList.toggle('off', !on); }
  _cpMoodSetRowEnabled(moodName, groupId, propKey, on && groupOn);

  // Update count badge
  _cpMoodUpdateGroupCount(moodName, groupId);
  cpMarkDirty();
}

function _cpMoodSetRowEnabled(moodName, groupId, propKey, enabled) {
  const safeId = _cpSafeId(moodName);
  const row    = document.getElementById(`cm-prop-${safeId}-${groupId}-${propKey}`);
  if (row) row.classList.toggle('cm-prop-disabled', !enabled);
}

function _cpMoodUpdateGroupCount(moodName, groupId) {
  const mood    = _cpMoodData[moodName];
  const group   = CM_GROUPS.find(g => g.id === groupId);
  if (!mood || !group) return;
  const enabled = group.props.filter(p => mood[groupId]?.[p.key]?.enabled).length;
  const span    = document.getElementById(`cm-gcount-${_cpSafeId(moodName)}-${groupId}`);
  if (span) span.textContent = `${enabled}/${group.props.length}`;
}

function cpMoodSetColor(moodName, groupId, propKey, hex) {
  const mood = _cpMoodData[moodName];
  if (!mood?.[groupId]?.[propKey]) return;
  mood[groupId][propKey].value = hex;

  const safeId  = _cpSafeId(moodName);
  const pip     = document.getElementById(`cm-pip-${safeId}-${groupId}-${propKey}`);
  const hexSpan = document.getElementById(`cm-hex-${safeId}-${groupId}-${propKey}`);
  if (pip)     pip.style.background = hex;
  if (hexSpan) hexSpan.textContent  = hex;

  // If this is a primary colour, update the card dot too
  if ((groupId === 'orb' && propKey === 'edgeColor') ||
      (groupId === 'dots' && propKey === 'color')) {
    const dot = document.querySelector(`#cm-card-${safeId} .cm-dot`);
    if (dot) dot.style.background = hex;
  }

  cpMarkDirty();
}

function cpMoodSlider(moodName, groupId, prop, displayVal) {
  const mood = _cpMoodData[moodName];
  if (!mood?.[groupId]?.[prop.key]) return;
  const cssVal = prop.fromSlider(parseFloat(displayVal));
  mood[groupId][prop.key].value = cssVal;

  const safeId = _cpSafeId(moodName);
  const valEl  = document.getElementById(`cm-slv-${safeId}-${groupId}-${prop.key}`);
  if (valEl) valEl.textContent = prop.format(parseFloat(displayVal));
  cpMarkDirty();
}

function cpMoodSetDescription(moodName, val) {
  if (!_cpMoodData[moodName]) return;
  _cpMoodData[moodName].description = val;
  const prev = document.getElementById(`cm-desc-prev-${_cpSafeId(moodName)}`);
  if (prev) prev.textContent = _cpTruncate(val, 42);
  cpMarkDirty();
}

// ── TTS handlers ───────────────────────────────────────────────────────────────
function cpMoodAddVoice(moodName) {
  const safeId    = _cpSafeId(moodName);
  const blendWrap = document.getElementById(`cm-tts-blend-${safeId}`);
  if (!blendWrap) return;
  const slots = blendWrap.querySelectorAll('.cp-tts-slot');
  if (slots.length >= 5) { cpShowToast('Maximum 5 voices'); return; }
  blendWrap.appendChild(_cpMoodBuildVoiceSlot(moodName, '', 1.0));
  cpMoodSyncVoiceBlend(moodName);
}

function cpMoodRemoveVoiceSlot(btn, moodName) {
  btn.closest('.cp-tts-slot')?.remove();
  cpMoodSyncVoiceBlend(moodName);
}

function cpMoodSyncVoiceBlend(moodName) {
  const safeId    = _cpSafeId(moodName);
  const blendWrap = document.getElementById(`cm-tts-blend-${safeId}`);
  if (!blendWrap || !_cpMoodData[moodName]) return;
  const blend = {};
  blendWrap.querySelectorAll('.cp-tts-slot').forEach(slot => {
    const voice  = slot.querySelector('select')?.value;
    const weight = parseInt(slot.querySelector('input[type=range]')?.value ?? 100) / 100;
    if (voice) blend[voice] = weight;
  });
  // Normalise weights
  const total = Object.values(blend).reduce((s, w) => s + w, 0);
  if (total > 0) Object.keys(blend).forEach(v => blend[v] = parseFloat((blend[v] / total).toFixed(3)));
  _cpMoodData[moodName].tts = _cpMoodData[moodName].tts || {};
  _cpMoodData[moodName].tts.voice_blend = blend;
  cpMarkDirty();
}

function cpMoodTtsSpeed(moodName, val) {
  const speed  = parseFloat(val) / 100;
  if (!_cpMoodData[moodName]) return;
  _cpMoodData[moodName].tts = _cpMoodData[moodName].tts || {};
  _cpMoodData[moodName].tts.speed = speed;
  const el = document.getElementById(`cm-tts-speedv-${_cpSafeId(moodName)}`);
  if (el) el.textContent = speed.toFixed(2) + '×';
  cpMarkDirty();
}

function cpMoodTtsPitch(moodName, val) {
  const pitch = parseFloat(val) / 100;
  if (!_cpMoodData[moodName]) return;
  _cpMoodData[moodName].tts = _cpMoodData[moodName].tts || {};
  _cpMoodData[moodName].tts.pitch = pitch;
  const el = document.getElementById(`cm-tts-pitchv-${_cpSafeId(moodName)}`);
  if (el) el.textContent = pitch.toFixed(2) + '×';
  cpMarkDirty();
}

function cpMoodTtsResetToCompanion(moodName) {
  const companionTts = cpSettings?.active_companion?.tts || {};
  const mood = _cpMoodData[moodName];
  if (!mood) return;
  mood.tts = {
    enabled:     mood.tts?.enabled ?? false,
    voice_blend: JSON.parse(JSON.stringify(companionTts.voice_blend || {})),
    speed:       companionTts.speed ?? 1.0,
    pitch:       companionTts.pitch ?? 1.0,
  };
  // Re-render TTS section by rebuilding card body
  const safeId = _cpSafeId(moodName);
  const body   = document.getElementById(`cm-body-${safeId}`);
  if (body) { body.dataset.built = ''; body.innerHTML = ''; _cpMoodBuildCardBody(moodName, body); body.dataset.built = '1'; }
  cpMarkDirty();
}

// ── Pill visibility ────────────────────────────────────────────────────────────
function cpMoodSetPillVis(mode) {
  _cpMoodPillVisibility = mode;
  document.querySelectorAll('#cm-pill-vis-toggle .cm-seg-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase() === mode);
  });
  if (typeof moodPill !== 'undefined') moodPill.setVisibility(mode);
  cpMarkDirty();
}

// ── New / delete mood ──────────────────────────────────────────────────────────
function cpMoodNewMood() {
  const name = prompt('Mood name:');
  if (!name?.trim()) return;
  const n = name.trim();
  if (_cpMoodData[n]) { alert(`A mood named "${n}" already exists.`); return; }
  _cpMoodData[n] = _cpMoodSeed(n);
  // Re-render list
  _cpMoodRender();
  // Open new card
  setTimeout(() => _cpMoodToggleCard(n), 50);
  cpMarkDirty();
}

function cpMoodDelete(name) {
  if (!confirm(`Delete mood "${name}"?`)) return;
  delete _cpMoodData[name];
  if (_cpActiveMood === name) _cpActiveMood = null;
  _cpMoodRender();
  cpMarkDirty();
}

// ── Save payload ───────────────────────────────────────────────────────────────
function _cpGetMoodPayload() {
  // Strip _groupEnabled from the saved payload — it's UI state, not config state
  const clean = {};
  Object.entries(_cpMoodData).forEach(([name, mood]) => {
    const { _groupEnabled, ...rest } = mood;
    clean[name] = rest;
  });
  return {
    moods:                clean,
    active_mood:          _cpActiveMood,
    mood_pill_visibility: _cpMoodPillVisibility,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function _cpSafeId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function _cpTruncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function _cpMoodDotColor(name) {
  const mood = _cpMoodData[name];
  if (!mood) return '#818cf8';
  // Try orb edge colour first, then glow, then dots
  return mood.orb?.edgeColor?.enabled  && mood.orb.edgeColor.value  ||
         mood.glow?.color?.enabled     && mood.glow.color.value     ||
         mood.dots?.color?.enabled     && mood.dots.color.value     ||
         '#818cf8';
}
