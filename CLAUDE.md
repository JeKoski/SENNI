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

## Session notes — 2026-04-29 (Settings redesign + Identity/Evolution system design)

**Full Settings + Companion Settings tab structure locked. Identity evolution system designed. Library system named. Unbound transition specced. Design docs created.**

### Decisions made

**Settings panel — 6 tabs:** Model · Generation · Display · Features · Tools · About
- TTS paths moved Server → Features. Display tab: markdown, pill visibility, "show technical details". Companions removed as tab — moves to sidebar.

**Companion Settings — 7 tabs:** Identity & Memory · Generation · Heartbeat · Expression ✦ · Voice · Tools · Library (stub)
- Identity & Memory: name, avatar (both slots), force-read, retrieval sliders, → Memory Manager link. File editor moves to Memory Manager.
- Presence + Mood → Expression tab with segmented [Presence | Mood] toggle. "Lore" → Library.

**Sidebar + orb:** Companions button replaces heartbeat. Orb clickable for manual heartbeat (hover: dim + icon + tooltip).

**Memory Manager:** Separate floating window. Phase 1: file editor. Phase 2: ChromaDB browser.

**Library system:** `character_book` in V2 spec. ChromaDB = *what happened*, Library = *what is true*. Four tiers. Companion-authored entries planned.

**Identity evolution system** — see `design/IDENTITY.md`:
- File renames: `companion_identity.md` → `soul.md`, `self_notes.md` → `soul_reflections.md`. Use `paths.py` constants before rename pass.
- New tool suite: `soul_identity`, `soul_reflect`, `soul_user`, `note` — replaces generic `memory` tool for soul/mind files
- Each tool: `action: "read" | "write"`. Full rewrite only. `note.py` unrestricted filenames + `list` action.
- Evolution levels gate tool access (Settled/Reflective/Adaptive/Unbound). `write_library` + memory curation available at all levels (separate toggles).

**Unbound transition:** Custom styled modal → orb color-shift starts → settings close → `unbound.md` created from template → one-shot heartbeat fires → orb settles. `unbound.md` always in context (lean directive, companion writes below separator). Unbound extras: `set_presence`, `create_mood`/`edit_mood` tools.

**Chaos orb redesign:** `chaos` state → smooth color-shifting cycle (~8–12s, curated, not random). Used for Unbound transition + available as presence preset.

### Bug fixed
- Server restart overlay disconnected after UI redesign — rewired `showRestartOverlay()` + `watchBootLog()` in `restartServer()` and `spRestartServer()`. `spRestartServer` now closes settings before overlay.

### Files created/updated
- `design/IDENTITY.md` — created
- `design/SETTINGS-REDESIGN.md` — tab layouts locked
- `design/CHARA_CARD.md` — Library rename + tiers
- `design/SYSTEMS.md` — chaos orb redesign noted
- `BACKLOG.md` — multi-session tracks section added

### Next session
- Settings panel implementation — done ✓ (2026-04-30)

---

## Session notes — 2026-04-30 (Settings panel redesign implementation)

**Settings panel fully redesigned. 5 tabs → 6. Token/elevation system applied throughout. Three new JS modules. Three new backend endpoints.**

### What changed

**`static/css/settings.css` — full visual pass:**
- Panel chrome: gradient dark bg + `--elev-3` shadow + `--border-default`
- Tab bar: pill-chip container (`--surface-sunken`) with filled active chip (`--surface-raised` + `--elev-1`) — replaces old underline style
- All form inputs/selects/textareas: `--surface-sunken` bg + `--focus-ring` on `:focus`
- Arg rows, companion items: `--surface-raised` bg + `--border-subtle`
- Buttons: `--elev-1` on primary, `--surface-raised` on ghost; all transitions use `var(--dur-fast)`
- Section labels: `--border-subtle` bottom border for visual grouping
- New utility classes: `.sp-accordion`, `.sp-feat-status`, `.sp-tool-row`

**`static/chat.html` — tab restructure:**
- "Server" renamed → "Model"; `#tab-server` → `#tab-model` throughout
- TTS section removed from Model tab
- Display toggles (markdown, controls, thinking auto-open) removed from Generation tab
- **Display tab** (new): chat display toggles + 7 tool pill toggles + "show technical details"
- **Features tab** (new): TTS accordion + ChromaDB accordion with status badges
- **Tools tab** (populated): 9 tool rows with enable/disable toggles
- Footers: `sp-footer-server` → `sp-footer-model`; new footers for display/features/tools

**`static/js/settings.js`:**
- Added `spDisplayDirty`, `spFeaturesDirty`, `spToolsDirty` dirty flags
- `_spSetDirty`/`_spClearDirty`/`_spUpdateFooterButtons` updated for all 6 tabs
- `spSwitchTab` footer list updated: `['model','generation','display','features','companion','tools']`
- `openSettings()` now opens Model tab; `spLoad()` calls all new populate functions

**`static/js/settings-server.js`:**
- Removed all TTS functions (moved to settings-features.js)
- Removed TTS save block from `spSaveServer`; dirty marker updated to `_spSetDirty('model')`

**`static/js/settings-generation.js`:**
- Removed display toggle population from `spPopulateGeneration`
- Removed `spToggleMarkdown`, `spToggleThinkingAutoopen`, `spToggleControlsVisible`
- Removed `markdown_enabled`/`thinking_autoopen` from save payload

**`static/js/settings-display.js`** (new): Display tab — populate/save markdown + controls + thinking + tool pills + show_technical_details. Saves to `/api/settings/generation` (gen keys) + `/api/settings/display` (pills + tech details).

**`static/js/settings-features.js`** (new): Features tab — TTS accordion + ChromaDB accordion. All TTS browse/clear/fill-default helpers moved here with dirty calls updated to `spMarkFeaturesDirty`. Saves to `/api/settings/tts` + `/api/settings/features`.

**`static/js/settings-tools.js`** (new): Tools tab — 9 tool toggles. Saves to `/api/settings/tools`.

**`static/js/settings_os_paths.js`:** `getElementById('tab-server')` → `getElementById('tab-model')`.

**`scripts/config.py` DEFAULTS:**
- Added `show_technical_details: False`
- Added `tools_enabled` dict (all tools True by default)
- `load_config()` now deep-merges `tool_pills` and `tools_enabled`

**`scripts/settings_router.py`:**
- `POST /api/settings/display` — saves `show_technical_details` + `tool_pills`
- `POST /api/settings/features` — saves `memory.enabled` (ChromaDB toggle)
- `POST /api/settings/tools` — saves `tools_enabled` dict

### Status
- Settings panel visual: ✅ token system applied, pill tabs, elevation
- Model tab: ✅ (was Server — no content changes, just visual)
- Generation tab: ✅ (display toggles removed, sampling params only)
- Display tab: ✅ all toggles functional, saves/loads correctly
- Features tab: ✅ TTS fully functional, ChromaDB toggle wired — reinstall buttons still stub
- Tools tab: ✅ all 9 tools render + save
- About tab: ✅ untouched, just visually consistent

### Next session
- In-app check of Settings redesign — verify each tab loads and saves cleanly
- Companion Settings redesign: Identity & Memory, Expression ✦, Tools, Library tabs
- Sidebar Companions button + orb heartbeat trigger

---

## Session notes — 2026-04-27 (New machine setup + file browser)

**New machine running. CUDA setup wizard fixed. Server-side file browser built.**

### What changed

**`scripts/config.py` — GPU detection fix:**
- Windows now checks NVIDIA before Intel — Core Ultra 7 has integrated UHD which was matching first
- Added PowerShell `Get-WmiObject` as primary detection method (WMIC deprecated on Win11), WMIC kept as fallback

**`scripts/setup_router.py` — CUDA download fixes:**
- `_find_binary_asset` now skips `cudart-` prefixed assets — they were matching before `llama-b*-bin-win-cuda-*` alphabetically, causing the wrong zip to be downloaded as the main binary
- `_find_cudart_asset` + cudart download block added — downloads matching `cudart-llama-bin-win-cuda-*.zip` alongside main binary and extracts DLLs (cublas64, cublasLt64, cudart64) to same dir

**`build-embed.bat` — embed-based build pipeline:**
- Installs core deps (fastapi, uvicorn, etc.) into python-embed before PyInstaller runs
- Checks/installs PyInstaller into embed
- No system Python required

**`run-built.bat` — launch helper:**
- Runs `dist\senni-backend\senni-backend.exe`, keeps terminal open on exit/crash, shows exit code

**`scripts/server.py` — server-side file browser endpoint + dialog cleanup:**
- `GET /api/fs/ls?path=...` — directory listing for file browser modal. Windows with empty path returns drive list. Dirs-first sort. Per-entry error handling for permission-denied items.
- Replaced tkinter/ctypes/PowerShell native dialog attempts with `_win_file_dialog_ps` / `_win_folder_dialog_ps` (kept as dead code for now — superseded by client-side modal)

**`static/js/file-browser.js` — new cross-platform file browser modal:**
- `fileBrowser.open({title, mode, extensions, startPath})` → Promise
- Navigates server filesystem via `/api/fs/ls`. Windows drive list at root. Breadcrumb nav. Dirs-first. Extension filtering (non-matching files dimmed). Double-click to confirm. Keyboard (Escape/Enter).

**`static/css/file-browser.css` — modal styles using existing token system**

**`static/js/wizard.js`, `static/js/settings-server.js` — all three browse call sites updated:**
- `browseFile()` in wizard.js — uses `fileBrowser.open()`
- `spBrowse()` in settings-server.js — uses `fileBrowser.open()`
- TTS browse in settings-server.js — uses `fileBrowser.open()`

**`static/wizard.html`, `static/chat.html` — load file-browser.js + file-browser.css**

### Status on new machine
- GPU auto-detection: ✅ NVIDIA found
- llama-server CUDA download: ✅ (cudart DLLs + main binary)
- File browser: built but not yet tested in built version (session ended before test)
- Full setup end-to-end: not yet verified

### Next session
- Test file browser in built app
- Verify llama-server boots with CUDA build
- Complete setup end-to-end (model download, first boot)
- Then: Settings Features tab or Gemma4 debugging

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
