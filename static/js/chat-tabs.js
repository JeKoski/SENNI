// chat-tabs.js — Chat tab management, serialization, and replay
// Depends on: message-renderer.js (THINK_ICON, TOOL_ICON, _toolLabel, renderMarkdown)
//             chat-ui.js (appendMessage, appendSystemNote, scrollToBottom, removeEmptyState, enableInput)
//             chat-controls.js (_attachMessageControls)
//             attachments.js (_esc)
//
// History is persisted to disk via /api/history/* endpoints.
// localStorage holds only a lightweight tab index (IDs + active tab) so the
// browser never hits quota limits regardless of conversation length.
//
// Session folder structure on disk:
//   companions/<folder>/history/<tab-id>/
//     meta.json                        ← title, created, tokens, vision_mode
//     <YYYY-MM-DD_HHMMSS>/             ← one folder per session
//       session.json                   ← messages (DOM replay) + history (API format)
//       img_001.jpg, img_002.png       ← media files (future: full media attachment UI)

// ── Tab index (localStorage — lightweight only) ───────────────────────────────

function _tabIndexKey() {
  return `chat_tab_index_${config.companion_folder || 'default'}`;
}

function _saveTabIndex() {
  try {
    const index = {
      activeTabId: _activeTabId,
      tabs: _tabs.map(t => ({
        id:         t.id,
        title:      t.title,
        created:    t.created,
        tokens:     t.tokens,
        visionMode: t.visionMode || null,
      })),
    };
    localStorage.setItem(_tabIndexKey(), JSON.stringify(index));
  } catch (e) {
    console.warn('[tabs] could not save tab index to localStorage:', e);
  }
}

function _loadTabIndex() {
  try {
    const raw = localStorage.getItem(_tabIndexKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Session tracking ──────────────────────────────────────────────────────────
// Each page load starts a new session. The session ID is stable for the
// lifetime of the page so all saves within one session go to the same folder.

let _currentSessionId = _makeSessionId();

function _makeSessionId() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}` +
         `_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

// ── Disk save / load ──────────────────────────────────────────────────────────

// Strip inline base64 image/audio content from history entries before saving to disk.
// Media files are written as separate files; history entries keep path references.
// Handles two formats:
//   _attachments: [{type:'image'|'audio', content: base64, mimeType, ...}]  ← chat.js format
//   content: [{type:'image_url'|'audio_url', image_url|audio_url:{url:'data:...'}}]  ← API format
let _pendingImages = []; // [{name, data_url}] — flushed in _saveCurrentSessionToDisk (images + audio)

function _stripImagesFromHistory(history) {
  return history.map(msg => {
    // ── _attachments format (how chat.js stores attachments) ──
    if (msg._attachments?.length) {
      msg._attachments.filter(a => a.type === 'image').forEach(a => {
        const dataUrl = `data:${a.mimeType};base64,${a.content}`;
        const name = `img_${String(_pendingImages.length + 1).padStart(3, '0')}` +
                     _extFromDataUrl(dataUrl);
        _pendingImages.push({ name, data_url: dataUrl });
      });
      msg._attachments.filter(a => a.type === 'audio').forEach(a => {
        const dataUrl = `data:${a.mimeType};base64,${a.content}`;
        const name = `aud_${String(_pendingImages.length + 1).padStart(3, '0')}` +
                     _extFromDataUrl(dataUrl);
        _pendingImages.push({ name, data_url: dataUrl });
      });
      // Drop _attachments from saved history — no base64 on disk
      const { _attachments, ...rest } = msg;
      return rest;
    }

    // ── API array-format content (image_url / audio_url parts) ──
    if (Array.isArray(msg.content)) {
      const stripped = msg.content.map(part => {
        if (part.type === 'image_url' && part.image_url?.url?.startsWith('data:')) {
          const name = `img_${String(_pendingImages.length + 1).padStart(3, '0')}` +
                       _extFromDataUrl(part.image_url.url);
          _pendingImages.push({ name, data_url: part.image_url.url });
          return { type: 'image_ref', path: name };
        }
        if (part.type === 'audio_url' && part.audio_url?.url?.startsWith('data:')) {
          const name = `aud_${String(_pendingImages.length + 1).padStart(3, '0')}` +
                       _extFromDataUrl(part.audio_url.url);
          _pendingImages.push({ name, data_url: part.audio_url.url });
          return { type: 'audio_ref', path: name };
        }
        return part;
      });
      return { ...msg, content: stripped };
    }

    return msg;
  });
}

function _extFromDataUrl(dataUrl) {
  // Handles image/* and audio/* MIME types (codecs suffix ignored by \w+)
  const m = dataUrl.match(/^data:(image|audio)\/(\w+)/);
  if (!m) return '.bin';
  const [, category, sub] = m;
  const s = sub.toLowerCase();
  if (category === 'image') return s === 'jpeg' ? '.jpg' : '.' + s;
  // audio: webm/opus captures as 'webm', mp3 = mpeg, ogg, wav, mp4
  return s === 'mpeg' ? '.mp3' : s === 'ogg' ? '.ogg' : s === 'mp4' ? '.mp4' : s === 'wav' ? '.wav' : '.webm';
}

async function saveTabs() {
  _saveTabIndex();
  await _saveCurrentSessionToDisk();
}

async function _saveCurrentSessionToDisk() {
  if (!_activeTabId) return;
  const tab = _tabs.find(t => t.id === _activeTabId);
  if (!tab) return;

  const history = _stripImagesFromHistory(conversationHistory); // populates _pendingImages
  const images  = _pendingImages.splice(0);                     // consume what was just added

  try {
    await fetch('/api/history/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companion_folder: config.companion_folder || 'default',
        tab_id:           tab.id,
        session_id:       _currentSessionId,
        title:            tab.title,
        tokens:           tab.tokens || 0,
        vision_mode:      tab.visionMode || null,
        messages:         _serializeMessages(),
        history:          history,
        images:           images,
        started_at:       new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('[tabs] disk save failed:', e);
  }
}

async function loadTabs() {
  // 1. Restore lightweight tab index from localStorage
  const index = _loadTabIndex();

  if (index && Array.isArray(index.tabs) && index.tabs.length) {
    _tabs = index.tabs.map(t => _hydrateTabShell(t));
    if (index.activeTabId) _activeTabId = index.activeTabId;
  }

  // 2. Migrate from old localStorage format (full history stored in browser)
  if (!_tabs.length) {
    _migrateLegacyLocalStorage();
    // Flush migrated history to disk immediately — the old localStorage key
    // has been deleted, so this is the only chance to persist it.
    if (_tabs.length) await saveTabs();
  }

  // 3. If still nothing, fall back to listing from disk
  if (!_tabs.length) {
    await _loadTabsFromDisk();
  }

  if (!_tabs.length) _tabs = [_makeTab()];

  // Validate activeTabId
  if (!_activeTabId || !_tabs.find(t => t.id === _activeTabId)) {
    _activeTabId = _tabs[0].id;
  }

  // 4. Load the active tab's session from disk into memory.
  // Tabs restored from the index are shells (history: [], messages: []).
  // startSession() checks messages.length to decide whether to replay —
  // it must be populated before we get there.
  const activeTab = _tabs.find(t => t.id === _activeTabId);
  if (activeTab && !activeTab.history?.length && !activeTab.messages?.length) {
    const session = await _loadSessionFromDisk(_activeTabId);
    if (session) {
      activeTab.history  = session.history  || [];
      activeTab.messages = session.messages || [];
      // Restore the original session ID so subsequent saves go to the same
      // folder rather than creating a new one every page load.
      if (session.session_id) _currentSessionId = session.session_id;
    }
  }
  if (activeTab) {
    conversationHistory = activeTab.history || [];
  }
}

function _hydrateTabShell(t) {
  return {
    id:         t.id         || _uid(),
    title:      t.title      || 'New chat',
    created:    t.created    || Date.now(),
    tokens:     t.tokens     || 0,
    visionMode: t.visionMode || null,
    history:    [],   // loaded from disk on demand
    messages:   [],   // loaded from disk on demand
  };
}

async function _loadTabsFromDisk() {
  try {
    const res  = await fetch(`/api/history/list?companion_folder=${encodeURIComponent(config.companion_folder || 'default')}`);
    const data = await res.json();
    if (data.ok && data.tabs?.length) {
      _tabs = data.tabs.map(meta => _hydrateTabShell({
        id:         meta.tab_id,
        title:      meta.title,
        created:    meta.created ? new Date(meta.created).getTime() : Date.now(),
        tokens:     meta.tokens || 0,
        visionMode: meta.vision_mode || null,
      }));
    }
  } catch (e) {
    console.warn('[tabs] could not load tab list from disk:', e);
  }
}

async function _loadSessionFromDisk(tabId) {
  try {
    const res  = await fetch('/api/history/load', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companion_folder: config.companion_folder || 'default',
        tab_id: tabId,
      }),
    });
    const data = await res.json();
    if (data.ok && data.session) {
      return data.session;
    }
  } catch (e) {
    console.warn('[tabs] could not load session from disk:', e);
  }
  return null;
}

// ── Legacy migration ──────────────────────────────────────────────────────────
// One-time migration from the old full-history localStorage format.

function _migrateLegacyLocalStorage() {
  const oldKey = `chat_tabs_${config.companion_folder || 'default'}`;
  try {
    const raw = localStorage.getItem(oldKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const oldTabs = Array.isArray(parsed) ? parsed : (parsed.tabs || []);
    if (!oldTabs.length) return;

    _tabs = oldTabs.map(t => _hydrateTabShell(t));

    // Best-effort: migrate history into memory so it gets saved to disk
    // on the next saveTabs() call.
    oldTabs.forEach(oldTab => {
      const tab = _tabs.find(t => t.id === oldTab.id);
      if (tab) {
        tab.history  = oldTab.history  || [];
        tab.messages = oldTab.messages || [];
      }
    });

    if (parsed.activeTabId) _activeTabId = parsed.activeTabId;

    // Remove old key after successful migration
    localStorage.removeItem(oldKey);
    console.log('[tabs] migrated', _tabs.length, 'tab(s) from legacy localStorage');
  } catch (e) {
    console.warn('[tabs] legacy migration failed:', e);
  }
}

// ── UID / tab factory ─────────────────────────────────────────────────────────

function _uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _makeTab(title = 'New chat') {
  return { id: _uid(), title, history: [], messages: [], created: Date.now(), tokens: 0, visionMode: null };
}

// ── Tab operations ────────────────────────────────────────────────────────────

function newTab() {
  _saveCurrentTabState();
  const tab = _makeTab();
  _tabs.push(tab);
  saveTabs();
  switchTab(tab.id);
}

async function switchTab(id) {
  const tab = _tabs.find(t => t.id === id);
  if (!tab) return;

  // Only skip the full switch if already on this tab AND content is loaded.
  // If the tab is a shell (empty history/messages), fall through to load from disk.
  const alreadyLoaded = _activeTabId === id && (tab.history?.length || tab.messages?.length);
  if (alreadyLoaded) return;

  _saveCurrentTabState();
  await saveTabs();

  _activeTabId = id;

  // New session ID for this page visit on this tab
  _currentSessionId = _makeSessionId();

  // Load history from disk if not already in memory
  if (!tab.history?.length && !tab.messages?.length) {
    const session = await _loadSessionFromDisk(id);
    if (session) {
      tab.history  = session.history  || [];
      tab.messages = session.messages || [];
    }
  }

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
  _saveTabIndex();

  if (!tab.messages?.length) {
    // Fresh tab — resurface memory context and fire session-start heartbeat
    if (typeof reloadMemoryContext === 'function') reloadMemoryContext();
    if (typeof heartbeatOnSessionStart === 'function') heartbeatOnSessionStart();
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

async function _doCloseTab(id) {
  if (id === _activeTabId && typeof stopGeneration === 'function') {
    stopGeneration();
  }

  // Delete history from disk
  const folder = config.companion_folder || 'default';
  try {
    await fetch(`/api/history/${encodeURIComponent(folder)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  } catch (e) {
    console.warn('[tabs] could not delete history from disk:', e);
  }

  if (_tabs.length === 1) {
    _tabs[0] = _makeTab();
    _activeTabId = _tabs[0].id;
    conversationHistory = [];
    document.getElementById('messages').innerHTML = '';
    renderTabList();
    _saveTabIndex();
    enableInput();
    return;
  }

  const idx    = _tabs.findIndex(t => t.id === id);
  _tabs.splice(idx, 1);
  const nextId = _tabs[Math.min(idx, _tabs.length - 1)].id;
  _activeTabId = null;
  _saveTabIndex();
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
      if (bubble) {
        // Clone bubble and replace data: URLs on image thumbnails with media route URLs.
        // Keeps base64 blobs out of session.json.
        const clone  = bubble.cloneNode(true);
        const folder = (typeof config !== 'undefined' ? config.companion_folder : null) || 'default';
        clone.querySelectorAll('img[data-img-ref]').forEach(img => {
          if (img.src.startsWith('data:')) {
            const ref = img.getAttribute('data-img-ref');
            img.src = `/api/history/media/${folder}/${_activeTabId}/${_currentSessionId}/${ref}`;
          }
        });
        clone.querySelectorAll('audio[data-audio-ref]').forEach(aud => {
          if (aud.src.startsWith('data:')) {
            const ref = aud.getAttribute('data-audio-ref');
            aud.src = `/api/history/media/${folder}/${_activeTabId}/${_currentSessionId}/${ref}`;
          }
        });
        const entry = { type: 'message', role, html: clone.innerHTML, time: time?.textContent || '' };
        if (el.classList.contains('heartbeat-msg')) entry.heartbeat = true;
        msgs.push(entry);
      }

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

    } else if (el.classList.contains('memory-pill')) {
      // Persist memory pills so they replay correctly
      msgs.push({ type: 'memory-pill', text: el.querySelector('.memory-pill-text')?.textContent || '' });
    }
  });
  return msgs;
}

function _replayMessage(m) {
  const list = document.getElementById('messages');

  if (m.type === 'message') {
    const row    = document.createElement('div');
    row.className = `msg-row ${m.role}${m.heartbeat ? ' heartbeat-msg' : ''}`;
    const wrap   = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.className = `bubble${m.heartbeat ? ' heartbeat-bubble' : ''}`;
    bubble.innerHTML = m.html;
    const time = document.createElement('div');
    time.className   = `msg-time${m.heartbeat ? ' heartbeat-meta' : ''}`;
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

  } else if (m.type === 'memory-pill') {
    appendMemoryPill(m.text);
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
