"""
tts_server.py — TTS process lifecycle + FastAPI router for /api/tts/*
======================================================================
Mounted into server.py via:
    from scripts.tts_server import router as tts_router
    app.include_router(tts_router)

Process model mirrors llama-server:
  - tts.py subprocess is started lazily on first /api/tts/speak request
    (or when TTS is enabled and the bridge starts up).
  - Kept alive between requests for fast response.
  - Restarted automatically if it crashes.
  - Killed cleanly on bridge shutdown.

Graceful degradation:
  - If tts.py exits with code 2 (dependency missing), _tts_unavailable is set
    and all endpoints return {"ok": false, "reason": "tts_unavailable"}.
  - If TTS is globally disabled in config, endpoints return "tts_disabled".
  - No 500 errors — the UI uses the reason string to show appropriate states.

Voice discovery:
  - Scans config["tts"]["voices_path"] for *.pt files (Kokoro voice tensors).
  - Falls back to scanning next to the tts.py script.
  - Returns sorted list of voice names (filename stems).
"""

import json
import logging
import os
import platform
import re
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import Response

log = logging.getLogger("senni.tts")

router = APIRouter()

# ── Resolve paths ──────────────────────────────────────────────────────────────

_HERE        = Path(__file__).parent          # scripts/
_TTS_SCRIPT  = _HERE / "tts.py"


# ── Process state ──────────────────────────────────────────────────────────────

_tts_process:     Optional[subprocess.Popen] = None
_tts_lock         = threading.Lock()
_tts_unavailable  = False   # True if kokoro/espeak not installed (exit code 2)
_tts_error_msg    = ""      # Human-readable reason for unavailability
_tts_ready        = False   # True once subprocess sent {"id":"__ready__","ok":true}

# Serialises stdin writes — only one request in-flight at a time.
_tts_request_lock = threading.Lock()


# ── Markdown / formatting stripper ────────────────────────────────────────────
# Strip markup that should not be spoken aloud.

_MD_RULES = [
    # Code blocks (``` ... ```) — skip entirely
    (re.compile(r"```[\s\S]*?```"),                   ""),
    # Inline code — skip entirely
    (re.compile(r"`[^`]+`"),                          ""),
    # Bold / italic / underline — keep inner text
    (re.compile(r"\*\*([^*]+)\*\*"),                  r"\1"),
    (re.compile(r"\*([^*]+)\*"),                       r"\1"),
    (re.compile(r"__([^_]+)__"),                       r"\1"),
    (re.compile(r"_([^_]+)_"),                         r"\1"),
    # Headers — keep text, drop # prefix
    (re.compile(r"^#{1,6}\s+", re.MULTILINE),         ""),
    # Links — keep link text, drop URL
    (re.compile(r"\[([^\]]+)\]\([^)]+\)"),            r"\1"),
    # Bullet / numbered list prefixes
    (re.compile(r"^\s*[-*+]\s+", re.MULTILINE),       ""),
    (re.compile(r"^\s*\d+\.\s+", re.MULTILINE),       ""),
    # Horizontal rules
    (re.compile(r"^[-*_]{3,}\s*$", re.MULTILINE),     ""),
    # Blockquotes
    (re.compile(r"^>\s?", re.MULTILINE),              ""),
    # Collapse multiple blank lines
    (re.compile(r"\n{3,}"),                           "\n\n"),
]


def strip_markdown(text: str) -> str:
    for pattern, replacement in _MD_RULES:
        text = pattern.sub(replacement, text)
    return text.strip()


# ── Voice discovery ────────────────────────────────────────────────────────────

def discover_voices(voices_path: str = "") -> list[str]:
    """
    Return sorted list of available voice names (stems of .pt files).
    Scans voices_path first, then falls back to a 'voices/' dir next to tts.py.
    """
    search_dirs = []
    if voices_path:
        search_dirs.append(Path(voices_path))
    # Standard Kokoro layout — voices/ sibling to scripts/
    search_dirs.append(_HERE.parent / "voices")
    search_dirs.append(_HERE / "voices")

    for d in search_dirs:
        if d.is_dir():
            names = sorted(p.stem for p in d.glob("*.pt"))
            if names:
                return names

    return []


# ── Process management ─────────────────────────────────────────────────────────

def _load_tts_config() -> dict:
    """Load TTS config from global config. Import lazily to avoid circular deps."""
    try:
        from scripts.config import load_config
        cfg = load_config()
        return cfg.get("tts", {})
    except Exception:
        return {}


def _resolve_python(tts_cfg: dict) -> str:
    """
    Resolve the Python executable that has kokoro installed.
    Priority:
      1. config["tts"]["python_path"] — explicit path set by user/Aurini
      2. Same Python that's running this process (sys.executable)
    """
    explicit = tts_cfg.get("python_path", "").strip()
    return explicit if explicit else sys.executable


def _start_tts_process() -> bool:
    """
    Start the tts.py subprocess. Returns True if started successfully.
    Must be called with _tts_lock held.
    """
    global _tts_process, _tts_unavailable, _tts_error_msg, _tts_ready

    if _tts_unavailable:
        return False

    tts_cfg  = _load_tts_config()
    python   = _resolve_python(tts_cfg)

    if not _TTS_SCRIPT.exists():
        _tts_unavailable = True
        _tts_error_msg   = f"tts.py not found at {_TTS_SCRIPT}"
        log.error(_tts_error_msg)
        return False

    log.info("Starting TTS subprocess: %s %s", python, _TTS_SCRIPT)

    try:
        proc = subprocess.Popen(
            [python, str(_TTS_SCRIPT)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0,          # unbuffered — critical for the protocol
            encoding=None,      # binary mode
        )
    except FileNotFoundError:
        _tts_unavailable = True
        _tts_error_msg   = f"Python executable not found: {python!r}"
        log.error(_tts_error_msg)
        return False

    _tts_process = proc
    _tts_ready   = False

    # Read the first line — either {"id":"__ready__","ok":true} or an error
    try:
        first_line = proc.stdout.readline().decode("utf-8", errors="replace").strip()
        msg = json.loads(first_line)

        if msg.get("id") == "__ready__" and msg.get("ok"):
            _tts_ready = True
            log.info("TTS subprocess ready (pid %d)", proc.pid)
            return True
        else:
            err = msg.get("error", "unknown startup error")
            _tts_unavailable = True
            _tts_error_msg   = err
            log.warning("TTS subprocess unavailable: %s", err)
            proc.kill()
            _tts_process = None
            return False

    except Exception as e:
        # Check exit code — 2 means dependency missing
        rc = proc.poll()
        if rc == 2:
            try:
                stderr_out = proc.stderr.read().decode("utf-8", errors="replace")
                _tts_error_msg = stderr_out.strip() or "kokoro or espeak-ng not installed"
            except Exception:
                _tts_error_msg = "kokoro or espeak-ng not installed"
            _tts_unavailable = True
            log.warning("TTS unavailable (exit 2): %s", _tts_error_msg)
        else:
            _tts_error_msg = f"TTS startup error: {e}"
            log.warning(_tts_error_msg)
        _tts_process = None
        return False


def _ensure_tts_running() -> bool:
    """
    Ensure the TTS subprocess is running. Starts it if needed.
    Returns False if TTS is unavailable or cannot be started.
    """
    global _tts_process

    if _tts_unavailable:
        return False

    with _tts_lock:
        # Already alive
        if _tts_process is not None and _tts_process.poll() is None and _tts_ready:
            return True

        # Dead or never started — (re)launch
        if _tts_process is not None:
            log.warning("TTS subprocess died (rc=%s), restarting…", _tts_process.poll())
            _tts_process = None

        return _start_tts_process()


def kill_tts_server() -> None:
    """Kill the TTS subprocess. Called from server.py on_shutdown and atexit."""
    global _tts_process, _tts_ready
    with _tts_lock:
        proc = _tts_process
        if proc is not None:
            log.info("Killing TTS subprocess (pid %d)…", proc.pid)
            try:
                proc.kill()
                proc.wait(timeout=3)
            except Exception as e:
                log.warning("Error killing TTS process: %s", e)
        _tts_process = None
        _tts_ready   = False


# ── Synthesis request ──────────────────────────────────────────────────────────

def _synthesise_blocking(text: str, voices: dict, speed: float,
                          pitch: float, lang: str) -> bytes:
    """
    Send a synthesis request to the subprocess and return WAV bytes.
    Blocks until complete. Raises on any error.
    Must only be called while _tts_request_lock is held.
    """
    proc = _tts_process
    if proc is None or proc.poll() is not None:
        raise RuntimeError("TTS subprocess not running")

    req_id  = uuid.uuid4().hex[:8]
    request = json.dumps({
        "id":     req_id,
        "text":   text,
        "voices": voices,
        "speed":  speed,
        "pitch":  pitch,
        "lang":   lang,
    }) + "\n"

    proc.stdin.write(request.encode("utf-8"))
    proc.stdin.flush()

    # Read header line
    header_line = proc.stdout.readline().decode("utf-8", errors="replace").strip()
    if not header_line:
        raise RuntimeError("TTS subprocess closed stdout unexpectedly")

    log.debug("Raw TTS header line: %r", header_line)
    try:
        header = json.loads(header_line)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"TTS synthesis header parse failed: {e}; raw header line: {header_line!r}") from e

    if header.get("id") != req_id:
        raise RuntimeError(f"TTS response ID mismatch: expected {req_id}, got {header.get('id')}")

    if not header.get("ok"):
        raise RuntimeError(header.get("error", "synthesis failed"))

    byte_count = int(header["bytes"])
    wav_bytes  = b""
    remaining  = byte_count
    while remaining > 0:
        chunk = proc.stdout.read(min(remaining, 65536))
        if not chunk:
            raise RuntimeError("TTS subprocess closed mid-stream")
        wav_bytes += chunk
        remaining -= len(chunk)

    return wav_bytes


# ── API endpoints ──────────────────────────────────────────────────────────────

@router.get("/api/tts/status")
async def api_tts_status():
    """
    Returns TTS availability and current config.
    Called by the frontend on load and after settings changes.
    """
    tts_cfg = _load_tts_config()
    enabled = tts_cfg.get("enabled", False)

    if not enabled:
        return {"ok": True, "available": False, "reason": "tts_disabled"}

    if _tts_unavailable:
        return {"ok": True, "available": False, "reason": "tts_unavailable",
                "error": _tts_error_msg}

    # Check/start the process on status poll if enabled
    running = _ensure_tts_running()
    voices  = discover_voices(tts_cfg.get("voices_path", ""))

    return {
        "ok":        True,
        "available": running,
        "reason":    None if running else "tts_not_started",
        "voices":    voices,
        "config":    tts_cfg,
    }


@router.post("/api/tts/start")
async def api_tts_start():
    """Explicitly start the TTS subprocess (e.g. after enabling in settings)."""
    tts_cfg = _load_tts_config()
    if not tts_cfg.get("enabled", False):
        return {"ok": False, "reason": "tts_disabled"}

    if _tts_unavailable:
        return {"ok": False, "reason": "tts_unavailable", "error": _tts_error_msg}

    success = _ensure_tts_running()
    return {"ok": success, "reason": None if success else _tts_error_msg}


@router.post("/api/tts/stop")
async def api_tts_stop():
    """Stop the TTS subprocess without disabling TTS in config."""
    kill_tts_server()
    return {"ok": True}


@router.get("/api/tts/voices")
async def api_tts_voices():
    """Return list of discovered voice names."""
    tts_cfg = _load_tts_config()
    voices  = discover_voices(tts_cfg.get("voices_path", ""))
    return {"ok": True, "voices": voices}


@router.post("/api/tts/speak")
async def api_tts_speak(request: Request):
    """
    Synthesise text to audio and return as audio/wav.

    Body:
      {
        "text":   string,            — raw text, markdown will be stripped
        "voices": {"af_heart": 0.6}, — voice blend (1–5 voices, weights normalised)
        "speed":  1.0,
        "pitch":  1.0,
        "lang":   "a"                — "a" = American English, "b" = British, etc.
      }

    Returns:
      200 audio/wav  — on success
      200 application/json {"ok": false, "reason": "..."} — on unavailability
      200 application/json {"ok": false, "error": "..."}  — on synthesis error
    """
    tts_cfg = _load_tts_config()

    if not tts_cfg.get("enabled", False):
        return {"ok": False, "reason": "tts_disabled"}

    if _tts_unavailable:
        return {"ok": False, "reason": "tts_unavailable", "error": _tts_error_msg}

    if not _ensure_tts_running():
        return {"ok": False, "reason": "tts_not_running"}

    body = await request.json()

    raw_text = body.get("text", "").strip()
    if not raw_text:
        return {"ok": False, "error": "empty text"}

    text   = strip_markdown(raw_text)
    if not text:
        return {"ok": False, "error": "no speakable text after stripping"}

    voices = body.get("voices", tts_cfg.get("voice_blend", {"af_heart": 1.0}))
    speed  = float(body.get("speed", tts_cfg.get("speed", 1.0)))
    pitch  = float(body.get("pitch", tts_cfg.get("pitch", 1.0)))
    lang   = body.get("lang", tts_cfg.get("lang", "a"))

    try:
        with _tts_request_lock:
            wav_bytes = _synthesise_blocking(text, voices, speed, pitch, lang)
    except Exception as e:
        log.warning("TTS synthesis error: %s", e)
        # Process may have died — clear it so next request restarts it
        global _tts_process, _tts_ready
        with _tts_lock:
            if _tts_process and _tts_process.poll() is not None:
                _tts_process = None
                _tts_ready   = False
        return {"ok": False, "error": str(e)}

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={"Cache-Control": "no-cache"},
    )


@router.post("/api/tts/preview")
async def api_tts_preview(request: Request):
    """
    Like /speak but takes a voice_blend directly for UI preview.
    Used by the companion settings voice blend UI.
    """
    return await api_tts_speak(request)
