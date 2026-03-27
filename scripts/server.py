"""
server.py — FastAPI application

Serves:
- GET  /              → wizard (first run) or chat UI (returning user)
- GET  /wizard        → setup wizard HTML
- GET  /chat          → main chat HTML
- POST /api/setup     → save wizard config, returns {ok, companion_folder}
- GET  /api/status    → current config + tool list (for the UI)
- GET  /api/scan      → scan for .gguf files + detect GPU (wizard step 1)
- POST /api/boot      → start llama-server subprocess
- GET  /api/boot/log  → SSE stream of llama-server log lines
- POST /irina/message → MCP endpoint (tool calls from the model)
"""

import asyncio
import json
import logging
import os
import platform
import shlex
import subprocess
import threading
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from scripts.config import (
    PROJECT_ROOT,
    CONFIG_FILE,
    COMPANIONS_DIR,
    DEFAULTS,
    build_initial_config,
    build_server_command,
    detect_gpu,
    find_gguf_files,
    find_mmproj_candidates,
    get_companion_paths,
    list_companions,
    load_companion_config,
    load_config,
    save_companion_config,
    save_config,
)
from scripts.tool_loader import get_tool, load_tools

log = logging.getLogger(__name__)

# ── App setup ──────────────────────────────────────────────────────────────────

app = FastAPI(title="Companion", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = PROJECT_ROOT / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ── Global state ───────────────────────────────────────────────────────────────

_tool_manifest: list[dict] = []   # populated at startup
_llama_process: subprocess.Popen | None = None
_boot_log:      list[str]  = []   # all log lines since last (re)start
_boot_ready:    bool       = False


# ── Startup ────────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _tool_manifest
    _tool_manifest = load_tools()
    log.info("Server ready. %d tools loaded.", len(_tool_manifest))


# ── UI routes ──────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
    """Send the user to the wizard on first run, chat otherwise."""
    config = load_config()
    if config.get("first_run", True):
        return FileResponse(str(STATIC_DIR / "wizard.html"))
    return FileResponse(str(STATIC_DIR / "chat.html"))


@app.get("/wizard", response_class=HTMLResponse)
async def wizard():
    return FileResponse(str(STATIC_DIR / "wizard.html"))


@app.get("/chat", response_class=HTMLResponse)
async def chat():
    return FileResponse(str(STATIC_DIR / "chat.html"))


# ── API: scan (wizard step 1 data) ────────────────────────────────────────────

@app.get("/api/scan")
async def api_scan():
    """
    Return detected GPU and current platform.
    Platform is used by the wizard to show OS-appropriate GPU options
    (e.g. Apple Metal chip on macOS).
    """
    gpu = detect_gpu()
    return {
        "gpu_detected": gpu,
        "platform":     platform.system(),  # "Linux", "Windows", "Darwin"
    }


@app.get("/api/scan/models")
async def api_scan_models():
    """
    Optional: scan common directories for .gguf files.
    Only called when the user clicks 'Scan for models'.
    """
    files = find_gguf_files()
    return {"gguf_files": files}


@app.get("/api/mmproj-candidates")
async def api_mmproj_candidates(model_path: str = ""):
    """
    Given a model path, return any mmproj-like .gguf files
    found in the same directory — presented to the user to pick from,
    never auto-selected.
    """
    candidates = find_mmproj_candidates(model_path)
    return {"candidates": candidates}


@app.post("/api/browse")
async def api_browse(request: Request):
    """
    Open the OS native file picker on the server machine and return
    the selected path. Falls back gracefully if no GUI is available.
    """
    body      = await request.json()
    file_type = body.get("type", "model")   # "model" | "mmproj"
    title     = "Select mmproj file" if file_type == "mmproj" else "Select model file (.gguf)"

    # Try tkinter file dialog (works on Linux/Windows/Mac with a desktop)
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askopenfilename(
            title=title,
            filetypes=[("GGUF model files", "*.gguf"), ("All files", "*.*")],
        )
        root.destroy()
        if path:
            return {"ok": True, "path": path}
        return {"ok": False, "reason": "cancelled"}
    except Exception as e:
        return {"ok": False, "reason": str(e)}


# ── API: status ────────────────────────────────────────────────────────────────

def _merged_presence_presets(global_cfg: dict, companion_cfg: dict) -> dict:
    """Merge global presence presets with per-companion additions/overrides."""
    from scripts.config import DEFAULTS
    base    = dict(DEFAULTS.get("presence_presets", {}))
    global_ = global_cfg.get("presence_presets", {})
    local   = companion_cfg.get("presence_presets", {})
    # Deep merge: companion presets win, global overrides DEFAULTS, DEFAULTS are base
    merged  = {**base}
    for name, states in global_.items():
        merged[name] = {**(merged.get(name, {})), **states}
    for name, states in local.items():
        merged[name] = {**(merged.get(name, {})), **states}
    return merged


@app.get("/api/status")
async def api_status():
    """Return current config, loaded tool names, and model status."""
    config = load_config()

    # Check if llama-server process is alive — no HTTP call needed
    process_alive = (
        _llama_process is not None and
        _llama_process.poll() is None  # None means still running
    )
    # Also require that it reported ready at least once (model actually loaded)
    model_running = process_alive and _boot_ready

    # Load avatar from companion config so the sidebar can show it on startup
    companion_cfg = load_companion_config(config.get("companion_folder", "default"))

    # Read context window size from server_args so the UI can show a progress bar
    ctx_size = config.get("server_args", {}).get("ctx", {}).get("value", 16384)

    # Merge companion generation overrides on top of global generation settings
    global_gen    = config.get("generation", {})
    companion_gen = companion_cfg.get("generation", {})
    effective_gen = {**global_gen, **companion_gen}

    return {
        "config":                    {k: v for k, v in config.items() if k != "first_run"},
        "tools":                     [t["name"] for t in _tool_manifest],
        "model_running":             model_running,
        "avatar_data":               companion_cfg.get("avatar_data", ""),
        "companion_name":            companion_cfg.get("companion_name", config.get("companion_name", "")),
        "context_size":              int(ctx_size) if ctx_size else 16384,
        "effective_generation":      effective_gen,
        "companion_generation":      companion_gen,
        "force_read_before_write":   companion_cfg.get("force_read_before_write", True),
        "presence_presets":          _merged_presence_presets(config, companion_cfg),
        "active_presence_preset":    companion_cfg.get("active_presence_preset", "Default"),
        "moods":                     companion_cfg.get("moods", {}),
        "active_mood":               companion_cfg.get("active_mood", None),
    }


# ── API: setup (wizard final step) ────────────────────────────────────────────

@app.post("/api/setup")
async def api_setup(request: Request):
    """
    Receive wizard form data, save config, create companion folder structure.
    Expected JSON body:
    {
        "model_path":    str,
        "gpu_type":      str,   # intel | nvidia | amd | metal | cpu
        "ngl":           int,
        "port_bridge":   int,
        "port_model":    int,
    }
    """
    body = await request.json()

    config = build_initial_config(
        model_path  = body.get("model_path", ""),
        mmproj_path = body.get("mmproj_path", ""),
        gpu_type    = body.get("gpu_type"),
        ngl         = int(body.get("ngl", 99)),
        port_bridge = int(body.get("port_bridge", 8000)),
        port_model  = int(body.get("port_model", 8081)),
    )

    # Ensure companion folder structure exists
    get_companion_paths(config["companion_folder"])

    save_config(config)
    log.info("Config saved. Companion folder: %s", config["companion_folder"])

    return {"ok": True, "companion_folder": config["companion_folder"]}


# ── API: boot llama-server ─────────────────────────────────────────────────────

@app.post("/api/boot")
async def api_boot(request: Request):
    """
    Start llama-server if not already running.
    Pass {"force": true} in the JSON body to kill and restart (used by the
    Restart button in the UI). Without force, a running healthy process is
    left alone and we just return ok=True so the client can attach to the
    existing SSE log stream.
    """
    global _llama_process, _boot_log, _boot_ready

    config = load_config()
    if not config.get("model_path"):
        return {"ok": False, "error": "No model path configured."}

    # Parse optional body
    force = False
    try:
        body  = await request.json()
        force = bool(body.get("force", False))
    except Exception:
        pass

    # If already running and not forced, just say ok — don't restart
    already_running = (
        _llama_process is not None and
        _llama_process.poll() is None and
        _boot_ready
    )
    if already_running and not force:
        log.info("llama-server already running (pid %s), skipping boot", _llama_process.pid)
        return {"ok": True, "already_running": True}

    # Kill existing process if force or if it crashed/exited
    if _llama_process and _llama_process.poll() is None:
        log.info("Terminating llama-server (pid %s)…", _llama_process.pid)
        try:
            _llama_process.terminate()
            for _ in range(50):
                if _llama_process.poll() is not None:
                    break
                await asyncio.sleep(0.1)
            if _llama_process.poll() is None:
                _llama_process.kill()
                _llama_process.wait()
        except Exception as e:
            log.warning("Error stopping llama-server: %s", e)

    # Reset and launch
    _boot_log   = []
    _boot_ready = False
    _build_and_launch(config)
    log.info("llama-server launching…")
    return {"ok": True, "already_running": False}


def _build_and_launch(config: dict):
    """Build the llama-server command using config and launch in background thread."""
    IS_WIN = platform.system() == "Windows"
    IS_MAC = platform.system() == "Darwin"
    gpu    = config.get("gpu_type", "cpu")

    # ── Resolve llama-server binary ───────────────────────────────────────────
    model_dir  = Path(config["model_path"]).parent
    server_exe = "llama-server.exe" if IS_WIN else "llama-server"
    candidates = [
        # Relative to model file (common llama.cpp build layout)
        model_dir.parent.parent / "build" / "bin" / server_exe,
        model_dir.parent / "bin" / server_exe,
        # macOS: Homebrew and common build locations
        Path("/usr/local/bin") / server_exe,
        Path("/opt/homebrew/bin") / server_exe,
        Path.home() / "llama.cpp" / "build" / "bin" / server_exe,
        # Fallback: rely on PATH
        Path(server_exe),
    ]
    binary = next((str(c) for c in candidates if Path(c).exists()), server_exe)

    # ── Build args from config (handles toggleable built-ins + custom) ────────
    cmd_args = build_server_command(config, binary)

    # ── Wrap with GPU environment ─────────────────────────────────────────────
    if IS_WIN:
        if gpu == "intel":
            oneapi   = r"C:\Program Files (x86)\Intel\oneAPI\setvars.bat"
            cmd_str  = " ".join(f'"{a}"' for a in cmd_args)
            full_cmd = f'"{oneapi}" intel64 && {cmd_str}'
        else:
            # NVIDIA / AMD / CPU on Windows — run directly
            full_cmd = " ".join(f'"{a}"' for a in cmd_args)
        shell_args = {"shell": True}

    elif IS_MAC:
        # macOS: Metal is the only GPU backend — no environment setup needed.
        # llama.cpp uses Metal automatically when built with it; -ngl handles offload.
        safe_cmd   = " ".join(shlex.quote(a) for a in cmd_args)
        full_cmd   = safe_cmd
        shell_args = {"shell": True, "executable": "/bin/zsh"}

    else:
        # Linux
        safe_cmd = " ".join(shlex.quote(a) for a in cmd_args)
        if gpu == "intel":
            oneapi   = "/opt/intel/oneapi/setvars.sh"
            full_cmd = f". {oneapi} --force ; exec {safe_cmd}"
        else:
            full_cmd = safe_cmd
        shell_args = {"shell": True, "executable": "/bin/bash"}

    env = os.environ.copy()
    if gpu == "intel" and not IS_MAC:
        env["ONEAPI_DEVICE_SELECTOR"] = "level_zero:gpu"
    elif gpu == "nvidia":
        env.setdefault("CUDA_VISIBLE_DEVICES", "0")
    # Metal: no extra env vars needed — llama.cpp handles it automatically

    threading.Thread(
        target=_run_subprocess,
        args=(full_cmd, shell_args, env),
        daemon=True,
    ).start()


def _run_subprocess(full_cmd: str, shell_args: dict, env: dict):
    """
    Launch the subprocess, tee every output line to:
      1. _boot_log  (read by the SSE stream → browser)
      2. Python's stdout (visible in your terminal / systemd journal)
    Keeps running after _boot_ready — so restarts and runtime logs
    continue flowing to both destinations.
    """
    global _llama_process, _boot_log, _boot_ready

    try:
        _llama_process = subprocess.Popen(
            full_cmd,
            **shell_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            universal_newlines=True,
            encoding="utf-8",
            errors="replace",   # don't crash on non-UTF-8 output
            env=env,
        )

        print(f"\n[llama-server] started (pid {_llama_process.pid})", flush=True)

        for line in iter(_llama_process.stdout.readline, ""):
            line = line.rstrip()
            if not line:
                continue

            # ── Tee to terminal ───────────────────────────────────────────
            print(f"[llama-server] {line}", flush=True)

            # ── Buffer for SSE stream ─────────────────────────────────────
            _boot_log.append(line)

            # Keep log from growing unbounded during long sessions
            if len(_boot_log) > 2000:
                _boot_log = _boot_log[-1000:]

            # ── Detect ready ──────────────────────────────────────────────
            lower = line.lower()
            if "server is listening" in lower or "http server listening" in lower:
                _boot_ready = True

        _llama_process.stdout.close()
        rc = _llama_process.wait()
        print(f"[llama-server] exited (code {rc})", flush=True)
        _boot_log.append(f"[exited with code {rc}]")

    except Exception as e:
        msg = f"[launcher error] {e}"
        print(msg, flush=True)
        _boot_log.append(msg)


# ── API: boot log SSE stream ───────────────────────────────────────────────────

@app.get("/api/boot/log")
async def api_boot_log():
    """
    SSE stream of llama-server log lines.
    Streams everything in _boot_log, then keeps polling for new lines.
    Sends {ready: true} once when _boot_ready becomes True.
    Stays open indefinitely so the chat UI always sees live output.
    """
    async def generate() -> AsyncGenerator[str, None]:
        sent       = 0
        ready_sent = False

        while True:
            # Drain any new log lines
            while sent < len(_boot_log):
                yield f"data: {json.dumps({'line': _boot_log[sent]})}\n\n"
                sent += 1

            # Fire ready event exactly once
            if _boot_ready and not ready_sent:
                yield f"data: {json.dumps({'ready': True})}\n\n"
                ready_sent = True

            # After ready, slow down polling to save CPU (1 s instead of 0.2 s)
            await asyncio.sleep(1.0 if ready_sent else 0.2)

            # Stop streaming if the process has exited — client will reconnect on restart
            if ready_sent and _llama_process and _llama_process.poll() is not None:
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── MCP endpoint ───────────────────────────────────────────────────────────────

@app.api_route("/irina/message", methods=["GET", "POST", "OPTIONS"])
async def mcp_handler(request: Request):
    """
    MCP (Model Context Protocol) bridge.
    The model calls this endpoint to use tools.
    """
    if request.method == "OPTIONS":
        return Response(status_code=200)

    # SSE discovery handshake (GET)
    if request.method == "GET":
        return Response(
            content="event: endpoint\ndata: /irina/message\n\n",
            media_type="text/event-stream",
        )

    data   = await request.json()
    method = data.get("method")
    req_id = data.get("id", 1)

    # ── initialize ────────────────────────────────────────────────────────────
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities":    {"tools": {}},
                "serverInfo":      {"name": "companion", "version": "2.0"},
            },
        }

    # ── tools/list ────────────────────────────────────────────────────────────
    if method == "tools/list":
        clean = [
            {k: v for k, v in t.items() if k != "handler"}
            for t in _tool_manifest
        ]
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": clean}}

    # ── tools/call ────────────────────────────────────────────────────────────
    if method == "tools/call":
        params    = data.get("params", {})
        tool_name = params.get("name")
        args      = params.get("arguments", {})
        if isinstance(args, str):
            args = json.loads(args)

        tool = get_tool(_tool_manifest, tool_name)
        if not tool:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }

        try:
            result = tool["handler"](args)
        except Exception as e:
            result = f"Tool error: {e}"

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"content": [{"type": "text", "text": str(result)}]},
        }

    # ── fallback ──────────────────────────────────────────────────────────────
    return {"jsonrpc": "2.0", "id": req_id, "result": {}}


# ── Templates ─────────────────────────────────────────────────────────────────

TEMPLATES_DIR = PROJECT_ROOT / "templates"

@app.get("/api/templates")
async def api_list_templates():
    """List available template files."""
    if not TEMPLATES_DIR.exists():
        return {"templates": []}
    files = {f.name: f.read_text(encoding="utf-8")
             for f in TEMPLATES_DIR.glob("*.md")}
    return {"templates": files}


@app.post("/api/templates/apply")
async def api_apply_template(request: Request):
    """
    Copy a template file into a companion folder.
    Body: {companion_folder, template_name, filename (optional), target_folder (optional, default "soul")}
    """
    body          = await request.json()
    comp_folder   = body.get("companion_folder", "default")
    tname         = body.get("template_name", "")
    filename      = body.get("filename") or tname
    target_folder = body.get("target_folder", "soul")  # "soul" or "mind"

    src = TEMPLATES_DIR / tname
    if not src.exists():
        return {"ok": False, "error": f"Template {tname!r} not found"}

    dest_dir = COMPANIONS_DIR / comp_folder / target_folder
    dest_dir.mkdir(parents=True, exist_ok=True)
    dst = dest_dir / filename
    dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return {"ok": True, "path": str(dst)}


# ── Companion delete ──────────────────────────────────────────────────────────

@app.delete("/api/companions/{folder}")
async def api_delete_companion(folder: str):
    """
    Permanently delete a companion folder and all its files.
    Cannot delete the active companion (switch first).
    """
    import shutil
    config = load_config()
    if config.get("companion_folder") == folder:
        return {"ok": False, "error": "Cannot delete the active companion. Switch to another first."}
    target = COMPANIONS_DIR / folder
    if not target.exists():
        return {"ok": False, "error": f"Companion '{folder}' not found."}
    try:
        shutil.rmtree(str(target))
        log.info("Deleted companion: %s", folder)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Factory reset ──────────────────────────────────────────────────────────────

@app.post("/api/factory-reset")
async def api_factory_reset():
    """
    Full factory reset — shuts down llama-server, deletes ALL companions and config.
    The next page load goes to the wizard which will re-launch the server.
    """
    import shutil
    global _llama_process, _boot_log, _boot_ready

    # Shut down llama-server gracefully
    if _llama_process and _llama_process.poll() is None:
        log.info("Factory reset: terminating llama-server (pid %s)…", _llama_process.pid)
        try:
            _llama_process.terminate()
            for _ in range(30):
                if _llama_process.poll() is not None:
                    break
                await asyncio.sleep(0.1)
            if _llama_process.poll() is None:
                _llama_process.kill()
                _llama_process.wait()
        except Exception as e:
            log.warning("Could not terminate llama-server: %s", e)

    _llama_process = None
    _boot_log      = []
    _boot_ready    = False

    errors = []

    # Delete all companion folders
    if COMPANIONS_DIR.exists():
        try:
            shutil.rmtree(str(COMPANIONS_DIR))
            COMPANIONS_DIR.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            errors.append(f"companions/: {e}")

    # Delete config.json (triggers wizard on next load)
    if CONFIG_FILE.exists():
        try:
            CONFIG_FILE.unlink()
        except Exception as e:
            errors.append(f"config.json: {e}")

    if errors:
        return {"ok": False, "errors": errors}

    log.info("Factory reset complete.")
    return {"ok": True}


# ── Server shutdown ────────────────────────────────────────────────────────────

@app.post("/api/shutdown-model")
async def api_shutdown_model():
    """Shut down llama-server without resetting config. Used by the wizard."""
    global _llama_process, _boot_log, _boot_ready
    if _llama_process and _llama_process.poll() is None:
        try:
            _llama_process.terminate()
            for _ in range(30):
                if _llama_process.poll() is not None:
                    break
                await asyncio.sleep(0.1)
            if _llama_process.poll() is None:
                _llama_process.kill()
                _llama_process.wait()
        except Exception as e:
            return {"ok": False, "error": str(e)}
    _llama_process = None
    _boot_log      = []
    _boot_ready    = False
    return {"ok": True}


# ── Settings API ───────────────────────────────────────────────────────────────

@app.get("/api/settings")
async def api_get_settings():
    """Return full config + all companion configs for the settings panel."""
    config     = load_config()
    companions = list_companions()
    active_cfg = load_companion_config(config.get("companion_folder", "default"))
    return {
        "config":                   config,
        "companions":               companions,
        "active_companion":         active_cfg,
        "defaults":                 DEFAULTS,
        "platform":                 platform.system(),   # "Linux", "Windows", "Darwin"
        "presence_presets":         _merged_presence_presets(config, active_cfg),
        "active_presence_preset":   active_cfg.get("active_presence_preset", "Default"),
        "moods":                    active_cfg.get("moods", {}),
        "active_mood":              active_cfg.get("active_mood", None),
    }


@app.post("/api/settings/server")
async def api_save_server_settings(request: Request):
    """
    Save server-level settings (model path, gpu, ports, server_args).
    These require a server restart — we don't auto-restart here.
    save_config() automatically writes per-OS path dicts.
    """
    body   = await request.json()
    config = load_config()

    # Merge in only the server-level keys
    for key in ("model_path", "mmproj_path", "gpu_type", "port_bridge",
                "port_model", "server_args", "server_args_custom"):
        if key in body:
            config[key] = body[key]

    save_config(config)  # update_platform_paths() is called inside save_config()
    return {"ok": True, "restart_required": True}

@app.delete("/api/settings/os-paths")
async def api_delete_os_paths(request: Request):
    """
    Remove a saved per-OS model/mmproj/gpu entry from config.
    Body: { "os": "Windows" }  (or "Linux" / "Darwin")
    """
    body   = await request.json()
    os_key = body.get("os", "")
    if not os_key:
        return {"ok": False, "error": "No OS specified."}

    config = load_config()
    changed = False
    for field in ("model_paths", "mmproj_paths", "gpu_types"):
        if os_key in config.get(field, {}):
            del config[field][os_key]
            changed = True

    if changed:
        # save_config calls update_platform_paths, which re-syncs the active OS.
        # We write directly to avoid overwriting the just-deleted entry back in.
        import json as _json
        CONFIG_FILE.write_text(_json.dumps(config, indent=2), encoding="utf-8")
        log.info("Removed OS paths entry for: %s", os_key)

    return {"ok": True, "changed": changed}


@app.post("/api/settings/generation")
async def api_save_generation_settings(request: Request):
    """
    Save global generation defaults. No restart needed.
    """
    body   = await request.json()
    config = load_config()
    config["generation"] = {
        **DEFAULTS["generation"],
        **config.get("generation", {}),
        **body,
    }
    save_config(config)
    return {"ok": True}


@app.post("/api/settings/companion")
async def api_save_companion_settings(request: Request):
    """
    Save per-companion config: name, avatar, generation overrides.
    Optionally switch active companion or create a new one.
    """
    body             = await request.json()
    config           = load_config()
    companion_folder = body.get("folder", config.get("companion_folder", "default"))

    companion_cfg = load_companion_config(companion_folder)

    # Update editable fields
    for key in ("companion_name", "avatar_data", "generation", "soul_edit_mode",
                "heartbeat", "force_read_before_write", "presence_presets", "active_presence_preset",
                "moods", "active_mood"):
        if key in body:
            companion_cfg[key] = body[key]

    save_companion_config(companion_folder, companion_cfg)

    # If switching active companion, update root config too
    if body.get("set_active", False):
        config["companion_folder"] = companion_folder
        config["companion_name"]   = companion_cfg.get("companion_name", companion_folder)
        save_config(config)

    return {"ok": True, "folder": companion_folder}


@app.post("/api/settings/companion/new")
async def api_new_companion(request: Request):
    """Create a new companion folder with default config."""
    body   = await request.json()
    name   = body.get("name", "new companion").strip()
    folder = name.lower().replace(" ", "_")[:32]

    # Avoid collisions
    base_folder = folder
    i = 2
    while (COMPANIONS_DIR / folder).exists():
        folder = f"{base_folder}_{i}"; i += 1

    get_companion_paths(folder)
    save_companion_config(folder, {
        "companion_name": name,
        "avatar_data":    "",
        "generation":     dict(DEFAULTS["generation"]),
    })
    return {"ok": True, "folder": folder, "name": name}


@app.get("/api/settings/soul/{folder}")
async def api_get_soul_files(folder: str):
    """Return the contents of all soul/ files for a companion.
    Excludes blank files and self_notes if soul_edit_mode != self_notes."""
    soul_dir = COMPANIONS_DIR / folder / "soul"
    files = {}
    if soul_dir.exists():
        for f in sorted(soul_dir.glob("*.md")) + sorted(soul_dir.glob("*.txt")):
            content = f.read_text(encoding="utf-8").strip()
            if content:  # skip blank/empty files
                files[f.name] = f.read_text(encoding="utf-8")
    return {"files": files}


@app.post("/api/settings/soul/{folder}/delete")
async def api_delete_soul_file(folder: str, request: Request):
    """Delete a specific file from a companion's soul/ folder."""
    body     = await request.json()
    filename = body.get("filename", "").strip()
    if not filename or "/" in filename or "\\" in filename:
        return {"ok": False, "error": "Invalid filename"}
    protected = {"companion_identity.md", "user_profile.md"}
    if filename in protected:
        return {"ok": False, "error": f"{filename} is protected and cannot be deleted"}
    target = COMPANIONS_DIR / folder / "soul" / filename
    if target.exists():
        target.unlink()
    return {"ok": True, "deleted": filename}


@app.post("/api/settings/soul/{folder}")
async def api_save_soul_file(folder: str, request: Request):
    """Write a soul/ file for a companion."""
    body     = await request.json()
    filename = body.get("filename", "").strip()
    content  = body.get("content", "")
    if not filename:
        return {"ok": False, "error": "filename required"}
    soul_dir = COMPANIONS_DIR / folder / "soul"
    soul_dir.mkdir(parents=True, exist_ok=True)
    (soul_dir / filename).write_text(content, encoding="utf-8")
    return {"ok": True}
