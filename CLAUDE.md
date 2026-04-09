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
- ~~**Settings/Companion windows populate and shift on open**~~ — **Fixed**
- ~~**Settings windows don't reflect active tab/state on open**~~ — **Fixed**
- ~~**Default presence presets have non-hex colors and missing fields**~~ — **Fixed** in `config.py` DEFAULTS — but **existing companion `config.json` files on disk still have the old `rgba(...)` format**. Needs a one-time migration function or factory reset. Low priority until public release.
- ~~**Settings: Missing multimodal toggle**~~ — **Fixed**
- ~~**Settings: Markdown render reverting on boot/refresh/settings open**~~ — **Fixed** (this session). Root causes: (1) `markdown_enabled` defaulted to `False` in `config.py` DEFAULTS; (2) `load_config()` shallow-merged `generation` so new sub-keys didn't fill in for existing installs; (3) `spPopulateGeneration()` updated the toggle visually but never called `setMarkdownEnabled()`, leaving the renderer stale.
- ~~**Settings Kokoro: Wrong file browser title**~~ — **Fixed** (this session). `server.py` `/api/browse` now handles `type: "python"` with correct title; `settings-server.js` now passes `"python"` instead of hardcoded `"binary"` for the Python executable browse.
- ~~**Companion Settings TTS: Saving resets TTS config**~~ — **Fixed** (this session). `companion.js` `cpSave()` was always including a TTS payload even when the Voice tab was never opened, sending `af_heart: 1.0` default and overwriting saved config. Fix: payload only included when `_cpTtsSlots.length > 0`; `cpTtsPopulate()` now called eagerly from `cpPopulate()` so slots are always ready.
- ~~**Dropdown menus (e.g. Kokoro voice select) white background / unreadable**~~ — **Fixed** (this session). Added `option` background/color rules in `companion-panel.css` for `select.cp-input` and `.cp-tts-voice-select`.
- **Settings: Server arg defaults outdated** — `--flash-attn` syntax changed (needs `on`/`off`/`auto` value); `--reasoning-format` may be obsolete for jinja-template models. Needs a pass against current llama.cpp.

### Memory

- ~~**Link eval parse error — 0 links ever confirmed**~~ — **Fixed**

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

## Session notes — 2026-04-10

**Bug fixes: TTS settings reset, dropdown colors, Kokoro file browser title, markdown render reverting.**

### Root causes found and fixed

- **TTS reset** — `cpSave()` always called `_cpGetTtsPayload()` even when Voice tab was never opened, sending a default `af_heart: 1.0` blend and overwriting disk. Fixed by gating payload on `_cpTtsSlots.length > 0` and eagerly populating slots from config in `cpPopulate()`.
- **Dropdown colors** — native `<select>` / `<option>` elements ignored CSS `rgba()` background. Fixed with solid `#21232e` background on `select.cp-input` and `.cp-tts-voice-select` and their `option` children.
- **Kokoro file browser title** — `spBrowseTts()` hardcoded `browseType = 'binary'` for all non-voices types including Python. `server.py` had no `"python"` case in `/api/browse`. Both fixed.
- **Markdown reverting** — three root causes: (1) `markdown_enabled` defaulted to `False` in DEFAULTS; (2) `load_config()` shallow-merged `generation`, so new sub-keys didn't fill in for existing installs; (3) `spPopulateGeneration()` updated the toggle class but never called `setMarkdownEnabled()`, leaving `_markdownEnabled` stale in the renderer.

### Files written/changed this session

- `static/js/companion.js` — `cpPopulate()` now always calls `cpTtsPopulate(c.tts || {})` unconditionally (no `_cpTtsInitDone` guard). `cpSave()` TTS payload gated on `_cpTtsSlots.length > 0`; `cpSettings` cache update for `tts` now conditional on `body.tts` being present.
- `static/js/companion-tts.js` — `cpTtsPopulate()` no longer requires tab init; populates `_cpTtsSlots` immediately and only re-renders DOM if `_cpTtsInitDone`. `_cpTtsRenderAll()` renders from existing slots if populated, falls back to `cpSettings` only if empty.
- `static/css/companion-panel.css` — Added `select.cp-input`, `.cp-tts-voice-select`, and their `option` rules with solid dark background and correct text color.
- `scripts/server.py` — `/api/browse` endpoint: added `"python"` type case with title "Select Python executable".
- `static/js/settings-server.js` — `spBrowseTts()`: `browseType` now `'python'` when `type === 'python'`, not hardcoded `'binary'`.
- `scripts/config.py` — `markdown_enabled` default changed `False` → `True`. `load_config()` now deep-merges `generation` after shallow merge so DEFAULTS sub-keys fill in for existing installs.
- `static/js/settings-generation.js` — `spPopulateGeneration()` now calls `setMarkdownEnabled(mdEnabled)` alongside setting the toggle class.

### New bugs/features noted this session (not yet worked)

- **STT: microphone input** — browser MediaRecorder API to capture audio; send to multimodal model (Gemma 4 E2B/E4B supports up to 30s). Long clips need splitting strategy — research Gemma's multi-segment audio handling before implementing. Design so a Whisper/STT fallback layer could slot in later without restructuring.
- **Export/Import redesign** — needs its own popup UI with checkboxes: soul files, mind files, ChromaDB episodic memory dump, config. ChromaDB export = JSON dump of notes → re-embed on import. Needs design session before implementation.

### Next session priorities

1. Test all fixes from this session (TTS save, markdown on boot, dropdown colors, Kokoro title)
2. Settings: Server arg defaults audit against current llama.cpp (`--flash-attn`, `--reasoning-format`)
3. Streaming text visual regression — investigation
4. Background embedding queue

---

## Session notes — 2026-04-08

**Gemma 4 tool calling, memory link pipeline, multimodal toggle.**

### Files written/changed this session

- `static/js/chat.js` — `modelFamily` variable + `_detectModelFamily()` (detects `"gemma4"` vs `"generic"` from model filename). `buildSystemPrompt()` split into Gemma 4 branch (semantics only, no XML syntax examples — jinja template handles that) and generic branch (full XML examples unchanged).
- `static/js/api.js` — `_injectToolResults(msgs, cleanedText, results, rawText)` helper centralises all tool result injection. Paths B/C/D refactored to use it. Gemma 4 gets native `<|tool_response>` tokens with raw call block preserved in assistant turn. Generic models get `[Tool results]` user turn.
- `scripts/memory_store.py` — Four fixes to the link pipeline: threshold 0.82→0.70; LLM pass no longer wipes embedding links on empty return; per-pair yes/no evaluation replaces JSON-array prompt; `_parse_link_eval_response` strips `<think>` blocks and defaults to keeping link on unclear response.
- `scripts/memory_server.py` — `_LlamaClient.complete()` switched to system+user message pair; added `reasoning_content` fallback. Added `/api/memory/reindex` endpoint.
- `static/chat.html` — multimodal toggle row added to Settings → Server tab.
- `static/js/settings-server.js` — `spToggleMultimodal()` added; populate/clear/browse logic updated.

### Known outstanding

- `design/FEATURES.md` — add: detect port-already-in-use at startup and print a clear error.

---

## Session notes — 2026-04-06 #8

**Bug fixes: history loading, embedding timeout, role alternation 500, misc.**

### Files written/changed this session

- `static/js/chat-tabs.js` — Three history bugs fixed: migration flush, active tab load on page load, switchTab shell tab guard.
- `scripts/memory_server.py` — embedding model prewarm on session init.
- `scripts/memory_store.py` — `prewarm_embeddings()` method added.
- `tools/write_memory.py`, `tools/retrieve_memory.py`, `tools/update_relational_state.py` — HTTP timeout 10s → 60s.
- `static/js/api.js` — role-alternation 500 fix for non-Qwen models.

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

### Still to do / known gaps

- Background embedding queue — `consolidated: false` flag is in place, pipeline not yet built.
- Embed soul/mind markdown files into ChromaDB.

---

## Session notes — 2026-04-06

**Memory system design finalised and implementation begun. TTS confirmed working.**
