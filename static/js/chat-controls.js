// chat-controls.js — Message controls: stop generation, regenerate, edit, vision modal
// Depends on: chat-ui.js, chat-tabs.js, chat.js (conversationHistory, callModel, etc.)

// ── Stop generation ───────────────────────────────────────────────────────────
function stopGeneration() {
  if (_abortCtrl) {
    _abortCtrl.abort();
    _abortCtrl = null;
  }
  // Also abort any in-flight heartbeat generation
  if (typeof _hbAbortCtrl !== 'undefined' && _hbAbortCtrl) {
    _hbAbortCtrl.abort();
    _hbAbortCtrl = null;
  }
}

function showStopButton() {
  const send = document.getElementById('send-btn');
  const stop = document.getElementById('stop-btn');
  if (send) send.style.display = 'none';
  if (stop) stop.style.display = 'flex';
}

function hideStopButton() {
  const send = document.getElementById('send-btn');
  const stop = document.getElementById('stop-btn');
  if (send) send.style.display = 'flex';
  if (stop) stop.style.display = 'none';
}

// ── Message controls ──────────────────────────────────────────────────────────
let _controlsAlwaysVisible = localStorage.getItem('controls_always_visible') === 'true';

function setControlsAlwaysVisible(val) {
  _controlsAlwaysVisible = val;
  localStorage.setItem('controls_always_visible', val);
  document.body.classList.toggle('controls-always-visible', val);
}

function _attachMessageControls(row, role) {
  const controls = document.createElement('div');
  controls.className = 'msg-controls';

  if (role === 'companion') {
    const regenBtn = document.createElement('button');
    regenBtn.className = 'msg-ctrl-btn';
    regenBtn.title     = 'Regenerate response';
    regenBtn.innerHTML = '↺';
    regenBtn.onclick   = () => regenerateFromRow(row);
    controls.appendChild(regenBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.className = 'msg-ctrl-btn';
  editBtn.title     = 'Edit';
  editBtn.innerHTML = '✎';
  editBtn.onclick   = () => editMessage(row, role);
  controls.appendChild(editBtn);

  row.appendChild(controls);
}

// ── Regenerate ────────────────────────────────────────────────────────────────
async function regenerateFromRow(targetRow) {
  if (isSending) return;

  const allRows   = Array.from(document.querySelectorAll('.msg-row'));
  const targetIdx = allRows.indexOf(targetRow);
  if (targetIdx === -1) return;

  const companionRowsBefore = allRows.slice(0, targetIdx).filter(r => r.classList.contains('companion')).length;

  let companionCount = 0, histIdx = -1;
  for (let i = 0; i < conversationHistory.length; i++) {
    if (conversationHistory[i].role === 'assistant') {
      if (companionCount === companionRowsBefore) { histIdx = i; break; }
      companionCount++;
    }
  }
  if (histIdx === -1) return;

  allRows.slice(targetIdx).forEach(r => r.remove());
  conversationHistory = conversationHistory.slice(0, histIdx);

  const typingId = showTyping();
  isSending = true;
  disableInput(); showStopButton();

  try {
    _abortCtrl = new AbortController();
    const reply = await callModel(buildSystemPrompt('chat'), sanitiseHistory(conversationHistory), _abortCtrl.signal);
    removeTyping(typingId);
    if (reply) {
      if (!streamWasRendered()) {
        const row = appendMessage('companion', reply);
        _attachMessageControls(row, 'companion');
      }
      conversationHistory.push({ role: 'assistant', content: reply });
      _saveCurrentTabState(); saveTabs();
      updateMemoryCounts();
    }
  } catch(e) {
    removeTyping(typingId);
    if (e.name !== 'AbortError') appendMessage('companion', `_(Regeneration failed: ${e.message})_`);
  }

  _abortCtrl = null;
  isSending = false;
  enableInput(); hideStopButton();
}

// ── Edit message ──────────────────────────────────────────────────────────────
function editMessage(row, role) {
  const bubble = row.querySelector('.bubble');
  if (!bubble) return;
  if (row.querySelector('.msg-edit-area')) return;

  const wrap     = bubble.parentElement;
  const original = bubble.innerText;

  const rows           = Array.from(document.querySelectorAll('.msg-row'));
  const rowIdx         = rows.indexOf(row);
  const histRole       = role === 'companion' ? 'assistant' : 'user';
  const sameRoleBefore = rows.slice(0, rowIdx).filter(r => r.classList.contains(role)).length;

  let histIdx = -1, count = 0;
  for (let i = 0; i < conversationHistory.length; i++) {
    if (conversationHistory[i].role === histRole) {
      if (count === sameRoleBefore) { histIdx = i; break; }
      count++;
    }
  }

  const bubbleW = bubble.getBoundingClientRect().width;
  wrap.style.display = 'none';

  const editWrap = document.createElement('div');
  editWrap.className = 'msg-edit-wrap';
  if (bubbleW > 0) {
    editWrap.style.width    = bubbleW + 'px';
    editWrap.style.maxWidth = 'none';
  }

  const textarea      = document.createElement('textarea');
  textarea.className  = 'msg-edit-area';
  textarea.value      = original;

  const btnRow        = document.createElement('div');
  btnRow.className    = 'msg-edit-btns';
  const okBtn         = document.createElement('button');
  okBtn.className     = 'msg-ctrl-btn';
  okBtn.textContent   = role === 'user' ? 'OK & regenerate' : 'OK';
  const cancelBtn     = document.createElement('button');
  cancelBtn.className = 'msg-ctrl-btn';
  cancelBtn.textContent = 'Cancel';
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(okBtn);

  editWrap.appendChild(textarea);
  editWrap.appendChild(btnRow);
  row.appendChild(editWrap);

  textarea.style.height = 'auto';
  textarea.style.height = Math.max(80, textarea.scrollHeight) + 'px';
  textarea.focus();
  textarea.select();

  const cancel = () => {
    editWrap.remove();
    wrap.style.display = '';
  };

  const confirm = async () => {
    const newText = textarea.value.trim();
    editWrap.remove();
    wrap.style.display = '';
    if (!newText || newText === original) return;

    bubble.innerHTML = renderMarkdown(newText);
    if (histIdx !== -1) conversationHistory[histIdx].content = newText;

    if (role === 'user') {
      rows.slice(rowIdx + 1).forEach(r => r.remove());
      const afterIdx = histIdx !== -1 ? histIdx + 1 : conversationHistory.length;
      conversationHistory = conversationHistory.slice(0, afterIdx);

      const typingId = showTyping();
      isSending = true; disableInput(); showStopButton();
      try {
        _abortCtrl = new AbortController();
        const reply = await callModel(buildSystemPrompt('chat'), sanitiseHistory(conversationHistory), _abortCtrl.signal);
        removeTyping(typingId);
        if (reply) {
          if (!streamWasRendered()) {
            const newRow = appendMessage('companion', reply);
            _attachMessageControls(newRow, 'companion');
          }
          conversationHistory.push({ role: 'assistant', content: reply });
          updateMemoryCounts();
        }
      } catch(e) {
        removeTyping(typingId);
        if (e.name !== 'AbortError') appendMessage('companion', `_(Edit regeneration failed: ${e.message})_`);
      }
      _abortCtrl = null; isSending = false; enableInput(); hideStopButton();
    }
    _saveCurrentTabState(); saveTabs();
  };

  okBtn.onclick     = confirm;
  cancelBtn.onclick = cancel;
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') cancel();
  });
}

// ── Vision mode ask prompt ────────────────────────────────────────────────────
function _askVisionMode() {
  return new Promise(resolve => {
    const id    = 'modal-vision-' + Date.now();
    const close = (val) => { document.getElementById(id)?.remove(); resolve(val); };
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:#21232e;border:1px solid var(--border);border-radius:20px;padding:28px 32px;max-width:380px;width:90%;text-align:center">
        <div style="font-family:'Lora',serif;font-size:16px;color:#eef0fb;margin-bottom:8px">Image attached</div>
        <p style="font-size:13px;color:var(--text-muted);line-height:1.6;margin-bottom:20px">
          How should the AI handle this image in follow-up messages?
        </p>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button id="${id}-always" style="background:rgba(129,140,248,0.12);border:1px solid rgba(129,140,248,0.25);border-radius:10px;color:#a5b4fc;font-family:inherit;font-size:13px;padding:10px 16px;cursor:pointer;text-align:left">
            <strong>Re-encode every turn</strong><br><span style="font-size:11.5px;opacity:.6">Full vision on follow-ups — slower</span>
          </button>
          <button id="${id}-once" style="background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:10px;color:var(--text-muted);font-family:inherit;font-size:13px;padding:10px 16px;cursor:pointer;text-align:left">
            <strong>Encode once</strong><br><span style="font-size:11.5px;opacity:.6">Faster follow-ups, loses live vision</span>
          </button>
          <button id="${id}-skip" style="background:none;border:none;color:var(--text-dim);font-family:inherit;font-size:12px;padding:6px;cursor:pointer">
            Remove image from message
          </button>
          <button id="${id}-cancel" style="background:none;border:none;color:var(--text-dim);font-family:inherit;font-size:11px;padding:4px;cursor:pointer;opacity:.6">
            Cancel (don't send)
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById(id + '-always').onclick = () => close('always');
    document.getElementById(id + '-once').onclick   = () => close('once');
    document.getElementById(id + '-skip').onclick   = () => close('skip');
    document.getElementById(id + '-cancel').onclick = () => close('cancel');
  });
}
