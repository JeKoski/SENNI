"""Tests for scripts/history_router.py"""

import json


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _save(client, *, tab_id="tab1", messages=None, title="Test chat"):
    return await client.post("/api/history/save", json={
        "companion_folder": "test_companion",
        "tab_id":           tab_id,
        "title":            title,
        "messages":         messages or [{"role": "user", "content": "hello"}],
        "history":          [],
        "tokens":           10,
    })


# ── Save ───────────────────────────────────────────────────────────────────────

async def test_save_returns_ok(history_client):
    client, ctx = history_client
    r = await _save(client)
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert "session_id" in data


async def test_save_creates_session_file(history_client):
    client, ctx = history_client
    r = await _save(client, tab_id="tab1")
    session_id = r.json()["session_id"]

    session_file = ctx["companions"] / "test_companion" / "history" / "tab1" / session_id / "session.json"
    assert session_file.exists()
    payload = json.loads(session_file.read_text())
    assert payload["messages"][0]["content"] == "hello"


async def test_save_creates_meta_file(history_client):
    client, ctx = history_client
    await _save(client, tab_id="tab1", title="My Chat")

    meta_file = ctx["companions"] / "test_companion" / "history" / "tab1" / "meta.json"
    assert meta_file.exists()
    meta = json.loads(meta_file.read_text())
    assert meta["title"] == "My Chat"
    assert meta["tab_id"] == "tab1"


async def test_save_requires_tab_id(history_client):
    client, _ = history_client
    r = await client.post("/api/history/save", json={"companion_folder": "test_companion"})
    assert r.json()["ok"] is False


async def test_save_sanitises_tab_id(history_client):
    client, ctx = history_client
    r = await _save(client, tab_id="../../../evil")
    assert r.json()["ok"] is True
    # Sanitised tab id must not contain path traversal chars
    created = list((ctx["companions"] / "test_companion" / "history").iterdir())
    assert all(".." not in d.name and "/" not in d.name for d in created)


# ── Load ───────────────────────────────────────────────────────────────────────

async def test_load_returns_saved_messages(history_client):
    client, _ = history_client
    msgs = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hey"}]
    await _save(client, tab_id="tab2", messages=msgs)

    r = await client.post("/api/history/load", json={
        "companion_folder": "test_companion",
        "tab_id":           "tab2",
    })
    data = r.json()
    assert data["ok"] is True
    assert data["session"]["messages"] == msgs


async def test_load_missing_tab(history_client):
    client, _ = history_client
    r = await client.post("/api/history/load", json={
        "companion_folder": "test_companion",
        "tab_id":           "nonexistent",
    })
    data = r.json()
    assert data["ok"] is False
    assert data["reason"] == "not_found"


async def test_load_requires_tab_id(history_client):
    client, _ = history_client
    r = await client.post("/api/history/load", json={"companion_folder": "test_companion"})
    assert r.json()["ok"] is False


# ── List ───────────────────────────────────────────────────────────────────────

async def test_list_empty_companion(history_client):
    client, _ = history_client
    r = await client.get("/api/history/list", params={"companion_folder": "test_companion"})
    assert r.status_code == 200
    assert r.json()["tabs"] == []


async def test_list_shows_saved_tabs(history_client):
    client, _ = history_client
    await _save(client, tab_id="tabA", title="Chat A")
    await _save(client, tab_id="tabB", title="Chat B")

    r = await client.get("/api/history/list", params={"companion_folder": "test_companion"})
    tabs = r.json()["tabs"]
    titles = {t["title"] for t in tabs}
    assert titles == {"Chat A", "Chat B"}


# ── Delete ─────────────────────────────────────────────────────────────────────

async def test_delete_removes_tab_dir(history_client):
    client, ctx = history_client
    await _save(client, tab_id="tab_del")
    tab_dir = ctx["companions"] / "test_companion" / "history" / "tab_del"
    assert tab_dir.exists()

    r = await client.delete("/api/history/test_companion/tab_del")
    assert r.json()["ok"] is True
    assert not tab_dir.exists()


async def test_delete_nonexistent_tab_is_ok(history_client):
    client, _ = history_client
    r = await client.delete("/api/history/test_companion/ghost_tab")
    assert r.json()["ok"] is True
