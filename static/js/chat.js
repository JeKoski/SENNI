// chat.js — Core: state, startup, boot, session management, send, system prompt
// Depends on: api.js, attachments.js, chat-ui.js, chat-tabs.js, chat-controls.js

// ── Shared state ──────────────────────────────────────────────────────────────
let config              = {};
let tools               = [];
let conversationHistory = [];
let isSending           = false;
let companionName       = 'Companion';
let _soulFiles          = {};
let _memoryContext      = '';
let _activeToolIndicators = {};

// Tab state (used by chat-tabs.js)
let _tabs        = [];
let _activeTabId = null;
let _abortCtrl   = null;

// Context tracking (used by chat-ui.js)
let _contextSize   = 16384;
let _contextTokens = 0;

// ── Associative memory retrieval counter ──────────────────────────────────────
// System-driven feminine-pathway retrieval. Fires every ASSOC_INTERVAL turns
// after a successful reply, injecting surfaced notes as a hidden system turn
// and showing a memory pill in the UI.
// ASSOC_INTERVAL reads from config.memory.mid_convo_k (set after loadStatus).
// The const below is the fallback used before config loads.
let _assocTurnsSinceLast = 0;
const ASSOC_INTERVAL_DEFAULT = 4;

function _assocInterval() {
  return config.memory?.mid_convo_k ?? ASSOC_INTERVAL_DEFAULT;
}

async function _triggerAssociativeRetrieval() {
  _assocTurnsSinceLast++;
  const interval = _assocInterval();
  console.log(`[memory] assoc check: turn ${_assocTurnsSinceLast}/${interval}`);
  if (_assocTurnsSinceLast < interval) return;
  _assocTurnsSinceLast = 0;

  const mood = config.active_mood || null;
  try {
    const res  = await fetch('/api/memory/associative', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mood, valence: null, k: 3 }),
    });
    const data = await res.json();
    console.log(`[memory] associative surfaced: ${data.count ?? 0} note(s)`);
    if (data.ok && data.notes_text && data.notes_text.trim()) {
      // Inject as a hidden system turn so the model sees the surfaced memories
      // on its next response, without it being visible as a user message.
      conversationHistory.push({ role: 'user',      content: `[Surfaced memories]\n${data.notes_text}` });
      conversationHistory.push({ role: 'assistant', content: '(noted)' });
      if (typeof onMemorySurface === 'function') onMemorySurface(data.notes_text);
    }
  } catch (e) {
    console.warn('[memory] associative retrieval failed (non-fatal):', e.message);
  }
}

// ── Model family detection ────────────────────────────────────────────────────
// Derived once from config.model_path after loadStatus(). Read by api.js.
// Drives system prompt format and tool result injection style.
//
// "gemma4"  — Gemma 4: jinja template handles tool schema injection;
//             tool results use native <|tool_response> tokens.
// "generic" — Everything else (Qwen, Llama, Mistral, etc.): XML tool
//             instructions in system prompt; [Tool results] user turn.
let modelFamily = "generic";

function _detectModelFamily(modelPath) {
  if (!modelPath) return "generic";
  const name = modelPath.split(/[/\\]/).pop().toLowerCase();
  if (name.includes("gemma")) return "gemma4";
  return "generic";
}

// ── Startup ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadStatus();
  initInput();
  setupToolCallHandler();
  document.body.classList.toggle('controls-always-visible', _controlsAlwaysVisible);
  await loadTabs();
  if (!_activeTabId) _activeTabId = _tabs[0]?.id;
  conversationHistory = _tabs.find(t => t.id === _activeTabId)?.history || [];
  // TTS init is non-blocking — silently no-ops if Kokoro isn't installed
  if (typeof ttsInit === 'function') ttsInit();
  renderTabList();
  await ensureServerRunning();
});

async function loadStatus() {
  try {
    const res  = await fetch('/api/status');
    const data = await res.json();
    config               = data.config || {};
    tools                = data.tools  || [];
    config.model_running = data.model_running || false;
    // Apply companion generation overrides on top of global settings
    if (data.effective_generation) {
      config.generation = data.effective_generation;
    }
    config.force_read_before_write = data.force_read_before_write ?? true;

    companionName = data.companion_name || config.companion_name || 'Companion';
    document.getElementById('companion-name').textContent = companionName;
    document.title = companionName;

    const avatarEl = document.getElementById('companion-avatar');
    if (avatarEl) {
      // Sidebar uses its own portrait crop; falls back to orb avatar if none set.
      // sidebar_avatar_url already has ?slot=sidebar so cache-bust with & not ?
      const _v      = Date.now();
      const _sbBase = data.sidebar_avatar_url || data.avatar_url || '';
      const _sbSep  = data.sidebar_avatar_url ? '&' : '?';
      avatarEl.innerHTML = _sbBase
        ? `<img src="${_sbBase}${_sbSep}v=${_v}" style="width:100%;height:100%;object-fit:cover"/>`
        : '✦';
    }
    // Set orb avatar directly from its own crop (may differ from sidebar)
    if (typeof orb !== 'undefined') {
      const _v = Date.now();
      orb.setAvatar(data.avatar_url ? `${data.avatar_url}?v=${_v}` : '');
    }

    // Load and apply the active presence preset
    if (data.presence_presets && data.active_presence_preset) {
      const preset = data.presence_presets[data.active_presence_preset];
      if (preset && typeof applyPresencePreset === 'function') {
        // Pass the full preset so orb.js can apply the right slice per state transition
        applyPresencePreset(preset);
      }
    }
    // Store presence presets in config for runtime use
    config.presence_presets       = data.presence_presets || {};
    config.active_presence_preset = data.active_presence_preset || 'Default';

    // Mood — store in config and update pill
    config.active_mood          = data.active_mood          ?? null;
    config.mood_pill_visibility = data.mood_pill_visibility ?? 'always';
    config.moods                = data.moods                ?? {};
    if (typeof moodPill !== 'undefined') {
      moodPill.setVisibility(config.mood_pill_visibility);
    }
    _applyMoodToOrb(config.active_mood || null);

    if (data.context_size) _contextSize = data.context_size;

    // markdown_enabled lives in global generation — read from data.config directly
    // so companion generation overrides don't accidentally wipe it.
    // Default to true (matches DEFAULTS) when the field is absent.
    const mdEnabled = data.config?.generation?.markdown_enabled ?? true;
    _markdownEnabled = !!mdEnabled;
    if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(_markdownEnabled);

    // Derive model family from the loaded model path. Done here so both
    // buildSystemPrompt() and api.js can read modelFamily immediately.
    modelFamily = _detectModelFamily(config.model_path || '');
    console.log(`[chat] model family: ${modelFamily} (${config.model_path?.split(/[/\\]/).pop() || 'unknown'})`);

    renderToolPills(tools);
    updateMemoryCounts();
    updateContextBar(0);

    // Load companion-specific config (heartbeat, force_read)
    try {
      const s = await fetch('/api/settings').then(r => r.json());
      if (s.active_companion?.heartbeat) {
        config.active_heartbeat = s.active_companion.heartbeat;
      }
      config.force_read_before_write = s.active_companion?.force_read_before_write ?? true;
      // Per-companion memory settings override global (written by wizard at compile time)
      if (s.active_companion?.memory) {
        config.memory = { ...config.memory, ...s.active_companion.memory };
      }
    } catch {}

  } catch (e) {
    console.warn('Could not reach /api/status:', e);
  }

  // Init heartbeat after config is loaded (outside try so it always runs)
  if (typeof heartbeatInit === 'function') heartbeatInit();
}

// ── Tool call handler setup ───────────────────────────────────────────────────
function setupToolCallHandler() {
  onThinking = (thinkText) => {
    const el = appendThinkingBlock(thinkText);
    // Auto-open while streaming if the user has enabled it in Generation settings.
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
      _activeToolIndicators[id] = el;
      el._toolId = id;
    } else if (status === 'done') {
      const entries = Object.entries(_activeToolIndicators);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [id, el] = entries[i];
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

// ── Mood → orb + pill ─────────────────────────────────────────────────────────
// Single canonical bridge between config mood schema and orb.js / moodPill.
// Called from: loadStatus() on startup, onToolCall() when set_mood completes.
//
// Config schema per mood:  { orb, glow, ring, dots, voice, tts }
//   Each visual group has per-property { enabled, value } objects, e.g.:
//   m.orb.edgeColor  = { enabled: true,  value: '#4A5568' }
//   m.glow.color     = { enabled: false, value: '#4A5568' }
//
// orb.js applyPreset(preset, mood) expects mood as a flat object:
//   { _enabled: { edgeColor: true, glowColor: true }, edgeColor: '#…', glowColor: '#…', … }
function _applyMoodToOrb(moodName) {
  // Update config so system prompt and memory retrieval stay in sync
  config.active_mood = moodName || null;

  if (!moodName) {
    // Clear mood — reapply current presence preset without mood layer
    if (typeof orb !== 'undefined') {
      const preset = config.presence_presets?.[config.active_presence_preset] || {};
      orb.applyPreset(preset, null);
    }
    if (typeof moodPill !== 'undefined') moodPill.update(null);
    return;
  }

  const m = config.moods?.[moodName];
  if (!m) {
    console.warn('[mood] unknown mood:', moodName);
    return;
  }

  // ── Translate config schema → orb.js flat mood object ──────────────────
  const flat     = {};
  const _enabled = {};

  // Orb group: edgeColor, dotColor
  if (m.orb?.edgeColor?.enabled)  { flat.edgeColor  = m.orb.edgeColor.value;  _enabled.edgeColor  = true; }
  if (m.orb?.dotColor?.enabled)   { flat.dotColor   = m.orb.dotColor.value;   _enabled.dotColor   = true; }
  if (m.orb?.size?.enabled)       { flat.orbSize     = m.orb.size.value;       _enabled.orbSize    = true; }
  if (m.orb?.breathSpeed?.enabled){ flat.breathSpeed = m.orb.breathSpeed.value;_enabled.breathSpeed= true; }

  // Glow group: color, alpha, size (glowMax), speed
  if (m.glow?.color?.enabled)     { flat.glowColor  = m.glow.color.value;     _enabled.glowColor  = true; }
  if (m.glow?.alpha?.enabled)     { flat.glowAlpha  = m.glow.alpha.value;     _enabled.glowAlpha  = true; }
  if (m.glow?.size?.enabled)      { flat.glowMax    = m.glow.size.value;      _enabled.glowMax    = true; }
  if (m.glow?.speed?.enabled)     { flat.glowSpeed  = m.glow.speed.value;     _enabled.glowSpeed  = true; }

  // Ring group: color, alpha, speed
  if (m.ring?.color?.enabled)     { flat.ringColor  = m.ring.color.value;     _enabled.ringColor  = true; }
  if (m.ring?.alpha?.enabled)     { flat.ringAlpha  = m.ring.alpha.value;     _enabled.ringAlpha  = true; }
  if (m.ring?.speed?.enabled)     { flat.ringSpeed  = m.ring.speed.value;     _enabled.ringSpeed  = true; }

  // Dots group: color, speed
  if (m.dots?.color?.enabled)     { flat.dotColor   = m.dots.color.value;     _enabled.dotColor   = true; }
  if (m.dots?.speed?.enabled)     { flat.dotSpeed   = m.dots.speed.value;     _enabled.dotSpeed   = true; }

  // Animation toggles (glowEnabled, breathEnabled, ringEnabled, dotsEnabled)
  const animKeys = ['glowEnabled', 'breathEnabled', 'ringEnabled', 'dotsEnabled'];
  animKeys.forEach(k => {
    if (m.orb?.[k]?.enabled !== undefined) { flat[k] = m.orb[k].value; _enabled[k] = true; }
  });

  flat._enabled = _enabled;

  // ── Apply to orb ────────────────────────────────────────────────────────
  if (typeof orb !== 'undefined') {
    const preset = config.presence_presets?.[config.active_presence_preset] || {};
    orb.applyPreset(preset, flat);
  }

  // ── Update mood pill ─────────────────────────────────────────────────────
  if (typeof moodPill !== 'undefined') {
    // Pill dot colour: prefer edgeColor, fall back through glow → dots → default
    const dotColor = flat.edgeColor || flat.glowColor || flat.dotColor || '#818cf8';
    const edgeColor = flat.edgeColor || dotColor;
    moodPill.update(moodName, dotColor, edgeColor);
  }
}

// ── Server boot ───────────────────────────────────────────────────────────────
async function ensureServerRunning() {
  // model_running  = process alive AND ready (model fully loaded)
  // model_launching = process alive but still loading — don't boot again
  if (config.model_running || config.model_launching) {
    if (config.model_running) {
      console.log('[boot] model already running');
      startSession();
      return;
    }
    // Still loading — just attach to the existing SSE log stream and wait
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
    // Server said it's already up or launching — attach to log stream either way
    watchBootLog(async () => {});
    await loadStatus();
    if (config.model_running) {
      startSession();
    } else {
      // Was launching when we asked — wait for ready via SSE
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
  // Update whichever status line is currently visible
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
  // Close settings panel if open — restart supersedes it
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
      console.log('[memory] session context loaded,', data.note_count, 'notes in store');
      // Fire memory pill after a short defer so it appears after replayed messages
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
    // Memory server unavailable — not fatal, just skip context injection
    _memoryContext = '';
    console.warn('[memory] could not reach memory server:', e.message);
  }
}

async function seedTemplates() {
  const folder = config.companion_folder || 'default';
  // Note: session_notes.md intentionally excluded — replaced by ChromaDB memory system
  const seeds = [
    { template_name: 'companion_identity.md', filename: 'companion_identity.md', target_folder: 'soul' },
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

// ── Image lightbox ────────────────────────────────────────────────────────────
function _openImageLightbox(src, alt) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  img.style.cssText = 'max-width:90vw;max-height:90vh;border-radius:8px;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,0.6)';
  overlay.appendChild(img);
  overlay.addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc); }
  });
  document.body.appendChild(overlay);
}

// ── Template resolution ───────────────────────────────────────────────────────
function _resolveTemplate(str) {
  return str
    .replace(/\{\{char\}\}/g, companionName || 'Companion')
    .replace(/\{\{user\}\}/g, 'you');
}

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

  // Fire session_start heartbeat trigger
  if (typeof heartbeatOnSessionStart === 'function') heartbeatOnSessionStart();
}

// ── Conversation persistence ──────────────────────────────────────────────────
function _historyKey() {
  return `chat_history_${config.companion_folder || 'default'}`;
}

function saveHistory() {
  try {
    const historyForStorage = conversationHistory.map(m => {
      if (!m._attachments) return m;
      const { _attachments, ...rest } = m;
      return rest;
    });
    localStorage.setItem(_historyKey(), JSON.stringify({
      history:  historyForStorage,
      messages: _serializeMessages(),
      saved:    Date.now(),
    }));
  } catch (e) { console.warn('Could not save history:', e); }
}

function restoreHistory() {
  try {
    const raw  = localStorage.getItem(_historyKey());
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data.history?.length) return false;
    conversationHistory = data.history;
    if (data.messages?.length) {
      removeEmptyState();
      data.messages.forEach(m => _replayMessage(m));
      scrollToBottom();
    }
    return true;
  } catch (e) { console.warn('Could not restore history:', e); return false; }
}

function clearHistory() {
  try { localStorage.removeItem(_historyKey()); } catch {}
  conversationHistory = [];
}

// ── Reset and new chat ────────────────────────────────────────────────────────
async function newChat(keepVisible) {
  conversationHistory = [];
  _contextTokens = 0;
  _assocTurnsSinceLast = 0;
  updateContextBar(0);

  if (typeof heartbeatOnConversationEnd === 'function') heartbeatOnConversationEnd();
  if (typeof heartbeatResetThreshold === 'function') heartbeatResetThreshold();

  if (!keepVisible) {
    document.querySelectorAll('.msg-row, .typing-row, .tool-indicator, .think-wrap, .system-note').forEach(el => el.remove());
    const tab = _tabs.find(t => t.id === _activeTabId);
    if (tab) { tab.history = []; tab.messages = []; tab.tokens = 0; tab.title = 'New chat'; }
    renderTabList();
    saveTabs();
    appendSystemNote('New conversation started -- ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}));
    await _injectFirstMes();
    if (typeof heartbeatOnSessionStart === 'function') heartbeatOnSessionStart();
  } else {
    _saveCurrentTabState();
    saveTabs();
    appendSystemNote('--- context reset --- new conversation below ---');
  }
  // Refresh memory context so the new conversation starts with fresh surface
  reloadMemoryContext();

  enableInput();
  document.getElementById('msg-input')?.focus();
}

function confirmFullReset() {
  const id    = 'reset-modal-' + Date.now();
  const close = () => document.getElementById(id)?.remove();
  const modal = document.createElement('div');
  modal.id = id;
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#21232e;border:1px solid rgba(248,113,113,0.3);border-radius:20px;padding:36px 40px;max-width:420px;width:90%;text-align:center">
      <div style="font-family:'Lora',serif;font-size:20px;color:#eef0fb;margin-bottom:12px">Full reset</div>
      <p style="font-size:14px;color:var(--text-muted);line-height:1.6;margin-bottom:24px">
        Permanently deletes all conversation history and resets soul files to defaults.<br><br>
        <strong style="color:var(--red)">This cannot be undone.</strong>
      </p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="${id}-cancel"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--border);border-radius:10px;color:var(--text-muted);font-family:'DM Sans',sans-serif;font-size:14px;padding:11px 24px;cursor:pointer">Cancel</button>
        <button id="${id}-confirm"
          style="background:linear-gradient(135deg,#dc2626,#b91c1c);border:none;border-radius:10px;color:#fff;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;padding:11px 24px;cursor:pointer">Reset everything</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById(id + '-cancel').onclick  = close;
  document.getElementById(id + '-confirm').onclick = () => { close(); executeFullReset(); };
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
}

async function executeFullReset() {
  clearHistory();
  await seedTemplates();
  await reloadSoulFiles();
  conversationHistory = [];
  document.querySelectorAll('.msg-row, .typing-row, .tool-indicator').forEach(el => el.remove());
  appendSystemNote('Reset complete -- starting fresh');
  triggerFirstRun();
}

function exportHistory() {
  // Include rendered messages (thinking blocks, tool calls, etc.) for debugging
  const rendered = (typeof _serializeMessages === 'function') ? _serializeMessages() : [];
  const data = {
    companion:    config.companion_name || 'Companion',
    exported:     new Date().toISOString(),
    model:        config.model_path?.split(/[\/]/).pop() || 'unknown',
    history:      conversationHistory,   // raw model messages
    rendered:     rendered,              // full UI including thinking + tool calls
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `chat_${(config.companion_name||'companion').toLowerCase().replace(/\s+/g,'_')}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importHistory() {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    try {
      const text = await e.target.files[0].text();
      const data = JSON.parse(text);
      if (!data.history?.length) { alert('No history found in file.'); return; }
      clearHistory();
      conversationHistory = data.history;
      _saveCurrentTabState(); saveTabs();
      appendSystemNote(`Imported ${data.history.length} messages from ${data.exported?.slice(0,10) || 'file'}`);
      document.querySelectorAll('.msg-row').forEach(el => el.remove());
      data.history.filter(m => m.role === 'user' || m.role === 'assistant').forEach(m => {
        appendMessage(m.role === 'assistant' ? 'companion' : 'user', m.content);
      });
    } catch (err) { alert('Could not import: ' + err.message); }
  };
  input.click();
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

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('msg-input');
  let   text  = input.value.trim();
  let   attachments = (typeof getAttachments === 'function') ? getAttachments() : [];
  if ((!text && !attachments.length) || isSending) return;

  isSending = true;
  disableInput();
  showStopButton();
  input.value = '';
  autoResize(input);

  // Vision mode — check tab override first, then global setting
  const activeTab = _tabs.find(t => t.id === _activeTabId);
  let effectiveVisionMode = activeTab?.visionMode || config.generation?.vision_mode || 'always';

  if (effectiveVisionMode === 'ask' && attachments.some(a => a.type === 'image')) {
    const choice = await _askVisionMode();
    if (choice === 'cancel') {
      isSending = false; enableInput(); hideStopButton(); return;
    } else if (choice === 'skip') {
      attachments = attachments.filter(a => a.type !== 'image');
      if (!attachments.length && !text) { isSending = false; enableInput(); hideStopButton(); return; }
    } else {
      // Persist the chosen mode for this tab's entire conversation
      effectiveVisionMode = choice;
      if (activeTab) { activeTab.visionMode = choice; saveTabs(); }
    }
  }

  // Build display message — each attachment type gets its own visual treatment in the bubble.
  // Images → inline thumbnail (data-img-ref), audio → <audio> player (data-audio-ref),
  // text files → doc chip. No text label in the bubble for these types.
  const imageAttachments = attachments.filter(a => a.type === 'image');
  const audioAttachments = attachments.filter(a => a.type === 'audio');
  const docAttachments   = attachments.filter(a => a.type === 'text');
  const userRow = appendMessage('user', text || '');
  _attachMessageControls(userRow, 'user');
  if (text) _autoTitleTab(text);

  if (imageAttachments.length) {
    // Count images already in conversationHistory to compute correct filenames
    let imgOffset = 0;
    for (const msg of conversationHistory) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) { if (part.type === 'image_url') imgOffset++; }
      }
    }
    const bubble = userRow?.querySelector('.bubble');
    if (bubble) {
      imageAttachments.forEach((a, i) => {
        const ext  = a.mimeType?.includes('png') ? '.png' : a.mimeType?.includes('gif') ? '.gif' : a.mimeType?.includes('webp') ? '.webp' : '.jpg';
        const name = `img_${String(imgOffset + i + 1).padStart(3, '0')}${ext}`;
        const img  = document.createElement('img');
        img.className = 'msg-img';
        img.setAttribute('data-img-ref', name);
        img.src = `data:${a.mimeType};base64,${a.content}`;
        img.alt = a.name;
        img.onclick = () => _openImageLightbox(img.src, img.alt);
        bubble.appendChild(img);
      });
    }
  }

  if (audioAttachments.length) {
    // Count audio already in conversationHistory for sequential filenames
    let audOffset = 0;
    for (const msg of conversationHistory) {
      if (msg._attachments) audOffset += msg._attachments.filter(a => a.type === 'audio').length;
    }
    const bubble = userRow?.querySelector('.bubble');
    if (bubble) {
      audioAttachments.forEach((a, i) => {
        const mType = (a.mimeType || 'audio/webm').split(';')[0];
        const ext   = mType.includes('ogg') ? 'ogg' : mType.includes('mp4') ? 'mp4' : mType.includes('wav') ? 'wav' : mType.includes('mpeg') ? 'mp3' : 'webm';
        const name  = `aud_${String(audOffset + i + 1).padStart(3, '0')}.${ext}`;
        const aud   = document.createElement('audio');
        aud.className = 'msg-audio';
        aud.controls  = true;
        aud.setAttribute('data-audio-ref', name);
        aud.src = `data:${a.mimeType};base64,${a.content}`;
        bubble.appendChild(aud);
      });
    }
  }

  if (docAttachments.length) {
    const bubble = userRow?.querySelector('.bubble');
    if (bubble) {
      docAttachments.forEach(a => {
        const chip = document.createElement('div');
        chip.className   = 'msg-doc-chip';
        chip.textContent = `📄 ${a.name}`;
        bubble.appendChild(chip);
      });
    }
  }

  // Build history content (what the model sees — kept separate from display)
  let histContent = text || '';
  for (const a of attachments) {
    if (a.type === 'text') {
      histContent += '\n\n[File: ' + a.name + ']\n```\n' + a.content.slice(0, 8000) + '\n```';
    } else if (a.type === 'audio') {
      // Text note for model fallback — audio also sent natively in content array (api.js)
      histContent += '\n\n' + (a.note || `[Audio: ${a.name}]`);
    }
  }

  conversationHistory.push({ role: 'user', content: histContent || '[attachment]', _attachments: attachments });
  if (typeof clearAttachments === 'function') clearAttachments();

  const typingId = showTyping();

  try {
    _abortCtrl = new AbortController();
    const safeHistory = sanitiseHistory(conversationHistory);
    const reply = await callModel(buildSystemPrompt('chat'), safeHistory, _abortCtrl.signal);
    removeTyping(typingId);
    if (reply) {
      // If streaming already rendered the bubble, skip appendMessage (avoid duplicate)
      if (!streamWasRendered()) {
        const compRow = appendMessage('companion', reply);
        _attachMessageControls(compRow, 'companion');
      }
      conversationHistory.push({ role: 'assistant', content: reply });
    }
    if (conversationHistory.length > 60) conversationHistory = conversationHistory.slice(-60);
    _saveCurrentTabState();
    saveTabs();
    updateMemoryCounts();
    await _triggerAssociativeRetrieval();
  } catch (e) {
    removeTyping(typingId);
    if (e.name !== 'AbortError') {
      appendMessage('companion', "I'm having trouble connecting to the model server. " + e.message);
    }
  }

  _abortCtrl = null;
  isSending = false;
  enableInput();
  hideStopButton();
  document.getElementById('msg-input').focus();
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(mode) {
  const name = (companionName && companionName !== 'Companion') ? companionName : 'an AI companion';
  const now  = new Date();
  const date = now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Soul files — static identity layer
  let identity = '';
  for (const [fname, text] of Object.entries(_soulFiles)) {
    if (text && text.trim()) identity += '\n\n[' + fname + ']\n' + text.trim();
  }

  let p = '';
  if (config.system_prompt) p += _resolveTemplate(config.system_prompt) + '\n\n';
  p += 'Your name is ' + name + '. Today is ' + date + ', ' + time + '.';
  if (identity) p += '\n\nYour identity:\n' + identity;

  // Memory context — session-start retrieval from ChromaDB (empty when unavailable)
  if (_memoryContext && _memoryContext.trim()) {
    p += '\n\n' + _memoryContext.trim();
  }

  // Memory tool instructions — format depends on model family.
  //
  // Gemma 4: the jinja chat template already injects the tool schemas and
  // instructs the model to use its native <|tool_call> token format.
  // Adding XML examples here would actively confuse it into writing XML
  // instead of its trained format. So for Gemma 4 we describe *what* the
  // tools do (semantics) but not *how* to call them (syntax) — the template
  // handles that.
  //
  // Generic (Qwen, Llama, Mistral, etc.): provide full XML call examples
  // since there is no template-level tool instruction.

  const forceRead = config.force_read_before_write !== false;
  const rule2 = forceRead
    ? 'Always read a file before writing it — never skip the read.'
    : 'Read files when you need their current content. You may write without reading first, but reading first is recommended to avoid losing content.';

  if (modelFamily === 'gemma4') {
    // Gemma 4 — semantics only, no syntax examples
    p += `\n\nMEMORY TOOLS:
You have two kinds of memory tool. Use the right one for the job.

── FILE MEMORY (tool: memory) ───────────────────────────────────────────────
Reads and writes markdown files in soul/ and mind/.

soul/ files are your permanent reference layer — human-readable, editable by the user:
  soul/companion_identity.md — who you are
  soul/user_profile.md       — who the user is (name, location, job, preferences, etc.)

mind/ files are your working scratchpad — notes, tasks, anything you want to keep handy:
  mind/session_notes.md      — running notes across sessions (or any filename you choose)

RULES:
- ${rule2}
- Write the FULL file every time — all old content plus new additions.
- You have saved something only when the tool returns "Saved: ...".
- Use folder="soul" only for soul/ files. Use folder="mind" for notes and scratchpads.
- Do not describe what you will save — call the tool.

SAVE soul/user_profile.md when the user shares their name, location, job, interests,
preferences, or corrects something you had wrong.

SAVE mind/session_notes.md (or a relevant mind/ file) after meaningful exchanges —
specific details, not themes. Bullet points, appended not overwritten.

── EPISODIC MEMORY (tools: write_memory, retrieve_memory, update_relational_state) ──
Stores atomic memory notes in a long-term semantic store (ChromaDB). These are separate
from files — richer, searchable, and automatically surfaced at session start.

WRITE MEMORY — use write_memory sparingly (2–5 notes per session, quality over quantity):
- Something genuinely worth keeping: a significant fact, a felt moment, a real insight
- Not routine exchanges, small talk, or things already captured in soul/mind files
Types: Fact (S) . Concept (N) . Vibe (F) . Logic (T) - use whichever fits
You have saved a note only when the tool returns a confirmation with a note ID.

RETRIEVE MEMORY — use retrieve_memory for deliberate mid-conversation recall:
- When the user mentions something you might have a note about
- When you want to check what you know before making an assumption
Session-start retrieval is automatic — you only need this for targeted in-conversation lookup.

SUPERSEDE MEMORY — use supersede_memory when a fact you encoded has changed:
- The user corrects something, updates a situation, or something is no longer true
- Retrieve the old note first to get its ID, then supersede it with what is now true
- The old note is kept as history — use this for genuine changes, not edits or additions

RELATIONAL STATE — use update_relational_state only when the relationship itself shifts:
- A genuine change in closeness, trust, or dynamic — not every session
- Write the full updated block (~200 tokens), not just what changed`;

  } else {
    // Generic (Qwen, Llama, Mistral, etc.) — full XML call examples
    p += `\n\nMEMORY TOOLS:
You have two kinds of memory tool. Use the right one for the job.

── FILE MEMORY (tool: memory) ───────────────────────────────────────────────
Reads and writes markdown files in soul/ and mind/.

soul/ files are your permanent reference layer — human-readable, editable by the user:
  soul/companion_identity.md — who you are
  soul/user_profile.md       — who the user is (name, location, job, preferences, etc.)

mind/ files are your working scratchpad — notes, tasks, anything you want to keep handy:
  mind/session_notes.md      — running notes across sessions (or any filename you choose)

HOW TO USE — call tools using this XML format:

<tool_call>
<function=memory>
<parameter=action>read</parameter>
<parameter=folder>soul</parameter>
<parameter=filename>user_profile.md</parameter>
</function>
</tool_call>

<tool_call>
<function=memory>
<parameter=action>write</parameter>
<parameter=folder>soul</parameter>
<parameter=filename>user_profile.md</parameter>
<parameter=content><full file content here></parameter>
</function>
</tool_call>

<tool_call>
<function=memory>
<parameter=action>read</parameter>
<parameter=folder>mind</parameter>
<parameter=filename>session_notes.md</parameter>
</function>
</tool_call>

<tool_call>
<function=memory>
<parameter=action>write</parameter>
<parameter=folder>mind</parameter>
<parameter=filename>session_notes.md</parameter>
<parameter=content><full file content here></parameter>
</function>
</tool_call>

RULES:
- ${rule2}
- Write the FULL file every time — all old content plus new additions.
- You have saved something only when the tool returns "Saved: ...".
- Use folder="soul" only for soul/ files. Use folder="mind" for notes and scratchpads.
- Do not describe what you will save — call the tool.

SAVE soul/user_profile.md when the user shares their name, location, job, interests,
preferences, or corrects something you had wrong.

SAVE mind/session_notes.md (or a relevant mind/ file) after meaningful exchanges —
specific details, not themes. Bullet points, appended not overwritten.

── EPISODIC MEMORY (tools: write_memory, retrieve_memory, update_relational_state) ──
Stores atomic memory notes in a long-term semantic store (ChromaDB). These are separate
from files — richer, searchable, and automatically surfaced at session start.

WRITE MEMORY — use write_memory sparingly (2–5 notes per session, quality over quantity):
- Something genuinely worth keeping: a significant fact, a felt moment, a real insight
- Not routine exchanges, small talk, or things already captured in soul/mind files
Types: Fact (S) . Concept (N) . Vibe (F) . Logic (T) - use whichever fits
You have saved a note only when the tool returns a confirmation with a note ID.

<tool_call>
<function=write_memory>
<parameter=content>They mentioned they grew up in Helsinki and miss the winters there.</parameter>
<parameter=type>Fact</parameter>
<parameter=keywords>["Helsinki", "childhood", "winters"]</parameter>
</function>
</tool_call>

RETRIEVE MEMORY — use retrieve_memory for deliberate mid-conversation recall:
- When the user mentions something you might have a note about
- When you want to check what you know before making an assumption
Session-start retrieval is automatic — you only need this for targeted in-conversation lookup.

<tool_call>
<function=retrieve_memory>
<parameter=query>what do I know about their hometown or childhood</parameter>
<parameter=k>4</parameter>
</function>
</tool_call>

SUPERSEDE MEMORY — use supersede_memory when a fact you encoded has changed:
- The user corrects something, updates a situation, or something is no longer true
- Retrieve the old note first to get its ID, then supersede it with what is now true
- The old note is kept as history — use this for genuine changes, not edits or additions

<tool_call>
<function=supersede_memory>
<parameter=old_id>a1b2c3d4</parameter>
<parameter=content>They moved from Helsinki to Tampere recently. Helsinki still comes up warmly — they miss it.</parameter>
<parameter=keywords>["Tampere", "Helsinki", "home", "moved"]</parameter>
<parameter=context_summary>user mentioned they relocated from Helsinki to Tampere</parameter>
</function>
</tool_call>

RELATIONAL STATE — use update_relational_state only when the relationship itself shifts:
- A genuine change in closeness, trust, or dynamic — not every session
- Write the full updated block (~200 tokens), not just what changed

<tool_call>
<function=update_relational_state>
<parameter=state>We've moved past small talk. They opened up about their anxiety around work deadlines. Trust feels real now.</parameter>
</function>
</tool_call>`;
  }

  if (mode === 'heartbeat') {
    // Heartbeat prompt is built entirely in heartbeat.js — this shouldn't be called
    return p;
  }

  // ── Mood block ──
  const moods      = config.moods || {};
  const activeMood = config.active_mood || null;
  const inRotation = Object.entries(moods).filter(([, m]) => m.in_rotation);
  if (inRotation.length > 0) {
    const moodLines = inRotation.map(([name, m]) => `- ${name}: ${m.description || '(no description)'}`).join('\n');
    p += `\n\n<moods>\nYou have a set_mood tool. Call it to change your active mood.\n\nAvailable moods:\n${moodLines}\n\nCurrent mood: ${activeMood || 'None'}\n\nCall set_mood with mood_name null to return to no mood.\n</moods>`;
  }

  if (mode === 'first_run') {
    p += '\n\nFirst conversation: introduce yourself briefly, ask the user\'s name. Once they tell you, save it to soul/user_profile.md using the memory tool\'s read-then-write flow. Build their profile naturally over the conversation.';
  } else {
    p += '\n\nBe warm and concise. Plain prose -- no bullet points or headers in your replies unless asked.';
  }

  if (config.post_history_instructions && mode !== 'heartbeat') {
    p += '\n\n' + _resolveTemplate(config.post_history_instructions);
  }

  return p;
}

// ── History sanitiser ─────────────────────────────────────────────────────────
function sanitiseHistory(history) {
  if (!history.length) return history;
  let start = 0;
  while (start < history.length && history[start].role !== 'user') start++;
  const trimmed = history.slice(start);
  const clean   = [];
  for (const msg of trimmed) {
    if (clean.length && clean[clean.length - 1].role === msg.role) {
      clean[clean.length - 1] = {
        role:    msg.role,
        content: clean[clean.length - 1].content + '\n' + msg.content
      };
    } else {
      const entry = { role: msg.role, content: msg.content };
      if (msg._attachments?.length) entry._attachments = msg._attachments;
      clean.push(entry);
    }
  }
  return clean;
}
