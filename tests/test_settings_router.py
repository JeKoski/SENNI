"""Tests for scripts/settings_router.py"""

import json


# ── GET /api/settings ──────────────────────────────────────────────────────────

async def test_get_settings_shape(settings_client):
    client, _ = settings_client
    r = await client.get("/api/settings")
    assert r.status_code == 200
    data = r.json()
    for key in ("config", "companions", "active_companion", "defaults"):
        assert key in data, f"missing key: {key}"


async def test_get_settings_reflects_config(settings_client):
    client, ctx = settings_client
    r = await client.get("/api/settings")
    assert r.json()["config"]["companion_folder"] == ctx["comp_folder"]


# ── POST /api/settings/generation ─────────────────────────────────────────────

async def test_save_generation_persists(settings_client):
    client, ctx = settings_client
    r = await client.post("/api/settings/generation", json={"temperature": 0.5, "max_tokens": 512})
    assert r.json()["ok"] is True

    saved = json.loads(ctx["config_file"].read_text())
    assert saved["generation"]["temperature"] == 0.5
    assert saved["generation"]["max_tokens"] == 512


# ── POST /api/settings/memory ─────────────────────────────────────────────────

async def test_save_memory_settings(settings_client):
    client, ctx = settings_client
    r = await client.post("/api/settings/memory", json={"enabled": True, "session_start_k": 8})
    assert r.json()["ok"] is True

    saved = json.loads(ctx["config_file"].read_text())
    assert saved["memory"]["enabled"] is True
    assert saved["memory"]["session_start_k"] == 8


async def test_memory_k_clamped(settings_client):
    client, ctx = settings_client
    await client.post("/api/settings/memory", json={"session_start_k": 999})
    saved = json.loads(ctx["config_file"].read_text())
    assert saved["memory"]["session_start_k"] <= 20


# ── POST /api/settings/companion ──────────────────────────────────────────────

async def test_save_companion_name(settings_client):
    client, ctx = settings_client
    r = await client.post("/api/settings/companion", json={
        "folder":         ctx["comp_folder"],
        "companion_name": "Renamed",
    })
    assert r.json()["ok"] is True

    cfg_path = ctx["comp_dir"] / "config.json"
    assert cfg_path.exists()
    saved = json.loads(cfg_path.read_text())
    assert saved["companion_name"] == "Renamed"


# ── POST /api/settings/companion/new ──────────────────────────────────────────

async def test_new_companion_creates_folder(settings_client):
    client, ctx = settings_client
    r = await client.post("/api/settings/companion/new", json={"name": "New Friend"})
    data = r.json()
    assert data["ok"] is True
    assert (ctx["companions"] / data["folder"]).exists()


async def test_new_companion_deduplicates_folder_name(settings_client):
    client, ctx = settings_client
    r1 = await client.post("/api/settings/companion/new", json={"name": "Twin"})
    r2 = await client.post("/api/settings/companion/new", json={"name": "Twin"})
    assert r1.json()["folder"] != r2.json()["folder"]


# ── Soul file routes ───────────────────────────────────────────────────────────

async def test_soul_write_and_read(settings_client):
    client, ctx = settings_client
    folder = ctx["comp_folder"]
    r = await client.post(f"/api/settings/soul/{folder}", json={
        "filename": "notes.md",
        "content":  "# Test\nHello world",
    })
    assert r.json()["ok"] is True

    r = await client.get(f"/api/settings/soul/{folder}")
    files = r.json()["files"]
    assert "notes.md" in files
    assert "Hello world" in files["notes.md"]


async def test_soul_delete_file(settings_client):
    client, ctx = settings_client
    folder = ctx["comp_folder"]
    await client.post(f"/api/settings/soul/{folder}", json={
        "filename": "temp.md", "content": "bye",
    })
    r = await client.post(f"/api/settings/soul/{folder}/delete", json={"filename": "temp.md"})
    assert r.json()["ok"] is True
    assert not (ctx["comp_dir"] / "soul" / "temp.md").exists()


async def test_soul_delete_protected_file(settings_client):
    client, ctx = settings_client
    folder = ctx["comp_folder"]
    r = await client.post(f"/api/settings/soul/{folder}/delete", json={
        "filename": "companion_identity.md",
    })
    assert r.json()["ok"] is False


async def test_soul_delete_rejects_path_traversal(settings_client):
    client, ctx = settings_client
    folder = ctx["comp_folder"]
    r = await client.post(f"/api/settings/soul/{folder}/delete", json={
        "filename": "../config.json",
    })
    assert r.json()["ok"] is False
