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

---

## Project overview

SENNI is a local AI companion framework. The companion is Qwenny (Qwen3.5 9B Q4_K_M, Intel Arc GPU, Linux).

Two servers:
- **Python bridge** (`scripts/server.py`) — FastAPI, handles UI, tools, config. Needs terminal restart for changes.
- **llama-server** — the model itself. Can be restarted in-app.

---

## Key file map

| File | Purpose |
|------|---------|
| `scripts/server.py` | FastAPI bridge — API endpoints, tool routing |
| `scripts/config.py` | Config read/write, companion config, DEFAULTS |
| `static/chat.html` | Main chat UI HTML |
| `static/css/chat.css` | All styles |
| `static/js/chat.js` | Core chat logic, session management, system prompt |
| `static/js/orb.js` | **New** — all orb logic (state, avatar, presets, layout mode) |
| `static/js/chat-ui.js` | DOM helpers, message rendering, thin orb wrappers |
| `static/js/api.js` | Model communication, tool execution, streaming |
| `static/js/chat-tabs.js` | Tab management, message serialization/replay |
| `static/js/chat-controls.js` | Message controls, edit, regenerate |
| `static/js/companion.js` | Companion settings window, presence tab |
| `static/js/settings.js` | Global settings panel |
| `static/js/heartbeat.js` | Heartbeat system |

---

## Modularity plan

The codebase is being gradually refactored into small focused modules.
New features should be built as separate files where possible.

**Done this session:**
- `static/js/orb.js` — created ✓

**Next refactor candidates** (do as a dedicated session, not mixed with features):
- `static/js/chat-ui.js` — message rendering could be its own module
- `static/js/api.js` — streaming logic could be extracted

When creating a new module, it should:
- Do one thing only
- Export a clean simple API
- Not require other files to know its internals

---

## Orb system — current state

The orb (`#companion-orb`) lives in `#orb-home`, which is `position: absolute` at the bottom-left of `.messages-wrap`. It never moves. The orb is owned entirely by `static/js/orb.js`.

### Layout

```
.chat-area (flex column)
  └── .messages-wrap (flex:1, position:relative)
        ├── #messages (scrolls freely, padding-bottom:80px to clear orb)
        └── #orb-home (position:absolute, bottom-left, pointer-events:none)
              └── #companion-orb
  └── #ctx-bar-wrap
  └── #input-bar
```

### Layout modes (toggled in Companion Settings → Presence)

- **Inline mode** (default): companion `.msg-row` elements get `padding-left: var(--orb-indent)` so all bubbles align with the orb column. `--orb-indent` is derived from `--orb-size` so resizing the orb keeps alignment locked.
- **Strip mode**: orb only, no indent. Placeholder for a future status bar (thinking text, etc.).

Mode is persisted in `localStorage` as `orb_layout`. `orb.setMode(mode)` switches it.

### orb.js public API

| Method | Purpose |
|--------|---------|
| `orb.init()` | Call on DOMContentLoaded — sets saved mode, idle state, syncs avatar, attaches scroll listener |
| `orb.setState(state)` | Sets visual state (`idle`/`thinking`/`streaming`/`heartbeat`/`chaos`) + applies correct preset slice |
| `orb.applyPreset(preset, mood?)` | Stores full nested preset `{ thinking:{...}, idle:{...}, ... }` and re-applies current state. Also accepts legacy flat format. |
| `orb.syncAvatar()` | Reads sidebar avatar and applies to orb icon. Falls back to ✦. |
| `orb.setMode(mode)` | Switches layout mode, persists to localStorage |

### CSS variables (on `:root`)
- `--orb-size` — kept in sync by `orb.js` when preset changes
- `--orb-gap` — gap between orb and bubbles
- `--orb-indent` — `calc(--orb-size + --orb-gap + 16px)` — applied to companion bubble padding

### Scroll behaviour
`orb.init()` attaches a scroll listener on `#messages`. When not at bottom, `body.chat-scrolled-up` class is added, showing the scroll-to-bottom button (`#scroll-to-bottom`).

---

## Presence system — current state

- Presence presets save and load correctly ✓
- Active preset fully applies to live orb — all states (idle/thinking/streaming/etc.) ✓
- Preset values re-applied on every state transition ✓
- Avatar shown in orb ✓
- Layout toggle in Presence tab ✓
- Mood system: backend done (`moods`, `active_mood` in config), UI not yet built

---

## Companion settings window

- Avatar browse and drop working ✓ (`cpAvatarFile` function added)
- Old Settings panel Companion tab stripped — shows companion list + "Open companion settings" button only ✓

---

## Auto-backup system

On every Python bridge startup, `scripts/server.py` copies tracked files to `backups/YYYY-MM-DD_HH-MM-SS/`.
The `backups/` folder is in `.gitignore`.

If something breaks, copy files from the latest backup folder.

---

## Companion config

Qwenny's config lives in `companions/default/config.json`.
Global config in `config.json` at project root.

Key companion config fields:
- `presence_presets` — dict of preset name → per-state dict `{ thinking:{...}, idle:{...}, ... }`
- `active_presence_preset` — which preset is active
- `moods` — dict of mood name → override dict (backend ready, UI pending)
- `active_mood` — currently active mood or null

---

## Known issues / next tasks

- Streaming text visual (tokens appearing one by one) regressed — secondary priority
- Strip mode is a placeholder — needs status bar UI (thinking text, etc.) in a future session
- Mood UI in Presence tab — future session
- `set_mood` tool for Qwenny — future session
- Refactor session: extract more modules from `chat-ui.js` and `api.js`
- Chat history occasional rollback on reload (localStorage race condition, low priority)

---

## Environment

- OS: Linux
- GPU: Intel Arc
- Model: Qwen3.5 9B Q4_K_M
- Temperature: 0.8 (critical — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled
