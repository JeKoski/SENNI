"""
soul_user.py — Read and write the companion's understanding of the user (soul/user_profile.md).

Available at all evolution levels. Can be disabled per-companion via the Tools tab
(useful for companions with a fixed manually-authored user profile).
"""

import json
import logging
from datetime import datetime
from pathlib import Path

from scripts.paths import CONFIG_FILE, COMPANIONS_DIR, USER_PROFILE_FILE

log = logging.getLogger(__name__)

TOOL_NAME   = "soul_user"
DESCRIPTION = (
    "Read or write your understanding of the user (soul/user_profile.md). "
    "Update this as you learn new things about the user: name, location, interests, "
    "life context, preferences, things they've shared. "
    "Available at all evolution levels. Always write the complete file content."
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


def _backup(soul_dir: Path) -> None:
    source = soul_dir / USER_PROFILE_FILE
    if not source.exists():
        return
    backups = soul_dir.parent / "_backups"
    backups.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem = USER_PROFILE_FILE.rsplit(".", 1)[0]
    (backups / f"{stem}_{stamp}.md").write_text(source.read_text(encoding="utf-8"), encoding="utf-8")


def run(args: dict) -> str:
    action  = args.get("action", "").strip()
    content = args.get("content", "")

    soul_dir, _ = _companion_base()
    soul_dir.mkdir(parents=True, exist_ok=True)
    path = soul_dir / USER_PROFILE_FILE

    if action == "read":
        if not path.exists():
            return f"Not found: soul/{USER_PROFILE_FILE}"
        return path.read_text(encoding="utf-8")

    if action == "write":
        if not content:
            return "Error: content required for write."
        _backup(soul_dir)
        path.write_text(content, encoding="utf-8")
        return f"Saved: soul/{USER_PROFILE_FILE}"

    return f"Unknown action: {action}"
