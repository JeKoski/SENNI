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
- **Surface tradeoffs, don't pick silently** — if multiple valid approaches exist, name them and let Jesse choose. If a simpler path exists than what was asked for, say so. If something is unclear, stop and ask rather than assuming.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won't work. Automate it or build it into existing flows instead.
- **Suggest Extended Thinking** and/or Opus when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **Goal-driven execution** — for any non-trivial task, define success criteria upfront before writing code. e.g. "Fix the scenario field" → "wizard_compile.py outputs correct scenario value; round-trip import restores it." Verifiable goals enable looping to completion without constant check-ins.
- **End every session by updating CLAUDE.md, BACKLOG.md, and any relevant design docs.** This is non-negotiable — it's what makes the next session productive.

---

## Project overview

SENNI is a local AI companion framework. Currently running with Gemma 4 E4B Q4_K_M, Intel Arc A750 GPU.

Two servers:

- **Python bridge** (`scripts/server.py`) — FastAPI, handles UI, tools, config. Needs terminal restart for changes.
- **llama-server** — the model itself. Can be restarted in-app.

Runs on Linux (primary dev) and Windows (also tested and supported). Currently on Windows.

**New PC incoming (within 1-2 weeks as of 2026-04-17):** Core Ultra 7 270K + RTX 5060 Ti 16GB + 32GB DDR5. Will need CUDA llama-server build (switching from SYCL/Intel Arc). Larger models and OmniSVG become viable.

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
- GPU: Intel Arc A750 (SYCL build on Windows, oneAPI on Linux) — switching to RTX 5060 Ti + CUDA soon
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

## Session notes — 2026-04-24 #2 (ChromaDB bundling + misc fixes)

**ChromaDB now installs into python-embed (embed mode). Diagnostics fixed. mmproj auto-fill fixed.**

### What changed

**`scripts/setup_router.py`:**
- `_EXTRAS_INSTALL_MODE["memory"]` changed from `"target"` to `"embed"` — chromadb (like kokoro) has native extensions (`chromadb_rust_bindings`) that fail DLL loading when installed via `--target` on Windows. Embed mode keeps DLLs co-located. Rule: any extra with native extensions → embed mode.

**`scripts/server.py` — sys.path/DLL patch expanded:**
- Always adds `features/packages/` (safe even if dir missing)
- In frozen mode: adds `python-embed/Lib/site-packages/` (where all embed-mode extras live)
- In frozen mode: `os.add_dll_directory(PYTHON_EMBED_DIR)` so native extension DLLs are findable
- In frozen mode: appends `python-embed/python*.zip` as low-priority stdlib fallback (fills gaps like `graphlib` that PyInstaller didn't collect because chromadb is in `excludes`)
- `importlib.invalidate_caches()` after all path changes (required in frozen mode — path importer cache doesn't rescan new entries without it)

**`senni-backend.spec`:**
- Added `"graphlib"` and `"sqlite3"` / `"_sqlite3"` to `HIDDEN_IMPORTS` — stdlib C extensions PyInstaller won't collect unless explicitly listed

**`scripts/memory_store.py`:**
- `_ensure_chroma()`: logs actual import error (was silently returning False), adds `importlib.invalidate_caches()`, inserts python-embed site-packages into sys.path as belt-and-suspenders
- Error message updated to "Install via Setup Wizard > Features" (was `pip install chromadb --break-system-packages`)

**`scripts/diagnostics.py`:**
- `_check_import("kokoro"/"chromadb")` replaced with `_check_extra(key, label)` — path-based detection matching setup_router logic. Frozen mode: checks `PYTHON_EMBED_DIR/Lib/site-packages/<pkg>`. Source mode: falls back to `import`. Was always failing in frozen mode because main process can't `import kokoro` (it lives in python-embed, not the frozen bundle's Python).

**`static/js/wizard.js`:**
- `_applyModelStatus`: when auto-selecting a downloaded model card, now also fills `mmprojPath` and enables multimodal if the model has a mmproj on disk. Previously only did this on user click, leaving mmproj unset when model was already downloaded.

### Bugs fixed

| Bug | Fix |
|-----|-----|
| ChromaDB always "not installed" | sys.path patch ran before dir existed + no `invalidate_caches()` |
| chromadb import: `No module named 'chromadb'` | `invalidate_caches()` missing in frozen mode |
| chromadb import: `No module named 'graphlib'` | Added stdlib zip fallback + graphlib to hidden imports |
| chromadb import: `_sqlite3` missing | Added sqlite3/_sqlite3 to hidden imports |
| chromadb import: DLL load failed (rust bindings) | Switched to embed mode; `os.add_dll_directory` for python-embed |
| Diagnostics always failing for kokoro/chromadb | Replaced import-based check with path-based `_check_extra()` |
| mmproj not auto-set on wizard re-run | `_applyModelStatus` now fills mmprojPath when auto-selecting downloaded card |

### Status
ChromaDB install pending final smoke test (switching to embed mode requires reinstall). TTS confirmed working end-to-end from previous session.

### Next session
- Verify ChromaDB smoke test (embed mode install + memory system init)
- Begin working through BACKLOG bugs (streaming, bubbles, tab order, mood pill save)
- Settings: Features tab design
- espeak bundling

---

## Session notes — 2026-04-24 (Phase C complete — PyInstaller bundle working, TTS smoke test near-complete)

**PyInstaller spec written, bundle boots, smoke test run. All major bundling bugs fixed.**

### What changed

**`senni-backend.spec` (new):**
- One-dir mode, `console=True`, `upx=True`
- DATAS: `static/`, `templates/`, `tools/`, `scripts/tts.py` (real .py, not compiled — subprocess needs it)
- `python-embed/` added to DATAS if dir exists at build time
- Excludes `chromadb`, `sentence_transformers`, `kokoro` (user-installed via wizard)

**`scripts/build_prep.py` (new):**
- Downloads Python embeddable matching current Python version, extracts to `python-embed/`
- Uncomments `#import site` in `*._pth` file (required for pip)
- Bootstraps pip via `get-pip.py`
- Linux: creates `.linux-placeholder` (uses system Python at runtime)

**`build.bat` (new):**
- Auto-runs `build_prep.py` if `python-embed/` missing, then `pyinstaller senni-backend.spec`

**`scripts/paths.py`:** Added `PYTHON_EMBED_DIR = RESOURCE_ROOT / "python-embed"`

**`.gitignore`:** Added `python-embed/` (build artifact)

**`tools/memory.py`, `tools/write_memory.py`, `tools/retrieve_memory.py`, `tools/supersede_memory.py`, `tools/update_relational_state.py`:**
- All `__file__`-based path construction removed (breaks in PyInstaller bundle)
- Now import `CONFIG_FILE`, `COMPANIONS_DIR`, `DATA_ROOT` from `scripts.paths`

**`scripts/diagnostics.py`:** `STATIC_DIR` from `scripts.paths` instead of `project_root / "static"` (static lives in RESOURCE_ROOT in bundle, not DATA_ROOT)

**`scripts/auto_backup.py` (rewrite):**
- Old: read `.gitignore` to filter backup — no `.gitignore` in bundle → backed up `_internal/` recursively → Windows MAX_PATH disaster
- New: backs up only `config.json` + `companions/` using constants from `scripts.paths`. Prunes to 10 most recent.

**`scripts/setup_router.py`:**
- `_get_pip_python()` — uses `PYTHON_EMBED_DIR/python.exe` in frozen mode; falls back to system Python in source mode
- `_EXTRAS_INSTALL_MODE`: TTS = `"embed"` (python-embed site-packages, DLL-safe), memory = `"target"` (`features/packages/`)
- `_EXTRAS_POST_CMDS`: TTS runs `python -m spacy download en_core_web_sm` post-install (pre-download prevents runtime pip → stdout corruption of TTS JSON protocol)
- `_EXTRAS_META["tts"]` packages: `["kokoro", "soundfile"]` (soundfile omitted from kokoro's deps)

**`static/js/wizard.js`:**
- Fixed extras toggle: `const skip = localFound || !localInstall` (`systemFound` always False in bundle — old logic broke the toggle)

**`scripts/tts_server.py`:**
- `_resolve_python()` uses `PYTHON_EMBED_DIR` in frozen mode
- Exception handler always captures stderr (not just on exit code 2)

### Bugs fixed during smoke test

| Bug | Fix |
|-----|-----|
| Recursive backup → Windows MAX_PATH | Rewrote `auto_backup.py` to only back up `config.json` + `companions/` |
| `pip failed for kokoro` — `sys.executable` = .exe in frozen | `_get_pip_python()` finds `python-embed/python.exe` |
| Extras toggle broken in bundle | Simplified skip logic — removed dead `systemFound` branch |
| `tts.py not found at _internal/scripts/tts.py` | Added `("scripts/tts.py", "scripts")` to spec DATAS |
| `ModuleNotFoundError: numpy` | Binary packages via `--target` break Windows DLL loading; TTS now installs into python-embed site-packages |
| `soundfile not installed` | Added to `_EXTRAS_META["tts"]` package list |
| TTS header parse failed — pip output on fd 1 | Pre-download spaCy model in `_EXTRAS_POST_CMDS` |

### Status
33/33 tests green. Bundle boots, wizard runs, extras install, TTS subprocess starts. spaCy pre-download fix applied — final synthesis test pending rebuild.

### Next session
- Rebuild and verify TTS synthesis end-to-end
- espeak bundling (portable binary like llama-server)
- Settings "Install features" button (post-wizard path)
- Senni app icon (binary + wizard + elsewhere)
- GitHub Actions CI workflow

---

## Session notes — 2026-04-23 #3 (Path centralization, boundary hardening, Phase 2 complete)

**`scripts/paths.py` created. Path traversal hardened. Phase 2 PyInstaller prerequisites done.**

### What changed

**`scripts/paths.py` (new):**
- Single source of truth for all path constants
- `RESOURCE_ROOT` (read-only bundled assets) vs `DATA_ROOT` (writable user data) split — diverge in PyInstaller bundle (`sys._MEIPASS` vs `sys.executable.parent`), same in source mode
- `PROJECT_ROOT` re-exported as `DATA_ROOT` alias for backward compat
- Named constants: `STATIC_DIR`, `TEMPLATES_DIR`, `TOOLS_DIR`, `SCRIPTS_DIR`, `CONFIG_FILE`, `COMPANIONS_DIR`, `LOGS_DIR`, `BACKUPS_DIR`, `BINARY_DIR`, `MODELS_DIR`, `FEATURES_DIR`, `FEATURES_PACKAGES_DIR`
- 6 files updated to import from here: `config.py`, `server.py`, `tool_loader.py`, `setup_router.py`, `memory_server.py`, `tts_server.py`

**Path safety helpers in `scripts/config.py` (new):**
- `sanitize_folder(name)` — strips to `[a-z0-9_-]`, max 64 chars
- `sanitize_filename(name)` — rejects `..`, strips unsafe chars, max 200
- `confine_path(path, root)` — raises `ValueError` if resolved path escapes root
- Applied at all route boundaries: `history_router.py`, `settings_router.py`, `server.py`
- `session_id` in history media route now sanitized (was missing)
- Soul file save/delete both hardened; `api_new_companion` uses proper sanitizer

**`main.py` updated:**
- Switched from string import `"scripts.server:app"` to direct `from scripts.server import app` — PyInstaller static analysis friendlier
- `wizard_compile.py` `output_dir` concern resolved — uses `COMPANIONS_DIR` from `scripts.paths`, resolves to `DATA_ROOT/companions` in bundled mode automatically

**33/33 tests green throughout.**

### Next session: Phase C (PyInstaller resource audit)
- Audit all path accesses for bundled correctness
- Write PyInstaller spec (`senni-backend.spec`)
- First packaged smoke test


## Session notes — 2026-04-23 #2 (Diagnostics, test harness, boot service extraction)

**Self-diagnostic suite added. pytest harness established (33 tests). Boot logic extracted.**

### What changed

**Bug fixes in GPT's extractions (`history_router`, `settings_router`, `server.py`):**
- `JSONResponse` added to `server.py` imports (was `NameError` on wizard PNG export 404)
- `delete_avatar_files` dead import removed from `server.py`
- Redundant `TEMPLATES_DIR = ...` reassignment removed from `server.py`
- Double file read in `api_get_soul_files` fixed (`settings_router.py:238`)

**`scripts/diagnostics.py` (new):**
- `setup_file_logging(log_dir, keep=10)` — one timestamped `logs/senni_YYYY-MM-DD_HHMMSS.log` per boot, last 10 kept
- `run_startup_checks()` — fast: Python version, config, model path, companion folder, static dir, optional extras imports
- `run_full_checks()` — everything above + binary/mmproj/espeak paths, companions/ write test, each companion config JSON validity
- `log_results()` — formatted PASS/FAIL block through the logger; `results_to_dict()` for JSON response

**`scripts/server.py` wiring:**
- `logging.basicConfig` + `setup_file_logging` called at module level (captures all startup output)
- `run_startup_checks` called in `on_startup`, results logged
- `GET /api/diagnostics` — on-demand full checks, returns JSON + logs

**`static/chat.html` + `static/js/settings-server.js`:**
- "⬡ Run diagnostics" button added to Settings → About, left of Restart Server
- `spRunDiagnostics()` calls `/api/diagnostics`, renders inline PASS/FAIL results below button row

**`scripts/boot_service.py` (new):**
- All llama-server lifecycle extracted from `server.py`: state globals, `_boot_lock`, `kill_llama_server()`, `get_boot_status()`, `_kill_process_tree()`, `_build_and_launch()`, `_run_subprocess()`, `POST /api/boot`, `GET /api/boot/log`
- `server.py` lost ~200 lines; imports `kill_llama_server` + `get_boot_status` + `boot_router`

**Test harness (`tests/`):**
- `pytest.ini` — `asyncio_mode = auto`
- `requirements-dev.txt` — `pytest`, `pytest-asyncio` (httpx already in requirements.txt)
- `conftest.py` — `isolated_paths` patches `COMPANIONS_DIR`/`CONFIG_FILE` in config + router modules; `test_config` writes minimal config; per-router async client fixtures
- `test_history_router.py` — 12 tests
- `test_settings_router.py` — 12 tests
- `test_boot_service.py` — 9 tests
- **33/33 green, 1.73s**

**`BACKLOG.md` updates:**
- Phase A boot extraction marked complete
- Smoke testing section updated: harness established, pattern documented
- Phase 2 PyInstaller: `main.py` entry point and `output_dir` concerns added

---

## Session notes — 2026-04-23 (Packaging-oriented modular refactor start — GPT)

**History/settings routes extracted. Launcher dependency check fixed.**

- `scripts/history_router.py` created — owns `/api/history/*`
- `scripts/settings_router.py` created — owns settings, companion, avatar, and soul-file routes
- `scripts/server.py` now registers both routers directly
- `start.bat` launcher: fast import check before pip install; ASCII comments replacing Unicode

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
| `design/SETUP_WIZARD.md`    | Setup wizard — step flow, GPU→binary mapping, animation principles, backend endpoints needed.                                       |
| `design/WIZARD.md`          | Companion Creation Wizard — V2 character card format, Birth Certificate architecture, step flow, appearance sub-steps.              |
| `design/CHARA_CARD.md`      | Chara card V2 field reference, SENNI alignment, soul file best practices, first_mes, system_prompt, character_book/lorebook design. |
