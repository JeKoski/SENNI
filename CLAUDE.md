# CLAUDE.md — Instructions for Claude

This file is for Claude to read at the start of every session.
Search for it using project knowledge before doing anything else.

---

## Session Flow

1. Start session with CLAUDE.md
2. Check BACKLOG.md for what's next
3. Surgical work happens (Claude reads files directly — no uploads needed)

---

## Critical working rules

- **Modular Architecture:** We should work towards making everything modular - within reason - while creating new code and also noting down possible refactors when going over old code. Adding, editing or replacing small or large components shouldn't require edits across multiple files. Creating separate helper scripts when functionality repeats will help with consistency and bug fixing.
- **Simplicity and efficiency** — are to be prioritized when it makes sense. Overengineering is to be avoided.
- **Prefer surgical edits** — use targeted find-and-replace edits for most changes. Full file rewrites are fine for large refactors where most of the file is changing. The old "complete files only" rule was a Web UI workaround — Claude Code applies edits directly, so partial edits are no longer a problem. Every changed line should trace directly to the user's request. Don't "improve" adjacent code, comments, or formatting unless asked. If unrelated dead code is spotted, mention it — don't delete it.
- **One file at a time** where possible. Flag upfront if a feature will require touching multiple files and get agreement before proceeding.
- **Surface tradeoffs, don't pick silently** — if multiple valid approaches exist, name them and let user choose. If a simpler path exists than what was asked for, say so. If something is unclear, stop and ask rather than assuming.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won't work. Automate it or build it into existing flows instead.
- **Suggest Extended Thinking** and/or Opus when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **Goal-driven execution** — for any non-trivial task, define success criteria upfront before writing code. e.g. "Fix the scenario field" → "wizard_compile.py outputs correct scenario value; round-trip import restores it." Verifiable goals enable looping to completion without constant check-ins.
- **End every session by updating CLAUDE.md, BACKLOG.md, and any relevant design docs.** This is non-negotiable — it's what makes the next session productive.
- **PyInstaller build compatibility** — all Python code must stay bundle-safe:
  - Never use `__file__` for runtime paths — import constants from `scripts.paths` instead (`RESOURCE_ROOT`, `DATA_ROOT`, named constants)
  - Any pip extra with native extensions (`.pyd`/`.so`) must install into `python-embed` via `"embed"` mode — `--target` breaks DLL loading on Windows
  - New subprocess wrappers must use `PYTHON_EMBED_DIR` from `scripts.paths` to find `python.exe` in frozen mode
  - New static resource directories must be added to `DATAS` in `senni-backend.spec`
  - After dynamic `sys.path` changes in frozen mode, call `importlib.invalidate_caches()`

---

## Project overview

SENNI is a local AI companion framework. Currently running with Gemma 4 E4B Q4_K_M, RTX 5060 Ti GPU (CUDA).

Two servers:

- **Python bridge** (`scripts/server.py`) — FastAPI, handles UI, tools, config. Needs terminal restart for changes.
- **llama-server** — the model itself. Can be restarted in-app.

Runs on Linux (primary dev) and Windows (also tested and supported). Currently on Windows (new machine: Core Ultra 7 270K + RTX 5060 Ti 16GB + 32GB DDR5 at 4800MHz stock — XMP unstable, waiting on firmware).

**Build pipeline:** Use `build-embed.bat` (no system Python needed — uses python-embed). Use `run-built.bat` to launch built exe with terminal kept open on exit/crash.

---

## Backups

Before touching any file, the UI runs an auto-backup of all companion configs and key scripts.
Saved to `backups/YYYY-MM-DD_HHMMSS/`.
The `backups/` folder is in `.gitignore`.

If something breaks, copy files from the latest backup folder.

---

## Companion config

Companion config lives in `companions/<folder>/config.json`.
Global config in `config.json` at project root.

Key companion config fields:

- `avatar_path` — orb avatar filename (e.g. `"avatar.jpg"`), relative to companion folder
- `sidebar_avatar_path` — sidebar portrait avatar filename (e.g. `"sidebar_avatar.jpg"`). Falls back to `avatar_path` if not set.
- `presence_presets` — dict of preset name → per-state dict `{ thinking:{...}, idle:{...}, ... }`
- `active_presence_preset` — which preset is active
- `moods` — dict of mood name → mood definition (see `design/MOOD.md` for full schema)
- `active_mood` — currently active mood name or null
- `mood_pill_visibility` — `"always"` | `"fade"` | `"hide"`
- `cognitive_stack` — four-slot stack string e.g. `mT-fS-mN-fF`
- `last_consolidated_at` — timestamp for crash-recovery consolidation

Key global config fields:

- `memory.enabled` — master switch for the ChromaDB memory system (default: `True`)
- `memory.mid_convo_k` — how many notes the associative trigger surfaces (default: `4`)
- `memory.session_start_k` — how many notes to surface at session start (default: `6`)

### Presence preset config values — important

Presence presets store **real CSS values**: seconds for speeds, pixels for sizes, 0.0–1.0 floats for alpha. The 0–100 slider scale in the UI is a display-layer conversion only. `orb.js` always receives and applies real CSS values directly — do not change this. Same applies to mood config values.

### Tool distinction (important for system prompt clarity)

- `memory` tool → soul/ and mind/ **markdown file** read/write
- `write_memory` / `retrieve_memory` / `supersede_memory` / `update_relational_state` → **ChromaDB** episodic store only
- `set_mood` → writes `active_mood` to companion config; orb + pill update via tool call hook (see MOOD.md)

### Zep-style temporal chaining

When a fact changes, the companion calls `supersede_memory` with the old note's ID. The old note is marked `superseded_by` and excluded from future retrieval. The new note carries a `supersedes` back-reference.

---

## Companion portability

Copying a companion folder between installs:

- **Safe to copy:** `soul/`, `mind/`, `config.json` — fully portable
- **Do NOT copy:** `memory_store/` (ChromaDB, path-dependent and binary), `memory_meta.json` (install-specific consolidation state)

---

## Bugs

### Active

- **llama-server version drift** — `server.py` launch args may have drifted from current llama.cpp API. Needs a pass against current llama.cpp docs.

---

## Environment

- OS: Linux (primary) + Windows (also supported and tested)
- GPU: RTX 5060 Ti 16GB (CUDA) — on new Windows machine (Core Ultra 7 270K, 32GB DDR5)
- Models tested: Gemma 4 (primary), Qwen3.5 9B Q4_K_M
- Temperature: 0.8 (critical for Qwen — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled (Qwen3 only — disable for Gemma 4)
- Flash attention: auto-enabled by llama-server

---

## Known model quirks

**Qwen3.5 9B tool calls in thinking blocks** — confirmed llama.cpp bug (issue #20837): Qwen3.5 9B often prints tool calls in XML inside thinking blocks when thinking is enabled. Not a SENNI bug. Memory write discipline should be robust to unreliable self-initiation — associative pathway is system-driven, masculine self-retrieval has auto-trigger fallback.

**Gemma 4 tool call format** — Gemma 4 uses XML-style tool calls (`<tool_call><function=name>...`) via its jinja template, not SENNI's custom XML examples. System prompt must NOT include XML tool call examples for Gemma 4 — the jinja template handles it, and showing examples causes it to write XML instead of its native format. Handled via `modelFamily` detection in `chat.js`.

---

## Documentation convention

- **CLAUDE.md** — operational instructions, active bugs, design folder index, last 2 session notes. Update at end of every session.
- **BACKLOG.md** — all pending work: quick wins, design sessions needed, on-hold items. Single source of truth for "what's next".
- **design/*.md** — system docs and design decisions. Update when the relevant system is touched.
- Rule: when we touch a system in a session, we document it in that session. Don't defer.

---

## Session notes — 2026-05-04 (Tauri UX polish — loading/shutdown screens, log capture, crash guard)

**Loading screen styled. Shutdown screen added. Server console hidden. Log capture wired. Crash dialog on unexpected exit.**

### What changed

**`src-tauri/tauri.conf.json`:** Added `"withGlobalTauri": true` — without this, `window.__TAURI__` is undefined in the frontend, silently breaking all Tauri commands (was root cause of About section not showing and tray "Server Log" doing nothing).

**`src-tauri/Cargo.toml`:** Added `base64 = "0.22"`.

**`src-tauri/src/lib.rs`:**
- **Loading screen** — replaced bare "SENNI" text with styled dark page matching app visual language: indigo CSS spinner, "Starting SENNI…" serif label, companion avatar embedded as base64 data URI (reads `DATA_ROOT/config.json` → companion folder → `avatar_path`; falls back to spinner-only on first run)
- **Loading fade-out** — `navigate_to_app()` injects a 1s CSS opacity transition before navigating, avoiding flashbang effect
- **Shutdown screen** — `show_shutdown_screen()` navigates to a styled page with 0.5s CSS fade-in showing "Shutting down…"; called from tray Quit handler before `shutdown_sidecar()`
- **Console hidden by default** — `CREATE_NO_WINDOW` flag (Windows only) on sidecar spawn; skipped if `tauri-prefs.json` has `show_console: true`
- **Log capture** — sidecar stdout + stderr piped into `SidecarLog(Mutex<VecDeque<String>>)` app state (last 500 lines) via reader threads
- **Crash monitor** — polls `child.try_wait()` every 2s after health passes; shows blocking dialog if sidecar exits unexpectedly; `ShutdownFlag(AtomicBool)` prevents false alarm on intentional quit
- **Windows Job Object** — `attach_job_object()` creates a Win32 job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; all child processes (including llama-server) are killed automatically when SENNI.exe exits, preventing orphans on hard crash. Raw `extern "system"` FFI, no new deps.
- **Tray menu** — "Server Log" item added; handler shows window + calls `openServerLog(true)` in the frontend
- **Tauri commands** — `get_sidecar_log` (prefers `senni.log` file, falls back to in-memory buffer), `get_log_file_path`, `get_tauri_prefs_cmd`, `set_show_console`
- **`tauri-prefs.json`** — new per-install prefs file in `DATA_ROOT`; currently stores `show_console: bool`

**`main.py`:** When `SENNI_TAURI` is set, adds a `RotatingFileHandler` (5 MB, 2 backups) writing to `DATA_ROOT/senni.log`. All Python logging (uvicorn, FastAPI, tool calls) goes to this file.

**`scripts/boot_service.py`:** `_run_subprocess` now calls `log.info("[llama-server] %s", line)` alongside the existing `print()`, routing llama-server output through the file handler into `senni.log`.

**`static/chat.html`:** About tab gets a "Server" section (hidden unless `window.__TAURI__`): show-terminal toggle, log file path display, "Server log" button + collapsible log panel with Refresh button.

**`static/js/settings.js`:** Added `spInitAboutTauri()`, `openServerLog()`, `refreshServerLog()`, `_loadServerLog()`, `spToggleShowConsole()` — all About-tab Tauri logic lives here (main Settings file), not in `settings-companion.js`.

**`static/js/settings-companion.js`:** `spPopulateAbout()` now ends with `spInitAboutTauri()` call (implementation in `settings.js`). Tauri helper functions removed from this file.

### Key gotchas

- `withGlobalTauri: true` is required for `window.__TAURI__` to exist in Tauri v2 — without it all `invoke()` calls silently do nothing.
- `CREATE_NO_WINDOW` hides the cmd.exe console but stdout/stderr are still captured via pipes (they're independent of the console window).
- Job Object handle is an `isize` (Copy, no Drop) — intentionally never closed so the OS keeps it alive and kills children on SENNI exit.
- `spPopulateAbout` is defined in `settings-companion.js` because that's where it pre-existed — the file name is misleading (it serves both companion panel and About tab). Refactor pending.

### Still open
- **Tauri code in `settings-companion.js`** — `spPopulateAbout` still lives there. Should be extracted into a proper `settings-about.js` or merged into `settings.js` in a future cleanup session.
- Crash monitor auto-restart (offer "Restart" button in dialog) — deferred
- Sidecar log streaming (live updates in the log panel rather than manual refresh) — deferred
- Linux AppImage CI job — deferred
- Code signing (SmartScreen) via SignPath Foundation — deferred

---

## Session notes — 2026-05-04 (Tauri polish — boot/shutdown/CI fixes)

**Installer boots correctly. Shutdown fast. Loading screen on startup.**

### What changed

**`src-tauri/tauri.conf.json`:** Replaced `externalBin` with `resources: {"../dist/senni-backend/": "senni-backend/"}` — was only bundling the exe, not the full one-dir PyInstaller output (DLLs etc). Changed identifier `com.senni.app` → `com.senni.desktop`.

**`src-tauri/src/lib.rs`:**
- `spawn_sidecar()` simplified — looks for `resources/senni-backend/senni-backend.exe`, no more triple-suffix gymnastics
- `poll_health()` + `shutdown_sidecar()` — changed `localhost` → `127.0.0.1` throughout; Windows 11 resolves `localhost` to `::1` (IPv6) first but uvicorn binds IPv4 only, causing all health polls and shutdown POSTs to silently fail
- Added `tauri-plugin-single-instance` — prevents multiple instances competing for port 8000
- Loading screen: window now shows immediately with a minimal dark loading page; `navigate_to_app()` called after health passes instead of `show_window()`
- `SENNI_TAURI=1` env var passed to sidecar on spawn

**`main.py`:** Skip `webbrowser.open()` when `SENNI_TAURI` env var is set (running as Tauri sidecar).

**`build-full.bat` (new):** Single script for full local builds from a clean worktree. Installs Rust, tauri-cli, python-embed, deps, PyInstaller, then builds Tauri installer. `--rebuild` flag forces PyInstaller rebuild; otherwise skips if sidecar already exists.

**`.github/workflows/release.yml`:** Removed triple-suffix copy step (no longer needed with `resources` approach).

**`build-embed.bat` + `dev-tauri.bat`:** Removed triple-suffix copy steps and placeholder creation.

### Key gotchas

- `localhost` vs `127.0.0.1` — Windows 11 prefers IPv6 for `localhost`. Use `127.0.0.1` everywhere in Rust for loopback connections.
- `externalBin` only bundles a single exe — use `resources` to bundle a full one-dir PyInstaller output.
- `tauri-plugin-single-instance` has no capability permission — don't add one, it works via OS mutex only.
- Signing env vars (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) set as User variables in Windows for local builds.

### Loading screen — design note
Current loading screen is a bare dark placeholder. Existing boot animation (spinner → server log) already exists in the web UI and is used on boot, wizard completion, and server restart. Next step: wire the Tauri loading screen into this existing flow — consider showing the active companion's face/avatar rather than a generic spinner, since SENNI is a framework and the companion is the personality.

### Still open
- Crash monitor (auto-restart on unexpected sidecar exit) — deferred
- Sidecar stdout/stderr capture to Tauri log — deferred
- Linux AppImage CI job — deferred
- Code signing (SmartScreen) via SignPath Foundation — deferred
- Loading screen: wire into existing boot animation, show active companion avatar

---

## Session notes — 2026-05-06 (Companion Wizard import zone — Tauri fix)

**One-line fix. Import zone now works in Tauri app.**

### What changed

**`static/companion-wizard.html`:** Import zone changed from `<label>` wrapping hidden `<input type="file">` to `<div onclick="document.getElementById('import-file-input').click()">`. WebView2 (Tauri's renderer on Windows) does not trigger the native file dialog when a label's click activates a `display:none` file input — nothing happens. Explicit `.click()` from a user-gesture handler (the same pattern the review step's avatar upload button already uses) works correctly.

### Key gotcha

- **WebView2 + hidden file input via label** — `<label>` wrapping `<input type="file" style="display:none">` silently fails in Tauri's WebView2. Always use `element.click()` called explicitly from an onclick handler instead. The review-step avatar button already used the correct pattern; now import zone matches it.

---

## Design folder

Large design decisions live in `design/` as standalone docs. These are NOT loaded into context automatically — search project knowledge when you need them.

| File                        | Contents                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BACKLOG.md`                | All pending work — quick wins, design sessions, on-hold items. Check this at session start.                                         |
| `design/ARCHITECTURE.md`    | Modularity plan, completed refactors, planned modules, script/stylesheet load orders.                                               |
| `design/BOOT.md`            | Boot & process lifecycle, TOCTOU problem, per-OS path resolution, file browsing via tkinter                                         |
| `design/SYSTEMS.md`         | Current state: Orb, Presence, Heartbeat, Companion window, Settings dirty tracking, Chat tabs, Vision mode, associative memory pill |
| `design/TTS.md`             | Kokoro TTS architecture, config schema, Aurini integration boundary, what's done/pending                                            |
| `design/FEATURES.md`        | All planned features and changes, grouped by area                                                                                   |
| `design/MEMORY.md`          | Full memory architecture — primitives, composites, primitive_ratios, retrieval, consolidation, ChromaDB stack.                      |
| `design/COMPANION_STACK.md` | Cognitive function stack format, O+J axis pairing, charge as directionality, stack position as probability.                         |
| `design/ORB_DESIGN.md`      | Orb positioning, layout modes, CSS variable documentation                                                                           |
| `design/MOOD.md`            | Mood system — full design + implementation notes. Config schema, default moods, orb schema translation.                             |
| `design/UI-REDESIGN.md`     | Main chat UI redesign — full spec: token system, sidebar, header, orb modes, bubbles, composer, tool call polish, impl order.       |
| `design/SETTINGS-REDESIGN.md` | Settings + Companion Settings redesign — current state inventory, everything that needs a home, open design questions.            |
| `design/IDENTITY.md`          | Identity evolution system — soul/mind file structure, tool suite, evolution levels, Unbound transition, chaos orb.                |
| `design/SETUP_WIZARD.md`    | Setup wizard — step flow, GPU→binary mapping, animation principles, backend endpoints needed.                                       |
| `design/WIZARD.md`          | Companion Creation Wizard — V2 character card format, Birth Certificate architecture, step flow, appearance sub-steps.              |
| `design/CHARA_CARD.md`      | Chara card V2 field reference, SENNI alignment, soul file best practices, first_mes, system_prompt, character_book/lorebook design. |
| `design/TAURI_SIDECAR.md`  | Sidecar runtime contract — how Tauri launches, monitors, and shuts down the Python backend. Entry point, health check, lifecycle states, IPC model, process termination, path layout, error states, implementation checklist. |
