"""
set_mood.py — Tool for setting the companion's active mood.

Drop this in tools/ — it is auto-discovered by tool_loader.py.

Usage by the companion:
  set_mood(mood_name="Playful")   — switch to a named mood
  set_mood(mood_name=null)        — clear the active mood (return to neutral)

The mood name must match a key in the companion's moods dict exactly
(case-sensitive). The UI picks up the change on its next status poll.
"""

import logging
from pathlib import Path

log = logging.getLogger(__name__)

# ── Tool manifest ──────────────────────────────────────────────────────────────

TOOL_NAME   = "set_mood"
DESCRIPTION = (
    "Set your current mood. Pass a mood name to activate it, or null to clear "
    "the active mood and return to your default state. The mood name must match "
    "one of the available moods listed in the system prompt exactly."
)
INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "mood_name": {
            "type":        ["string", "null"],
            "description": "Name of the mood to activate, or null to clear.",
        },
    },
    "required": ["mood_name"],
}

# ── Handler ────────────────────────────────────────────────────────────────────

def run(args: dict) -> str:
    mood_name = args.get("mood_name")  # str or None

    # Normalise: empty string treated as null
    if not mood_name:
        mood_name = None

    try:
        from scripts.config import load_config, load_companion_config, save_companion_config

        global_cfg       = load_config()
        companion_folder = global_cfg.get("companion_folder", "default")
        companion_cfg    = load_companion_config(companion_folder)

        moods = companion_cfg.get("moods", {})

        if mood_name is not None:
            if mood_name not in moods:
                available = ", ".join(moods.keys()) if moods else "(none configured)"
                return (
                    f"Mood '{mood_name}' not found. "
                    f"Available moods: {available}"
                )
            if not moods[mood_name].get("enabled", True):
                return f"Mood '{mood_name}' is disabled."

        companion_cfg["active_mood"] = mood_name
        save_companion_config(companion_folder, companion_cfg)

        if mood_name is None:
            log.info("set_mood: cleared active mood")
            return "Mood cleared."
        else:
            log.info("set_mood: set to %r", mood_name)
            return f"Mood set to {mood_name}."

    except Exception as e:
        log.error("set_mood failed: %s", e, exc_info=True)
        return f"Error setting mood: {e}"
