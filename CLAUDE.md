# CLAUDE.md — Instructions for Claude

This file is for Claude to read at the start of every session.
Search for it using project knowledge before doing anything else.

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

SENNI is a local AI companion framework. Currently running with Qwen3.5 9B Q4_K_M, Intel Arc GPU.

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
- Model: Qwen3.5 9B Q4_K_M
- llama-server: SYCL build on Windows, oneAPI build on Linux
- Temperature: 0.8 (critical — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled
- Flash attention: auto-enabled by llama-server

---

## Known model quirk

**Qwen3.5 9B tool calls in thinking blocks** — confirmed llama.cpp bug (issue #20837): Qwen3.5 9B often prints tool calls in XML inside thinking blocks when thinking is enabled. Not a SENNI bug. Memory write discipline should be robust to unreliable self-initiation — associative pathway is system-driven, masculine self-retrieval has auto-trigger fallback.

---

## Documentation convention

- **CLAUDE.md** — operational instructions + active bugs + design folder index. Update at end of every session.
- **design/*.md** — system docs and design decisions. Update when the relevant system is touched.
- Rule: when we touch a system in a session, we document it in that session. Don't defer.

---

## Session notes — 2026-04-06 #6

**Tool call parser fix — Qwen XML format mismatch.**

### Root cause

Qwen3.5 9B consistently writes `<tool_call>...<\/tool_call>` for both opening and closing tags. The parser regex was `/<tool_use>([\s\S]*?)<\/tool_call>/g` — mismatched opening tag meant **every XML tool call silently fell through all parsing paths** and rendered as visible text instead of executing. This affected both Path C (tool call in response body) and Path D (tool call rescued from thinking block), since Path D uses the same parser.

A secondary bug: `keywords` array parameters were coming through as raw JSON strings (e.g. `'["Cortana", "Halo 1"]'`) instead of parsed arrays, because `parseXmlToolCalls` was doing a plain string assignment from `<parameter>` content without attempting JSON parse.

### Files written/changed this session

- `static/js/tool-parser.js` — `parseXmlToolCalls` regex now accepts `<(?:tool_call|tool_use)>` as opening tag. Also added JSON parse attempt for array/object-valued parameters (fixes `keywords` field in `write_memory`).
- `static/js/api.js` — Path C cleanup regex updated to match the same `<(?:tool_call|tool_use)>` pattern so the XML block is properly stripped from the displayed message.

### Still needed — next session start

- **`static/js/chat.js`** — `buildSystemPrompt()` HOW TO USE section currently shows inline-style examples (`memory({"action":"read",...})`). Should show the XML format that Qwen actually produces naturally. This won't fix failures (parser fix handles that) but should reduce the rate of tool calls ending up in thinking blocks by giving the model a clear format example.

Change needed in the `HOW TO USE:` block (around line 699):
```
HOW TO USE — call tools using this XML format:
<tool_call>
<function=memory>
<parameter=action>read</parameter>
<parameter=folder>soul</parameter>
<parameter=filename>user_profile.md</parameter>
</function>
</tool_call>
```
Keep the existing examples but rewrite them in XML format. The EPISODIC MEMORY section examples (`write_memory`, etc.) should also be shown in XML format.

### Next session priorities

1. **`chat.js` system prompt XML format examples** — do this first, it's the remaining half of this fix
2. Test end-to-end: write_memory tool call should now execute instead of printing as text
3. Test history save/load flow
4. Background embedding queue

---

## Session notes — 2026-04-06 #5

**CLAUDE.md refactor — split into design/ modules.**

### Files written/changed this session

- `CLAUDE.md` — stripped to operational core: working rules, file map, bugs, design folder index, session notes. All detailed system docs moved to `design/`.
- `design/ARCHITECTURE.md` *(new)* — modularity plan, completed refactors, planned modules, load orders.
- `design/BOOT.md` *(new)* — boot & process lifecycle, TOCTOU, per-OS path resolution, tkinter file browsing.
- `design/SYSTEMS.md` *(new)* — current state summaries for Orb, Presence, Heartbeat, Companion window, Settings dirty tracking, Chat tabs, Vision mode, memory pill UI.
- `design/TTS.md` *(new)* — full TTS system doc.
- `design/FEATURES.md` *(new)* — all planned features and changes.

### Design folder is now

```
design/
  ARCHITECTURE.md    ← new
  BOOT.md            ← new
  SYSTEMS.md         ← new
  TTS.md             ← new
  FEATURES.md        ← new
  MEMORY.md          ← existing
  COMPANION_STACK.md ← existing
  ORB_DESIGN.md      ← existing
```

### Next session priorities

1. Test the full history save/load flow end-to-end
2. Test associative retrieval + memory pill appearing in UI
3. Background embedding queue (startup consolidation of unprocessed sessions)

---

## Session notes — 2026-04-06 #4

**Disk-backed history, associative memory retrieval, memory pill UI.**

### Files written/changed this session

- `static/js/tool-parser.js` — added `write_memory`, `retrieve_memory`, `update_relational_state` to `TOOL_DEFINITIONS`.
- `static/js/chat.js` — fixed `Illegal return statement` crash (single-quoted multiline string in `buildSystemPrompt` → template literal). Also wired `onMemorySurface` callback.
- `static/js/chat-tabs.js` — **full rewrite**. localStorage now holds lightweight tab index only. Full history saved to disk via `/api/history/*`. Legacy migration on first load. Image content stripped from API history before save (saved as separate files). Memory pill replay added to `_replayMessage`.
- `static/js/api.js` — added `onMemorySurface` callback + `_assocTurnsSinceLast` turn counter. Every 4 user turns, calls `/api/memory/associative` and injects result as hidden system turn + fires `onMemorySurface` for UI pill.
- `static/js/chat-ui.js` — added `appendMemoryPill(notesText)`. Teal pill with expand-on-click.
- `static/css/messages.css` — memory pill styles.
- `scripts/server.py` — added full history API: `/api/history/save`, `/api/history/load`, `/api/history/list`, `/api/history/delete`, `/api/history/media/...`.
- `scripts/memory_server.py` — added `/api/memory/associative` endpoint.

### Still to do / known gaps

- Background embedding queue — `consolidated: false` flag is in place, pipeline not yet built.
- Embed soul/mind markdown files into ChromaDB.
- Export/import update for new session folder format.

---

## Session notes — 2026-04-06 #3

**Memory system fully wired. TTS cache bug fixed.**

### Files written/changed this session

- `static/js/chat.js` — complete rewrite of memory section: `_memoryContext` state var, `reloadMemoryContext()`, `session_notes.md` removed from `seedTemplates()`, `buildSystemPrompt()` rewritten with two clearly labelled blocks.
- `static/js/companion-memory.js` *(new)* — Memory tab: episodic enable toggle, status row, k knobs, cognitive stack 4-slot editor, `_cpGetMemoryPayload()`.
- `static/js/companion.js` — wired memory tab functions; fixed TTS cache bug (missing `cpSettings.active_companion.tts = body.tts` after save).
- `static/chat.html` — Memory tab replaced with full new UI; `companion-memory.js` script tag added.
- `scripts/server.py` — `cognitive_stack` added to companion save allowed keys; new `/api/settings/memory` endpoint.
- `requirements.txt` — `chromadb>=0.5.0` and `sentence-transformers>=3.0.0` added.

### TTS bug root cause

`cpSave()` updates a local `cpSettings` cache after saving. `tts` was missing from that cache update, causing voice settings to appear to revert on window reopen without page reload. One line fix.

---

## Session notes — 2026-04-06 #2

**Memory system tool files and config — complete.**

### Files written/changed

- `tools/write_memory.py` — complete.
- `tools/retrieve_memory.py` — complete.
- `tools/update_relational_state.py` — complete.
- `scripts/config.py` — `memory` block added to global DEFAULTS; `cognitive_stack` + `last_consolidated_at` added to companion config.

---

## Session notes — 2026-04-06

**Memory system design finalised and implementation begun.**

Full design in `design/MEMORY.md` and `design/COMPANION_STACK.md`.

### Files written this session

- `scripts/memory_store.py` — complete (992 lines). `MemoryStore` class: write_note, retrieve_session_start, retrieve_direct, retrieve_associative, primitive ratio computation, Tier 1 blocks, supersede, consolidation.
- `scripts/memory_server.py` — complete (413 lines). FastAPI router, store lifecycle, idle consolidation timer, session-start context assembly, all endpoints.
- `scripts/server.py` — memory router mounted, atexit + shutdown hooks added.

---

## Session notes — 2026-04-04

**TTS confirmed working** — Kokoro live via Aurini. Senni is talking. Stdin bug in `tts.py` fixed.

**Major design session** — memory architecture + companion personality. Full design in `design/MEMORY.md` and `design/COMPANION_STACK.md`.
