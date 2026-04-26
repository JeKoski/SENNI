"""
Tool: retrieve_memory
Deliberately recall memories from the companion's long-term episodic store.

This is the masculine-pathway retrieval tool — the companion consciously
decides she wants to remember something and calls this to surface it.

Feminine-pathway retrieval (associative, mood-biased) is system-driven and
does not require a tool call. This tool is only for deliberate, agentic recall.

When to use:
  - The user mentions something the companion suspects she has a memory about.
  - A topic shift makes past context feel relevant.
  - The companion wants to verify or build on something previously encoded.

The returned notes are sorted by relevance. Each note includes its content,
composite type, emotional valence, intensity, and when it was last recalled.
"""

import json
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

from scripts.paths import CONFIG_FILE

TOOL_NAME   = "retrieve_memory"
DESCRIPTION = (
    "Recall memories related to a topic or query — use when you might have encoded "
    "something relevant that isn't in the current conversation. "
    "Returns the most semantically similar notes from long-term storage."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": (
                "What you want to remember. Natural language is fine — "
                "write it the way you'd search your own memory. "
                "E.g. 'what do I know about their morning routine' or "
                "'feelings about the project they mentioned'."
            ),
        },
        "k": {
            "type": "integer",
            "description": (
                "How many memories to retrieve (default 4, max 10). "
                "Start with the default — more is not always more useful."
            ),
        },
    },
    "required": ["query"],
}


def _get_port() -> int:
    """Read the configured port from config.json. Defaults to 8000."""
    try:
        cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return int(cfg.get("port", 8000))
    except Exception:
        return 8000


def _format_note(note: dict) -> str:
    """Format a single note for model consumption."""
    lines = []

    composite = note.get("composite_label", "memory")
    valence   = note.get("emotional_valence", 0.0)
    intensity = note.get("intensity", 0.5)

    # Valence descriptor
    if valence >= 0.6:
        affect = "positive"
    elif valence <= -0.6:
        affect = "negative"
    elif abs(valence) < 0.15:
        affect = "neutral"
    elif valence > 0:
        affect = "slightly positive"
    else:
        affect = "slightly negative"

    # Recency
    last_recalled = note.get("last_recalled_at")
    if last_recalled:
        try:
            dt    = datetime.fromisoformat(last_recalled.replace("Z", "+00:00"))
            now   = datetime.now(timezone.utc)
            delta = now - dt
            days  = delta.days
            if days == 0:
                recency = "recalled today"
            elif days == 1:
                recency = "recalled yesterday"
            elif days < 7:
                recency = f"recalled {days} days ago"
            elif days < 30:
                recency = f"recalled {days // 7} week(s) ago"
            else:
                recency = f"recalled {days // 30} month(s) ago"
        except Exception:
            recency = ""
    else:
        recency = ""

    meta_parts = [composite, affect, f"intensity {intensity:.1f}"]
    if recency:
        meta_parts.append(recency)

    lines.append(f"[{' · '.join(meta_parts)}]")
    lines.append(note.get("content", ""))

    note_id = note.get("id", "")
    if note_id:
        # Include truncated ID — useful if the companion later wants to supersede this note
        lines.append(f"id: {note_id[:8]}…")

    return "\n".join(lines)


def run(args: dict) -> str:
    query = args.get("query", "").strip()
    if not query:
        return "Error: query is required."

    k = int(args.get("k", 4))
    k = max(1, min(10, k))  # clamp 1–10

    payload = json.dumps({"query": query, "k": k}).encode("utf-8")

    port = _get_port()
    url  = f"http://127.0.0.1:{port}/api/memory/retrieve"

    try:
        req  = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))

        if not body.get("ok"):
            reason = body.get("reason", "unknown_error")
            if reason == "memory_unavailable":
                return "Memory system not available. (ChromaDB may not be installed.)"
            if reason == "memory_disabled":
                return "Memory system is disabled in settings."
            return f"Retrieval failed: {reason}"

        notes = body.get("notes", [])
        count = body.get("count", len(notes))

        if not notes:
            return f"No memories found for: \"{query}\""

        sections = [f"Retrieved {count} memory note(s) for: \"{query}\"\n"]
        for i, note in enumerate(notes, 1):
            sections.append(f"— Memory {i} —\n{_format_note(note)}")

        return "\n\n".join(sections)

    except urllib.error.URLError as e:
        return f"Memory system unreachable: {e.reason}"
    except Exception as e:
        return f"Memory retrieval error: {e}"
