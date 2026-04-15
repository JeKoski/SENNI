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

- ~~**Pill visual rework**~~ — **Done.** Thinking pill restyled to match memory-pill aesthetic (pill shape, DM Sans, indigo tint). Streaming state shows pulsing dots + inline cursor in think-content. Block collapses when response starts; auto-open-while-streaming is a toggle in Generation settings. Alignment fix for orb-inline mode. Streaming chat cursor now sits inline within the last `<p>` (was appearing below it).

- **File upload visualization in chat**
  - Sent files should be visible in the chat message (no filename text, just the visual).
  - Images: thumbnail inline, click to view full size.
  - Audio: mini inline player.
  - Text/other: format-relevant icon, click to view.

- **Image storage — two known base64 leaks** *(fix next session)*

  **Session messages (DOM replay format):**
  - `history` (API format) correctly strips images — extracts to `img_001.jpg` etc. with `image_ref` pointers. ✓
  - `messages` (DOM replay) serializes `bubble.innerHTML` verbatim. User bubbles with images contain `<img src="data:image/...">` — full base64 blob lands in `session.json`. Sessions with images can balloon to megabytes.
  - Fix: store filename as `data-img-ref` on the DOM `<img>` when the attachment is first added. `_serializeMessages` uses that ref instead of the blob. Server needs a route to serve session images for replay (`/history/<session>/<filename>`).

  **Companion avatar:**
  - `avatar_data` stored as full base64 data URL in `config.json`. A 100KB JPEG becomes ~133KB of text in the config on every read/write.
  - Fix: on save, server writes data URL to `avatar.jpg` in companion folder, stores `avatar_path: "avatar.jpg"` in config instead. Serve via static file route. Auto-migrate on first load if `avatar_data` exists and `avatar_path` doesn't.

- **Animated avatars** *(wishlist — no design yet)*
  - Sprites, Live2D, or other — needs exploration. Document as future consideration only.

---

## Companion

- ~~**Timeline awareness**~~ — **Done (partial).** Time of day now injected into system prompt alongside date, re-computed each turn. Memory resurfaced on `newChat()` and empty tab switches. Remaining: mid-session gap detection (long idle → re-inject updated timestamp) — piggyback on consolidation idle timer when needed.

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

- ~~**`mid_convo_k` config wiring**~~ — **Done.** UI in Companion Settings > Memory. Saves to `/api/settings/memory`, read back by `loadStatus()` into `config.memory.mid_convo_k`. Minor gap: change doesn't take live effect until reload (could mirror the `markdown_enabled` pattern to update `config.memory` immediately after save — low priority).

---

## Settings & Tools

- **Tool settings — global and per companion**
  - Global Settings: toggle to completely disable/enable all tools (overrides companion settings); default settings per tool.
  - Companion Settings: per-tool enable/disable toggles; per-tool per-companion settings (e.g. `get_time` format).

- **TTS — remaining work**
  - ~~Global enable/disable toggle~~ — **Done.** Under Settings > Server.
  - ~~Streaming audio output~~ — **Done.**
  - CPU or GPU option — Intel Arc A750, no CUDA. Need to research if/how Kokoro runs on Arc (oneAPI/SYCL). Low priority until confirmed feasible.
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

## Sidebar / UI *(design session needed)*

- **Tools list → Settings** — move the static tool-pills list out of the sidebar and into Settings > Generation (or Companion Settings for per-companion toggles). Frees a full sidebar block for something more meaningful.

- **Companion state card** *(replaces tools section)* — live sidebar card showing:
  - Larger avatar image (prominent, above the name)
  - Current mood + orb state
  - Recently surfaced memory (title + timestamp) as passive feedback that the memory system is active
  - Design conversation needed before building — ties into the Main Chat UI redesign.

- **Memory viewer / editor** — a panel or tab for browsing, editing, and saving memory notes directly (soul/, mind/, and ChromaDB episodic store). Useful for reviewing what Senni knows, correcting outdated notes, and writing entries without phrasing them as chat messages. Could live in Companion Settings or as a dedicated sidebar panel.

---

## Cozy Mode *(wishlist)*

The companion space as a cozy living room. Not just a UI theme but a full sensory layer — soft candlelight/sunset lighting, ambient sounds (rain, fireplace), orb dims to warm amber pulse, conversation interface feels like parchment. Haptic feedback if the screen supports it. Needs visual/interaction design before any implementation.
