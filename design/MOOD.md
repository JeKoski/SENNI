# MOOD.md — Mood System Design

Written after design session: 2026-04-13
Status: Design complete, not yet implemented.

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

Stored in `companions/<folder>/config.json`:

```json
"moods": {
  "Playful": {
    "enabled": true,
    "in_rotation": true,
    "description": "Playful, teasing, excited, joking around — light and warm energy.",
    "orb": {
      "edgeColor":   { "enabled": true,  "value": "#6dd4a8" },
      "breathing":   { "enabled": true,  "value": 38 },
      "size":        { "enabled": false, "value": 50 }
    },
    "glow": {
      "color":       { "enabled": true,  "value": "#6dd4a8" },
      "opacity":     { "enabled": true,  "value": 40 },
      "speed":       { "enabled": true,  "value": 72 },
      "intensity":   { "enabled": false, "value": 50 }
    },
    "ring": {
      "color":       { "enabled": true,  "value": "#6dd4a8" },
      "opacity":     { "enabled": true,  "value": 30 },
      "speed":       { "enabled": true,  "value": 76 },
      "intensity":   { "enabled": false, "value": 50 }
    },
    "dots": {
      "color":       { "enabled": true,  "value": "#6dd4a8" },
      "speed":       { "enabled": false, "value": 50 }
    },
    "tts": {
      "enabled": true,
      "voice_blend": { "af_heart": 0.65, "af_sky": 0.35 },
      "speed": 1.15,
      "pitch": 1.0
    }
  }
},
"active_mood": "Playful"
```

Each element group (`orb`, `glow`, `ring`, `dots`) has a group-level enabled state implied by whether any of its properties are enabled. The `tts` block is all-or-nothing: either the whole TTS override is active or it falls through to the companion default.

### Speed scale

All animation speeds (breathing, glow speed, ring speed, dot speed) use a **unified 1–100 abstract scale**, not raw CSS durations. This ensures ratios are preserved: ring at 60 and breathing at 30 always gives a 2:1 relationship. Each animation converts internally from the unified scale to its appropriate CSS duration range — so the "same number" means "same relative speed" across all animations.

Left = slowest, right = fastest. 50 is the neutral midpoint.

### TTS override

When a mood has `tts.enabled = true`, the entire TTS configuration (voice blend, speed, pitch) is replaced for the duration of that mood. No per-property granularity — it's a complete override or nothing. A "reset to companion default" action fetches the companion's base TTS settings and populates the mood's TTS block with them as a starting point.

Speed and pitch use real values: `0.5` to `2.0`, matching what the voice engine receives. `1.0` is normal. Stepped at `0.05`.

---

## Default moods

Eight defaults ship with every companion. All are toggleable — `in_rotation: false` removes a mood from Qwenny's available set while preserving its definition.

| Mood | Colour | Character |
|------|--------|-----------|
| Neutral | Indigo (presence default) | No overrides — named baseline. Qwenny uses this to explicitly return to default. |
| Playful | Green `#6dd4a8` | Fast ring, elevated breath, warm voice blend |
| Focused | Blue `#60a5fa` | Slow breath, ring off, cool colour |
| Melancholy | Desaturated indigo `#6366f1` | Very slow everything, soft glow |
| Annoyed | Amber `#fbbf24` | Fast ring, sharp intensity, clipped glow |
| Flustered | Coral-pink `#fda4af` | Fast ring, elevated breath speed |
| Affectionate | Rose `#f472b6` | Slow gentle pulse, ring on, warm |
| Curious | Teal `#22d3ee` | Alert, medium-fast ring, bright dots |

Neutral carries no overrides by design — it is a named way for Qwenny to clear mood without calling `set_mood(null)`.

Intensity escalation (e.g. Annoyed → Angry → Furious) is handled as separate mood definitions rather than a numeric intensity parameter. This keeps moods explicit, auditable, and easily described in the system prompt.

---

## `set_mood` tool

```
set_mood(mood_name: str | null)
```

- Sets `active_mood` in companion config.
- `null` clears the active mood (no overrides applied, presence preset wins fully).
- Only moods with `in_rotation: true` should be offered in the system prompt. The tool itself does not enforce this — it's a system prompt instruction concern.
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

## UI — `companion-mood.js` tab

### Structure

New tab in the Companion settings panel: **Mood**, between Presence and Voice.

Panel width bumped from 540px to **720px** (both `.companion-panel` and `.settings-panel`).

**Top bar:**
- Left: active mood badge (green pill showing current mood name + "clear" link)
- Right: Import / Export all buttons (JSON export of the full moods dict)

**Mood cards** — one card per mood, stacked vertically:
- Collapsed: colour dot, name, description preview, "in rotation" / "off rotation" pill, "copy" button, expand chevron
- Expanded: description textarea, live orb mini-preview, element groups, Voice section, copy-to-companion row

**Element groups** (Orb / Glow / Ring / Dots):
- Group header: name, active-property count, **group master toggle** (right of count, left of chevron) — disabling the group suspends all its overrides without clearing values; re-enabling restores them
- Each property row: per-property toggle → property name → control (colour pip or slider)
- Colour pip opens the **centred overlay colour picker** (see below)
- Disabled rows dim and their sliders go inert

**Property list per group:**

| Group | Properties |
|-------|-----------|
| Orb | Edge colour, Breathing (speed), Size |
| Glow | Colour, Opacity, Speed, Intensity |
| Ring | Colour, Opacity, Speed, Intensity |
| Dots | Colour, Speed |

**Voice section** — same group-toggle pattern, but no per-property toggles inside. Either the whole TTS override is on or off:
- Voice blend rows (dropdown + weight slider, up to 5, weights normalised)
- + add voice / × remove voice
- Speed slider (0.5–2.0, step 0.05, shows e.g. `1.15×`)
- Pitch slider (0.5–2.0, step 0.05, shows e.g. `1.00×`)
- "reset to companion default" link — fetches companion TTS settings and populates this mood's TTS block

**Copy to companion row** — select a companion + copy button, duplicates the mood definition into another companion's config.

**+ New mood button** — dashed border row at the bottom of the card list.

### Colour picker overlay

Triggered by clicking any colour pip. Opens as a **centred overlay** within the panel (dimmed backdrop, click-outside dismisses). Never anchored/floating — always centred.

Contents: HSB gradient canvas, hue bar, eyedropper button, current colour swatch + hex input, swatch grid (8×5 palette), opacity slider (shown only for properties that have alpha), Cancel / OK buttons.

OK applies the colour to the pip and hex label. Cancel discards. The picker does not modify anything until OK is pressed.

### Module

`static/js/companion-mood.js` — loaded after `companion-presence.js`. Reads `CP_STATE_DEFAULTS` and `CP_ELEMENTS` from `companion-presence.js`. Exports:
- `cpMoodInit()`
- `cpMoodReset()`
- `_cpGetMoodPayload()` — called by `companion.js` `cpSave()`

Load order addition in `chat.html`:
```
companion-mood.js   ← needs companion.js, companion-presence.js, orb.js
```

---

## Mood pill (chat UI)

Not yet designed. Deferred to next session. Intended location: near the orb area. Toggleable, hidden by default. Shows current mood name; pill background = mood dot colour, pill border = orb edge colour.

---

## Implementation order

1. Audit and complete Presence property set (ensure Presence exposes same properties Mood will override, so the architecture is consistent before Mood is built)
2. Bump panel width to 720px — single CSS change to `.companion-panel` and `.settings-panel`
3. Build `companion-mood.js` + Mood tab HTML
4. Add `set_mood` tool (`tools/set_mood.py`)
5. Wire system prompt injection in `chat.js` `buildSystemPrompt()`
6. Design and implement mood pill in chat UI

---

## Future / noted items

- **Animation on/off toggles** — currently no way to fully disable an animation (only adjust speed). A future pass should add enable/disable to Presence elements, then expose it as an overrideable property in Mood.
- **Mood pill design** — deferred, needs its own design pass next session before implementation.
- **Companion Creation Wizard** — Mood tab feeds directly into the Wizard's mood setup step. Wizard should pre-populate a companion's moods dict using the same schema.
