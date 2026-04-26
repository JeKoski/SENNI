"""
config.py — Configuration management & hardware detection

Handles:
- Reading and writing config.json
- Per-OS path resolution (Linux / Windows / Darwin)
- Auto-detecting GPU type and platform
- Scanning for .gguf model files in common locations
- Resolving all paths relative to the project root (fully portable)
"""

import base64
import json
import os
import platform
import re
import subprocess
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────

from scripts.paths import (  # noqa: E402
    PROJECT_ROOT,
    CONFIG_FILE,
    COMPANIONS_DIR,
    TEMPLATES_DIR,
)

# ── Path safety helpers ────────────────────────────────────────────────────────

def sanitize_folder(name: str) -> str:
    """Restrict companion folder names to [a-z0-9_-], max 64 chars."""
    clean = re.sub(r"[^a-z0-9_\-]", "", name.lower().strip())[:64].strip("-_")
    return clean or "companion"


def sanitize_filename(name: str) -> str:
    """Restrict soul/history filenames to safe chars. Returns '' on anything suspicious."""
    name = name.strip()
    if not name or ".." in name:
        return ""
    return re.sub(r"[^a-zA-Z0-9_.\-]", "_", name)[:200]


def confine_path(path: Path, root: Path) -> Path:
    """Raise ValueError if resolved path escapes root directory."""
    try:
        path.resolve().relative_to(root.resolve())
    except ValueError:
        raise ValueError(f"Path escape detected: {path!r} is outside {root!r}")
    return path


# ── Defaults ───────────────────────────────────────────────────────────────────

DEFAULTS = {
    # Identity
    "companion_name":   "your companion",
    "companion_folder": "senni",

    # Model / hardware — flat values (active OS)
    "model_path":       "",
    "mmproj_path":      "",
    "gpu_type":         "cpu",
    "port_bridge":      8000,
    "port_model":       8081,
    "first_run":        True,
    "setup_complete":   True,   # True = legacy compat; wizard sets False at boot start, True on completion

    # Per-OS paths — populated progressively as the user sets up on each OS
    # Keys match platform.system(): "Linux", "Windows", "Darwin"
    "model_paths":      {},
    "mmproj_paths":     {},
    "gpu_types":        {},

    # llama-server binary — empty = auto-discover
    # Per-OS so users can point different OSes at different builds
    # (e.g. a SYCL build on Windows, PATH lookup on Linux)
    "server_binary":    "",
    "server_binaries":  {},

    # Built-in server args
    "server_args": {
        # Core — always on
        "ngl":              {"enabled": True,  "value": 99,            "flag": "-ngl"},
        "ctx":              {"enabled": True,  "value": 32768,         "flag": "-c"},
        "np":               {"enabled": True,  "value": 1,             "flag": "-np"},
        "ctk":              {"enabled": True,  "value": "q8_0",        "flag": "-ctk"},
        "ctv":              {"enabled": True,  "value": "q8_0",        "flag": "-ctv"},
        "jinja":            {"enabled": True,  "value": None,          "flag": "--jinja"},
        "reasoning_format": {"enabled": False,  "value": "deepseek",    "flag": "--reasoning-format"},
        # KV cache / performance — on by default
        "cache_reuse":      {"enabled": True,  "value": 256,           "flag": "--cache-reuse"},
        "batch":            {"enabled": True,  "value": 256,           "flag": "-b"},
        "ubatch":           {"enabled": True,  "value": 256,           "flag": "-ub"},
        # Off by default — hardware/situation dependent
        "flash_attn":       {"enabled": False, "value": "auto",          "flag": "--flash-attn"},
        "prompt_cache":     {"enabled": False, "value": "senni.cache", "flag": "--prompt-cache"},
        "mlock":            {"enabled": False, "value": None,          "flag": "--mlock"},
        "no_mmap":          {"enabled": False, "value": None,          "flag": "--no-mmap"},
        "threads":          {"enabled": False, "value": 0,             "flag": "-t"},
    },
    "server_args_custom": [],

    # Presence presets
    "presence_presets": {
        "Default": {
            "thinking":  {"glowColor":"rgba(129,140,248,0.4)",  "glowMax":16, "glowSpeed":2.0, "ringSpeed":1.8, "dotColor":"#818cf8", "dotSpeed":1.2, "breathSpeed":3.0, "orbSize":52},
            "streaming": {"glowColor":"rgba(109,212,168,0.35)", "glowMax":12, "glowSpeed":2.5, "ringSpeed":2.4, "dotColor":"#6dd4a8", "dotSpeed":1.4, "breathSpeed":4.0, "orbSize":52},
            "idle":      {"glowColor":"rgba(129,140,248,0.15)", "glowMax":6,  "glowSpeed":4.0, "ringSpeed":4.0, "dotColor":"#818cf8", "dotSpeed":3.0, "breathSpeed":5.0, "orbSize":52},
        },
        "Warm": {
            "thinking":  {"glowColor":"rgba(251,191,36,0.4)",   "glowMax":18, "glowSpeed":1.8, "ringSpeed":1.6, "dotColor":"#fbbf24", "dotSpeed":1.0, "breathSpeed":2.5, "orbSize":52},
            "streaming": {"glowColor":"rgba(251,146,60,0.35)",  "glowMax":14, "glowSpeed":2.2, "ringSpeed":2.0, "dotColor":"#fb923c", "dotSpeed":1.2, "breathSpeed":3.5, "orbSize":52},
            "idle":      {"glowColor":"rgba(251,191,36,0.12)",  "glowMax":6,  "glowSpeed":4.0, "ringSpeed":4.0, "dotColor":"#fb923c", "dotSpeed":2.0, "breathSpeed":5.0, "orbSize":52},
        },
    },

    # TTS (Kokoro) — global settings
    # python_path: path to Python with kokoro installed. Empty = use sys.executable.
    # voices_path: path to Kokoro voices/ directory. Empty = auto-discover.
    # espeak_path: path to espeak-ng binary. Empty = rely on PATH.
    "tts": {
        "enabled":     False,
        "python_path": "",
        "voices_path": "",
        "espeak_path": "",
    },

    # Memory system (ChromaDB + all-MiniLM-L6-v2)
    # enabled: master switch. False = memory endpoints return memory_disabled,
    #          no ChromaDB import attempted.
    # embedding_model: sentence-transformers model name. Changing this requires
    #                  re-indexing existing notes (not yet automated).
    # session_start_k: how many notes to surface at session start.
    # mid_convo_k: how many notes to surface on associative mid-convo trigger.
    "memory": {
        "enabled":         True,
        "embedding_model": "all-MiniLM-L6-v2",
        "session_start_k": 6,
        "mid_convo_k":     4,
    },

    # Generation defaults (per-request, no restart needed)
    "generation": {
        "temperature":        1.0,
        "top_p":              0.95,
        "top_k":              64,
        "min_p":              0.0,
        "repeat_penalty":     1.0,
        "presence_penalty":   0.0,
        "frequency_penalty":  0.0,
        "dry_multiplier":     0.0,
        "dry_base":           1.75,
        "dry_allowed_length": 2,
        "max_tokens":         2048,
        "max_tool_rounds":    8,
        "vision_mode":        "always",
        "markdown_enabled":   True,
    },
}

# ── Common locations to scan for .gguf files ───────────────────────────────────

SEARCH_HINTS = [
    # Linux / WSL common spots
    Path.home() / "models",
    Path.home() / "llama.cpp" / "models",
    Path("/mnt/windows_data/AI"),
    Path("/opt/models"),
    # Windows common spots
    Path("C:/AI/models"),
    Path("D:/AI/models"),
    Path("C:/Users") / os.environ.get("USERNAME", "") / "models",
    # macOS common spots
    Path.home() / "Library" / "Application Support" / "SENNI" / "models",
    Path.home() / "Documents" / "models",
    Path.home() / "AI" / "models",
    # ComfyUI text_encoders
    Path("/mnt/windows_data/AI/ComfyUI_Windows_portable/ComfyUI/models/text_encoders"),
    Path("D:/AI/ComfyUI_Windows_portable/ComfyUI/models/text_encoders"),
]


# ── GPU Detection ──────────────────────────────────────────────────────────────

def detect_gpu() -> str:
    """
    Try to identify the GPU type automatically.
    Returns one of: 'intel' | 'nvidia' | 'amd' | 'metal' | 'cpu'
    """
    system = platform.system()

    # ── Linux: read lspci ─────────────────────────────────────────────────────
    if system == "Linux":
        try:
            result = subprocess.run(
                ["lspci"], capture_output=True, text=True, timeout=5
            )
            output = result.stdout.lower()
            if "intel" in output and ("arc" in output or "uhd" in output or "iris" in output):
                return "intel"
            if "nvidia" in output:
                return "nvidia"
            if "amd" in output or "radeon" in output:
                return "amd"
        except Exception:
            pass

    # ── Windows: query WMIC ───────────────────────────────────────────────────
    if system == "Windows":
        try:
            result = subprocess.run(
                ["wmic", "path", "win32_videocontroller", "get", "name"],
                capture_output=True, text=True, timeout=5
            )
            output = result.stdout.lower()
            if "intel" in output:
                return "intel"
            if "nvidia" in output:
                return "nvidia"
            if "amd" in output or "radeon" in output:
                return "amd"
        except Exception:
            pass

    # ── macOS: Metal is always available on Apple Silicon / modern Intel Macs ─
    if system == "Darwin":
        try:
            result = subprocess.run(
                ["system_profiler", "SPDisplaysDataType"],
                capture_output=True, text=True, timeout=5
            )
            output = result.stdout.lower()
            if "apple" in output or "m1" in output or "m2" in output or "m3" in output or "m4" in output:
                return "metal"
            if "intel" in output or "amd" in output or "radeon" in output or "nvidia" in output:
                return "metal"
        except Exception:
            pass
        return "metal"

    return "cpu"


# ── Per-OS path resolution ─────────────────────────────────────────────────────

def resolve_platform_paths(config: dict) -> dict:
    """
    Check if per-OS path dicts exist and use the current OS's entry.
    Falls back to the flat value if no per-OS entry is set.
    The flat values are always kept in sync with the active OS so the
    rest of the codebase never needs to think about this.
    """
    system = platform.system()  # "Linux", "Windows", "Darwin"

    # model_path, mmproj_path
    for key in ("model_path", "mmproj_path"):
        multi = config.get(f"{key}s", {})
        if multi and isinstance(multi, dict):
            if system in multi and multi[system]:
                config[key] = multi[system]

    # gpu_type
    gpu_types = config.get("gpu_types", {})
    if gpu_types and isinstance(gpu_types, dict):
        if system in gpu_types and gpu_types[system]:
            config["gpu_type"] = gpu_types[system]

    # server_binary
    server_binaries = config.get("server_binaries", {})
    if server_binaries and isinstance(server_binaries, dict):
        if system in server_binaries and server_binaries[system]:
            config["server_binary"] = server_binaries[system]

    return config


def update_platform_paths(config: dict) -> dict:
    """
    Write the current flat values back into the per-OS dicts so future
    OS-switches can find them. Called by save_config() automatically.
    """
    system = platform.system()

    # model_path, mmproj_path
    for key in ("model_path", "mmproj_path"):
        multi_key = f"{key}s"
        if multi_key not in config or not isinstance(config[multi_key], dict):
            config[multi_key] = {}
        val = config.get(key, "")
        if val:
            config[multi_key][system] = val

    # gpu_type
    if "gpu_types" not in config or not isinstance(config["gpu_types"], dict):
        config["gpu_types"] = {}
    gpu = config.get("gpu_type", "cpu")
    if gpu:
        config["gpu_types"][system] = gpu

    # server_binary — only write if non-empty (empty means "auto-discover")
    if "server_binaries" not in config or not isinstance(config["server_binaries"], dict):
        config["server_binaries"] = {}
    binary = config.get("server_binary", "")
    if binary:
        config["server_binaries"][system] = binary
    # Don't write an empty string — that would shadow auto-discovery on this OS

    return config


# ── Model file scanning ────────────────────────────────────────────────────────

def find_gguf_files() -> list[dict]:
    """
    Scan common directories for .gguf files.
    Returns a list of dicts: {path, name, size_gb}
    """
    found = []
    seen  = set()

    for base in SEARCH_HINTS:
        if not base.exists():
            continue
        try:
            for gguf in base.rglob("*.gguf"):
                resolved = str(gguf.resolve())
                if resolved in seen:
                    continue
                seen.add(resolved)
                size_gb = round(gguf.stat().st_size / 1e9, 1)
                found.append({
                    "path":    resolved,
                    "name":    gguf.name,
                    "size_gb": size_gb,
                })
        except PermissionError:
            continue

    return found


def find_mmproj_candidates(model_path: str) -> list[dict]:
    """
    Given a model file path, return a list of possible mmproj files
    in the same directory.
    """
    if not model_path:
        return []

    model_dir = Path(model_path).parent
    candidates = []
    for f in sorted(model_dir.glob("*.gguf")):
        name_lower = f.name.lower()
        if "mmproj" in name_lower or "projector" in name_lower or "vision" in name_lower:
            candidates.append({"path": str(f.resolve()), "name": f.name})
    return candidates


# ── Config read / write ────────────────────────────────────────────────────────

def load_config() -> dict:
    """
    Load config.json from the project root.
    If it doesn't exist, return the defaults (first_run = True).
    Always merges with defaults so new keys are never missing.
    Resolves per-OS paths automatically.
    """
    if not CONFIG_FILE.exists():
        return dict(DEFAULTS)

    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        merged = {**DEFAULTS, **saved}
        # Deep-merge generation so sub-keys added to DEFAULTS after first
        # install (e.g. markdown_enabled) are filled in for existing configs.
        merged["generation"] = {**DEFAULTS["generation"], **saved.get("generation", {})}
        # Deep-merge memory so sub-keys added later (e.g. mid_convo_k) fill
        # in for existing installs that have an older memory block on disk.
        merged["memory"] = {**DEFAULTS["memory"], **saved.get("memory", {})}
        return resolve_platform_paths(merged)
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULTS)


def save_config(data: dict) -> None:
    """
    Write config.json to the project root.
    Merges with defaults so partial saves are safe.
    Always writes the current OS's paths into the per-OS dicts.
    """
    merged = {**DEFAULTS, **data, "first_run": False}
    merged = update_platform_paths(merged)
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(merged, f, indent=2)


# ── Companion paths ────────────────────────────────────────────────────────────

def get_companion_paths(companion_folder: str) -> dict[str, Path]:
    """
    Return the soul / mind / memory paths for a given companion folder name.
    Creates the directories if they don't exist yet.
    """
    base = COMPANIONS_DIR / companion_folder
    paths = {
        "base":   base,
        "soul":   base / "soul",
        "mind":   base / "mind",
        "memory": base / "memory",
    }
    for p in paths.values():
        p.mkdir(parents=True, exist_ok=True)
    return paths


# ── Companion templates ────────────────────────────────────────────────────────

def instantiate_companion_template(template_name: str, dest_folder: str) -> dict:
    """
    Copy a companion template into the companions/ directory.

    Returns {"ok": True} on success.
    Returns {"ok": False, "reason": "exists"} if dest already exists.
    Returns {"ok": False, "reason": "not_found"} if template missing.
    Raises on unexpected copy errors.
    """
    import shutil
    src  = TEMPLATES_DIR / template_name
    dest = COMPANIONS_DIR / dest_folder
    if not src.exists():
        return {"ok": False, "reason": "not_found"}
    if dest.exists():
        return {"ok": False, "reason": "exists"}
    shutil.copytree(str(src), str(dest))
    return {"ok": True}


# ── Convenience: build everything from scratch ─────────────────────────────────

def build_initial_config(
    model_path:  str,
    mmproj_path: str        = "",
    gpu_type:    str | None = None,
    ngl:         int        = 99,
    port_bridge: int        = 8000,
    port_model:  int        = 8081,
) -> dict:
    """
    Build a fresh config dict from wizard inputs.
    Auto-fills gpu_type if not provided.
    Writes paths into the current OS slot in the per-OS dicts.
    """
    resolved_gpu = gpu_type or detect_gpu()
    system       = platform.system()

    cfg = {
        **DEFAULTS,
        "model_path":  model_path,
        "mmproj_path": mmproj_path,
        "gpu_type":    resolved_gpu,
        "ngl":         ngl,
        "port_bridge": port_bridge,
        "port_model":  port_model,
        "first_run":   False,
        # Seed the per-OS dicts with the current OS
        "model_paths":  {system: model_path}  if model_path  else {},
        "mmproj_paths": {system: mmproj_path} if mmproj_path else {},
        "gpu_types":    {system: resolved_gpu},
        # server_binary intentionally empty — auto-discover on first boot
        "server_binary":   "",
        "server_binaries": {},
    }
    return cfg


# ── Companion config read / write ──────────────────────────────────────────────

def load_companion_config(companion_folder: str) -> dict:
    """
    Load per-companion config (name, avatar, generation overrides).
    Falls back to global generation defaults for any missing keys.
    """
    path = COMPANIONS_DIR / companion_folder / "config.json"
    base = {
        "companion_name": DEFAULTS["companion_name"],
        "avatar_path":    "",
        "avatar_data":    "",
        "generation":     dict(DEFAULTS["generation"]),
        "soul_edit_mode":            "locked",
        "force_read_before_write":   True,
        "heartbeat": {
            "silent_enabled":            False,
            "message_enabled":           False,
            "idle_trigger":              False,
            "idle_minutes":              15,
            "conversation_end_trigger":  False,
            "session_start_trigger":     False,
            "context_threshold_trigger": False,
            "context_threshold_pct":     75,
            "instructions": {
                "default":           "Reflect on the conversation. Update session notes with anything important. If something interesting came up that you could research, use web_search.",
                "idle":              "",
                "conversation_end":  "",
                "session_start":     "",
                "context_threshold": "",
                "manual":            "",
            },
        },
        # ── Moods ──
        "moods":        {},
        "active_mood":  None,
        # ── TTS (per-companion overrides) ──
        # voice_blend: up to 5 voices with weights. Empty = use global default voice.
        # speed/pitch: float multipliers. null = use global TTS setting.
        "tts": {
            "voice_blend": {"af_heart": 1.0},
            "speed":        1.0,
            "pitch":        1.0,
        },
        # ── Cognitive stack ──
        # Determines memory encoding weights and retrieval mode per primitive.
        # stack_initialised: False = neutral default was assigned automatically,
        #                    user hasn't set it deliberately yet.
        # Format: mT-fS-mN-fF (charge + function, 4 slots).
        # Constraint: each function (T/S/N/F) exactly once; charges exactly 2m + 2f.
        "cognitive_stack": {
            "slots": [
                {"position": 1, "charge": "m", "function": "T", "polarity": None},
                {"position": 2, "charge": "f", "function": "S", "polarity": None},
                {"position": 3, "charge": "m", "function": "N", "polarity": None},
                {"position": 4, "charge": "f", "function": "F", "polarity": None},
            ],
            "stack_initialised": False,
        },
        # ── Memory bookkeeping ──
        # last_consolidated_at: ISO timestamp of last successful consolidation run.
        # None = never consolidated (new companion, or crash recovery needed at next boot).
        "last_consolidated_at": None,
    }
    if not path.exists():
        return base
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        if "generation" in saved:
            base["generation"] = {**base["generation"], **saved["generation"]}
        if "heartbeat" in saved:
            base["heartbeat"] = {**base["heartbeat"], **saved["heartbeat"]}
        if "moods" in saved:
            base["moods"] = saved["moods"]
        if "tts" in saved:
            base["tts"] = {**base["tts"], **saved["tts"]}
        # cognitive_stack: saved value replaces default entirely — if it's present
        # on disk, the user set it intentionally (stack_initialised will be True).
        if "cognitive_stack" in saved:
            base["cognitive_stack"] = saved["cognitive_stack"]
        skip = {"generation", "heartbeat", "moods", "tts", "cognitive_stack"}
        return {**base, **{k: v for k, v in saved.items() if k not in skip}}
    except Exception:
        return base


def save_companion_config(companion_folder: str, data: dict) -> None:
    """Save per-companion config to companions/<folder>/config.json."""
    path = COMPANIONS_DIR / companion_folder / "config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def write_avatar_file(companion_folder: str, data_url: str, slot: str = 'orb') -> str:
    """
    Write a base64 data URL to disk as an avatar image file, always as PNG.
    slot: 'orb'     → avatar.png
          'sidebar' → sidebar_avatar.png
    Falls back to original format if Pillow is unavailable.
    Returns the filename saved, or '' on failure.
    """
    try:
        header, b64 = data_url.split(',', 1)
        raw    = base64.b64decode(b64)
        prefix = 'avatar' if slot == 'orb' else 'sidebar_avatar'
        dest   = COMPANIONS_DIR / companion_folder / f"{prefix}.png"
        try:
            import io as _io
            from PIL import Image
            img = Image.open(_io.BytesIO(raw)).convert('RGBA')
            img.save(str(dest), 'PNG')
            return f"{prefix}.png"
        except Exception:
            # Pillow unavailable — save in original format
            mime = header.split(';')[0].split(':')[1] if ':' in header else 'image/jpeg'
            if 'png' in mime:   ext = '.png'
            elif 'gif' in mime: ext = '.gif'
            elif 'webp' in mime: ext = '.webp'
            else:               ext = '.jpg'
            filename = f"{prefix}{ext}"
            (COMPANIONS_DIR / companion_folder / filename).write_bytes(raw)
            return filename
    except Exception:
        return ""


def delete_avatar_files(companion_folder: str) -> None:
    """Delete all avatar image files for a companion folder (both slots)."""
    for prefix in ('avatar', 'sidebar_avatar'):
        for ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp'):
            p = COMPANIONS_DIR / companion_folder / f"{prefix}{ext}"
            if p.exists():
                try: p.unlink()
                except Exception: pass


def migrate_avatar(companion_folder: str, companion_cfg: dict) -> dict:
    """
    One-time migration: if config has avatar_data but no avatar_path,
    extract the base64 to a file, update config on disk, and return
    the updated config dict (without avatar_data).
    Idempotent — safe to call on every load.
    """
    if companion_cfg.get("avatar_path") or not companion_cfg.get("avatar_data"):
        return companion_cfg
    filename = write_avatar_file(companion_folder, companion_cfg["avatar_data"])
    if not filename:
        return companion_cfg
    cfg = {k: v for k, v in companion_cfg.items() if k != "avatar_data"}
    cfg["avatar_path"] = filename
    save_companion_config(companion_folder, cfg)
    return cfg


def list_companions() -> list[dict]:
    """
    Return all companion folders as [{folder, name, avatar_url}].
    Migrates avatar_data → file for any companion that hasn't been migrated yet.
    """
    if not COMPANIONS_DIR.exists():
        return []
    result = []
    for d in sorted(COMPANIONS_DIR.iterdir()):
        if not d.is_dir():
            continue
        cfg = load_companion_config(d.name)
        cfg = migrate_avatar(d.name, cfg)
        result.append({
            "folder":      d.name,
            "name":        cfg.get("companion_name", d.name),
            "avatar_url":  f"/api/companion/{d.name}/avatar" if cfg.get("avatar_path") else "",
        })
    return result


# ── Server command builder ─────────────────────────────────────────────────────

def build_server_command(config: dict, binary: str) -> list[str]:
    """
    Build the llama-server argument list from config.
    Handles built-in toggleable args + custom args.
    """
    args = [binary, "-m", config["model_path"]]

    if config.get("mmproj_path"):
        args += ["--mmproj", config["mmproj_path"]]

    args += ["--port", str(config.get("port_model", 8081))]

    for key, spec in config.get("server_args", DEFAULTS["server_args"]).items():
        if not spec.get("enabled", False):
            continue
        flag = spec["flag"]
        val  = spec.get("value")
        args.append(flag)
        if val is not None:
            args.append(str(val))

    for custom in config.get("server_args_custom", []):
        if not custom.get("enabled", True):
            continue
        if custom.get("flag"):
            args.append(custom["flag"])
            if custom.get("value"):
                args.append(str(custom["value"]))

    return args
