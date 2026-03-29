# CLAUDE.md — Instructions for Claude

This file is for Claude to read at the start of every session.
Search for it using project knowledge before doing anything else.

---

## Critical working rules

- **Always provide complete files** — never code sections, never snippets, never "find X and replace with Y". The user has ADHD and finds partial edits extremely difficult. Full file replacements only.
- **One file at a time** where possible. Flag upfront if a feature will require touching multiple files and get agreement before proceeding.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won't work. Automate it or build it into existing flows instead.
- **Python bridge needs a full terminal restart** to pick up changes — the in-app restart only restarts llama-server.
- **Suggest Extended Thinking** when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **End every session by updating CLAUDE.md and any relevant design docs.** This is non-negotiable — it's what makes the next session productive.

---

## Project overview

SENNI is a local AI companion framework. The companion is Qwenny (Qwen3.5 9B Q4_K_M, Intel Arc GPU).

Two servers:
- **Python bridge** (`scripts/server.py`) — FastAPI, handles UI, tools, config. Needs terminal restart for changes.
- **llama-server** — the model itself. Can be restarted in-app.

Runs on Linux (primary dev) and Windows (also tested and supported).

---

## Key file map

| File | Purpose |
|------|---------|
| `scripts/server.py` | FastAPI bridge — API endpoints, tool routing, process management |
| `scripts/config.py` | Config read/write, per-OS path resolution, DEFAULTS |
| `static/chat.html` | Main chat UI HTML |
| `static/css/chat.css` | All styles |
| `static/js/chat.js` | Core chat logic, session management, system prompt |
| `static/js/orb.js` | All orb logic (state, avatar, presets, layout mode) |
| `static/js/chat-ui.js` | DOM helpers, message rendering, thin orb wrappers |
| `static/js/tool-parser.js` | Tool call parsing/stripping — no DOM, no side effects |
| `static/js/api.js` | Model communication, tool execution, streaming |
| `static/js/chat-tabs.js` | Tab management, message serialization/replay |
| `static/js/chat-controls.js` | Message controls, edit, regenerate |
| `static/js/companion.js` | Companion settings window, presence tab |
| `static/js/settings.js` | Global settings panel |
| `static/js/settings_os_paths.js` | Per-OS path cards in Settings → Server tab |
| `static/js/heartbeat.js` | Heartbeat system |

---

## Modularity plan

The codebase is being gradually refactored into small focused modules.
New features should be built as separate files where possible.

**Refactors completed:**
- `static/js/orb.js` — extracted from chat-ui.js ✓
- `static/js/tool-parser.js` — extracted from api.js ✓

**Next refactor candidates** (do as a dedicated session, not mixed with features):
- `static/js/chat-ui.js` — `appendMessage` + bubble rendering → `message-renderer.js`

When creating a new module, it should:
- Do one thing only
- Export a clean simple API
- Not require other files to know its internals
- Load order in `chat.html` must be updated when adding new files

**Current `chat.html` script load order:**
```
tool-parser.js  ← no deps
api.js          ← needs tool-parser.js
attachments.js
orb.js
chat-ui.js
chat-tabs.js
chat-controls.js
chat.js
heartbeat.js
companion.js
settings.js
settings_os_paths.js
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
2. If `model_launching`: attach to existing SSE log stream, don't call `/api/boot`
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

`resolve_platform_paths()` reads the current OS's entry into the flat value on load.
`update_platform_paths()` writes the flat value back into the dict on save.
Empty `server_binary` means auto-discover — never write an empty string to `server_binaries`.

### llama-server binary resolution priority
1. `config["server_binary"]` — explicit path from Settings → Server
2. Candidate paths relative to the model file
3. `shutil.which()` PATH lookup
4. Bare exe name (will fail with a clear error message in the boot log)

---

## Settings UI — file browsing

The Settings panel (and wizard) both use `/api/browse` to open a native OS file picker via tkinter. **Do not use hidden `<input type="file">` elements as the primary browse mechanism** — they can't return full paths in the browser security model.

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

---

## Presence system — current state

- Presence presets save and load correctly ✓
- Active preset fully applies to live orb — all states ✓
- Preset values re-applied on every state transition ✓
- Avatar shown in orb ✓
- Layout toggle in Presence tab ✓
- Mood system: backend done (`moods`, `active_mood` in config), UI not yet built

---

## Companion settings window

- Avatar browse and drop working ✓
- Old Settings panel Companion tab stripped — shows companion list + "Open companion settings" button only ✓

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

## Known issues / backlog

- Streaming text visual (tokens appearing one by one) regressed — secondary priority
- Strip mode is a placeholder — needs status bar UI (thinking text, etc.) in a future session
- Mood UI in Presence tab — future session
- `set_mood` tool for Qwenny — future session
- `message-renderer.js` — extract from `chat-ui.js` (next refactor session)
- Chat history occasional rollback on reload (localStorage race condition, low priority)

---

## Documentation convention

- **CLAUDE.md** — operational instructions + current state of every system. Update at end of every session.
- **ORB_DESIGN.md** — orb/presence architecture decisions. Update when orb system is touched.
- Other design docs (add as needed) — document *why* decisions were made, not *what* the code does.
- Rule: when we touch a system in a session, we document it in that session. Don't defer.

---

## Environment

- OS: Linux (primary) + Windows (also supported and tested)
- GPU: Intel Arc A750
- Model: Qwen3.5 9B Q4_K_M
- llama-server: SYCL build on Windows, oneAPI build on Linux
- Temperature: 0.8 (critical — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled
- Flash attention: auto-enabled by llama-server
