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
import atexit
import json
import logging
import os
import platform
import shlex
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
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

IS_WIN = platform.system() == "Windows"

# ── App setup ──────────────────────────────────────────────────────────────────

app = FastAPI(title="Companion", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── TTS router ─────────────────────────────────────────────────────────────────
try:
    from scripts.tts_server import router as tts_router, kill_tts_server
    app.include_router(tts_router)
    _tts_available = True
except Exception as _tts_import_err:
    log.warning("TTS module failed to import (non-fatal): %s", _tts_import_err)
    _tts_available  = False
    kill_tts_server = lambda: None  # noqa: E731

STATIC_DIR = PROJECT_ROOT / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# ── Memory  ─────────────────────────────────────────────────────────────────

try:
    from scripts.memory_server import (
        router as memory_router,
        kill_memory_server,
        notify_message_activity,
    )
    app.include_router(memory_router)
except ImportError:
    kill_memory_server = lambda: None  # noqa: E731
    notify_message_activity = lambda: None  # noqa: E731

# ── Global state ───────────────────────────────────────────────────────────────

_tool_manifest: list[dict] = []
_llama_process: subprocess.Popen | None = None
_boot_log:      list[str]  = []
_boot_ready:    bool       = False

# Distinct from _boot_ready: True from the moment _build_and_launch fires until
# the subprocess exits (or is killed). This closes the TOCTOU window where
# _llama_process is still None but a thread has already been started — a second
# /api/boot call arriving in that window used to spawn a second process.
_boot_launching: bool = False

# Serialises all boot state mutations. _boot_launching is set inside this lock
# before it is released, so any concurrent /api/boot call that acquires the lock
# after us sees the flag immediately.
_boot_lock = threading.Lock()

# Thread pool for synchronous work (tool handlers, tkinter file dialogs).
# tkinter on Windows must not run on the asyncio event loop thread.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="senni-worker")


# ── Startup / shutdown ─────────────────────────────────────────────────────────

@app.on_event("startup")
async def on_startup():
    global _tool_manifest
    _tool_manifest = load_tools()
    log.info("Server ready. %d tools loaded.", len(_tool_manifest))

    # Belt-and-suspenders: also kill on abnormal Python exit
    atexit.register(_kill_llama_server)
    atexit.register(kill_tts_server)
    atexit.register(kill_memory_server)

    try:
        from scripts.auto_backup import run_backup
        run_backup(PROJECT_ROOT)
    except Exception as e:
        log.warning("Auto-backup failed (non-fatal): %s", e)


@app.on_event("shutdown")
async def on_shutdown():
    """Called by uvicorn on clean exit (Ctrl+C, SIGTERM). Kills llama-server tree."""
    log.info("Shutting down — stopping llama-server…")
    _kill_llama_server()
    kill_tts_server()
    kill_memory_server()
    _executor.shutdown(wait=False)


# ── Process management ─────────────────────────────────────────────────────────

def _kill_process_tree(proc: subprocess.Popen) -> None:
    """
    Kill a process and all its children.

    On Windows we use `taskkill /F /T` because proc.terminate() only signals
    the direct child (cmd.exe when shell=True) and does not cascade to
    grandchildren (the actual llama-server.exe). taskkill /T kills the whole
    tree rooted at the given PID.

    On Linux/macOS, terminate() + kill() on the process group is sufficient
    because we use shell=False for non-Intel and exec for Intel (so the shell
    replaces itself with llama-server).
    """
    if proc is None or proc.poll() is not None:
        return

    pid = proc.pid
    try:
        if IS_WIN:
            # /F = force, /T = include child tree, /PID = target by PID
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,   # suppress taskkill's own stdout/stderr
            )
            # Give the tree a moment to die, then wait on the direct child
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                pass  # taskkill already did its job; cmd.exe handle may linger
        else:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                log.warning("llama-server did not exit after SIGTERM — sending SIGKILL (pid %s)", pid)
                proc.kill()
                proc.wait(timeout=2)
    except Exception as e:
        log.warning("Error killing process tree (pid %s): %s", pid, e)


def _kill_llama_server() -> None:
    """
    Public kill entry-point. Kills the process tree and resets all boot state.
    Safe to call from atexit, on_shutdown, or any API endpoint.
    """
    global _llama_process, _boot_launching, _boot_ready

    proc = _llama_process
    if proc is not None:
        log.info("Killing llama-server tree (pid %s)…", proc.pid)
        _kill_process_tree(proc)

    # Reset state regardless — even if proc was already dead
    _llama_process   = None
    _boot_launching  = False
    _boot_ready      = False


# ── UI routes ──────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def root():
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


# ── API: scan ─────────────────────────────────────────────────────────────────

@app.get("/api/scan")
async def api_scan():
    gpu = detect_gpu()
    return {"gpu_detected": gpu, "platform": platform.system()}


@app.get("/api/scan/models")
async def api_scan_models():
    return {"gguf_files": find_gguf_files()}


@app.get("/api/mmproj-candidates")
async def api_mmproj_candidates(model_path: str = ""):
    return {"candidates": find_mmproj_candidates(model_path)}


# ── API: browse (native OS file picker) ───────────────────────────────────────

def _run_file_dialog(title: str, filetypes: list) -> str | None:
    """
    Open a native OS file-picker dialog via tkinter.
    Must run in a worker thread — NOT the asyncio event loop thread.
    On Windows tkinter requires its own thread separate from the event loop.
    """
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        root.lift()
        root.update()
        path = filedialog.askopenfilename(title=title, filetypes=filetypes)
        root.destroy()
        return path or None
    except Exception:
        return None


@app.post("/api/browse")
async def api_browse(request: Request):
    """
    Open the OS native file picker on the server machine.
    Supported types: "model" | "mmproj" | "binary"
    """
    body      = await request.json()
    file_type = body.get("type", "model")

    if file_type == "binary":
        title     = "Select llama-server binary"
        filetypes = [("Executable", "*.exe")] if IS_WIN else [("All files", "*")]
    elif file_type == "mmproj":
        title     = "Select mmproj file"
        filetypes = [("GGUF files", "*.gguf"), ("All files", "*.*")]
    else:
        title     = "Select model file (.gguf)"
        filetypes = [("GGUF files", "*.gguf"), ("All files", "*.*")]

    loop = asyncio.get_event_loop()
    try:
        path = await loop.run_in_executor(
            _executor,
            lambda: _run_file_dialog(title, filetypes),
        )
    except Exception as e:
        return {"ok": False, "reason": str(e)}

    return {"ok": True, "path": path} if path else {"ok": False, "reason": "cancelled"}


# ── API: status ────────────────────────────────────────────────────────────────

def _merged_presence_presets(global_cfg: dict, companion_cfg: dict) -> dict:
    base    = dict(DEFAULTS.get("presence_presets", {}))
    global_ = global_cfg.get("presence_presets", {})
    local   = companion_cfg.get("presence_presets", {})
    merged  = {**base}
    for name, states in global_.items():
        merged[name] = {**(merged.get(name, {})), **states}
    for name, states in local.items():
        merged[name] = {**(merged.get(name, {})), **states}
    return merged


@app.get("/api/status")
async def api_status():
    config = load_config()

    process_alive = (
        _llama_process is not None and
        _llama_process.poll() is None
    )
    model_running = process_alive and _boot_ready

    companion_cfg = load_companion_config(config.get("companion_folder", "default"))
    ctx_size      = config.get("server_args", {}).get("ctx", {}).get("value", 16384)
    global_gen    = config.get("generation", {})
    companion_gen = companion_cfg.get("generation", {})
    effective_gen = {**global_gen, **companion_gen}

    return {
        "config":                    {k: v for k, v in config.items() if k != "first_run"},
        "tools":                     [t["name"] for t in _tool_manifest],
        "model_running":             model_running,
        # Also expose whether we're mid-launch — chat.js uses this to avoid
        # calling /api/boot a second time while the model is still loading.
        "model_launching":           _boot_launching and not _boot_ready,
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
    body   = await request.json()
    config = build_initial_config(
        model_path  = body.get("model_path", ""),
        mmproj_path = body.get("mmproj_path", ""),
        gpu_type    = body.get("gpu_type"),
        ngl         = int(body.get("ngl", 99)),
        port_bridge = int(body.get("port_bridge", 8000)),
        port_model  = int(body.get("port_model", 8081)),
    )
    get_companion_paths(config["companion_folder"])
    save_config(config)
    log.info("Config saved. Companion folder: %s", config["companion_folder"])
    return {"ok": True, "companion_folder": config["companion_folder"]}


# ── API: boot llama-server ─────────────────────────────────────────────────────

@app.post("/api/boot")
async def api_boot(request: Request):
    """
    Start llama-server if not already running or launching.

    Returns:
      {ok: true,  already_running: true}  — process is up and ready, do nothing
      {ok: true,  already_running: true}  — process is still loading, attach to
                                            existing SSE log stream and wait
      {ok: true,  already_running: false} — fresh launch started
      {ok: false, error: "..."}           — misconfiguration

    Pass {"force": true} to kill any running/launching process and restart.
    """
    global _llama_process, _boot_log, _boot_ready, _boot_launching

    config = load_config()
    if not config.get("model_path"):
        return {"ok": False, "error": "No model path configured."}

    force = False
    try:
        body  = await request.json()
        force = bool(body.get("force", False))
    except Exception:
        pass

    with _boot_lock:
        # ── Already fully up ──────────────────────────────────────────────────
        if not force and _boot_ready and _llama_process and _llama_process.poll() is None:
            log.info("llama-server already ready (pid %s), skipping boot", _llama_process.pid)
            return {"ok": True, "already_running": True}

        # ── Mid-launch (process started but model not yet ready) ──────────────
        # This is the key fix: a second /api/boot that arrives while the first
        # launch is still loading the model must NOT start a second process.
        if not force and _boot_launching:
            log.info("llama-server is still launching — attaching to existing boot")
            return {"ok": True, "already_running": True}

        # ── Kill any existing process (forced restart or crashed) ─────────────
        if _llama_process is not None or _boot_launching:
            log.info("Stopping existing llama-server before relaunch…")
            _kill_llama_server()  # resets _llama_process, _boot_launching, _boot_ready

        # ── Fresh launch ──────────────────────────────────────────────────────
        _boot_log      = []
        _boot_ready    = False
        _boot_launching = True   # set BEFORE releasing the lock so any concurrent
                                  # call that acquires it next sees the flag immediately

        _build_and_launch(config)

    log.info("llama-server launching…")
    return {"ok": True, "already_running": False}


def _build_and_launch(config: dict) -> None:
    """
    Resolve the binary, build the command, and start the watcher thread.
    Must be called with _boot_lock held.
    """
    IS_MAC = platform.system() == "Darwin"
    gpu    = config.get("gpu_type", "cpu")

    # ── Resolve binary ────────────────────────────────────────────────────────
    # Priority: 1) explicit config  2) next to model  3) PATH
    server_exe = "llama-server.exe" if IS_WIN else "llama-server"
    binary     = config.get("server_binary", "").strip() or None

    if not binary:
        model_dir  = Path(config["model_path"]).parent
        candidates = [
            model_dir / server_exe,
            model_dir.parent / "bin" / server_exe,
            model_dir.parent.parent / "build" / "bin" / server_exe,
            Path("/usr/local/bin") / server_exe,
            Path("/opt/homebrew/bin") / server_exe,
            Path.home() / "llama.cpp" / "build" / "bin" / server_exe,
        ]
        binary = next((str(c) for c in candidates if c.exists()), None)

    if not binary:
        binary = shutil.which(server_exe) or server_exe

    log.info("llama-server binary: %s", binary)

    cmd_args = build_server_command(config, binary)

    # ── OS / GPU launch parameters ────────────────────────────────────────────
    env = os.environ.copy()

    if IS_WIN:
        if gpu == "intel":
            # Intel SYCL requires oneAPI env sourced via setvars.bat.
            # shell=True + cmd.exe chaining is unavoidable here.
            # CREATE_NO_WINDOW suppresses the console popup.
            oneapi  = r"C:\Program Files (x86)\Intel\oneAPI\setvars.bat"
            cmd_str = " ".join(f'"{a}"' for a in cmd_args)
            full_cmd   = f'"{oneapi}" intel64 && {cmd_str}'
            shell_args = {"shell": True, "creationflags": subprocess.CREATE_NO_WINDOW}
            env["ONEAPI_DEVICE_SELECTOR"] = "level_zero:gpu"
        else:
            # List + shell=False handles paths with spaces correctly on Windows
            full_cmd   = cmd_args
            shell_args = {"shell": False, "creationflags": subprocess.CREATE_NO_WINDOW}
            if gpu == "nvidia":
                env.setdefault("CUDA_VISIBLE_DEVICES", "0")

    elif IS_MAC:
        full_cmd   = cmd_args
        shell_args = {"shell": False}

    else:  # Linux
        if gpu == "intel":
            oneapi_sh = "/opt/intel/oneapi/setvars.sh"
            safe_cmd  = " ".join(shlex.quote(a) for a in cmd_args)
            # exec replaces the shell with llama-server so the pid IS the target process
            full_cmd  = f". {oneapi_sh} --force ; exec {safe_cmd}"
            shell_args = {"shell": True, "executable": "/bin/bash"}
            env["ONEAPI_DEVICE_SELECTOR"] = "level_zero:gpu"
        else:
            full_cmd   = cmd_args
            shell_args = {"shell": False}
            if gpu == "nvidia":
                env.setdefault("CUDA_VISIBLE_DEVICES", "0")

    threading.Thread(
        target=_run_subprocess,
        args=(full_cmd, shell_args, env),
        daemon=True,
        name="llama-server-watcher",
    ).start()


def _run_subprocess(full_cmd, shell_args: dict, env: dict) -> None:
    """
    Launch llama-server, tee every output line to _boot_log and stdout.
    Clears _boot_launching when the process exits (success or failure).
    """
    global _llama_process, _boot_log, _boot_ready, _boot_launching

    try:
        proc = subprocess.Popen(
            full_cmd,
            **shell_args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            universal_newlines=True,
            encoding="utf-8",
            errors="replace",
            env=env,
        )
        _llama_process = proc
        print(f"\n[llama-server] started (pid {proc.pid})", flush=True)

        for line in iter(proc.stdout.readline, ""):
            line = line.rstrip()
            if not line:
                continue

            print(f"[llama-server] {line}", flush=True)
            _boot_log.append(line)
            if len(_boot_log) > 2000:
                _boot_log = _boot_log[-1000:]

            lower = line.lower()
            if "server is listening" in lower or "http server listening" in lower:
                _boot_ready    = True
                _boot_launching = False   # model is up — launch phase is over

        proc.stdout.close()
        rc = proc.wait()
        print(f"[llama-server] exited (code {rc})", flush=True)
        _boot_log.append(f"[exited with code {rc}]")

    except FileNotFoundError:
        exe = full_cmd[0] if isinstance(full_cmd, list) else str(full_cmd).split()[0]
        msg = (
            f"[launcher error] llama-server not found: {exe!r}\n"
            f"Set the binary path in Settings → Server, or add llama-server to your PATH."
        )
        print(msg, flush=True)
        _boot_log.append(msg)

    except Exception as e:
        msg = f"[launcher error] {e}"
        print(msg, flush=True)
        _boot_log.append(msg)

    finally:
        # Always clear launching flag when the thread exits, whatever happened
        _boot_launching = False


# ── API: boot log SSE stream ───────────────────────────────────────────────────

@app.get("/api/boot/log")
async def api_boot_log():
    """
    SSE stream of llama-server log lines.
    Multiple clients can attach simultaneously — they all read from _boot_log.
    Sends {ready: true} once when _boot_ready becomes True, then slows polling.
    """
    async def generate() -> AsyncGenerator[str, None]:
        sent       = 0
        ready_sent = False

        while True:
            while sent < len(_boot_log):
                yield f"data: {json.dumps({'line': _boot_log[sent]})}\n\n"
                sent += 1

            if _boot_ready and not ready_sent:
                yield f"data: {json.dumps({'ready': True})}\n\n"
                ready_sent = True

            await asyncio.sleep(1.0 if ready_sent else 0.2)

            # Stop streaming if process has exited after being ready
            if ready_sent and _llama_process and _llama_process.poll() is not None:
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── MCP endpoint ───────────────────────────────────────────────────────────────

@app.api_route("/irina/message", methods=["GET", "POST", "OPTIONS"])
async def mcp_handler(request: Request):
    if request.method == "OPTIONS":
        return Response(status_code=200)

    if request.method == "GET":
        return Response(
            content="event: endpoint\ndata: /irina/message\n\n",
            media_type="text/event-stream",
        )

    data   = await request.json()
    method = data.get("method")
    req_id = data.get("id", 1)

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

    if method == "tools/list":
        clean = [{k: v for k, v in t.items() if k != "handler"} for t in _tool_manifest]
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": clean}}

    if method == "tools/call":
        params    = data.get("params", {})
        tool_name = params.get("name")
        args      = params.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}

        tool = get_tool(_tool_manifest, tool_name)
        if not tool:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }

        # Run synchronous handler in thread pool so we don't block the event loop
        try:
            loop   = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                _executor,
                lambda: tool["handler"](args),
            )
        except Exception as e:
            log.error("Tool %r raised: %s", tool_name, e, exc_info=True)
            result = f"Tool error: {e}"

        notify_message_activity()

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"content": [{"type": "text", "text": str(result)}]},
        }

    return {"jsonrpc": "2.0", "id": req_id, "result": {}}


# ── Templates ─────────────────────────────────────────────────────────────────

TEMPLATES_DIR = PROJECT_ROOT / "templates"

@app.get("/api/templates")
async def api_list_templates():
    if not TEMPLATES_DIR.exists():
        return {"templates": []}
    return {"templates": {f.name: f.read_text(encoding="utf-8") for f in TEMPLATES_DIR.glob("*.md")}}


@app.post("/api/templates/apply")
async def api_apply_template(request: Request):
    body          = await request.json()
    comp_folder   = body.get("companion_folder", "default")
    tname         = body.get("template_name", "")
    filename      = body.get("filename") or tname
    target_folder = body.get("target_folder", "soul")

    src = TEMPLATES_DIR / tname
    if not src.exists():
        return {"ok": False, "error": f"Template {tname!r} not found"}

    dest_dir = COMPANIONS_DIR / comp_folder / target_folder
    dest_dir.mkdir(parents=True, exist_ok=True)
    (dest_dir / filename).write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return {"ok": True}


# ── Companion management ──────────────────────────────────────────────────────

@app.delete("/api/companions/{folder}")
async def api_delete_companion(folder: str):
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
    _kill_llama_server()

    errors = []
    if COMPANIONS_DIR.exists():
        try:
            shutil.rmtree(str(COMPANIONS_DIR))
            COMPANIONS_DIR.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            errors.append(f"companions/: {e}")

    if CONFIG_FILE.exists():
        try:
            CONFIG_FILE.unlink()
        except Exception as e:
            errors.append(f"config.json: {e}")

    if errors:
        return {"ok": False, "errors": errors}

    log.info("Factory reset complete.")
    return {"ok": True}


# ── Server shutdown (model only) ───────────────────────────────────────────────

@app.post("/api/shutdown-model")
async def api_shutdown_model():
    _kill_llama_server()
    return {"ok": True}


# ── Settings API ───────────────────────────────────────────────────────────────

@app.get("/api/settings")
async def api_get_settings():
    config     = load_config()
    companions = list_companions()
    active_cfg = load_companion_config(config.get("companion_folder", "default"))
    return {
        "config":                   config,
        "companions":               companions,
        "active_companion":         active_cfg,
        "defaults":                 DEFAULTS,
        "platform":                 platform.system(),
        "presence_presets":         _merged_presence_presets(config, active_cfg),
        "active_presence_preset":   active_cfg.get("active_presence_preset", "Default"),
        "moods":                    active_cfg.get("moods", {}),
        "active_mood":              active_cfg.get("active_mood", None),
    }


@app.post("/api/settings/server")
async def api_save_server_settings(request: Request):
    body   = await request.json()
    config = load_config()
    for key in ("model_path", "mmproj_path", "gpu_type", "port_bridge",
                "port_model", "server_args", "server_args_custom", "server_binary"):
        if key in body:
            config[key] = body[key]
    save_config(config)
    return {"ok": True, "restart_required": True}


@app.delete("/api/settings/os-paths")
async def api_delete_os_paths(request: Request):
    body   = await request.json()
    os_key = body.get("os", "")
    if not os_key:
        return {"ok": False, "error": "No OS specified."}

    config  = load_config()
    changed = False
    for field in ("model_paths", "mmproj_paths", "gpu_types", "server_binaries"):
        if os_key in config.get(field, {}):
            del config[field][os_key]
            changed = True

    if changed:
        CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")
        log.info("Removed OS paths entry for: %s", os_key)

    return {"ok": True, "changed": changed}


@app.post("/api/settings/generation")
async def api_save_generation_settings(request: Request):
    body   = await request.json()
    config = load_config()
    config["generation"] = {
        **DEFAULTS["generation"],
        **config.get("generation", {}),
        **body,
    }
    save_config(config)
    return {"ok": True}


@app.post("/api/settings/tts")
async def api_save_tts_settings(request: Request):
    """Save global TTS settings (enable/disable, paths). Restarts TTS process if needed."""
    body   = await request.json()
    config = load_config()
    config["tts"] = {
        **DEFAULTS.get("tts", {}),
        **config.get("tts", {}),
        **body,
    }
    save_config(config)
    # If TTS was just enabled, start the subprocess; if disabled, stop it.
    if _tts_available:
        if config["tts"].get("enabled"):
            from scripts.tts_server import _ensure_tts_running
            _ensure_tts_running()
        else:
            kill_tts_server()
    return {"ok": True}


@app.post("/api/settings/memory")
async def api_save_memory_settings(request: Request):
    body   = await request.json()
    config = load_config()
    mem    = config.get("memory", {})
    if "enabled" in body:
        mem["enabled"] = bool(body["enabled"])
    if "session_start_k" in body:
        mem["session_start_k"] = max(1, min(20, int(body["session_start_k"])))
    if "mid_convo_k" in body:
        mem["mid_convo_k"] = max(1, min(20, int(body["mid_convo_k"])))
    config["memory"] = mem
    save_config(config)
    return {"ok": True}


@app.post("/api/settings/companion")
async def api_save_companion_settings(request: Request):
    body             = await request.json()
    config           = load_config()
    companion_folder = body.get("folder", config.get("companion_folder", "default"))
    companion_cfg    = load_companion_config(companion_folder)

    for key in ("companion_name", "avatar_data", "generation", "soul_edit_mode",
                "heartbeat", "force_read_before_write", "presence_presets",
                "active_presence_preset", "moods", "active_mood", "tts",
                "cognitive_stack"):
        if key in body:
            companion_cfg[key] = body[key]

    save_companion_config(companion_folder, companion_cfg)

    if body.get("set_active", False):
        config["companion_folder"] = companion_folder
        config["companion_name"]   = companion_cfg.get("companion_name", companion_folder)
        save_config(config)

    return {"ok": True, "folder": companion_folder}


@app.post("/api/settings/companion/new")
async def api_new_companion(request: Request):
    body   = await request.json()
    name   = body.get("name", "new companion").strip()
    folder = name.lower().replace(" ", "_")[:32]

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
    soul_dir = COMPANIONS_DIR / folder / "soul"
    files    = {}
    if soul_dir.exists():
        for f in sorted(soul_dir.glob("*.md")) + sorted(soul_dir.glob("*.txt")):
            content = f.read_text(encoding="utf-8").strip()
            if content:
                files[f.name] = f.read_text(encoding="utf-8")
    return {"files": files}


@app.post("/api/settings/soul/{folder}/delete")
async def api_delete_soul_file(folder: str, request: Request):
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
    body     = await request.json()
    filename = body.get("filename", "").strip()
    content  = body.get("content", "")
    if not filename:
        return {"ok": False, "error": "filename required"}
    soul_dir = COMPANIONS_DIR / folder / "soul"
    soul_dir.mkdir(parents=True, exist_ok=True)
    (soul_dir / filename).write_text(content, encoding="utf-8")
    return {"ok": True}
