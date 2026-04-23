"""
conftest.py - Shared fixtures for SENNI test suite.

Isolation strategy:
  All filesystem I/O in scripts.config uses module-level constants
  (COMPANIONS_DIR, CONFIG_FILE). The router modules import these as local
  bindings at import time. monkeypatch must therefore patch both the
  source module (scripts.config) and each consumer module so direct
  references and function calls both hit tmp_path.
"""

import json
import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pathlib import Path

import scripts.config as _cfg
import scripts.history_router as _hist
import scripts.settings_router as _sett


@pytest.fixture
def isolated_paths(monkeypatch, tmp_path):
    """
    Redirect all COMPANIONS_DIR and CONFIG_FILE references to tmp_path.
    Patches both scripts.config (used by helper functions) and each
    router module (used by direct attribute references in route bodies).
    """
    companions = tmp_path / "companions"
    companions.mkdir()
    config_file = tmp_path / "config.json"

    monkeypatch.setattr(_cfg,  "COMPANIONS_DIR", companions)
    monkeypatch.setattr(_cfg,  "CONFIG_FILE",   config_file)
    monkeypatch.setattr(_hist, "COMPANIONS_DIR", companions)          # history_router has no CONFIG_FILE
    monkeypatch.setattr(_sett, "COMPANIONS_DIR", companions)
    monkeypatch.setattr(_sett, "CONFIG_FILE",   config_file)

    return {"companions": companions, "config_file": config_file, "root": tmp_path}


@pytest.fixture
def test_config(isolated_paths):
    """
    Write a minimal config.json and create a test companion folder.
    Returns the paths dict extended with config data and comp_dir.
    """
    cfg = {
        "companion_folder": "test_companion",
        "companion_name":   "Test",
        "model_path":       "",
        "setup_complete":   True,
        "tts":    {"enabled": False, "python_path": "", "voices_path": "", "espeak_path": ""},
        "memory": {"enabled": False, "session_start_k": 6, "mid_convo_k": 4},
    }
    isolated_paths["config_file"].write_text(json.dumps(cfg), encoding="utf-8")

    comp_dir = isolated_paths["companions"] / "test_companion"
    comp_dir.mkdir()

    return {**isolated_paths, "config": cfg, "comp_folder": "test_companion", "comp_dir": comp_dir}


# ── History router client ──────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def history_client(test_config):
    app = FastAPI()
    app.include_router(_hist.router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, test_config


# ── Settings router client ─────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def settings_client(test_config):
    def _merge_presets(cfg, comp):
        return {}

    app = FastAPI()
    app.include_router(
        _sett.create_settings_router(
            merged_presence_presets=_merge_presets,
            tts_available=False,
            kill_tts_server=lambda: None,
        )
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, test_config
