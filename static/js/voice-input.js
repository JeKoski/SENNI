// voice-input.js — Microphone recording with auto-split at 30-second chunks
//
// Exports (globals):
//   voiceStart()  — request mic permission and begin recording
//   voiceStop()   — stop recording and finalise the last chunk
//
// Each 30-second chunk becomes a separate audio attachment in the queue
// (via addAttachment() from attachments.js).
//
// Depends on: attachments.js (addAttachment, clearAttachments via chat-ui)

const VOICE_CHUNK_MS = 30000; // 30 seconds per chunk

let _voiceStream   = null;
let _isRecording   = false;
let _chunkCount    = 0;
let _curRecorder   = null;
let _curChunkBlobs = [];
let _chunkTimer    = null;
let _totalTimer    = null;
let _totalSeconds  = 0;

// ── Preferred MIME type ───────────────────────────────────────────────────────
function _preferredMime() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return ''; // browser default
}

// ── Public: start recording ───────────────────────────────────────────────────
async function voiceStart() {
  if (_isRecording) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[voice] getUserMedia not supported');
    return;
  }

  try {
    _voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    console.warn('[voice] mic access denied:', e);
    _voiceShowError('Microphone access denied');
    return;
  }

  _isRecording  = true;
  _chunkCount   = 0;
  _totalSeconds = 0;

  // Show recording indicator, hide mic button
  const micBtn   = document.getElementById('mic-btn');
  const voiceInd = document.getElementById('voice-indicator');
  if (micBtn)   micBtn.style.display   = 'none';
  if (voiceInd) voiceInd.style.display = 'flex';

  // Tick the total-time counter every second
  _voiceUpdateTimer();
  _totalTimer = setInterval(_voiceUpdateTimer, 1000);

  _startChunk();
}

// ── Public: stop recording ────────────────────────────────────────────────────
function voiceStop() {
  if (!_isRecording) return;
  _isRecording = false;

  clearTimeout(_chunkTimer);
  clearInterval(_totalTimer);
  _chunkTimer   = null;
  _totalTimer   = null;

  // Stop current recorder — onstop will finalise the chunk without starting a new one
  if (_curRecorder?.state === 'recording') {
    _curRecorder.stop();
  }

  // Release microphone
  _voiceStream?.getTracks().forEach(t => t.stop());
  _voiceStream = null;

  // Restore UI
  const micBtn   = document.getElementById('mic-btn');
  const voiceInd = document.getElementById('voice-indicator');
  if (micBtn)   micBtn.style.display   = '';
  if (voiceInd) voiceInd.style.display = 'none';

  _voiceResetTimer();
}

// ── Internal: start one 30-second chunk ──────────────────────────────────────
function _startChunk() {
  _chunkCount++;
  _curChunkBlobs = [];

  const mime = _preferredMime();
  _curRecorder = new MediaRecorder(_voiceStream, mime ? { mimeType: mime } : {});

  _curRecorder.ondataavailable = e => {
    if (e.data.size > 0) _curChunkBlobs.push(e.data);
  };

  _curRecorder.onstop = async () => {
    const blob = new Blob(_curChunkBlobs, { type: _curRecorder.mimeType || 'audio/webm' });
    await _finaliseChunk(blob, _chunkCount);
    // If still recording, start the next chunk immediately
    if (_isRecording) _startChunk();
  };

  _curRecorder.start();

  // Auto-stop this chunk after VOICE_CHUNK_MS
  _chunkTimer = setTimeout(() => {
    if (_curRecorder?.state === 'recording') {
      _curRecorder.stop(); // triggers onstop → _finaliseChunk → _startChunk
    }
  }, VOICE_CHUNK_MS);
}

// ── Internal: base64-encode blob and push to attachment queue ─────────────────
function _finaliseChunk(blob, chunkNum) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl  = e.target.result;
      const base64   = dataUrl.split(',')[1];
      const mimeType = blob.type || 'audio/webm';
      const ext      = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('wav') ? 'wav' : 'webm';
      const name     = `voice_${String(chunkNum).padStart(3, '0')}.${ext}`;
      const note     = `[Voice recording: ${name}]`;

      if (typeof addAttachment === 'function') {
        addAttachment({ type: 'audio', name, content: base64, mimeType, note });
      }
      resolve();
    };
    reader.readAsDataURL(blob);
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function _voiceUpdateTimer() {
  _totalSeconds++;
  const el = document.getElementById('voice-timer');
  if (el) el.textContent = _voiceFmtTime(_totalSeconds);
}

function _voiceResetTimer() {
  _totalSeconds = 0;
  const el = document.getElementById('voice-timer');
  if (el) el.textContent = '0:00';
}

function _voiceFmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function _voiceShowError(msg) {
  // Re-use the companion toast if available, otherwise just log
  if (typeof cpShowToast === 'function') cpShowToast(msg);
  else console.warn('[voice]', msg);
}
