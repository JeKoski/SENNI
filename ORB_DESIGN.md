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
Reserved for a future "status bar" feature — thinking text, status indicators, etc. toggled in Companion Settings → Presence.

### Avatar
- The orb shows the companion's avatar image (set in Companion settings)
- Falls back to ✦ if no avatar is set
- `orb.syncAvatar()` reads from the sidebar avatar element

### Size
- Default 36px, driven by `--orb-size` on `:root`
- When a presence preset changes `orbSize`, `orb.js` updates both the orb element and `:root` so `--orb-indent` tracks automatically

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

Each state transition automatically looks up the correct slice from the active presence preset and applies those CSS vars. So switching from `thinking` to `streaming` also switches the glow colour, speed etc. to the streaming preset values.

---

## Presence preset system

Presets are stored as nested per-state dicts:
```json
{
  "Default": {
    "thinking":  { "glowColor": "rgba(129,140,248,0.4)", "glowMax": 16, ... },
    "streaming": { "glowColor": "rgba(109,212,168,0.35)", ... },
    "idle":      { "glowColor": "rgba(129,140,248,0.15)", "glowMax": 6, ... }
  }
}
```

`orb.applyPreset(preset)` stores the full nested preset. On every `setState()` call, `orb.js` looks up `preset[state]` and applies those CSS vars on top of the base CSS defaults. Mood overrides (when implemented) will win over preset values.

---

## Mood system (backend done, UI pending)

Moods are a separate layer on top of states. They override some or all visual properties.

### How blending works
```
final appearance = base state CSS defaults
                 + active presence preset overrides
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
Each mood has a short user-written description like "use this when feeling playful or excited". This gets included in Qwenny's system prompt so she knows when to use it.

### How Qwenny sets a mood
Via a `set_mood` tool call (not yet implemented). Sets `active_mood` in companion config. UI picks it up on next status poll.

### User can configure moods
In the Presence tab, a new Moods section (below the existing States editor) with the same slider/colour editor interface. **Not yet built.**

---

## Scroll behaviour

`orb.init()` attaches a scroll listener on `#messages`:
- When user scrolls more than 40px from the bottom: `body.chat-scrolled-up` is added
- `#scroll-to-bottom` button appears (fixed position, bottom-right)
- Clicking it calls `scrollToBottom()` which snaps back to bottom and removes the class

---

## What's working vs pending

| Thing | Status |
|-------|--------|
| Orb module (`orb.js`) | ✓ |
| Orb fixed home (absolute overlay) | ✓ |
| Orb CSS states (idle/thinking/streaming/heartbeat/chaos) | ✓ |
| Idle state has glow animation (slow) | ✓ |
| Ring animation visible | ✓ |
| Presence presets fully apply to live orb (all states) | ✓ |
| Presence presets save and load | ✓ |
| Orb shows avatar | ✓ |
| Layout toggle in Presence tab | ✓ |
| Inline mode (companion bubbles indented) | ✓ |
| Scroll-to-bottom button | ✓ |
| Mood backend (config, API) | ✓ |
| Strip mode status bar UI | ❌ future session |
| Mood UI in Presence tab | ❌ future session |
| `set_mood` tool | ❌ future session |
