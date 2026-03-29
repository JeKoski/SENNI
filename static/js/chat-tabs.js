// chat-tabs.js — Chat tab management, serialization, and replay
// Depends on: message-renderer.js (THINK_ICON, TOOL_ICON, _toolLabel, renderMarkdown)
//             chat-ui.js (appendMessage, appendSystemNote, scrollToBottom, removeEmptyState, enableInput)
//             chat-controls.js (_attachMessageControls)
//             attachments.js (_esc)

// ── Tab helpers ───────────────────────────────────────────────────────────────
function _tabsKey() {
  return `chat_tabs_${config.companion_folder || 'default'}`;
}

function saveTabs() {
  try {
    localStorage.setItem(_tabsKey(), JSON.stringify(_tabs));
  } catch(e) { console.warn('saveTabs failed:', e); }
}

function loadTabs() {
  try {
    const raw = localStorage.getItem(_tabsKey());
    if (raw) _tabs = JSON.parse(raw);
  } catch {}
  if (!_tabs.length) _tabs = [_makeTab()];
  _tabs = _tabs.map(t => ({
    id:       t.id       || _uid(),
    title:    t.title    || 'New chat',
    history:  t.history  || [],
    messages: t.messages || [],
    created:  t.created  || Date.now(),
    tokens:   t.tokens   || 0,
  }));
}

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _makeTab(title = 'New chat') {
  return { id: _uid(), title, history: [], messages: [], created: Date.now(), tokens: 0 };
}

// ── Tab operations ────────────────────────────────────────────────────────────
function newTab() {
  _saveCurrentTabState();
  const tab = _makeTab();
  _tabs.push(tab);
  saveTabs();
  switchTab(tab.id);
}

function switchTab(id) {
  if (_activeTabId === id) return;
  _saveCurrentTabState();
  _activeTabId = id;
  const tab = _tabs.find(t => t.id === id);
  if (!tab) return;

  conversationHistory = tab.history || [];

  const list = document.getElementById('messages');
  list.innerHTML = '';
  removeEmptyState();

  if (tab.messages?.length) {
    tab.messages.forEach(m => _replayMessage(m));
    scrollToBottom();
  } else if (!conversationHistory.length) {
    const isEmpty = document.createElement('div');
    isEmpty.id = 'empty-state';
    isEmpty.style.cssText = 'display:flex;flex:1;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px;padding:40px';
    isEmpty.textContent = 'Start a new conversation…';
    list.appendChild(isEmpty);
  }

  renderTabList();
  updateContextBar();
  enableInput();
  document.getElementById('msg-input')?.focus();
  saveTabs();

  // Fire session_start heartbeat when switching to an empty tab
  if (!tab.messages?.length && typeof heartbeatOnSessionStart === 'function') {
    heartbeatOnSessionStart();
  }
}

function closeTab(id, e) {
  e?.stopPropagation();
  const tab = _tabs.find(t => t.id === id);

  const isEmpty = !tab?.history?.length && !tab?.messages?.length;
  if (isEmpty) { _doCloseTab(id); return; }

  const modalId = 'modal-close-tab-' + Date.now();
  const close   = () => document.getElementById(modalId)?.remove();
  const modal   = document.createElement('div');
  modal.id = modalId;
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#21232e;border:1px solid var(--border);border-radius:20px;padding:28px 32px;max-width:360px;width:90%;text-align:center">
      <div style="font-family:'Lora',serif;font-size:17px;color:#eef0fb;margin-bottom:10px">Close chat?</div>
      <p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:20px">
        "<strong style="color:var(--text)">${_esc(tab?.title || 'This chat')}</strong>" will be permanently deleted.
      </p>
      <div style="display:flex;gap:10px;justify-content:center">
        <button id="${modalId}-cancel"
          style="background:rgba(255,255,255,0.07);border:1px solid var(--border);border-radius:10px;color:var(--text-muted);font-family:inherit;font-size:13px;padding:9px 20px;cursor:pointer">Keep it</button>
        <button id="${modalId}-confirm"
          style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border:none;border-radius:10px;color:#fff;font-family:inherit;font-size:13px;font-weight:500;padding:9px 20px;cursor:pointer">Close chat</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById(modalId + '-cancel').onclick  = close;
  document.getElementById(modalId + '-confirm').onclick = () => { close(); _doCloseTab(id); };
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
}

function _doCloseTab(id) {
  if (_tabs.length === 1) {
    _tabs[0] = _makeTab();
    _activeTabId = _tabs[0].id;
    conversationHistory = [];
    document.getElementById('messages').innerHTML = '';
    renderTabList();
    saveTabs();
    enableInput();
    return;
  }
  const idx    = _tabs.findIndex(t => t.id === id);
  _tabs.splice(idx, 1);
  const nextId = _tabs[Math.min(idx, _tabs.length - 1)].id;
  _activeTabId = null;
  saveTabs();
  switchTab(nextId);
}

function renameTab(id, e) {
  e?.stopPropagation();
  const tab = _tabs.find(t => t.id === id);
  if (!tab) return;
  const name = prompt('Rename chat:', tab.title);
  if (name && name.trim()) {
    tab.title = name.trim();
    saveTabs();
    renderTabList();
  }
}

// ── Tab state save/restore ────────────────────────────────────────────────────
function _saveCurrentTabState() {
  if (!_activeTabId) return;
  const tab = _tabs.find(t => t.id === _activeTabId);
  if (!tab) return;
  tab.history  = conversationHistory;
  tab.messages = _serializeMessages();
}

function _serializeMessages() {
  const msgs = [];
  const list = document.getElementById('messages');
  if (!list) return msgs;

  list.childNodes.forEach(el => {
    if (!(el instanceof HTMLElement)) return;

    if (el.classList.contains('msg-row')) {
      const role   = el.classList.contains('user') ? 'user' : 'companion';
      const bubble = el.querySelector('.bubble');
      const time   = el.querySelector('.msg-time');
      if (bubble) msgs.push({ type: 'message', role, html: bubble.innerHTML, time: time?.textContent || '' });

    } else if (el.classList.contains('think-wrap')) {
      const body = el.querySelector('.think-content');
      if (body) msgs.push({ type: 'thinking', text: body.textContent.slice(0, 4096) });

    } else if (el.classList.contains('tool-indicator') && el.classList.contains('done')) {
      const name    = el.dataset.toolName || '';
      const desc    = el.querySelector('.tool-desc')?.textContent || '';
      const preview = el.querySelector('.tool-result-preview')?.textContent || '';
      msgs.push({ type: 'tool', name, desc, preview: preview.slice(0, 1024) });

    } else if (el.classList.contains('system-note')) {
      msgs.push({ type: 'system', text: el.textContent });
    }
  });
  return msgs;
}

function _replayMessage(m) {
  const list = document.getElementById('messages');

  if (m.type === 'message') {
    const row    = document.createElement('div');
    row.className = `msg-row ${m.role}`;
    const wrap   = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = m.html;
    const time = document.createElement('div');
    time.className   = 'msg-time';
    time.textContent = m.time;
    wrap.appendChild(bubble);
    wrap.appendChild(time);
    row.appendChild(wrap);
    _attachMessageControls(row, m.role);
    list.appendChild(row);

  } else if (m.type === 'thinking') {
    const el = document.createElement('div');
    el.className = 'think-wrap';
    el.innerHTML = `
      <button class="think-toggle" onclick="this.closest('.think-wrap').classList.toggle('open')">
        ${THINK_ICON}
        <span class="think-label">Thinking</span>
        <span class="think-chevron">▶</span>
      </button>
      <div class="think-body"><div class="think-content"></div></div>`;
    el.querySelector('.think-content').textContent = m.text;
    list.appendChild(el);

  } else if (m.type === 'tool') {
    const el = document.createElement('div');
    el.className        = 'tool-indicator done';
    el.dataset.toolName = m.name;
    el.style.cursor     = 'pointer';
    el.innerHTML = `
      <span class="tool-done-dot"></span>
      ${TOOL_ICON}
      <span class="tool-name">${m.name}</span>
      <span class="tool-desc">${_esc(m.desc)}</span>
      <span class="tool-status">done</span>`;
    if (m.preview) {
      const prev = document.createElement('div');
      prev.className   = 'tool-result-preview';
      prev.textContent = m.preview;
      el.appendChild(prev);
    }
    el.onclick = () => el.classList.toggle('expanded');
    list.appendChild(el);

  } else if (m.type === 'system') {
    const note = document.createElement('div');
    note.className   = 'system-note';
    note.textContent = m.text;
    list.appendChild(note);
  }
}

// ── Tab list rendering ────────────────────────────────────────────────────────
function renderTabList() {
  const list = document.getElementById('tab-list');
  if (!list) return;
  list.innerHTML = '';
  _tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.id === _activeTabId ? ' active' : '');
    el.dataset.id = tab.id;
    el.innerHTML = `
      <span class="tab-title" ondblclick="renameTab('${tab.id}',event)" title="${_esc(tab.title)}">${_esc(tab.title)}</span>
      <button class="tab-close" onclick="closeTab('${tab.id}',event)" title="Close">×</button>`;
    el.onclick = () => switchTab(tab.id);
    list.appendChild(el);
  });
}

function _autoTitleTab(text) {
  const tab = _tabs.find(t => t.id === _activeTabId);
  if (!tab || tab.title !== 'New chat') return;
  const clean = text.replace(/\s+/g, ' ').trim();
  tab.title = clean.length > 42 ? clean.slice(0, 40) + '…' : clean;
  renderTabList();
  saveTabs();
}
