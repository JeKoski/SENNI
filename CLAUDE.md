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
| `static/js/chat-ui.js` | DOM helpers, message rendering, orb state |
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

**Planned / in progress:**
- `static/js/orb.js` — all orb logic (not yet created, next session)

When creating a new module, it should:
- Do one thing only
- Export a clean simple API (e.g. `orb.init()`, `orb.moveTo(row)`)
- Not require other files to know its internals

---

## Orb system — current state (as of this session)

The orb (`#companion-orb`) is a single element in `chat.html` inside `<main class="chat-area">`.

The JS (`chat-ui.js`) moves it into the latest companion `.msg-row` via `_moveOrbToRow(row)`.
The CSS positions it `absolute` relative to that row.

**Known issue:** The orb has no home before the first message is sent.
**Planned fix (next session):** Give the orb a fixed home at the bottom of the message area. When messages arrive, the orb just stays where it is and messages flow above it. This avoids all the complexity of moving the orb between rows.

**Tuning variables in `chat.css` `:root`:**
- `--orb-overlap-x` — horizontal overlap into bubble corner
- `--orb-overlap-y` — vertical overlap into bubble corner

---

## Presence system — current state

- Presence presets save and load correctly ✓
- Active preset applies to orb CSS variables — **partially working**
- Mood system: backend done (`moods`, `active_mood` in config), UI not yet built

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
- `presence_presets` — dict of preset name → state dict
- `active_presence_preset` — which preset is active
- `moods` — dict of mood name → override dict (backend ready, UI pending)
- `active_mood` — currently active mood or null

---

## Known issues to address

- Orb has no home before first message (fix planned — fixed position at bottom of message area)
- Presence settings don't fully apply to live orb yet (CSS vars wiring needed)
- Chat history occasional rollback on reload (localStorage race condition, low priority)
- Dirty button outliers in settings panel (GitHub bug card exists)

---

## Environment

- OS: Linux
- GPU: Intel Arc
- Model: Qwen3.5 9B Q4_K_M
- Temperature: 0.8 (critical — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled
