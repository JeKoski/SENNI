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
- Link to Kokoro TTS: Different blends for different moods

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

## Companion

- **Timeline awareness**
  - The companion should be better attuned to the passage of time — not just aware of the current date, but sensitive to how much time has passed since the last message or session.
  - `get_time` should be called as a direct system instruction at session start, and again if a significant gap since the previous message is detected (e.g. after a long idle). Currently it relies on the companion choosing to call it herself, which is unreliable.
  - Implementation note: session-start instruction could inject the current timestamp automatically rather than requiring a tool call. Mid-session gap detection could piggyback on the idle timer already used for consolidation.

- **Companion Templates rework** *(design needed)*
  - Current templates (soul files, user profile, etc.) were designed before the ChromaDB memory system existed and may clash with or duplicate what the system now manages automatically.
  - Goals: ensure templates don't overlap with auto-managed content; future-proof for Companion Creation Wizard and Mood system; keep token totals reasonable (balance context efficiency vs detail).
  - Needs a design conversation to map out what each template should and shouldn't contain before any files are touched. Reference Wizard and Mood docs when designing.

---

## Memory / History

- ~~**Background embedding queue**~~ — **Done.** Session history ingested into ChromaDB on startup via `_process_unconsolidated_sessions()`. `consolidated: false` flag in session files drives processing.
- ~~**Embed soul/mind markdown files**~~ — **Done.** Mind files indexed into ChromaDB via `_index_mind_files()`, hash-tracked for change detection.
- **Image handling in history** *(partially implemented)*
  - Images are already stripped from `history` (API format) before saving to disk and written as separate files (`img_001.jpg` etc.) in the session folder, with `{type: "image_ref", path: "..."}` references in the JSON. This prevents base64 bloat in session files. ✓
  - **Remaining open question:** when a session is reloaded and the model needs to "see" a past image (e.g. for follow-up questions), how should the image_ref be handled? Options:
    - Re-encode the file from disk as base64 on load (simplest, transparent to model)
    - Store a compressed text description of the image alongside the file (generated at send-time via a vision pass), and substitute the description into history on load for models that don't need the raw pixels again
    - Do nothing — vision_mode `once` already handles "don't re-send" for the current session; across sessions the image is effectively gone from context, which may be acceptable
  - **Export update** — exporting a session should zip the whole session folder (images + JSON). Currently images not included in exports.
  - **Import update** — importing should handle the new session folder format.

- **`mid_convo_k` config wiring** — `ASSOC_INTERVAL` reads from `config.memory.mid_convo_k` (done). The interval itself could also be exposed as a configurable setting in the UI.

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

## Cozy Mode *(wishlist)*

The companion space as a cozy living room. Not just a UI theme but a full sensory layer — soft candlelight/sunset lighting, ambient sounds (rain, fireplace), orb dims to warm amber pulse, conversation interface feels like parchment. Haptic feedback if the screen supports it. Needs visual/interaction design before any implementation.
