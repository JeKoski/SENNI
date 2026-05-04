"""
main.py — Entry point

Run this to start the companion:
    python main.py

What it does:
1. Checks Python version
2. Starts the FastAPI bridge server (port 8000 by default)
3. Opens the browser automatically
4. The browser decides: wizard (first run) or chat (returning user)
"""

import logging
import os
import platform
import subprocess
import sys
import webbrowser
from pathlib import Path

# Ensure Unicode prints correctly on Windows terminals with non-UTF-8 codepages
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# ── Process name ───────────────────────────────────────────────────────────────
# Makes this process identifiable in task manager / ps / htop.
# setproctitle is optional — install with: pip install setproctitle

def _set_process_name(name: str) -> None:
    try:
        import setproctitle
        setproctitle.setproctitle(name)
    except ImportError:
        sys.argv[0] = name          # fallback — visible in some process viewers
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.kernel32.SetConsoleTitleW(name)
        except Exception:
            pass

_set_process_name("SENNI Bridge")

# ── Version guard ──────────────────────────────────────────────────────────────

if sys.version_info < (3, 10):
    print("Python 3.10 or newer is required.")
    print(f"You are running Python {sys.version}")
    sys.exit(1)

# ── Logging ────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Dependency check ───────────────────────────────────────────────────────────

REQUIRED = ["fastapi", "uvicorn"]

def check_deps():
    missing = []
    for pkg in REQUIRED:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"\nMissing packages: {', '.join(missing)}")
        print("Install them with:")
        print(f"  pip install {' '.join(missing)}\n")
        sys.exit(1)

check_deps()

# ── Main ───────────────────────────────────────────────────────────────────────

import threading
import time

import uvicorn
from scripts.config import load_config
from scripts.server import app  # direct import — friendlier for PyInstaller static analysis


def main():
    config = load_config()
    port   = config.get("port_bridge", 8000)
    url    = f"http://localhost:{port}"

    print()
    print("  ✦  Companion")
    print(f"     {platform.system()} · Python {sys.version.split()[0]}")
    print()
    print(f"  →  Opening {url}")
    print("     Press Ctrl+C to stop.")
    print()

    # Don't open the browser when running as a Tauri sidecar — Tauri manages the window.
    if not os.environ.get("SENNI_TAURI"):
        def _open():
            time.sleep(1.2)
            webbrowser.open(url)
        threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="warning",
        reload=False,
    )

if __name__ == "__main__":
    main()
