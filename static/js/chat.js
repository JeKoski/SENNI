// chat.js — Coordinator: shared state, mood bridge, persistence, chat management
// Depends on: system-prompt.js, chat-session.js, chat-send.js, chat-tabs.js,
//             chat-ui.js, chat-controls.js, api.js

// ── Shared state ──────────────────────────────────────────────────────────────
let config              = {};
let tools               = [];
let conversationHistory = [];
let isSending           = false;
let companionName       = 'Companion';
let _soulFiles          = {};
let _memoryContext      = '';
let _activeToolIndicators = {};
let _memorySurfacedCount  = 0;

// Tab state (used by chat-tabs.js)
let _tabs        = [];
let _activeTabId = null;
let _abortCtrl   = null;

// Context tracking (used by chat-ui.js)
let _contextSize   = 16384;
let _contextTokens = 0;

// ── Model family detection ────────────────────────────────────────────────────
// Derived once from config.model_path after loadStatus(). Read by api.js.
// Drives system prompt format and tool result injection style.
//
// "gemma4"  — Gemma 4: jinja template handles tool schema injection;
//             tool results use native <|tool_response> tokens.
// "generic" — Everything else (Qwen, Llama, Mistral, etc.): XML tool
//             instructions in system prompt; [Tool results] user turn.
let modelFamily = "generic";

// ── Orb mode ──────────────────────────────────────────────────────────────────
function setOrbMode(mode) {
  document.body.classList.remove('orb-mode-chat', 'orb-mode-header');
  document.body.classList.add(mode === 'header' ? 'orb-mode-header' : 'orb-mode-chat');
}

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
  if (typeof ttsInit === 'function') ttsInit();
  renderTabList();
  await ensureServerRunning();
});

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
  config.active_mood = moodName || null;

  if (!moodName) {
    if (typeof orb !== 'undefined') {
      const preset = config.presence_presets?.[config.active_presence_preset] || {};
      orb.applyPreset(preset, null);
    }
    if (typeof moodPill !== 'undefined') moodPill.update(null);
    document.documentElement.style.removeProperty('--active-mood-color');
    document.documentElement.style.removeProperty('--active-mood-color-hi');
    if (typeof updateSidebarMoodStrip === 'function') updateSidebarMoodStrip(null, null);
    if (typeof updateChatHeader === 'function') updateChatHeader(companionName, null, _memorySurfacedCount);
    return;
  }

  const m = config.moods?.[moodName];
  if (!m) {
    console.warn('[mood] unknown mood:', moodName);
    return;
  }

  const flat     = {};
  const _enabled = {};

  if (m.orb?.edgeColor?.enabled)  { flat.edgeColor  = m.orb.edgeColor.value;  _enabled.edgeColor  = true; }
  if (m.orb?.dotColor?.enabled)   { flat.dotColor   = m.orb.dotColor.value;   _enabled.dotColor   = true; }
  if (m.orb?.size?.enabled)       { flat.orbSize     = m.orb.size.value;       _enabled.orbSize    = true; }
  if (m.orb?.breathSpeed?.enabled){ flat.breathSpeed = m.orb.breathSpeed.value;_enabled.breathSpeed= true; }

  if (m.glow?.color?.enabled)     { flat.glowColor  = m.glow.color.value;     _enabled.glowColor  = true; }
  if (m.glow?.alpha?.enabled)     { flat.glowAlpha  = m.glow.alpha.value;     _enabled.glowAlpha  = true; }
  if (m.glow?.size?.enabled)      { flat.glowMax    = m.glow.size.value;      _enabled.glowMax    = true; }
  if (m.glow?.speed?.enabled)     { flat.glowSpeed  = m.glow.speed.value;     _enabled.glowSpeed  = true; }

  if (m.ring?.color?.enabled)     { flat.ringColor  = m.ring.color.value;     _enabled.ringColor  = true; }
  if (m.ring?.alpha?.enabled)     { flat.ringAlpha  = m.ring.alpha.value;     _enabled.ringAlpha  = true; }
  if (m.ring?.speed?.enabled)     { flat.ringSpeed  = m.ring.speed.value;     _enabled.ringSpeed  = true; }

  if (m.dots?.color?.enabled)     { flat.dotColor   = m.dots.color.value;     _enabled.dotColor   = true; }
  if (m.dots?.speed?.enabled)     { flat.dotSpeed   = m.dots.speed.value;     _enabled.dotSpeed   = true; }

  const animKeys = ['glowEnabled', 'breathEnabled', 'ringEnabled', 'dotsEnabled'];
  animKeys.forEach(k => {
    if (m.orb?.[k]?.enabled !== undefined) { flat[k] = m.orb[k].value; _enabled[k] = true; }
  });

  flat._enabled = _enabled;

  if (typeof orb !== 'undefined') {
    const preset = config.presence_presets?.[config.active_presence_preset] || {};
    orb.applyPreset(preset, flat);
  }

  if (typeof moodPill !== 'undefined') {
    const dotColor = flat.edgeColor || flat.glowColor || flat.dotColor || '#818cf8';
    const edgeColor = flat.edgeColor || dotColor;
    moodPill.update(moodName, dotColor, edgeColor);
  }

  const moodColor = flat.edgeColor || flat.glowColor || flat.dotColor || '#818cf8';
  document.documentElement.style.setProperty('--active-mood-color', moodColor);
  if (typeof updateSidebarMoodStrip === 'function') updateSidebarMoodStrip(moodName, moodColor);
  if (typeof updateChatHeader === 'function') updateChatHeader(companionName, moodName, _memorySurfacedCount);
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
  const rendered = (typeof _serializeMessages === 'function') ? _serializeMessages() : [];
  const data = {
    companion:    config.companion_name || 'Companion',
    exported:     new Date().toISOString(),
    model:        config.model_path?.split(/[\/]/).pop() || 'unknown',
    history:      conversationHistory,
    rendered:     rendered,
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
