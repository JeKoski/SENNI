// chat-ui.js — DOM helpers, sidebar UI, input handling, orb delegation
// Loaded after message-renderer.js and orb.js, before chat.js.
// Depends on: message-renderer.js, orb.js, attachments.js

// ── Tool pills ────────────────────────────────────────────────────────────────
function renderToolPills(tools) {
  const wrap = document.getElementById('tool-pills');
  if (!wrap) return;
  wrap.innerHTML = tools.length
    ? tools.map(t => `<span class="tool-pill">⚡ ${t}</span>`).join('')
    : '<span style="font-size:12px;color:var(--text-dim)">No tools loaded</span>';
}

// ── Context bar ───────────────────────────────────────────────────────────────
function updateContextBar(tokens) {
  const t   = tokens ?? _tabs?.find(t => t.id === _activeTabId)?.tokens ?? _contextTokens ?? 0;
  const pct = (_contextSize > 0) ? Math.min(100, Math.round((t / _contextSize) * 100)) : 0;

  const bar = document.getElementById('ctx-bar-fill');
  const cap = document.getElementById('ctx-cap');
  const pctEl = document.getElementById('ctx-pct');
  if (!bar) return;

  bar.style.width = pct + '%';
  bar.className = 'ctx-token-fill ctx-bar-fill';
  if      (pct >= 85) bar.classList.add('ctx-danger');
  else if (pct >= 66) bar.classList.add('ctx-warning');
  else if (pct >= 50) bar.classList.add('ctx-caution');

  // Cap label: e.g. "32k" from 32768
  if (cap && _contextSize > 0) {
    cap.textContent = Math.round(_contextSize / 1000) + 'k';
  }

  // Percentage label — show 0% when no tokens yet
  if (pctEl) pctEl.textContent = pct + '%';

  if (typeof heartbeatOnContextThreshold === 'function') {
    heartbeatOnContextThreshold(pct);
  }
}

// ── Memory counts ─────────────────────────────────────────────────────────────
async function updateMemoryCounts() {
  for (const folder of ['soul', 'mind', 'memory']) {
    try {
      const result = await callTool('memory', { action: 'list', folder });
      const el = document.getElementById('mem-' + folder);
      if (!el) continue;
      el.textContent = (!result || result.toLowerCase().includes('empty'))
        ? '0'
        : result.split(',').filter(s => s.trim()).length;
    } catch { /* non-critical */ }
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function removeEmptyState() {
  document.getElementById('empty-state')?.remove();
}

// ── Presence / orb — delegated to orb.js ─────────────────────────────────────
function setPresenceState(state, overrides = {}) { orb.setState(state); }
function setCompanionStatus(state)               { orb.setState(state); }
function syncStatusAvatar()                      { orb.syncAvatar(); }
function applyPresencePreset(preset, mood = null){ orb.applyPreset(preset, mood); }

// ── Typing ────────────────────────────────────────────────────────────────────
let _typingCounter = 0;

function showTyping() {
  orb.setState('thinking');
  scrollToBottom();
  return 'orb-' + (++_typingCounter);
}

function removeTyping(id) {
  // State handled by stream finaliser or appendMessage
}

function scrollToBottom() {
  const el = document.getElementById('messages');
  if (el) {
    el.scrollTop = el.scrollHeight;
    _userScrolled = false;  // hard scroll always resets the flag
  }
}

// ── Auto-scroll tracking ──────────────────────────────────────────────────────
// When the user manually scrolls up during streaming we stop auto-scrolling.
// scrollToBottom() (used on send, tab switch, etc.) always resets the flag.
// scrollIfFollowing() is used by the streaming path — only scrolls when the
// user hasn't scrolled away.
let _userScrolled = false;

function scrollIfFollowing() {
  if (!_userScrolled) scrollToBottom();
}

(function _initScrollTracking() {
  const run = () => {
    const el = document.getElementById('messages');
    if (!el) return;
    el.addEventListener('scroll', () => {
      // Consider "at bottom" if within 80px — accounts for rounding and
      // the small gap that appears before the last bubble fully renders.
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      _userScrolled = !atBottom;
    }, { passive: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

// ── Input helpers ─────────────────────────────────────────────────────────────
function initInput() {
  const input   = document.getElementById('msg-input');
  const sendBtn = document.getElementById('send-btn');
  input.addEventListener('input', () => {
    sendBtn.disabled = !input.value.trim() && !(typeof getAttachments === 'function' && getAttachments().length);
  });
}

function enableInput() {
  const input = document.getElementById('msg-input');
  const btn   = document.getElementById('send-btn');
  if (input) { input.disabled = false; input.focus(); }
  if (btn)   btn.disabled = false;
}

function disableInput() {
  const btn = document.getElementById('send-btn');
  if (btn) btn.disabled = true;
}

function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  document.getElementById('send-btn').disabled =
    !el.value.trim() && !(typeof getAttachments === 'function' && getAttachments().length);
}

// ── Sidebar resize ────────────────────────────────────────────────────────────
(function initSidebarResize() {
  const run = () => {
    const sidebar = document.getElementById('sidebar');
    const handle  = document.getElementById('sidebar-handle');
    if (!sidebar || !handle) return;

    const saved = localStorage.getItem('sidebar_width');
    if (saved) {
      sidebar.style.width = saved + 'px';
      document.documentElement.style.setProperty('--sidebar-w', saved + 'px');
    }

    let startX = 0, startW = 0, dragging = false;

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      dragging = true;
      startX   = e.clientX;
      startW   = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const delta = e.clientX - startX;
      const newW  = Math.min(400, Math.max(160, startW + delta));
      sidebar.style.width = newW + 'px';
      document.documentElement.style.setProperty('--sidebar-w', newW + 'px');
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar_width', sidebar.offsetWidth);
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();

// ── Memory pill ───────────────────────────────────────────────────────────────
// Shown in the chat timeline when the system surfaces associative memories.
// Styled like a heartbeat pill but with a memory/sparkle identity.
function appendMemoryPill(notesText) {
  const list = document.getElementById('messages');
  if (!list) return;

  const pill = document.createElement('div');
  pill.className = 'memory-pill';
  pill.innerHTML = `
    <span class="memory-pill-icon">✦</span>
    <span class="memory-pill-text">Memory surfaced</span>`;

  // Expand/collapse full notes on click
  if (notesText) {
    pill.title  = notesText;
    pill.style.cursor = 'pointer';
    let expanded = false;
    const detail = document.createElement('div');
    detail.className = 'memory-pill-detail';
    detail.textContent = notesText;
    pill.appendChild(detail);
    pill.addEventListener('click', () => {
      expanded = !expanded;
      detail.style.display = expanded ? 'block' : 'none';
    });
  }

  list.appendChild(pill);
  scrollIfFollowing();
}
