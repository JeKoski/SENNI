# CLAUDE.md — Instructions for Claude

This file is for Claude to read at the start of every session.
Search for it using project knowledge before doing anything else.

---

## Session Flow
1. Start session with CLAUDE.md
2. We'll figure out what we're doing this session. Often listed on this doc.
3. Claude asks for needed files
4. Surgical work happens

---

## Critical working rules

- **Always provide complete files** — never code sections, never snippets, never "find X and replace with Y". The user has ADHD and finds partial edits extremely difficult. Full file replacements only.
- **One file at a time** where possible. Flag upfront if a feature will require touching multiple files and get agreement before proceeding.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won't work. Automate it or build it into existing flows instead.
- **Suggest Extended Thinking** and/or Opus when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **End every session by updating CLAUDE.md and any relevant design docs.** This is non-negotiable — it's what makes the next session productive.
- Remind user to push changes and refresh project knowledge.

---

## Project overview

SENNI is a local AI companion framework. Currently running with Qwen3.5 9B Q4_K_M, Intel Arc GPU. Also tested with Gemma 4 on Vulkan.

Two servers:
- **Python bridge** (`scripts/server.py`) — FastAPI, handles UI, tools, config. Needs terminal restart for changes.
- **llama-server** — the model itself. Can be restarted in-app.

Runs on Linux (primary dev) and Windows (also tested and supported).

---

## File map

### Python
| File | Purpose |
|------|---------|
| `scripts/server.py` | FastAPI bridge — UI, tools, config endpoints |
| `scripts/config.py` | Config read/write, DEFAULTS, GPU detection, path resolution |
| `scripts/memory_server.py` | Memory FastAPI router, consolidation scheduler |
| `scripts/memory_store.py` | ChromaDB wrapper, embedding, link pipeline |
| `scripts/tts_server.py` | Kokoro TTS router |
| `scripts/tool_loader.py` | Auto-discovery tool loader — scans `tools/`, no config needed |

### Tools (auto-loaded from `tools/` — drop a file in, it registers itself)
| File | Purpose |
|------|---------|
| `tools/memory.py` | soul/ and mind/ markdown file read/write |
| `tools/web_search.py` | Web search |
| `tools/web_scrape.py` | URL fetch |
| `tools/get_time.py` | Current date/time |
| `tools/write_memory.py` | Write episodic memory note to ChromaDB |
| `tools/retrieve_memory.py` | Deliberate (masculine-pathway) memory retrieval |
| `tools/supersede_memory.py` | Replace an outdated note with a new one, preserving history |
| `tools/update_relational_state.py` | Update Tier 1 relational state block |

### JavaScript (load order matters — deps listed)
| File | Purpose |
|------|---------|
| `static/js/tool-parser.js` | Tool call parsing/stripping — no DOM, no side effects |
| `static/js/api.js` | Model communication, tool execution, streaming |
| `static/js/attachments.js` | File attachment handling |
| `static/js/orb.js` | All orb logic (state, avatar, presets, layout mode) |
| `static/js/message-renderer.js` | Markdown rendering, message/thinking/tool DOM builders |
| `static/js/chat-ui.js` | DOM helpers, sidebar UI, input handling, orb delegation, scroll tracking |
| `static/js/chat.js` | Core: state, startup, session management, send, system prompt |
| `static/js/chat-tabs.js` | Tab state, persistence, switching |
| `static/js/chat-controls.js` | Input controls, stop button, vision mode picker |
| `static/js/heartbeat.js` | Heartbeat system |
| `static/js/tts.js` | TTS playback (Kokoro) |

---

## Backups

Auto-backup runs on server startup. Saved to `backups/YYYY-MM-DD_HHMMSS/`.
The `backups/` folder is in `.gitignore`.

If something breaks, copy files from the latest backup folder.

---

## Companion config

Companion config lives in `companions/<folder>/config.json`.
Global config in `config.json` at project root.

Key companion config fields:
- `presence_presets` — dict of preset name → per-state dict `{ thinking:{...}, idle:{...}, ... }`
- `active_presence_preset` — which preset is active
- `moods` — dict of mood name → override dict (backend ready, UI pending)
- `active_mood` — currently active mood or null
- `cognitive_stack` — four-slot stack string e.g. `mT-fS-mN-fF`
- `last_consolidated_at` — timestamp for crash-recovery consolidation

Key global config fields:
- `memory.enabled` — master switch for the ChromaDB memory system (default: `True`)
- `memory.mid_convo_k` — how many notes the associative trigger surfaces (default: `4`)
- `memory.session_start_k` — how many notes to surface at session start (default: `6`)

### Tool distinction (important for system prompt clarity)
- `memory` tool → soul/ and mind/ **markdown file** read/write
- `write_memory` / `retrieve_memory` / `supersede_memory` / `update_relational_state` → **ChromaDB** episodic store only

### Zep-style temporal chaining
When a fact changes, the companion calls `supersede_memory` with the old note's ID (shown in `retrieve_memory` output as `id: xxxxxxxx…`). The old note is marked `superseded_by` and excluded from future retrieval. The new note carries a `supersedes` back-reference. Both notes remain in the store so the companion can reason about how things changed over time.

---

## Companion portability

Copying a companion folder between installs:
- **Safe to copy:** `soul/`, `mind/`, `config.json` — fully portable
- **Do NOT copy:** `memory_store/` (ChromaDB, path-dependent and binary), `memory_meta.json` (install-specific consolidation state, collection name tied to folder name)
- If folder is renamed on the destination, ChromaDB collection name will mismatch and a fresh empty store will be created — episodic memories silently lost
- After importing without memory: run `/api/memory/reindex` if you later add a compatible store
- A proper export/import feature is needed eventually: needs its own popup UI with checkboxes (soul files, mind files, ChromaDB episodic memory, config). Tracked in `design/FEATURES.md`.

---

## Bugs

Bugs are grouped by area. Where a fix should be bundled with a feature, that is noted.

### Orb / Presence

- ~~**Orb edge color not applying from presence preset**~~ — **Fixed**
- ~~**Heartbeat state uses idle values**~~ — **Fixed**

### Chat

- **Streaming text visual (token-by-token appearance) regressed** — secondary priority. Needs investigation.
- **Message loss on restart/refresh suspected** — likely improved by history system rework. Keep open until confirmed stable over several sessions.
- ~~**Streaming cursor stuck at bottom of message bubble**~~ — **Fixed**
- ~~**Closing a tab during generation bleeds response into new active tab**~~ — **Fixed**
- ~~**Active tab not remembered on restart/refresh**~~ — **Fixed**
- ~~**Scroll fighting during streaming**~~ — **Fixed**

### Heartbeat

- ~~**Duplicate heartbeat bubble**~~ — **Fixed**
- ~~**Heartbeat settings not applying until refresh**~~ — **Fixed**
- ~~**Heartbeat chat log deleted on refresh**~~ — **Fixed**
- ~~**No way to stop heartbeat processing**~~ — **Fixed**
- ~~**Heartbeat events give no user feedback**~~ — **Fixed**

### Settings

- ~~**Settings TypeError on open**~~ — **Fixed**
- ~~**Markdown render toggle breaks on restart/companion switch**~~ — **Fixed**
- ~~**"Ask each time" image processing not working**~~ — **Fixed**
- ~~**Dirty tracking missing for several fields**~~ — **Fixed**
- ~~**Companion Settings exiting with dirty edits without confirmation**~~ — **Fixed**
- ~~**Settings windows don't reflect active tab/state on open**~~ — **Fixed**
- ~~**Default presence presets have non-hex colors and missing fields**~~ — **Fixed** in `config.py` DEFAULTS — but **existing companion `config.json` files on disk still have the old `rgba(...)` format**. Needs a one-time migration function or factory reset. Low priority until public release.
- ~~**Settings: Missing multimodal toggle**~~ — **Fixed**
- ~~**Settings: Markdown render reverting on boot/refresh/settings open**~~ — **Fixed**
- ~~**Settings Kokoro: Wrong file browser title**~~ — **Fixed**
- ~~**Companion Settings TTS: Saving resets TTS config**~~ — **Fixed**
- ~~**Dropdown menus (e.g. Kokoro voice select) white background / unreadable**~~ — **Fixed**
- ~~**Companion Settings: Ghost bar appears under tabs on open**~~ — **Fixed**
- ~~**Settings → TTS: espeak file browser title read "llama-server binary"**~~ — **Fixed**
- ~~**Settings → TTS: Voices directory had no folder picker**~~ — **Fixed**
- ~~**Settings → TTS: No default path detection for Python/espeak**~~ — **Fixed**
- **Settings: Server arg defaults outdated** — `--flash-attn` syntax changed (needs `on`/`off`/`auto` value); `--reasoning-format` may be obsolete for jinja-template models. Needs a pass against current llama.cpp.

### Memory

- ~~**Link eval parse error — 0 links ever confirmed**~~ — **Fixed**
- ~~**Associative retrieval never firing**~~ — **Fixed**
- ~~**Memory system silently disabled**~~ — **Fixed**

### UI / Layout

- **Tool and thinking pills have alignment/padding issues** — pills are misaligned relative to each other and the orb. **Bundle this fix with the pill visual rework** — don't fix in isolation.

---

## Design folder

Large design decisions live in `design/` as standalone docs. These are NOT loaded into context automatically — search project knowledge when you need them. Do not reproduce their full content in CLAUDE.md.

| File | Contents |
|------|----------|
| `design/ARCHITECTURE.md` | Modularity plan, completed refactors, planned modules, script/stylesheet load orders |
| `design/BOOT.md` | Boot & process lifecycle, TOCTOU problem, per-OS path resolution, file browsing via tkinter |
| `design/SYSTEMS.md` | Current state: Orb, Presence, Heartbeat, Companion window, Settings dirty tracking, Chat tabs, Vision mode, associative memory pill |
| `design/TTS.md` | Kokoro TTS architecture, config schema, Aurini integration boundary, what's done/pending |
| `design/FEATURES.md` | All planned features and changes, grouped by area |
| `design/MEMORY.md` | Full memory architecture — primitives, composites, primitive_ratios, retrieval, consolidation, ChromaDB stack. Updated 2026-04-06. |
| `design/COMPANION_STACK.md` | Cognitive function stack format, O+J axis pairing, charge as directionality, stack position as probability. Updated 2026-04-06. |
| `design/ORB_DESIGN.md` | Orb positioning, layout modes, CSS variable documentation |

When starting a session that touches any of these systems, search project knowledge for the relevant design doc rather than asking the user to explain it.

---

## Design sessions needed

These items are too open-ended to task out. They need a dedicated design conversation before any implementation.

- **Main Chat UI redesign** — overall feel should be "smoother, fuller, cozier". Known starting points: sidebar is too large (split into sections or cards?), buttons to pill shape, tools list moved out of sidebar into Settings, companion state/mood pills near the orb area. Color scheme is already good. Needs visual exploration before touching code.
- **Companion Creation Wizard — appearance sections** — Hair style grid, face shape, eyes, nose, outfit system, accessories, fetishes/kinks, natural triggers, and several other sections are marked "design needs expanding on". These need fleshing out before wizard implementation begins.
- **Closeness/relationship progression** — may become a gamified system (develop closeness over time). Needs design before the wizard's closeness step is finalized.
- **Companion Templates rework** — templates need redesigning to fit the new memory system and future features. Goals: don't clash with ChromaDB/soul/mind architecture; future-proof for Wizard and Mood system; keep token totals reasonable (balance context efficiency vs detail). Needs a design conversation before touching template files.

---

## Environment

- OS: Linux (primary) + Windows (also supported and tested)
- GPU: Intel Arc A750
- Models tested: Qwen3.5 9B Q4_K_M (primary), Gemma 4 on Vulkan
- llama-server: SYCL build on Windows, oneAPI build on Linux
- Temperature: 0.8 (critical — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled (Qwen3 only — disable for Gemma 4)
- Flash attention: auto-enabled by llama-server

---

## Known model quirks

**Qwen3.5 9B tool calls in thinking blocks** — confirmed llama.cpp bug (issue #20837): Qwen3.5 9B often prints tool calls in XML inside thinking blocks when thinking is enabled. Not a SENNI bug. Memory write discipline should be robust to unreliable self-initiation — associative pathway is system-driven, masculine self-retrieval has auto-trigger fallback.

**Gemma 4 tool call format** — Gemma 4 uses XML-style tool calls (`<tool_call><function=name>...`) via its jinja template, not SENNI's custom XML examples. System prompt must NOT include XML tool call examples for Gemma 4 — the jinja template handles it, and showing examples causes it to write XML instead of its native format. Handled via `modelFamily` detection in `chat.js`.

---

## Documentation convention

- **CLAUDE.md** — operational instructions + active bugs + design folder index. Update at end of every session.
- **design/*.md** — system docs and design decisions. Update when the relevant system is touched.
- Rule: when we touch a system in a session, we document it in that session. Don't defer.

---

## Session notes — 2026-04-12 #2

**Memory pipeline items 1–3 complete. New feature entries added to FEATURES.md.**

### What we actually found vs CLAUDE.md claims

Previous session ended mid-run (context/tool-call limit). Actual file state differed from what CLAUDE.md recorded:

- Item 1 (`onMemorySurface` deferred call) — claimed done, **not present** in uploaded `chat.js`. Fixed this session.
- `mind_file_index` / `session_history_index` in `_load_meta()` — claimed done, **confirmed present**. That one landed.
- `write_system_note()`, `_process_unconsolidated_sessions()`, `_index_mind_files()` — all absent, built this session.

### Files written/changed this session

- `static/js/chat.js` — `reloadMemoryContext()`: added 120ms deferred `onMemorySurface('')` call in the success branch so the session-start memory pill fires after replayed messages settle.
- `scripts/memory_store.py` — Added `write_system_note(content, source_label)`: fixed neutral ratios (0.25 each), no stack/mood computation, `function_source` = caller-provided label, `retrieval_mode` = `"associative"`, `decay_weight` = 0.5. Skips LLM consolidation queue intentionally — embedding-only linking is sufficient for system-ingested content and keeps startup fast.
- `scripts/memory_server.py` — Added `_process_unconsolidated_sessions()`: scans `history/` recursively, finds unprocessed `session.json` files, extracts and cleans assistant text (strips `<think>` and `<tool_call>` blocks), chunks at 800 chars, writes via `write_system_note`, marks `consolidated: true` in the file, updates `session_history_index` in meta. Added `_index_mind_files()`: scans `mind/*.md`, sha256-hashes each, compares to `mind_file_index`, writes new/changed files as chunked system notes, updates index. Both called from `init_memory_store()` as daemon threads via `_run_session_ingestion_async()` / `_run_mind_indexing_async()`.

### Memory pipeline status

1. ~~**Session-start context UI signal**~~ — **Done.**
2. ~~**Background embedding queue (session history ingestion)**~~ — **Done.**
3. ~~**Mind file indexing into ChromaDB**~~ — **Done.**
4. **Tool self-registration refactor** — full session needed. Each tool file should own its Python `run()`, JS schema, and system prompt instructions. Eliminates the three-place update requirement.
5. **Token budget empirical test** — run a session with 20+ notes and measure actual system prompt sizes from session-start retrieval (`k=6`). Adjust if needed.

---

## Session notes — 2026-04-12

**Bug fixes: companion settings ghost bar, TTS browse/defaults. Memory pipeline item 1 (partially — context limit hit before save).**

- `static/js/companion.js` — `_cpShowLoadingState`: `visibility:hidden` → `display:none`.
- `scripts/server.py` — `/api/browse`: espeak + folder types. `/api/tts/python-default` and `/api/tts/espeak-default` endpoints.
- `static/js/settings-server.js` — folder/espeak browse types, `spFillTtsDefault()`.
- `static/chat.html` — "Default" buttons for Python and espeak TTS rows.
- `scripts/memory_store.py` — `_load_meta()` extended with `mind_file_index: {}` and `session_history_index: []`.

---

## Session notes — 2026-04-11

**Memory system foundation pass — review, diagnostics, and fixes.**

- `static/js/chat.js` — Added `_assocTurnsSinceLast`, `_assocInterval()`, `_triggerAssociativeRetrieval()`.
- `scripts/config.py` — `memory.enabled` default `False` → `True`. Deep-merge for `memory` block.
- `tools/supersede_memory.py` — New tool.

---

## Session notes — 2026-04-10

**Bug fixes: TTS settings reset, dropdown colors, Kokoro file browser title, markdown render reverting.**

---

## Session notes — 2026-04-08

**Gemma 4 tool calling, memory link pipeline, multimodal toggle.**

---

## Session notes — 2026-04-06 #8

**Bug fixes: history loading, embedding timeout, role alternation 500, misc.**

---

## Session notes — 2026-04-06 #7

**System prompt XML format examples — complete.**

---

## Session notes — 2026-04-06 #6

**Tool call parser fix — Qwen XML format mismatch.**

---

## Session notes — 2026-04-06 #5

**CLAUDE.md refactor — split into design/ modules.**

---

## Session notes — 2026-04-06 #4

**Disk-backed history, associative memory retrieval, memory pill UI.**

---

## Session notes — 2026-04-06

**Memory system design finalised and implementation begun. TTS confirmed working.**
