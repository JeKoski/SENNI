// chat-send.js — Send pipeline, history sanitisation, associative memory trigger
// Depends on: chat.js globals (config, conversationHistory, isSending, _abortCtrl,
//             _tabs, _activeTabId, companionName)
//             api.js (callModel), chat-ui.js, chat-tabs.js, system-prompt.js (buildSystemPrompt)

// ── Associative memory retrieval counter ──────────────────────────────────────
// System-driven feminine-pathway retrieval. Fires every ASSOC_INTERVAL turns
// after a successful reply, injecting surfaced notes as a hidden system turn
// and showing a memory pill in the UI.
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
      conversationHistory.push({ role: 'user',      content: `[Surfaced memories]\n${data.notes_text}` });
      conversationHistory.push({ role: 'assistant', content: '(noted)' });
      if (typeof onMemorySurface === 'function') onMemorySurface(data.notes_text);
    }
  } catch (e) {
    console.warn('[memory] associative retrieval failed (non-fatal):', e.message);
  }
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
      effectiveVisionMode = choice;
      if (activeTab) { activeTab.visionMode = choice; saveTabs(); }
    }
  }

  // Build display message — each attachment type gets its own visual treatment.
  const imageAttachments = attachments.filter(a => a.type === 'image');
  const audioAttachments = attachments.filter(a => a.type === 'audio');
  const docAttachments   = attachments.filter(a => a.type === 'text');
  const userRow = appendMessage('user', text || '');
  _attachMessageControls(userRow, 'user');
  if (text) _autoTitleTab(text);

  if (imageAttachments.length) {
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

  // Build history content (what the model sees)
  let histContent = text || '';
  for (const a of attachments) {
    if (a.type === 'text') {
      histContent += '\n\n[File: ' + a.name + ']\n```\n' + a.content.slice(0, 8000) + '\n```';
    } else if (a.type === 'audio') {
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
