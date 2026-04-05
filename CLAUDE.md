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

SENNI is a local AI companion framework. Currently running with Qwen3.5 9B Q4_K_M on Linux, Gemma 4 E4B Q4_K_M on Windows (testing), Intel Arc GPU both platforms.

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
chat-ui.js           ← needs message-renderer.js, orb.js
chat-tabs.js         ← needs message-renderer.js, chat-ui.js, chat-controls.js
chat-controls.js
chat.js
heartbeat.js
tts.js               ← needs api.js (onTtsToken), no DOM deps at load time
companion.js         ← coordinator, loads before presence and tts
companion-presence.js ← needs companion.js (cpSettings, cpMarkDirty), orb.js
companion-tts.js     ← needs companion.js (cpSettings, cpMarkDirty), tts.js
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
- Look into best options - What open source options are there already that we could just use instead of reinventing the wheel?
- Automatic vector/embedding?
- Memory decay over time when not used?

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
| `design/MEMORY.md`          | Full memory architecture — primitives, composite types, note schema, tiered storage, ChromaDB stack, mood integration, write discipline                   |
| `design/COMPANION_STACK.md` | Cognitive function stack format (`mT-fS-mN-fF`), charge/position interactions, effect on memory encoding and retrieval, UI exposure tiers, storage schema |
| `design/ORB_DESIGN.md`      | Companion Orb<br>Persistent presence indicator in the chat                                                                                                |

When starting a session that touches memory or personality systems, search project knowledge for the relevant design doc rather than asking the user to explain it.

---

## Session notes — 2026-04-05

**Gemma 4 E4B testing on Windows / SYCL.**

Diagnosed two issues from llama-server log:

1. **CPU spike (18 graph splits)** — Gemma 4's alternating SWA/global attention architecture hits SYCL ops not yet fused natively. All 43 layers offload to VRAM correctly, but 18 graph splits means constant GPU↔CPU data shuffling per decode step. Not a Senni bug — a llama.cpp SYCL limitation. Workarounds: larger `-b`/`-ub`, `--flash-attn`. Will improve as llama.cpp matures Gemma 4 SYCL support.

2. **Tool calls not firing** — Gemma 4 uses a completely different native tool call format from Qwen3/Gemma 3: `<|tool_call>call:name{param:<|"|>value<|"|>}<tool_call|>`. None of Paths A–D matched it. llama-server's `peg-gemma4` grammar may or may not convert these to structured `tool_calls` (Path A); when it doesn't, they land as raw content.

**Added Path E (Gemma 4 native tool calls):**
- `parseGemma4ToolCalls()` in `tool-parser.js` — regex over `<|tool_call>...<tool_call|>` blocks, unescapes `<|"|>` → `"`, parses args as JSON with relaxed fallback
- `formatGemma4ToolResponse()` in `tool-parser.js` — formats results as `<|tool_response>response:name{result:<|"|>...<|"|>}<tool_response|>` tokens that Gemma 4's chat template reads natively
- Path E in `api.js` — sits between Path D and plain reply; on match, pushes raw assistant turn + user turn of formatted response tokens, then loops

**Files changed:** `static/js/tool-parser.js`, `static/js/api.js`

**Next session priorities:**
- Test Gemma 4 tool calls live — verify Path E fires correctly, check browser console for `[api] gemma4 tool call(s):` log lines
- If Path A (structured tool_calls) fires instead of Path E, that's fine — means llama-server's peg-gemma4 grammar is working. Both paths should work correctly.
- Consider whether `--reasoning-format` needs to be disabled or changed for Gemma 4 (it's a Qwen3 flag; Gemma 4 has its own thinking token format)
- Memory system implementation planning (see MEMORY.md + COMPANION_STACK.md)

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
- Model: Qwen3.5 9B Q4_K_M (Linux primary), Gemma 4 E4B Q4_K_M (Windows testing)
- llama-server: SYCL build on Windows, oneAPI build on Linux
- Temperature: 0.8 (critical — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled for Qwen3; disable for Gemma 4
- Flash attention: auto-enabled by llama-server

### Gemma 4 / SYCL performance notes (Windows)

Gemma 4 E4B has alternating SWA (sliding window attention) + global attention layers. The SYCL backend in llama.cpp doesn't yet fuse SWA ops natively, causing **18 graph splits** per inference step — each split is a GPU↔CPU round-trip, which spikes CPU to 100%.

Workarounds while SYCL SWA support matures:
- Set `-b 2048` (or higher) and `-ub 512` — larger batches amortize the split overhead significantly
- Enable `--flash-attn` — has specific optimisations for sliding window patterns
- ReBar (Resizable BAR) would help further but Arc A750 on this board doesn't support it
- Watch llama.cpp changelog for `ggml_sycl` commits mentioning `gemma4` or `swa`
