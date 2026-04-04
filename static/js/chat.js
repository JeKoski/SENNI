// chat.js — Core: state, startup, boot, session management, send, system prompt
// Depends on: api.js, attachments.js, chat-ui.js, chat-tabs.js, chat-controls.js

// ── Shared state ──────────────────────────────────────────────────────────────
let config              = {};
let tools               = [];
let conversationHistory = [];
let isSending           = false;
let companionName       = 'Companion';
let _soulFiles          = {};
let _activeToolIndicators = {};

// Tab state (used by chat-tabs.js)
let _tabs        = [];
let _activeTabId = null;
let _abortCtrl   = null;

// Context tracking (used by chat-ui.js)
let _contextSize   = 16384;
let _contextTokens = 0;

// ── Startup ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadStatus();
  initInput();
  setupToolCallHandler();
  document.body.classList.toggle('controls-always-visible', _controlsAlwaysVisible);
  loadTabs();
  if (!_activeTabId) _activeTabId = _tabs[0].id;
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
      avatarEl.innerHTML = data.avatar_data
        ? `<img src="${data.avatar_data}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`
        : '✦';
    }
    // Mirror avatar into the persistent companion orb
    if (typeof syncStatusAvatar === 'function') syncStatusAvatar();

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

    if (data.context_size) _contextSize = data.context_size;

    // markdown_enabled lives in global generation — read from data.config directly
    // so companion generation overrides don't accidentally wipe it.
    // Default to true (matches DEFAULTS) when the field is absent.
    const mdEnabled = data.config?.generation?.markdown_enabled ?? true;
    _markdownEnabled = !!mdEnabled;
    if (typeof setMarkdownEnabled === 'function') setMarkdownEnabled(_markdownEnabled);

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
    } catch {}

  } catch (e) {
    console.warn('Could not reach /api/status:', e);
  }

  // Init heartbeat after config is loaded (outside try so it always runs)
  if (typeof heartbeatInit === 'function') heartbeatInit();
}

// ── Tool call handler setup ───────────────────────────────────────────────────
function setupToolCallHandler() {
  onThinking = (thinkText) => { appendThinkingBlock(thinkText); };

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
    }
  };
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
      if (btn) { btn.textContent = '\u21ba'; btn.disabled = false; }
      if (typeof onReady === 'function') onReady();
      es.close();
      _activeBootES = null;
    }
  };
  es.onerror = () => {
    if (btn) { btn.textContent = '\u21ba'; btn.disabled = false; }
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

async function seedTemplates() {
  const folder = config.companion_folder || 'default';
  const seeds = [
    { template_name: 'companion_identity.md', filename: 'companion_identity.md', target_folder: 'soul' },
    { template_name: 'user_profile.md',       filename: 'user_profile.md',       target_folder: 'soul' },
    { template_name: 'session_notes.md',      filename: 'session_notes.md',      target_folder: 'mind' },
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

// ── Session start ─────────────────────────────────────────────────────────────
async function startSession() {
  removeEmptyState();
  document.getElementById('boot-overlay')?.remove();

  await reloadSoulFiles();

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
function newChat(keepVisible) {
  conversationHistory = [];
  _contextTokens = 0;
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
  } else {
    _saveCurrentTabState();
    saveTabs();
    appendSystemNote('--- context reset --- new conversation below ---');
  }
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
    appendMessage('companion', firstMsg);
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

  // Build display message
  const attachLabel = attachments.length
    ? ' ' + attachments.map(a => `[${a.type}: ${a.name}]`).join(' ')
    : '';
  const userRow = appendMessage('user', (text || '') + attachLabel);
  _attachMessageControls(userRow, 'user');
  if (text) _autoTitleTab(text);

  // Build history content
  let histContent = text || '';
  for (const a of attachments) {
    if (a.type === 'text') {
      histContent += '\n\n[File: ' + a.name + ']\n```\n' + a.content.slice(0, 8000) + '\n```';
    } else if (a.type === 'audio') {
      histContent += '\n\n' + a.note;
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
  const date = new Date().toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  let identity = '';
  for (const [fname, text] of Object.entries(_soulFiles)) {
    if (text && text.trim()) identity += '\n\n[' + fname + ']\n' + text.trim();
  }

  let p = 'Your name is ' + name + '. Today is ' + date + '.';
  if (identity) p += '\n\nYour memory:' + identity;

  const forceRead = config.force_read_before_write !== false;
  const rule2 = forceRead ? '2. READ a file before writing it. Never skip the read.' : '2. Read files when you need their current content, but you may write or move without reading first.';
  p += '\n\nMEMORY RULES:\n1. Call the tool -- do not describe what you would save.\n' + rule2 + '\n3. Write the FULL file every time -- all old content plus new additions.\n4. You have saved something only when the tool returns "Saved: ...".\n\nSAVE soul/user_profile.md when the user shares their name, location, job, interests, preferences, or corrects you.\nHOW: memory({"action":"read","folder":"soul","filename":"user_profile.md"}) then memory({"action":"write","folder":"soul","filename":"user_profile.md","content":"<full file>"})\n\nSAVE mind/session_notes.md after every 2-3 meaningful exchanges.\nFORMAT: bullet points, specific details not themes. Append -- never delete old bullets.\nHOW: memory({"action":"read","folder":"mind","filename":"session_notes.md"}) then memory({"action":"write","folder":"mind","filename":"session_notes.md","content":"<full file>"})\n\nYou can also create custom notes in mind/ for any topic: mind/topics.md, mind/tasks.md, etc.\nAlways use folder="mind" for notes. Never use folder="soul" for session_notes.md.';

  if (mode === 'heartbeat') {
    // Heartbeat prompt is built entirely in heartbeat.js — this shouldn't be called
    return p;
  }

  if (mode === 'first_run') {
    p += '\n\nFirst conversation: introduce yourself briefly, ask the user\'s name. Once they tell you, immediately do the read-then-write steps to save it to soul/user_profile.md. Build their profile naturally.';
  } else {
    p += '\n\nBe warm and concise. Plain prose -- no bullet points or headers in your replies unless asked.';
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
