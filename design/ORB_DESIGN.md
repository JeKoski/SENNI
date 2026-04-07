# Orb Design Decisions

## Current implementation

The orb is Qwenny's persistent presence indicator in the chat.

### Positioning
- `#orb-home` is `position: absolute; bottom: 0; left: 0` inside `.messages-wrap`
- The orb never moves — it is always visible at the bottom-left of the message area
- `#messages` has `padding-bottom: 80px` so the last message is never hidden behind the orb
- `#orb-home` is `pointer-events: none` so it never blocks scrolling or clicks — `#companion-orb` and `#scroll-to-bottom` opt back in individually

### Layout modes

**Inline mode** (default):
```
[older companion message         ]
[older companion message         ]
[                    user message]
(ORB) [latest companion message  ]  ← all companion bubbles indented
```
All companion `.msg-row` elements get `padding-left: var(--orb-indent)`. The indent is derived from `--orb-size` so resizing the orb through a preset keeps the alignment locked automatically.

**Strip mode** (placeholder for future status bar):
```
[messages scroll freely          ]
(ORB)                               ← orb only, no indent
```
Reserved for a future "status bar" feature — thinking text, status indicators, etc. Toggled in Companion Settings → Presence.

### Avatar
- The orb shows the companion's avatar image (set in Companion settings)
- Falls back to ✦ if no avatar is set
- `orb.syncAvatar()` reads from the sidebar avatar element

### Size
- Default 36px (visual), driven by `--orb-size` on `:root`
- When a presence preset changes `orbSize`, `orb.js` updates both the orb element style and `:root` so `--orb-indent` tracks automatically

---

## States

States are set by `orb.setState(state)` and drive CSS via custom properties.

| State | When | Visual |
|-------|------|--------|
| `idle` | Qwenny is done, waiting | Slow gentle glow and breath, dots barely visible |
| `thinking` | Processing, before any text | Dots bounce, body glows and breathes, ring pulses |
| `streaming` | Text is arriving | Turns green, dots stream, ring pulses |
| `heartbeat` | Heartbeat trigger firing | Purple tint, faster pulse |
| `chaos` | Chaos mode | Amber/gold, fast chaotic animation |

Each state transition automatically looks up the correct slice from the active presence preset and applies those CSS vars. So switching from `thinking` to `streaming` also switches the glow colour, speed, etc. to the streaming preset values.

---

## orb.js public API

| Method | Purpose |
|--------|---------|
| `orb.init()` | Call on DOMContentLoaded — sets saved mode, idle state, syncs avatar, attaches scroll listener |
| `orb.setState(state)` | Sets visual state + applies correct preset slice for that state |
| `orb.applyPreset(preset, mood?)` | Stores full nested preset and re-applies current state. Also accepts legacy flat format. |
| `orb.syncAvatar()` | Reads sidebar avatar and applies to orb icon. Falls back to ✦. |
| `orb.setMode(mode)` | Switches layout mode (`inline`/`strip`), persists to localStorage |

---

## CSS variables (on `#companion-orb`)

| Variable | Controls |
|----------|---------|
| `--orb-size` | Width/height of the orb body |
| `--glow-color` | Colour of the glow shadow |
| `--glow-min` / `--glow-max` | Glow pulse range in px |
| `--glow-speed` | Glow animation duration |
| `--ring-color` | Ring pulse colour |
| `--ring-speed` | Ring animation duration |
| `--dot-color` | The three dots colour |
| `--dot-speed` | Dot animation duration |
| `--dot-opacity` | Peak dot opacity |
| `--breath-speed` | Body scale breath animation duration |
| `--orb-bg` | Body background |
| `--orb-border` | Body border colour |

CSS variables on `:root` (shared with layout system):
- `--orb-size` — kept in sync by `orb.js` when preset changes
- `--orb-gap` — gap between orb and bubbles
- `--orb-indent` — `calc(--orb-size + --orb-gap + 16px)` — applied to companion bubble `padding-left`

---

## Presence preset system

Presets are stored as nested per-state dicts in companion config:

```json
"presence_presets": {
  "Default": {
    "thinking":  { "glowColor": "rgba(129,140,248,0.4)", "glowMax": 16, "glowSpeed": 2.0, ... },
    "streaming": { "glowColor": "rgba(109,212,168,0.35)", ... },
    "idle":      { "glowColor": "rgba(129,140,248,0.15)", "glowMax": 6, ... }
  },
  "Warm": { ... }
}
```

`orb.applyPreset(preset)` stores the full nested preset object. On every `setState()` call, `orb.js` looks up `preset[state]` and applies those CSS vars on top of the base CSS defaults. This means changing the active preset instantly affects all future state transitions.

The active preset name is stored as `active_presence_preset` in companion config and loaded on startup.

---

## Mood system (backend done, UI pending)

Moods are a separate layer on top of states. They override some or all visual properties for the duration the mood is active, regardless of which state the orb is in.

### How blending works
```
final appearance = base state CSS defaults
                 + active presence preset overrides for this state
                 + active mood overrides  ← wins everything
```

### Mood data structure
```json
"moods": {
  "playful": {
    "dotColor": "#6dd4a8",
    "glowColor": "rgba(109,212,168,0.4)",
    "glowSpeed": 0.9,
    "dotSpeed": 0.7
  },
  "annoyed": {
    "dotColor": "#f87171",
    "glowColor": "rgba(248,113,113,0.35)",
    "glowSpeed": 3.5
  }
}
```

Moods only define the properties they want to override — anything not specified falls through to the preset.

### Mood description field
Each mood has a short user-written description like "use this when feeling playful or excited". This gets included in Qwenny's system prompt so she knows when to trigger it.

### How Qwenny sets a mood
Via a `set_mood` tool call (not yet implemented). Sets `active_mood` in companion config. UI picks it up on next status poll.

### User can configure moods
In the Presence tab, a new Moods section (below the existing States editor) with the same slider/colour editor interface. **Not yet built.**

### Fine tuning
Ability to override only the intensity, transparency, brightness and/or saturation of the colors and effects/animations

### Link to Kokoro TTS
Different blends for different moods

---

## Scroll behaviour

`orb.init()` attaches a scroll listener on `#messages`:
- When user scrolls more than 40px from the bottom: `body.chat-scrolled-up` is added
- `#scroll-to-bottom` button appears (sits in `#orb-home`, bottom-right of the orb area)
- Clicking it calls `scrollToBottom()` which snaps back to bottom and removes the class

---

## What's working vs pending

| Thing | Status |
|-------|--------|
| Orb module (`orb.js`) | ✓ |
| Orb fixed home (absolute overlay, bottom-left) | ✓ |
| Orb CSS states (idle/thinking/streaming/heartbeat/chaos) | ✓ |
| Idle state slow glow animation | ✓ |
| Ring pulse animation | ✓ |
| Presence presets fully apply to live orb (all states) | ✓ |
| Presence presets save and load | ✓ |
| Orb shows companion avatar | ✓ |
| Layout toggle in Presence tab | ✓ |
| Inline mode (companion bubbles indented) | ✓ |
| Scroll-to-bottom button | ✓ |
| Mood backend (config fields, API endpoints) | ✓ |
| Strip mode status bar UI | ❌ future session |
| Mood UI in Presence tab | ❌ future session |
| `set_mood` tool for Qwenny | ❌ future session |
