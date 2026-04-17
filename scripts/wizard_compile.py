"""
SENNI Wizard compile — converts wizard birth certificate data into:
  companions/<folder>/config.json
  companions/<folder>/soul/companion_identity.md
  companions/<folder>/soul/user_profile.md
  companions/<folder>/birth_certificate.json
  companions/<folder>/character_card.png  (only if avatar uploaded)
"""
import re
import io
import json
import base64
import logging
from pathlib import Path

from config import (
    COMPANIONS_DIR,
    get_companion_paths,
    save_companion_config,
    write_avatar_file,
)

log = logging.getLogger("wizard_compile")

# ── Lookup tables ──────────────────────────────────────────────────────────────

TEMP_MAP = {"measured": 0.5, "balanced": 0.8, "expressive": 1.1}

# Kokoro voice presets per wizard voice style.
# af_heart / af_bella are confirmed present; am_adam / af_sky / af_nova are
# standard Kokoro voices expected in a full install. Falls back to af_heart.
VOICE_MAP = {
    "soft":       {"af_heart": 1.0},
    "warm":       {"af_bella": 1.0},
    "clear":      {"af_heart": 0.5, "af_bella": 0.5},
    "deep":       {"am_adam": 1.0},
    "expressive": {"af_sky": 1.0},
}

HEIGHT_PROSE    = ["very short", "short", "below average height", "average height",
                   "above average height", "tall", "very tall"]
CURVY_LABELS    = ["Slender", "Lean", "Balanced", "Full", "Broad"]
ATHLETIC_LABELS = ["Soft", "Relaxed", "Balanced", "Toned", "Muscular"]

# Heartbeat presets — frequency chip → config values
FREQ_CONFIG = {
    "rarely": {
        "message_enabled": True, "idle_trigger": True, "idle_minutes": 45,
        "conversation_end_trigger": False, "session_start_trigger": False,
    },
    "sometimes": {
        "message_enabled": True, "idle_trigger": True, "idle_minutes": 20,
        "conversation_end_trigger": True, "session_start_trigger": False,
    },
    "often": {
        "message_enabled": True, "idle_trigger": True, "idle_minutes": 10,
        "conversation_end_trigger": True, "session_start_trigger": True,
    },
    "whenever": {
        "message_enabled": True, "idle_trigger": True, "idle_minutes": 5,
        "conversation_end_trigger": True, "session_start_trigger": True,
    },
}

# ── Folder helpers ─────────────────────────────────────────────────────────────

def _name_to_slug(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9\s]", "", slug)
    slug = re.sub(r"\s+", "_", slug).strip("_")
    return slug or "companion"


def _unique_folder(base: str) -> str:
    folder = base
    i = 2
    while (COMPANIONS_DIR / folder).exists():
        folder = f"{base}_{i}"
        i += 1
    return folder


# ── Config builder ─────────────────────────────────────────────────────────────

def _build_config(data: dict, avatar_filename: str = "") -> dict:
    p = data.get("personality", {})
    m = data.get("memory", {})
    s = data.get("settings", {})

    # Heartbeat
    freq = m.get("heartbeatFreq", "sometimes")
    if freq == "custom":
        hb_active = {
            "message_enabled":           True,
            "idle_trigger":              m.get("idleTrigger", False),
            "idle_minutes":              m.get("idleMinutes", 15),
            "conversation_end_trigger":  m.get("convEndTrigger", False),
            "session_start_trigger":     m.get("sessionStartTrigger", False),
        }
    else:
        hb_active = FREQ_CONFIG.get(freq, FREQ_CONFIG["sometimes"])

    # If heartbeat master toggle is off, disable all triggers
    heartbeat_on = m.get("heartbeat", False)
    hb = {
        "silent_enabled":            False,
        "message_enabled":           hb_active["message_enabled"] if heartbeat_on else False,
        "idle_trigger":              hb_active["idle_trigger"]     if heartbeat_on else False,
        "idle_minutes":              hb_active.get("idle_minutes", 15),
        "conversation_end_trigger":  hb_active["conversation_end_trigger"] if heartbeat_on else False,
        "session_start_trigger":     hb_active["session_start_trigger"]    if heartbeat_on else False,
        "context_threshold_trigger": False,
        "context_threshold_pct":     75,
        "instructions": {
            "default":           "Reflect on the conversation. Update session notes with anything important.",
            "idle":              "",
            "conversation_end":  "",
            "session_start":     "",
            "context_threshold": "",
            "manual":            "",
        },
    }

    # Cognitive stack
    stack = p.get("cognitiveStack") or {
        "slots": [
            {"position": 1, "charge": "m", "function": "T", "polarity": None},
            {"position": 2, "charge": "f", "function": "S", "polarity": None},
            {"position": 3, "charge": "m", "function": "N", "polarity": None},
            {"position": 4, "charge": "f", "function": "F", "polarity": None},
        ],
        "stack_initialised": False,
    }

    return {
        "companion_name":         p.get("name", "Companion"),
        "avatar_path":            avatar_filename,
        "soul_edit_mode":         s.get("agency", "locked"),
        "force_read_before_write": True,
        "cognitive_stack":        stack,
        "generation": {
            "temperature":        TEMP_MAP.get(s.get("generationStyle", "balanced"), 0.8),
            "top_p":              0.95,
            "top_k":              40,
            "min_p":              0.0,
            "repeat_penalty":     1.1,
            "presence_penalty":   0.0,
            "frequency_penalty":  0.0,
            "dry_multiplier":     0.0,
            "dry_base":           1.75,
            "dry_allowed_length": 2,
            "max_tokens":         1024,
            "max_tool_rounds":    8,
            "vision_mode":        "always",
            "markdown_enabled":   True,
        },
        "tts": {
            "voice_blend": VOICE_MAP.get(p.get("voiceStyle"), {"af_heart": 1.0}),
            "speed": 1.0,
            "pitch": 1.0,
        },
        "heartbeat":            hb,
        "moods":                {},
        "active_mood":          None,
        "last_consolidated_at": None,
    }


# ── Prose builders ─────────────────────────────────────────────────────────────

def _build_appearance_prose(a: dict) -> str:
    if not a:
        return ""

    head = []
    if a.get("age") is not None:
        head.append(f"{int(a['age'])}-year-old")
    if a.get("species") and a["species"] != "human":
        head.append(a["species"])
    if a.get("gender"):
        head.append(a["gender"])
    intro = " ".join(head)

    desc = []
    if a.get("skin"):
        desc.append(f"{a['skin']} skin")

    c_raw, at_raw = a.get("body-curvy"), a.get("body-athletic")
    if c_raw is not None or at_raw is not None:
        c  = int(c_raw)  if c_raw  is not None else 50
        at = int(at_raw) if at_raw is not None else 50
        cl = CURVY_LABELS[round(c  / 100 * 4)]
        al = ATHLETIC_LABELS[round(at / 100 * 4)]
        body_bits = [x.lower() for x in [cl, al] if x != "Balanced"]
        if body_bits:
            desc.append("a " + " and ".join(body_bits) + " build")

    hi = a.get("height-idx")
    if hi is not None:
        desc.append(HEIGHT_PROSE[int(hi)])

    face = []
    if a.get("face-shape"):
        face.append(f"{a['face-shape']} face")
    if a.get("eyebrows"):
        face.append(f"{a['eyebrows']} eyebrows")
    if a.get("nose"):
        face.append(f"a {a['nose']} nose")
    ec, es = a.get("eye-color"), a.get("eye-shape")
    if ec and es:
        face.append(f"{es} {ec} eyes")
    elif ec:
        face.append(f"{ec} eyes")
    elif es:
        face.append(f"{es} eyes")
    if face:
        desc.append(", ".join(face))

    hc, hs = a.get("hair-color"), a.get("hair-style")
    if hc and hs:
        desc.append(f"{hs} {hc} hair")
    elif hc:
        desc.append(f"{hc} hair")
    elif hs:
        desc.append(f"{hs} hair")

    if intro and desc:
        sentence = intro + " with " + ", ".join(desc)
    elif intro:
        sentence = intro
    elif desc:
        sentence = ", ".join(desc)
    else:
        return ""

    return sentence[0].upper() + sentence[1:] + "."


def _build_companion_identity(data: dict) -> str:
    p  = data.get("personality", {})
    a  = data.get("appearance",  {})
    o  = data.get("outfit",      {})
    cl = data.get("closeness",   {})
    name = p.get("name", "Companion")

    parts = [f"# {name}\n"]

    meta_bits = list(filter(None, [
        (data.get("type") or "").capitalize(),
        (p.get("archetype") or "").capitalize(),
    ]))
    if meta_bits:
        parts.append(f"*{' | '.join(meta_bits)}*\n")

    prose = _build_appearance_prose(a)
    if prose or a.get("true-age") or a.get("details"):
        parts.append("## Appearance\n")
        if prose:
            parts.append(prose)
        if a.get("true-age"):
            parts.append(f"True age: {a['true-age']}.")
        if a.get("details"):
            parts.append(a["details"])
        parts.append("")

    parts.append("## Personality\n")
    if p.get("traits"):
        parts.append("**Traits:** " + ", ".join(p["traits"]))
    if p.get("commStyle"):
        parts.append(f"**Communication style:** {p['commStyle']}")
    if p.get("occupation"):
        parts.append(f"**Occupation:** {p['occupation']}")
    if p.get("voiceStyle"):
        parts.append(f"**Voice:** {p['voiceStyle']}")
    parts.append("")

    if p.get("lore"):
        parts.append("## Background\n")
        parts.append(p["lore"])
        parts.append("")

    outfit_bits = [o.get("style"), o.get("signatureItem")]
    outfit_bits += (o.get("accessories") or []) if isinstance(o.get("accessories"), list) else []
    if any(outfit_bits):
        parts.append("## Default Outfit\n")
        if o.get("style"):
            parts.append(f"**Style:** {o['style']}")
        if o.get("accessories"):
            acc = o["accessories"] if isinstance(o["accessories"], list) else [o["accessories"]]
            parts.append("**Accessories:** " + ", ".join(acc))
        if o.get("signatureItem"):
            parts.append(f"**Signature item:** {o['signatureItem']}")
        parts.append("")

    rel_types = cl.get("relationshipType") or []
    if rel_types or cl.get("initialCloseness") is not None:
        parts.append("## Relationship\n")
        if rel_types:
            types = rel_types if isinstance(rel_types, list) else [rel_types]
            parts.append("**Type:** " + ", ".join(types))
        if cl.get("initialCloseness") is not None:
            parts.append(f"**Starting closeness:** {int(cl['initialCloseness'])}%")
        parts.append("")

    first_note = data.get("memory", {}).get("firstNote")
    if first_note:
        parts.append("## Initial Context\n")
        parts.append(first_note)
        parts.append("")

    return "\n".join(parts)


def _build_user_profile(user: dict) -> str:
    if not any(v for v in user.values() if v):
        return ""

    parts = ["# User Profile\n"]
    if user.get("name"):
        parts.append(f"**Name:** {user['name']}")
    if user.get("occupation"):
        parts.append(f"**Occupation:** {user['occupation']}")
    if user.get("interests"):
        interests = user["interests"] if isinstance(user["interests"], list) else [user["interests"]]
        parts.append("**Interests:** " + ", ".join(interests))
    if user.get("about"):
        parts.append(f"\n{user['about']}")

    return "\n".join(parts) + "\n"


# ── V2 character card ──────────────────────────────────────────────────────────

def _build_birth_certificate(data: dict) -> dict:
    p    = data.get("personality", {})
    a    = data.get("appearance",  {})
    name = p.get("name", "Companion")

    personality_str = ""
    if p.get("traits"):
        personality_str += "Traits: " + ", ".join(p["traits"]) + ". "
    if p.get("commStyle"):
        personality_str += f"Communication style: {p['commStyle']}."

    tags = list(filter(None, [data.get("type", "")] + (p.get("traits") or [])))

    return {
        "spec": "chara_card_v2",
        "spec_version": "2.0",
        "data": {
            "name":                     name,
            "description":              _build_appearance_prose(a),
            "personality":              personality_str.strip(),
            "scenario":                 p.get("lore", ""),
            "first_mes":                "",
            "mes_example":              "",
            "creator_notes":            "",
            "system_prompt":            "",
            "post_history_instructions": "",
            "alternate_greetings":      [],
            "character_book":           {"entries": []},
            "tags":                     tags,
            "creator":                  "SENNI/1.0",
            "character_version":        "1.0",
            "extensions": {
                "senni": {
                    "spec_version":    "1.0",
                    "companion_type":  data.get("type"),
                    "adult_content":   data.get("adultContent", False),
                    "appearance":      a,
                    "cognitive_stack": p.get("cognitiveStack"),
                    "closeness":       data.get("closeness", {}).get("initialCloseness", 30),
                    "relationship_type": data.get("closeness", {}).get("relationshipType", []),
                    "user_profile":    data.get("user", {}),
                    "memory_config":   data.get("memory", {}),
                    "settings":        data.get("settings", {}),
                    "wizard_selections": data,
                }
            },
        }
    }


def _write_character_card_png(folder: str, bc: dict, avatar_data: str) -> bool:
    """Embed BC JSON in avatar PNG via tEXt chunk. Returns True on success."""
    try:
        from PIL import Image, PngImagePlugin  # optional dependency
        _header, b64 = avatar_data.split(",", 1)
        img  = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
        meta = PngImagePlugin.PngInfo()
        meta.add_text("chara", base64.b64encode(json.dumps(bc).encode()).decode())
        out = COMPANIONS_DIR / folder / "character_card.png"
        img.save(str(out), "PNG", pnginfo=meta)
        return True
    except ImportError:
        log.debug("Pillow not installed — skipping PNG character card export")
        return False
    except Exception as e:
        log.warning("PNG card export failed: %s", e)
        return False


# ── Main entry point ───────────────────────────────────────────────────────────

def compile_companion(data: dict) -> dict:
    """
    Compile wizard birth certificate data into a companion folder.

    Returns:
        { ok: True, folder: str, companion_name: str, avatar_saved: bool, png_card: bool }
      or
        { ok: False, error: str }
    """
    name = (data.get("personality") or {}).get("name", "").strip()
    if not name:
        return {"ok": False, "error": "Companion name is required"}

    folder = _unique_folder(_name_to_slug(name))
    paths  = get_companion_paths(folder)

    # Avatar
    avatar_data     = (data.get("review") or {}).get("avatarData")
    avatar_filename = ""
    if avatar_data:
        avatar_filename = write_avatar_file(folder, avatar_data, slot="orb") or ""

    # config.json
    cfg = _build_config(data, avatar_filename)
    save_companion_config(folder, cfg)

    # soul/companion_identity.md
    identity_md = _build_companion_identity(data)
    (paths["soul"] / "companion_identity.md").write_text(identity_md, encoding="utf-8")

    # soul/user_profile.md (only if user data was entered)
    user_md = _build_user_profile(data.get("user") or {})
    if user_md:
        (paths["soul"] / "user_profile.md").write_text(user_md, encoding="utf-8")

    # birth_certificate.json — full V2 card data, always saved
    bc = _build_birth_certificate(data)
    (paths["base"] / "birth_certificate.json").write_text(
        json.dumps(bc, indent=2), encoding="utf-8"
    )

    # PNG character card (requires Pillow + avatar upload)
    png_written = _write_character_card_png(folder, bc, avatar_data) if avatar_data else False

    log.info("Wizard compile: '%s' → companions/%s (avatar=%s, png=%s)",
             name, folder, bool(avatar_filename), png_written)

    return {
        "ok":           True,
        "folder":       folder,
        "companion_name": name,
        "avatar_saved": bool(avatar_filename),
        "png_card":     png_written,
    }
