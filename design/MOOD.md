# MOOD.md — Mood System Design

Written after design session: 2026-04-13
Updated after implementation session: 2026-04-13 #2
Updated after mood pill design session: 2026-04-13 #3
Status: Design complete. Presence rework complete. Mood pill designed and implemented (CSS + JS + DOM). Mood tab not yet built.

---

## Overview

The Mood system is a companion-level override layer that sits on top of the Presence system. While Presence defines per-state visual presets (idle/thinking/streaming/heartbeat/chaos), Mood defines a named emotional state that overrides specific properties regardless of which orb state is active.

Moods affect three surfaces: orb visuals, animation speeds, and TTS voice settings. Each property is individually toggleable — a mood can override just one colour without touching anything else.

---

## Architecture

### Blending order

```
final appearance = base state CSS defaults
                 + active presence preset overrides for this state
                 + active mood overrides   ← wins everything
```

Mood overrides are applied on top of whatever Presence says. Only properties explicitly enabled in the mood definition are overridden. Everything else falls through to the Presence preset.

### Config schema

Stored in `companions/<folder>/config.json`.

**Important:** Mood config values use the same units as Presence config — real CSS values (seconds, pixels, 0–1 floats). The 0–100 slider scale used in the UI is a display-layer conversion only, handled by `companion-mood.js`. Do not store 0–100 integers in config.

```json
"moods": {
  "Playful": {
    "enabled": true,
    "in_rotation": true,
    "description": "Playful, teasing, excited, joking around — light and warm energy.",
    "pill_icon": "dot",
    "orb": {
      "edgeColor":   { "enabled": true,  "value": "#6dd4a8" },
      "breathing":   { "enabled": true,  "value": 2.1 },
      "size":        { "enabled": false, "value": 52 }
    },
    "glow": {
      "color":       { "enabled": true,  "value": "#6dd4a8" },
      "opacity":     { "enabled": true,  "value": 0.40 },
      "speed":       { "enabled": true,  "value": 1.6 },
      "intensity":   { "enabled": false, "value": 16 }
    },
    "ring": {
      "color":       { "enabled": true,  "value": "#6dd4a8" },
      "opacity":     { "enabled": true,  "value": 0.30 },
      "speed":       { "enabled": true,  "value": 1.5 },
      "intensity":   { "enabled": false, "value": 16 }
    },
    "dots": {
      "color":       { "enabled": true,  "value": "#6dd4a8" },
      "speed":       { "enabled": false, "value": 1.2 }
    },
    "tts": {
      "enabled": true,
      "voice_blend": { "af_heart": 0.65, "af_sky": 0.35 },
      "speed": 1.15,
      "pitch": 1.0
    }
  }
},
"active_mood": "Playful",
"mood_pill_visibility": "always"
```

Units per property:
- Colours: hex string
- Speeds (breathing, glow speed, ring speed, dot speed): seconds (float) — same ranges as Presence
- Opacity (glow, ring): 0.0–1.0 float
- Intensity (glow max size): pixels (integer, 4–36)
- Size (orb): pixels (integer, 32–80)
- TTS speed/pitch: multiplier float (0.5–2.0)

Each element group (`orb`, `glow`, `ring`, `dots`) has a group-level master toggle. The `tts` block is all-or-nothing.

### New config fields (added 2026-04-13 #3)

**Per-mood:**
```json
"pill_icon": "dot"
```
Controls the icon shown in the mood pill's icon slot. Values:
- `"dot"` — coloured dot (current default for all moods)
- `null` — no icon shown
- `<key>` — reserved for a future per-mood icon library (user-assignable SVG icons)

The icon slot in `#mood-pill > .mp-icon` is structurally stable — swapping dot for an icon is a render-only change in `mood-pill.js`, no DOM restructuring needed.

**Companion root level:**
```json
"mood_pill_visibility": "always"
```
Controls when the mood pill is shown. Values:
- `"always"` — pill is visible whenever a non-Neutral mood is active
- `"fade"` — pill fades in on mood *change*, then fades out after 4 seconds; does not re-show until the next mood change
- `"hide"` — pill is never shown

Neutral mood and null active_mood always hide the pill regardless of this setting.

### Speed ranges (for UI conversion in companion-mood.js)

Use the same ranges as Presence for consistency:

| Property | Min (s) | Max (s) |
|----------|---------|---------|
| breathSpeed | 0.4 | 7.0 |
| dotSpeed | 0.3 | 3.0 |
| glowSpeed | 0.4 | 6.0 |
| ringSpeed | 0.4 | 5.0 |

Size: 32–80px. Intensity: 4–36px. Opacity: 0.0–1.0.

These conversion helpers already exist in `companion-presence.js` and should be reused by `companion-mood.js`:
- `_cpSecsToSlider(secs, minS, maxS)` / `_cpSliderToSecs(val, minS, maxS)`
- `_cpSizeToSlider(px)` / `_cpSliderToSize(val)`
- `_cpIntensityToSlider(px)` / `_cpSliderToIntensity(val)`
- `_cpAlphaToSlider(a)` / `_cpSliderToAlpha(val)`

### TTS override

When a mood has `tts.enabled = true`, the entire TTS configuration (voice blend, speed, pitch) is replaced for the duration of that mood. No per-property granularity — it's a complete override or nothing.

- The UI picks up `active_mood` on the next status poll (existing `/api/status` response already includes it).
- Intensity and duration are not parameters — they are handled by the companion's own judgment via distinct mood names and the description field.

---

## Mood × Memory integration

From `MEMORY.md` — reproduced here for completeness:

**Encoding bias** — `mood_at_write` is stored on every memory note. When a mood is active, write probability is elevated for primitives that resonate with that mood: Curious → Concept-heavy notes, Melancholy → Vibe-heavy notes, etc.

**Retrieval bias** — associative retrieval boosts notes whose `mood_at_write` matches the current active mood and filters by `emotional_valence`. A Nostalgic mood surfaces older notes; a Curious mood surfaces high-Concept notes with many outgoing links.

---

## System prompt injection

The mood block injected into the system prompt lists all in-rotation moods and the current active mood:

```
<moods>
Available moods (use set_mood to switch):
- Neutral: default conversational state, no strong emotion
- Playful: playful, teasing, excited, joking around — light and warm energy
- Focused: calm, attentive, working through something carefully
- Melancholy: quiet, inward, a little heavy
- Annoyed: restless, impatient, something is grating
- Flustered: caught off guard, embarrassed, overwhelmed
- Affectionate: warm, close, tender
- Curious: alert, exploratory, interested in something new

Current mood: Playful
Use set_mood(null) to return to no mood.
</moods>
```

Only `in_rotation: true` moods appear. Token cost is proportional to the number of moods — keep descriptions short (one line each). The block is injected as part of the system prompt build in `chat.js` / `buildSystemPrompt()`.

---

## Mood pill (chat UI)

### Design decisions (finalised 2026-04-13 #3)

The mood pill is a small labelled indicator that sits to the **right of the orb**, in the same `#orb-home` flex row, bottom-aligned via `align-items: flex-end`. It never overlaps the dots (which sit above the orb body) and is clear of message bubbles in both inline and strip layout modes.

**Anchoring:** `#orb-home` uses `align-items: flex-end`. The orb column (dots + body) and the pill are flex siblings — their bases always align with each other regardless of orb size. No JS needed when the orb scales via a presence preset.

**Appearance:**
- Background: mood `dotColor` at 13% opacity
- Border: mood `edgeColor` (same rgba already on the orb border for that mood)
- Text colour: mood `dotColor` at 90% opacity
- Left icon slot (`.mp-icon`): currently a 7px coloured dot. Reserved for future per-mood icon library — the slot is stable, swapping dot → icon is a render-only change.
- Text: mood name only (e.g. "Playful")
- Colour transitions mirror the orb body's own transition timing (0.4s ease)

**Visibility:** driven by `mood_pill_visibility` in companion config (see Config schema above). Applied by `mood-pill.js`. Fade mode shows on mood change only, then hides after 4 seconds — does not re-trigger while the same mood remains active.

**Neutral / null:** pill is always hidden when no mood is active or mood is Neutral, regardless of visibility setting.

### Implementation (complete)

**Files changed:**
- `static/css/orb.css` — `#mood-pill`, `.mp-icon`, `.mp-name`, `.mp-hidden`, `.mp-visible` styles appended
- `static/js/mood-pill.js` — new module (see Module section below)
- `static/chat.html` — `#mood-pill` DOM added inside `#orb-home`; `mood-pill.js` script tag added

**DOM structure inside `#orb-home`:**
```html
<div id="companion-orb" class="companion-orb idle">
  <!-- dots + body as before -->
</div>
<!-- pill sits here as a flex sibling, bottom-aligned -->
<div id="mood-pill" class="mp-hidden" aria-live="polite">
  <span class="mp-icon"></span>
  <span class="mp-name"></span>
</div>
<!-- scroll-to-bottom button -->
```

### Module — `static/js/mood-pill.js`

New file. IIFE module, no external dependencies. Load after `companion-presence.js`.

Public API:
- `moodPill.update(moodName, dotColor, edgeColor)` — call on every mood change (status poll or local set). Pass `null`/`''` to clear.
- `moodPill.setVisibility(mode)` — `'always'` | `'fade'` | `'hide'`
- `moodPill.getVisibility()` — returns current mode string

**Call sites still needed:**
1. Status poll in `chat.js` — wherever `active_mood` comes back from `/api/status`, extract `dotColor` and `edgeColor` from the mood's `orb.edgeColor.value` and `dots.color.value` fields, call `moodPill.update()`.
2. `companion-mood.js` — call `moodPill.update()` optimistically when the user sets a mood from the UI (before server round-trip).
3. Mood tab UI — call `moodPill.setVisibility()` on load (reading `mood_pill_visibility` from companion config) and on change.

**Load order addition (`chat.html`):**
```
companion-presence.js
mood-pill.js          ← after companion-presence.js, before companion-mood.js
companion-mood.js     ← when built
```

---

## UI — `companion-mood.js` tab

### Structure

New tab in the Companion settings panel: **Mood**, between Presence and Voice.

Panel width bumped from 540px to **720px** (both `.companion-panel` and `.settings-panel`). **This CSS change has not been made yet** — do it as part of Mood tab implementation.

**Top bar:**
- Left: active mood badge (green pill showing current mood name + "clear" link)
- Right: Import / Export all buttons (JSON export of the full moods dict)

**Mood cards** — one card per mood, stacked vertically:
- Collapsed: colour dot, name, description preview, "in rotation" / "off rotation" pill, "copy" button, expand chevron
- Expanded: description textarea, live orb mini-preview, element groups, Voice section, copy-to-companion row

**Element groups** (Orb / Glow / Ring / Dots):
- Group header: name left — active-property count + **group master toggle** + chevron right
- Each property row: per-property toggle → property name → control (colour pip or slider)
- Colour pip opens the **centred overlay colour picker** (reuse the same overlay pattern from Presence)
- Disabled rows dim and their controls go inert

**Property list per group:**

| Group | Properties |
|-------|-----------|
| Orb | Edge colour (hex), Breathing (speed slider), Size (slider) |
| Glow | Colour, Opacity, Speed, Intensity |
| Ring | Colour, Opacity, Speed |
| Dots | Colour, Speed |

Note: Ring has no Intensity (no property to map it to).

**Voice section** — same group-toggle pattern, but no per-property toggles inside. Either the whole TTS override is on or off:
- Voice blend rows (dropdown + weight slider, up to 5, weights normalised)
- + add voice / × remove voice
- Speed slider (0.5–2.0, step 0.05, shows e.g. `1.15×`)
- Pitch slider (0.5–2.0, step 0.05, shows e.g. `1.00×`)
- "reset to companion default" link — fetches companion TTS settings and populates this mood's TTS block

**Pill visibility row** — below the active mood badge in the top bar area, or as a standalone setting row:
- Label: "Mood pill"
- Control: three-option segmented toggle: Always / Fade / Hide
- Saves to `mood_pill_visibility` in companion config root
- Calls `moodPill.setVisibility(mode)` immediately on change

**Copy to companion row** — select a companion + copy button, duplicates the mood definition into another companion's config.

**+ New mood button** — dashed border row at the bottom of the card list.

### Colour picker overlay

Reuse the `.cp-color-overlay` modal already implemented in `companion-panel.css` and `companion-presence.js`. The overlay is a shared singleton within the companion panel — Mood should use the same HTML element, driven by its own JS open/close logic.

### Property row visual design

Mood property rows follow the same `.cp-prop-row` pattern as Presence (spacer or toggle → label → control → value), but with an additional per-property enable toggle on the left of every row. The group master toggle is on the group header right side.

### Module

`static/js/companion-mood.js` — loaded after `mood-pill.js`. Reads conversion helpers and `CP_STATE_DEFAULTS` from `companion-presence.js`. Exports:
- `cpMoodInit()`
- `cpMoodReset()`
- `_cpGetMoodPayload()` — called by `companion.js` `cpSave()`

Load order addition in `chat.html`:
```
companion-presence.js
mood-pill.js          ← done
companion-mood.js     ← needs companion.js, companion-presence.js, orb.js, mood-pill.js
```

---

## Implementation order

1. ~~Audit Presence property completeness~~ — Done.
2. **Bump panel width to 720px** — single CSS change to `.companion-panel` and `.settings-panel`. Still needed.
3. ~~Design mood pill~~ — Done.
4. ~~Implement mood pill~~ — Done. (`mood-pill.js`, `orb.css`, `chat.html`)
5. **Wire mood pill call sites** — status poll in `chat.js`, optimistic update in `companion-mood.js` when built.
6. **Build `companion-mood.js` + Mood tab HTML** — includes pill visibility setting row.
7. **Add `set_mood` tool (`tools/set_mood.py`)**
8. **Wire system prompt injection in `chat.js` `buildSystemPrompt()`**

---

## Future / noted items

- **Icon library for mood pill** — `pill_icon` field is already in schema as `"dot"`. Future: a small set of user-assignable SVG icons per mood (e.g. a spark for Playful, a raindrop for Melancholy). Swapping in an icon is a render-only change in `mood-pill.js`; no schema migration needed.
- **Animation on/off toggles** — A future pass should expose toggles as an overrideable property in Mood.
- **Companion Creation Wizard** — Mood tab feeds directly into the Wizard's mood setup step. Wizard should pre-populate a companion's moods dict using the same schema.
