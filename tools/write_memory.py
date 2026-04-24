"""
Tool: write_memory
Write an atomic memory note to the companion's long-term episodic store.

This is the masculine-pathway encoding tool — the companion deliberately
decides something is worth remembering and calls this to encode it.

Primitive ratios, composite label, function source, and retrieval mode are
all inferred automatically from the companion's cognitive stack and current
mood. The companion only needs to supply the human-meaningful fields.

Write discipline (enforced via system prompt, reinforced here):
  - Write 2–5 memories per session. Do not narrate ordinary exchanges.
  - Fact/Impression: only when something concrete is confirmed and worth keeping.
  - Logic/Reason: only when a genuine causal insight forms.
  - Concept/Conclusion: only when a pattern becomes clear, not on first encounter.
  - Vibe/Relation: only when something registers with genuine felt weight.
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

from scripts.paths import CONFIG_FILE, COMPANIONS_DIR

TOOL_NAME   = "write_memory"
DESCRIPTION = (
    "Write a memory note to long-term episodic storage. "
    "Use sparingly — 2 to 5 times per session for moments genuinely worth keeping. "
    "Supply the memory in your own voice. "
    "Set emotional_valence (-1.0 negative to 1.0 positive) and intensity (0.0 to 1.0). "
    "Provide a context_summary: a brief phrase describing the conversational moment "
    "so this memory can link to related ones later."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "content": {
            "type": "string",
            "description": (
                "The memory itself, written in your own voice. "
                "Be specific — vague memories are hard to retrieve usefully."
            ),
        },
        "keywords": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "2–6 keywords that capture the core of this memory. "
                "Used for direct retrieval. E.g. ['walks', 'morning', 'routine']."
            ),
        },
        "emotional_valence": {
            "type": "number",
            "description": (
                "How this memory feels: -1.0 (very negative) to 1.0 (very positive). "
                "0.0 is neutral."
            ),
        },
        "intensity": {
            "type": "number",
            "description": (
                "How strongly this registered when it happened: 0.0 (barely) to 1.0 (overwhelming). "
                "Most memories are 0.3–0.7."
            ),
        },
        "context_summary": {
            "type": "string",
            "description": (
                "A short phrase (under 120 chars) describing the conversational context "
                "when this was written. Used for A-MEM style linking between related memories. "
                "E.g. 'user shared their morning walk habit'."
            ),
        },
    },
    "required": ["content"],
}


def _get_port() -> int:
    """Read the configured port from config.json. Defaults to 8000."""
    try:
        cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return int(cfg.get("port", 8000))
    except Exception:
        return 8000


def _get_active_mood() -> str | None:
    """Read the active mood from the companion's config, if any."""
    try:
        global_cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        folder     = global_cfg.get("companion_folder", "default")
        comp_cfg   = json.loads((COMPANIONS_DIR / folder / "config.json").read_text(encoding="utf-8"))
        return comp_cfg.get("active_mood") or None
    except Exception:
        return None


def run(args: dict) -> str:
    content = args.get("content", "").strip()
    if not content:
        return "Error: content is required."

    keywords        = args.get("keywords", [])
    valence         = float(args.get("emotional_valence", 0.0))
    intensity       = float(args.get("intensity", 0.5))
    context_summary = args.get("context_summary", content[:120]).strip()
    mood            = _get_active_mood()

    # Clamp to valid ranges (belt-and-suspenders — server also clamps)
    valence   = max(-1.0, min(1.0, valence))
    intensity = max(0.0,  min(1.0, intensity))

    payload = json.dumps({
        "content":           content,
        "keywords":          keywords,
        "emotional_valence": valence,
        "intensity":         intensity,
        "context_summary":   context_summary,
        "mood":              mood,
    }).encode("utf-8")

    port = _get_port()
    url  = f"http://127.0.0.1:{port}/api/memory/write"

    try:
        req  = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))

        if body.get("ok"):
            note_id = body.get("note_id", "unknown")
            # Short confirmation — no need to echo the content back
            return f"Memory written. (id: {note_id[:8]}…)"
        else:
            reason = body.get("reason", "unknown_error")
            if reason == "memory_unavailable":
                return "Memory system not available. (ChromaDB may not be installed.)"
            if reason == "memory_disabled":
                return "Memory system is disabled in settings."
            return f"Memory write failed: {reason}"

    except urllib.error.URLError as e:
        return f"Memory system unreachable: {e.reason}"
    except Exception as e:
        return f"Memory write error: {e}"
