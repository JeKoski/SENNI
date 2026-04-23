"""
boot_service.py - llama-server process lifecycle management

Owns all boot state, process management, and boot API routes.
Extracted from server.py to isolate process lifecycle for packaging.

Public API consumed by server.py:
  router              - APIRouter with POST /api/boot and GET /api/boot/log
  kill_llama_server() - kill the running process and reset all state
  get_boot_status()   - snapshot dict for /api/status
"""

import asyncio
import json
import logging
import os
import platform
import shlex
import shutil
import subprocess
import threading
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from scripts.config import build_server_command, load_config

log = logging.getLogger(__name__)

IS_WIN = platform.system() == "Windows"

router = APIRouter()

# ── Boot state ─────────────────────────────────────────────────────────────────

_llama_process:  subprocess.Popen | None = None
_boot_log:       list[str]               = []
_boot_ready:     bool                    = False

# Distinct from _boot_ready: True from the moment _build_and_launch fires until
# the subprocess exits (or is killed). Closes the TOCTOU window where a second
# /api/boot call arrives while the first launch is still loading the model.
_boot_launching: bool = False

# Serialises all boot state mutations. _boot_launching is set inside this lock
# before it is released so any concurrent /api/boot call sees the flag immediately.
_boot_lock = threading.Lock()


# ── Public API ─────────────────────────────────────────────────────────────────

def kill_llama_server() -> None:
    """Kill process tree and reset all boot state. Safe from atexit, shutdown, or any endpoint."""
    global _llama_process, _boot_launching, _boot_ready

    proc = _llama_process
    if proc is not None:
        log.info("Killing llama-server tree (pid %s)…", proc.pid)
        _kill_process_tree(proc)

    _llama_process  = None
    _boot_launching = False
    _boot_ready     = False


def get_boot_status() -> dict:
    """Return current boot state snapshot for /api/status."""
    process_alive = _llama_process is not None and _llama_process.poll() is None
    return {
        "model_running":   process_alive and _boot_ready,
        "model_launching": _boot_launching and not _boot_ready,
    }


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
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True,
            )
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


# ── Boot routes ────────────────────────────────────────────────────────────────

@router.post("/api/boot")
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

        # ── Mid-launch ────────────────────────────────────────────────────────
        if not force and _boot_launching:
            log.info("llama-server is still launching — attaching to existing boot")
            return {"ok": True, "already_running": True}

        # ── Kill any existing process ─────────────────────────────────────────
        if _llama_process is not None or _boot_launching:
            log.info("Stopping existing llama-server before relaunch…")
            kill_llama_server()

        # ── Fresh launch ──────────────────────────────────────────────────────
        _boot_log       = []
        _boot_ready     = False
        _boot_launching = True  # set BEFORE releasing the lock

        _build_and_launch(config)

    log.info("llama-server launching…")
    return {"ok": True, "already_running": False}


@router.get("/api/boot/log")
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

            if ready_sent and _llama_process and _llama_process.poll() is not None:
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Internal launch helpers ────────────────────────────────────────────────────

def _build_and_launch(config: dict) -> None:
    """Resolve the binary, build the command, and start the watcher thread. Call with _boot_lock held."""
    IS_MAC = platform.system() == "Darwin"
    gpu    = config.get("gpu_type", "cpu")

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
    env      = os.environ.copy()

    if IS_WIN:
        if gpu == "intel":
            # Intel SYCL requires oneAPI env sourced via setvars.bat.
            # shell=True + cmd.exe chaining is unavoidable here.
            # CREATE_NO_WINDOW suppresses the console popup.
            oneapi     = r"C:\Program Files (x86)\Intel\oneAPI\setvars.bat"
            cmd_str    = " ".join(f'"{a}"' for a in cmd_args)
            full_cmd   = f'"{oneapi}" intel64 && {cmd_str}'
            shell_args = {"shell": True, "creationflags": subprocess.CREATE_NO_WINDOW}
            env["ONEAPI_DEVICE_SELECTOR"] = "level_zero:gpu"
        else:
            full_cmd   = cmd_args
            shell_args = {"shell": False, "creationflags": subprocess.CREATE_NO_WINDOW}
            if gpu == "nvidia":
                env.setdefault("CUDA_VISIBLE_DEVICES", "0")

    elif IS_MAC:
        full_cmd   = cmd_args
        shell_args = {"shell": False}

    else:  # Linux
        if gpu == "intel":
            oneapi_sh  = "/opt/intel/oneapi/setvars.sh"
            safe_cmd   = " ".join(shlex.quote(a) for a in cmd_args)
            # exec replaces the shell with llama-server so the pid IS the target process
            full_cmd   = f". {oneapi_sh} --force ; exec {safe_cmd}"
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
    """Launch llama-server, tee every output line to _boot_log and stdout. Clears _boot_launching on exit."""
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
                _boot_ready     = True
                _boot_launching = False

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
        _boot_launching = False
