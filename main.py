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
import platform
import subprocess
import sys
import webbrowser
from pathlib import Path

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

import uvicorn
from scripts.config import load_config

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

    # Open the browser slightly after uvicorn starts
    import threading, time
    def _open():
        time.sleep(1.2)
        webbrowser.open(url)
    threading.Thread(target=_open, daemon=True).start()

    uvicorn.run(
        "scripts.server:app",
        host="127.0.0.1",
        port=port,
        log_level="warning",   # keep console clean; server has its own logging
        reload=False,
    )

if __name__ == "__main__":
    main()
