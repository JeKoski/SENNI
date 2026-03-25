"""
config.py — Configuration management & hardware detection

Handles:
- Reading and writing config.json
- Auto-detecting GPU type and platform
- Scanning for .gguf model files in common locations
- Resolving all paths relative to the project root (fully portable)
"""

import json
import os
import platform
import subprocess
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────

# The project root is always the parent of this file's folder (scripts/)
PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE  = PROJECT_ROOT / "config.json"

# Companion data lives here — one subfolder per companion
COMPANIONS_DIR = PROJECT_ROOT / "companions"

# ── Defaults ───────────────────────────────────────────────────────────────────

DEFAULTS = {
    # Identity
    "companion_name":   "your companion",
    "companion_folder": "default",

    # Model / hardware
    "model_path":       "",
    "mmproj_path":      "",
    "gpu_type":         "cpu",
    "port_bridge":      8000,
    "port_model":       8081,
    "first_run":        True,

    # Built-in server args
    "server_args": {
        # Core — always on
        "ngl":              {"enabled": True,  "value": 99,           "flag": "-ngl"},
        "ctx":              {"enabled": True,  "value": 16384,        "flag": "-c"},
        "np":               {"enabled": True,  "value": 1,            "flag": "-np"},
        "ctk":              {"enabled": True,  "value": "q8_0",       "flag": "-ctk"},
        "ctv":              {"enabled": True,  "value": "q8_0",       "flag": "-ctv"},
        "jinja":            {"enabled": True,  "value": None,         "flag": "--jinja"},
        "reasoning_format": {"enabled": True,  "value": "deepseek",   "flag": "--reasoning-format"},
        # KV cache / performance
        "cache_reuse":      {"enabled": True,  "value": 256,          "flag": "--cache-reuse"},
        "batch":            {"enabled": True,  "value": 256,          "flag": "-b"},
        "ubatch":           {"enabled": True,  "value": 256,          "flag": "-ub"},
        # Prompt cache — persist KV cache to disk (speeds up repeated system prompts)
        "prompt_cache":     {"enabled": False, "value": "senni.cache", "flag": "--prompt-cache"},
        # Memory / safety
        "mlock":            {"enabled": False, "value": None,          "flag": "--mlock"},
        "no_mmap":          {"enabled": False, "value": None,          "flag": "--no-mmap"},
        # Flash attention — big speed win on supported hardware, off by default (compatibility)
        "flash_attn":       {"enabled": False, "value": None,          "flag": "--flash-attn"},
        # Thread count — 0 = auto-detect, override if needed
        "threads":          {"enabled": False, "value": 0,             "flag": "-t"},
    },

    # Custom args: list of {flag, value, enabled}
    "server_args_custom": [],

    # Global presence preset library — per-companion configs can add/override
    "presence_presets": {
        "Default": {
            "thinking":  {"glowColor":"rgba(129,140,248,0.4)","glowMax":16,"glowSpeed":2.0,"ringSpeed":1.8,"dotColor":"#818cf8","dotSpeed":1.2,"breathSpeed":3.0,"orbSize":52},
            "streaming": {"glowColor":"rgba(109,212,168,0.35)","glowMax":12,"glowSpeed":2.5,"ringSpeed":2.4,"dotColor":"#6dd4a8","dotSpeed":1.4,"breathSpeed":3.0,"orbSize":52},
            "heartbeat": {"glowColor":"rgba(167,139,250,0.45)","glowMax":20,"glowSpeed":1.4,"ringSpeed":1.4,"dotColor":"#a78bfa","dotSpeed":0.9,"breathSpeed":2.0,"orbSize":52},
            "chaos":     {"glowColor":"rgba(251,191,36,0.5)","glowMax":24,"glowSpeed":0.8,"ringSpeed":0.9,"dotColor":"#fbbf24","dotSpeed":0.6,"breathSpeed":0.6,"orbSize":52},
            "idle":      {"glowColor":"rgba(129,140,248,0.15)","glowMax":6,"glowSpeed":4.0,"ringSpeed":4.0,"dotColor":"#818cf8","dotSpeed":2.0,"breathSpeed":5.0,"orbSize":52},
        },
        "Warm": {
            "thinking":  {"glowColor":"rgba(251,146,60,0.4)","glowMax":18,"glowSpeed":2.2,"ringSpeed":2.0,"dotColor":"#fb923c","dotSpeed":1.3,"breathSpeed":3.5,"orbSize":52},
            "streaming": {"glowColor":"rgba(250,204,21,0.35)","glowMax":14,"glowSpeed":2.5,"ringSpeed":2.4,"dotColor":"#facc15","dotSpeed":1.4,"breathSpeed":3.5,"orbSize":52},
            "heartbeat": {"glowColor":"rgba(248,113,113,0.45)","glowMax":20,"glowSpeed":1.6,"ringSpeed":1.6,"dotColor":"#f87171","dotSpeed":1.0,"breathSpeed":2.2,"orbSize":52},
            "chaos":     {"glowColor":"rgba(239,68,68,0.5)","glowMax":26,"glowSpeed":0.7,"ringSpeed":0.8,"dotColor":"#ef4444","dotSpeed":0.5,"breathSpeed":0.5,"orbSize":52},
            "idle":      {"glowColor":"rgba(251,146,60,0.15)","glowMax":6,"glowSpeed":4.0,"ringSpeed":4.0,"dotColor":"#fb923c","dotSpeed":2.0,"breathSpeed":5.0,"orbSize":52},
        },
    },

    # Generation defaults (per-request, no restart needed)
    "generation": {
        "temperature":    0.8,
        "top_p":          0.95,
        "top_k":             40,
        "min_p":             0.0,
        "repeat_penalty":    1.1,
        "presence_penalty":  0.0,
        "frequency_penalty": 0.0,
        "dry_multiplier":    0.0,   # 0 = disabled
        "dry_base":          1.75,
        "dry_allowed_length": 2,
        "max_tokens":        1024,
        "max_tool_rounds":   8,
        "vision_mode":       "always",  # "always" | "once" | "ask"
        "markdown_enabled":  False,
    },
}

# ── Common locations to scan for .gguf files ───────────────────────────────────

SEARCH_HINTS = [
    # Linux / WSL common spots
    Path.home() / "models",
    Path.home() / "llama.cpp" / "models",
    Path("/mnt/windows_data/AI"),
    Path("/opt/models"),
    # Windows common spots (resolved if running natively on Windows)
    Path("C:/AI/models"),
    Path("D:/AI/models"),
    Path("C:/Users") / os.environ.get("USERNAME", "") / "models",
    # ComfyUI text_encoders (where the original project pointed)
    Path("/mnt/windows_data/AI/ComfyUI_Windows_portable/ComfyUI/models/text_encoders"),
    Path("D:/AI/ComfyUI_Windows_portable/ComfyUI/models/text_encoders"),
]


# ── GPU Detection ──────────────────────────────────────────────────────────────

def detect_gpu() -> str:
    """
    Try to identify the GPU type automatically.
    Returns one of: 'intel' | 'nvidia' | 'amd' | 'cpu'
    """
    system = platform.system()

    # ── Linux: read /proc/bus/pci or lspci ────────────────────────────────────
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

    # ── macOS: system_profiler ────────────────────────────────────────────────
    if system == "Darwin":
        try:
            result = subprocess.run(
                ["system_profiler", "SPDisplaysDataType"],
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

    return "cpu"


# ── Model file scanning ────────────────────────────────────────────────────────

def find_gguf_files() -> list[dict]:
    """
    Scan common directories for .gguf files.
    Returns a list of dicts: {path, name, size_gb}
    Only returns files that actually exist.
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
    in the same directory — for the user to pick from, not auto-select.
    Returns [{path, name}] or [] if none found.
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
    """
    if not CONFIG_FILE.exists():
        return dict(DEFAULTS)

    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        # Merge: defaults provide missing keys, saved values win otherwise
        return {**DEFAULTS, **saved}
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULTS)


def save_config(data: dict) -> None:
    """
    Write config.json to the project root.
    Merges with defaults so partial saves are safe.
    """
    merged = {**DEFAULTS, **data, "first_run": False}
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


# ── Convenience: build everything from scratch ─────────────────────────────────

def build_initial_config(
    model_path:  str,
    mmproj_path: str       = "",
    gpu_type:    str | None = None,
    ngl:         int        = 99,
    port_bridge: int        = 8000,
    port_model:  int        = 8081,
) -> dict:
    """
    Build a fresh config dict from wizard inputs.
    Auto-fills mmproj and gpu_type if not provided.
    """
    resolved_gpu = gpu_type or detect_gpu()

    return {
        **DEFAULTS,
        "model_path":  model_path,
        "mmproj_path": mmproj_path,
        "gpu_type":    resolved_gpu,
        "ngl":         ngl,
        "port_bridge": port_bridge,
        "port_model":  port_model,
        "first_run":   False,
    }


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
        "avatar_data":    "",   # base64 data-URL for the cropped avatar
        "generation":     dict(DEFAULTS["generation"]),
        "soul_edit_mode":   "locked",  # "locked" | "self_notes" | "agentic" | "chaos"
        "force_read_before_write": True,   # require read before writing any file
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
                "default":            "Reflect on the conversation. Update session notes with anything important. If something interesting came up that you could research, use web_search.",
                "idle":               "",
                "conversation_end":   "",
                "session_start":      "",
                "context_threshold":  "",
                "manual":             "",
            },
        },
    }
    if not path.exists():
        return base
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
        # Deep-merge generation and heartbeat overrides
        if "generation" in saved:
            base["generation"] = {**base["generation"], **saved["generation"]}
        if "heartbeat" in saved:
            base["heartbeat"] = {**base["heartbeat"], **saved["heartbeat"]}
        skip = {"generation", "heartbeat"}
        # force_read_before_write is a simple key — handled by the final merge above
        return {**base, **{k: v for k, v in saved.items() if k not in skip}}
    except Exception:
        return base


def save_companion_config(companion_folder: str, data: dict) -> None:
    """Save per-companion config to companions/<folder>/config.json."""
    path = COMPANIONS_DIR / companion_folder / "config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def list_companions() -> list[dict]:
    """
    Return all companion folders as [{folder, name, avatar_data}].
    """
    if not COMPANIONS_DIR.exists():
        return []
    result = []
    for d in sorted(COMPANIONS_DIR.iterdir()):
        if not d.is_dir():
            continue
        cfg = load_companion_config(d.name)
        result.append({
            "folder":      d.name,
            "name":        cfg.get("companion_name", d.name),
            "avatar_data": cfg.get("avatar_data", ""),
        })
    return result


# ── Server command builder ─────────────────────────────────────────────────────

def build_server_command(config: dict, binary: str) -> list[str]:
    """
    Build the llama-server argument list from config.
    Handles built-in toggleable args + custom args.
    Replaces the old hard-coded arg list in server.py.
    """
    args = [binary, "-m", config["model_path"]]

    if config.get("mmproj_path"):
        args += ["--mmproj", config["mmproj_path"]]

    # Port is always included
    args += ["--port", str(config.get("port_model", 8081))]

    # Built-in args
    for key, spec in config.get("server_args", DEFAULTS["server_args"]).items():
        if not spec.get("enabled", False):
            continue
        flag = spec["flag"]
        val  = spec.get("value")
        args.append(flag)
        if val is not None:
            args.append(str(val))

    # Custom args
    for custom in config.get("server_args_custom", []):
        if not custom.get("enabled", True):
            continue
        if custom.get("flag"):
            args.append(custom["flag"])
            if custom.get("value"):
                args.append(str(custom["value"]))

    return args
