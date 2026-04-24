"""
Tool: supersede_memory
Replace an existing memory note with updated content. Preserves history.

Use this when a fact you previously encoded has changed — not to fix typos or
add detail, but when the old note would be misleading if retrieved as-is.

The old note is kept in the store but excluded from future retrieval. The new
note links back to it so the companion can reason about how things changed over
time ("they used to live in Helsinki, now they're in Tampere").

The note ID to supersede is shown in retrieve_memory output as a short
truncated ID like 'id: a1b2c3d4…'. Pass the full visible portion — the
server will match on the prefix.
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

from scripts.paths import CONFIG_FILE, COMPANIONS_DIR

TOOL_NAME   = "supersede_memory"
DESCRIPTION = (
    "Replace an existing memory note whose content has become outdated. "
    "Use when a fact has genuinely changed — not to add detail, but when "
    "the old note would be wrong or misleading if retrieved. "
    "The old note is preserved as history but excluded from future retrieval. "
    "The note ID appears at the bottom of each retrieve_memory result as 'id: xxxxxxxx…'."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "old_id": {
            "type": "string",
            "description": (
                "The ID of the note to supersede, as shown in retrieve_memory output "
                "(the 8-character prefix is enough, e.g. 'a1b2c3d4')."
            ),
        },
        "content": {
            "type": "string",
            "description": (
                "The updated memory, written in your own voice. "
                "Be specific — write what is now true, not just what changed."
            ),
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2–6 keywords for the updated note.",
        },
        "emotional_valence": {
            "type": "number",
            "description": "How this feels now: -1.0 (negative) to 1.0 (positive).",
        },
        "intensity": {
            "type": "number",
            "description": "How strongly this registers: 0.0 to 1.0.",
        },
        "context_summary": {
            "type": "string",
            "description": (
                "A short phrase (under 120 chars) describing why this is being updated. "
                "E.g. 'user mentioned they moved from Helsinki to Tampere'."
            ),
        },
    },
    "required": ["old_id", "content"],
}


def _get_port() -> int:
    try:
        cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return int(cfg.get("port", 8000))
    except Exception:
        return 8000


def _get_active_mood() -> str | None:
    try:
        global_cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        folder     = global_cfg.get("companion_folder", "default")
        comp_cfg   = json.loads((COMPANIONS_DIR / folder / "config.json").read_text(encoding="utf-8"))
        return comp_cfg.get("active_mood") or None
    except Exception:
        return None


def run(args: dict) -> str:
    old_id  = args.get("old_id", "").strip()
    content = args.get("content", "").strip()
    if not old_id:
        return "Error: old_id is required."
    if not content:
        return "Error: content is required."

    keywords        = args.get("keywords", [])
    valence         = float(args.get("emotional_valence", 0.0))
    intensity       = float(args.get("intensity", 0.5))
    context_summary = args.get("context_summary", content[:120]).strip()
    mood            = _get_active_mood()

    valence   = max(-1.0, min(1.0, valence))
    intensity = max(0.0,  min(1.0, intensity))

    payload = json.dumps({
        "old_id":            old_id,
        "content":           content,
        "keywords":          keywords,
        "emotional_valence": valence,
        "intensity":         intensity,
        "context_summary":   context_summary,
        "mood":              mood,
    }).encode("utf-8")

    port = _get_port()
    url  = f"http://127.0.0.1:{port}/api/memory/supersede"

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))

        if body.get("ok"):
            new_id = body.get("new_note_id", "unknown")
            old_id_echo = body.get("superseded_id", old_id)
            return (
                f"Memory updated. Old note ({old_id_echo[:8]}…) preserved as history. "
                f"New note id: {new_id[:8]}…"
            )
        else:
            reason = body.get("reason", "unknown_error")
            if reason == "memory_unavailable":
                return "Memory system not available. (Is chromadb installed?)"
            if reason == "memory_disabled":
                return "Memory system is disabled in settings."
            if reason in ("old_id and content required", "content_required"):
                return f"Error: {reason}."
            return f"Memory update failed: {reason}"

    except urllib.error.URLError as e:
        return f"Could not reach memory server: {e.reason}"
    except Exception as e:
        return f"Memory update error: {e}"
