"""
memory_server.py — Memory system lifecycle + FastAPI router for /api/memory/*
=============================================================================
Mounted into server.py via:
    from scripts.memory_server import router as memory_router, kill_memory_server
    app.include_router(memory_router)

Architecture mirrors tts_server.py:
  - MemoryStore is instantiated lazily on first use (or at session start).
  - One store per active companion. Swapped out on companion switch.
  - Killed cleanly on bridge shutdown.
  - Consolidation runs at session end, on idle (20-min timer), and at startup
    if the previous session didn't consolidate cleanly.

Graceful degradation:
  - If chromadb is not installed, all endpoints return
    {"ok": false, "reason": "memory_unavailable"}.
  - If memory is disabled in config, endpoints return "memory_disabled".
  - No 500 errors — the UI and system prompt assembly check availability first.

LLM client:
  - consolidate_llm_pass() needs to call llama-server.
  - We use a thin _LlamaClient wrapper around the existing /v1/chat/completions
    endpoint that llama-server already exposes.
  - If llama-server is not running, the LLM pass is skipped and notes are
    queued for next consolidation (pending_llm_consolidation flag).
"""

import asyncio
import json
import logging
import threading
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

log = logging.getLogger("senni.memory")

router = APIRouter()

# ── Resolve paths ──────────────────────────────────────────────────────────────

_HERE = Path(__file__).parent          # scripts/
_ROOT = _HERE.parent                   # project root


# ── Store state ────────────────────────────────────────────────────────────────

_store = None                          # MemoryStore instance or None
_store_lock = threading.Lock()
_current_companion_id: Optional[str] = None
_memory_unavailable = False            # True if chromadb not installed
_memory_disabled = False               # True if disabled in config

# Idle consolidation timer
_idle_timer: Optional[threading.Timer] = None
_IDLE_CONSOLIDATION_MINUTES = 20


# ── Config helpers ─────────────────────────────────────────────────────────────

def _load_config() -> dict:
    try:
        from scripts.config import load_config
        return load_config()
    except Exception:
        return {}


def _load_companion_config(folder: str) -> dict:
    try:
        from scripts.config import load_companion_config
        return load_companion_config(folder)
    except Exception:
        return {}


def _companions_dir() -> Path:
    try:
        from scripts.config import COMPANIONS_DIR
        return COMPANIONS_DIR
    except Exception:
        return _ROOT / "companions"


def _is_memory_enabled(config: dict) -> bool:
    return config.get("memory", {}).get("enabled", True)


# ── Store lifecycle ────────────────────────────────────────────────────────────

def _get_stack(companion_cfg: dict) -> list[dict]:
    """
    Extract cognitive stack from companion config.
    Returns a neutral default (mT-fS-mN-fF) if not configured.
    """
    stack_cfg = companion_cfg.get("cognitive_stack", {})
    slots = stack_cfg.get("slots", [])
    if slots:
        return slots
    # Default neutral stack — analytical profile, reliable memory behaviour
    log.info("No cognitive_stack in companion config — using neutral default mT-fS-mN-fF")
    return [
        {"position": 1, "charge": "m", "function": "T", "polarity": None},
        {"position": 2, "charge": "f", "function": "S", "polarity": None},
        {"position": 3, "charge": "m", "function": "N", "polarity": None},
        {"position": 4, "charge": "f", "function": "F", "polarity": None},
    ]


def init_memory_store(companion_folder: str) -> bool:
    """
    Initialise (or swap) the MemoryStore for the given companion.
    Called at session start and on companion switch.

    Returns True if the store is available and ready.
    """
    global _store, _current_companion_id, _memory_unavailable, _memory_disabled

    config = _load_config()

    if not _is_memory_enabled(config):
        _memory_disabled = True
        log.info("Memory system disabled in config.")
        return False

    _memory_disabled = False

    companion_cfg = _load_companion_config(companion_folder)
    stack = _get_stack(companion_cfg)
    data_dir = _companions_dir() / companion_folder

    with _store_lock:
        # If same companion is already loaded, no-op
        if _current_companion_id == companion_folder and _store is not None:
            return _store.is_available()

        # Consolidate the old store before swapping
        if _store is not None and _current_companion_id != companion_folder:
            _run_consolidation_sync(reason="companion_switch")

        try:
            from scripts.memory_store import MemoryStore
            new_store = MemoryStore(
                companion_id=companion_folder,
                stack=stack,
                data_dir=data_dir,
            )
        except Exception as e:
            log.error(f"Failed to init MemoryStore: {e}")
            _memory_unavailable = True
            return False

        if not new_store.is_available():
            _memory_unavailable = True
            _store = None
            return False

        _memory_unavailable = False
        _store = new_store
        _current_companion_id = companion_folder

        # Check if previous session missed consolidation (crash recovery)
        last = _store.get_last_consolidated_at()
        if last is None and _store.count() > 0:
            log.info("Previous session missed consolidation — running recovery pass.")
            _run_consolidation_async(reason="startup_recovery")

        # Sync identity block from soul file
        _sync_identity_block(companion_folder)

        # Reset idle consolidation timer
        _reset_idle_timer()

    log.info(f"MemoryStore ready: '{companion_folder}' ({_store.count()} notes)")
    return True


def _sync_identity_block(companion_folder: str) -> None:
    """
    Read soul/companion_identity.md and sync it to the Tier 1 identity block.
    Called at session start so the identity block stays in sync with the
    human-editable file.
    """
    if _store is None:
        return
    identity_path = _companions_dir() / companion_folder / "soul" / "companion_identity.md"
    try:
        if identity_path.exists():
            content = identity_path.read_text(encoding="utf-8").strip()
            _store.update_identity_block(content)
    except Exception as e:
        log.warning(f"Could not sync identity block: {e}")


def kill_memory_server() -> None:
    """
    Cleanly shut down the memory system.
    Called from server.py on_shutdown and atexit.
    """
    global _store, _idle_timer

    _cancel_idle_timer()

    with _store_lock:
        if _store is not None:
            _run_consolidation_sync(reason="shutdown")
            _store = None
    log.info("Memory server shut down.")


# ── Consolidation ──────────────────────────────────────────────────────────────

def _run_consolidation_sync(reason: str = "unknown") -> None:
    """
    Run consolidation synchronously (blocking). Used at shutdown and
    companion switch where we need it to complete before proceeding.
    """
    if _store is None:
        return

    log.info(f"Consolidation starting (reason: {reason})")

    # Always run the embedding pass — no model needed, always safe
    try:
        links = _store.consolidate_embedding_pass()
        log.info(f"Embedding pass complete: {links} links added")
    except Exception as e:
        log.warning(f"Embedding consolidation error: {e}")

    # Attempt LLM pass if llama-server is reachable
    pending = _store.get_pending_llm_consolidation()
    if pending:
        client = _try_get_llm_client()
        if client:
            try:
                confirmed = _store.consolidate_llm_pass(client, pending)
                log.info(f"LLM pass complete: {confirmed} links confirmed")
            except Exception as e:
                log.warning(f"LLM consolidation error (will retry next session): {e}")
        else:
            log.info(
                f"llama-server not available — {len(pending)} notes queued for LLM pass next session"
            )

    _store.set_last_consolidated_at()


def _run_consolidation_async(reason: str = "idle") -> None:
    """
    Run consolidation in a background thread. Used for idle triggers
    and startup recovery where we don't want to block the event loop.
    """
    def _worker():
        with _store_lock:
            _run_consolidation_sync(reason=reason)

    t = threading.Thread(target=_worker, daemon=True, name="senni-consolidation")
    t.start()


# ── Idle timer ─────────────────────────────────────────────────────────────────

def _reset_idle_timer() -> None:
    """
    Reset the 20-minute idle consolidation timer.
    Called after every message is processed (via notify_message_activity())
    and on store init.
    """
    _cancel_idle_timer()
    global _idle_timer
    _idle_timer = threading.Timer(
        _IDLE_CONSOLIDATION_MINUTES * 60,
        _on_idle_timeout,
    )
    _idle_timer.daemon = True
    _idle_timer.start()


def _cancel_idle_timer() -> None:
    global _idle_timer
    if _idle_timer is not None:
        _idle_timer.cancel()
        _idle_timer = None


def _on_idle_timeout() -> None:
    """Fired by the idle timer after 20 minutes of no activity."""
    log.info("Idle consolidation triggered (20-min timer)")
    _run_consolidation_async(reason="idle")


def notify_message_activity() -> None:
    """
    Call this from server.py whenever a message is sent or received.
    Resets the idle consolidation timer so it only fires during genuine
    idle periods, not mid-conversation.
    """
    if _store is not None:
        _reset_idle_timer()


# ── LLM client ─────────────────────────────────────────────────────────────────

class _LlamaClient:
    """
    Thin wrapper around llama-server's /v1/chat/completions endpoint.
    Satisfies the llm_client interface expected by memory_store.consolidate_llm_pass():
        client.complete(prompt: str) -> str
    """

    def __init__(self, port: int):
        self.base_url = f"http://127.0.0.1:{port}"

    def complete(self, prompt: str) -> str:
        import urllib.request
        payload = json.dumps({
            "model": "local",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 256,
            "temperature": 0.0,    # deterministic for link evaluation
        }).encode("utf-8")

        req = urllib.request.Request(
            f"{self.base_url}/v1/chat/completions",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data["choices"][0]["message"]["content"].strip()
        except Exception as e:
            raise RuntimeError(f"llama-server request failed: {e}") from e


def _try_get_llm_client() -> Optional[_LlamaClient]:
    """
    Try to get a working LLM client. Returns None if llama-server is not
    reachable (so consolidation can gracefully skip the LLM pass).
    """
    try:
        config = _load_config()
        port = config.get("port_model", 8081)
        client = _LlamaClient(port=port)
        # Quick health check
        import urllib.request
        urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3)
        return client
    except Exception:
        return None


# ── Session start retrieval ────────────────────────────────────────────────────

def get_session_start_context(mood: Optional[str] = None, k: int = 6) -> str:
    """
    Called from server.py during system prompt assembly at session start.
    Returns a formatted string of retrieved memories + Tier 1 core blocks
    ready for injection into the system prompt.

    Returns empty string if memory is unavailable or store is empty.
    """
    if _store is None or not _store.is_available():
        return ""

    # Tier 1 core blocks (identity + relational state)
    core = _store.get_core_blocks()

    # Session-start episodic retrieval
    notes = _store.retrieve_session_start(mood=mood, k=k)
    episodic = _format_notes_for_prompt(notes, label="Recalled memories")

    parts = []
    if core:
        parts.append(core)
    if episodic:
        parts.append(episodic)

    return "\n\n".join(parts)


def _format_notes_for_prompt(notes: list[dict], label: str = "Memories") -> str:
    """Format a list of notes for injection into the system prompt."""
    if not notes:
        return ""

    lines = [f"## {label}"]
    for note in notes:
        composite = note.get("composite_label", "note")
        content = note.get("content", "").strip()
        valence = note.get("emotional_valence", 0.0)
        mood_written = note.get("mood_at_write", "")

        # Compact single-line format to keep token budget tight
        meta_parts = [composite]
        if mood_written:
            meta_parts.append(f"mood:{mood_written}")
        if abs(valence) > 0.3:
            meta_parts.append("positive" if valence > 0 else "negative")

        lines.append(f"- [{', '.join(meta_parts)}] {content}")

    return "\n".join(lines)


# ── Associative trigger (system-driven) ────────────────────────────────────────

def trigger_associative_retrieval(
    mood: Optional[str],
    valence: Optional[float],
    k: int = 3,
) -> list[dict]:
    """
    System-driven feminine-pathway retrieval.
    Called by server.py when a significant mood/topic shift is detected
    mid-conversation. Returns notes (not formatted) so server.py can
    decide how to inject them (tool result, system message, etc.).
    """
    if _store is None or not _store.is_available():
        return []
    return _store.retrieve_associative(mood=mood, valence=valence, k=k)


# ── API endpoints ──────────────────────────────────────────────────────────────

def _unavailable_response(reason: str = "memory_unavailable"):
    return JSONResponse({"ok": False, "reason": reason})


def _check_available():
    """Return an error response if memory isn't ready, or None if it is."""
    if _memory_unavailable:
        return _unavailable_response("memory_unavailable")
    if _memory_disabled:
        return _unavailable_response("memory_disabled")
    if _store is None:
        return _unavailable_response("memory_not_initialised")
    return None


@router.get("/api/memory/status")
async def api_memory_status():
    """
    Returns current memory system status.
    Used by the UI to show memory availability and note count.
    """
    if _memory_unavailable:
        return {"ok": False, "reason": "memory_unavailable", "available": False}
    if _memory_disabled:
        return {"ok": False, "reason": "memory_disabled", "available": False}
    if _store is None:
        return {"ok": False, "reason": "memory_not_initialised", "available": False}

    return {
        "ok": True,
        "available": True,
        "companion_id": _current_companion_id,
        "note_count": _store.count(),
        "stack_initialised": _store.is_stack_initialised(),
        "last_consolidated_at": _store.get_last_consolidated_at(),
        "pending_llm_consolidation": len(_store.get_pending_llm_consolidation()),
    }


@router.post("/api/memory/write")
async def api_memory_write(request: Request):
    """
    Write a memory note. Called by the write_memory tool handler in server.py.

    Body: {
        content: str,
        keywords: list[str],
        emotional_valence: float,   // -1.0 to 1.0
        intensity: float,           // 0.0 to 1.0
        context_summary: str,
        mood: str | null
    }
    """
    err = _check_available()
    if err:
        return err

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "reason": "invalid_json"}, status_code=400)

    content = body.get("content", "").strip()
    if not content:
        return JSONResponse({"ok": False, "reason": "content_required"}, status_code=400)

    keywords = body.get("keywords", [])
    valence = float(body.get("emotional_valence", 0.0))
    intensity = float(body.get("intensity", 0.5))
    context_summary = body.get("context_summary", content[:120]).strip()
    mood = body.get("mood") or None

    # Clamp to valid ranges
    valence = max(-1.0, min(1.0, valence))
    intensity = max(0.0, min(1.0, intensity))

    loop = asyncio.get_event_loop()
    note_id = await loop.run_in_executor(
        None,
        lambda: _store.write_note(
            content=content,
            keywords=keywords,
            emotional_valence=valence,
            intensity=intensity,
            context_summary=context_summary,
            mood=mood,
        )
    )

    if note_id.startswith("error:"):
        return JSONResponse({"ok": False, "reason": note_id}, status_code=500)

    return {"ok": True, "note_id": note_id}


@router.post("/api/memory/retrieve")
async def api_memory_retrieve(request: Request):
    """
    Direct (masculine-pathway) retrieval. Called by the retrieve_memory
    tool handler in server.py when the companion explicitly asks to recall.

    Body: { query: str, k: int }
    """
    err = _check_available()
    if err:
        return err

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "reason": "invalid_json"}, status_code=400)

    query = body.get("query", "").strip()
    k = int(body.get("k", 4))

    if not query:
        return JSONResponse({"ok": False, "reason": "query_required"}, status_code=400)

    loop = asyncio.get_event_loop()
    notes = await loop.run_in_executor(
        None,
        lambda: _store.retrieve_direct(query_text=query, k=k)
    )

    return {"ok": True, "notes": notes, "count": len(notes)}


@router.post("/api/memory/supersede")
async def api_memory_supersede(request: Request):
    """
    Supersede an existing note with updated content. Preserves history.

    Body: {
        old_id: str,
        content: str,
        keywords: list[str],
        emotional_valence: float,
        intensity: float,
        context_summary: str,
        mood: str | null
    }
    """
    err = _check_available()
    if err:
        return err

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "reason": "invalid_json"}, status_code=400)

    old_id = body.get("old_id", "").strip()
    content = body.get("content", "").strip()
    if not old_id or not content:
        return JSONResponse(
            {"ok": False, "reason": "old_id and content required"},
            status_code=400
        )

    loop = asyncio.get_event_loop()
    new_id = await loop.run_in_executor(
        None,
        lambda: _store.supersede_note(
            old_id=old_id,
            new_content=content,
            new_keywords=body.get("keywords", []),
            new_valence=float(body.get("emotional_valence", 0.0)),
            new_intensity=float(body.get("intensity", 0.5)),
            new_context_summary=body.get("context_summary", content[:120]),
            mood=body.get("mood") or None,
        )
    )

    return {"ok": True, "new_note_id": new_id, "superseded_id": old_id}


@router.post("/api/memory/relational-state")
async def api_update_relational_state(request: Request):
    """
    Update the Tier 1 relational state block. Called by the
    update_relational_state tool handler.

    Body: { state: str }
    """
    err = _check_available()
    if err:
        return err

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "reason": "invalid_json"}, status_code=400)

    state = body.get("state", "").strip()
    if not state:
        return JSONResponse({"ok": False, "reason": "state_required"}, status_code=400)

    _store.update_relational_state(state)
    return {"ok": True}


@router.get("/api/memory/note/{note_id}")
async def api_get_note(note_id: str):
    """
    Fetch a single note by ID. For debugging and the (future) memory browser UI.
    """
    err = _check_available()
    if err:
        return err

    note = _store.get_note(note_id)
    if note is None:
        return JSONResponse({"ok": False, "reason": "not_found"}, status_code=404)

    return {"ok": True, "note": note}


@router.post("/api/memory/consolidate")
async def api_consolidate(request: Request):
    """
    Manually trigger consolidation. For debugging and future UI controls.
    Runs async so it doesn't block the response.

    Body: { reason: str }  (optional)
    """
    err = _check_available()
    if err:
        return err

    try:
        body = await request.json()
        reason = body.get("reason", "manual")
    except Exception:
        reason = "manual"

    _run_consolidation_async(reason=reason)
    return {"ok": True, "message": f"Consolidation started (reason: {reason})"}


@router.post("/api/memory/init")
async def api_memory_init(request: Request):
    """
    Initialise or re-initialise the memory store for a companion.
    Called from server.py at session start and on companion switch.

    Body: { companion_folder: str, mood: str | null }
    """
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "reason": "invalid_json"}, status_code=400)

    companion_folder = body.get("companion_folder", "").strip()
    if not companion_folder:
        return JSONResponse(
            {"ok": False, "reason": "companion_folder required"},
            status_code=400
        )

    mood = body.get("mood") or None

    loop = asyncio.get_event_loop()
    available = await loop.run_in_executor(
        None,
        lambda: init_memory_store(companion_folder)
    )

    if not available:
        reason = "memory_disabled" if _memory_disabled else "memory_unavailable"
        return {"ok": False, "reason": reason, "available": False}

    # Get session-start context for system prompt injection
    context = await loop.run_in_executor(
        None,
        lambda: get_session_start_context(mood=mood)
    )

    return {
        "ok": True,
        "available": True,
        "note_count": _store.count() if _store else 0,
        "session_context": context,
    }


@router.post("/api/memory/associative")
async def api_memory_associative(request: Request):
    """
    System-driven feminine-pathway retrieval.
    Called mid-conversation when a topic/mood shift is detected.
    Body: { query, mood, valence, k }
    Returns: { ok, notes_text } where notes_text is ready to inject as a system turn.
    """
    err = _check_available()
    if err:
        return err

    body    = await request.json()
    mood    = body.get("mood") or None
    valence = body.get("valence")
    k       = int(body.get("k", 3))
    k       = max(1, min(10, k))

    if valence is not None:
        try:
            valence = float(valence)
        except (TypeError, ValueError):
            valence = None

    loop = asyncio.get_event_loop()
    notes = await loop.run_in_executor(
        None,
        lambda: trigger_associative_retrieval(mood=mood, valence=valence, k=k),
    )

    if not notes:
        return {"ok": True, "notes_text": "", "count": 0}

    text = _format_notes_for_prompt(notes, label="Surfaced memories")
    return {"ok": True, "notes_text": text, "count": len(notes)}
