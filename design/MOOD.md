# MOOD.md — Mood System Design

Written after design session: 2026-04-13
Updated after implementation session: 2026-04-13 #2
Updated after mood pill design session: 2026-04-13 #3
Updated after full implementation session: 2026-04-13 #4
Updated after hook + bugfix session: 2026-04-13 #5

Status: **Fully implemented and working.** Mood tab built, set_mood tool working, orb + pill updating on mood change. Tool call hook implemented (no polling). Known pending issue: orb reverts to presence preset when saving companion settings (see pending items).

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

Each element group (`orb`, `glow`, `ring`, `dots`) has a group-level master toggle stored as `_groupEnabled` (stripped before saving to config — UI state only). The `tts` block is all-or-nothing.

### pill_icon field

```json
"pill_icon": "dot"
```
Controls the icon shown in the mood pill's icon slot. Values:
- `"dot"` — coloured dot (current default for all moods)
- `null` — no icon shown
- `<key>` — reserved for a future per-mood icon library

### mood_pill_visibility field

```json
"mood_pill_visibility": "always"
```
Values: `"always"` | `"fade"` | `"hide"`. Neutral mood and null active_mood always hide the pill regardless of this setting.

### Speed ranges (for UI conversion in companion-mood.js)

| Property | Min (s) | Max (s) |
|----------|---------|---------|
| breathSpeed | 0.4 | 7.0 |
| dotSpeed | 0.3 | 3.0 |
| glowSpeed | 0.4 | 6.0 |
| ringSpeed | 0.4 | 5.0 |

Size: 32–80px. Intensity: 4–36px. Opacity: 0.0–1.0.

Conversion helpers from `companion-presence.js` (globals):
- `_cpSecsToSlider` / `_cpSliderToSecs`
- `_cpSizeToSlider` / `_cpSliderToSize`
- `_cpIntensityToSlider` / `_cpSliderToIntensity`
- `_cpAlphaToSlider` / `_cpSliderToAlpha`

---

## Mood → orb.js schema translation

`orb.js` expects mood data as a flat object with a `_enabled` dict:
```js
{ _enabled: { edgeColor: true, glowColor: true }, edgeColor: '#6dd4a8', glowColor: '#6dd4a8' }
```

Our config schema uses `{ enabled, value }` per property. Translation happens in `_applyMoodToOrb(moodName)` in `chat.js` — this is the single canonical bridge. Do not duplicate this logic elsewhere.

### Property key mapping (config → flat)

| Config path | Flat key |
|---|---|
| `orb.edgeColor` | `edgeColor` |
| `orb.dotColor` | `dotColor` |
| `orb.size` | `orbSize` |
| `orb.breathSpeed` | `breathSpeed` |
| `glow.color` | `glowColor` |
| `glow.alpha` | `glowAlpha` |
| `glow.size` | `glowMax` |
| `glow.speed` | `glowSpeed` |
| `ring.color` | `ringColor` |
| `ring.alpha` | `ringAlpha` |
| `ring.speed` | `ringSpeed` |
| `dots.color` | `dotColor` |
| `dots.speed` | `dotSpeed` |

Animation toggles (`glowEnabled`, `breathEnabled`, `ringEnabled`, `dotsEnabled`) are read from `orb.<key>.value`.

---

## orb.js mood persistence

`orb.js` stores `_moodData` internally. `applyPreset(preset, mood)` uses a `KEEP_MOOD` sentinel as default:

```js
const KEEP_MOOD = Symbol('keep');
function applyPreset(preset, mood = KEEP_MOOD) {
  if (mood !== KEEP_MOOD) _moodData = mood || null;
  ...
}
```

This means:
- `orb.applyPreset(preset)` — mood layer preserved (state transitions, heartbeat, etc.)
- `orb.applyPreset(preset, null)` — mood explicitly cleared
- `orb.applyPreset(preset, flat)` — mood set to new value

Without this, every presence state transition (idle → thinking → streaming → idle) would wipe the mood layer.

---

## TTS override

When a mood has `tts.enabled = true`, the TTS voice blend, speed, and pitch are replaced for the duration of that mood. No per-property granularity — complete override or nothing.

**Implementation:** `_ttsGetActiveVoices()` and `_ttsGetActiveSetting()` in `tts.js` check `config.active_mood` and `config.moods[moodName].tts.enabled` first. If enabled, mood TTS settings are used. If not, falls through to companion default from `cpSettings`. The `enabled` check is strict — `tts.enabled` must be explicitly `true`, not just truthy.

---

## Mood × Memory integration

**Encoding bias** — `mood_at_write` is stored on every memory note. When a mood is active, write probability is elevated for primitives that resonate with that mood.

**Retrieval bias** — associative retrieval boosts notes whose `mood_at_write` matches the current active mood and filters by `emotional_valence`.

---

## System prompt injection

```
<moods>
You have a set_mood tool. Call it to change your active mood.

Available moods:
- Neutral: default conversational state, no strong emotion
- Playful: playful, teasing, excited, joking around — light and warm energy
...

Current mood: Playful
Call set_mood with mood_name null to return to no mood.
</moods>
```

Only `in_rotation: true` moods appear. Injected by `buildSystemPrompt()` in `chat.js`. The wording deliberately leads with "You have a set_mood tool. Call it." to ensure she treats it as a real tool call, not a pseudo-instruction.

---

## Mood pill

Implemented. Small pill to the right of the orb inside `#orb-home`, bottom-aligned via flex.

**API:** `moodPill.update(moodName, dotColor, edgeColor)` | `moodPill.update(null)` to clear | `moodPill.setVisibility(mode)`

**Files:** `static/css/orb.css` (styles), `static/js/mood-pill.js` (IIFE module)

---

## set_mood tool

**File:** `tools/set_mood.py` — auto-discovered by `tool_loader.py` on server start.

**Schema registered in:** `static/js/tool-parser.js` → `TOOL_DEFINITIONS` array. All three parsers (inline, XML, Gemma4) use `TOOL_NAMES` derived from this array, so the tool is recognised in any call format.

**What it does:** writes `active_mood` to `companions/<folder>/config.json` via `save_companion_config()`. Validates mood name exists and is enabled. Returns confirmation string.

---

## Orb + pill update flow

`_applyMoodToOrb(moodName)` in `chat.js` is the single canonical update path. Called from:
1. `loadStatus()` — on page load, applies whatever `active_mood` is in config
2. `onToolCall()` — when `set_mood` completes (status === 'done'), instant update, no polling
3. `cpMoodSetActive()` in `companion-mood.js` — when user activates a mood in the panel

Passing `null` clears the mood layer on both orb and pill.

**No polling.** The old `_startMoodPoll()` approach was never implemented — the hook-based approach was built directly.

---

## Implementation order

1. ~~Audit Presence property completeness~~ — Done.
2. ~~Bump panel width to 720px~~ — Done. (`companion-panel.css`)
3. ~~Design mood pill~~ — Done.
4. ~~Implement mood pill~~ — Done. (`mood-pill.js`, `orb.css`, `chat.html`)
5. ~~Wire mood pill call sites~~ — Done. (`chat.js` loadStatus + `_applyMoodToOrb`)
6. ~~Build `companion-mood.js` + Mood tab HTML~~ — Done.
7. ~~Add `set_mood` tool~~ — Done. (`tools/set_mood.py`, `tool-parser.js`)
8. ~~Wire system prompt injection~~ — Done. (`chat.js` `buildSystemPrompt()`)
9. ~~Hook orb/pill update to tool call result~~ — Done. (`onToolCall` in `chat.js`)
10. ~~Write `_applyMoodToOrb()`~~ — Done. (`chat.js`)
11. ~~Fix orb mood layer being wiped by state transitions~~ — Done. (`orb.js` KEEP_MOOD sentinel)
12. ~~Fix TTS override ignoring enabled toggle~~ — Done. (`tts.js`)
13. ~~Wire `cpMoodSetActive()` to call `_applyMoodToOrb()`~~ — Done. (`companion-mood.js`)

---

## Pending / known issues

- **Orb reverts on companion settings save** — when the companion panel saves, something calls `applyPreset` or equivalent that resets the orb to presence-only. The KEEP_MOOD sentinel fixes state transitions but the save path bypasses it. Needs investigation in `companion.js` / `companion-presence.js` — find what's called on save and ensure it goes through `_applyMoodToOrb` or passes the current mood through to `applyPreset`. Next session priority.

---

## Future / noted items

- **Icon library for mood pill** — `pill_icon` field already in schema as `"dot"`. Future: user-assignable SVG icons per mood. Render-only change in `mood-pill.js`.
- **Animation on/off toggles** — expose as overrideable property in Mood (future Presence + Mood pass).
- **Mood × Memory** — `mood_at_write` encoding and retrieval bias not yet implemented.
