// chat-ui.js — DOM helpers, message rendering, UI components
// Loaded before chat.js. All functions are pure UI — no conversation logic.
// Depends on: _esc() from attachments.js

// ── Markdown rendering ────────────────────────────────────────────────────────
let _markdownEnabled = false;

function setMarkdownEnabled(val) {
  _markdownEnabled = !!val;
  document.querySelectorAll('.bubble[data-raw-text]').forEach(b => {
    b.innerHTML = renderMarkdown(b.dataset.rawText);
  });
}

function renderMarkdown(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  if (!_markdownEnabled) {
    return escaped.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
  }

  let html = escaped
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,    '<em>$1</em>')
    .replace(/^[*\-] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>\n?)+/g, s => `<ul>${s}</ul>`)
    .replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>')
    .replace(/(<oli>[\s\S]*?<\/oli>\n?)+/g, s => `<ol>${s.replace(/<\/?oli>/g, m => m.replace('oli','li'))}</ol>`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^---$/gm, '<hr>');

  return html.split(/\n\n+/).map(p => {
    const t = p.trim();
    if (/^<(h[123]|ul|ol|hr|pre)/.test(t)) return t;
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// ── SVG icons ─────────────────────────────────────────────────────────────────
const THINK_ICON = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
  <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>
  <ellipse cx="8" cy="8" rx="6.5" ry="2.5"/>
  <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(60 8 8)"/>
  <ellipse cx="8" cy="8" rx="6.5" ry="2.5" transform="rotate(-60 8 8)"/>
</svg>`;

const TOOL_ICON = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  <ellipse cx="8" cy="5" rx="5" ry="2"/>
  <path d="M3 5v3c0 1.1 2.2 2 5 2s5-.9 5-2V5"/>
  <path d="M3 8v3c0 1.1 2.2 2 5 2s5-.9 5-2V8"/>
</svg>`;

// ── Thinking block ────────────────────────────────────────────────────────────
let _pendingThinkId = null;

function appendThinkingBlock(thinkText) {
  const list = document.getElementById('messages');

  if (_pendingThinkId) {
    const existing = document.getElementById(_pendingThinkId);
    if (existing) {
      existing.querySelector('.think-content').textContent = thinkText;
      return;
    }
  }

  const id = 'think-' + Date.now();
  const el = document.createElement('div');
  el.className = 'think-wrap';
  el.id = id;
  el.innerHTML = `
    <button class="think-toggle" onclick="this.closest('.think-wrap').classList.toggle('open')">
      ${THINK_ICON}
      <span class="think-label">Thinking</span>
      <span class="think-chevron">▶</span>
    </button>
    <div class="think-body"><div class="think-content"></div></div>`;
  el.querySelector('.think-content').textContent = thinkText;
  list.appendChild(el);
  _pendingThinkId = null;
  scrollToBottom();
  return el;
}

// ── Tool indicator ────────────────────────────────────────────────────────────
function appendToolIndicator(name, args, id) {
  const list = document.getElementById('messages');
  const el   = document.createElement('div');
  el.className        = 'tool-indicator loading';
  el.dataset.toolName = name;
  el.id = id;
  el.innerHTML = `
    <div class="tool-spinner"></div>
    ${TOOL_ICON}
    <span class="tool-name">${name}</span>
    <span class="tool-desc">${_toolLabel(name, args)}</span>
    <span class="tool-status">running…</span>`;
  list.appendChild(el);
  scrollToBottom();
  return el;
}

function markToolIndicatorDone(el, result) {
  el.classList.remove('loading');
  el.classList.add('done');
  const spinner = el.querySelector('.tool-spinner');
  if (spinner) spinner.outerHTML = '<span class="tool-done-dot"></span>';
  const status = el.querySelector('.tool-status');
  if (status) status.textContent = 'done';
  el.style.cursor = 'pointer';
  el.title = result ? result.slice(0, 200) : '';
  el.onclick = () => el.classList.toggle('expanded');
  if (result) {
    const detail = document.createElement('div');
    detail.className = 'tool-result-preview';
    detail.textContent = result.slice(0, 300) + (result.length > 300 ? '…' : '');
    el.appendChild(detail);
  }
}

function _toolLabel(name, args) {
  if (name === 'memory') {
    if (args.action === 'write')   return `writing ${args.folder}/${args.filename || '?'}`;
    if (args.action === 'read')    return `reading ${args.folder}/${args.filename || '?'}`;
    if (args.action === 'list')    return `listing ${args.folder}/`;
    if (args.action === 'archive') return `archiving ${args.filename || '?'}`;
  }
  if (name === 'web_search') return `"${(args.query || '').slice(0, 40)}"`;
  if (name === 'web_scrape') return (args.url || '').slice(0, 50);
  if (name === 'get_time')   return 'current time';
  return JSON.stringify(args).slice(0, 60);
}

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

  const bar   = document.getElementById('ctx-bar-fill');
  const label = document.getElementById('ctx-bar-label');
  if (!bar || !label) return;

  bar.style.width = pct + '%';
  label.textContent = t > 0
    ? `${pct}% — ${t.toLocaleString()} / ${_contextSize.toLocaleString()} tokens`
    : `${_contextSize.toLocaleString()} token context`;

  bar.className = 'ctx-bar-fill';
  if      (pct >= 85) bar.classList.add('ctx-danger');
  else if (pct >= 66) bar.classList.add('ctx-warning');
  else if (pct >= 50) bar.classList.add('ctx-caution');

  // Notify heartbeat if threshold crossed
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

function appendMessage(role, text) {
  const list = document.getElementById('messages');
  const row  = document.createElement('div');
  row.className = `msg-row ${role}`;
  const bubble = document.createElement('div');
  bubble.className      = 'bubble';
  bubble.dataset.rawText = text;
  bubble.innerHTML      = renderMarkdown(text);
  const time = document.createElement('div');
  time.className   = 'msg-time';
  time.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const wrap = document.createElement('div');
  wrap.appendChild(bubble);
  wrap.appendChild(time);
  row.appendChild(wrap);
  list.appendChild(row);
  scrollToBottom();
  return row;
}

function appendSystemNote(text) {
  const list = document.getElementById('messages');
  const note = document.createElement('div');
  note.className   = 'system-note';
  note.textContent = text;
  list.appendChild(note);
  scrollToBottom();
}

// ── Companion status bar ─────────────────────────────────────────────────────
// States: 'idle' | 'thinking' | 'streaming'
function setCompanionStatus(state) {
  const el = document.getElementById('companion-status');
  if (!el) return;
  el.className = 'companion-status ' + state;
}

function syncStatusAvatar() {
  // Mirror the sidebar avatar into the status bar
  const src = document.querySelector('#companion-avatar img')?.src;
  const csAv = document.getElementById('cs-avatar');
  if (!csAv) return;
  if (src) {
    csAv.innerHTML = `<img src="${src}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`;
  } else {
    csAv.textContent = '✦';
  }
}

// Keep typing functions working — they now control the status bar instead of DOM rows
let _typingCounter = 0;
function showTyping() {
  setCompanionStatus('thinking');
  scrollToBottom();
  return 'status-' + (++_typingCounter);  // dummy id, not used for DOM removal
}

function removeTyping(id) {
  // Called when a real reply arrives — status transitions to idle or streaming
  // Status will be set to 'streaming' by api.js or 'idle' after response finalises
  setCompanionStatus('idle');
}

function scrollToBottom() {
  const el = document.getElementById('messages');
  if (el) el.scrollTop = el.scrollHeight;
}

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
    if (saved) sidebar.style.width = saved + 'px';

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
