"""
Tool: update_relational_state
Update the Tier 1 relational state block — the compact, always-in-context
summary of where the relationship between companion and user currently stands.

This is a deliberate, sparse write. It should NOT be called every session.
Call it only when something has genuinely shifted in the relationship — a new
dynamic has emerged, a shared reference has formed, closeness has meaningfully
changed, or a long-standing pattern has resolved or changed character.

The relational state block is limited to ~200 tokens. It is not a session log.
It is the companion's living summary of where things stand between them.

What belongs here (write sparingly, as a whole updated block):
  - Closeness / trust level
  - Recurring dynamics ("they tend to deflect when tired")
  - Shared references, in-jokes, rituals
  - Things that have become 'ours' over time
  - Ongoing tensions or unresolved threads

What does NOT belong here:
  - Single-session events (those go in episodic memory via write_memory)
  - Factual profile information (that stays in soul/user_profile.md)
  - Anything that would update every session
"""

import json
import urllib.request
import urllib.error
from pathlib import Path

from scripts.paths import CONFIG_FILE

TOOL_NAME   = "update_relational_state"
DESCRIPTION = (
    "Update the relational state block — a compact summary of where the relationship "
    "currently stands. Call sparingly: only when something has genuinely shifted "
    "(new dynamic, meaningful change in closeness, a shared reference that has become 'ours'). "
    "Write the full updated block each time, not a delta. Keep it under 200 tokens."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "state": {
            "type": "string",
            "description": (
                "The full updated relational state, written in your own voice. "
                "Not a session log — a standing summary of where things are between you. "
                "Should be compact (under 200 tokens). Write the complete block, "
                "not just what changed."
            ),
        },
    },
    "required": ["state"],
}


def _get_port() -> int:
    """Read the configured port from config.json. Defaults to 8000."""
    try:
        cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return int(cfg.get("port", 8000))
    except Exception:
        return 8000


def run(args: dict) -> str:
    state = args.get("state", "").strip()
    if not state:
        return "Error: state is required."

    # Soft length warning — the server doesn't hard-reject, but we can warn
    token_estimate = len(state.split())
    length_warning = ""
    if token_estimate > 220:
        length_warning = (
            f" (Note: this is ~{token_estimate} words — "
            f"consider trimming to keep the block under 200 tokens.)"
        )

    payload = json.dumps({"state": state}).encode("utf-8")

    port = _get_port()
    url  = f"http://127.0.0.1:{port}/api/memory/relational-state"

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
            return f"Relational state updated.{length_warning}"
        else:
            reason = body.get("reason", "unknown_error")
            if reason == "memory_unavailable":
                return "Memory system not available. (ChromaDB may not be installed.)"
            if reason == "memory_disabled":
                return "Memory system is disabled in settings."
            return f"Relational state update failed: {reason}"

    except urllib.error.URLError as e:
        return f"Memory system unreachable: {e.reason}"
    except Exception as e:
        return f"Relational state update error: {e}"
