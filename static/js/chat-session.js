// chat-session.js — Boot, startup, and session flow
// Depends on: chat.js globals (config, tools, companionName, _soulFiles, _memoryContext,
//             _tabs, _activeTabId, conversationHistory, modelFamily)
//             api.js (callModel), chat-ui.js, chat-tabs.js, system-prompt.js

// ── Tool call handler setup ───────────────────────────────────────────────────
function setupToolCallHandler() {
  onThinking = (thinkText) => {
    const el = appendThinkingBlock(thinkText);
    if (el && (config.generation?.thinking_autoopen === true)) {
      el.classList.add('open');
    }
  };

  onUsageUpdate = (promptTokens) => {
    _contextTokens = promptTokens;
    const tab = _tabs.find(t => t.id === _activeTabId);
    if (tab) tab.tokens = promptTokens;
    updateContextBar();
  };

  onToolCall = (name, args, status, result) => {
    if (status === 'loading') {
      const id = 'tool-' + Date.now();
      const el = appendToolIndicator(name, args, id);
      _activeToolIndicators[id] = el; // may be null for hidden tools
      if (el) el._toolId = id;
    } else if (status === 'done') {
      const entries = Object.entries(_activeToolIndicators);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [id, el] = entries[i];
        if (!el) { delete _activeToolIndicators[id]; continue; }
        if (el.dataset.toolName === name) {
          markToolIndicatorDone(el, result);
          delete _activeToolIndicators[id];
          break;
        }
      }
      updateMemoryCounts();
      // Mood hook — instant orb + pill update when set_mood completes
      if (name === 'set_mood') {
        _applyMoodToOrb(args?.mood_name ?? null);
      }
    }
  };

  onMemorySurface = (notesText) => {
    appendMemoryPill(notesText);
    _saveCurrentTabState();
    saveTabs();
  };
}

// ── Status load ───────────────────────────────────────────────────────────────
async function loadStatus() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    config               = data.config || {};
    tools                = data.tools  || [];
    config.model_running = data.model_running || false;
    _setOnlineIndicator(config.model_running);
    if (data.effective_generation) {
      config.generation = data.effective_generation;
    }
    config.force_read_before_write = data.force_read_before_write ?? true;

    companionName = data.companion_name || config.companion_name || 'Companion';
    document.getElementById('companion-name').textContent = companionName;
    document.title = companionName;

    const avatarEl = document.getElementById('companion-avatar');
    if (avatarEl) {
      const _v      = Date.now();
      const _sbBase = data.sidebar_avatar_url || data.avatar_url || '';
      const _sbSep  = data.sidebar_avatar_url ? '&' : '?';
      avatarEl.innerHTML = _sbBase
        ? `<img src="${_sbBase}${_sbSep}v=${_v}" style="width:100%;height:100%;object-fit:cover"/>`
        : '✦';
    }
    if (typeof orb !== 'undefined') {
      const _v = Date.now();
      orb.setAvatar(data.avatar_url ? `${data.avatar_url}?v=${_v}` : '');
    }

    if (data.presence_presets && data.active_presence_preset) {
      const preset = data.presence_presets[data.active_presence_preset];
      if (preset && typeof applyPresencePreset === 'function') {
        applyPresencePreset(preset);
      }
    }
    config.presence_presets       = data.presence_presets || {};
    config.active_presence_preset = data.active_presence_preset || 'Default';

    config.active_mood          = data.active_mood          ?? null;
    config.mood_pill_visibility = data.mood_pill_visibility ?? 'always';
    config.moods                = data.moods                ?? {};
    if (typeof moodPill !== 'undefined') {
      moodPill.setVisibility(config.mood_pill_visibility);
    }
    _applyMoodToOrb(config.active_mood || null);

    if (data.context_size) _contextSize = data.context_size;

    const mdEnabled = data.config?.generation?.markdown_enabled ?? true;
    _markdownEnabled = !!mdEnabled;
    if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(_markdownEnabled);

    modelFamily = _detectModelFamily(config.model_path || '');
    setOrbMode(config.orb_mode || 'chat');
    console.log(`[chat] model family: ${modelFamily} (${config.model_path?.split(/[/\\]/).pop() || 'unknown'})`);

    renderToolPills(tools);
    updateMemoryCounts();
    updateContextBar(0);

    try {
      const s = await fetch('/api/settings').then(r => r.json());
      if (s.active_companion?.heartbeat) {
        config.active_heartbeat = s.active_companion.heartbeat;
      }
      config.force_read_before_write = s.active_companion?.force_read_before_write ?? true;
      if (s.active_companion?.memory) {
        config.memory = { ...config.memory, ...s.active_companion.memory };
      }
    } catch {}

  } catch (e) {
    console.warn('Could not reach /api/status:', e);
  }

  if (typeof heartbeatInit === 'function') heartbeatInit();
}

// ── Server boot ───────────────────────────────────────────────────────────────
async function ensureServerRunning() {
  if (config.model_running || config.model_launching) {
    if (config.model_running) {
      console.log('[boot] model already running');
      startSession();
      return;
    }
    console.log('[boot] model is launching, attaching to boot log');
    showBootOverlay('Model is loading…');
    watchBootLog(async () => {
      hideBootOverlay();
      await loadStatus();
      startSession();
    });
    return;
  }

  showBootOverlay();

  let bootData;
  try {
    const res = await fetch('/api/boot', { method: 'POST' });
    bootData  = await res.json();
  } catch (e) {
    hideBootOverlay(`Could not reach bridge server: ${e.message}`);
    return;
  }

  if (!bootData.ok) {
    hideBootOverlay(`Could not start model server: ${bootData.error || 'unknown error'}`);
    return;
  }

  if (bootData.already_running) {
    watchBootLog(async () => {});
    await loadStatus();
    if (config.model_running) {
      startSession();
    } else {
      watchBootLog(async () => {
        hideBootOverlay();
        await loadStatus();
        startSession();
      });
    }
    return;
  }

  watchBootLog(async () => {
    hideBootOverlay();
    await loadStatus();
    startSession();
  });
}

// ── Boot overlay (startup — lives inside messages list) ───────────────────────
function showBootOverlay(initialMsg) {
  removeEmptyState();
  document.getElementById('boot-overlay')?.remove();
  const list = document.getElementById('messages');
  const el   = document.createElement('div');
  el.id = 'boot-overlay';
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:16px;padding:40px;text-align:center;color:var(--text-muted)';
  el.innerHTML = `
    <div style="width:40px;height:40px;border-radius:50%;
      border:2px solid rgba(129,140,248,0.15);border-top-color:var(--indigo);
      animation:spin 1s linear infinite"></div>
    <div style="font-family:'Lora',serif;font-size:18px;color:#eef0fb">Starting up...</div>
    <div id="boot-status-line" style="font-size:12px;font-family:'DM Mono',monospace;
      color:var(--text-dim);max-width:480px;word-break:break-all;min-height:1.4em;
      white-space:pre-wrap;text-align:left">
      ${initialMsg || 'Launching llama-server...'}
    </div>`;
  list.appendChild(el);
  scrollToBottom();
}

function updateBootStatus(line) {
  const el = document.getElementById('restart-status-line') ||
             document.getElementById('boot-status-line');
  if (el) el.textContent = line;
}

function hideBootOverlay(errorMsg) {
  document.getElementById('boot-overlay')?.remove();
  if (errorMsg) { appendSystemNote(`${errorMsg}`); enableInput(); }
}

// ── Restart overlay (in-app restart — full-screen blocking overlay) ───────────
function showRestartOverlay() {
  const settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay?.classList.contains('open')) {
    settingsOverlay.classList.remove('open');
  }

  document.getElementById('restart-overlay')?.remove();
  const el = document.createElement('div');
  el.id = 'restart-overlay';
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:500',
    'background:rgba(0,0,0,0.72)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:16px', 'padding:40px', 'text-align:center',
    'color:var(--text-muted)',
    'opacity:0', 'transition:opacity 0.2s ease',
  ].join(';');
  el.innerHTML = `
    <div style="width:40px;height:40px;border-radius:50%;
      border:2px solid rgba(129,140,248,0.15);border-top-color:var(--indigo);
      animation:spin 1s linear infinite"></div>
    <div style="font-family:'Lora',serif;font-size:18px;color:#eef0fb">Restarting model server\u2026</div>
    <div id="restart-status-line" style="font-size:12px;font-family:'DM Mono',monospace;
      color:var(--text-dim);max-width:480px;word-break:break-all;min-height:1.4em;
      white-space:pre-wrap;text-align:left">
      Stopping current process\u2026
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '1'; }));
}

function hideRestartOverlay() {
  const el = document.getElementById('restart-overlay');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 260);
}

// ── Boot log SSE ──────────────────────────────────────────────────────────────
let _activeBootES = null;

function watchBootLog(onReady) {
  if (_activeBootES) { _activeBootES.close(); _activeBootES = null; }

  const es  = new EventSource('/api/boot/log');
  _activeBootES = es;
  const btn = document.getElementById('restart-btn');
  let readyFired = false;

  es.onmessage = ({ data: raw }) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.line) { console.log('[llama-server]', msg.line); updateBootStatus(msg.line); }
    if (msg.ready && !readyFired) {
      readyFired = true;
      _setOnlineIndicator(true);
      if (btn) { btn.textContent = '\u21ba Restart'; btn.disabled = false; }
      if (typeof onReady === 'function') onReady();
      es.close();
      _activeBootES = null;
    }
  };
  es.onerror = () => {
    if (btn) { btn.textContent = '\u21ba Restart'; btn.disabled = false; }
  };
}

// ── Online / offline indicator ────────────────────────────────────────────────
function _setOnlineIndicator(isOnline) {
  const statusEl = document.querySelector('.companion-status');
  const textEl   = document.getElementById('status-text');
  if (!statusEl || !textEl) return;
  statusEl.classList.toggle('is-offline', !isOnline);
  textEl.textContent = isOnline ? 'online' : 'offline';
}

// ── Soul file helpers ─────────────────────────────────────────────────────────
async function reloadSoulFiles() {
  const folder = config.companion_folder || 'default';
  try {
    const res  = await fetch(`/api/settings/soul/${folder}`);
    const data = await res.json();
    let files  = data.files || {};

    // Migration: session_notes.md should never live in soul/ — delete it if found
    if (files['session_notes.md'] !== undefined) {
      console.log('[migration] removing session_notes.md from soul/ for', folder);
      try {
        await fetch(`/api/settings/soul/${folder}/delete`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: 'session_notes.md' }),
        });
      } catch {}
      delete files['session_notes.md'];
    }

    _soulFiles = files;
  } catch { _soulFiles = {}; }
}

// ── Memory context helpers ────────────────────────────────────────────────────
async function reloadMemoryContext() {
  const folder = config.companion_folder || 'default';
  const mood   = config.active_mood || null;
  try {
    const res  = await fetch('/api/memory/init', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ companion_folder: folder, mood }),
    });
    const data = await res.json();
    if (data.ok && data.session_context) {
      _memoryContext = data.session_context;
      _memorySurfacedCount = data.note_count || 0;
      if (typeof updateChatHeader === 'function') updateChatHeader(companionName, config.active_mood || null, _memorySurfacedCount);
      console.log('[memory] session context loaded,', data.note_count, 'notes in store');
      setTimeout(() => {
        if (typeof onMemorySurface === 'function') onMemorySurface('');
      }, 120);
    } else {
      _memoryContext = '';
      if (data.reason && data.reason !== 'memory_disabled') {
        console.warn('[memory] init returned:', data.reason);
      }
    }
  } catch (e) {
    _memoryContext = '';
    console.warn('[memory] could not reach memory server:', e.message);
  }
}

async function seedTemplates() {
  const folder = config.companion_folder || 'default';
  const seeds = [
    { template_name: 'soul.md', filename: 'soul.md', target_folder: 'soul' },
    { template_name: 'user_profile.md',       filename: 'user_profile.md',       target_folder: 'soul' },
  ];
  for (const seed of seeds) {
    try {
      await fetch('/api/templates/apply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companion_folder: folder, ...seed }),
      });
    } catch (e) { console.warn('Template seed failed:', seed.template_name, e); }
  }
}

// ── First mes injection ───────────────────────────────────────────────────────
async function _injectFirstMes() {
  if (!config.first_mes) return;
  const activeTab = _tabs.find(t => t.id === _activeTabId);
  if (activeTab?.messages?.length > 0) return;
  const text = config.first_mes;

  if (typeof _createStreamBubble === 'function' && typeof ttsStartGeneration === 'function') {
    ttsStartGeneration();
    const bh = _createStreamBubble();
    if (typeof setPresenceState === 'function') setPresenceState('streaming');
    let accumulated = '';
    for (const word of text.split(' ')) {
      accumulated += (accumulated ? ' ' : '') + word;
      _updateStreamBubble(bh, accumulated);
      if (typeof onTtsToken === 'function') onTtsToken(word + ' ');
      await new Promise(r => setTimeout(r, 40));
    }
    _finaliseStreamBubble(bh, text);
    ttsEndGeneration();
  } else {
    const row = appendMessage('companion', text);
    _attachMessageControls(row, 'companion');
  }

  conversationHistory.push({ role: 'assistant', content: text });
  _saveCurrentTabState();
}

// ── Session start ─────────────────────────────────────────────────────────────
async function startSession() {
  removeEmptyState();
  document.getElementById('boot-overlay')?.remove();

  await reloadSoulFiles();
  await reloadMemoryContext();

  const hasSetup = Object.keys(_soulFiles).length > 0 &&
    Object.values(_soulFiles).some(c =>
      !c.includes('Unknown') &&
      !c.includes('Nothing recorded') &&
      !c.includes('No background set yet')
    );

  if (!hasSetup) {
    await seedTemplates();
    await reloadSoulFiles();
  }

  const activeTab = _tabs.find(t => t.id === _activeTabId);
  if (activeTab?.messages?.length) {
    activeTab.messages.forEach(m => _replayMessage(m));
    scrollToBottom();
    loadReturningSession();
  } else if (!hasSetup) {
    triggerFirstRun();
  } else {
    await _injectFirstMes();
    enableInput();
  }

  if (typeof heartbeatOnSessionStart === 'function') heartbeatOnSessionStart();
}

// ── First run / returning session ─────────────────────────────────────────────
async function triggerFirstRun() {
  const typingId     = showTyping();
  const bootstrapMsg = { role: 'user', content: '[SETUP_START]' };
  const firstMsg     = await callModel(buildSystemPrompt('first_run'), [bootstrapMsg]);
  removeTyping(typingId);
  if (firstMsg) {
    conversationHistory.push(bootstrapMsg);
    conversationHistory.push({ role: 'assistant', content: firstMsg });
    if (!streamWasRendered()) {
      const row = appendMessage('companion', firstMsg);
      _attachMessageControls(row, 'companion');
    }
    _saveCurrentTabState(); saveTabs();
  }
  enableInput();
}

async function loadReturningSession() {
  enableInput();
  appendSystemNote('Session resumed -- ' + new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  }));
}
