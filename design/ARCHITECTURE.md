# Architecture — Modularity & Load Order

## Philosophy

The codebase uses small focused modules. New features should be built as separate files where possible.

When creating a new module, it should:
- Do one thing only
- Export a clean simple API
- Not require other files to know its internals
- Load order in `chat.html` must be updated when adding new files

---

## Refactors completed

- `static/js/orb.js` — extracted from chat-ui.js ✓
- `static/js/tool-parser.js` — extracted from api.js ✓
- `static/js/message-renderer.js` — extracted from chat-ui.js ✓
- `static/js/companion-presence.js` — extracted from companion.js ✓
- `static/css/chat.css` → split into base/messages/orb/companion-panel.css ✓
- `static/js/settings.js` → split into coordinator + server/generation/companion tab files ✓
- `static/js/companion-memory.js` — Memory tab UI ✓

---

## Planned future modules

- `static/js/companion-mood.js` — Mood UI tab (new file when Mood UI is built)
- `static/js/system-prompt.js` — extract `buildSystemPrompt()` from chat.js (low priority)

---

## Current `chat.html` script load order

```
tool-parser.js          ← no deps
api.js                  ← needs tool-parser.js
attachments.js
orb.js
message-renderer.js     ← no deps
chat-ui.js              ← needs message-renderer.js, orb.js, appendMemoryPill()
                           (appendMemoryPill now required by chat-tabs.js and api.js — load order already correct)
chat-tabs.js            ← needs message-renderer.js, chat-ui.js, chat-controls.js
chat-controls.js
chat.js
heartbeat.js
tts.js                  ← needs api.js (onTtsToken), no DOM deps at load time
companion.js            ← coordinator, loads before presence/tts/memory
companion-presence.js   ← needs companion.js (cpSettings, cpMarkDirty), orb.js
companion-tts.js        ← needs companion.js (cpSettings, cpMarkDirty), tts.js
companion-memory.js     ← needs companion.js (cpSettings, cpMarkDirty, cpShowToast)
settings.js             ← coordinator, loads before tab files
settings-server.js      ← needs settings.js
settings-generation.js  ← needs settings.js
settings-companion.js   ← needs settings.js
settings_os_paths.js    ← needs settings.js, settings-server.js
```

---

## Current `chat.html` stylesheet load order

```
base.css             ← defines all CSS variables — must be first
messages.css         ← depends on base.css variables
orb.css              ← depends on base.css variables
companion-panel.css  ← depends on base.css variables, orb.css keyframes
settings.css         ← pre-existing, independent
```
