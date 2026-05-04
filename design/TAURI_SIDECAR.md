# TAURI_SIDECAR.md — Sidecar Runtime Contract

This document defines the contract between the Tauri shell (Rust) and the Python sidecar (`senni-backend[.exe]`) for Phase 3 of the SENNI distribution roadmap. It specifies how Tauri launches, monitors, and shuts down the sidecar without changing the existing HTTP API. The Tauri side treats the sidecar as an opaque process it manages by PID; all application logic stays in Python.

---

## Architecture

```
Tauri shell (Rust)
  └─ spawns ──► senni-backend[.exe]          (PyInstaller sidecar)
                  ├─ FastAPI on :8000
                  │    └─ serves webview assets + all API endpoints
                  └─ spawns ──► llama-server  (managed by boot_service.py)

Webview
  └─ http://localhost:8000                    (identical to browser dev mode)
```

**Key constraint:** The Tauri shell never communicates with llama-server directly and never uses Tauri IPC for application data. All webview↔backend traffic is plain HTTP on `localhost:8000`, unchanged from today.

---

## Sidecar Entry Point

| Property | Value |
|----------|-------|
| Binary (Linux) | `senni-backend` |
| Binary (Windows) | `senni-backend.exe` |
| Tauri declaration | `tauri.bundle.externalBin` in `tauri.conf.json` |
| Launch args | None — all config read from `DATA_ROOT/config.json` |
| Working directory | `DATA_ROOT` |
| stdin | Closed / null |
| stdout / stderr | Captured by Tauri, forwarded to Tauri log |

Environment inheritance: the sidecar inherits the parent process environment. `SENNI_DATA_ROOT` overrides `DATA_ROOT` if set (see §Path Layout).

---

## Readiness Protocol

Tauri must not load the webview until the sidecar is ready to accept connections. Port bind is not sufficient — uvicorn initialises async tasks after bind.

**Mechanism:** poll `GET http://localhost:8000/api/health` until `200 OK`.

| Parameter | Value |
|-----------|-------|
| Poll interval | 250 ms |
| Timeout | 30 s |
| Success response | `{"status": "ok"}` |
| On timeout | Show error dialog with last log lines; offer Retry / Quit |
| On port conflict | Sidecar exits code 1 with log message; Tauri surfaces the message |

The `/api/health` endpoint must be added to `server.py` (see §Implementation Checklist). It requires no auth and no body — it should return immediately without touching the database or llama-server state.

---

## Lifecycle States

These states live in the Tauri shell. They mirror the model already used in `boot_service.py` for llama-server, one level up.

| State | Meaning |
|-------|---------|
| `LAUNCHING` | Sidecar process spawned; health poll active |
| `READY` | `/api/health` returned 200; webview loaded at `http://localhost:8000` |
| `DEGRADED` | Sidecar alive, health check passes, but llama-server is not yet booted (normal on first run — the wizard handles this) |
| `STOPPING` | Graceful shutdown request sent; waiting for process exit |
| `STOPPED` | Sidecar exited; Tauri is cleaning up and may close the window |

Tauri should expose the current state to its crash monitor, not to the webview — the webview uses `/api/boot` endpoints for llama-server status as it does today.

---

## IPC Model

- **Protocol:** HTTP on `localhost:8000` only.
- **No** named pipes, Tauri IPC channels, shared memory, or Unix domain sockets.
- **CORS:** The Tauri webview origin is `tauri://localhost`. Add this to the FastAPI CORS allowed-origins list in `server.py`. All other CORS policy stays as-is.
- **Auth:** None. Loopback-only, single-user, single-machine.
- **API surface:** Unchanged. Tauri adds no new application-level endpoints; it only uses `/api/health` and `/api/shutdown` for process management.

---

## Process Termination

### Graceful shutdown sequence

1. User closes the Tauri window or the OS requests quit.
2. Tauri POSTs `http://localhost:8000/api/shutdown`.
3. Sidecar handler calls `kill_llama_server()` (already in `boot_service.py`), then calls `os._exit(0)`.
4. Tauri waits up to **5 seconds** for the sidecar PID to exit.
5. If the process is still alive after 5 s → force kill (below).

### Force kill

**Windows:**
```
taskkill /F /T /PID <sidecar_pid>
```
`/T` propagates to the entire process tree, which captures llama-server and any llama.cpp child processes. Note: on Windows, `boot_service.py` spawns llama-server via `shell=True`, so the direct child is `cmd.exe` — `/T` handles this correctly.

**Linux:**
```
kill -SIGTERM <sidecar_pid>
```
On Linux, `boot_service.py` uses `exec` so the shell is replaced by llama-server — SIGTERM to the sidecar is enough to trigger uvicorn's shutdown hook, which calls `kill_llama_server()`. If the sidecar is hung, escalate to SIGKILL after another 3 s. As a belt-and-suspenders measure, kill the entire process group:
```
kill -SIGKILL -<sidecar_pgid>
```

### New endpoints required

| Endpoint | Method | Response | Behaviour |
|----------|--------|----------|-----------|
| `/api/health` | GET | `{"status": "ok"}` | Returns immediately; no side effects |
| `/api/shutdown` | POST | `{"ok": true}` | Calls `kill_llama_server()`, schedules `os._exit(0)` in a background thread after 500 ms (gives time for the HTTP response to flush) |

---

## Log Capture

Tauri captures sidecar stdout and stderr via its sidecar API and writes them to the Tauri log alongside Rust log lines. No additional log file plumbing is needed in the sidecar — uvicorn already writes structured logs to stdout.

llama-server logs are not captured at the process level; they continue to stream via the existing `GET /api/boot/log` SSE endpoint. The webview consumes that stream the same way it does in browser dev mode today.

---

## Path Layout

| Symbol | Browser dev | PyInstaller (no Tauri) | Tauri package |
|--------|-------------|------------------------|---------------|
| `RESOURCE_ROOT` | Project root | Extracted bundle tmpdir | Tauri `$resourceDir` (read-only, inside app bundle) |
| `DATA_ROOT` | Project root | Project root (cwd) | Platform user-data dir (writable, outside bundle) |

### DATA_ROOT in frozen + Tauri mode

When running inside Tauri, the sidecar must write user data to a directory outside the app bundle (which may be read-only or replaced on update). Resolution order:

1. `SENNI_DATA_ROOT` env var, if set — use as-is (supports portable installs)
2. Platform default:
   - Windows: `%APPDATA%\SENNI` → `C:\Users\<user>\AppData\Roaming\SENNI`
   - Linux: `$XDG_DATA_HOME/SENNI` → `~/.local/share/SENNI`
   - macOS: `~/Library/Application Support/SENNI`

This resolution should live in `scripts/paths.py` under a `tauri_data_root()` helper, only active when `sys.frozen` is true and `SENNI_DATA_ROOT` is unset.

### First-run seed

On first launch, `DATA_ROOT` is empty. The sidecar copies the following from `RESOURCE_ROOT` before starting uvicorn:

- `companions/` (default companion folder)
- `config.json` (default global config)

This mirrors the existing first-run logic — it just needs `DATA_ROOT` to resolve outside the bundle instead of defaulting to cwd.

---

## Error States

| Scenario | Detection | Tauri response |
|----------|-----------|----------------|
| Port 8000 already in use | Sidecar exits code 1 immediately | Show error dialog with log excerpt; offer Quit |
| Sidecar health check timeout (30 s) | Poll loop expires | Show error dialog + "View logs" button; offer Retry / Quit |
| Sidecar exits unexpectedly while READY | Process exit event | Show "SENNI crashed" dialog + "Restart" / "Quit" |
| Sidecar unresponsive (health check hangs) | HTTP timeout > 5 s on a single request | Treat as crash: force-kill, offer restart |
| `/api/shutdown` times out | No HTTP response within 2 s | Proceed directly to force kill |

Crash restart should re-enter the `LAUNCHING` state (re-spawn + re-poll). Do not auto-restart more than 3 times in 60 s to avoid a crash loop.

---

## What Tauri Does NOT Manage

- **llama-server lifecycle** — fully owned by `boot_service.py`. Tauri only knows about the sidecar PID.
- **Static file serving** — FastAPI serves everything on `:8000`; Tauri's webview is a pure HTTP client.
- **Authentication** — loopback, no auth, no token injection.
- **Companion config** — format is opaque to Tauri; sidecar owns all reads and writes.
- **Model downloads** — handled by the existing setup wizard inside the webview.

---

## Implementation Checklist

Items required before Phase 3 development can begin. The doc/contract is complete when these are shipped; the Tauri scaffolding can then be built against a stable sidecar interface.

**Python sidecar (`scripts/server.py` + `scripts/paths.py`):**
- [x] `GET /api/health` → `{"status": "ok"}`
- [x] `POST /api/shutdown` → graceful teardown
- [x] CORS: already wildcard `["*"]` — `tauri://localhost` covered, no change needed
- [x] `SENNI_DATA_ROOT` env var override in `scripts/paths.py`
- [x] `DATA_ROOT.mkdir()` when `SENNI_DATA_ROOT` is set (platform dir created on first launch)
- [x] First-run seed: write default `config.json` to `DATA_ROOT` on first boot if missing

**Tauri (`src-tauri/`):**
- [x] `tauri.conf.json`: `bundle.externalBin = ["../dist/senni-backend"]`, window hidden until ready
- [x] On app start: spawn sidecar via `std::process::Command`, set `SENNI_DATA_ROOT`, poll `/api/health` in background thread, show window on 200 OK
- [x] On app quit: POST `/api/shutdown`; wait 5 s; force-kill (`taskkill /F /T` on Windows, SIGKILL on Linux)
- [x] System tray: Show/Hide + Quit; close button hides to tray rather than quitting
- [x] `SENNI_SKIP_SIDECAR` dev escape hatch — skips spawn + poll, shows window immediately
- [ ] Crash monitor: watch sidecar PID, show restart dialog on unexpected exit (max 3 restarts / 60 s) — deferred
- [ ] Log capture: pipe sidecar stdout/stderr into Tauri log — deferred

**Verification:**
- Launch app → sidecar starts → webview loads chat UI
- Close window → sidecar exits; llama-server also gone (check Task Manager / `ps`)
- Force-kill Tauri process → no orphan `senni-backend` or `llama-server` remain
- `SENNI_DATA_ROOT=/tmp/test-senni ./senni` → data written to `/tmp/test-senni`
- Fresh `DATA_ROOT` → wizard appears; companion defaults present after setup
- Sidecar crash mid-session → restart dialog appears within 2 s
