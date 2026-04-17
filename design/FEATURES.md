# Features & Planned Changes

Items grouped by area. Items marked **(design needed)** have open questions that should be resolved before implementation begins.

---

## Orb / Presence / Mood

- **Mood system UI** *(new `companion-mood.js`, new tab in `chat.html`)*
  - ~~Visual~~: orb glow/color changes per mood (e.g. Playful = green, faster pulsing ring).
  - ~~Optional mood pill~~ next to orb showing current mood name — toggleable, hidden by default. Pill background = effects color, pill edge = orb edge color.
  - ~~Users can define short descriptions per mood~~ (injected into system prompt).
  - ~~Animation toggles~~.
  - "Reset to default" option for both Mood and Presence.
  - ~~`set_mood` tool.~~

- **Strip mode status bar** — strip layout mode is a placeholder. Needs a status bar showing thinking text and other state info. (Retire idea if side bar redesign implements all this?)

- **Presence & Mood: "Reset to default" option** — add reset buttons to both Presence and Mood settings. Reset all & Reset A Preset

### Recent additions
- Ability to override only the intensity, transparency, brightness and/or saturation of the colors and effects/animations
- Link to Kokoro TTS: Different blends for different moods

---

## Chat

- ~~**Pill visual rework**~~ — **Done.** Thinking pill restyled to match memory-pill aesthetic (pill shape, DM Sans, indigo tint). Streaming state shows pulsing dots + inline cursor in think-content. Block collapses when response starts; auto-open-while-streaming is a toggle in Generation settings. Alignment fix for orb-inline mode. Streaming chat cursor now sits inline within the last `<p>` (was appearing below it).

- **File upload visualization in chat** *(partially done)*
  - Images: thumbnail inline ✓ (`.msg-img`, `data-img-ref` safe serialization). Click to view full size — **pending**.
  - Audio: mini inline player — ✓. (Needs details)
  - Text/other: format-relevant icon — ✓. (Needs details)

- ~~**Image storage — two base64 leaks**~~ — **Done.**

  **Session messages:** User bubbles with images now use `<img class="msg-img" data-img-ref="img_001.jpg">`. `_serializeMessages` clones the bubble and replaces any `data:` src with the proper `/api/history/media/` URL before storing in `session.json`. Server media route already existed.

  **Companion avatar:** `avatar_data` (base64 in config.json) replaced by `avatar_path` + file on disk. Server writes `avatar.jpg` on save, serves via `GET /api/companion/{folder}/avatar`. Auto-migration runs on page load for any companion still using the old format. `config.py` helpers: `write_avatar_file`, `delete_avatar_files`, `migrate_avatar`.

- ~~**Separate sidebar and orb avatars**~~ — **Done.** `avatar_path` (orb) and `sidebar_avatar_path` (sidebar) are separate config fields. Server serves both via `GET /api/companion/{folder}/avatar?slot=orb|sidebar`; sidebar falls back to orb if no sidebar-specific file. `chat.js` sets sidebar and orb independently. `orb.setAvatar(src)` added to orb.js public API so orb avatar can be set without syncing from the sidebar element.

- ~~**Avatar crop tool — portrait mode**~~ — **Done.** New `companion-avatar.js` module: canvas-based crop modal with orb (circle overlay) and sidebar (3:4 portrait overlay) modes. Drag to pan, scroll/pinch/button zoom. Per-mode independent pan+zoom state. Apply per slot, both show ✓ when set. No external library. CSS handles visual clipping — output is always a plain JPEG rectangle.

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
  - **History folder cleanup / pruning** — voice recordings are stored as uncompressed WAV files (`aud_001.wav` etc.) alongside images in session folders. Heavy voice use will bloat history folders significantly. Need a pruning strategy: auto-delete media files for sessions older than N days, or a manual "clean up old sessions" UI action. No design yet.

- ~~**`mid_convo_k` config wiring**~~ — **Done.** UI in Companion Settings > Memory. Saves to `/api/settings/memory`, read back by `loadStatus()` into `config.memory.mid_convo_k`. Minor gap: change doesn't take live effect until reload (could mirror the `markdown_enabled` pattern to update `config.memory` immediately after save — low priority).

---

## Settings & Tools

- **Tool settings — global and per companion**
  - Global Settings: toggle to completely disable/enable all tools (overrides companion settings); default settings per tool.
  - Companion Settings: per-tool enable/disable toggles; per-tool per-companion settings (e.g. `get_time` format).

- **TTS — remaining work**
  - ~~Global enable/disable toggle~~ — **Done.** Under Settings > Server.
  - ~~Streaming audio output~~ — **Done.**
  - CPU or GPU option — switching to RTX 5060 Ti (CUDA) soon; CUDA Kokoro should work out of the box and be near-instant.
  - ~~Mood integration: map moods to voice presets (null/neutral mood = companion default; each mood can override).~~

---

## Companion Creation Wizard *(feature-complete MVP — see design/WIZARD.md and BACKLOG.md)*

**Status:** Fully functional. Steps 1–9 complete, compile pipeline working, PNG character card export, V2 card import. Served at `/companion-wizard`.

**What's built:** Type selection, appearance sub-steps (Foundation/Body/Face/Hair/Details) with gendered silhouettes, Outfit, Personality, Closeness, Adult, You, Memory & Growth, Review/compile. Import zone (drag PNG or JSON). Compile animation + launch. `scripts/wizard_compile.py` writes config + soul files + birth certificate + PNG card.

**Pending:** See BACKLOG.md → Wizard Backlog section.

---

## Sidebar / UI *(design session needed)*

- **Tools list → Settings** — move the static tool-pills list out of the sidebar and into Settings > Tools (Later on also Companion Settings>Tools for per-companion toggles). Frees a full sidebar block for something more meaningful.

- **Companion state card** *(replaces tools section)* — live sidebar card showing:
  - Larger avatar image (prominent, above the name)
  - Current mood + orb state
  - Recently surfaced memory (title + timestamp) as passive feedback that the memory system is active
  - Design conversation needed before building — ties into the Main Chat UI redesign.

- Buttons (restart server, settings etc.) into pill shape with (icon Name)

- **Memory viewer / editor** — a panel or tab for browsing, editing, creating, and deleting memory notes directly. Scope:
  - **soul/ and mind/ markdown files** — read/edit/save via the existing `memory` tool backend
  - **ChromaDB episodic notes** — list, read, edit content, delete individual entries
  - **Duplicate detection + cleanup** — `POST /api/memory/dedup` endpoint already exists (exact-content dedup, used for session-id bug cleanup). UI should expose this as a button. Future: embedding-similarity pass for near-duplicates with human review.
  - **Note breakdown by source** — `status` endpoint currently returns total count only. Add breakdown: how many are companion-written (`function_source` = T/S/N/F) vs system-ingested (`session_history`). Useful for understanding memory composition.
  - **Note health indicators** — surfaced count, last retrieved, superseded status
  - Could live in Companion Settings as a dedicated Memory tab, or as a sidebar panel. Needs design conversation before building.

---

## Cozy Mode *(wishlist)*

The companion space as a cozy living room. Not just a UI theme but a full sensory layer — soft candlelight/sunset lighting, ambient sounds (rain, fireplace), orb dims to warm amber pulse, conversation interface feels like parchment. Haptic feedback if the screen supports it. Needs visual/interaction design before any implementation.
