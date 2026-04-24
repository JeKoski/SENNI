# senni-backend.spec — PyInstaller build spec for the SENNI Python backend
#
# Build:
#   Windows: pyinstaller senni-backend.spec
#   Linux:   pyinstaller senni-backend.spec
#
# Output: dist/senni-backend[.exe]
#
# Resource layout inside the bundle (sys._MEIPASS):
#   static/        — served by FastAPI as /static
#   templates/     — companion template folder (companions/senni/ etc.)
#   tools/         — dynamically loaded tool modules
#   scripts/       — compiled Python package
#
# Writable data lives next to the exe (DATA_ROOT = exe parent dir):
#   config.json, companions/, logs/, backups/, llama/, models/, features/

import os
import sys
from pathlib import Path

block_cipher = None

# ── Hidden imports ─────────────────────────────────────────────────────────────
# Modules that PyInstaller's static analysis won't discover automatically.
# FastAPI/Starlette internals, optional extras, and dynamic-import consumers.

HIDDEN_IMPORTS = [
    # FastAPI / Starlette internals
    "fastapi",
    "fastapi.middleware.cors",
    "starlette.middleware.cors",
    "starlette.responses",
    "starlette.staticfiles",
    "starlette.routing",
    "uvicorn",
    "uvicorn.main",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan.on",
    "uvicorn.loops.asyncio",
    "uvicorn.loops.uvloop",
    # HTTP / async
    "httpx",
    "anyio",
    "anyio.from_thread",
    # stdlib modules not reachable from our source but needed by post-install extras.
    # Pure Python gaps are filled at runtime by the python-embed stdlib zip (server.py).
    # C extension stdlib modules (.pyd) must be listed here — zip fallback won't reach them.
    "graphlib",       # 3.9+ pure Python — chromadb dependency graph
    "sqlite3",        # pulls in _sqlite3.pyd — chromadb uses SQLite as its backend
    "_sqlite3",
    # Optional extras — include stubs so imports don't hard-fail on missing libs.
    # These are only imported when the user installs them via the wizard.
    "chromadb",
    "sentence_transformers",
    "kokoro",
    # SENNI scripts package — ensure all modules are included
    "scripts.paths",
    "scripts.config",
    "scripts.server",
    "scripts.boot_service",
    "scripts.history_router",
    "scripts.settings_router",
    "scripts.setup_router",
    "scripts.tool_loader",
    "scripts.wizard_compile",
    "scripts.diagnostics",
    "scripts.auto_backup",
    "scripts.memory_server",
    "scripts.tts_server",
]

# ── Data files (non-Python resources bundled into sys._MEIPASS) ────────────────
# Format: (source_glob_or_dir, dest_dir_inside_bundle)

DATAS = [
    # UI — served by FastAPI as /static
    ("static",    "static"),
    # Companion templates — seeds default companion on first boot
    ("templates", "templates"),
    # Tool modules — loaded dynamically by tool_loader.py at runtime
    # Must be .py files (not compiled), because spec_from_file_location needs them
    ("tools",     "tools"),
    # TTS worker — launched as a subprocess by tts_server.py, must exist as a
    # real .py file (not compiled into the archive) so the subprocess Python can run it
    ("scripts/tts.py", "scripts"),
]

# Embedded Python runtime for pip installs (no system Python required).
# Populated by: python scripts/build_prep.py
# If not present, extras install falls back to system Python.
if os.path.isdir("python-embed"):
    DATAS.append(("python-embed", "python-embed"))

# ── Analysis ───────────────────────────────────────────────────────────────────

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=[],
    datas=DATAS,
    hiddenimports=HIDDEN_IMPORTS,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Suppress optional packages that aren't installed on the build machine.
    # Users install these via the wizard after first run.
    excludes=["chromadb", "sentence_transformers", "kokoro"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# ── PYZ ───────────────────────────────────────────────────────────────────────

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# ── EXE ───────────────────────────────────────────────────────────────────────

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="senni-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Keep console for log visibility; Tauri will hide it later
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# ── COLLECT (one-dir mode) ────────────────────────────────────────────────────
# One-dir (--onedir) is preferred over one-file (--onefile) for:
# - Faster startup (no extraction step on each launch)
# - Easier debugging (inspect what's in dist/)
# - Tauri sidecar support (sidecar points at a directory or the exe inside it)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="senni-backend",
)
