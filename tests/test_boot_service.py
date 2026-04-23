"""Tests for scripts/boot_service.py"""

import json
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import scripts.boot_service as _boot


@pytest.fixture(autouse=True)
def reset_boot_state():
    """Restore boot globals to clean state before each test."""
    _boot._llama_process  = None
    _boot._boot_log       = []
    _boot._boot_ready     = False
    _boot._boot_launching = False
    yield
    _boot._llama_process  = None
    _boot._boot_log       = []
    _boot._boot_ready     = False
    _boot._boot_launching = False


@pytest.fixture
async def boot_client(test_config):
    app = FastAPI()
    app.include_router(_boot.router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, test_config


# ── get_boot_status ────────────────────────────────────────────────────────────

def test_boot_status_initial():
    status = _boot.get_boot_status()
    assert status["model_running"]   is False
    assert status["model_launching"] is False


def test_boot_status_launching():
    _boot._boot_launching = True
    status = _boot.get_boot_status()
    assert status["model_running"]   is False
    assert status["model_launching"] is True


def test_boot_status_ready():
    _boot._boot_ready     = True
    _boot._boot_launching = False
    # No real process — model_running requires a live process
    status = _boot.get_boot_status()
    assert status["model_running"]   is False  # _llama_process is None
    assert status["model_launching"] is False


# ── kill_llama_server ──────────────────────────────────────────────────────────

def test_kill_when_idle_is_safe():
    _boot.kill_llama_server()
    assert _boot._llama_process  is None
    assert _boot._boot_launching is False
    assert _boot._boot_ready     is False


def test_kill_resets_launching_state():
    _boot._boot_launching = True
    _boot._boot_ready     = True
    _boot.kill_llama_server()
    assert _boot._boot_launching is False
    assert _boot._boot_ready     is False


# ── POST /api/boot ─────────────────────────────────────────────────────────────

async def test_boot_no_model_path(boot_client):
    client, _ = boot_client
    r = await client.post("/api/boot", json={})
    data = r.json()
    assert data["ok"] is False
    assert "model" in data["error"].lower()


async def test_boot_already_launching_returns_running(boot_client):
    client, ctx = boot_client
    ctx["config_file"].write_text(
        json.dumps({**ctx["config"], "model_path": "/fake/model.gguf"}), encoding="utf-8"
    )
    _boot._boot_launching = True
    r = await client.post("/api/boot", json={})
    data = r.json()
    assert data["ok"] is True
    assert data["already_running"] is True


async def test_boot_already_ready_returns_running(boot_client):
    client, ctx = boot_client
    ctx["config_file"].write_text(
        json.dumps({**ctx["config"], "model_path": "/fake/model.gguf"}), encoding="utf-8"
    )
    fake_proc        = type("P", (), {"poll": lambda self: None, "pid": 99})()
    _boot._llama_process = fake_proc
    _boot._boot_ready    = True

    r = await client.post("/api/boot", json={})
    data = r.json()
    assert data["ok"] is True
    assert data["already_running"] is True


# ── GET /api/boot/log ──────────────────────────────────────────────────────────

async def test_boot_log_streams_lines(boot_client):
    client, _ = boot_client
    _boot._boot_log = ["line one", "line two"]
    _boot._boot_ready = True
    # A "dead" process so the generator's break condition fires after ready_sent
    _boot._llama_process = type("P", (), {"poll": lambda self: 0, "pid": 99})()

    chunks = []
    async with client.stream("GET", "/api/boot/log") as resp:
        async for line in resp.aiter_lines():
            if line.startswith("data:"):
                chunks.append(json.loads(line[5:].strip()))

    texts = [c.get("line") for c in chunks if "line" in c]
    assert "line one" in texts
    assert "line two" in texts
