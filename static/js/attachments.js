// attachments.js — File attachment handling
//
// Supports: images (inline preview + base64 for vision models)
//           audio  (filename + transcript placeholder)
//           text   (reads file content, injects into message)
//
// Exposes:
//   openAttachMenu(event)  — shows/hides the attach type menu
//   triggerFilePick(type)  — opens the OS file picker
//   handleFilePick(input, type) — processes picked files
//   getAttachments()        — returns current queue for sendMessage()
//   clearAttachments()      — called after send

// ── Attachment queue ──────────────────────────────────────────────────────────
// Each entry: { type, name, content, previewUrl, mimeType }
let _attachments = [];

// ── Attach menu ───────────────────────────────────────────────────────────────
function openAttachMenu(event) {
  event.stopPropagation();
  const menu = document.getElementById('attach-menu');
  const btn  = event.currentTarget || document.getElementById('attach-btn');

  if (menu.style.display !== 'none') {
    menu.style.display = 'none';
    return;
  }

  // Show first so we can measure it
  menu.style.display = 'flex';
  menu.style.left    = '-9999px';
  menu.style.top     = '-9999px';

  requestAnimationFrame(() => {
    const rect     = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    // Position above the button, aligned to its left edge
    const top  = rect.top - menuRect.height - 8;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuRect.width - 8));
    menu.style.top  = top + 'px';
    menu.style.left = left + 'px';
  });

  const close = (e) => {
    if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      menu.style.display = 'none';
      document.removeEventListener('click', close, true);
    }
  };
  setTimeout(() => document.addEventListener('click', close, true), 50);
}

function triggerFilePick(type) {
  document.getElementById('attach-menu').style.display = 'none';
  const map = { image: 'file-image', audio: 'file-audio', text: 'file-text' };
  document.getElementById(map[type])?.click();
}

// ── File processing ───────────────────────────────────────────────────────────
async function handleFilePick(input, type) {
  const files = Array.from(input.files);
  for (const file of files) {
    await _processFile(file, type);
  }
  input.value = '';
  _renderStrip();
  _updateSendBtn();
}

async function _processFile(file, type) {
  if (type === 'image') {
    const { base64, mimeType, previewUrl } = await _readAsBase64(file);
    _attachments.push({ type: 'image', name: file.name, content: base64, mimeType, previewUrl });

  } else if (type === 'audio') {
    // For now: attach filename + note; full transcription would need whisper
    const { base64, mimeType } = await _readAsBase64(file);
    _attachments.push({
      type: 'audio', name: file.name, content: base64, mimeType,
      note: `[Audio file attached: ${file.name} (${_fmtSize(file.size)})]`
    });

  } else if (type === 'text') {
    const text = await _readAsText(file);
    _attachments.push({ type: 'text', name: file.name, content: text });
  }
}

function _readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl   = e.target.result;
      const [header, base64] = dataUrl.split(',');
      const mimeType  = header.match(/:(.*?);/)?.[1] || file.type;
      resolve({ base64, mimeType, previewUrl: dataUrl });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function _readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsText(file, 'utf-8');
  });
}

// ── Attachment strip (preview row above input) ────────────────────────────────
function _renderStrip() {
  const strip = document.getElementById('attachment-strip');
  if (!_attachments.length) { strip.style.display = 'none'; strip.innerHTML = ''; return; }

  strip.style.display = 'flex';
  strip.innerHTML = _attachments.map((a, i) => {
    if (a.type === 'image') {
      return `<div class="att-chip att-image" title="${_esc(a.name)}">
        <img src="${a.previewUrl}" alt="${_esc(a.name)}"/>
        <span class="att-chip-name">${_esc(_shortName(a.name))}</span>
        <button class="att-remove" onclick="removeAttachment(${i})">×</button>
      </div>`;
    }
    const icon = a.type === 'audio' ? '🎵' : '📄';
    return `<div class="att-chip att-file" title="${_esc(a.name)}">
      <span class="att-icon">${icon}</span>
      <span class="att-chip-name">${_esc(_shortName(a.name))}</span>
      <button class="att-remove" onclick="removeAttachment(${i})">×</button>
    </div>`;
  }).join('');
}

function removeAttachment(index) {
  _attachments.splice(index, 1);
  _renderStrip();
  _updateSendBtn();
}

function _updateSendBtn() {
  const input = document.getElementById('msg-input');
  const btn   = document.getElementById('send-btn');
  if (btn) btn.disabled = !input?.value.trim() && !_attachments.length;
}

// ── Drag & drop on the whole chat area ────────────────────────────────────────
function initDragDrop() {
  // Must run after DOM is ready

  let dragDepth = 0;

  document.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragDepth++;
    showDropZone();
  });

  document.addEventListener('dragleave', () => {
    dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; hideDropZone(); }
  });

  document.addEventListener('dragover', (e) => { e.preventDefault(); });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    hideDropZone();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const type = _guessType(file);
      await _processFile(file, type);
    }
    _renderStrip();
    _updateSendBtn();
  });
}

function _guessType(file) {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'text';
}

function showDropZone() {
  let el = document.getElementById('drop-zone');
  if (!el) {
    el = document.createElement('div');
    el.id = 'drop-zone';
    el.innerHTML = `<div class="drop-zone-inner">
      <div style="font-size:32px;margin-bottom:8px">⊕</div>
      <div>Drop files to attach</div>
      <div style="font-size:12px;opacity:.6;margin-top:4px">images · audio · text files</div>
    </div>`;
    document.querySelector('.chat-area')?.appendChild(el);
  }
  el.style.display = 'flex';
}

function hideDropZone() {
  document.getElementById('drop-zone')?.remove();
}

// ── API for sendMessage ───────────────────────────────────────────────────────
function getAttachments() { return [..._attachments]; }

function clearAttachments() {
  _attachments = [];
  _renderStrip();
  _updateSendBtn();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _shortName(name) { return name.length > 18 ? name.slice(0,15) + '…' : name; }
function _fmtSize(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024*1024)  return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

// Initialise drag-drop once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDragDrop);
} else {
  initDragDrop();
}
