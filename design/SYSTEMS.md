# Systems — Current State

Quick-reference current state for all major UI and runtime systems. For deep architecture decisions on the orb/presence, see `design/ORB_DESIGN.md`. For memory, see `design/MEMORY.md` and `design/COMPANION_STACK.md`.

---

## Orb system

See `ORB_DESIGN.md` for full layout, state, and CSS variable documentation.

**Quick reference:**
- Orb owned entirely by `static/js/orb.js`
- Fixed position in `#orb-home` (absolute overlay, bottom-left of `.messages-wrap`)
- States: `idle` / `thinking` / `streaming` / `heartbeat` / `chaos`
- Presence presets: nested per-state dict, applied on every `setState()` call
- Layout modes: `inline` (bubbles indented) / `strip` (orb only)

### Color architecture

Five independent color/alpha properties per state — all set by `orb.js`, consumed as CSS vars:
- `dotColor` — dots + icon tint (hex)
- `edgeColor` — orb border (hex)
- `glowColor` + `glowAlpha` — glow box-shadow (hex + 0–1 float, default 0.4)
- `ringColor` + `ringAlpha` — ring pulse, **fully independent from glow** (hex + 0–1 float, default 0.3)

Legacy migration chain in `_migrateLegacyState()`:
- Old `effectsColor`/`effectsAlpha` (intermediate format) → split into `glowColor`/`ringColor`
- Old single-color presets → all fields derived from `dotColor`

### Chaos state — color-shifting redesign (planned)

The `chaos` orb state is being redesigned from random noise into a smooth **color-shifting** cycle. The orb passes slowly through a curated color sequence — expansive, not erratic. Full loop ~8–12s. Used in two contexts:
1. **Unbound transition** — plays from the moment the user confirms Unbound, covers settings close + `unbound.md` creation + heartbeat fire, then settles as companion starts thinking
2. **Chaos presence preset** — available as a selectable presence preset for any companion

See `design/IDENTITY.md` → Chaos orb section for full spec.

### Animation registry (`orb.ANIMATIONS`)

Lives in `orb.js`. Each entry: `{ id, label, target, states }`. Adding a new animation = one registry entry; UI generates automatically. Current animations: `glowEnabled`, `breathEnabled`, `ringEnabled`, `dotsEnabled`. Toggled via `data-no-*` attributes on `#companion-orb`, targeted by CSS attribute selectors in `orb.css`.

### Mood application

Mood overrides are **additive** on top of the active Presence preset. Each overrideable property has an explicit `_enabled` flag: `{ _enabled: { glowColor: true, ringColor: true }, glowColor: '#ff0000', ringColor: '#00ffff' }`. `glowColor` and `ringColor` are independently overrideable.

---

## Presence system

- Presence presets save and load correctly ✓
- Active preset fully applies to live orb — all states ✓
- Preset values re-applied on every state transition ✓
- Avatar shown in orb ✓
- Layout toggle in Presence tab ✓
- Five-color architecture: dotColor / edgeColor / glowColor+glowAlpha / ringColor+ringAlpha ✓
- Ring color/alpha fully independent from glow ✓
- Animation toggles implemented and driven from registry ✓
- Presence tab redesigned — element-grouped accordion ✓
- Mood system: fully built — backend + UI complete ✓ (see Mood system section below)

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
- `companion-mood.js` — Mood tab UI (complete ✓)

`CP_STATE_DEFAULTS` and `CP_ELEMENTS` live in `companion-presence.js` and will be referenced by `companion-mood.js`.

---

## Mood system

- Moods stored in `config.moods` (dict of name → definition), `config.active_mood` (name or null) ✓
- `companion-mood.js` — full Mood tab in Companion Settings: card list, per-property toggles, group master toggles, colour picker overlay, TTS section, pill visibility segmented toggle, new/delete mood ✓
- `companion-color-picker.js` — standalone overlay colour picker module used by both Mood and Presence tabs ✓
- `tools/set_mood.py` — auto-discovered tool. Writes `active_mood` to companion config ✓
- `chat.js` `_applyMoodToOrb(moodName)` — single canonical bridge: translates config schema to orb.js flat format, calls `orb.applyPreset()`, updates mood pill ✓
- Mood hook wired to `set_mood` tool call completing — instant orb/pill update, no polling ✓
- `cpMoodSetActive()` in `companion-mood.js` also calls `_applyMoodToOrb()` — live update when activating from panel ✓
- Mood TTS overrides: schema-ready, UI not yet built (see BACKLOG.md)
- Pill visibility: `mood_pill_visibility` in config — `"always"` | `"fade"` | `"hide"` ✓

---

## Heartbeat system

- Heartbeat fires correctly on all triggers ✓
- Orb enters `heartbeat` state during a heartbeat turn (uses heartbeat preset, not idle) ✓
- Duplicate bubble bug fixed — `streamWasRendered()` checked before appending ✓
- Heartbeat settings now apply live after save (no refresh needed) ✓
- Heartbeat messages persist across refresh — serialized with `heartbeat: true` flag in tab state ✓
- `_annotateLastBubbleAsHeartbeat()` stamps ✶ meta onto stream-rendered bubble ✓
- **Stop button during heartbeat** — `_hbAbortCtrl` created in `heartbeatFire()`, passed to `callModel()`. `stopGeneration()` in `chat-controls.js` also aborts `_hbAbortCtrl`. Stop button shown/hidden around heartbeat generation ✓
- **Heartbeat event pill** — purple `.heartbeat-pill` inserted at start of each heartbeat turn, removed on skip/abort/no-response ✓

---

## Companion settings window

- Avatar browse and drop working ✓
- Old Settings panel Companion tab stripped — shows companion list + "Open companion settings" button only ✓
- **Dirty tracking** — `cpMarkDirty()` / `cpClearDirty()` / `_cpUpdateFooterButtons()` implemented in `companion.js`. Footer Apply/Save buttons turn yellow on unsaved changes, same pattern as Settings panel. Wired to: name input, all soul-edit radios, force-read toggle, all 12 generation inputs, all 6 heartbeat toggles, heartbeat number inputs, all 6 instruction textareas. Presence changes (`cpPresenceSetValue`, new/delete preset, layout toggle) also call `cpMarkDirty()` via `typeof` guard. Window always opens clean (`cpClearDirty()` called in `cpLoad()`). ✓

---

## Settings panel — dirty tracking

- Server tab: sliders, custom args, GPU select, port inputs ✓
- Generation tab: sliders, max-tokens, max-tool-rounds, vision mode radios, markdown toggle ✓
- Companion tab: shows companion list only — no editable fields here (all companion fields are in the Companion Window)

---

## Chat tabs

- Tab state serialized to localStorage per companion: `chat_tabs_<folder>` ✓
- Format: `{ tabs: [...], activeTabId: "..." }` — both the tab list and the active tab are persisted ✓
- Old plain-array format still supported on load (backward compat) ✓
- Each tab object: `{ id, title, history, messages, created, tokens, visionMode }` ✓
- `visionMode` per tab: `null` (use global setting), `'once'`, or `'always'` — set when user picks from the per-message vision dialog ✓
- Closing the active tab during generation calls `stopGeneration()` to abort the in-flight request ✓

### Disk-backed history (added 2026-04-06 #4)

Tab state in localStorage is now a lightweight index only (IDs, titles, tokens). Full history saved to disk via `/api/history/*`. Images saved as separate files in session folders.

**History folder structure:**
```
companions/<folder>/history/
  <tab-id>/
    meta.json
    <YYYY-MM-DD_HHMMSS>/
      session.json        ← messages + history, consolidated: false
      img_001.jpg         ← media files referenced by path
```

Legacy format (plain array in localStorage) still supported on first load.

---

## Vision mode

Three settings, two layers:

**Global setting** (`config.generation.vision_mode`): `'always'` | `'once'` | `'ask'`
- `'always'` — re-encode image on every turn
- `'once'` — encode once, substitute text on follow-ups
- `'ask'` — show a per-message dialog when an image is attached

**Per-tab override** (`tab.visionMode`): `null` | `'once'` | `'always'`
- Set when user picks from the `'ask'` dialog
- Persists for the tab's lifetime (saved in localStorage)
- Overrides the global setting for that tab

**In `api.js`:** reads `_activeTab?.visionMode || config.generation?.vision_mode || 'always'`. The string `'ask'` is treated as `'always'` — it's a UI-only value that should never reach the image filter.

---

## Associative memory retrieval (UI side)

- `api.js` has `onMemorySurface` callback + `_assocTurnsSinceLast` turn counter
- Every `ASSOC_INTERVAL` (4) user turns, calls `/api/memory/associative` and injects result as hidden system turn + fires `onMemorySurface` for UI pill
- `chat-ui.js` `appendMemoryPill(notesText)` — teal pill with expand-on-click
- Memory pill styles: `.memory-pill`, `.memory-pill-icon`, `.memory-pill-detail` in `messages.css`
- Memory tool calls wired in `tool-parser.js`: `write_memory`, `retrieve_memory`, `update_relational_state`
