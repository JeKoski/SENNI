"""
history_router.py - Persistent chat history API

Extracted from server.py to keep history/session persistence concerns in one
place while preserving the existing HTTP contract used by chat-tabs.js.
"""

import base64
import json
import logging
import mimetypes
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse

from scripts.config import COMPANIONS_DIR, DEFAULTS, sanitize_folder

log = logging.getLogger(__name__)

router = APIRouter()


def _history_dir(companion_folder: str, tab_id: str) -> Path:
    return COMPANIONS_DIR / sanitize_folder(companion_folder) / "history" / _sanitise_tab_id(tab_id)


def _session_ts() -> str:
    """Timestamp string used as session folder name."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M%S")


def _sanitise_tab_id(tab_id: str) -> str:
    """Allow only alphanumeric + hyphen/underscore to prevent path traversal."""
    return re.sub(r"[^a-zA-Z0-9_\-]", "", tab_id)[:64]


@router.post("/api/history/save")
async def api_history_save(request: Request):
    """Save the current session for a tab."""
    body = await request.json()
    comp_folder = body.get("companion_folder") or DEFAULTS["companion_folder"]
    tab_id = _sanitise_tab_id(body.get("tab_id", ""))
    session_id = body.get("session_id", _session_ts())
    title = body.get("title", "New chat")
    tokens = int(body.get("tokens", 0))
    vision_mode = body.get("vision_mode", None)
    messages = body.get("messages", [])
    history = body.get("history", [])
    images = body.get("images", [])

    if not tab_id:
        return {"ok": False, "error": "tab_id required"}

    tab_dir = _history_dir(comp_folder, tab_id)
    session_dir = tab_dir / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    written_images = []
    for img in images:
        name = re.sub(r"[^a-zA-Z0-9_\-.]", "_", img.get("name", "img"))[:80]
        data_url = img.get("data_url", "")
        if not data_url.startswith("data:"):
            continue
        try:
            _header, b64 = data_url.split(",", 1)
            raw = base64.b64decode(b64)
            dest = session_dir / name
            dest.write_bytes(raw)
            written_images.append(name)
        except Exception as e:
            log.warning("Failed to write image %s: %s", name, e)

    session_payload = {
        "session_id": session_id,
        "started_at": body.get("started_at", datetime.now(timezone.utc).isoformat()),
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "consolidated": False,
        "messages": messages,
        "history": history,
    }
    (session_dir / "session.json").write_text(
        json.dumps(session_payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    meta_path = tab_dir / "meta.json"
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    except Exception:
        meta = {}

    preview = body.get("preview", "")
    meta.update({
        "tab_id": tab_id,
        "title": title,
        "tokens": tokens,
        "vision_mode": vision_mode,
        "preview": preview,
        "last_saved": datetime.now(timezone.utc).isoformat(),
        "latest_session": session_id,
    })
    if "created" not in meta:
        meta["created"] = meta["last_saved"]

    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"ok": True, "session_id": session_id, "images_written": written_images}


@router.post("/api/history/load")
async def api_history_load(request: Request):
    """Load the latest session for a tab."""
    body = await request.json()
    comp_folder = body.get("companion_folder") or DEFAULTS["companion_folder"]
    tab_id = _sanitise_tab_id(body.get("tab_id", ""))

    if not tab_id:
        return {"ok": False, "error": "tab_id required"}

    tab_dir = _history_dir(comp_folder, tab_id)
    meta_path = tab_dir / "meta.json"

    if not meta_path.exists():
        return {"ok": False, "reason": "not_found"}

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return {"ok": False, "reason": "meta_corrupt"}

    latest = meta.get("latest_session")
    if not latest:
        return {"ok": True, "meta": meta, "session": None}

    session_path = tab_dir / latest / "session.json"
    if not session_path.exists():
        return {"ok": True, "meta": meta, "session": None}

    try:
        session = json.loads(session_path.read_text(encoding="utf-8"))
    except Exception:
        return {"ok": False, "reason": "session_corrupt"}

    return {"ok": True, "meta": meta, "session": session}


@router.get("/api/history/list")
async def api_history_list(companion_folder: str = ""):
    """List all tabs for a companion, returning their meta.json contents."""
    companion_folder = companion_folder or DEFAULTS["companion_folder"]
    history_root = COMPANIONS_DIR / companion_folder / "history"
    if not history_root.exists():
        return {"ok": True, "tabs": []}

    tabs = []
    for tab_dir in sorted(history_root.iterdir()):
        if not tab_dir.is_dir():
            continue
        meta_path = tab_dir / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            tabs.append(meta)
        except Exception:
            continue

    tabs.sort(key=lambda t: t.get("last_saved", ""), reverse=True)
    return {"ok": True, "tabs": tabs}


@router.delete("/api/history/{companion_folder}/{tab_id}")
async def api_history_delete(companion_folder: str, tab_id: str):
    """Delete all history for a tab (called when user closes a tab)."""
    tab_id = _sanitise_tab_id(tab_id)
    tab_dir = _history_dir(companion_folder, tab_id)
    if tab_dir.exists():
        try:
            shutil.rmtree(str(tab_dir))
        except Exception as e:
            return {"ok": False, "error": str(e)}
    return {"ok": True}


@router.get("/api/history/media/{companion_folder}/{tab_id}/{session_id}/{filename}")
async def api_history_media(
    companion_folder: str, tab_id: str, session_id: str, filename: str
):
    """Serve a media file (image etc.) from a session folder."""
    tab_id = _sanitise_tab_id(tab_id)
    session_id = _sanitise_tab_id(session_id)
    filename = re.sub(r"[^a-zA-Z0-9_\-.]", "_", filename)[:80]
    path = _history_dir(companion_folder, tab_id) / session_id / filename
    if not path.exists():
        return Response(status_code=404)
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(str(path), media_type=mime)
