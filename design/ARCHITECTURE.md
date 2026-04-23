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

- `scripts/history_router.py` - extracted persistent chat history logic from `server.py`; `/api/history/*` is now registered directly via `app.include_router(history_router)` ✓
- `scripts/settings_router.py` - extracted settings/companion/soul routes from `server.py`; registered via `create_settings_router(...)` so shared TTS/runtime hooks stay explicit ✓
- `static/js/orb.js` - extracted from chat-ui.js ✓
- `static/js/tool-parser.js` - extracted from api.js ✓
- `static/js/message-renderer.js` - extracted from chat-ui.js ✓
- `static/js/companion-presence.js` — extracted from companion.js ✓
- `static/css/chat.css` → split into base/messages/orb/companion-panel.css ✓
- `static/js/settings.js` → split into coordinator + server/generation/companion tab files ✓
- `static/js/companion-memory.js` — Memory tab UI ✓
- `static/js/companion-color-picker.js` — colour picker overlay extracted from companion-presence.js ✓
- `static/js/mood-pill.js` — mood pill IIFE module ✓
- `static/js/companion-mood.js` — Mood tab UI ✓
- `static/js/companion-avatar.js` — canvas crop modal (orb + sidebar portrait modes) ✓
- `static/js/voice-input.js` — MediaRecorder voice input, WAV transcode, auto-send ✓

---

## Planned future modules

- `static/js/system-prompt.js` — extract `buildSystemPrompt()` from chat.js (low priority)

---

## Current `chat.html` script load order

```
tool-parser.js              ← no deps
api.js                      ← needs tool-parser.js
attachments.js
voice-input.js              ← needs attachments.js (addAttachment)
orb.js
message-renderer.js         ← no deps
chat-ui.js                  ← needs message-renderer.js, orb.js, appendMemoryPill()
chat-tabs.js                ← needs message-renderer.js, chat-ui.js, chat-controls.js
chat-controls.js
chat.js
heartbeat.js
tts.js                      ← needs api.js (onTtsToken), no DOM deps at load time
companion-avatar.js         ← canvas crop modal; no deps, loaded before companion.js
                               exports cpAvatarInit(), cpAvatarCrop(), cpAvatarReset()
companion.js                ← coordinator, loads before presence/tts/memory/mood
companion-presence.js       ← needs companion.js (cpSettings, cpMarkDirty), orb.js
                               exports CP_SWATCHES, CP_ELEMENTS, CP_SPEED_RANGES,
                               conversion helpers (_cpSecsToSlider etc.)
companion-color-picker.js   ← needs CP_SWATCHES from companion-presence.js
                               exports cpOpenColorPicker(), cpCloseColorPicker(), cpPickerHexInput()
mood-pill.js                ← no deps (IIFE module)
                               exports moodPill.update(), .setVisibility(), .getVisibility()
companion-mood.js           ← needs companion.js, companion-presence.js (conversion helpers),
                               companion-color-picker.js, mood-pill.js
                               exports cpMoodInit(), cpMoodReset(), _cpGetMoodPayload()
companion-tts.js            ← needs companion.js (cpSettings, cpMarkDirty), tts.js
companion-memory.js         ← needs companion.js (cpSettings, cpMarkDirty, cpShowToast)
settings.js                 ← coordinator, loads before tab files
settings-server.js          ← needs settings.js
settings-generation.js      ← needs settings.js
settings-companion.js       ← needs settings.js
settings_os_paths.js        ← needs settings.js, settings-server.js
```

---

## Current `chat.html` stylesheet load order

```
base.css             ← defines all CSS variables — must be first
messages.css         ← depends on base.css variables
orb.css              ← depends on base.css variables; mood pill styles appended here
companion-panel.css  ← depends on base.css variables, orb.css keyframes;
                       Presence tab styles + Mood tab styles (cm-* classes) both here
settings.css         ← pre-existing, independent
```

---

## Colour picker architecture

The colour picker overlay is a shared singleton in the companion panel DOM (`#cp-color-overlay`). It is owned by `companion-color-picker.js` — neither Presence nor Mood knows about each other's internals.

**API:**
```js
cpOpenColorPicker({ title, hex, onPick, onClose })
cpCloseColorPicker()
cpPickerHexInput(val)   // called by oninput on overlay hex field in chat.html
```

`companion-presence.js` calls `cpOpenColorPicker()` via its thin wrapper `cpPresenceOpenColorPicker(elemId)`.
`companion-mood.js` calls `cpOpenColorPicker()` directly.

`cpPresenceOverlayHexInput()` is kept as a one-liner bridge in `companion-presence.js` for backward compatibility with the `oninput` attribute in `chat.html` — it delegates to `cpPickerHexInput()`.

---

## Companion Creation Wizard

A self-contained page at `/companion-wizard` (`static/companion-wizard.html`). All JS is inline — no external module dependencies on the chat.html module tree. Served by `server.py`.

**Backend compile module:** `scripts/wizard_compile.py`
- Entry point: `compile_companion(data)` — called by `POST /api/wizard/compile`
- Writes: `companions/<slug>/config.json`, `soul/companion_identity.md`, `soul/user_profile.md`, `birth_certificate.json`, `character_card.png` (if avatar + Pillow available)
- Export route: `GET /api/wizard/export/{folder}` — serves `character_card.png`
- Imported as `from scripts.wizard_compile import compile_companion` (relative import pattern)

**Key wizard internals (inline JS):**
- `_data` — single source of truth for all wizard state
- `_goto(step, subStep)` — only entry point for navigation
- `_getSilhouette()` — returns gender-appropriate SVG bust string, reads `_data.appearance.gender`
- `_initChipGrids(root)` — wires chip click handlers for any subtree; supports single/array/custom modes
- `_importCard(card)` — restores SENNI V2 card from `extensions.senni.wizard_selections`; best-effort for foreign V2 cards

---

## Mood → Orb schema translation

`orb.js` expects mood data in a flat `_enabled` format:
```js
{ _enabled: { edgeColor: true, glowColor: true }, edgeColor: '#6dd4a8', glowColor: '#6dd4a8' }
```

Our config schema uses a nested `{ enabled, value }` format per property (see `design/MOOD.md`).

Translation happens in `_applyMoodToOrb(moodName)` in `chat.js`. This function is the single bridge between the two formats — do not duplicate this logic elsewhere.
