# Orb Design Decisions

## Agreed visual design

The orb is Qwenny's persistent presence indicator in the chat.

### Positioning
- The orb lives at the **bottom of the message area** permanently — it has a fixed home there
- When Qwenny sends a message, the message appears **above** the orb (messages flow upward, orb stays put)
- This means no moving, no attaching to rows — the orb just sits at the bottom and messages stack above it
- This also means presence effects are always visible and testable, even before any messages are sent

### Orb and bubble relationship (for when we do attach to messages later if needed)
- The orb's **top-right corner** touches the bubble's **bottom-left corner** exactly
- The orb expands **left and down** only — the bubble never moves
- The overlap amount is tunable via `--orb-overlap-x` and `--orb-overlap-y` in `:root`
- Timestamp sits below the whole group, aligned to the bubble's left edge (not the orb)

### Avatar
- The orb shows the companion's avatar image (set in Companion settings)
- Falls back to ✦ if no avatar is set

### Size
- Default 36px, driven by the active presence preset's `orbSize` value
- Grows outward (left and down), never into the bubble

---

## States

States are set by JS and drive CSS via custom properties on the orb element.

| State | When | Visual |
|-------|------|--------|
| `idle` | Qwenny is done, waiting | Fully visible, calm, dots barely there, no animation |
| `thinking` | Processing, before any text | Dots bounce, body glows and breathes, ring pulses |
| `streaming` | Text is arriving | Turns green, dots stream, ring pulses |
| `heartbeat` | Heartbeat trigger firing | Purple tint, faster pulse |
| `chaos` | Chaos mode | Amber/gold, fast chaotic animation |

All animation speeds, colors, glow amounts etc. are CSS custom properties set from the active Presence preset.

---

## Mood system (backend done, UI pending)

Moods are a **separate layer on top of states**. They override some or all visual properties.

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

Moods only define the properties they want to **override** — anything not specified falls through to the preset.

### Mood description field
Each mood has a short user-written description like "use this when feeling playful or excited". This gets included in Qwenny's system prompt so she knows when to use it.

### How Qwenny sets a mood
Via a `set_mood` tool call (not yet implemented). Sets `active_mood` in companion config. UI picks it up on next status poll.

### User can configure moods
In the Presence tab, a new Moods section (below the existing States editor) with the same slider/colour editor interface.

---

## Thinking pill

While Qwenny is thinking (before any text arrives), a pill appears:
- Same position as where a message bubble would be
- Shows "thinking" text with animated dots
- The orb shows in `thinking` state next to it
- Pill disappears when text starts streaming in

Visual: `[ ORB ] [ thinking • • • ]`

---

## What's working vs pending

| Thing | Status |
|-------|--------|
| Orb element exists in HTML | ✓ |
| Orb CSS states (idle/thinking/streaming/heartbeat/chaos) | ✓ |
| Presence presets save and load | ✓ |
| Mood backend (config, API) | ✓ |
| Orb fixed home at bottom of message area | ❌ next session |
| Presence preset values applying to live orb | ❌ next session |
| Mood UI in Presence tab | ❌ future session |
| `set_mood` tool | ❌ future session |
| Orb shows avatar | ❌ next session |
