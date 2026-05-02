// companion.js — Companion settings window: coordinator, identity, generation,
//               memory, heartbeat, avatar, save/load.
// Loaded before companion-presence.js.
// Depends on: orb.js, chat-ui.js
//
// Presence logic lives in companion-presence.js.
// Mood logic will live in companion-mood.js (future).

// ── State ─────────────────────────────────────────────────────────────────────
let cpSettings       = null;   // loaded from /api/settings
let cpFolder         = '';     // active companion folder
let cpDirty          = false;  // unsaved changes flag
let _cpAvatarChanged = false;  // true if user picked/reset avatar this session
let _cpNewAvatarData = null;   // data URL (new avatar) or '' (reset), null = no change

// ── Evolution level ───────────────────────────────────────────────────────────
function _cpEvoSelect(level) {
  if (level === 'unbound') {
    const current = document.querySelector('#cp-evo-cards .cp-evo-card.active')?.dataset.level;
    if (current !== 'unbound') { _cpShowUnboundModal(); return; }
    return;
  }
  document.querySelectorAll('#cp-evo-cards .cp-evo-card').forEach(c =>
    c.classList.toggle('active', c.dataset.level === level));
  cpMarkDirty();
}

function _cpShowUnboundModal() {
  const name = document.getElementById('cp-companion-name')?.value || 'them';
  document.getElementById('cp-unbound-name').textContent = name;
  document.getElementById('cp-unbound-companion-name').textContent = name;
  document.getElementById('cp-unbound-overlay').classList.add('open');
}

function _cpCancelUnbound() {
  document.getElementById('cp-unbound-overlay').classList.remove('open');
}

async function _cpConfirmUnbound() {
  document.getElementById('cp-unbound-overlay').classList.remove('open');
  document.querySelectorAll('#cp-evo-cards .cp-evo-card').forEach(c =>
    c.classList.toggle('active', c.dataset.level === 'unbound'));
  await fetch(`/api/settings/unbound/${encodeURIComponent(cpFolder)}`, { method: 'POST' });
  cpMarkDirty();
}

// ── Dirty tracking ────────────────────────────────────────────────────────────
function cpMarkDirty() {
  cpDirty = true;
  _cpUpdateFooterButtons();
}

function cpClearDirty() {
  cpDirty = false;
  _cpUpdateFooterButtons();
}

function _cpUpdateFooterButtons() {
  document.querySelectorAll('.companion-panel-footer .sp-btn-ghost, .companion-panel-footer .sp-btn-primary')
    .forEach(btn => {
      if (btn.textContent.includes('Apply') || btn.textContent.includes('Save')) {
        btn.style.background  = cpDirty ? 'rgba(251,191,36,0.15)' : '';
        btn.style.borderColor = cpDirty ? 'rgba(251,191,36,0.5)'  : '';
        btn.style.color       = cpDirty ? 'rgba(251,191,36,0.9)'  : '';
      }
    });
}

// ── Open / close ──────────────────────────────────────────────────────────────
async function openCompanionWindow() {
  const overlay = document.getElementById('companion-overlay');
  overlay.classList.add('open');
  _cpShowLoadingState(true);
  await cpLoad();
  _cpShowLoadingState(false);
  cpSwitchTab('identity');
}


function _cpShowLoadingState(isLoading) {
  const panel = document.querySelector('.companion-panel');
  if (!panel) return;

  const toggleEls = panel.querySelectorAll(
    '.companion-tabs-strip, .cp-tab-body, .companion-panel-footer'
  );
  let spinner = panel.querySelector('.cp-loading-spinner');
  if (!spinner) {
    spinner = document.createElement('div');
    spinner.className = 'panel-loading-spinner cp-loading-spinner';
    const header = panel.querySelector('.companion-panel-header');
    if (header) header.after(spinner);
    else panel.prepend(spinner);
  }

  if (isLoading) {
    spinner.style.display = 'flex';
    toggleEls.forEach(el => { el.style.visibility = 'hidden'; el.style.opacity = '0'; });
  } else {
    spinner.style.display = 'none';
    toggleEls.forEach(el => {
      el.style.visibility = '';
      el.style.transition = 'opacity 0.18s ease';
      el.style.opacity = '0';
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = ''; }));
    });
  }
}

function closeCompanionWindow() {
  if (cpDirty) {
    if (!confirm('You have unsaved changes. Close anyway?')) return;
  }
  cpPresenceReset();  // allow fresh init on next open (defined in companion-presence.js)
  if (typeof cpMoodReset    === 'function') cpMoodReset();
  if (typeof cpTtsReset     === 'function') cpTtsReset();
  if (typeof cpMemoryReset  === 'function') cpMemoryReset();
  if (typeof cpToolsReset   === 'function') cpToolsReset();
  cpClearDirty();
  document.getElementById('companion-overlay').classList.remove('open');
}

function closeCompanionIfBg(e) {
  if (e.target === document.getElementById('companion-overlay')) closeCompanionWindow();
}

// ── Load settings ─────────────────────────────────────────────────────────────
async function cpLoad() {
  try {
    const res  = await fetch('/api/settings');
    cpSettings = await res.json();
    cpFolder   = cpSettings.config?.companion_folder || 'default';
    _cpAvatarChanged = false;
    _cpNewAvatarData = null;
    cpClearDirty();
    cpPopulate();
  } catch(e) { console.warn('cpLoad failed:', e); }
}

function cpPopulate() {
  const cfg = cpSettings || {};
  const c   = cfg.active_companion || {};
  const g   = c.generation || {};

  // ── Identity ──
  document.getElementById('cp-companion-name').value = c.companion_name || '';

  // Update panel header
  const headerName = document.getElementById('cp-header-name');
  if (headerName) headerName.textContent = c.companion_name || 'Companion';
  const v      = Date.now();
  const orbUrl = c.avatar_url         ? `${c.avatar_url}?v=${v}`          : '';
  // sidebar_avatar_url already has ?slot=sidebar — append with & not ?
  const sbUrl  = c.sidebar_avatar_url ? `${c.sidebar_avatar_url}&v=${v}`  : '';

  const headerAv = document.getElementById('cp-header-avatar');
  if (headerAv) {
    headerAv.innerHTML = orbUrl
      ? `<img src="${orbUrl}" style="width:100%;height:100%;object-fit:cover"/>`
      : '✦';
  }

  // Populate both slot previews
  const orbPrev = document.getElementById('cp-av-orb-prev');
  if (orbPrev) orbPrev.innerHTML = orbUrl
    ? `<img src="${orbUrl}" style="width:100%;height:100%;object-fit:cover">`
    : '✦';

  const sbPrev = document.getElementById('cp-av-sb-prev');
  if (sbPrev) sbPrev.innerHTML = (sbUrl || orbUrl)
    ? `<img src="${sbUrl || orbUrl}" style="width:100%;height:100%;object-fit:cover">`
    : '✦';

  const resetWrap = document.getElementById('cp-avatar-reset-wrap');
  if (resetWrap) resetWrap.style.display = (orbUrl || sbUrl) ? 'inline' : 'none';

  const evoLevel = c.evolution_level || 'settled';
  document.querySelectorAll('#cp-evo-cards .cp-evo-card').forEach(card => {
    card.classList.toggle('active', card.dataset.level === evoLevel);
  });

  // ── Generation ── (blank = inherit global)
  const setGen = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.value = g[key] !== undefined ? g[key] : '';
  };
  setGen('cp-g-temp',   'temperature');
  setGen('cp-g-topp',   'top_p');
  setGen('cp-g-topk',   'top_k');
  setGen('cp-g-minp',   'min_p');
  setGen('cp-g-rpen',   'repeat_penalty');
  setGen('cp-g-maxt',   'max_tokens');
  setGen('cp-g-pres',   'presence_penalty');
  setGen('cp-g-freq',   'frequency_penalty');
  setGen('cp-g-rounds', 'max_tool_rounds');
  setGen('cp-g-dry-m',  'dry_multiplier');
  setGen('cp-g-dry-b',  'dry_base');
  setGen('cp-g-dry-l',  'dry_allowed_length');

  // ── Memory (ChromaDB settings) ──
  if (typeof cpMemoryPopulate === 'function') cpMemoryPopulate();

  // ── Presence ──
  cpPresenceInit();

  // ── Voice (TTS) ── always populate slots from config so save is safe
  // even if the user never opens the Voice tab this session.
  if (typeof cpTtsPopulate === 'function') {
    cpTtsPopulate(c.tts || {});
  }

  // ── Heartbeat ──
  const hb = c.heartbeat || {};
  const hbTog = (id, val) => { const el = document.getElementById(id); if (el) el.classList.toggle('on', !!val); };
  hbTog('cp-hb-silent',   hb.silent_enabled);
  hbTog('cp-hb-message',  hb.message_enabled);
  hbTog('cp-hb-idle',     hb.idle_trigger);
  hbTog('cp-hb-conv-end', hb.conversation_end_trigger);
  hbTog('cp-hb-session',  hb.session_start_trigger);
  hbTog('cp-hb-ctx',      hb.context_threshold_trigger);
  const idleMin = document.getElementById('cp-hb-idle-min'); if (idleMin) idleMin.value = hb.idle_minutes         ?? 15;
  const ctxPct  = document.getElementById('cp-hb-ctx-pct');  if (ctxPct)  ctxPct.value  = hb.context_threshold_pct ?? 75;

  const instr    = hb.instructions || {};
  const instrVal = (key) => typeof instr === 'string' ? (key === 'default' ? instr : '') : (instr[key] || '');
  const instrIds = ['default','idle','conversation-end','session-start','context-threshold','manual'];
  instrIds.forEach(key => {
    const el = document.getElementById(`cp-hb-instr-${key}`);
    if (el) el.value = instrVal(key.replace('-', '_'));
  });
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function cpSwitchTab(tab) {
  document.querySelectorAll('.cp-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.cp-tab-body').forEach(b => b.classList.toggle('active', b.id === `cp-tab-${tab}`));
  if (tab === 'identity') {
    if (typeof cpMemoryInit === 'function') cpMemoryInit();
  }
  if (tab === 'expression') {
    // Init presence if not yet done; re-render if already loaded
    if (!_cpPresenceInitDone) {
      cpPresenceInit();
    } else {
      cpPresenceRenderPresets();
      cpPresenceRenderState(_cpEditingState);
    }
    // Mood inits lazily when user clicks the Mood chip
  }
  if (tab === 'voice') {
    if (typeof cpTtsInit === 'function') cpTtsInit();
  }
  if (tab === 'tools') {
    if (typeof cpToolsInit === 'function') cpToolsInit();
  }
}

// ── Expression ✦ panel switcher ───────────────────────────────────────────────
function cpExprSwitchPanel(panel) {
  document.querySelectorAll('.cp-expr-chip').forEach(c => c.classList.toggle('active', c.dataset.panel === panel));
  document.querySelectorAll('.cp-expr-panel').forEach(p => p.classList.toggle('active', p.id === `cp-expr-${panel}`));
  if (panel === 'mood' && typeof cpMoodInit === 'function') cpMoodInit();
  if (panel === 'presence') {
    if (!_cpPresenceInitDone) {
      cpPresenceInit();
    } else {
      cpPresenceRenderPresets();
      cpPresenceRenderState(_cpEditingState);
    }
  }
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function cpAvatarBrowse() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { if (inp.files[0]) cpAvatarModalOpen(inp.files[0]); };
  inp.click();
}

function cpAvatarDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) cpAvatarModalOpen(file);
}

function cpAvatarReset() {
  if (typeof cpAvatarModalReset === 'function') cpAvatarModalReset();
  const resetWrap = document.getElementById('cp-avatar-reset-wrap');
  if (resetWrap) resetWrap.style.display = 'none';
  _cpAvatarChanged = true;
  _cpNewAvatarData = '';   // '' signals "cleared" to cpSave
  cpMarkDirty();
}

function cpAvatarFile(input) {
  if (input.files[0]) cpAvatarModalOpen(input.files[0]);
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function cpSave(andClose = false) {
  cpShowToast('Saving…');

  try {
    const g = {};
    const getGen = (id, key, parser) => {
      const v = document.getElementById(id)?.value;
      if (v !== '' && v !== undefined) g[key] = parser(v);
    };
    getGen('cp-g-temp',   'temperature',        parseFloat);
    getGen('cp-g-topp',   'top_p',              parseFloat);
    getGen('cp-g-topk',   'top_k',              parseInt);
    getGen('cp-g-minp',   'min_p',              parseFloat);
    getGen('cp-g-rpen',   'repeat_penalty',     parseFloat);
    getGen('cp-g-maxt',   'max_tokens',         parseInt);
    getGen('cp-g-pres',   'presence_penalty',   parseFloat);
    getGen('cp-g-freq',   'frequency_penalty',  parseFloat);
    getGen('cp-g-rounds', 'max_tool_rounds',    parseInt);
    getGen('cp-g-dry-m',  'dry_multiplier',     parseFloat);
    getGen('cp-g-dry-b',  'dry_base',           parseFloat);
    getGen('cp-g-dry-l',  'dry_allowed_length', parseInt);

    const tog = id => document.getElementById(id)?.classList.contains('on') ?? false;
    const hb = {
      silent_enabled:            tog('cp-hb-silent'),
      message_enabled:           tog('cp-hb-message'),
      idle_trigger:              tog('cp-hb-idle'),
      conversation_end_trigger:  tog('cp-hb-conv-end'),
      session_start_trigger:     tog('cp-hb-session'),
      context_threshold_trigger: tog('cp-hb-ctx'),
      idle_minutes:              parseInt(document.getElementById('cp-hb-idle-min')?.value) || 15,
      context_threshold_pct:     parseInt(document.getElementById('cp-hb-ctx-pct')?.value)  || 75,
      instructions: {
        default:           document.getElementById('cp-hb-instr-default')?.value           || '',
        idle:              document.getElementById('cp-hb-instr-idle')?.value              || '',
        conversation_end:  document.getElementById('cp-hb-instr-conversation-end')?.value  || '',
        session_start:     document.getElementById('cp-hb-instr-session-start')?.value     || '',
        context_threshold: document.getElementById('cp-hb-instr-context-threshold')?.value || '',
        manual:            document.getElementById('cp-hb-instr-manual')?.value            || '',
      },
    };

    const body = {
      folder:                  cpFolder,
      companion_name:          document.getElementById('cp-companion-name')?.value.trim() || '',
      // Avatar: send per-slot data if changed, or empty strings if cleared
      ...(() => {
        if (!_cpAvatarChanged) return {};
        if (_cpNewAvatarData === '') return { orb_avatar_data: '', sidebar_avatar_data: '' };
        const orbD = typeof cpAvatarGetOrbData     === 'function' ? cpAvatarGetOrbData()     : null;
        const sbD  = typeof cpAvatarGetSidebarData === 'function' ? cpAvatarGetSidebarData() : null;
        return {
          ...(orbD !== null ? { orb_avatar_data: orbD } : {}),
          ...(sbD  !== null ? { sidebar_avatar_data: sbD } : {}),
        };
      })(),
      generation:              g,
      evolution_level:         document.querySelector('#cp-evo-cards .cp-evo-card.active')?.dataset.level || 'settled',
      heartbeat:               hb,
      // Only include presence payload if the Presence tab was opened this session.
      ...(_cpPresenceInitDone ? _cpGetPresencePayload() : {}),
      // Only include memory payload if the Memory tab was opened this session.
      ...(typeof _cpGetMemoryPayload === 'function' && _cpMemoryInitDone ? _cpGetMemoryPayload() : {}),
      // Only include TTS payload if slots have been populated — guards against
      // overwriting saved TTS config when the Voice tab was never opened.
      ...(typeof _cpGetTtsPayload === 'function' && _cpTtsSlots.length > 0 ? _cpGetTtsPayload() : {}),
      // Only include mood payload if the Moods panel was opened this session
      ...(typeof _cpGetMoodPayload === 'function' && _cpMoodInitDone ? _cpGetMoodPayload() : {}),
      // Only include per-companion tool overrides if Tools tab was visited
      ...(typeof _cpGetToolsPayload === 'function' && _cpToolsInitDone ? _cpGetToolsPayload() : {}),
    };

    const res = await fetch('/api/settings/companion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.warn('cpSave failed:', await res.text()); cpShowToast('Save failed ✗'); return; }

    // ── Update cpSettings cache so reopening the window shows correct values ──
    if (cpSettings) {
      if (!cpSettings.active_companion) cpSettings.active_companion = {};
      cpSettings.active_companion.companion_name          = body.companion_name;
      if (_cpAvatarChanged) {
        cpSettings.active_companion.avatar_path = _cpNewAvatarData ? 'avatar.jpg' : '';
        cpSettings.active_companion.avatar_url  = _cpNewAvatarData ? `/api/companion/${cpFolder}/avatar` : '';
      }
      cpSettings.active_companion.generation              = body.generation;
      cpSettings.active_companion.evolution_level         = body.evolution_level;
      cpSettings.active_companion.heartbeat               = body.heartbeat;
      cpSettings.active_companion.active_presence_preset  = body.active_presence_preset;
      cpSettings.presence_presets                         = body.presence_presets;
      if (body.tts)  cpSettings.active_companion.tts       = body.tts;
      if (body.moods !== undefined) {
        cpSettings.active_companion.moods                 = body.moods;
        cpSettings.active_companion.active_mood           = body.active_mood;
        cpSettings.active_companion.mood_pill_visibility  = body.mood_pill_visibility;
      }
    }

    // ── Update runtime config so _applyMoodToOrb reads fresh presence data ──
    if (typeof config !== 'undefined') {
      config.presence_presets       = body.presence_presets;
      config.active_presence_preset = body.active_presence_preset;
    }

    // ── Apply the active preset to the live orb right now ──
    // _applyMoodToOrb below will also re-apply the preset, but calling this
    // first ensures the orb updates even when there is no active mood.
    if (typeof applyPresencePreset === 'function') {
      const livePreset = _cpPresenceData[_cpActivePreset];
      if (livePreset) applyPresencePreset(livePreset);
    }

    // ── Reapply active mood so presence save doesn't clear it ──
    // Uses config.presence_presets (just updated above) so it reads fresh values.
    if (typeof _applyMoodToOrb === 'function') {
      _applyMoodToOrb(body.active_mood || null);
    }

    // ── Update sidebar immediately ──
    const nameEl = document.getElementById('companion-name');
    if (nameEl) nameEl.textContent = body.companion_name || 'Companion';
    if (_cpAvatarChanged) {
      const v       = Date.now();
      const cleared = _cpNewAvatarData === '';
      const orbUrl  = cleared ? '' : `/api/companion/${cpFolder}/avatar?v=${v}`;
      const sbUrl   = cleared ? '' : `/api/companion/${cpFolder}/avatar?slot=sidebar&v=${v}`;

      // Sidebar portrait element (prefers sidebar avatar, falls back to orb)
      const avatarEl = document.getElementById('companion-avatar');
      if (avatarEl) {
        const url = sbUrl || orbUrl;
        avatarEl.innerHTML = url
          ? `<img src="${url}" style="width:100%;height:100%;object-fit:cover"/>`
          : '✦';
      }
      // Orb avatar — set directly so it uses the orb-specific crop
      if (typeof orb !== 'undefined') orb.setAvatar(orbUrl);

      // Panel header (shows orb crop)
      const cpHeaderAv = document.getElementById('cp-header-avatar');
      if (cpHeaderAv) {
        cpHeaderAv.innerHTML = orbUrl
          ? `<img src="${orbUrl}" style="width:100%;height:100%;object-fit:cover"/>`
          : '✦';
      }
      _cpAvatarChanged = false;
      _cpNewAvatarData = null;
    }
    const cpHeaderName = document.getElementById('cp-header-name');
    if (cpHeaderName) cpHeaderName.textContent = body.companion_name || 'Companion';
    // Note: syncStatusAvatar() intentionally NOT called here — avatar slots are
    // managed directly via orb.setAvatar() above to keep orb and sidebar decoupled.
    if (typeof heartbeatReload === 'function') heartbeatReload();

    if (typeof config !== 'undefined') {
      config.force_read_before_write = body.force_read_before_write;
      if (body.generation && config.generation) Object.assign(config.generation, body.generation);
    }

    cpShowToast('Companion saved ✓');
    cpClearDirty();
    if (andClose) {
      cpPresenceReset();
      closeCompanionWindow();
    }

  } catch(e) {
    console.warn('cpSave failed:', e);
    cpShowToast('Save failed ✗');
  }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _cpToastTimer = null;
function cpShowToast(msg) {
  let toast = document.getElementById('cp-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cp-toast';
    toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#21232e;border:1px solid rgba(109,212,168,0.3);border-radius:10px;padding:8px 18px;font-size:13px;color:#6dd4a8;z-index:10000;pointer-events:none;transition:opacity .25s ease';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  if (_cpToastTimer) clearTimeout(_cpToastTimer);
  _cpToastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}
