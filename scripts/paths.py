"""
paths.py — Centralized runtime path resolution

Source mode:  RESOURCE_ROOT = DATA_ROOT = project root (parent of scripts/)
Bundled mode: RESOURCE_ROOT = sys._MEIPASS  (read-only temp extraction dir)
              DATA_ROOT     = directory containing the exe  (writable)

Import named constants from here instead of computing paths in individual modules.
"""

import sys
from pathlib import Path

_bundled = getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS")

if _bundled:
    RESOURCE_ROOT = Path(sys._MEIPASS)
    DATA_ROOT     = Path(sys.executable).parent
else:
    DATA_ROOT     = Path(__file__).resolve().parent.parent
    RESOURCE_ROOT = DATA_ROOT

# Backward-compat alias — code that received PROJECT_ROOT as a writable root
# should prefer DATA_ROOT for new references.
PROJECT_ROOT = DATA_ROOT

# ── Resource paths (read-only, bundled into the binary) ───────────────────────

STATIC_DIR    = RESOURCE_ROOT / "static"
TEMPLATES_DIR = RESOURCE_ROOT / "templates" / "companions"
TOOLS_DIR     = RESOURCE_ROOT / "tools"
SCRIPTS_DIR   = RESOURCE_ROOT / "scripts"

# ── Data paths (writable, next to the exe / project root in source mode) ──────

CONFIG_FILE           = DATA_ROOT / "config.json"
COMPANIONS_DIR        = DATA_ROOT / "companions"
LOGS_DIR              = DATA_ROOT / "logs"
BACKUPS_DIR           = DATA_ROOT / "backups"
BINARY_DIR            = DATA_ROOT / "llama"
MODELS_DIR            = DATA_ROOT / "models"
FEATURES_DIR          = DATA_ROOT / "features"
FEATURES_PACKAGES_DIR = DATA_ROOT / "features" / "packages"
FEATURES_VENV_DIR     = DATA_ROOT / "features" / "venv"

def venv_site_packages(venv_dir: Path) -> Path | None:
    """Return the site-packages directory inside a venv, or None if not found."""
    # Windows: venv/Lib/site-packages
    win_sp = venv_dir / "Lib" / "site-packages"
    if win_sp.is_dir():
        return win_sp
    # Linux/Mac: venv/lib/python3.x/site-packages
    lib = venv_dir / "lib"
    if lib.is_dir():
        for pydir in lib.iterdir():
            sp = pydir / "site-packages"
            if sp.is_dir():
                return sp
    return None


# Embedded Python runtime — bundled for pip installs, lives in RESOURCE_ROOT.
# Populated by scripts/build_prep.py before running PyInstaller.
# Windows: full Python embeddable with pip bootstrapped in.
# Linux:   not used — falls back to system Python at runtime.
PYTHON_EMBED_DIR = RESOURCE_ROOT / "python-embed"
