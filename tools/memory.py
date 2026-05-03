"""
Tool: memory
Read, write, archive and move files across the companion's memory folders.

- soul/   — identity, personality, self-notes
- mind/   — current session notes, active tasks
- memory/ — long-term archived notes
- unbound mode: all restrictions lifted, files can move freely between folders
"""

import json
import os
import shutil
from pathlib import Path
from datetime import datetime

from scripts.paths import CONFIG_FILE, COMPANIONS_DIR, SOUL_FILE, REFLECTIONS_FILE

TOOL_NAME   = "memory"
DESCRIPTION = (
    "Read and write the companion's markdown files. "
    "soul/ = permanent reference (identity, user profile). "
    "mind/ = session notes and topic files, not loaded into active context automatically. "
    "Always write the complete file content."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["read", "write", "archive", "list", "move"],
            "description": "What to do. 'move' transfers a file between folders."
        },
        "folder": {
            "type": "string",
            "enum": ["soul", "mind", "memory"],
            "description": "Which memory folder to act on."
        },
        "filename": {
            "type":        "string",
            "description": "File name (e.g. 'session_notes.md'). Required for read/write/archive/move."
        },
        "content": {
            "type":        "string",
            "description": "Content to write. Required for 'write' action."
        },
        "dest_folder": {
            "type":        "string",
            "enum":        ["soul", "mind", "memory"],
            "description": "Destination folder for 'move' action."
        }
    },
    "required": ["action", "folder"]
}


def _companion_base() -> tuple:
    """Resolve the active companion's folder. Returns (base_path, folder_name)."""
    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        folder = config.get("companion_folder", "default")
    except Exception:
        folder = "default"
    return COMPANIONS_DIR / folder, folder


def _load_companion_cfg(companion_folder: str) -> dict:
    try:
        path = COMPANIONS_DIR / companion_folder / "config.json"
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _backup_soul_file(companion_folder: str, filename: str, source: Path) -> None:
    """Back up any soul/ file to _backups/ with a timestamp. The AI cannot see this folder."""
    if not source.exists():
        return
    backups_dir = COMPANIONS_DIR / companion_folder / "_backups"
    backups_dir.mkdir(parents=True, exist_ok=True)
    stamp  = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem   = filename.rsplit(".", 1)[0]
    ext    = "." + filename.rsplit(".", 1)[1] if "." in filename else ".md"
    backup = backups_dir / f"{stem}_{stamp}{ext}"
    backup.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def run(args: dict) -> str:
    action    = args.get("action", "").strip()
    folder    = args.get("folder", "").strip()
    filename  = args.get("filename", "").strip()
    content   = args.get("content", "")
    dest_folder = args.get("dest_folder", "").strip()

    companion_root, companion_folder = _companion_base()
    cfg       = _load_companion_cfg(companion_folder)
    # evolution_level is the current key; fall back to migrating soul_edit_mode for
    # any companion config that hasn't been re-saved through the UI yet.
    _legacy = {"locked": "settled", "self_notes": "reflective", "agentic": "adaptive", "chaos": "unbound"}
    soul_mode = cfg.get("evolution_level") or _legacy.get(cfg.get("soul_edit_mode", "locked"), "settled")
    chaos     = soul_mode == "unbound"

    base = companion_root / folder
    base.mkdir(parents=True, exist_ok=True)

    # ── list ──────────────────────────────────────────────────────────────────
    if action == "list":
        files = [f.name for f in base.iterdir() if f.suffix in (".md", ".txt")]
        return f"{folder}/: {', '.join(sorted(files))}" if files else f"{folder}/ is empty."

    # ── read ──────────────────────────────────────────────────────────────────
    if action == "read":
        if not filename:
            return "Error: filename required for read."
        target = base / filename
        if not target.exists():
            return f"Not found: {folder}/{filename}"
        return target.read_text(encoding="utf-8")

    # ── move ──────────────────────────────────────────────────────────────────
    if action == "move":
        if not chaos:
            return "Error: 'move' is only available in Unbound mode. Enable it in Settings → Companion."
        if not filename or not dest_folder:
            return "Error: filename and dest_folder required for move."
        src = companion_root / folder / filename
        if not src.exists():
            return f"Not found: {folder}/{filename}"
        dst_dir = companion_root / dest_folder
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / filename
        # Backup if moving out of soul/
        if folder == "soul":
            _backup_soul_file(companion_folder, filename, src)
        shutil.move(str(src), str(dst))
        return f"Moved {folder}/{filename} → {dest_folder}/{filename}"

    # ── write ─────────────────────────────────────────────────────────────────
    if action == "write":
        if not filename:
            return "Error: filename required for write."
        if not content:
            return "Error: content required for write."

        # Chaos mode: all writes allowed, soul/ files always backed up
        if chaos:
            target = base / filename
            if folder == "soul" and target.exists():
                _backup_soul_file(companion_folder, filename, target)
            target.write_text(content, encoding="utf-8")
            return f"Saved: {folder}/{filename}"

        # ── Normal / agentic / self_notes mode ────────────────────────────────
        if folder == "soul":
            if filename == "session_notes.md":
                return "Error: session_notes.md belongs in mind/, not soul/. Use folder='mind'."

            # Always back up any existing soul/ file before writing
            target = base / filename
            if target.exists():
                _backup_soul_file(companion_folder, filename, target)

            if filename == "user_profile.md":
                pass  # always writable — stores info about the user, not the companion's identity

            elif filename == SOUL_FILE:
                if soul_mode == "settled":
                    return f"Error: {SOUL_FILE} is read-only (Settled). The user edits this in Settings."
                if soul_mode == "reflective":
                    return f"Error: in Reflective mode, write to soul/{REFLECTIONS_FILE} instead."
                # adaptive / unbound: allowed, backup already done above

            elif filename == REFLECTIONS_FILE:
                if soul_mode == "settled":
                    return f"Error: soul/{REFLECTIONS_FILE} is disabled. Enable Reflective or higher mode in Settings."
                # reflective, adaptive, unbound: allowed

            else:
                # Any other soul/ file
                if soul_mode in ("settled", "reflective"):
                    return f"Error: soul/{filename} is read-only. Enable Adaptive or higher mode in Settings."
                # self_notes or agentic: allowed

            target.write_text(content, encoding="utf-8")
            return f"Saved: {folder}/{filename}"

        if folder == "memory" and not chaos:
            return "Error: memory/ is an archive. Use action='archive' to move files there, or enable Unbound mode."

        target = base / filename
        target.write_text(content, encoding="utf-8")
        return f"Saved: {folder}/{filename}"

    # ── archive ───────────────────────────────────────────────────────────────
    if action == "archive":
        if not filename:
            return "Error: filename required for archive."
        if folder != "mind" and not chaos:
            return "Error: can only archive from mind/. Enable Unbound mode to archive from other folders."
        src = base / filename
        if not src.exists():
            return f"Not found: {folder}/{filename}"
        dst_dir = companion_root / "memory"
        dst_dir.mkdir(parents=True, exist_ok=True)
        dated_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{filename}"
        shutil.move(str(src), str(dst_dir / dated_name))
        return f"Archived {folder}/{filename} → memory/{dated_name}"

    return f"Unknown action: {action}"
