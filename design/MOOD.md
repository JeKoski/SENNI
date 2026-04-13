# MOOD.md — Mood System Design

Written after design session: 2026-04-13
Updated after implementation session: 2026-04-13 #2
Status: Design complete. Presence rework complete. Mood tab not yet built.

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
"active_mood": "Playful"
```

Units per property:
- Colours: hex string
- Speeds (breathing, glow speed, ring speed, dot speed): seconds (float) — same ranges as Presence
- Opacity (glow, ring): 0.0–1.0 float
- Intensity (glow max size): pixels (integer, 4–36)
- Size (orb): pixels (integer, 32–80)
- TTS speed/pitch: multiplier float (0.5–2.0)

Each element group (`orb`, `glow`, `ring`, `dots`) has a group-level master toggle. The `tts` block is all-or-nothing.

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

Intensity escalation (e.g. Annoyed → Angry → Furious) is handled as separate mood definitions rather than a numeric intensity parameter.

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

**Copy to companion row** — select a companion + copy button, duplicates the mood definition into another companion's config.

**+ New mood button** — dashed border row at the bottom of the card list.

### Colour picker overlay

Reuse the `.cp-color-overlay` modal already implemented in `companion-panel.css` and `companion-presence.js`. The overlay is a shared singleton within the companion panel — Mood should use the same HTML element, driven by its own JS open/close logic.

### Property row visual design

Mood property rows follow the same `.cp-prop-row` pattern as Presence (spacer or toggle → label → control → value), but with an additional per-property enable toggle on the left of every row. The group master toggle is on the group header right side.

### Module

`static/js/companion-mood.js` — loaded after `companion-presence.js`. Reads conversion helpers and `CP_STATE_DEFAULTS` from `companion-presence.js`. Exports:
- `cpMoodInit()`
- `cpMoodReset()`
- `_cpGetMoodPayload()` — called by `companion.js` `cpSave()`

Load order addition in `chat.html`:
```
companion-mood.js   ← needs companion.js, companion-presence.js, orb.js
```

---

## Mood pill (chat UI)

Not yet designed. **Priority for next session before implementation begins.**

Intended location: near the orb area in the main chat UI. Toggleable, hidden by default. Shows current mood name. Pill background = mood dot colour, pill border = orb edge colour.

---

## Implementation order

1. ~~Audit Presence property completeness~~ — Done.
2. **Bump panel width to 720px** — single CSS change to `.companion-panel` and `.settings-panel`. Do first.
3. **Design mood pill** — needs design pass before implementation.
4. **Build `companion-mood.js` + Mood tab HTML**
5. **Add `set_mood` tool (`tools/set_mood.py`)**
6. **Wire system prompt injection in `chat.js` `buildSystemPrompt()`**
7. **Implement mood pill**

---

## Future / noted items

- **Animation on/off toggles** — currently no way to fully disable an animation (only adjust speed). A future pass should add enable/disable to Presence elements, then expose it as an overrideable property in Mood.
- **Companion Creation Wizard** — Mood tab feeds directly into the Wizard's mood setup step. Wizard should pre-populate a companion's moods dict using the same schema.
