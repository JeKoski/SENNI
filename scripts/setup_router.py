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
import urllib.request
import zipfile
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from scripts.config import PROJECT_ROOT, detect_gpu, load_config, save_config

router = APIRouter()

IS_WIN = platform.system() == "Windows"
SYSTEM = platform.system()

BINARY_DIR = PROJECT_ROOT / "llama"
MODELS_DIR = PROJECT_ROOT / "models"
BINARY_NAME = "llama-server.exe" if IS_WIN else "llama-server"
LLAMA_CPP_REPO = "ggml-org/llama.cpp"

# ── Curated model list ─────────────────────────────────────────────────────────
# To add a new model: append an entry. All fields are displayed in the wizard UI.

MODELS = [
    {
        "id":          "gemma4-e4b-q4km",
        "name":        "Gemma 4 E4B Q4_K_M",
        "description": "SENNI's primary model. Fast, capable, great for companions.",
        "size_gb":     3.0,
        "badge":       "Recommended",
        "url":         "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
        "filename":    "gemma-4-E4B-it-Q4_K_M.gguf",
    },
    {
        "id":          "qwen35-9b-q4km",
        "name":        "Qwen 3.5 9B Q4_K_M",
        "description": "Better reasoning. Needs more RAM / VRAM.",
        "size_gb":     5.5,
        "badge":       "More capable",
        "url":         "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf",
        "filename":    "Qwen3.5-9B-Q4_K_M.gguf",
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


def _find_binary_asset(assets: list[dict], build_type: str) -> dict | None:
    """Return best-matching GitHub release asset for build_type, with fallback."""
    platform_patterns = BINARY_PATTERNS.get(SYSTEM, {})

    def _match(btype: str) -> dict | None:
        for pattern in platform_patterns.get(btype, []):
            for asset in assets:
                if pattern.lower() in asset["name"].lower():
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
) -> None:
    """
    Downloads `url` to `dest` in a thread pool.
    Pushes progress dicts onto `queue` via the event loop at ~4 Hz.
    Pushes {"type":"download_done"} or {"type":"error",...} when finished.
    """
    import time

    def push(obj: dict) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, obj)

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "SENNI-setup/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total      = int(resp.headers.get("Content-Length") or 0)
            dest.parent.mkdir(parents=True, exist_ok=True)
            downloaded = 0
            t0         = time.time()
            last_push  = 0.0

            with open(dest, "wb") as fh:
                while True:
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

        push({"type": "download_done"})

    except Exception as e:
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


# ── Routes ─────────────────────────────────────────────────────────────────────

def _scan_default_binary() -> str:
    """Fallback: find llama-server binary in the default BINARY_DIR."""
    hits = list(BINARY_DIR.rglob(BINARY_NAME))
    return str(hits[0]) if hits else ""


def _scan_default_model() -> str:
    """Fallback: find first .gguf in the default MODELS_DIR."""
    hits = list(MODELS_DIR.glob("*.gguf"))
    return str(hits[0]) if hits else ""


@router.get("/api/setup/status")
async def setup_status():
    config = load_config()
    binary = config.get("server_binary", "")
    model  = config.get("model_path", "")

    # If config path is missing or stale, scan default directories
    if not (binary and Path(binary).exists()):
        binary = _scan_default_binary()
    if not (model and Path(model).exists()):
        model = _scan_default_model()

    gpu    = detect_gpu()
    oneapi = _detect_oneapi()
    return {
        "binary_path":    binary,
        "binary_found":   bool(binary),
        "model_path":     model,
        "model_found":    bool(model),
        "gpu":            gpu,
        "build_type":     _gpu_to_build(gpu, oneapi),
        "oneapi_present": oneapi,
        "platform":       SYSTEM,
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
    body     = await request.json()
    model_id = body.get("model_id", "")
    dest_dir = Path(body["dest_dir"]) if body.get("dest_dir") else MODELS_DIR

    model = next((m for m in MODELS if m["id"] == model_id), None)

    async def stream() -> AsyncGenerator[str, None]:
        if not model:
            yield _sse({"type": "error", "message": f"Unknown model id: {model_id!r}"})
            return

        dest       = dest_dir / model["filename"]
        size_bytes = int(model["size_gb"] * 1024 ** 3)
        yield _sse({"type": "status", "label": f"Downloading {model['name']}…", "total": size_bytes})

        loop  = asyncio.get_event_loop()
        queue = asyncio.Queue()
        dl    = functools.partial(_download_to_queue, model["url"], dest, queue, loop)
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
        await loop.run_in_executor(None, functools.partial(_save_model_path, dest))
        yield _sse({"type": "done", "path": str(dest)})

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── Extras: package labels and pip names ───────────────────────────────────────
_EXTRAS_ORDER = ("tts", "memory")
_EXTRAS_META  = {
    "tts":    ("kokoro",   "Voice (Kokoro TTS)"),
    "memory": ("chromadb", "Memory (ChromaDB)"),
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

        for step, key in enumerate(to_install, start=1):
            pkg, label = _EXTRAS_META[key]
            yield _sse({
                "type": "status",
                "label": f"Installing {label}\u2026",
                "step":  step,
                "total": total,
            })

            queue: asyncio.Queue = asyncio.Queue()

            def _run_pip(pkg: str = pkg) -> None:
                import subprocess
                import sys
                try:
                    proc = subprocess.Popen(
                        [sys.executable, "-m", "pip", "install", "--upgrade", pkg],
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        text=True, bufsize=1,
                    )
                    proc.communicate()  # wait; output not forwarded (too noisy for wizard UI)
                    if proc.returncode != 0:
                        loop.call_soon_threadsafe(
                            queue.put_nowait,
                            {"type": "error", "message": f"pip failed for {pkg} (exit {proc.returncode})"},
                        )
                    else:
                        loop.call_soon_threadsafe(queue.put_nowait, {"type": "pkg_done"})
                except Exception as exc:
                    loop.call_soon_threadsafe(queue.put_nowait, {"type": "error", "message": str(exc)})

            pip_task = loop.run_in_executor(None, _run_pip)

            msg = await queue.get()
            await pip_task
            if msg["type"] == "error":
                yield _sse(msg)
                return

            yield _sse({"type": "progress", "pct": int(step / total * 100)})

        yield _sse({"type": "done"})

    return StreamingResponse(stream(), media_type="text/event-stream")
