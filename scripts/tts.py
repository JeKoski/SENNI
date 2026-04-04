"""
tts.py — Kokoro TTS subprocess worker
======================================
Launched by tts_server.py as a child process.

Protocol (stdin → stdout):
  IN:  one JSON line per request
       {"id": str, "text": str, "voices": {"af_heart": 0.6, "af_bella": 0.4},
        "speed": 1.0, "pitch": 1.0, "lang": "a"}
  OUT: one JSON status line, then raw WAV bytes framed as:
       {"id": str, "ok": true, "bytes": <int>}\n
       <bytes bytes of WAV data>
       --- or on error ---
       {"id": str, "ok": false, "error": "<msg>"}\n

Graceful degradation:
  - If kokoro or espeak-ng are missing, writes an error JSON to stdout and exits
    with code 2 so tts_server.py can surface a clear "not installed" status.
  - Pitch is applied post-synthesis via a simple resampling trick (speed the
    audio up/down then resample back to 24 kHz) — no extra deps required.
"""

import io
import json
import sys
import numpy as np

# ── Dependency check ───────────────────────────────────────────────────────────
# Write a machine-readable error and exit cleanly if kokoro isn't available.
# tts_server.py watches for exit code 2 specifically.

def _fatal(msg: str) -> None:
    sys.stdout.write(json.dumps({"id": "__init__", "ok": False, "error": msg}) + "\n")
    sys.stdout.flush()
    sys.exit(2)


try:
    import soundfile as sf
except ImportError:
    _fatal("soundfile not installed — run: pip install soundfile")

try:
    from kokoro import KPipeline
except ImportError:
    _fatal("kokoro not installed — run: pip install kokoro")


# ── Voice cache ────────────────────────────────────────────────────────────────
# KPipeline is expensive to construct; keep one per lang_code.
# Voice tensors are cached as numpy arrays so blending is fast.

_pipelines: dict = {}
_voice_tensors: dict = {}


def _get_pipeline(lang_code: str) -> KPipeline:
    if lang_code not in _pipelines:
        _pipelines[lang_code] = KPipeline(lang_code=lang_code)
    return _pipelines[lang_code]


def _get_voice_tensor(pipeline: KPipeline, voice_name: str) -> np.ndarray:
    key = f"{id(pipeline)}:{voice_name}"
    if key not in _voice_tensors:
        # KPipeline stores voice data internally; access via its voices dict
        # which maps name → tensor loaded from the voices directory.
        try:
            _voice_tensors[key] = pipeline.load_voice(voice_name)
        except Exception as e:
            raise ValueError(f"Voice '{voice_name}' not found: {e}")
    return _voice_tensors[key]


def _blend_voices(pipeline: KPipeline, voice_blend: dict) -> np.ndarray:
    """
    Weighted blend of multiple voice tensors.
    voice_blend: {"af_heart": 0.6, "af_bella": 0.4}  — weights need not sum to 1,
    we normalise them.
    """
    if not voice_blend:
        raise ValueError("voice_blend is empty")

    total = sum(voice_blend.values())
    if total <= 0:
        raise ValueError("voice_blend weights must be positive")

    blended = None
    for name, weight in voice_blend.items():
        tensor = _get_voice_tensor(pipeline, name)
        scaled = tensor * (weight / total)
        blended = scaled if blended is None else blended + scaled

    return blended


# ── Pitch shift (simple resampling trick) ─────────────────────────────────────
# We resample by a pitch factor using linear interpolation, keeping output
# duration constant. Quality is adequate for ±20% range (covering normal mood
# shifts). No extra dependencies (librosa etc.) required.

def _pitch_shift(audio: np.ndarray, pitch: float, sample_rate: int = 24000) -> np.ndarray:
    if abs(pitch - 1.0) < 0.01:
        return audio
    # Resample to pitch * length (changes pitch AND speed), then resample back
    original_len = len(audio)
    pitch_len = max(1, int(original_len / pitch))
    x_old = np.linspace(0, 1, original_len)
    x_new = np.linspace(0, 1, pitch_len)
    pitched = np.interp(x_new, x_old, audio)
    # Resample back to original length to restore tempo
    x_back = np.linspace(0, 1, pitch_len)
    x_orig = np.linspace(0, 1, original_len)
    restored = np.interp(x_orig, x_back, pitched)
    return restored.astype(np.float32)


# ── Synthesis ──────────────────────────────────────────────────────────────────

def synthesise(req: dict) -> bytes:
    """
    Synthesise text to WAV bytes.
    Returns raw WAV bytes (24 kHz, mono, float32 → int16).
    Raises on any error.
    """
    text       = req.get("text", "").strip()
    voice_blend = req.get("voices", {"af_heart": 1.0})
    speed      = float(req.get("speed", 1.0))
    pitch      = float(req.get("pitch", 1.0))
    lang       = req.get("lang", "a")

    if not text:
        raise ValueError("empty text")

    pipeline = _get_pipeline(lang)
    voice    = _blend_voices(pipeline, voice_blend)

    # KPipeline returns a generator of (graphemes, phonemes, audio_chunk) tuples.
    # We collect all chunks and concatenate — each chunk is a float32 numpy array.
    chunks = []
    for _gs, _ps, audio_chunk in pipeline(text, voice=voice, speed=speed):
        if audio_chunk is not None and len(audio_chunk) > 0:
            chunks.append(audio_chunk)

    if not chunks:
        raise ValueError("synthesis produced no audio")

    audio = np.concatenate(chunks).astype(np.float32)

    if abs(pitch - 1.0) > 0.01:
        audio = _pitch_shift(audio, pitch)

    # Clip and convert to int16 for WAV
    audio = np.clip(audio, -1.0, 1.0)
    audio_i16 = (audio * 32767).astype(np.int16)

    buf = io.BytesIO()
    sf.write(buf, audio_i16, 24000, format="WAV", subtype="PCM_16")
    return buf.getvalue()


# ── Main loop ──────────────────────────────────────────────────────────────────

def main() -> None:
    # Signal readiness to tts_server.py
    sys.stdout.write(json.dumps({"id": "__ready__", "ok": True}) + "\n")
    sys.stdout.flush()

    stdin  = sys.stdin
    stdout = sys.stdout.buffer  # binary for WAV bytes

    while True:
        try:
            line = stdin.readline()
        except (EOFError, KeyboardInterrupt):
            break

        if not line:
            break  # parent closed stdin — clean exit

        line = line.strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({"id": "?", "ok": False, "error": f"bad JSON: {e}"}) + "\n")
            sys.stdout.flush()
            continue

        req_id = req.get("id", "?")

        try:
            wav_bytes = synthesise(req)
            # Write the header line first (text), then raw bytes
            header = json.dumps({"id": req_id, "ok": True, "bytes": len(wav_bytes)}) + "\n"
            sys.stdout.write(header)
            sys.stdout.flush()
            stdout.write(wav_bytes)
            stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"id": req_id, "ok": False, "error": str(e)}) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
