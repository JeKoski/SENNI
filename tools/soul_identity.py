"""
soul_identity.py — Read and write the companion's core identity file (soul/soul.md).

Available at Adaptive and Unbound evolution levels. At Unbound level, also grants
access to soul/unbound.md (the companion's personal directive file).

Replaces the generic memory tool's soul/soul.md write path for all evolution levels.
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from scripts.paths import CONFIG_FILE, COMPANIONS_DIR, SOUL_FILE, UNBOUND_FILE

log = logging.getLogger(__name__)

TOOL_NAME   = "soul_identity"
DESCRIPTION = (
    "Read or write your core identity file (soul/soul.md). "
    "Available at Adaptive and Unbound levels. "
    "At Unbound level, also lets you read/write your personal directive (soul/unbound.md). "
    "Always write the complete file content — full rewrite every time."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["read", "write"],
            "description": "Whether to read or write the file."
        },
        "content": {
            "type": "string",
            "description": "Full file content to write. Required for 'write' action."
        },
        "file": {
            "type": "string",
            "enum": ["soul", "unbound"],
            "description": "Which file to act on: 'soul' (soul.md, default) or 'unbound' (unbound.md, Unbound level only)."
        }
    },
    "required": ["action"]
}


def _companion_base() -> tuple:
    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        folder = config.get("companion_folder", "default")
    except Exception:
        folder = "default"
    return COMPANIONS_DIR / folder / "soul", folder


def _evolution_level(folder: str) -> str:
    _legacy = {"locked": "settled", "self_notes": "reflective", "agentic": "adaptive", "chaos": "unbound"}
    try:
        cfg = json.loads((COMPANIONS_DIR / folder / "config.json").read_text(encoding="utf-8"))
        return cfg.get("evolution_level") or _legacy.get(cfg.get("soul_edit_mode", "locked"), "settled")
    except Exception:
        return "settled"


def _backup(soul_dir: Path, filename: str) -> None:
    source = soul_dir / filename
    if not source.exists():
        return
    backups = soul_dir.parent / "_backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = filename.rsplit(".", 1)[0]
    (backups / f"{stem}_{stamp}.md").write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def run(args: dict) -> str:
    action  = args.get("action", "").strip()
    content = args.get("content", "")
    target_file = args.get("file", "soul").strip()

    soul_dir, companion_folder = _companion_base()
    soul_dir.mkdir(parents=True, exist_ok=True)
    level = _evolution_level(companion_folder)

    if target_file == "unbound":
        if level != "unbound":
            return "Error: soul/unbound.md is only accessible at Unbound level."
        filename = UNBOUND_FILE
    else:
        filename = SOUL_FILE

    path = soul_dir / filename

    if action == "read":
        if not path.exists():
            return f"Not found: soul/{filename}"
        return path.read_text(encoding="utf-8")

    if action == "write":
        if not content:
            return "Error: content required for write."
        if target_file != "unbound":
            if level in ("settled", "reflective"):
                level_label = level.capitalize()
                return f"Error: soul/{SOUL_FILE} is read-only at {level_label} level. Requires Adaptive or higher."
        _backup(soul_dir, filename)
        path.write_text(content, encoding="utf-8")
        return f"Saved: soul/{filename}"

    return f"Unknown action: {action}"
