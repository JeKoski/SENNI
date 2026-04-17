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

    # Pre-warm the embedding model in the background so it's ready before
    # the first write_memory or retrieve_memory tool call.
    _prewarm_embedding_model()

    # Background pipeline: ingest unconsolidated session history + index mind files.
    # Both run in daemon threads so they never block session start.
    _run_session_ingestion_async(companion_folder)
    _run_mind_indexing_async(companion_folder)

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


def _run_session_ingestion_async(companion_folder: str) -> None:
    """Launch _process_unconsolidated_sessions in a background daemon thread."""
    def _worker():
        try:
            _process_unconsolidated_sessions(companion_folder)
        except Exception as e:
            log.warning(f"Session ingestion thread error: {e}")
    t = threading.Thread(target=_worker, daemon=True, name="senni-session-ingest")
    t.start()


def _run_mind_indexing_async(companion_folder: str) -> None:
    """Launch _index_mind_files in a background daemon thread."""
    def _worker():
        try:
            _index_mind_files(companion_folder)
        except Exception as e:
            log.warning(f"Mind indexing thread error: {e}")
    t = threading.Thread(target=_worker, daemon=True, name="senni-mind-index")
    t.start()


def _process_unconsolidated_sessions(companion_folder: str) -> None:
    """
    Scan history/ for sessions with consolidated=false and ingest their
    assistant message text into ChromaDB as system notes.

    Session folder structure:
        companions/<folder>/history/<tab-id>/<YYYY-MM-DD_HHMMSS>/session.json

    session.json shape (relevant fields):
        {
            "consolidated": false,
            "history": [
                {"role": "user",      "content": "..."},
                {"role": "assistant", "content": "..."},
                ...
            ]
        }

    assistant content may be a string or a list of content blocks. We extract
    only plain text, stripping tool call XML and thinking blocks — those are
    plumbing, not memories.

    Each assistant turn is written as a single system note. Sessions already in
    session_history_index are skipped. On completion the session.json is updated
    with consolidated=true and the path is added to the index.
    """
    import re

    if _store is None or not _store.is_available():
        return

    history_root = _companions_dir() / companion_folder / "history"
    if not history_root.exists():
        return

    already_done: list = _store._meta.get("session_history_index", [])

    # Collect all session.json paths we haven't processed yet
    candidates = []
    for session_file in sorted(history_root.rglob("session.json")):
        rel = str(session_file)
        if rel not in already_done:
            candidates.append(session_file)

    if not candidates:
        log.debug("session ingestion: nothing new to process")
        return

    log.info(f"session ingestion: processing {len(candidates)} unprocessed session(s)")

    def _extract_assistant_text(content) -> str:
        """
        Extract clean reply text from an assistant message's content field.
        content may be a plain string or a list of blocks (OpenAI-style).
        Strips <think>...</think> blocks and <tool_call>...</tool_call> blocks.
        """
        if isinstance(content, str):
            raw = content
        elif isinstance(content, list):
            # Concatenate text-type blocks; ignore image/tool blocks
            parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif isinstance(block, str):
                    parts.append(block)
            raw = "\n".join(parts)
        else:
            return ""

        # Strip thinking blocks (Qwen3 / DeepSeek style)
        raw = re.sub(r"<think>[\s\S]*?</think>", "", raw, flags=re.IGNORECASE)
        # Strip tool call blocks
        raw = re.sub(r"<tool_call>[\s\S]*?</tool_call>", "", raw, flags=re.IGNORECASE)
        raw = re.sub(r"<tool_response>[\s\S]*?</tool_response>", "", raw, flags=re.IGNORECASE)
        # Collapse whitespace
        raw = re.sub(r"\n{3,}", "\n\n", raw).strip()
        return raw

    newly_done = []
    for session_file in candidates:
        try:
            data = json.loads(session_file.read_text(encoding="utf-8"))
        except Exception as e:
            log.warning(f"session ingestion: could not read {session_file}: {e}")
            continue

        history = data.get("history", [])
        ingested = 0
        for msg in history:
            if msg.get("role") != "assistant":
                continue
            text = _extract_assistant_text(msg.get("content", ""))
            # Skip very short turns — unlikely to be meaningful memories
            if len(text) < 60:
                continue
            # Chunk long turns so no single note is bloated
            # (~800 chars ≈ ~200 tokens — comfortable note size)
            chunks = [text[i:i+800] for i in range(0, len(text), 800)]
            for chunk in chunks:
                _store.write_system_note(chunk, source_label="session_history")
                ingested += 1

        # Mark consolidated in the session file
        try:
            data["consolidated"] = True
            session_file.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
        except Exception as e:
            log.warning(f"session ingestion: could not mark consolidated on {session_file}: {e}")

        newly_done.append(str(session_file))
        log.debug(f"session ingestion: {session_file.parent.name} → {ingested} note(s)")

    if newly_done:
        _store._meta["session_history_index"] = already_done + newly_done
        _store._save_meta()
        log.info(f"session ingestion: done — {len(newly_done)} session(s), meta saved")


def _index_mind_files(companion_folder: str) -> None:
    """
    Scan mind/ for .md files and write new or changed ones into ChromaDB as
    system notes, so mind content is searchable via episodic retrieval.

    Change detection uses sha256 hashes stored in memory_meta.json under
    mind_file_index: { "filename.md": "sha256hex", ... }.

    Files are chunked at ~800 chars so no note is bloated.
    If a file has changed since last index, the old notes are NOT superseded
    (we don't track which notes came from which file at that granularity) —
    instead the new content is written fresh. This is acceptable: mind files
    are scratchpads and the old notes will decay naturally.
    """
    import hashlib

    if _store is None or not _store.is_available():
        return

    mind_dir = _companions_dir() / companion_folder / "mind"
    if not mind_dir.exists():
        log.debug("mind indexing: no mind/ directory found, skipping")
        return

    mind_files = sorted(mind_dir.glob("*.md"))
    if not mind_files:
        log.debug("mind indexing: no .md files in mind/")
        return

    current_index: dict = _store._meta.get("mind_file_index", {})
    updated_index = dict(current_index)
    any_changes = False

    for md_file in mind_files:
        try:
            content = md_file.read_text(encoding="utf-8").strip()
        except Exception as e:
            log.warning(f"mind indexing: could not read {md_file.name}: {e}")
            continue

        if not content:
            continue

        file_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        if current_index.get(md_file.name) == file_hash:
            log.debug(f"mind indexing: {md_file.name} unchanged, skipping")
            continue

        # New or changed — write chunked notes
        chunks = [content[i:i+800] for i in range(0, len(content), 800)]
        written = 0
        for chunk in chunks:
            _store.write_system_note(chunk, source_label="system")
            written += 1

        updated_index[md_file.name] = file_hash
        any_changes = True
        log.debug(f"mind indexing: {md_file.name} → {written} note(s) written")

    if any_changes:
        _store._meta["mind_file_index"] = updated_index
        _store._save_meta()
        log.info(f"mind indexing: done — {sum(1 for k in updated_index if current_index.get(k) != updated_index[k])} file(s) updated")
    else:
        log.debug("mind indexing: all files up to date")


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


def _prewarm_embedding_model() -> None:
    """
    Force the sentence-transformers embedding model to download and load
    in a background thread at session start.

    ChromaDB's DefaultEmbeddingFunction downloads all-MiniLM-L6-v2 lazily
    on the first actual embed call — which would otherwise happen mid-
    conversation on the first write_memory or retrieve_memory tool call,
    causing a 30-60s+ stall that trips the tool's HTTP timeout.

    We trigger a dummy embed here so the download happens quietly in the
    background while the user is loading the UI, not while they're talking.
    """
    def _worker():
        try:
            if _store is None or not _store.is_available():
                return
            log.info("Pre-warming embedding model (all-MiniLM-L6-v2)...")
            _store.prewarm_embeddings()
            log.info("Embedding model warm and ready.")
        except Exception as e:
            log.warning(f"Embedding pre-warm failed (non-fatal): {e}")

    t = threading.Thread(target=_worker, daemon=True, name="senni-embed-prewarm")
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
            # System + user split gives models like Gemma 4 proper conversational
            # context. A single user message containing "reply with ONLY a JSON
            # array" causes Gemma 4 to produce empty content (it treats it as a
            # structured/tool output task). The system message anchors the role;
            # the user message asks the actual question.
            "messages": [
                {
                    "role": "system",
                    "content": "You are a helpful assistant. Answer questions concisely and accurately."
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "max_tokens": 256,
            "temperature": 0.0,    # deterministic for link evaluation
            # Suppress Qwen3 thinking blocks — ignored by other models
            "thinking": {"type": "disabled"},
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
                msg = data["choices"][0]["message"]
                # Prefer content; fall back to reasoning_content in case a
                # thinking model puts its answer there instead
                content = (msg.get("content") or "").strip()
                if not content:
                    content = (msg.get("reasoning_content") or "").strip()
                return content
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


@router.post("/api/memory/dedup")
async def api_memory_dedup(request: Request, dry_run: bool = True):
    """
    Remove duplicate memory notes by exact content match.

    Targets session_history ingestion duplicates caused by the session-id
    bug (now fixed). Groups all notes by content, keeps the oldest
    non-superseded note per group, deletes the rest.

    Preferred: query param  POST /api/memory/dedup?dry_run=false
    Also accepts JSON body:  { "dry_run": false }

    dry_run defaults to True (safe) — pass dry_run=false to actually delete.
    Returns: { checked, groups, duplicates, deleted }
    """
    err = _check_available()
    if err:
        return err

    # JSON body overrides query param if present and parseable
    try:
        body = await request.json()
        dry_run = bool(body.get("dry_run", dry_run))
    except Exception:
        pass  # no body or invalid JSON — use query param value

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None, lambda: _store.dedup_notes(dry_run=dry_run)
    )
    return result


@router.post("/api/memory/reindex")
async def api_memory_reindex(request: Request):
    """
    Re-run embedding + LLM link passes across ALL existing notes.

    Use this to recover from a broken consolidation history — e.g. after
    fixing the link eval parse bug, existing notes that went through the
    broken LLM pass will have had their links silently wiped. Reindex
    re-queues every non-superseded note and runs a fresh consolidation.

    Safe to run multiple times — embedding pass deduplicates links and
    the pending list is rebuilt from scratch each call.

    Body: {} (no params needed)
    Returns: { ok, queued, message }
    """
    err = _check_available()
    if err:
        return err

    def _do_reindex():
        if _store is None or not _store.is_available():
            return 0

        # Fetch all non-superseded note IDs from ChromaDB
        try:
            result = _store._collection.get(
                where={"superseded_by": {"$eq": ""}},
                include=[],   # IDs only — no need to fetch metadata
            )
            all_ids = result.get("ids", [])
        except Exception as e:
            log.warning(f"reindex: could not fetch note IDs: {e}")
            return 0

        if not all_ids:
            log.info("reindex: no notes to reindex")
            return 0

        # Replace pending list with all note IDs — deduplicated
        _store._meta["pending_llm_consolidation"] = list(set(all_ids))
        _store._save_meta()

        log.info(f"reindex: queued {len(all_ids)} notes for consolidation")

        # Run the full consolidation pass (embedding + LLM) synchronously
        # so this endpoint can report meaningful results
        _run_consolidation_sync(reason="reindex")
        return len(all_ids)

    loop = asyncio.get_event_loop()
    queued = await loop.run_in_executor(None, _do_reindex)

    return {
        "ok": True,
        "queued": queued,
        "message": f"Reindexed {queued} notes. Check logs for link counts.",
    }


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

    # Per-companion session_start_k takes precedence over global config
    companion_mem  = _load_companion_config(companion_folder).get("memory", {})
    global_mem     = _load_config().get("memory", {})
    session_k      = companion_mem.get("session_start_k") or global_mem.get("session_start_k", 6)

    # Get session-start context for system prompt injection
    context = await loop.run_in_executor(
        None,
        lambda: get_session_start_context(mood=mood, k=session_k)
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
