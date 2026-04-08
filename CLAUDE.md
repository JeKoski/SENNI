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

## Key file map

### Python
| File | Purpose |
|------|---------|
| `scripts/server.py` | FastAPI bridge — API endpoints, tool routing, process management |
| `scripts/config.py` | Config read/write, per-OS path resolution, DEFAULTS |
| `scripts/tts.py` | Kokoro TTS subprocess worker — stdin JSON → WAV bytes stdout |
| `scripts/tts_server.py` | FastAPI router for `/api/tts/*`, TTS process lifecycle |
| `scripts/memory_store.py` | ChromaDB store, primitive ratios, retrieval, consolidation |
| `scripts/memory_server.py` | FastAPI router for `/api/memory/*`, session context assembly, idle consolidation timer |

### HTML
| File | Purpose |
|------|---------|
| `static/chat.html` | Main chat UI HTML — also defines script/stylesheet load order |

### CSS (load order matters — base first)
| File | Purpose |
|------|---------|
| `static/css/base.css` | CSS variables, reset, layout, sidebar, input bar |
| `static/css/messages.css` | Message bubbles, thinking blocks, tool indicators, attachments, tabs, context bar |
| `static/css/orb.css` | Companion orb structure, states, animations, layout modes, presence preview |
| `static/css/companion-panel.css` | Companion settings window and all its inner components |
| `static/css/settings.css` | Global settings panel (separate, pre-existing) |

### JavaScript (load order matters — deps listed)
| File | Purpose |
|------|---------|
| `static/js/tool-parser.js` | Tool call parsing/stripping — no DOM, no side effects |
| `static/js/api.js` | Model communication, tool execution, streaming |
| `static/js/attachments.js` | File attachment handling |
| `static/js/orb.js` | All orb logic (state, avatar, presets, layout mode) |
| `static/js/message-renderer.js` | Markdown rendering, message/thinking/tool DOM builders |
| `static/js/chat-ui.js` | DOM helpers, sidebar UI, input handling, orb delegation, scroll tracking |
| `static/js/chat-tabs.js` | Tab management, message serialization/replay, disk-backed history |
| `static/js/chat-controls.js` | Message controls, edit, regenerate, stop generation |
| `static/js/chat.js` | Core chat logic, session management, system prompt, boot |
| `static/js/heartbeat.js` | Heartbeat system |
| `static/js/companion.js` | Companion settings window coordinator (open/close, load, save, tabs, avatar, soul files, heartbeat, generation, dirty tracking) |
| `static/js/companion-presence.js` | Presence tab: presets, state editor, preview orb, layout toggle |
| `static/js/companion-tts.js` | Voice tab: voice blend UI (up to 5 slots), speed/pitch, preview |
| `static/js/companion-memory.js` | Memory tab: episodic memory toggle/status, cognitive stack editor, `cpMemorySaveGlobal()`, `_cpGetMemoryPayload()` |
| `static/js/tts.js` | TTS client: sentence buffer, fetch queue, Web Audio playback, stop/abort |
| `static/js/settings.js` | Settings panel coordinator (open/close, tab switch, load, toast, dirty tracking) |
| `static/js/settings-server.js` | Settings → Server tab (BUILTIN_ARGS, file browsing, save, restart) |
| `static/js/settings-generation.js` | Settings → Generation tab |
| `static/js/settings-companion.js` | Settings → Companion tab + About tab (companion list only — all other fields are in the Companion Window) |
| `static/js/settings_os_paths.js` | Per-OS path cards in Settings → Server tab |

### Tools
| File | Purpose |
|------|---------|
| `tools/memory.py` | soul/ and mind/ file read/write (identity, user profile, scratchpad) |
| `tools/write_memory.py` | Write episodic note to ChromaDB |
| `tools/retrieve_memory.py` | Direct retrieval from ChromaDB |
| `tools/update_relational_state.py` | Update Tier 1 relational state block |
| `tools/get_time.py` | Current time |
| `tools/web_search.py` | Web search |
| `tools/web_scrape.py` | Web scraping |

---

## Auto-backup system

On every Python bridge startup, `scripts/server.py` copies tracked files to `backups/YYYY-MM-DD_HH-MM-SS/`.
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

### Tool distinction (important for system prompt clarity)
- `memory` tool → soul/ and mind/ **markdown file** read/write
- `write_memory` / `retrieve_memory` / `update_relational_state` → **ChromaDB** episodic store only

---

## Companion portability

Copying a companion folder between installs:
- **Safe to copy:** `soul/`, `mind/`, `config.json` — fully portable
- **Do NOT copy:** `memory_store/` (ChromaDB, path-dependent and binary), `memory_meta.json` (install-specific consolidation state, collection name tied to folder name)
- If folder is renamed on the destination, ChromaDB collection name will mismatch and a fresh empty store will be created — episodic memories silently lost
- After importing without memory: run `/api/memory/reindex` if you later add a compatible store
- A proper export/import feature is needed eventually: JSON dump of notes → re-embed on import → reindex. Tracked in `design/FEATURES.md`.

---

## Bugs

Bugs are grouped by area. Where a fix should be bundled with a feature, that is noted.

### Orb / Presence

- ~~**Orb edge color not applying from presence preset**~~ — **Fixed**
- ~~**Heartbeat state uses idle values**~~ — **Fixed**

### Chat

- **Streaming text visual (token-by-token appearance) regressed** — secondary priority. Needs investigation.
- **Message loss on restart/refresh suspected** — non-heartbeat messages may also be getting lost on refresh, possibly related to DOM/history drift or tab switching edge cases. Needs a focused investigation session reading `chat.js` `sendMessage()`, `_saveCurrentTabState()`, and `startSession()` together.
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
- ~~**Settings/Companion windows populate and shift on open**~~ — **Fixed**
- ~~**Settings windows don't reflect active tab/state on open**~~ — **Fixed**
- ~~**Default presence presets have non-hex colors and missing fields**~~ — **Fixed** in `config.py` DEFAULTS — but **existing companion `config.json` files on disk still have the old `rgba(...)` format**. Needs a one-time migration function or factory reset. Low priority until public release.
- ~~**Settings: Missing multimodal toggle**~~ — **Fixed** (this session)
- **Settings: Markdown render reverting** — old bug, resurfaced. Toggle stays "on" visually but markdown stops rendering. Needs investigation.
- **Settings: Server arg defaults outdated** — `--flash-attn` syntax changed (needs `on`/`off`/`auto` value); `--reasoning-format` may be obsolete for jinja-template models. Needs a pass against current llama.cpp.
- **Settings Kokoro: Wrong file browser title** — browsing for Python executable shows "Select llama-server binary". One-liner fix in `server.py` `/api/browse` endpoint — add `"python"` type with correct title.

### Memory

- ~~**Link eval parse error — 0 links ever confirmed**~~ — **Fixed** (this session). Root causes: `EMBEDDING_LINK_THRESHOLD` too high (0.82→0.70); LLM pass wiped embedding links on parse failure; `_parse_link_eval_response` didn't strip thinking blocks; prompt caused Gemma 4 to return empty content; `_LlamaClient` used single user message causing Gemma 4 to produce empty responses. All fixed. Memory linking now working (49 links confirmed across 15 notes in first successful run).

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

## Session notes — 2026-04-08

**Gemma 4 tool calling, memory link pipeline, multimodal toggle.**

### Files written/changed this session

- `static/js/chat.js` — `modelFamily` variable + `_detectModelFamily()` (detects `"gemma4"` vs `"generic"` from model filename). `buildSystemPrompt()` split into Gemma 4 branch (semantics only, no XML syntax examples — jinja template handles that) and generic branch (full XML examples unchanged).

- `static/js/api.js` — `_injectToolResults(msgs, cleanedText, results, rawText)` helper centralises all tool result injection. Paths B/C/D refactored to use it. Gemma 4 gets native `<|tool_response>` tokens with raw call block preserved in assistant turn (critical — template needs to see its own call to match the response). Generic models get `[Tool results]` user turn. `rawText` is passed as 4th arg so Gemma 4's assistant turn contains the call block, not the cleaned prose.

- `scripts/memory_store.py` — Four fixes to the link pipeline:
  1. `EMBEDDING_LINK_THRESHOLD` 0.82 → 0.70 (all-MiniLM-L6-v2 scores related-but-distinct memories at 0.68–0.78; 0.82 was unreachable)
  2. `consolidate_llm_pass` no longer wipes embedding links when LLM returns empty — preserves them for re-evaluation next consolidation
  3. `consolidate_llm_pass` rewritten to evaluate candidates **per-pair** with yes/no questions (one LLM call per pair) instead of one JSON-array prompt for all candidates — robust to any model output style, thinking blocks, prose wrappers
  4. `_build_link_eval_prompt` and `_parse_link_eval_response` completely replaced — prompt is now a plain yes/no question; parser looks for `\byes\b` / `\bno\b` with word boundaries, strips `<think>` blocks, defaults to keeping the link on unclear responses

- `scripts/memory_server.py` — `_LlamaClient.complete()`: switched to system+user message pair (single user message caused Gemma 4 to return empty content); added `reasoning_content` fallback; kept thinking suppression flag for Qwen3. Added `/api/memory/reindex` endpoint — re-queues all non-superseded notes into `pending_llm_consolidation` and runs a full synchronous consolidation pass. Use to retroactively process notes written before the link pipeline was fixed: `curl -X POST http://localhost:8000/api/memory/reindex`

- `static/chat.html` — multimodal toggle row added to Settings → Server tab (replaces bare mmproj file row). Toggle shows/hides the mmproj file row section.

- `static/js/settings-server.js` — `spToggleMultimodal()` added; `spPopulateServer()` derives toggle state from `mmproj_path` presence in config; `spClearMmproj()` also turns toggle off; `_spApplyBrowsedPath()` auto-enables toggle when mmproj is selected.

### Known outstanding (carry to next session)

- `design/FEATURES.md` — add: detect port-already-in-use at startup and print a clear error.
- Settings: markdown render reverting — needs investigation.
- Settings: server arg defaults outdated (`--flash-attn` syntax, `--reasoning-format` relevance).
- Settings Kokoro: wrong file browser title — one-liner fix.
- Companion portability / export feature — tracked above in Companion portability section.

### Next session priorities

1. Test multimodal toggle end-to-end (set via Settings, verify `--mmproj` arg passed to llama-server)
2. Settings: markdown render reverting — investigate
3. Settings: server arg defaults pass against current llama.cpp
4. Settings Kokoro: wrong file browser title (quick win)

---

## Session notes — 2026-04-06 #8

**Bug fixes: history loading, embedding timeout, role alternation 500, misc.**

### Files written/changed this session

- `static/js/chat.js` — `buildSystemPrompt()` HOW TO USE block rewritten to XML format (session #7 carry-over, already done).
- `static/js/chat-tabs.js` — Three history bugs fixed:
  1. `_migrateLegacyLocalStorage()` deleted the old key but never flushed to disk — `await saveTabs()` added after successful migration.
  2. Active tab history never loaded from disk on page load — `loadTabs()` now explicitly loads the active tab's session from disk after restoring the tab index.
  3. `switchTab()` early-exit guard fired on ID match alone, bypassing disk load for shell tabs — guard now only exits if tab is active *and* has content loaded.
- `scripts/memory_server.py` — Added `_prewarm_embedding_model()`: fires a background thread at session init to force `all-MiniLM-L6-v2` to download/load before first tool use.
- `scripts/memory_store.py` — Added `prewarm_embeddings()` method: does a dummy `query_texts=["warmup"]` call to trigger model load.
- `tools/write_memory.py`, `tools/retrieve_memory.py`, `tools/update_relational_state.py` — HTTP timeout bumped from 10s → 60s as safety net for cold/slow environments.
- `static/js/api.js` — Fixed role-alternation 500 error on non-Qwen models (Llama, Mistral, etc.). Paths B, C, D were conditionally pushing an assistant turn only when visible text existed alongside a tool call. Pure tool calls (no text) produced `user → user` sequences that strict chat templates reject. All three paths now always push an assistant turn (using `"…"` placeholder if no real text) before the tool-result user turn. Guard added to avoid doubling up if assistant was already pushed.

### Known outstanding

- `design/FEATURES.md` — add: detect port-already-in-use at startup and print a clear error (currently fails silently, caused confusing wizard-shows-on-refresh issue during dev).

### Next session priorities

1. Audit default server args in `config.py` against current llama.cpp for any removed/renamed flags
2. Background embedding queue
3. Test history save/load end-to-end on a fresh clone

---

## Session notes — 2026-04-06 #7

**System prompt XML format examples — complete.**

### Files written/changed this session

- `static/js/chat.js` — `buildSystemPrompt()` HOW TO USE section rewritten from inline backtick-style examples to XML `<tool_call>` format. All four `memory` tool examples now shown in XML. Added XML call examples to EPISODIC MEMORY section for `write_memory`, `retrieve_memory`, and `update_relational_state` (none existed before). This completes the tool call fix started in session #6.

### Next session priorities

1. Test end-to-end: write_memory tool call should now execute instead of printing as text
2. Test history save/load flow
3. Background embedding queue

---

## Session notes — 2026-04-06 #6

**Tool call parser fix — Qwen XML format mismatch.**

### Root cause

Qwen3.5 9B consistently writes `<tool_call>...<\/tool_call>` for both opening and closing tags. The parser regex was `/<tool_use>([\s\S]*?)<\/tool_call>/g` — mismatched opening tag meant **every XML tool call silently fell through all parsing paths** and rendered as visible text instead of executing. This affected both Path C (tool call in response body) and Path D (tool call rescued from thinking block), since Path D uses the same parser.

A secondary bug: `keywords` array parameters were coming through as raw JSON strings (e.g. `'["Cortana", "Halo 1"]'`) instead of parsed arrays, because `parseXmlToolCalls` was doing a plain string assignment from `<parameter>` content without attempting JSON parse.

### Files written/changed this session

- `static/js/tool-parser.js` — `parseXmlToolCalls` regex now accepts `<(?:tool_call|tool_use)>` as opening tag. Also added JSON parse attempt for array/object-valued parameters (fixes `keywords` field in `write_memory`).
- `static/js/api.js` — Path C cleanup regex updated to match the same `<(?:tool_call|tool_use)>` pattern so the XML block is properly stripped from the displayed message.

### Next session priorities

1. Test end-to-end: write_memory tool call should now execute instead of printing as text
2. Test history save/load flow
3. Background embedding queue

---

## Session notes — 2026-04-06 #5

**CLAUDE.md refactor — split into design/ modules.**

### Files written/changed this session

- `CLAUDE.md` — stripped to operational core: working rules, file map, bugs, design folder index, session notes. All detailed system docs moved to `design/`.
- `design/ARCHITECTURE.md` *(new)*
- `design/BOOT.md` *(new)*
- `design/SYSTEMS.md` *(new)*
- `design/TTS.md` *(new)*
- `design/FEATURES.md` *(new)*

---

## Session notes — 2026-04-06 #4

**Disk-backed history, associative memory retrieval, memory pill UI.**

### Still to do / known gaps

- Background embedding queue — `consolidated: false` flag is in place, pipeline not yet built.
- Embed soul/mind markdown files into ChromaDB.
- Export/import update for new session folder format.

---

## Session notes — 2026-04-06 #3

**Memory system fully wired. TTS cache bug fixed.**

---

## Session notes — 2026-04-06 #2

**Memory system tool files and config — complete.**

---

## Session notes — 2026-04-06

**Memory system design finalised and implementation begun.**

---

## Session notes — 2026-04-04

**TTS confirmed working** — Kokoro live via Aurini. Senni is talking. Stdin bug in `tts.py` fixed.

**Major design session** — memory architecture + companion personality. Full design in `design/MEMORY.md` and `design/COMPANION_STACK.md`.
