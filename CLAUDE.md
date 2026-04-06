# CLAUDE.md — Instructions for Claude

This file is for Claude to read at the start of every session.
Search for it using project knowledge before doing anything else.

---

## Critical working rules

- **Always provide complete files** — never code sections, never snippets, never “find X and replace with Y”. The user has ADHD and finds partial edits extremely difficult. Full file replacements only.
- **One file at a time** where possible. Flag upfront if a feature will require touching multiple files and get agreement before proceeding.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won’t work. Automate it or build it into existing flows instead.
- **Suggest Extended Thinking** and/or Opus when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **End every session by updating CLAUDE.md and any relevant design docs.** This is non-negotiable — it’s what makes the next session productive.
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
| `static/js/chat-tabs.js` | Tab management, message serialization/replay |
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

---

## Modularity plan

The codebase uses small focused modules. New features should be built as separate files where possible.

**Refactors completed this project:**
- `static/js/orb.js` — extracted from chat-ui.js ✓
- `static/js/tool-parser.js` — extracted from api.js ✓
- `static/js/message-renderer.js` — extracted from chat-ui.js ✓
- `static/js/companion-presence.js` — extracted from companion.js ✓
- `static/css/chat.css` → split into base/messages/orb/companion-panel.css ✓
- `static/js/settings.js` → split into coordinator + server/generation/companion tab files ✓

**Planned future modules:**
- `static/js/companion-mood.js` — Mood UI tab (new file when Mood UI is built)
- `static/js/system-prompt.js` — extract `buildSystemPrompt()` from chat.js (low priority)

**Completed this session:**
- `static/js/companion-memory.js` — Memory tab UI ✓

When creating a new module, it should:
- Do one thing only
- Export a clean simple API
- Not require other files to know its internals
- Load order in `chat.html` must be updated when adding new files

**Current `chat.html` script load order:**
```
tool-parser.js       ← no deps
api.js               ← needs tool-parser.js
attachments.js
orb.js
message-renderer.js  ← no deps
chat-ui.js           ← needs message-renderer.js, orb.js, appendMemoryPill() now required by chat-tabs.js (_replayMessage) and api.js (onMemorySurface) — load order already correct
chat-tabs.js         ← needs message-renderer.js, chat-ui.js, chat-controls.js
chat-controls.js
chat.js
heartbeat.js
tts.js               ← needs api.js (onTtsToken), no DOM deps at load time
companion.js         ← coordinator, loads before presence and tts
companion-presence.js ← needs companion.js (cpSettings, cpMarkDirty), orb.js
companion-tts.js     ← needs companion.js (cpSettings, cpMarkDirty), tts.js
companion-memory.js  ← needs companion.js (cpSettings, cpMarkDirty, cpShowToast)
settings.js          ← coordinator, loads before tab files
settings-server.js   ← needs settings.js
settings-generation.js ← needs settings.js
settings-companion.js  ← needs settings.js
settings_os_paths.js   ← needs settings.js, settings-server.js
```

**Current `chat.html` stylesheet load order:**
```
base.css             ← defines all CSS variables — must be first
messages.css         ← depends on base.css variables
orb.css              ← depends on base.css variables
companion-panel.css  ← depends on base.css variables, orb.css keyframes
settings.css         ← pre-existing, independent
```

---

## Boot & process lifecycle

This is the most complex part of the server — read carefully before touching it.

### State variables (in `server.py`)

| Variable | Meaning |
|----------|---------|
| `_llama_process` | The `Popen` handle for the cmd.exe / llama-server process, or `None` |
| `_boot_ready` | `True` once llama-server logs "server is listening" |
| `_boot_launching` | `True` from launch start until either ready or failure — prevents duplicate spawns |
| `_boot_lock` | Threading lock — all boot state mutations happen inside it |

### The TOCTOU problem (why `_boot_launching` exists)

`_llama_process` is set by the watcher thread *after* it starts — not inside the lock. Without `_boot_launching`, a second `/api/boot` call arriving before the thread runs would see `_llama_process is None` and spawn a second process. `_boot_launching` is set inside the lock before it releases, so any concurrent call sees it immediately.

### Boot sequence
1. `chat.js` `DOMContentLoaded` → `loadStatus()` → checks `model_running` AND `model_launching`
2. If `model_launching`: attach to existing SSE log stream, don’t call `/api/boot`
3. If neither: call `/api/boot` → server sets `_boot_launching = True` inside lock → starts watcher thread
4. Watcher thread sets `_llama_process`, reads stdout, sets `_boot_ready = True` when ready, sets `_boot_launching = False`
5. SSE stream fires `{ready: true}` → chat.js calls `startSession()`

### Process tree kill (Windows)

On Windows Intel, `shell=True` means `_llama_process` is cmd.exe, not llama-server.exe. `proc.terminate()` does NOT cascade to children on Windows. We use `taskkill /F /T /PID` to kill the whole tree. This is handled by `_kill_process_tree()` in server.py.

On Linux Intel, we use `exec` in the shell command so the shell replaces itself with llama-server — `_llama_process` IS the target process, and terminate() works correctly.

### Shutdown paths

| Trigger | Path |
|---------|------|
| Ctrl+C on SENNI terminal | uvicorn catches SIGINT → `on_shutdown()` → `_kill_llama_server()` |
| Ctrl+C on llama-server terminal | llama-server exits → watcher thread readline loop ends → `_boot_launching = False` |
| In-app restart button | `POST /api/boot {force:true}` → `_kill_llama_server()` → relaunch |
| Factory reset | `POST /api/factory-reset` → `_kill_llama_server()` → delete files |
| Python crash/exit | `atexit.register(_kill_llama_server)` fires |

`_kill_llama_server()` is the single kill entry-point — always resets `_llama_process`, `_boot_launching`, `_boot_ready`.

---

## Per-OS path resolution

`config.json` stores both flat values (active OS) and per-OS dicts:

```json
{
  "model_path":  "...",          ← active OS flat value
  "model_paths": {               ← all OSes
    "Linux":   "/path/on/linux",
    "Windows": "C:\\path\\on\\windows"
  },
  "server_binary":   "...",      ← active OS flat value (empty = auto-discover)
  "server_binaries": {           ← per-OS binary paths
    "Windows": "C:\\path\\to\\llama-server.exe"
  }
}
```

`resolve_platform_paths()` reads the current OS’s entry into the flat value on load.
`update_platform_paths()` writes the flat value back into the dict on save.
Empty `server_binary` means auto-discover — never write an empty string to `server_binaries`.

### llama-server binary resolution priority
1. `config["server_binary"]` — explicit path from Settings → Server
2. Candidate paths relative to the model file
3. `shutil.which()` PATH lookup
4. Bare exe name (will fail with a clear error message in the boot log)

---

## Settings UI — file browsing

The Settings panel (and wizard) both use `/api/browse` to open a native OS file picker via tkinter. **Do not use hidden `<input type="file">` elements as the primary browse mechanism** — they can’t return full paths in the browser security model.

`/api/browse` accepts `type`: `"model"` | `"mmproj"` | `"binary"`.

tkinter runs in `_executor` (thread pool) — never on the event loop thread, which would deadlock on Windows.

Fallback: if `/api/browse` fails (headless server, tkinter unavailable), a manual text input appears inline.

---

## Orb system — current state

See `ORB_DESIGN.md` for full layout, state, and CSS variable documentation.

**Quick reference:**
- Orb owned entirely by `static/js/orb.js`
- Fixed position in `#orb-home` (absolute overlay, bottom-left of `.messages-wrap`)
- States: `idle` / `thinking` / `streaming` / `heartbeat` / `chaos`
- Presence presets: nested per-state dict, applied on every `setState()` call
- Layout modes: `inline` (bubbles indented) / `strip` (orb only)

### Color architecture (as of this session)
Five independent color/alpha properties per state — all set by `orb.js`, consumed as CSS vars:
- `dotColor` — dots + icon tint (hex)
- `edgeColor` — orb border (hex)
- `glowColor` + `glowAlpha` — glow box-shadow (hex + 0–1 float, default 0.4)
- `ringColor` + `ringAlpha` — ring pulse, **fully independent from glow** (hex + 0–1 float, default 0.3)

Legacy migration chain in `_migrateLegacyState()`:
- Old `effectsColor`/`effectsAlpha` (intermediate format) → split into `glowColor`/`ringColor`
- Old single-color presets → all fields derived from `dotColor`

### Animation registry (`orb.ANIMATIONS`)
Lives in `orb.js`. Each entry: `{ id, label, target, states }`. Adding a new animation = one registry entry; UI generates automatically. Current animations: `glowEnabled`, `breathEnabled`, `ringEnabled`, `dotsEnabled`. Toggled via `data-no-*` attributes on `#companion-orb`, targeted by CSS attribute selectors in `orb.css`.

### Mood application
Mood overrides are **additive** on top of the active Presence preset. Each overrideable property has an explicit `_enabled` flag: `{ _enabled: { glowColor: true, ringColor: true }, glowColor: '#ff0000', ringColor: '#00ffff' }`. `glowColor` and `ringColor` are independently overrideable.

---

## Presence system — current state

- Presence presets save and load correctly ✓
- Active preset fully applies to live orb — all states ✓
- Preset values re-applied on every state transition ✓
- Avatar shown in orb ✓
- Layout toggle in Presence tab ✓
- Five-color architecture: dotColor / edgeColor / glowColor+glowAlpha / ringColor+ringAlpha ✓
- Ring color/alpha fully independent from glow ✓
- Animation toggles implemented and driven from registry ✓
- Presence tab redesigned — element-grouped accordion ✓
- Mood system: backend done (`moods`, `active_mood` in config), UI not yet built

### Presence tab UI architecture
Built around `CP_ELEMENTS` in `companion-presence.js` — a data-driven config array. Adding a new element = one entry in `CP_ELEMENTS`, no other changes needed.

**Element groups (top to bottom — foundational first):** Orb → Dots → Glow → Ring

**Layout:** Preview box (rounded top, no bottom border) → flush Preset/State block → Appearance accordion

**Two-level disclosure:**
- `cpPresenceToggleElement(elemId)` — opens/closes the category row
- `cpPresenceToggleColorPicker(elemId)` — opens/closes the swatch grid within
- Clicking the header color pip opens both at once

**Chips:** Presets use `.cp-presence-chip`, states use `.cp-state-chip` (same visual style). `+ New` uses `.cp-presence-chip-new` (dashed border). All unified — no separate stab/tab styles.

**Element bodies** are built lazily on first open via `_cpBuildElementBodies()`.

### Module split
- `companion.js` — coordinator: open/close, load, populate, tab switching, avatar, soul files, heartbeat, generation, save, toast, **dirty tracking**
- `companion-presence.js` — all Presence tab logic: presets, state editor, preview orb, layout toggle, `_cpGetPresencePayload()`
- `companion-mood.js` — future: Mood tab UI (not yet built)

`CP_STATE_DEFAULTS` and `CP_ELEMENTS` live in `companion-presence.js` and will be referenced by `companion-mood.js`.

---

## Heartbeat system — current state

- Heartbeat fires correctly on all triggers ✓
- Orb enters `heartbeat` state during a heartbeat turn (uses heartbeat preset, not idle) ✓
- Duplicate bubble bug fixed — `streamWasRendered()` checked before appending ✓
- Heartbeat settings now apply live after save (no refresh needed) ✓
- Heartbeat messages persist across refresh — serialized with `heartbeat: true` flag in tab state ✓
- `_annotateLastBubbleAsHeartbeat()` stamps ✶ meta onto stream-rendered bubble ✓
- **Stop button during heartbeat** — `_hbAbortCtrl` created in `heartbeatFire()`, passed to `callModel()`. `stopGeneration()` in `chat-controls.js` also aborts `_hbAbortCtrl`. Stop button shown/hidden around heartbeat generation ✓
- **Heartbeat event pill** — purple `.heartbeat-pill` inserted at start of each heartbeat turn, removed on skip/abort/no-response ✓

---

## Companion settings window — current state

- Avatar browse and drop working ✓
- Old Settings panel Companion tab stripped — shows companion list + “Open companion settings” button only ✓
- **Dirty tracking** — `cpMarkDirty()` / `cpClearDirty()` / `_cpUpdateFooterButtons()` implemented in `companion.js`. Footer Apply/Save buttons turn yellow on unsaved changes, same pattern as Settings panel. Wired to: name input, all soul-edit radios, force-read toggle, all 12 generation inputs, all 6 heartbeat toggles, heartbeat number inputs, all 6 instruction textareas. Presence changes (`cpPresenceSetValue`, new/delete preset, layout toggle) also call `cpMarkDirty()` via `typeof` guard. Window always opens clean (`cpClearDirty()` called in `cpLoad()`). ✓

---

## Settings panel — dirty tracking

- Server tab: sliders, custom args, GPU select, port inputs ✓
- Generation tab: sliders, max-tokens, max-tool-rounds, vision mode radios, markdown toggle ✓
- Companion tab: shows companion list only — no editable fields here (all companion fields are in the Companion Window)

---

## Chat tabs — current state

- Tab state serialized to localStorage per companion: `chat_tabs_<folder>` ✓
- Format: `{ tabs: [...], activeTabId: "..." }` — both the tab list and the active tab are persisted ✓
- Old plain-array format still supported on load (backward compat) ✓
- Each tab object: `{ id, title, history, messages, created, tokens, visionMode }` ✓
- `visionMode` per tab: `null` (use global setting), `'once'`, or `'always'` — set when user picks from the per-message vision dialog ✓
- Closing the active tab during generation calls `stopGeneration()` to abort the in-flight request ✓

---

## Vision mode — how it works

Three settings, two layers:

**Global setting** (`config.generation.vision_mode`): `'always'` | `'once'` | `'ask'`
- `'always'` — re-encode image on every turn
- `'once'` — encode once, substitute text on follow-ups
- `'ask'` — show a per-message dialog when an image is attached

**Per-tab override** (`tab.visionMode`): `null` | `'once'` | `'always'`
- Set when user picks from the `'ask'` dialog
- Persists for the tab’s lifetime (saved in localStorage)
- Overrides the global setting for that tab

**In `api.js`:** reads `_activeTab?.visionMode || config.generation?.vision_mode || 'always'`. The string `'ask'` is treated as `'always'` — it’s a UI-only value that should never reach the image filter.

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

---

## Bugs

Bugs are grouped by area. Where a fix should be bundled with a feature, that is noted.

### Orb / Presence

- ~~**Orb edge color not applying from presence preset**~~ — **Fixed**
- ~~**Heartbeat state uses idle values**~~ — **Fixed**

### Chat

- **Streaming text visual (token-by-token appearance) regressed** — secondary priority. Needs investigation.
- **Message loss on restart/refresh suspected** — non-heartbeat messages may also be getting lost on refresh, possibly related to DOM/history drift or tab switching edge cases. Needs a focused investigation session reading `chat.js` `sendMessage()`, `_saveCurrentTabState()`, and `startSession()` together.
- ~~**Streaming cursor stuck at bottom of message bubble**~~ — **Fixed** (replaced `::after` pseudo-element with inline `.stream-cursor` span injected by `_updateStreamBubble`)
- ~~**Closing a tab during generation bleeds response into new active tab**~~ — **Fixed** (`_doCloseTab` calls `stopGeneration()` when closing the active tab)
- ~~**Active tab not remembered on restart/refresh**~~ — **Fixed** (`saveTabs` now persists `{ tabs, activeTabId }`, `loadTabs` restores it with old-format compat)
- ~~**Scroll fighting during streaming**~~ — **Fixed** (`_userScrolled` flag + `scrollIfFollowing()` in `chat-ui.js`; `_updateStreamBubble` uses `scrollIfFollowing()` instead of `scrollToBottom()`)

### Heartbeat

- ~~**Duplicate heartbeat bubble**~~ — **Fixed**
- ~~**Heartbeat settings not applying until refresh**~~ — **Fixed**
- ~~**Heartbeat chat log deleted on refresh**~~ — **Fixed**
- ~~**No way to stop heartbeat processing**~~ — **Fixed** (`_hbAbortCtrl` + stop button lifecycle in `heartbeat.js`, `stopGeneration()` extended in `chat-controls.js`)
- ~~**Heartbeat events give no user feedback**~~ — **Fixed** (purple `.heartbeat-pill` inserted at turn start)

### Settings

- ~~**Settings TypeError on open**~~ — **Fixed**
- ~~**Markdown render toggle breaks on restart/companion switch**~~ — **Fixed**
- ~~**“Ask each time” image processing not working**~~ — **Fixed**
- ~~**Dirty tracking missing for several fields**~~ — **Fixed**
- ~~**Companion Settings exiting with dirty edits without confirmation**~~ — **Fixed**
- ~~**Settings/Companion windows populate and shift on open**~~ — **Fixed** (spinner + fade-in on both panels)
- ~~**Settings windows don’t reflect active tab/state on open**~~ — **Fixed** (`_cpSyncStateChips` on presence init; content hidden until load resolves)
- ~~**Default presence presets have non-hex colors and missing fields**~~ — **Fixed** in `config.py` DEFAULTS — but **existing companion `config.json` files on disk still have the old `rgba(...)` format**. Needs a one-time migration function in `config.py` or a factory reset. Low priority until public release.

### UI / Layout

- **Tool and thinking pills have alignment/padding issues** — pills are misaligned relative to each other and the orb. **Bundle this fix with the pill visual rework** — don’t fix in isolation.

---

---

## TTS system — current state

Kokoro TTS integrated as an optional subprocess. SENNI runs cleanly without it.

### Architecture
- `scripts/tts.py` — standalone subprocess. Reads JSON lines from stdin (text + voice blend + speed + pitch), writes length-prefixed WAV bytes to stdout. Exits with code 2 if `kokoro` or `soundfile` not installed — `tts_server.py` surfaces this as a clean "unavailable" state, never a crash.
- `scripts/tts_server.py` — FastAPI router mounted into `server.py` via `app.include_router(tts_router)`. Owns process lifecycle. All endpoints return `{"ok": false, "reason": "..."}` on unavailability — never 500s.
- `static/js/tts.js` — hooks `onTtsToken` in `api.js`. Accumulates tokens into sentence buffer, flushes on `.!?…` boundaries (min 15 chars). Sequential fetch queue to `/api/tts/speak` preserves sentence order. Web Audio API queue for gapless playback. `ttsStop()` aborts everything on user stop/tab close/new message.
- `static/js/companion-tts.js` — Voice tab UI. Up to 5 voice blend slots with weight sliders (shows live normalised percentages). Speed + pitch inputs. Preview button.

### Config schema
Global TTS config lives in `config.json["tts"]`: `enabled`, `python_path`, `voices_path`, `espeak_path`.
Per-companion TTS lives in `companions/<folder>/config.json["tts"]`: `voice_blend` (dict of voice → weight), `speed`, `pitch`.
Mood TTS overrides are **schema-ready** but UI not yet built — will follow mood system UI.

### Aurini integration boundary
Aurini owns installation of Kokoro (pip install + espeak-ng). SENNI just needs:
- `python_path` — path to Python executable with kokoro installed (empty = sys.executable)
- `voices_path` — path to `voices/` dir with `.pt` files (empty = auto-discover next to tts.py)
- `espeak_path` — path to espeak-ng binary (empty = rely on PATH)

All three are set in Settings → Server → Voice section and saved via `/api/settings/tts`.

### What’s not yet done
- Mood → TTS override UI (speed/blend per mood) — implement alongside Mood UI
- ~~Real-world testing on actual Kokoro install~~ — **Done**. Kokoro confirmed working via Aurini. Tiny stdin bug in `tts.py` fixed.
- Voice discovery UI feedback when no voices found (currently silent)

## Features & planned changes

Grouped by area. Items marked **(design needed)** have open questions that should be resolved before implementation begins.

### Orb / Presence / Mood

- ~~**Color architecture split — Presence and Mood**~~ — **Done**
- ~~**Presence tab UI redesign**~~ — **Done**

- **Mood system UI** *(new `companion-mood.js`, new tab in `chat.html`)*
  - Backend already done (`moods`, `active_mood` in config). UI not yet built.
  - Visual: orb glow/color changes per mood (e.g. Playful = green, faster pulsing ring).
  - Optional mood pill next to orb showing current mood name — toggleable, hidden by default. Pill background = effects color, pill edge = orb edge color.
  - Users can define short descriptions per mood (injected into system prompt).
  - Animation toggles already built and reusable for Mood.
  - “Reset to default” option for both Mood and Presence.
  - `set_mood` tool for Qwenny — implement alongside Mood UI.

- **Strip mode status bar** — strip layout mode is a placeholder. Needs a status bar showing thinking text and other state info.

- **Presence & Mood: “Reset to default” option** — add reset buttons to both Presence and Mood settings.

### Chat

- **Pill visual rework** *(bundle alignment/padding bug fix with this)*
  - Thinking pills: stream content in real time (like llama.cpp’s own WebUI does) — makes long thinking waits much more bearable.
  - Visual update to make pills thematically consistent with chat bubbles.

- **File upload visualization in chat**
  - Sent files should be visible in the chat message (no filename text, just the visual).
  - Images: thumbnail inline, click to view full size.
  - Audio: mini inline player.
  - Text/other: format-relevant icon, click to view.

- **Animated avatars** *(wishlist — no design yet)*
  - Sprites, Live2D, or other — needs exploration. Document as future consideration only.

### Settings & Tools

- **Tool settings — global and per companion**
  - Global Settings: toggle to completely disable/enable all tools (overrides companion settings); default settings per tool.
  - Companion Settings: per-tool enable/disable toggles; per-tool per-companion settings (e.g. `get_time` format).

- ~~**Server restart loading overlay**~~ — **Done** (full-screen blocking overlay, reuses boot spinner, fades in/out, closes settings panel if open)
  - When clicking restart server, show a blocking overlay (similar to companion switch) to prevent interaction and clearly communicate what’s happening. Reuse the existing boot log display if possible.

- ~~**TTS — Kokoro integration**~~ — **Done (v1)**. See TTS system section above. Mood integration and real-world testing pending.

- Toggle to completely enable/disable (does not load at all when disabled).
- CPU or GPU option — **note: Intel Arc / oneAPI support for Kokoro is unconfirmed, needs research before committing to GPU path.**
- Setting for inference device (CPU, GPU)
- Streaming audio output.
- Settings per companion.
- Voice mixing: blend multiple Kokoro voice presets with per-preset sliders (e.g. 0.1 Bella + 0.4 Heart + ...).
- Pitch and speed controls.
- Mood integration: map moods to voice presets (null/neutral mood = companion default; each mood can override).
- Future: Qwen3-TTS option for better tone/emphasis control — current hardware likely limits to Kokoro only for now.

# Multilayered persistent memory
- Design complete — see `design/MEMORY.md` and `design/COMPANION_STACK.md`
- **Implementation complete** — all backend and frontend wired
- Stack: ChromaDB + all-MiniLM-L6-v2 (fully local, offline after first install)
- Layered on top of existing file system — soul/ and mind/ stay, memory/ deprecated

### What's in place
- `scripts/memory_store.py` — ChromaDB store, primitive ratios, retrieval, consolidation ✓
- `scripts/memory_server.py` — FastAPI router, session context assembly, idle consolidation timer ✓
- `tools/write_memory.py`, `tools/retrieve_memory.py`, `tools/update_relational_state.py` ✓
- `tools/memory.py` — still active for soul/mind file read/write (kept alongside new tools) ✓
- `scripts/server.py` — router mounted, shutdown hooks, `notify_message_activity()` wired, `cognitive_stack` in companion save, `/api/settings/memory` endpoint ✓
- `scripts/config.py` — `memory` block in global DEFAULTS, `cognitive_stack` + `last_consolidated_at` in companion config ✓
- `static/js/chat.js` — `reloadMemoryContext()` at session start, system prompt rewritten with clear file-vs-episodic tool distinction, `session_notes.md` removed from seed templates ✓
- `static/js/companion-memory.js` — Memory tab UI: enable toggle, status/note count, retrieval knobs, cognitive stack editor ✓
- `static/js/companion.js` — memory tab wired, TTS cache bug fixed ✓
- `requirements.txt` — `chromadb>=0.5.0` and `sentence-transformers>=3.0.0` added ✓

### Tool distinction (important for system prompt clarity)
- `memory` tool → soul/ and mind/ **markdown file** read/write (identity, user profile, scratchpad)
- `write_memory` / `retrieve_memory` / `update_relational_state` → **ChromaDB** episodic store only

### To enable memory
Set `"memory": {"enabled": true}` in `config.json` (or use the toggle in Companion Settings → Memory tab) then restart the bridge. ChromaDB will initialise on first `/api/memory/init` call. First run downloads all-MiniLM-L6-v2 (~90MB).

### Known gap
- `tools/memory.py` still has `archive` and `move` actions — these are not instructed in the system prompt but remain available in chaos mode. Low priority to remove.

### Companion Creation Wizard *(design needed — large feature)*

See `Features & Changes.md` for the full wizard flow sketch. Summary of key design points:

- Sliders for personality traits (Creativity↔Logic, Formal↔Casual, Verbose↔Concise) — open question: map to model params (temperature, top_p) in addition to or instead of prompt templates?
- Visual grids for appearance/type selections; every option has a “Custom” free-text fallback.
- Adult Content toggle early in the flow (step 1) — gates what is shown in subsequent steps.
- Age slider: 18–90, custom field for non-human characters (validated 18–1M).
- Closeness scale at creation — may later become a gamified relationship progression system.
- Step 8 (Memory & Agency): show a visual graph of memory↔mind↔soul flow; graph updates live as agentic mode is changed.
- Heartbeat activity level presets map to existing heartbeat settings.
- *Depends on Mood system being built first (mood/presence visuals are part of companion identity).*

---

## Design sessions needed

These items are too open-ended to task out. They need a dedicated design conversation before any implementation.

- **Main Chat UI redesign** — overall feel should be “smoother, fuller, cozier”. Known starting points: sidebar is too large (split into sections or cards?), buttons to pill shape, tools list moved out of sidebar into Settings, companion state/mood pills near the orb area. Color scheme is already good. Needs visual exploration before touching code.
- **Companion Creation Wizard — appearance sections** — Hair style grid, face shape, eyes, nose, outfit system, accessories, fetishes/kinks, natural triggers, and several other sections are marked “design needs expanding on” in the spec. These need fleshing out before wizard implementation begins.
- **Closeness/relationship progression** — may become a gamified system (develop closeness over time). Needs design before the wizard’s closeness step is finalized.

---

## Design folder

Large design decisions live in `design/` as standalone docs. These are NOT loaded into context automatically — search project knowledge when you need them. Do not reproduce their full content in CLAUDE.md.

| File                        | Contents                                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design/MEMORY.md`          | Full memory architecture — primitives (Fact/Concept/Vibe/Logic), composite types (Conclusion/Relation/Reason/Impression), primitive_ratios model, session-start retrieval, mid-conversation retrieval, consolidation schedule, note schema, ChromaDB stack, mood integration, write discipline. Updated 2026-04-06. |
| `design/COMPANION_STACK.md` | Cognitive function stack format (`mT-fS-mN-fF`), O+J axis pairing model, charge as directionality (solid/airy), stack position as probability, effect on memory encoding and retrieval, UI exposure tiers, storage schema. Updated 2026-04-06. |
| `design/ORB_DESIGN.md`      | Companion Orb<br>Persistent presence indicator in the chat                                                                                                |

When starting a session that touches memory or personality systems, search project knowledge for the relevant design doc rather than asking the user to explain it.

---

## Session notes — 2026-04-06 #4

**Disk-backed history, associative memory retrieval, memory pill UI.**

### Files written/changed this session

- `static/js/tool-parser.js` — added `write_memory`, `retrieve_memory`, `update_relational_state` to `TOOL_DEFINITIONS`. These were missing — Senni could see the instructions but couldn't call the tools.
- `static/js/chat.js` — fixed `Illegal return statement` crash (single-quoted multiline string in `buildSystemPrompt` → template literal). Also wired `onMemorySurface` callback.
- `static/js/chat-tabs.js` — **full rewrite**. localStorage now holds a lightweight tab index only (IDs, titles, tokens). Full history saved to disk via `/api/history/*`. Legacy migration on first load. Image content stripped from API history before save (saved as separate files). Memory pill replay added to `_replayMessage`.
- `static/js/api.js` — added `onMemorySurface` callback + `_assocTurnsSinceLast` turn counter. Every `ASSOC_INTERVAL` (4) user turns, calls `/api/memory/associative` and injects result as hidden system turn + fires `onMemorySurface` for UI pill.
- `static/js/chat-ui.js` — added `appendMemoryPill(notesText)`. Teal pill with expand-on-click to show full surfaced notes.
- `static/css/messages.css` — memory pill styles (`.memory-pill`, `.memory-pill-icon`, `.memory-pill-detail`).
- `scripts/server.py` — added full history API: `/api/history/save`, `/api/history/load`, `/api/history/list`, `/api/history/delete`, `/api/history/media/...`. Images saved as files in session folders.
- `scripts/memory_server.py` — added `/api/memory/associative` endpoint, wiring the existing `trigger_associative_retrieval()` function that had no HTTP exposure.

### History folder structure

```
companions/<folder>/history/
  <tab-id>/
    meta.json
    <YYYY-MM-DD_HHMMSS>/
      session.json        ← messages + history, consolidated: false
      img_001.jpg         ← media files referenced by path
```

### Still to do / known gaps

- **Background embedding queue** — process unembedded session files into ChromaDB on startup. `consolidated: false` flag is in place, pipeline not yet built.
- **Embed soul/mind markdown files** — so episodic retrieval can search identity/profile content.
- **Export update** — exporting a session should zip the whole session folder (images + JSON). Currently images not included in exports.
- **Import update** — importing should handle the new session folder format.
- **`mid_convo_k` config wiring** — `ASSOC_INTERVAL` is hardcoded to 4 turns. Should read from `config.memory.mid_convo_k` for the k value (already done) but interval itself could be configurable.
- **CLAUDE.md splitting** — file is very large (~775 lines). Split design content into `design/` folder. Do as a dedicated session.

### Next session priorities

1. Test the full history save/load flow end-to-end
2. Test associative retrieval + memory pill appearing in UI
3. Background embedding queue (startup consolidation of unprocessed sessions)

## Session notes — 2026-04-06 #3

**Memory system fully wired. TTS cache bug fixed.**

### Files written/changed this session

- `static/js/chat.js` — complete rewrite of memory section: `_memoryContext` state var, `reloadMemoryContext()` (calls `/api/memory/init` at session start), `session_notes.md` removed from `seedTemplates()`, `buildSystemPrompt()` rewritten with two clearly labelled blocks (FILE MEMORY via `memory` tool, EPISODIC MEMORY via the three new tools). `forceRead` flag moved into the file memory block where it belongs.
- `static/js/companion-memory.js` *(new)* — Memory tab: episodic enable toggle, status row (active/note count/last consolidated/pending LLM pass), session-start-k and mid-convo-k knobs with their own Save button, cognitive stack 4-slot editor (charge + function dropdowns), live stack preview string, uninitialised warning, `_cpGetMemoryPayload()` for cognitive_stack in main companion save.
- `static/js/companion.js` — wired `cpMemoryPopulate`, `cpMemoryInit`, `cpMemoryReset`, `_cpGetMemoryPayload`; fixed TTS cache bug (missing `cpSettings.active_companion.tts = body.tts` after save — caused voice settings to appear to revert on window reopen without page reload).
- `static/chat.html` — Memory tab replaced with full new UI; `companion-memory.js` script tag added after `companion-tts.js`.
- `scripts/server.py` — `cognitive_stack` added to `/api/settings/companion` allowed keys; new `/api/settings/memory` endpoint (enabled, session_start_k, mid_convo_k → global config).
- `requirements.txt` — `chromadb>=0.5.0` and `sentence-transformers>=3.0.0` added with comments.

### TTS bug root cause
`cpSave()` updates a local `cpSettings` cache after saving so the window shows correct values on reopen. `tts` was missing from that cache update. After save, closing and reopening the companion window re-read the stale pre-save values from cache. Page reload fixed it because it re-fetched from server. One line fix.

### Next session priorities
1. Test end-to-end with ChromaDB installed — verify tool calls appear, memories write and retrieve correctly
2. Mood UI (`companion-mood.js`) — new tab in companion window, builds on existing mood backend
3. Pill visual rework (bundle with alignment/padding bug fix)

## Session notes — 2026-04-06 #2

**Memory system tool files and config — complete.**

### Files written/changed

- `tools/write_memory.py` — complete. Reads active mood automatically from companion config, posts to `/api/memory/write`, returns short confirmation with truncated note ID.
- `tools/retrieve_memory.py` — complete. Formats returned notes with composite label, affect descriptor, intensity, and recency. Includes truncated note ID so companion can supersede later.
- `tools/update_relational_state.py` — complete. Soft word-count warning if block exceeds ~200 tokens. Posts to `/api/memory/relational-state`.
- `scripts/config.py` — `memory` block added to global DEFAULTS (enabled, embedding_model, session_start_k, mid_convo_k). `cognitive_stack` + `last_consolidated_at` added to companion config base + merge logic in `load_companion_config`.

### Confirmed already done (from previous session)
- `notify_message_activity()` wired in `server.py` tools/call branch — was already there.

### Still needed — chat.js system prompt changes
Full plan for next session:
1. Add `let _memoryContext = '';` near `_soulFiles` declaration
2. Add `reloadMemoryContext()` — calls `/api/memory/init` with companion_folder + active mood, stores `session_context` result
3. Call `await reloadMemoryContext()` in `startSession()` alongside `reloadSoulFiles()`
4. Remove `session_notes.md` from `seedTemplates()` seeds array — deprecated
5. Rewrite `MEMORY RULES` block in `buildSystemPrompt()`: remove all session_notes instructions, add write discipline (2–5/session, type-specific guidance), add descriptions for write_memory / retrieve_memory / update_relational_state tools
6. Inject `_memoryContext` into prompt after soul files (only when non-empty)

The `/api/memory/init` endpoint already returns `session_context` — no new endpoint needed.

---

## Session notes — 2026-04-06

**Memory system design finalised and implementation begun.**

### Design corrections to MEMORY.md and COMPANION_STACK.md

Primitive naming corrected and clarified:
- Fact (S), Concept (N), Vibe (F), Logic (T) — replaces old Fact/Conceptual/Emotional/Logical naming
- Composites are always O+J pairs (Observing + Judging): Conclusion (N+T), Relation (N+F), Reason (S+T), Impression (S+F)
- Three-way/four-way composites not modelled — just two O+J pairs firing simultaneously, not architecturally special
- Memory stored as **primitive_ratios** (float dict summing to 1.0), not discrete type categories
- composite_label derived automatically from dominant O+J pair

Retrieval model corrected:
- **Function type (T/S/N/F)** determines *what content* is targeted (not charge)
- **Charge (m/f)** determines *how* retrieval executes — direct/deliberate vs. associative/surfacing
- These are orthogonal axes. fF retrieves emotional content associatively; mF retrieves emotional content deliberately.
- Session-start retrieval queries against Tier 1 relational state block; dominant function shapes what surfaces, dominant charge shapes retrieval form

Consolidation schedule finalised:
- Primary: clean session end (shutdown)
- Fallback: startup check via `last_consolidated_at` timestamp (crash recovery)
- Idle: 20-minute timer tied to heartbeat idle detection

### Architecture decisions

**Layering, not replacement** — new ChromaDB memory system layers on top of existing file system:
- `soul/` stays fully intact — human-editable identity layer, companion can edit in agentic modes
- `soul/companion_identity.md` synced to Tier 1 identity block at session start
- `soul/user_profile.md` stays as human-readable relational state face
- `mind/` stays but narrowed — scratchpad only, not session notes
- `memory/` deprecated — barely used, ChromaDB does this job properly
- `mind/session_notes.md` gone — replaced by automatic session-start retrieval
- `archive` and `move` actions left in `memory` tool code but no longer instructed

**Stack initialisation for existing companions:**
- No `cognitive_stack` → assign neutral default (`mT-fS-mN-fF`) + set `stack_initialised: false`
- Stack settings UI added to Companion Settings window
- `stack_initialised: false` flag prevents treating default as intentional assignment
- Companion Creation Wizard handles this properly for new companions (future)

**ChromaDB + all-MiniLM-L6-v2:**
- Apache 2.0 license — fully compatible with MIT, no issues
- all-MiniLM-L6-v2 is ~90MB, ~14k sentences/sec on CPU, negligible for our write volumes
- ChromaDB handles embedding internally — no subprocess needed (unlike TTS)
- Fully local and offline after first pip install + model download

**Consolidation LLM pass:**
- Embedding-only pass always runs (no model needed, always safe)
- LLM pass runs if llama-server is reachable — quality-filters embedding-candidate links
- If llama-server is down, notes queued in `pending_llm_consolidation` for next session
- No memories ever lost — quality just improves opportunistically

### Files written this session

- `scripts/memory_store.py` — complete, syntax verified (992 lines)
  - `MemoryStore` class: write_note, retrieve_session_start, retrieve_direct, retrieve_associative
  - Primitive ratio computation, composite label derivation, retrieval mode inference
  - Tier 1 core blocks (get/update identity block, relational state)
  - Supersede (Zep-style temporal chain)
  - Consolidation: embedding pass + LLM pass + pending queue
  - Lazy ChromaDB import — graceful degradation if not installed

- `scripts/memory_server.py` — complete, syntax verified (413 lines)
  - FastAPI router — mirrors tts_server.py architecture exactly
  - Store lifecycle: init_memory_store, kill_memory_server
  - Idle consolidation timer (20 min)
  - LLM client wrapper (_LlamaClient) for consolidation LLM pass
  - Session-start context assembly for system prompt injection
  - Endpoints: /api/memory/status, /write, /retrieve, /supersede, /relational-state, /note/{id}, /consolidate, /init

### server.py changes already applied

```python
# Lines 82-93 — Memory router mount
try:
    from scripts.memory_server import (
        router as memory_router,
        kill_memory_server,
        notify_message_activity,
    )
    app.include_router(memory_router)
except ImportError:
    kill_memory_server = lambda: None  # noqa: E731
    notify_message_activity = lambda: None  # noqa: E731

# Line 129 — on_startup atexit
atexit.register(kill_memory_server)

# Line 144 — on_shutdown
kill_memory_server()
```

Still needed in server.py:
- `notify_message_activity()` call at end of `tools/call` branch in `mcp_handler` (before the return)

### Next session priorities

1. `static/js/chat.js` — memory context wiring + system prompt rewrite (see session notes 2026-04-06 #2 below)
2. Test with Senni — verify ChromaDB install, first write, first retrieval

### Known issue — Qwen3.5 9B tool calls in thinking blocks

Confirmed as a known llama.cpp bug (issue #20837): Qwen3.5 9B often prints tool calls in XML inside thinking blocks when thinking is enabled. Not a SENNI bug. User is experimenting with Gemma 4 as an alternative. Memory write discipline should be designed robust to unreliable self-initiation — associative (feminine) pathway is system-driven, masculine self-retrieval has auto-trigger fallback.

---

## Session notes — 2026-04-04

**TTS confirmed working** — Kokoro live via Aurini. Senni is talking. Stdin bug in `tts.py` fixed.

**Major design session — memory architecture + companion personality.**

Designed a complete memory system from scratch, informed by MemGPT/Letta, A-MEM (NeurIPS 2025), and Zep research. Key decisions:

- Four memory primitives: Fact (S), Logical (T), Conceptual (N), Emotional (F)
- Composites formed by combining primitives — Event, Reflection, Relational, Full composite
- Companion cognitive stack (`mT-fS-mN-fF`) determines write probability and retrieval mode per primitive
- Charge (m/f) = directionality not strength — masculine asserts/encodes actively, feminine absorbs/surfaces associatively
- Stack position = conscious accessibility — 4th slot (inferior) barely encodes but breaks through with disproportionate intensity
- Write weight formula: `stack_position_score × charge_multiplier × (1 + mood_resonance)`
- Masculine-sourced notes → direct ChromaDB query; feminine-sourced → associative mood/valence triggered surfacing
- Tiered storage: small always-in-context core (identity + relational state, ~400 tokens) + large episodic ChromaDB store
- A-MEM Zettelkasten linking — memories link and evolve each other asynchronously between sessions
- Zep-style temporal awareness — superseded facts preserved with history, not overwritten
- i/e polarity deliberately excluded from v1, nullable extension point in schema

Full design in `design/MEMORY.md` and `design/COMPANION_STACK.md`.

**Next session priorities:**
- Storage/retrieval pipeline architecture (session-start retrieval, mid-conversation triggers)
- Begin implementation planning for `scripts/memory_server.py` and `scripts/memory_store.py`
- Or: loop Senni into the design conversation

---

## Documentation convention

- **CLAUDE.md** — operational instructions + current state of every system. Update at end of every session.
- **ORB_DESIGN.md** — orb/presence architecture decisions. Update when orb system is touched.
- Other design docs (add as needed) — document *why* decisions were made, not *what* the code does.
- Rule: when we touch a system in a session, we document it in that session. Don’t defer.

---

## Environment

- OS: Linux (primary) + Windows (also supported and tested)
- GPU: Intel Arc A750
- Model: Qwen3.5 9B Q4_K_M
- llama-server: SYCL build on Windows, oneAPI build on Linux
- Temperature: 0.8 (critical — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled
- Flash attention: auto-enabled by llama-server
