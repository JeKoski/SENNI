"""
tool_loader.py — Auto-discovery plugin system for tools/

Scans the tools/ directory at startup. Any .py file that defines
TOOL_NAME, DESCRIPTION, INPUT_SCHEMA, and a run() function is
automatically registered as an available tool.

No imports, no registry, no config needed — just drop a file in.
"""

import importlib.util
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# tools/ lives at the project root, next to scripts/
TOOLS_DIR = Path(__file__).resolve().parent.parent / "tools"

# Required attributes every tool module must export
REQUIRED = ("TOOL_NAME", "DESCRIPTION", "INPUT_SCHEMA", "run")


def _load_module(path: Path):
    """Dynamically import a Python file as a module."""
    spec   = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _validate(module, path: Path) -> bool:
    """Check that the module exports everything a tool needs."""
    missing = [attr for attr in REQUIRED if not hasattr(module, attr)]
    if missing:
        log.warning(
            "Skipping %s — missing: %s", path.name, ", ".join(missing)
        )
        return False
    if not callable(getattr(module, "run")):
        log.warning("Skipping %s — run is not callable", path.name)
        return False
    return True


def load_tools() -> list[dict]:
    """
    Scan tools/ and return a manifest list ready for the MCP endpoint.

    Each entry:
    {
        "name":        str,   # TOOL_NAME from the module
        "description": str,   # DESCRIPTION from the module
        "inputSchema": dict,  # INPUT_SCHEMA from the module
        "handler":     callable  # the run() function
    }
    """
    if not TOOLS_DIR.exists():
        log.warning("tools/ directory not found at %s", TOOLS_DIR)
        return []

    manifest = []

    # Sort alphabetically so tool order is deterministic
    tool_files = sorted(TOOLS_DIR.glob("*.py"))

    for path in tool_files:
        # Skip __init__.py and private files
        if path.stem.startswith("_"):
            continue

        try:
            module = _load_module(path)
        except Exception as e:
            log.error("Failed to import %s: %s", path.name, e)
            continue

        if not _validate(module, path):
            continue

        manifest.append({
            "name":        module.TOOL_NAME,
            "description": module.DESCRIPTION,
            "inputSchema": module.INPUT_SCHEMA,
            "handler":     module.run,
        })
        log.info("Loaded tool: %s (%s)", module.TOOL_NAME, path.name)

    log.info("Tools ready: %d loaded from %s", len(manifest), TOOLS_DIR)
    return manifest


def get_tool(manifest: list[dict], name: str) -> dict | None:
    """Look up a tool by name from the manifest. Returns None if not found."""
    return next((t for t in manifest if t["name"] == name), None)
