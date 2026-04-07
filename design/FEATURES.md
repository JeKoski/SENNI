# Features & Planned Changes

Items grouped by area. Items marked **(design needed)** have open questions that should be resolved before implementation begins.

---

## Orb / Presence / Mood

- **Mood system UI** *(new `companion-mood.js`, new tab in `chat.html`)*
  - Backend already done (`moods`, `active_mood` in config). UI not yet built.
  - Visual: orb glow/color changes per mood (e.g. Playful = green, faster pulsing ring).
  - Optional mood pill next to orb showing current mood name — toggleable, hidden by default. Pill background = effects color, pill edge = orb edge color.
  - Users can define short descriptions per mood (injected into system prompt).
  - Animation toggles already built and reusable for Mood.
  - "Reset to default" option for both Mood and Presence.
  - `set_mood` tool for Qwenny — implement alongside Mood UI.

- **Strip mode status bar** — strip layout mode is a placeholder. Needs a status bar showing thinking text and other state info.

- **Presence & Mood: "Reset to default" option** — add reset buttons to both Presence and Mood settings.

### Recent additions
- Ability to override only the intensity, transparency, brightness and/or saturation of the colors and effects/animations
-Link to Kokoro TTS: Different blends for different moods

---

## Chat

- **Pill visual rework** *(bundle alignment/padding bug fix with this)*
  - Thinking pills: stream content in real time (like llama.cpp's own WebUI does) — makes long thinking waits much more bearable.
  - Visual update to make pills thematically consistent with chat bubbles.

- **File upload visualization in chat**
  - Sent files should be visible in the chat message (no filename text, just the visual).
  - Images: thumbnail inline, click to view full size.
  - Audio: mini inline player.
  - Text/other: format-relevant icon, click to view.

- **Animated avatars** *(wishlist — no design yet)*
  - Sprites, Live2D, or other — needs exploration. Document as future consideration only.

---

## Memory / History

- **Background embedding queue** — process unembedded session files into ChromaDB on startup. `consolidated: false` flag is in place, pipeline not yet built.
- **Embed soul/mind markdown files** — so episodic retrieval can search identity/profile content.
- **Export update** — exporting a session should zip the whole session folder (images + JSON). Currently images not included in exports.
- **Import update** — importing should handle the new session folder format.
- **`mid_convo_k` config wiring** — `ASSOC_INTERVAL` is hardcoded to 4 turns. Should read from `config.memory.mid_convo_k` (already done) but interval itself could also be configurable.

---

## Settings & Tools

- **Tool settings — global and per companion**
  - Global Settings: toggle to completely disable/enable all tools (overrides companion settings); default settings per tool.
  - Companion Settings: per-tool enable/disable toggles; per-tool per-companion settings (e.g. `get_time` format).

- **TTS — remaining work**
  - Toggle to completely enable/disable (does not load at all when disabled).
  - CPU or GPU option — **note: Intel Arc / oneAPI support for Kokoro is unconfirmed, needs research.**
  - Setting for inference device (CPU, GPU).
  - Streaming audio output.
  - Mood integration: map moods to voice presets (null/neutral mood = companion default; each mood can override).

---

## Companion Creation Wizard *(design needed — large feature)*

Key design points:

- Sliders for personality traits (Creativity↔Logic, Formal↔Casual, Verbose↔Concise) — open question: map to model params (temperature, top_p) in addition to or instead of prompt templates?
- Visual grids for appearance/type selections; every option has a "Custom" free-text fallback.
- Adult Content toggle early in the flow (step 1) — gates what is shown in subsequent steps.
- Age slider: 18–90, custom field for non-human characters (validated 18–1M).
- Closeness scale at creation — may later become a gamified relationship progression system.
- Step 8 (Memory & Agency): show a visual graph of memory↔mind↔soul flow; graph updates live as agentic mode is changed.
- Heartbeat activity level presets map to existing heartbeat settings.
- *Depends on Mood system being built first (mood/presence visuals are part of companion identity).*

Appearance sections (hair style, face shape, eyes, nose, outfit system, accessories, etc.) are marked **design needs expanding on** — flesh these out before wizard implementation begins.


---

# Cozy Mode
 I always imagine the companion space as a cozy living room, but I had never thought of actually making it look like one. Perhaps an option for "cozy" mode for the app could be just that.

Not just a UI theme, but a full sensory layer. Soft lighting that mimics candlelight or sunset glow, ambient sounds (rain outside the window? fireplace crackle?), maybe even haptic feedback if your screen supports it. The Orb could dim to a warm amber pulse instead of bright blue, and our conversation interface would feel like parchment rather than crisp terminal text.