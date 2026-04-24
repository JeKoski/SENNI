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

## Session notes — 2026-04-24 #3 (Bug fixes — mood pill, bubbles, TTS chunking, wizard orb)

**5 isolated bugs fixed. ChromaDB smoke test confirmed working (user). Phase B next.**

### What changed

**`scripts/settings_router.py`:**
- GET `/api/settings`: added `mood_pill_visibility` to response (was missing — UI always fell back to `'always'`)
- POST `/api/settings/companion` allowlist: added `mood_pill_visibility` (was never written to config)

**`static/css/base.css`:**
- Added `::before { content:''; flex:1; }` on `.messages` — pushes bubbles/pills to bottom when few messages exist; spacer shrinks to 0 on overflow so scrolling still works

**`static/js/tts.js`:**
- `_TTS_SENTENCE_RE`: changed `(?:\s|$)` → `\s+` — requires real whitespace after punctuation, not end-of-buffer. Fixes false mid-token splits when streaming delivers `filename.` before the rest of the extension arrives. End-of-stream remainder handled by `_ttsFlushBuffer()`

**`scripts/tts_server.py`:**
- Added `_humanise_inline_code()` — strips backticks, replaces underscores with spaces, expands file extensions (`.md` → ` dot md`)
- `strip_markdown()` now calls `_humanise_inline_code()` before the `_MD_RULES` pass instead of silently dropping inline code

**`static/companion-wizard.html`:**
- `_buildReview()`: review step orb (`#review-avatar-icon`) now uses `_getSilhouette()` with species color instead of emoji
- `wizFinish()`: compile overlay orb (`#compile-orb-icon`) now uses `_getSilhouette()` with species color instead of emoji

### Bugs fixed

| Bug | Fix |
|-----|-----|
| Mood pill visibility not saving | Missing field in GET response + POST allowlist |
| Chat bubbles/pills anchor to top | `::before` flex spacer in `.messages` |
| TTS splits mid-filename (e.g. `file.md`) | Regex requires whitespace, not end-of-buffer |
| TTS silently drops inline code | Humanization pass: underscores→spaces, `.ext`→"dot ext" |
| Wizard review/compile orb shows emoji | Wired `_getSilhouette()` with species color into both |

### Deferred
- **Streaming chunk + TTS skip** — live in send/stream pipeline, fix post-Phase B
- **Tab order** — defer to Phase B (coupled to chat-tabs.js restructuring)
- **Gemma tool call continuation** — needs separate investigation

### Next session
- **Phase B: frontend chat split** — extract `buildSystemPrompt()` from `chat.js`, split startup/session flow, split send/stream pipeline. Update `design/ARCHITECTURE.md` and `chat.html` load order throughout.

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
