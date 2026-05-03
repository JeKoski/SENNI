"""
setup_router.py — /api/setup/* endpoints for the first-run setup wizard.

Provides:
  GET  /api/setup/status           — binary/model/GPU detection
  GET  /api/setup/models           — curated starter model list
  POST /api/setup/download-binary  — download llama-server (SSE progress)
  POST /api/setup/download-model   — download a starter model (SSE progress)
"""

import asyncio
import functools
import json
import platform
import tarfile
import threading
import urllib.request
import zipfile
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from scripts.config import detect_gpu, instantiate_companion_template, load_config, save_config
from scripts.paths import BINARY_DIR, COMPANIONS_DIR, FEATURES_DIR, FEATURES_PACKAGES_DIR, MODELS_DIR

router = APIRouter()

IS_WIN = platform.system() == "Windows"
SYSTEM = platform.system()
BINARY_NAME = "llama-server.exe" if IS_WIN else "llama-server"
LLAMA_CPP_REPO = "ggml-org/llama.cpp"

# ── Curated model list ─────────────────────────────────────────────────────────
# To add a new model: append an entry. All fields are displayed in the wizard UI.

MODELS = [
    {
        "id":              "gemma4-e4b-q4km",
        "name":            "Gemma 4 E4B Q4_K_M",
        "description":     "SENNI's primary model. Fast, capable, great for companions.",
        "size_gb":         3.0,
        "badge":           "Recommended",
        "subfolder":       "gemma4-e4b",
        "url":             "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
        "filename":        "gemma-4-E4B-it-Q4_K_M.gguf",
        "multimodal":      True,
        "mmproj_url":      "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/mmproj-F16.gguf",
        "mmproj_filename": "mmproj-F16.gguf",
        "mmproj_size_gb":  1.0,
    },
    {
        "id":              "qwen35-9b-q4km",
        "name":            "Qwen 3.5 9B Q4_K_M",
        "description":     "Better reasoning. Needs more RAM / VRAM.",
        "size_gb":         5.5,
        "badge":           "More capable",
        "subfolder":       "qwen35-9b",
        "url":             "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
        "filename":        "Qwen3.5-9B-Q4_K_M.gguf",
        "multimodal":      True,
        "mmproj_url":      "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/mmproj-F16.gguf",
        "mmproj_filename": "mmproj-F16.gguf",
        "mmproj_size_gb":  0.6,
    },
]

# ── Binary asset name patterns ─────────────────────────────────────────────────
# Maps platform → build_type → ordered list of asset name substrings.
# First substring that matches any asset name wins.

BINARY_PATTERNS: dict[str, dict[str, list[str]]] = {
    "Windows": {
        "cuda":   ["win-cuda"],
        "sycl":   ["win-sycl"],
        "vulkan": ["win-vulkan"],
        "cpu":    ["win-avx2", "win-avx"],
    },
    "Linux": {
        "cuda":   ["ubuntu-cuda", "linux-cuda"],
        "sycl":   ["ubuntu-sycl", "linux-sycl"],
        "vulkan": ["ubuntu-x64",  "linux-x64"],
        "cpu":    ["ubuntu-x64",  "linux-x64"],
    },
}

# Fallback chain when preferred build type has no matching asset
_BUILD_FALLBACKS = ["vulkan", "cpu"]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _detect_oneapi() -> bool:
    if IS_WIN:
        return any(
            Path(p).exists() for p in [
                r"C:\Program Files (x86)\Intel\oneAPI",
                r"C:\Program Files\Intel\oneAPI",
            ]
        )
    return Path("/opt/intel/oneapi").exists()


def _gpu_to_build(gpu: str, oneapi: bool) -> str:
    """Map detect_gpu() value → llama.cpp build type."""
    if gpu == "nvidia":
        return "cuda"
    if gpu == "intel":
        return "sycl" if oneapi else "vulkan"
    if gpu == "amd":
        return "vulkan"
    return "cpu"


def _find_cudart_asset(assets: list[dict], main_asset_name: str) -> dict | None:
    """Find matching cudart DLL zip for a CUDA binary asset (Windows CUDA only)."""
    import re
    m = re.search(r"cuda-(\d+\.\d+)", main_asset_name)
    cuda_ver = m.group(1) if m else None
    # Prefer version-matched asset, fall back to any win cudart
    candidates = [
        a for a in assets
        if a["name"].lower().startswith("cudart-") and "win-cuda" in a["name"].lower()
    ]
    if cuda_ver:
        for a in candidates:
            if cuda_ver in a["name"]:
                return a
    return candidates[0] if candidates else None


def _find_binary_asset(assets: list[dict], build_type: str) -> dict | None:
    """Return best-matching GitHub release asset for build_type, with fallback."""
    platform_patterns = BINARY_PATTERNS.get(SYSTEM, {})

    def _match(btype: str) -> dict | None:
        for pattern in platform_patterns.get(btype, []):
            for asset in assets:
                name = asset["name"].lower()
                if name.startswith("cudart-"):
                    continue  # cudart DLL zips are not the main binary
                if pattern.lower() in name:
                    return asset
        return None

    result = _match(build_type)
    if result:
        return result
    for fallback in _BUILD_FALLBACKS:
        if fallback != build_type:
            result = _match(fallback)
            if result:
                return result
    return None


def _fetch_latest_release() -> dict:
    url = f"https://api.github.com/repos/{LLAMA_CPP_REPO}/releases/latest"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "SENNI-setup/1.0", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def _download_to_queue(
    url: str,
    dest: Path,
    queue: asyncio.Queue,
    loop: asyncio.AbstractEventLoop,
    cancel_event: threading.Event | None = None,
) -> None:
    """
    Downloads `url` to a .tmp file beside `dest`, then renames on success.
    Checks cancel_event each chunk — deletes the .tmp and exits cleanly if set.
    Pushes progress dicts onto `queue` via the event loop at ~4 Hz.
    Pushes {"type":"download_done"} or {"type":"error",...} when finished.
    """
    import time

    def push(obj: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, obj)

    tmp = dest.with_name(dest.name + ".tmp")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SENNI-setup/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total      = int(resp.headers.get("Content-Length") or 0)
            dest.parent.mkdir(parents=True, exist_ok=True)
            downloaded = 0
            t0         = time.time()
            last_push  = 0.0

            with open(tmp, "wb") as fh:
                while True:
                    if cancel_event and cancel_event.is_set():
                        tmp.unlink(missing_ok=True)
                        return
                    buf = resp.read(65536)
                    if not buf:
                        break
                    fh.write(buf)
                    downloaded += len(buf)
                    now = time.time()
                    if now - last_push >= 0.25:
                        elapsed  = max(now - t0, 0.001)
                        speed    = downloaded / elapsed
                        pct      = int(downloaded / total * 100) if total else 0
                        push({"type": "progress", "downloaded": downloaded,
                              "total": total, "speed_bps": int(speed), "pct": pct})
                        last_push = now

        tmp.rename(dest)
        push({"type": "download_done"})

    except Exception as e:
        tmp.unlink(missing_ok=True)
        push({"type": "error", "message": str(e)})


def _extract_binary(archive: Path, dest_dir: Path) -> Path | None:
    """Extract zip or tar.gz to dest_dir. Returns path to the llama-server binary."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    if archive.name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(dest_dir)
    else:
        with tarfile.open(archive) as tf:
            tf.extractall(dest_dir)
    found = list(dest_dir.rglob(BINARY_NAME))
    return found[0] if found else None


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj)}\n\n"


def _save_binary_path(binary_path: Path) -> None:
    config = load_config()
    config["server_binary"] = str(binary_path)
    if not isinstance(config.get("server_binaries"), dict):
        config["server_binaries"] = {}
    config["server_binaries"][SYSTEM] = str(binary_path)
    save_config(config)


def _save_model_path(model_path: Path) -> None:
    config = load_config()
    config["model_path"] = str(model_path)
    if not isinstance(config.get("model_paths"), dict):
        config["model_paths"] = {}
    config["model_paths"][SYSTEM] = str(model_path)
    save_config(config)


def _save_mmproj_path(mmproj_path: Path) -> None:
    config = load_config()
    config["mmproj_path"] = str(mmproj_path)
    if not isinstance(config.get("mmproj_paths"), dict):
        config["mmproj_paths"] = {}
    config["mmproj_paths"][SYSTEM] = str(mmproj_path)
    save_config(config)


# ── Routes ─────────────────────────────────────────────────────────────────────

def _scan_default_binary() -> str:
    """Fallback: find llama-server binary in the default BINARY_DIR."""
    hits = list(BINARY_DIR.rglob(BINARY_NAME))
    return str(hits[0]) if hits else ""


def _scan_default_model() -> str:
    """Fallback: find first .gguf in MODELS_DIR, searching subfolders too."""
    hits = [p for p in MODELS_DIR.rglob("*.gguf") if "mmproj" not in p.name.lower()]
    return str(hits[0]) if hits else ""


@router.get("/api/setup/status")
async def setup_status():
    instantiate_companion_template("senni", "senni")   # no-op if already exists

    config = load_config()
    binary = config.get("server_binary", "")
    model  = config.get("model_path", "")
    mmproj = config.get("mmproj_path", "")

    # If config path is missing or stale, scan default directories
    if not (binary and Path(binary).exists()):
        binary = _scan_default_binary()
    if not (model and Path(model).exists()):
        model = _scan_default_model()
    if mmproj and not Path(mmproj).exists():
        mmproj = ""

    # Which Senni-managed models are already on disk?
    downloaded = []
    for m in MODELS:
        subfolder   = m.get("subfolder", m["id"])
        model_file  = MODELS_DIR / subfolder / m["filename"]
        mmproj_file = MODELS_DIR / subfolder / m.get("mmproj_filename", "")
        if model_file.exists():
            downloaded.append({
                "id":          m["id"],
                "path":        str(model_file),
                "mmproj_path": str(mmproj_file) if mmproj_file.name and mmproj_file.exists() else "",
            })

    gpu    = detect_gpu()
    oneapi = _detect_oneapi()
    return {
        "binary_path":       binary,
        "binary_found":      bool(binary),
        "model_path":        model,
        "model_found":       bool(model),
        "mmproj_path":       mmproj,
        "downloaded_models": downloaded,
        "gpu":               gpu,
        "build_type":        _gpu_to_build(gpu, oneapi),
        "oneapi_present":    oneapi,
        "platform":          SYSTEM,
        "senni_companion":   (COMPANIONS_DIR / "senni").exists(),
    }


@router.get("/api/setup/models")
async def setup_models():
    return {"models": MODELS}


@router.post("/api/setup/download-binary")
async def setup_download_binary(request: Request):
    body      = await request.json()
    gpu       = body.get("gpu_type") or detect_gpu()
    oneapi    = body.get("oneapi_present", _detect_oneapi())
    build     = body.get("build_type") or _gpu_to_build(gpu, oneapi)
    dest_dir  = Path(body["dest_dir"]) if body.get("dest_dir") else BINARY_DIR

    async def stream() -> AsyncGenerator[str, None]:
        loop = asyncio.get_event_loop()

        yield _sse({"type": "status", "label": "Checking latest release…"})
        try:
            release = await loop.run_in_executor(None, _fetch_latest_release)
        except Exception as e:
            yield _sse({"type": "error", "message": f"Could not reach GitHub: {e}"})
            return

        asset = _find_binary_asset(release.get("assets", []), build)
        if not asset:
            yield _sse({"type": "error", "message": f"No binary found for {SYSTEM} / {build}"})
            return

        archive_path = dest_dir / asset["name"]
        size_bytes   = asset.get("size", 0)
        yield _sse({"type": "status", "label": f"Downloading {asset['name']}…", "total": size_bytes})

        queue = asyncio.Queue()
        dl    = functools.partial(_download_to_queue, asset["browser_download_url"], archive_path, queue, loop)
        dl_task = loop.run_in_executor(None, dl)

        while True:
            msg = await queue.get()
            if msg["type"] == "progress":
                yield _sse(msg)
            elif msg["type"] == "download_done":
                break
            elif msg["type"] == "error":
                yield _sse(msg)
                return

        await dl_task

        # ── CUDA on Windows: also grab cudart DLLs ───────────────────────────
        if IS_WIN and build == "cuda":
            cudart_asset = _find_cudart_asset(release.get("assets", []), asset["name"])
            if cudart_asset:
                cudart_path = dest_dir / cudart_asset["name"]
                yield _sse({"type": "status", "label": f"Downloading {cudart_asset['name']}…",
                            "total": cudart_asset.get("size", 0)})
                cudart_queue = asyncio.Queue()
                cudart_dl = functools.partial(
                    _download_to_queue, cudart_asset["browser_download_url"],
                    cudart_path, cudart_queue, loop
                )
                cudart_task = loop.run_in_executor(None, cudart_dl)
                while True:
                    msg = await cudart_queue.get()
                    if msg["type"] == "progress":
                        yield _sse(msg)
                    elif msg["type"] == "download_done":
                        break
                    elif msg["type"] == "error":
                        yield _sse({"type": "status", "label": "cudart download failed — continuing anyway"})
                        break
                await cudart_task
                if cudart_path.exists():
                    await loop.run_in_executor(
                        None, functools.partial(_extract_binary, cudart_path, dest_dir)
                    )
                    cudart_path.unlink(missing_ok=True)

        yield _sse({"type": "status", "label": "Extracting…"})
        binary_path = await loop.run_in_executor(
            None, functools.partial(_extract_binary, archive_path, dest_dir)
        )
        archive_path.unlink(missing_ok=True)

        if not binary_path:
            yield _sse({"type": "error", "message": f"Could not find {BINARY_NAME} in archive"})
            return

        if not IS_WIN:
            binary_path.chmod(binary_path.stat().st_mode | 0o111)

        await loop.run_in_executor(None, functools.partial(_save_binary_path, binary_path))
        yield _sse({"type": "done", "path": str(binary_path)})

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/api/setup/download-model")
async def setup_download_model(request: Request):
    body           = await request.json()
    model_id       = body.get("model_id", "")
    include_mmproj = body.get("include_mmproj", False)
    model          = next((m for m in MODELS if m["id"] == model_id), None)

    async def stream() -> AsyncGenerator[str, None]:
        if not model:
            yield _sse({"type": "error", "message": f"Unknown model id: {model_id!r}"})
            return

        subfolder = model.get("subfolder", model_id)
        dest_dir  = MODELS_DIR / subfolder
        dest_dir.mkdir(parents=True, exist_ok=True)

        loop = asyncio.get_event_loop()

        # ── Phase 1: model ────────────────────────────────────────────────────
        dest       = dest_dir / model["filename"]
        size_bytes = int(model["size_gb"] * 1024 ** 3)
        yield _sse({"type": "status", "label": f"Downloading {model['name']}…", "total": size_bytes, "phase": "model"})

        cancel  = threading.Event()
        queue   = asyncio.Queue()
        dl      = functools.partial(_download_to_queue, model["url"], dest, queue, loop, cancel)
        dl_task = loop.run_in_executor(None, dl)

        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if await request.is_disconnected():
                    cancel.set()
                    return
                continue
            if msg["type"] == "progress":
                yield _sse({**msg, "phase": "model"})
            elif msg["type"] == "download_done":
                break
            elif msg["type"] == "error":
                yield _sse(msg)
                return

        await dl_task
        await loop.run_in_executor(None, functools.partial(_save_model_path, dest))

        # ── Phase 2: mmproj (optional) ────────────────────────────────────────
        want_mmproj = include_mmproj and model.get("multimodal") and model.get("mmproj_url")
        if not want_mmproj:
            yield _sse({"type": "done", "path": str(dest), "mmproj_path": ""})
            return

        mmproj_dest = dest_dir / model["mmproj_filename"]
        mmproj_size = int(model.get("mmproj_size_gb", 1.0) * 1024 ** 3)
        yield _sse({"type": "status", "label": "Downloading vision projector (mmproj)…", "total": mmproj_size, "phase": "mmproj"})

        cancel  = threading.Event()
        queue   = asyncio.Queue()
        dl      = functools.partial(_download_to_queue, model["mmproj_url"], mmproj_dest, queue, loop, cancel)
        dl_task = loop.run_in_executor(None, dl)

        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                if await request.is_disconnected():
                    cancel.set()
                    return
                continue
            if msg["type"] == "progress":
                yield _sse({**msg, "phase": "mmproj"})
            elif msg["type"] == "download_done":
                break
            elif msg["type"] == "error":
                yield _sse(msg)
                return

        await dl_task
        await loop.run_in_executor(None, functools.partial(_save_mmproj_path, mmproj_dest))
        yield _sse({"type": "done", "path": str(dest), "mmproj_path": str(mmproj_dest)})

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── Extras: pip Python resolver ───────────────────────────────────────────────

def _find_preferred_python() -> str:
    """
    Find the best Python for creating the features venv.
    Prefers 3.12 (most compatible with kokoro + chromadb deps).
    Falls back through 3.11, system python3, then sys.executable.
    """
    import shutil, sys, subprocess
    # Windows py launcher — covers standard python.org installs
    py_launcher = shutil.which("py")
    if py_launcher:
        for ver in ("3.12", "3.11"):
            try:
                r = subprocess.run([py_launcher, f"-{ver}", "-c",
                                    "import sys; print(sys.executable)"],
                                   capture_output=True, text=True, timeout=5)
                if r.returncode == 0 and r.stdout.strip():
                    return r.stdout.strip()
            except Exception:
                pass
    for name in ("python3.12", "python3.11", "python3"):
        hit = shutil.which(name)
        if hit:
            return hit
    return sys.executable


def _get_pip_python() -> str:
    """
    Return the Python executable to use for pip installs.

    Priority:
      1. Bundled Python embeddable (python-embed/python.exe) — frozen mode
      2. features/venv Python — dev mode (venv created with Python 3.12 if available)
      3. sys.executable fallback if venv creation fails
    """
    import sys, subprocess
    from scripts.paths import PYTHON_EMBED_DIR, FEATURES_VENV_DIR

    if getattr(sys, "frozen", False):
        import shutil
        for name in ("python.exe", "python3", "python"):
            candidate = PYTHON_EMBED_DIR / name
            if candidate.exists():
                return str(candidate)
        return shutil.which("python3") or shutil.which("python") or sys.executable

    # Dev mode — create venv with preferred Python (3.12) if it doesn't exist yet
    is_win  = sys.platform == "win32"
    venv_py = FEATURES_VENV_DIR / ("Scripts/python.exe" if is_win else "bin/python")
    if not venv_py.exists():
        base_py = _find_preferred_python()
        subprocess.run([base_py, "-m", "venv", str(FEATURES_VENV_DIR), "--upgrade-deps"],
                       check=True)
    return str(venv_py) if venv_py.exists() else sys.executable


# ── Extras: package labels, pip names, install modes ──────────────────────────
_EXTRAS_ORDER = ("tts", "memory")
_EXTRAS_META  = {
    # numpy>=2.0 is listed first to ensure a Python 3.13-compatible wheel is
    # resolved before kokoro's transitive deps pull in numpy<2 (which has no
    # Python 3.13 wheel and would otherwise trigger a source build + MSVC).
    "tts":    (["numpy>=2.0", "kokoro", "soundfile"], "Voice (Kokoro TTS)"),
    "memory": (["chromadb"],            "Memory (ChromaDB)"),
}

# "embed"  → install into embedded Python's own site-packages (no --target).
#            Required for ALL binary packages — native extensions (.pyd/.so) fail
#            to load their DLL dependencies when installed via --target on Windows.
#            Both kokoro (numpy/soundfile) and chromadb (chromadb_rust_bindings)
#            hit this. "embed" keeps DLLs co-located where Windows can find them.
# "target" → reserved for pure-Python packages only (none currently).
_EXTRAS_INSTALL_MODE = {
    "tts":    "embed",
    "memory": "embed",
}

# Package name used to detect whether an extra is installed.
# Kept separate from _EXTRAS_META install order so detection checks the actual
# feature package (e.g. "kokoro") rather than a common dep like "numpy" that
# may already be present on the system and give a false positive.
_EXTRAS_DETECT = {
    "tts":    "kokoro",
    "memory": "chromadb",
}

# Extra commands to run via the pip Python after the main install.
# Each entry is a list of args passed to [python, *args].
_EXTRAS_POST_CMDS = {
    "tts":    [["-m", "spacy", "download", "en_core_web_sm"]],
    "memory": [],
}


def _detect_extra(key: str) -> dict:
    """
    Check if an extra is installed in the right location for the current run mode.
    Uses _EXTRAS_DETECT[key] as the indicator package.
    """
    import sys
    from scripts.paths import PYTHON_EMBED_DIR, FEATURES_VENV_DIR, venv_site_packages
    primary_mod = _EXTRAS_DETECT[key]

    if getattr(sys, "frozen", False):
        embed_sp = PYTHON_EMBED_DIR / "Lib" / "site-packages" / primary_mod
        if embed_sp.is_dir():
            return {"installed": True, "path": str(embed_sp.parent), "source": "local"}
        return {"installed": False, "path": "", "source": ""}

    # Dev mode — look in features/venv only (avoids false positives from system Python)
    sp = venv_site_packages(FEATURES_VENV_DIR)
    if sp and (sp / primary_mod).is_dir():
        return {"installed": True, "path": str(sp), "source": "local"}
    return {"installed": False, "path": "", "source": ""}


def _detect_espeak() -> dict:
    """Detect espeak-ng binary via config path or PATH lookup."""
    import shutil
    cfg_path = load_config().get("tts", {}).get("espeak_path", "").strip()
    if cfg_path and Path(cfg_path).exists():
        return {"found": True, "path": cfg_path, "source": "config"}
    hit = shutil.which("espeak-ng") or shutil.which("espeak")
    if hit:
        return {"found": True, "path": hit, "source": "path"}
    return {"found": False, "path": "", "source": ""}


@router.post("/api/setup/complete")
async def setup_mark_complete():
    """Called by the wizard after successful boot. Marks setup as done."""
    config = load_config()
    config["setup_complete"] = True
    save_config(config)
    return {"ok": True}


@router.get("/api/setup/extras-status")
async def setup_extras_status():
    """Return installation state for each optional extra, plus espeak detection."""
    return {
        **{key: _detect_extra(key) for key in _EXTRAS_ORDER},
        "espeak": _detect_espeak(),
    }


@router.post("/api/setup/install-extras")
async def setup_install_extras(request: Request):
    """Install optional packages (kokoro TTS, chromadb) with SSE progress."""
    body       = await request.json()
    to_install = [k for k in _EXTRAS_ORDER if body.get(k)]

    async def stream() -> AsyncGenerator[str, None]:
        if not to_install:
            yield _sse({"type": "done"})
            return

        loop  = asyncio.get_event_loop()
        total = len(to_install)

        FEATURES_PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
        for step, key in enumerate(to_install, start=1):
            pkgs, label = _EXTRAS_META[key]
            mode        = _EXTRAS_INSTALL_MODE[key]
            yield _sse({
                "type": "status",
                "label": f"Installing {label}\u2026",
                "step":  step,
                "total": total,
            })

            queue: asyncio.Queue = asyncio.Queue()

            def _run_pip(pkgs: list = pkgs, mode: str = mode, key: str = key) -> None:
                import subprocess

                def push(obj: dict) -> None:
                    loop.call_soon_threadsafe(queue.put_nowait, obj)

                def push_log(line: str) -> None:
                    line = line.rstrip()
                    if line:
                        push({"type": "log", "line": line})

                py  = _get_pip_python()
                cmd = [py, "-m", "pip", "install", "--upgrade", "--no-cache-dir",
                       "--no-warn-script-location", "--prefer-binary"]
                if mode == "target":
                    cmd += ["--target", str(FEATURES_PACKAGES_DIR)]
                cmd.extend(pkgs)
                try:
                    proc = subprocess.Popen(
                        cmd,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        text=True, bufsize=1,
                    )
                    for line in proc.stdout:
                        push_log(line)
                    proc.wait()
                    if proc.returncode != 0:
                        push({"type": "error", "message": f"pip failed for {pkgs} (exit {proc.returncode})"})
                        return
                    # Run any post-install commands (e.g. spacy model download)
                    for post_args in _EXTRAS_POST_CMDS.get(key, []):
                        push_log(f"$ {' '.join(post_args)}")
                        r = subprocess.run(
                            [py, *post_args],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True,
                        )
                        for line in (r.stdout or "").splitlines():
                            push_log(line)
                        if r.returncode != 0:
                            push({"type": "error", "message": f"post-install failed: {post_args} (exit {r.returncode})"})
                            return
                    # Persist the install location in config so other components
                    # know which Python / path to use without re-detecting.
                    if key == "tts":
                        try:
                            from scripts.config import load_config, save_config
                            cfg = load_config()
                            cfg.setdefault("tts", {})["python_path"] = py
                            save_config(cfg)
                            push_log(f"[config] tts.python_path → {py}")
                        except Exception as ce:
                            push_log(f"[warn] could not save tts python_path: {ce}")
                    push({"type": "pkg_done"})
                except Exception as exc:
                    push({"type": "error", "message": str(exc)})

            pip_task = loop.run_in_executor(None, _run_pip)

            while True:
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        return
                    continue
                if msg["type"] == "log":
                    yield _sse(msg)
                elif msg["type"] == "pkg_done":
                    break
                elif msg["type"] == "error":
                    yield _sse(msg)
                    return

            await pip_task
            yield _sse({"type": "progress", "pct": int(step / total * 100)})

        yield _sse({"type": "done"})

    return StreamingResponse(stream(), media_type="text/event-stream")
