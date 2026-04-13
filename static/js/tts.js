// tts.js — Kokoro TTS client
//
// Hooks into api.js via onTtsToken (set on load).
// Feeds streamed tokens into a sentence buffer, dispatches complete sentences
// to /api/tts/speak, and plays returned WAV chunks via Web Audio API in order.
//
// Graceful degradation:
//   - If TTS status returns unavailable/disabled, all operations are no-ops.
//   - No errors surfaced to chat UI — TTS failure is silent.
//
// Depends on: api.js (onTtsToken), companion.js (cpSettings for active voice blend)

// ── State ──────────────────────────────────────────────────────────────────────
let _ttsEnabled    = false;   // true only when server reports available + enabled
let _ttsVoices     = [];      // discovered voice names from server
let _ttsAbortCtrl  = null;    // AbortController for in-flight fetch
let _ttsPlaying    = false;   // true while a WAV chunk is playing
let _ttsQueue      = [];      // pending AudioBuffer queue
let _ttsAudioCtx   = null;    // Web Audio context (lazy init)
let _ttsSource     = null;    // currently playing AudioBufferSourceNode
let _ttsSentenceBuf = '';     // accumulates tokens until a sentence boundary

// Sentence-ending punctuation followed by whitespace or end-of-string.
//
// Negative lookbehind (?<!\d) prevents splitting on decimal points and
// version numbers: "7.8GB", "v1.4", "3.14" won't trigger a boundary.
// The pattern still matches "end." followed by a space or end-of-string.
//
// _TTS_MIN_CHARS: segments shorter than this are held in the buffer and
// prepended to the next segment rather than being dropped or dispatched
// alone. Keeps "I see." and "Sounds good." attached to what follows
// while still preventing lone punctuation tokens from going to TTS.
const _TTS_SENTENCE_RE = /(?<!\d)[.!?…]+(?:\s|$)/;
const _TTS_MIN_CHARS   = 10;

// ── Init ───────────────────────────────────────────────────────────────────────

async function ttsInit() {
  try {
    const res  = await fetch('/api/tts/status');
    const data = await res.json();
    _ttsEnabled = !!(data.ok && data.available);
    if (data.voices) _ttsVoices = data.voices;
  } catch {
    _ttsEnabled = false;
  }

  if (_ttsEnabled) {
    // Register token hook — api.js calls this for every streamed token
    onTtsToken = _ttsFeedToken;
  }
}

// Call after saving TTS settings so state reflects latest config
async function ttsReload() {
  // Reset unavailability flag so a fresh status check can re-enable
  _ttsEnabled = false;
  onTtsToken  = null;
  await ttsInit();
}

// ── Token feed & sentence detection ───────────────────────────────────────────

function _ttsFeedToken(token) {
  if (!_ttsEnabled) return;

  _ttsSentenceBuf += token;

  // Keep flushing as long as we find sentence boundaries
  while (true) {
    const match = _TTS_SENTENCE_RE.exec(_ttsSentenceBuf);
    if (!match) break;

    const endIdx  = match.index + match[0].length;
    const segment = _ttsSentenceBuf.slice(0, endIdx).trim();
    _ttsSentenceBuf = _ttsSentenceBuf.slice(endIdx);

    if (segment.length >= _TTS_MIN_CHARS) {
      // Long enough — dispatch immediately
      _ttsEnqueue(segment);
    } else {
      // Too short to speak alone — hold it by prepending back onto the
      // buffer so the next sentence boundary picks it up and joins them.
      // e.g. "I see. " + "That makes sense." → "I see. That makes sense."
      _ttsSentenceBuf = segment + ' ' + _ttsSentenceBuf;
      // Nothing more to flush from this boundary — wait for more tokens
      break;
    }
  }
}

function _ttsFlushBuffer() {
  // Called at end of generation — speak any remaining buffered text,
  // even if it didn't end with punctuation or meet the min length.
  const remainder = _ttsSentenceBuf.trim();
  _ttsSentenceBuf = '';
  if (_ttsEnabled && remainder.length >= 2) {
    _ttsEnqueue(remainder);
  }
}

// ── Fetch queue ────────────────────────────────────────────────────────────────
// We fetch sentences sequentially (not in parallel) to preserve order and
// avoid hammering the TTS process. Each fetch is awaited before the next starts.

let _ttsFetchQueue  = [];   // sentences waiting to be fetched
let _ttsFetching    = false;

function _ttsEnqueue(sentence) {
  _ttsFetchQueue.push(sentence);
  if (!_ttsFetching) _ttsDrainFetchQueue();
}

async function _ttsDrainFetchQueue() {
  if (_ttsFetching) return;
  _ttsFetching = true;

  while (_ttsFetchQueue.length > 0) {
    const sentence = _ttsFetchQueue.shift();
    await _ttsFetchAndQueue(sentence);
  }

  _ttsFetching = false;
}

async function _ttsFetchAndQueue(sentence) {
  if (!_ttsEnabled) return;

  // Get active voice blend from companion settings if available
  const voices = _ttsGetActiveVoices();
  const speed  = _ttsGetActiveSetting('speed', 1.0);
  const pitch  = _ttsGetActiveSetting('pitch', 1.0);

  _ttsAbortCtrl = new AbortController();

  try {
    const res = await fetch('/api/tts/speak', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  _ttsAbortCtrl.signal,
      body:    JSON.stringify({ text: sentence, voices, speed, pitch }),
    });

    if (!res.ok) return;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('audio')) return;  // error JSON — skip silently

    const arrayBuf = await res.arrayBuffer();
    if (!arrayBuf.byteLength) return;

    const audioCtx = _ttsGetAudioContext();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);

    _ttsQueue.push(audioBuf);
    if (!_ttsPlaying) _ttsPlayNext();

  } catch (e) {
    if (e.name !== 'AbortError') {
      console.warn('[tts] fetch error:', e.message);
    }
  }
}

// ── Playback ───────────────────────────────────────────────────────────────────

function _ttsGetAudioContext() {
  if (!_ttsAudioCtx || _ttsAudioCtx.state === 'closed') {
    _ttsAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browser autoplay policy)
  if (_ttsAudioCtx.state === 'suspended') {
    _ttsAudioCtx.resume();
  }
  return _ttsAudioCtx;
}

function _ttsPlayNext() {
  if (_ttsQueue.length === 0) {
    _ttsPlaying = false;
    _ttsSource  = null;
    return;
  }

  _ttsPlaying = true;
  const audioBuf = _ttsQueue.shift();
  const ctx      = _ttsGetAudioContext();
  const source   = ctx.createBufferSource();
  source.buffer  = audioBuf;
  source.connect(ctx.destination);
  source.onended = () => _ttsPlayNext();
  source.start();
  _ttsSource = source;
}

// ── Stop ───────────────────────────────────────────────────────────────────────
// Called when user stops generation, closes a tab, or sends a new message.

function ttsStop() {
  // Abort any in-flight fetch
  if (_ttsAbortCtrl) {
    _ttsAbortCtrl.abort();
    _ttsAbortCtrl = null;
  }

  // Stop current playback
  if (_ttsSource) {
    try { _ttsSource.stop(); } catch {}
    _ttsSource = null;
  }

  // Clear queues
  _ttsQueue      = [];
  _ttsFetchQueue = [];
  _ttsFetching   = false;
  _ttsPlaying    = false;
  _ttsSentenceBuf = '';
}

// Called at the start of each new generation to reset buffers
function ttsStartGeneration() {
  ttsStop();
}

// Called at the end of generation to flush any remaining buffer
function ttsEndGeneration() {
  _ttsFlushBuffer();
}

// ── Voice/setting helpers ──────────────────────────────────────────────────────

function _ttsGetActiveVoices() {
  // Mood TTS override — only applied when tts.enabled is explicitly true
  try {
    const moodName = (typeof config !== 'undefined') ? config.active_mood : null;
    if (moodName) {
      const moodTts = config?.moods?.[moodName]?.tts;
      if (moodTts?.enabled === true) {
        const blend = moodTts.voice_blend;
        if (blend && typeof blend === 'object' && Object.keys(blend).length > 0) {
          return blend;
        }
      }
    }
  } catch {}
  // Fall back to companion default voice blend
  try {
    const tts = cpSettings?.active_companion?.tts || {};
    const blend = tts.voice_blend;
    if (blend && typeof blend === 'object' && Object.keys(blend).length > 0) {
      return blend;
    }
  } catch {}
  return { 'af_heart': 1.0 };
}

function _ttsGetActiveSetting(key, fallback) {
  // Mood TTS override — only applied when tts.enabled is explicitly true
  try {
    const moodName = (typeof config !== 'undefined') ? config.active_mood : null;
    if (moodName) {
      const moodTts = config?.moods?.[moodName]?.tts;
      if (moodTts?.enabled === true) {
        const val = moodTts[key];
        if (val !== undefined && val !== null) return Number(val);
      }
    }
  } catch {}
  // Fall back to companion default setting
  try {
    const tts = cpSettings?.active_companion?.tts || {};
    const val = tts[key];
    if (val !== undefined && val !== null) return Number(val);
  } catch {}
  return fallback;
}

// ── Public API (called from companion-tts.js for preview) ─────────────────────

async function ttsPreview(text, voices, speed, pitch) {
  if (!text) return;
  const audioCtx = _ttsGetAudioContext();

  try {
    const res = await fetch('/api/tts/speak', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text, voices, speed, pitch }),
    });
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('audio')) return;

    const arrayBuf = await res.arrayBuffer();
    const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
    const source   = audioCtx.createBufferSource();
    source.buffer  = audioBuf;
    source.connect(audioCtx.destination);
    source.start();
  } catch (e) {
    console.warn('[tts] preview error:', e.message);
  }
}

// Returns available voices for UI population
function ttsGetVoices() { return _ttsVoices; }
function ttsIsEnabled() { return _ttsEnabled; }
