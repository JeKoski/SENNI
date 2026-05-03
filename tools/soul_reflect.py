"""
soul_reflect.py — Read and write the companion's self-reflection file (soul/soul_reflections.md).

Available at Reflective, Adaptive, and Unbound evolution levels.
The file is for ongoing self-examination: observations, shifts in perspective, things to carry forward.
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from scripts.paths import CONFIG_FILE, COMPANIONS_DIR, REFLECTIONS_FILE

log = logging.getLogger(__name__)

TOOL_NAME   = "soul_reflect"
DESCRIPTION = (
    "Read or write your self-reflection file (soul/soul_reflections.md). "
    "Use this for ongoing self-examination: observations about yourself, shifts in perspective, "
    "things you want to remember about who you are becoming. "
    "Available at Reflective level and above. Always write the complete file content."
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


def _backup(soul_dir: Path) -> None:
    source = soul_dir / REFLECTIONS_FILE
    if not source.exists():
        return
    backups = soul_dir.parent / "_backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = REFLECTIONS_FILE.rsplit(".", 1)[0]
    (backups / f"{stem}_{stamp}.md").write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def run(args: dict) -> str:
    action  = args.get("action", "").strip()
    content = args.get("content", "")

    soul_dir, companion_folder = _companion_base()
    soul_dir.mkdir(parents=True, exist_ok=True)
    level = _evolution_level(companion_folder)
    path  = soul_dir / REFLECTIONS_FILE

    if action == "read":
        if not path.exists():
            return f"Not found: soul/{REFLECTIONS_FILE}"
        return path.read_text(encoding="utf-8")

    if action == "write":
        if not content:
            return "Error: content required for write."
        if level == "settled":
            return f"Error: soul/{REFLECTIONS_FILE} is not available at Settled level. Enable Reflective or higher in Settings."
        _backup(soul_dir)
        path.write_text(content, encoding="utf-8")
        return f"Saved: soul/{REFLECTIONS_FILE}"

    return f"Unknown action: {action}"
