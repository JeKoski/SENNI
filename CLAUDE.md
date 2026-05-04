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

## Session notes — 2026-05-04 (Auto-updater + CI/CD — Phase 3 complete)

**Phase 3 fully shippable. Signed installers + auto-updater live on GitHub Releases.**

### What changed

**`src-tauri/Cargo.toml`:** Added `tauri-plugin-updater = "2"` and `tauri-plugin-dialog = "2"`.

**`src-tauri/tauri.conf.json`:** Added `plugins.updater` block (pubkey + GitHub `latest.json` endpoint). Added `bundle.createUpdaterArtifacts: true` — required for Tauri to generate `.sig` + `.nsis.zip` update packages. Changed identifier from `com.senni.app` → `com.senni.desktop` (avoid macOS `.app` extension conflict).

**`src-tauri/capabilities/default.json`:** Added `updater:default` and `dialog:default` permissions.

**`src-tauri/src/lib.rs`:** Registered `tauri_plugin_updater` and `tauri_plugin_dialog`. Added `spawn_update_check()` called after window is shown (both normal and `SENNI_SKIP_SIDECAR` paths). Added `check_for_updates()` async fn — background check on startup, native dialog if update found, `download_and_install` + `app.restart()` on confirm.

**`.github/workflows/release.yml`:** Full rewrite. Now: (1) builds Python sidecar via PyInstaller, (2) copies triple-suffixed binary, (3) runs `tauri-apps/tauri-action@v0` which compiles Tauri, signs installers, creates GitHub Release, uploads `.msi` + NSIS `.exe` + `.sig` files + `latest.json`.

**`build-embed.bat`:** Fixed sidecar copy path — was `dist\senni-backend.exe` (wrong), now `dist\senni-backend\senni-backend.exe` (correct for one-dir PyInstaller output).

### Gotchas for future reference

- `createUpdaterArtifacts: true` goes in `bundle`, not `plugins.updater` — without it, no `.sig` files are generated and `latest.json` is never produced
- `tauri-action` input is `includeUpdaterJson`, not `uploadUpdaterJson`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must be set as a GitHub secret if key was generated with a password; absent secret = empty string (correct for passwordless keys)
- PyInstaller one-dir output: exe is at `dist\senni-backend\senni-backend.exe`, not `dist\senni-backend.exe`

### Still open
- Crash monitor (auto-restart on unexpected sidecar exit) — deferred
- Sidecar stdout/stderr capture to Tauri log — deferred
- Linux AppImage CI job — deferred
- Code signing (SmartScreen) via SignPath Foundation — deferred

---

## Session notes — 2026-05-04 (Tauri v2 core shell — Phase 3)

**Tauri v2 shell scaffolded and booting. First dev run successful.**

### What changed

**`design/TAURI_SIDECAR.md` (new):** Sidecar runtime contract — entry point, health check, lifecycle states, IPC model, process termination (per-OS), path layout, error states, full implementation checklist.

**`scripts/server.py`:** `GET /api/health` → `{"status": "ok"}`; `POST /api/shutdown` → kills child processes then `os._exit(0)` after 500 ms async delay. First-run seed: writes default `config.json` to `DATA_ROOT` if missing (Tauri fresh-install path).

**`scripts/paths.py`:** `SENNI_DATA_ROOT` env var override in frozen mode — Tauri sets this to the platform user-data dir (`%APPDATA%\SENNI` / `~/.local/share/SENNI`); plain PyInstaller builds unaffected. `DATA_ROOT.mkdir()` called when override is active.

**`src-tauri/` (new):** Full Tauri v2 scaffold — `Cargo.toml` (`tauri 2` + `tray-icon` feature, `ureq`, `image`), `build.rs`, `tauri.conf.json` (window hidden until ready, `devUrl` + `frontendDist` both `:8000`, `externalBin`), `capabilities/default.json`, `src/main.rs`, `src/lib.rs` (sidecar spawn → health poll → show window, graceful shutdown, tray with Show/Hide + Quit, `SENNI_SKIP_SIDECAR` dev escape hatch).

**`scripts/create_tauri_icons.py` (new):** Generates placeholder icons from `assets/icon.png` or solid-colour stubs. Run once before first build.

**`setup-tauri.bat` (new):** Checks/installs Rust + tauri-cli v2. Safe to re-run.

**`dev-tauri.bat` (new):** Starts Python server in a separate window + `cargo tauri dev` with `SENNI_SKIP_SIDECAR=1`. Creates `dist/` placeholder on fresh checkout.

**`build-embed.bat`:** Now copies `dist/senni-backend.exe` → `dist/senni-backend-x86_64-pc-windows-msvc.exe` after PyInstaller build (Tauri v2 requires the target-triple suffix).

**`.gitignore`:** Added `src-tauri/target/` and `src-tauri/gen/`.

### Tauri v2 quirks hit during bringup
- `tauri-plugin-tray` doesn't exist — tray is built into `tauri` with `features = ["tray-icon"]`
- `tauri.conf.json` needs both `build.devUrl` (dev) and `build.frontendDist` (production)
- `externalBin` requires the file to exist at build time, named with the target triple appended
- `tauri::image::Image` has no `from_bytes` — decode PNG with the `image` crate, then use `Image::new_owned`

### Still open
- Crash monitor (auto-restart on unexpected sidecar exit) — deferred
- Sidecar stdout/stderr capture to Tauri log — deferred
- Auto-updater + GitHub Actions CI/CD — next Phase 3 step

---

## Session notes — 2026-05-04 (Channel token fix / Memory tool removal / UI polish)

**Three fixes shipped.**

### What changed

**`static/js/api.js` — channel token prose preservation:** Path E/F were discarding prose inside `<|channel>...<channel|>` blocks (`.replace(..., "")` → `.replace(..., "$1")`). When Gemma 4 wraps its response inside a channel block before a tool call, the prose is now extracted rather than stripped, preventing bubble deletion.

**`tools/memory.py` deleted.** Old generic memory tool removed. `static/js/tool-parser.js` `TOOL_DEFINITIONS` updated: `memory` replaced with `soul_user`, `note`, `soul_reflect`, `soul_identity` (in order of usage frequency / restriction level). `_enforceReadBeforeWrite` and `_readCache` stack removed from `api.js`. Soul-write side effect (`reloadSoulFiles`) updated to fire on the three new soul tools.

**`static/js/chat-ui.js` — scroll lock:** Added `_scrollLockUntil` timestamp + `_prevScrollTop` tracker. Upward scroll now sets a 1.5 s lock — `scrollIfFollowing()` bails if the lock is active, so streaming can't fight the user back to the bottom. `scrollToBottom()` (send, tab switch) clears the lock.

**`static/css/base.css` + `static/css/orb.css` — bottom spacing:** Bottom padding reduced from `orb-size + 56px` to `orb-size + 24px`; last-child margin-bottom simplified from `calc(orb-size - overlap + 8px)` to `8px`. Total clearance below last message: ~68px (down from ~128px), leaving ~12px gap above the orb.

### Still open
- **Double memory-server shutdown message** — cosmetic, not investigated.
- **TTS voice list on existing install** — fresh-install test still recommended.
- **Channel token: prose-only continuation** — when Gemma 4 emits prose + `<|channel><channel|>` without a tool call, the channel tokens currently fall through to the plain reply path and display as visible text. Future: detect standalone channel signal, strip it, and give the model another turn.

---

## Session notes — 2026-05-03 (TTS voices / Gemma prose / Identity refactor / Reinstall / Default folder fix)

**All four backlog items completed. `companions/default/` bug root-caused and fixed.**

### What changed

**`scripts/tts.py`:** `_list_kokoro_voices()` now calls `snapshot_download` once (no `local_files_only`) with `allow_patterns=["voices/"]` and recursive glob. Fixes the 6-voice cap from partial HF cache.

**`static/js/api.js`:** Gemma prose before tool calls now preserved — Path E/F finalize the stream bubble with clean prose instead of removing it. Log truncation limits raised (400→2000, 120/200→1000).

**`scripts/paths.py`:** Added `SOUL_FILE`, `REFLECTIONS_FILE`, `USER_PROFILE_FILE`, `UNBOUND_FILE` constants.

**Identity rename (steps 3–6):** `companion_identity.md`→`soul.md`, `self_notes.md`→`soul_reflections.md` throughout codebase. Boot-time migration in `_migrate_soul_filenames()`. New tools: `soul_identity.py`, `soul_reflect.py`, `soul_user.py`, `note.py`. Evolution-level gating in `_get_enabled_tools()` via `_EVOLUTION_REQUIRED`.

**`scripts/setup_router.py`:** `POST /api/setup/reinstall-extra` and `POST /api/setup/reinstall-llama` endpoints with SSE streaming. Download size validation in `_download_to_queue()`.

**`static/js/settings-features.js`:** `spReinstallExtra()` and `spReinstallLlama()` wired to new endpoints with inline progress/status.

**`companions/default/` bug:** Root cause — `config.json` had stale `companion_folder: "default"` from old DEFAULTS. Fixed two ways: (1) all `"default"` companion_folder fallbacks in Python + JS replaced with `DEFAULTS["companion_folder"]` / `'senni'`; (2) boot-time migration in `on_startup()` rewrites config.json if the stored folder has no companion config.json but the real default exists.

### Still open
- **Double memory-server shutdown message** — cosmetic, not investigated.
- **TTS voice list on existing install** — verified working on this machine after fix. Fresh-install test still recommended.

---

## Session notes — 2026-05-03 (Kokoro TTS boot + folder picker + venv local install)

**Kokoro TTS now boots reliably. IFileOpenDialog folder picker. Dev-mode `features/venv/` with Python 3.12. Voice list from subprocess `__ready__`. Diagnostics show resolved paths.**

Key changes: `_win_folder_dialog_ifiledialog()` in server.py; venv sys.path injection at startup; `_list_kokoro_voices()` via `importlib.util.find_spec`; `_tts_voices` global in tts_server; `reset_tts_unavailable()` called on TTS settings save; `features/venv/` creation with preferred Python in setup_router; `FEATURES_VENV_DIR` + `venv_site_packages()` in paths.py; diagnostics checks venv path.

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
