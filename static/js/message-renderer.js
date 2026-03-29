// message-renderer.js — Markdown rendering, message/thinking/tool DOM builders
// No dependencies. Loaded before chat-ui.js, api.js, and chat-tabs.js.
//
// Exports (globals):
//   renderMarkdown(text) → html string
//   setMarkdownEnabled(bool)
//   appendMessage(role, text) → row element
//   appendSystemNote(text)
//   appendThinkingBlock(thinkText) → element
//   appendToolIndicator(name, args, id) → element
//   markToolIndicatorDone(el, result)
//   THINK_ICON, TOOL_ICON  (SVG strings, used by chat-tabs.js)

// ── Markdown ──────────────────────────────────────────────────────────────────
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

// ── SVG icons (also used by chat-tabs.js for replay) ─────────────────────────
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

// ── Message bubbles ───────────────────────────────────────────────────────────
function appendMessage(role, text) {
  const list = document.getElementById('messages');
  const row  = document.createElement('div');
  row.className = `msg-row ${role}`;
  const bubble = document.createElement('div');
  bubble.className       = 'bubble';
  bubble.dataset.rawText = text;
  bubble.innerHTML       = renderMarkdown(text);
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

// ── Tool indicators ───────────────────────────────────────────────────────────
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
    detail.className   = 'tool-result-preview';
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
