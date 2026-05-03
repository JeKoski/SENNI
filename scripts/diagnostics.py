"""
diagnostics.py - Self-diagnostic suite for SENNI

Two tiers:
  run_startup_checks() - fast, runs every boot
  run_full_checks()    - thorough, runs on demand via /api/diagnostics

setup_file_logging() wires a timestamped FileHandler to the root logger
and prunes old logs so only the last `keep` boot logs are retained.
"""

import json
import logging
import sys
from datetime import datetime
from pathlib import Path

from scripts.paths import STATIC_DIR

log = logging.getLogger(__name__)

_DIV = "=" * 64


def setup_file_logging(log_dir: Path, keep: int = 10) -> Path:
    """
    Attach a timestamped FileHandler to the root logger.
    Prunes oldest logs so at most `keep` files exist after this boot.
    Returns the path of the new log file.
    """
    log_dir.mkdir(parents=True, exist_ok=True)

    existing = sorted(log_dir.glob("senni_*.log"))
    for old in existing[: max(0, len(existing) - keep + 1)]:
        try:
            old.unlink()
        except Exception:
            pass

    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    log_file = log_dir / f"senni_{ts}.log"

    handler = logging.FileHandler(str(log_file), encoding="utf-8")
    handler.setFormatter(logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    ))
    logging.getLogger().addHandler(handler)
    return log_file


# ── Internal helpers ───────────────────────────────────────────────────────────

def _pass(name: str, detail: str = "") -> dict:
    return {"name": name, "ok": True, "detail": detail}


def _fail(name: str, detail: str = "") -> dict:
    return {"name": name, "ok": False, "detail": detail}


def _check_extra(key: str, label: str) -> dict:
    """
    Check whether an optional extra is installed in the correct location.
    Mirrors setup_router._detect_extra so wizard status and diagnostics agree.
    Frozen: checks python-embed site-packages.
    Dev:    checks features/venv site-packages (avoids system-Python false positives).
    """
    import sys
    from scripts.paths import PYTHON_EMBED_DIR, FEATURES_VENV_DIR, venv_site_packages

    _PRIMARY_PKG = {"tts": "kokoro", "memory": "chromadb"}
    primary = _PRIMARY_PKG.get(key, key)

    if getattr(sys, "frozen", False):
        pkg_path = PYTHON_EMBED_DIR / "Lib" / "site-packages" / primary
        found    = pkg_path.is_dir()
    else:
        sp       = venv_site_packages(FEATURES_VENV_DIR)
        pkg_path = (sp / primary) if sp else None
        found    = bool(pkg_path and pkg_path.is_dir())

    if found:
        return _pass(f"{label} installed", str(pkg_path))
    checked = str(pkg_path) if pkg_path else str(FEATURES_VENV_DIR)
    return _fail(f"{label} installed", f"not found at {checked} — install via Setup Wizard > Features")


# ── Startup checks (fast, every boot) ─────────────────────────────────────────

def run_startup_checks(config: dict, project_root: Path, companions_dir: Path) -> list[dict]:
    results = []

    # Python version
    v = sys.version_info
    results.append(
        _pass("Python version", sys.version) if v >= (3, 10)
        else _fail("Python version", f"{sys.version} — 3.10+ required")
    )

    # Config
    results.append(_pass("Config loaded") if config else _fail("Config loaded", "empty config"))

    # Model path
    model = config.get("model_path", "")
    if model:
        results.append(
            _pass("Model file exists", model) if Path(model).exists()
            else _fail("Model file exists", f"not found: {model}")
        )
    else:
        results.append(_fail("Model path configured", "not set"))

    # Companion folder
    comp_folder = config.get("companion_folder", "")
    if comp_folder:
        comp_dir = companions_dir / comp_folder
        results.append(
            _pass("Companion folder exists", str(comp_dir)) if comp_dir.exists()
            else _fail("Companion folder exists", f"not found: {comp_dir}")
        )
    else:
        results.append(_fail("Companion folder configured", "not set"))

    # Static dir
    results.append(
        _pass("Static dir exists", str(STATIC_DIR)) if STATIC_DIR.exists()
        else _fail("Static dir exists", str(STATIC_DIR))
    )

    # Optional extras — only checked if enabled
    if config.get("tts", {}).get("enabled"):
        results.append(_check_extra("tts", "Kokoro TTS"))

    if config.get("memory", {}).get("enabled"):
        results.append(_check_extra("memory", "ChromaDB memory"))

    return results


# ── Full checks (thorough, on demand) ─────────────────────────────────────────

def run_full_checks(config: dict, project_root: Path, companions_dir: Path) -> list[dict]:
    results = run_startup_checks(config, project_root, companions_dir)

    # llama-server binary
    binary = config.get("server_binary", "").strip()
    if binary:
        results.append(
            _pass("llama-server binary exists", binary) if Path(binary).exists()
            else _fail("llama-server binary exists", f"not found: {binary}")
        )

    # mmproj
    mmproj = config.get("mmproj_path", "").strip()
    if mmproj:
        results.append(
            _pass("mmproj file exists", mmproj) if Path(mmproj).exists()
            else _fail("mmproj file exists", f"not found: {mmproj}")
        )

    # espeak
    espeak = config.get("tts", {}).get("espeak_path", "").strip()
    if espeak:
        results.append(
            _pass("espeak-ng binary exists", espeak) if Path(espeak).exists()
            else _fail("espeak-ng binary exists", f"not found: {espeak}")
        )

    # companions/ writable
    try:
        probe = companions_dir / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        results.append(_pass("companions/ writable"))
    except Exception as e:
        results.append(_fail("companions/ writable", str(e)))

    # Each companion config valid JSON
    if companions_dir.exists():
        for folder in sorted(companions_dir.iterdir()):
            if not folder.is_dir():
                continue
            cfg_path = folder / "config.json"
            if not cfg_path.exists():
                results.append(_fail(f"companion config: {folder.name}", "config.json missing"))
                continue
            try:
                json.loads(cfg_path.read_text(encoding="utf-8"))
                results.append(_pass(f"companion config: {folder.name}"))
            except Exception as e:
                results.append(_fail(f"companion config: {folder.name}", str(e)))

    return results


# ── Result formatting ──────────────────────────────────────────────────────────

def log_results(results: list[dict], label: str = "Diagnostics") -> None:
    """Emit a formatted diagnostic block through the logger."""
    passed = sum(1 for r in results if r["ok"])
    failed = sum(1 for r in results if not r["ok"])

    log.info(_DIV)
    log.info("  %s — %d passed, %d failed", label, passed, failed)
    log.info(_DIV)
    for r in results:
        status = "PASS" if r["ok"] else "FAIL"
        detail = f"  ({r['detail']})" if r["detail"] else ""
        log.info("  [%s]  %s%s", status, r["name"], detail)
    log.info(_DIV)

    if failed:
        log.warning("%d diagnostic check(s) failed — see block above for details.", failed)


def results_to_dict(results: list[dict]) -> dict:
    """Serialisable summary for the /api/diagnostics JSON response."""
    return {
        "passed": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "checks": results,
    }
