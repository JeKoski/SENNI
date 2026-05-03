"""
note.py — Read, write, and list files in the companion's mind/ layer.

mind/ is the working layer: session notes, topic-specific files, anything that needs
its own space. Files are not loaded into active context automatically — the companion
reads them when it needs them.

Shorthand: {action: "write", type: "session", content: "..."} auto-names the file
by the current date (e.g. mind/session_2026-05-03.md).
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from scripts.paths import CONFIG_FILE, COMPANIONS_DIR

log = logging.getLogger(__name__)

TOOL_NAME   = "note"
DESCRIPTION = (
    "Read, write, or list files in your mind/ layer. "
    "mind/ is your working space: session notes, project files, anything that deserves its own place. "
    "Use {action: 'write', type: 'session'} to auto-name a session note by today's date. "
    "Use {action: 'list'} to see what files exist. Always write the complete file content."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["read", "write", "list"],
            "description": "What to do."
        },
        "filename": {
            "type": "string",
            "description": "File name in mind/ (e.g. 'session_notes.md'). Required for read/write unless using type shorthand."
        },
        "type": {
            "type": "string",
            "enum": ["session"],
            "description": "Shorthand for write: 'session' auto-names the file by today's date."
        },
        "content": {
            "type": "string",
            "description": "Full file content to write. Required for 'write' action."
        }
    },
    "required": ["action"]
}


def _companion_base() -> Path:
    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        folder = config.get("companion_folder", "default")
    except Exception:
        folder = "default"
    return COMPANIONS_DIR / folder / "mind"


def run(args: dict) -> str:
    action   = args.get("action", "").strip()
    filename = args.get("filename", "").strip()
    note_type = args.get("type", "").strip()
    content  = args.get("content", "")

    mind_dir = _companion_base()
    mind_dir.mkdir(parents=True, exist_ok=True)

    if action == "list":
        files = sorted(f.name for f in mind_dir.iterdir() if f.suffix in (".md", ".txt"))
        return f"mind/: {', '.join(files)}" if files else "mind/ is empty."

    if action == "read":
        if not filename:
            return "Error: filename required for read."
        path = mind_dir / filename
        if not path.exists():
            return f"Not found: mind/{filename}"
        return path.read_text(encoding="utf-8")

    if action == "write":
        if not content:
            return "Error: content required for write."
        if not filename:
            if note_type == "session":
                filename = f"session_{datetime.now().strftime('%Y-%m-%d')}.md"
            else:
                return "Error: filename required for write (or use type='session' for auto-naming)."
        path = mind_dir / filename
        path.write_text(content, encoding="utf-8")
        return f"Saved: mind/{filename}"

    return f"Unknown action: {action}"
