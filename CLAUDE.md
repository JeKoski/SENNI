# CLAUDE.md — Instructions for Claude

This file is for Claude to read at the start of every session.
Search for it using project knowledge before doing anything else.

---

## Session Flow
1. Start session with CLAUDE.md
2. We'll figure out what we're doing this session. Often listed on this doc and/or design/FEATURES.
3. Surgical work happens (Claude reads files directly — no uploads needed)

---

## Critical working rules

- **Modular Architecture:** We should work towards making everything modular - within reason - while creating new code and also noting down possible refactors when going over old code. Adding, editing or replacing small or large components shouldn't require edits across multiple files. Creating separate helper scripts when functionality repeats will help with consistency and bug fixing.
- **Simplicity and efficiency** — are to be prioritized when it makes sense. Overengineering is to be avoided.
- **Prefer surgical edits** — use targeted find-and-replace edits for most changes. Full file rewrites are fine for large refactors where most of the file is changing. The old "complete files only" rule was a Web UI workaround — Claude Code applies edits directly, so partial edits are no longer a problem.
- **One file at a time** where possible. Flag upfront if a feature will require touching multiple files and get agreement before proceeding.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won't work. Automate it or build it into existing flows instead.
- **Suggest Extended Thinking** and/or Opus when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **End every session by updating CLAUDE.md and any relevant design docs.** This is non-negotiable — it's what makes the next session productive.

---

## Project overview

SENNI is a local AI companion framework. Currently running with Gemma 4 E4B Q4_K_M, Intel Arc GPU. Previously Qwen3.5 9B Q4_K_M.

Two servers:
- **Python bridge** (`scripts/server.py`) — FastAPI, handles UI, tools, config. Needs terminal restart for changes.
- **llama-server** — the model itself. Can be restarted in-app.

Runs on Linux (primary dev) and Windows (also tested and supported). Currently mostly running on Windows while still on old PC.

---

## Backups

Before touching any file, the UI runs an auto-backup of all companion configs and key scripts.
Saved to `backups/YYYY-MM-DD_HHMMSS/`.
The `backups/` folder is in `.gitignore`.

If something breaks, copy files from the latest backup folder.

---

## Companion config

Companion config lives in `companions/<folder>/config.json`.
Global config in `config.json` at project root.

Key companion config fields:
- `avatar_path` — orb avatar filename (e.g. `"avatar.jpg"`), relative to companion folder
- `sidebar_avatar_path` — sidebar portrait avatar filename (e.g. `"sidebar_avatar.jpg"`). Falls back to `avatar_path` if not set.
- `presence_presets` — dict of preset name → per-state dict `{ thinking:{...}, idle:{...}, ... }`
- `active_presence_preset` — which preset is active
- `moods` — dict of mood name → mood definition (see `design/MOOD.md` for full schema)
- `active_mood` — currently active mood name or null
- `mood_pill_visibility` — `"always"` | `"fade"` | `"hide"`
- `cognitive_stack` — four-slot stack string e.g. `mT-fS-mN-fF`
- `last_consolidated_at` — timestamp for crash-recovery consolidation

Key global config fields:
- `memory.enabled` — master switch for the ChromaDB memory system (default: `True`)
- `memory.mid_convo_k` — how many notes the associative trigger surfaces (default: `4`)
- `memory.session_start_k` — how many notes to surface at session start (default: `6`)

### Presence preset config values — important
Presence presets store **real CSS values**: seconds for speeds, pixels for sizes, 0.0–1.0 floats for alpha. The 0–100 slider scale in the UI is a display-layer conversion only. `orb.js` always receives and applies real CSS values directly — do not change this. Same applies to mood config values.

### Tool distinction (important for system prompt clarity)
- `memory` tool → soul/ and mind/ **markdown file** read/write
- `write_memory` / `retrieve_memory` / `supersede_memory` / `update_relational_state` → **ChromaDB** episodic store only
- `set_mood` → writes `active_mood` to companion config; orb + pill update via tool call hook (see MOOD.md)

### Zep-style temporal chaining
When a fact changes, the companion calls `supersede_memory` with the old note's ID. The old note is marked `superseded_by` and excluded from future retrieval. The new note carries a `supersedes` back-reference.

---

## Companion portability

Copying a companion folder between installs:
- **Safe to copy:** `soul/`, `mind/`, `config.json` — fully portable
- **Do NOT copy:** `memory_store/` (ChromaDB, path-dependent and binary), `memory_meta.json` (install-specific consolidation state)
- A proper export/import feature is needed eventually — tracked in `design/FEATURES.md`.

---

## Bugs

Bugs are grouped by area. Where a fix should be bundled with a feature, that is noted.

### Orb / Presence

- ~~**Orb edge color not applying from presence preset**~~ — **Fixed**
- ~~**Heartbeat state uses idle values**~~ — **Fixed**
- ~~**Orb reverts on companion settings save**~~ — **Fixed**. `cpSave()` in `companion.js` now reapplies active mood after applying presence preset.
- ~~**Presence settings changes don't apply live**~~ — **Fixed.** `cpSave()` now updates `config.presence_presets` and `config.active_presence_preset` before calling `_applyMoodToOrb`, so it reads fresh values instead of overwriting the orb with stale page-load data.
- ~~**Message controls misaligned in orb-inline mode**~~ — **Fixed.** Added `body.orb-inline .msg-row.companion .msg-controls { left: calc(var(--orb-indent) + 8px) }` in `orb.css`.
- ~~**Memory/heartbeat pills not indented in orb-inline mode**~~ — **Fixed.** Added `.memory-pill` and `.heartbeat-pill` to the existing `margin-left: var(--orb-indent)` rule in `orb.css`.

### Chat

- ~~**Streaming text visual (token-by-token appearance) regressed**~~ — **Fixed.** Cursor was being inserted after `</p>` (block element), making it appear below the text. Now inserted inside the last `<p>`. Also added inline cursor to streaming thinking content.
- ~~**Message loss on restart/refresh suspected**~~ — **Closed.** Not seen in days outside of dev/hacky flows. History system rework resolved it.

### llama-server / model

- **llama-server version drift** — server.py launch args may have drifted from current llama.cpp API. Needs a pass against current llama.cpp.

### Memory

- ~~**Link eval parse error — 0 links ever confirmed**~~ — **Fixed**
- ~~**Associative retrieval never firing**~~ — **Fixed**
- ~~**Memory system silently disabled**~~ — **Fixed**

### UI / Layout

- ~~**Tool and thinking pills have alignment/padding issues**~~ — **Fixed** as part of pill visual rework (see session notes 2026-04-15).
- ~~**Ghost bar appearing below tabs in companion settings**~~ — **Closed.** Not seen in a while; superseded by the tab highlight bug (now fixed).
- ~~**Companion Settings: saving without visiting a tab resets that tab's data**~~ — **Fixed.** `cpSave()` now guards Moods, Memory, and Presence payloads behind their `_initDone` flags, mirroring the pattern TTS already used. Tabs that were never opened this session are simply omitted from the save body.
- ~~**Companion Settings: active tab highlight broken on Presence tab**~~ — **Fixed.** Presence tab had an inline `style="color:..."` which overrode the `.active` CSS color. Moved to a `.cp-tab-special` CSS class declared before `.cp-tab.active` so active state always wins.
- ~~**Settings & Companion Settings: panel height jumps between tabs**~~ — **Fixed.** Changed both panels from `max-height` to `height`. Tab content area has `flex: 1; overflow-y: auto` so it fills the fixed-height space and scrolls as needed.

---

## Environment

- OS: Linux (primary) + Windows (also supported and tested)
- GPU: Intel Arc A750
- Models tested: Gemma 4 (primary), Qwen3.5 9B Q4_K_M
- llama-server: SYCL build on Windows, oneAPI build on Linux
- Temperature: 0.8 (critical for Qwen — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled (Qwen3 only — disable for Gemma 4)
- Flash attention: auto-enabled by llama-server

---

## Known model quirks

**Qwen3.5 9B tool calls in thinking blocks** — confirmed llama.cpp bug (issue #20837): Qwen3.5 9B often prints tool calls in XML inside thinking blocks when thinking is enabled. Not a SENNI bug. Memory write discipline should be robust to unreliable self-initiation — associative pathway is system-driven, masculine self-retrieval has auto-trigger fallback.

**Gemma 4 tool call format** — Gemma 4 uses XML-style tool calls (`<tool_call><function=name>...`) via its jinja template, not SENNI's custom XML examples. System prompt must NOT include XML tool call examples for Gemma 4 — the jinja template handles it, and showing examples causes it to write XML instead of its native format. Handled via `modelFamily` detection in `chat.js`.

---

## Documentation convention

- **CLAUDE.md** — operational instructions + active bugs + design folder index. Update at end of every session.
- **design/*.md** — system docs and design decisions. Update when the relevant system is touched.
- Rule: when we touch a system in a session, we document it in that session. Don't defer.

---

## Session notes — 2026-04-17 #2

**Wizard — Steps 3–8, polish pass, compile sequence, file rename.**

### File rename

`static/wizard.html` → `static/companion-wizard.html` (old name conflicted with the setup wizard). Route updated in `server.py`: `/wizard` → `/companion-wizard`. The setup wizard (`wizard.html`) was restored from backup.

### Slider polish

- Split `oninput` (live label display) / `onchange` (data write + portrait update) on all sliders — eliminates portrait fade flicker during drag.
- All sliders now have a unified component structure: `.slider-ends` → left label / `.slider-val-group` (val + ↺ reset) / right label. Driven by `SLIDER_CFG` — add an entry to get display/reset/commit for free.
- Body sliders renamed to be gender-neutral: "Slender ↔ Broad" and "Soft ↔ Muscular". Label arrays updated: `CURVY_LABELS = ['Slender','Lean','Balanced','Full','Broad']`, `ATHLETIC_LABELS = ['Soft','Relaxed','Balanced','Toned','Muscular']`.
- Body type description in portrait now uses the same label arrays (consistent with slider display). "Balanced" skipped in prose.
- Age / height / body sliders: no auto-defaults — values undefined until explicitly touched. Reset button (↺) appears once touched.
- Portrait fade: 0.6s CSS transition, content swaps at 400ms.

### Transitions

- Step/sub-step exit animation: `_fadeOutThen()` fades active panels before switching. Root cause of previous "instant blink": CSS animation `forwards` fill holds `opacity:1` at animation layer (above inline styles). Fix: set `animation: none` inline before fading, force reflow, then fade.
- Entrance: `stepIn` 0.85s / sub-panel 0.7s, Y travel 28px.

### Chip handler refactor

`_initChipGrids(root)` replaces the old single-select-only handler. Supports:
- `data-single="true"` — single select, stores string
- `data-array="true"` — multi-select, stores array
- `data-target="outfit|personality|closeness|adult|user|memory"` — routes writes to the right `_data` sub-object (defaults to `appearance`)

Call `_initChipGrids(el)` on any subtree (used for dynamically-built step 6 adult content).

### Steps 3–8

All six remaining steps built in `companion-wizard.html`:
- **3 Outfit** — Style (single), Accessories (multi), Signature item (text)
- **4 Personality** — Name (required, Lora input, gates Continue), Traits (multi), Communication style, Occupation, Background textarea
- **5 Closeness** — Relationship type (multi), Starting closeness slider with live prose (6 flavor lines, animates only on label change — no flicker)
- **6 Adult** — Gated by Step 1 toggle. Renders locked message if off, builds Role/Initiation/Intensity/Interests lazily on first visit when on. Bug fixed: `el.dataset.built` was not reset when rendering locked state → content never rebuilt after re-enabling. Fixed by clearing `built` before the locked render.
- **7 You** — Your name, About you, Interests (multi), Occupation
- **8 Memory** — Persistent memory toggle (on default) + Memory Depth chips (Light/Balanced/Deep), Heartbeat toggle + Frequency chips (Rarely/Sometimes/Often/Inspired), First things to know textarea

Additional details textarea added to: 2b Body, 2c Face, 2e Details, Adult step.

Continue button text on step 8: "Bring [Name] to life →" (personalised with entered name).

### Compile sequence

`wizFinish()` triggers a full-screen overlay (`#compile-overlay`):
- Companion's species orb centered, pulsing
- 4 italic Lora lines stagger in (~1.4s apart): "Binding [Name] to this vessel…" → "Weaving [Name]'s essence into memory…" → "Etching the first words into soul…" → "[Name] is awakening…"
- Final state fades in: "[Name] is ready." + "Open companion →" placeholder button
- `wizOpenCompanion()` is the stub for the backend redirect (alerts for now)

### Pending for next session

- **Backend** — `POST /api/wizard/compile`: birth certificate → `config.json` + `soul/companion_identity.md` + `soul/user_profile.md`. PNG character card export (Pillow `tEXt` chunk). Wire `wizOpenCompanion()` to redirect on success.
- **Morphing silhouette** — SVG bilinear interpolation across 4 corner body shapes in 2b Body. Complex enough to warrant dedicated session.
- **Custom SVG icons** — replace all emoji placeholders.

---

## Session notes — 2026-04-17

**Wizard implementation — sub-steps, navigation, appearance, polish.**

### What changed

- `static/wizard.html` — major iteration. All changes are in this single self-contained file.

### Navigation architecture

Replaced scattered imperative DOM manipulation with a single-source-of-truth pattern:
- `_goto(step, subStep)` — only entry point for all navigation. Updates `_step`/`_subStep`, tracks high water marks, calls `_applyStepState()` + `_updateNav()`.
- `_applyStepState()` — derives all DOM state from `_step`/`_subStep`. Deactivates all panels, activates only the current one. Can never drift.
- `_hwStep` / `_hwSubStep` — high water marks track furthest progress. All visited dots (forward AND back) are green and clickable, enabling fast-travel in both directions. Sub-step dots under step-2 nav dot are also clickable when visited.
- `wizBack()` without subStep override restores last sub-step visited in step 2 (going back from step 3 lands on 2e, not 2a).
- To add/remove a main step: change `TOTAL_STEPS` + `STEP_LABELS` + add HTML panel. To add/remove a sub-step: edit `SUB_META` + add HTML `sub-panel`. No nav logic to touch.

### Step 1 changes

- Adult Content toggle moved from inside type-grid to footer left slot. Mutually exclusive with Back button (step 1 → toggle, step 2+ → Back). 38% opacity when off, full opacity + indigo tint when on.
- Type-grid is now clean 4 cards only.

### Step 2 sub-step order

Foundation (2a) → Body (2b) → Face (2c) → Hair (2d) → Details (2e).
Rationale: morphing silhouette lives in 2b Body and stays hairless; height no longer appears in description before meaningful selections; Body naturally precedes facial and hair detail.

### Named step dots + sub-dots in nav

- Each main step dot now has a label below it (Type, Appearance, Outfit…). Nav height increased to 82px.
- Step 2 dot has 5 sub-dots beneath it that advance with sub-step progress.
- Footer uses CSS grid (1fr auto 1fr) so the step label is always truly centered.

### Portrait description

- Fixed: missing `else if (a['eye-shape'])` branch — eye-shape now shows alone if color is cleared.
- Added: face-shape, eyebrows, nose to description.
- Fixed: height now uses prose forms ("above average height", "very short" etc.) via `HEIGHT_PROSE` array.
- Added: "soft" body descriptor for low athletic values.
- Portrait text and emoji now cross-fade on change (opacity transition, ~80ms out + fade back).
- Description order: age → species → gender → skin → body build → height → face → eyebrows → nose → eyes → hair.

### Custom… chip

Clicking "Custom…" in any chip grid opens an inline text input (styled as a chip). Enter confirms, Esc cancels, blur confirms. Re-clicking an existing custom chip pre-fills the input with the current value.

### Pending items (from end of session, for next time)

- **Slider defaults** — sliders should NOT auto-initialize `_data.appearance` values. Values stay `undefined` until user explicitly touches a slider. Need a reset button/affordance for sliders so users can go back to "unset". Currently age/height are initialized to 30/Average even if untouched.
- **Slider flicker** — portrait update should use `onchange` (on release) instead of `oninput` (on drag) to avoid rapid fade flicker. Portrait fade duration should also be longer/slower (more aesthetic).
- **Supernatural "true age"** — apparent age slider (18–90) is fine for how they look. Add an optional "True age" free-text field that appears in 2a Foundation only when a supernatural species is selected (elf, vampire, spirit, fae, demon, angel, orc). Apparent age → portrait description. True age → lore/background, not description.
- **Continue validation** — Step 1 type (done). Step 4 name (when built). Appearance fully optional — no gates.
- **Custom SVG icons** — emoji placeholders throughout.
- **Morphing silhouette** — SVG bilinear interpolation in 2b Body.
- **Steps 3–8** — not yet built.
- **Backend** — `/wizard` route, compile endpoint, PNG export.

---

## Session notes — 2026-04-16 #7

**Avatar fixes + Wizard design + wizard.html mockup.**

### Avatar / presence fixes

- **Avatar output resolutions** — `companion-avatar.js`: orb output 256→512px, sidebar 300×400→768×1024px.
- **Zoom normalization** — switched from additive (`s + delta`) to multiplicative (`s * (1 + delta)`) zoom so each step is a fixed percentage regardless of zoom level. Scroll: ±7%, buttons: ±8%, pinch: 0.3%/px. Old absolute deltas were too slow when zoomed in, too fast when zoomed out.
- **Orb max size doubled** — `companion-presence.js` size slider range 32–80px → 32–160px. Existing presets (52px) map to ~16% on new scale — may want to nudge defaults in future.
- **Presence preview showing sidebar avatar** — `companion-presence.js` had `#companion-avatar img` in TWO places: `cpPresenceUpdatePreview()` (line fixed first, missed) and `cpPresenceInit()` (the real culprit — runs after `cpPresenceSelectPreset` and overwrites). Both now read from `#orb-icon img`.

### Wizard — design session

Key architecture decisions locked:

- **Format:** CharacterAI V2 character card spec. PNG output with BC JSON in `tEXt` chunk (key `chara`). Importable by SillyTavern, Chub.ai, the whole ecosystem. SENNI-specific data in `extensions.senni`.
- **Birth Certificate:** `birth_certificate.json` is the master artifact. Compile step writes `config.json` (appearance block + settings), `soul/companion_identity.md` (narrative synopsis), `soul/user_profile.md` (from Step 7).
- **Appearance data:** full structured block in `config.json` + narrative prose compiled into `companion_identity.md`.
- **User profile:** wizard Step 7 pre-populates `soul/user_profile.md` — same file, same injection, same `memory` tool writes later. Zero new infrastructure.
- **Module framing:** wizard is effectively its own standalone product. Clean URL (`/wizard`), self-contained JS, only SENNI backend dependency is the compile endpoint.

Full design decisions in `design/WIZARD.md`. Step flow, V2 schema, Birth Certificate architecture, appearance sub-steps, morphing silhouette plan all documented there.

### wizard.html

- `static/wizard.html` created — Steps 1–2 fully interactive
- Step 1: 4 type cards (Assistant / Friend / Companion / Role-play), Adult Content toggle, Continue locked until type selected
- Step 2: Two-column layout — sticky portrait orb (left) with live prose description building as chips are selected; chip grids + sliders (right) for gender, species, age, hair, eyes, skin, body type, height
- Species chip updates orb icon and corner ambient orb icon
- Navigation: step dots (01–08), Back/Continue footer, stepIn animation

### What's next (wizard)

- Appearance sub-steps (2a Foundation → 2b Hair → 2c Face → 2d Body → 2e Details) with secondary mini-indicator
- Custom SVG icons replacing emoji throughout
- Morphing body silhouette (SVG bilinear interpolation across 4 corner shapes, both sliders)
- Steps 3–8 HTML
- Compile sequence animation ("Binding [Name] to this vessel...")
- Backend: `/wizard` route, compile endpoint, PNG character card export

---

## Session notes — 2026-04-16 #6

**Bug fixes + process naming + avatar slots and crop tool.**

### Bugs fixed

- **Companion Settings tab save guards** — `cpSave()` now guards Moods, Memory, and Presence payloads behind their `_initDone` flags. Same pattern TTS already used. Root cause: lazy-init means `_cpMoodData` etc. start as `{}` and only populate when the tab is clicked — calling `_cpGetMoodPayload()` without that guard returned empty data and overwrote saved moods on every save from another tab.
- **Presence tab active highlight** — inline `style="color:..."` on the Presence button overrode `.cp-tab.active` color (inline > class specificity). Moved to `.cp-tab-special` CSS class declared before `.cp-tab.active` so the active rule wins.
- **Panel height jumping between tabs** — `max-height` → `height` on both `.companion-panel` (88vh) and `.settings-panel` (90vh). Tab body has `flex: 1; overflow-y: auto` so it fills the space.

### Process naming

- `main.py` — sets process name to `"SENNI Bridge"` on startup via `_set_process_name()` helper.
- `scripts/tts.py` — sets process name to `"SENNI Voice Server"` on startup.
- Helper tries `setproctitle` (optional pip install), falls back to `sys.argv[0]`, and on Windows also sets console window title via `ctypes`. llama-server is a compiled binary and cannot be renamed.

### Avatar slots + crop tool

- **Two avatar slots:** `avatar_path` (orb, existing) and `sidebar_avatar_path` (sidebar, new). Sidebar falls back to orb if no sidebar-specific file is saved.
- **New module `companion-avatar.js`** — canvas-based crop modal. No external library. Two modes with distinct overlay shapes:
  - Orb: circle overlay (radius 150px), 256×256 JPEG output
  - Sidebar: 3:4 portrait rounded-rect overlay (210×280px), 300×400 JPEG output
  - Drag to pan, scroll/pinch to zoom, ± buttons for touchscreen
  - Per-mode independent pan/zoom state (switch modes without losing position)
  - Dark mask outside crop area via canvas `evenodd` fill rule
  - Output is plain JPEG — no canvas clipping; CSS handles visual shaping (circle/rounding)
  - Mode tab shows ✓ when that slot has been applied
  - Click either slot preview to re-crop (if image already loaded this session)
- **Server:** `GET /api/companion/{folder}/avatar?slot=orb|sidebar` — sidebar falls back to orb. Save endpoint handles `orb_avatar_data` + `sidebar_avatar_data` (also accepts legacy `avatar_data` for orb).
- **`orb.setAvatar(src)`** added to orb.js public API so orb avatar can be set independently without syncing from the sidebar element.
- **`syncStatusAvatar()` no longer called from companion.js post-save** — was overwriting the orb with the sidebar avatar. Orb and sidebar are now managed independently.
- **URL bug fixed:** `sidebar_avatar_url` already contains `?slot=sidebar` — cache-buster must use `&v=` not `?v=`. Fixed in both `chat.js` and `companion.js cpPopulate`.

### What's still pending

- **Click-to-expand image thumbnails** — tracked in FEATURES.md
- **Processing feedback** (memory/TTS background activity indicator) — not yet started
- **llama-server args drift** — needs a pass against current llama.cpp

---

## Session notes — 2026-04-16 #5

**Memory dedup + sidebar/avatar redesign.**

### Memory dedup

- `scripts/memory_store.py` — added `dedup_notes(dry_run=False)`: groups all notes by exact content, keeps oldest non-superseded per group, deletes rest in batches of 100. Cleans up `pending_llm_consolidation` for deleted IDs.
- `scripts/memory_server.py` — added `POST /api/memory/dedup?dry_run=false` endpoint. `dry_run` defaults to `True` (safe). Also accepts JSON body. Fixed: on Windows CMD single quotes break JSON parsing — query param is the safe way to call it.
- Result: companions went from ~742→65 and ~972→272 notes after cleanup.

### Sidebar redesign (pragmatic pass — Wizard deferred)

Decision: defer full sidebar redesign until after the Companion Creation Wizard, which will define visual language for the full UI. This session does the high-value low-risk subset.

**What changed:**
- `static/chat.html` — removed Memory and Tools sidebar sections. Footer buttons → `footer-pill` class. Added dummy Tools tabs to both Settings and Companion Settings panels. Companion header restructured: portrait avatar → name → `● online ⚙` row.
- `static/css/base.css` — `.avatar` is now a 3:4 portrait rounded rectangle (`border-radius: 12px`, `aspect-ratio: 3/4`, `overflow: hidden`). Border uses `--orb-border`, glow uses `--glow-color` (tracks orb color + mood live). Avatar width: `calc(var(--sidebar-w) - 16px)` max 320px. Footer pills: 2-column grid, `border-radius: 20px`.
- `static/js/chat-ui.js` — sidebar resize now updates `--sidebar-w` on `document.documentElement` so avatar scales live while dragging.
- `static/js/orb.js` — `_apply()` now propagates `--orb-border` and `--glow-color` to `:root` after resolving overrides, so elements outside the orb subtree (e.g. avatar border) track color/mood changes.
- `static/js/chat.js`, `companion.js`, `settings-companion.js` — removed `border-radius:50%` from sidebar avatar `<img>` inline styles (container handles clipping via `overflow: hidden`). Orb/panel preview images unchanged.
- `static/js/settings-server.js`, `chat.js` — restart button textContent updated to include "Restart" label so it survives pill format.
- `main.py` — added `sys.stdout.reconfigure(encoding='utf-8')` so Unicode prints correctly on Windows terminals.

### Architecture notes

- `--orb-border` / `--glow-color` are now on `:root` (not just `#companion-orb`). Any future element that wants to match the orb color can use these variables directly.
- Sidebar avatar is portrait 3:4; orb avatar stays circular. These are visually decoupled but still share the same `avatar_path` source file. Separate avatar slots (`sidebar_avatar_path`) tracked in FEATURES.md.
- The avatar border style (`2px solid --orb-border` + `0 0 14px 2px --glow-color`) is a confirmed keeper — user loved it.

### What's still pending

- **Separate sidebar/orb avatar slots** — tracked in FEATURES.md
- **Avatar crop tool portrait mode** — tracked in FEATURES.md
- **Image thumbnail click-to-expand** — still open
- **Full sidebar redesign** — deferred until after Companion Creation Wizard

---

## Session notes — 2026-04-16 #4

**Session duplication bug fix.**

### Bug

Every page reload generated a new `_currentSessionId` (timestamp-based, line 56 of `chat-tabs.js`). `_loadSessionFromDisk` restored history/messages but never restored the original `session_id`. So the first save after reload wrote to a new folder with the same history → duplicate `session.json` with `consolidated: false` → memory ingester processed it as a new session → hundreds of duplicate notes generated rapidly.

### Fix

- `static/js/chat-tabs.js` — `loadTabs()`: after loading session from disk, restore `_currentSessionId` from `session.session_id` so all subsequent saves go to the same folder.

### Follow-up needed

- Duplicate notes already generated need cleanup. See FEATURES.md — memory viewer/editor item now includes duplicate detection + cleanup scope.
- Memory viewer/editor UI needed for human read/edit/create/delete access to soul/, mind/, and ChromaDB episodic notes.

---

## Session notes — 2026-04-16 #3

**Rich attachments + voice input — complete.**

### What changed (this session, continuing from #2)

- `static/js/api.js` — Audio format corrected to llama-server's actual API (PR #13714): `{ type: "input_audio", input_audio: { data: <raw base64>, format: "wav" } }`. Raw base64 only — no `data:` prefix. `audio_url` format rejected by llama-server.
- `static/js/voice-input.js` — `_finaliseChunk` now transcodes browser audio (webm/ogg) to 16-bit PCM WAV via Web Audio API before encoding. llama-server only accepts `wav` or `mp3`. Added `_toWav(blob)` and `_wavStr()` helpers. Auto-send on recording stop: `onstop` calls `sendMessage()` after final chunk is finalised. On intermediate 30s chunk boundary, starts next chunk as before.
- `static/css/messages.css` — `.msg-audio` changed to `width: 280px; max-width: 100%`. Added `.bubble:has(.msg-audio) { min-width: 290px }` so bubble is never narrower than the player.

### Architecture notes

- llama-server audio API: `input_audio` type, `data` = raw base64 (no prefix), `format` = `"wav"` or `"mp3"`. Confirmed from llama.cpp PR #13714 and Gemma 4 audio PR #21421.
- Gemma 4 chat template: finetunes may ship an outdated template. Override via `--chat-template-file <filename.jinja>` in `server_args_custom`. Path is relative to project root (CWD when server.py runs). Get updated template from base model's `tokenizer_config.json` on HuggingFace.
- Voice WAV files accumulate in session folders (`companions/<name>/history/<tab_id>/<session_id>/aud_001.wav` etc.). No automatic cleanup — same as image files, but larger (uncompressed). **Known future concern:** heavy voice use will bloat history folders. Needs a cleanup/pruning feature eventually — tracked in FEATURES.md.

### Verified working

- Voice recording → WAV transcode → model receives audio ✓
- Long recordings (multi-chunk) ✓
- Non-voice audio file attachment (WAV) → player in bubble ✓
- Text file attachment → `📄` chip in bubble (markdown files confirmed) ✓
- Audio player survives tab reload and hard reload ✓

### What's still pending

- **Varied audio file formats** (mp3, ogg, etc.) — not yet tested.
- **Image thumbnail click-to-expand** — tracked from previous session.

---
## Session notes — 2026-04-16 #2

**Rich attachment types + voice input — partially complete (session ran out of context).**

### What changed

- `static/js/chat.js` — `sendMessage()`: replaced text-label fallback for audio/doc attachments with visual elements. Audio → `<audio controls class="msg-audio" data-audio-ref="aud_NNN.ext">`. Text files → `.msg-doc-chip` div with 📄 icon. `attachLabel` removed (all types now have visual treatment). Audio note still appended to `histContent` as model fallback.
- `static/js/api.js` — Message transformation now includes audio. `audios = m._attachments.filter(a => a.type === "audio")` extracted alongside images. Audio content part added with `input_audio` format (corrected in session #3).
- `static/js/chat-tabs.js` — `_stripImagesFromHistory`: extended to also extract audio from `_attachments` (pushed to `_pendingImages` queue with `aud_NNN` names) and strip `audio_url` parts from API-format content arrays. `_extFromDataUrl`: extended to handle `audio/*` MIME types. `_serializeMessages`: extended to rewrite `audio[data-audio-ref]` data: src → media route URL on save, mirroring the image pattern.
- `static/js/attachments.js` — Added `addAttachment(att)` public function for voice-input.js to push chunks directly into the attachment queue.
- `static/js/voice-input.js` — **New file.** MediaRecorder-based voice recording. `voiceStart()` / `voiceStop()` public API. Auto-split at 30s chunks. Transcodes to WAV (added in session #3). Auto-sends on stop (added in session #3).
- `static/chat.html` — Mic button and voice indicator added inside `.input-wrap`.
- `static/css/messages.css` — Added `.msg-audio` and `.msg-doc-chip` styles (refined in session #3).
- `static/css/base.css` — Added mic button and voice indicator styles.

---

## Session notes — 2026-04-16

**Image storage fixes — avatar extract + inline thumbnails + two follow-up bug fixes.**

### What changed

- `scripts/config.py` — Added `write_avatar_file()`, `delete_avatar_files()`, `migrate_avatar()`. `list_companions()` now returns `avatar_url` (path string) instead of `avatar_data` (base64). Migration runs per-companion in `list_companions`.
- `scripts/server.py` — `api_status`: runs `migrate_avatar` for active companion, returns `avatar_url` instead of `avatar_data`. `api_get_settings`: runs migration + injects `avatar_url` into `active_companion`. `api_save_companion_settings`: `avatar_data` in body → writes file, stores `avatar_path`; empty → deletes file. New route `GET /api/companion/{folder}/avatar` serves `avatar.jpg`. `api_new_companion`: uses `avatar_path` instead of `avatar_data`.
- `static/js/chat.js` — `loadStatus`: uses `data.avatar_url` (URL) instead of `data.avatar_data` (base64). `sendMessage`: image attachments now get inline `<img class="msg-img" data-img-ref="img_001.jpg">` thumbnails in user bubble; filenames computed from image count in existing history to match `_stripImagesFromHistory` output.
- `static/js/companion.js` — Added `_cpAvatarChanged` / `_cpNewAvatarData` tracking. Reset on `cpLoad`. `cpAvatarCrop` (both paths) and `cpAvatarReset` set flags. `cpPopulate` uses `avatar_url`. `cpSave` conditionally sends `avatar_data` only when changed; post-save uses server URL with cache-buster. **Bug fix:** `cpAvatarCrop` no-cropper early-return path now correctly sets tracking flags (was silently dropping the new avatar).
- `static/js/settings-companion.js` — Added `_spAvatarChanged` / `_spNewAvatarData` tracking. `spPopulateCompanion` uses `avatar_url`. `spCropApply` sets flags. `spSaveCompanion` conditionally sends `avatar_data`. Post-save resets to server URL.
- `static/js/settings.js` — `spLoad` resets avatar tracking flags on reload.
- `static/js/chat-tabs.js` — `_serializeMessages`: clones bubble, replaces `data:` src on `img[data-img-ref]` with `/api/history/media/` URL before storing in session.json. `_stripImagesFromHistory`: **Bug fix (two issues):** (1) now handles `_attachments` format (the actual format chat.js uses — was only checking for `image_url` content-array parts which never existed); (2) `_pendingImages.splice(0)` moved to AFTER `_stripImagesFromHistory` runs, so images are written on the same save call that strips them (was always one call behind, leaving orphaned refs on first save).
- `static/css/messages.css` — Added `.msg-img` styles (220px max, rounded, margin-top, cursor zoom-in).

### Architecture notes

- Avatar config format: `avatar_path: "avatar.jpg"` (filename relative to companion folder). Migration is idempotent and runs on read in `list_companions`, and on write in `api_status` / `api_get_settings`.
- `avatar_url` is a plain path (`/api/companion/{folder}/avatar`). Frontend adds `?v=Date.now()` for cache-busting after a save.
- Image thumbnails in bubbles: filename matches what `_stripImagesFromHistory` generates (sequential from 1, per session). Serialize replaces data URL with media route URL. Replay uses baked-in URL from stored HTML.
- `_attachments` is stripped from saved history (base64 never persists). Images are written to session folder as `img_001.jpg` etc. The in-memory `conversationHistory` still has `_attachments` for API calls; the on-disk version does not.

### Next session

- **Rich attachments + voice input — finish remaining work** — see "Session notes — 2026-04-16 #2" below for what's done and what's left.
- **Sidebar redesign design conversation** — tools list → Settings, companion state card (larger avatar + mood + recent memory), memory viewer/editor. Needs dedicated design session before building.
- **Image thumbnail click-to-expand** — `.msg-img` shows thumbnail. Click to view full size not yet implemented.

---

## Session notes — 2026-04-15

**Pill visual rework + streaming cursor fix + doc updates.**

### What changed

- `static/js/api.js` — **fix:** streaming cursor now inserted inside the last `</p>` instead of after it (was appearing below the text). `sealThinkingBlock()` called in `_createStreamBubble()` AND at stream end / on error/abort — fixes dots staying visible when model goes straight from thinking to tool call with no text.
- `static/js/message-renderer.js` — `appendThinkingBlock()` now creates element with `streaming` class and pulsing dots markup; updates thinking content with `innerHTML` + inline cursor during streaming. New `sealThinkingBlock()` removes `streaming`/`open` classes and clears cursor. `setMarkdownEnabled()` now excludes `.stream-bubble` to prevent cursor being stripped mid-stream. New `escapeHtml()` helper.
- `static/js/chat.js` — `onThinking` callback wires auto-open setting: adds `open` class on block creation if `config.generation.thinking_autoopen === true`.
- `static/js/settings-generation.js` — `thinking_autoopen` toggle added (populate, save, toggle function).
- `static/chat.html` — toggle row for "Auto-open thinking block while streaming" added to Generation tab.
- `static/css/messages.css` — thinking toggle restyled as pill (border-radius 20px, indigo tint, DM Sans) matching memory-pill aesthetic. Streaming state shows pulsing dots, chevron hidden. `think-body` open state uses `max-height: 60vh` instead of `none` (enables collapse transition). `think-content` opacity 0.4 → 0.55.
- `static/css/orb.css` — `body.orb-inline .think-wrap, .tool-indicator` get `margin-left: var(--orb-indent)` to align with companion bubble text.
- `static/css/base.css` — `.messages` bottom padding changed from hardcoded `80px` to `calc(var(--orb-size) + 56px)` so it scales with orb size and content never hides behind the orb/mood pill.
- `design/FEATURES.md` — updated: pill rework done, mid_convo_k done, TTS streaming/toggle done, image storage issues documented, sidebar/UI ideas added, memory viewer idea added.

---

## Session notes — 2026-04-14

**Claude Code Desktop App setup + three bug/feature fixes.**

### What changed

- **Workflow** — migrated from Web UI to Claude Code Desktop App. CLAUDE.md and session flow updated to reflect surgical edits, direct file access, and branch-per-session git workflow.
- `.gitignore` — added `.claude/` entry to exclude Claude Code worktree folder from git.
- `companion.js` — **fix:** `cpSave()` now reapplies active mood after applying presence preset, so orb no longer reverts to presence-only on settings save.
- `chat.js` — time of day now injected into system prompt alongside date (re-computed each turn). `reloadMemoryContext()` added to `newChat()` so memory is resurfaced on context reset and clear chat.
- `chat-tabs.js` — `reloadMemoryContext()` added to `switchTab()` for new/empty tabs so memory surfaces when a new chat tab is opened.

### Next session

- **Pill visual rework** — real-time streaming content into thinking pills + visual consistency with chat bubbles. Bundles the alignment/padding bug fix.

---

## Session notes — 2026-04-13 #5

**Mood system hook + bugfix pass.**

### What was built / fixed

- `chat.js` — `onToolCall` handler now calls `_applyMoodToOrb()` when `set_mood` completes. No polling.
- `chat.js` — `_applyMoodToOrb(moodName)` implemented. Single canonical bridge: translates config `{ enabled, value }` schema to orb.js flat `{ _enabled, ...values }` format. Calls `orb.applyPreset(preset, flat)` with current presence preset preserved underneath. Also updates `config.active_mood` and mood pill. Passing `null` clears both.
- `chat.js` — `loadStatus()` mood block simplified: now calls `_applyMoodToOrb()` instead of inline pill-only logic. One code path for startup and tool call.
- `orb.js` — `applyPreset()` now uses a `KEEP_MOOD = Symbol('keep')` sentinel as default for the mood argument. Mood layer is only cleared when `null` is explicitly passed, not when mood arg is omitted. Fixes orb reverting to presence-only on every state transition.
- `companion-mood.js` — `cpMoodSetActive()` now calls `_applyMoodToOrb()` instead of only updating the pill. Orb updates immediately when activating a mood in the panel.
- `tts.js` — `_ttsGetActiveVoices()` and `_ttsGetActiveSetting()` now check mood TTS override first. Only applied when `tts.enabled === true` explicitly. Falls through to companion default otherwise. Fixes mood TTS being applied regardless of enabled toggle.

---
## Session notes — 2026-04-13 #4

**Mood system fully implemented and working.**

### What was built

- `companion-panel.css` — panel width bumped 540px → 720px. Mood tab CSS added (`cm-*` classes).
- `companion-presence.js` — colour picker logic extracted out; thin delegation wrapper added.
- `companion-color-picker.js` — **new**. Standalone overlay picker module. API: `cpOpenColorPicker({ title, hex, onPick, onClose })`.
- `companion-mood.js` — **new** (~857 lines). Full Mood tab: card list, lazy-built card bodies, per-property toggles, group master toggles, colour picker integration, TTS section, pill visibility segmented toggle, new/delete mood, save payload.
- `companion.js` — wired `cpMoodReset()`, `cpMoodInit()`, `_cpGetMoodPayload()`, post-save cache for mood fields.
- `chat.html` — Mood tab button + `#cp-tab-mood` body + script tags for color-picker and mood.
- `chat.js` — `_applyMoodToOrb()` (schema translation + orb + pill update), `_startMoodPoll()` (4s poll, detects active_mood change), moods block in `buildSystemPrompt()`.
- `tool-parser.js` — `set_mood` added to `TOOL_DEFINITIONS` (all three parsers derive from this).
- `tools/set_mood.py` — **new**. Auto-discovered tool. Writes `active_mood` to companion config.

### Bugs fixed this session

- `moodPill.clear()` doesn't exist — correct call is `moodPill.update(null)`. Fixed in `chat.js` and `companion-mood.js`.
- `set_mood` not recognised as a tool call — was missing from `TOOL_DEFINITIONS` in `tool-parser.js`. Fixed.
- System prompt wording caused model to treat `set_mood` as a pseudo-instruction rather than a tool. Fixed — now leads with "You have a set_mood tool. Call it."

### What still needs doing

- ~~**Hook orb/pill update to tool call result** — replace `_startMoodPoll()` with a direct hook on the `set_mood` tool call completing in `api.js` / `onToolCall`. Instant update, no polling overhead. Next session priority.~~

---

## Session notes — 2026-04-13 #2

**Presence tab rework complete. No Mood implementation yet.**

### What was designed / decided

- Presence rework design finalised: groups (Orb / Dots / Glow / Ring), Orb has no group toggle, Breathing gets its own row-level toggle, group toggles on Dots/Glow/Ring sit on the right of the header alongside the chevron.
- Colour picker moves from inline floating disclosure to centred overlay modal within the companion panel.
- Opacity moves from inside the colour picker to its own slider row (alongside Speed, Intensity).
- Speed sliders: unified 0–100 abstract scale (left = slow, right = fast). **UI-layer only** — real CSS seconds/pixels stored in config and passed to orb.js unchanged.
- Intensity = glow max size (4–36px range). Ring has no Intensity (nothing to map it to).
- Orb group colour labelled "Colour" (not "Edge colour") since it affects the whole orb when no avatar is set.

### Files changed

- `static/js/companion-presence.js` — full rewrite. New `CP_ELEMENTS` with `toSlider`/`fromSlider`/`format` per slider. New centred overlay colour picker. Breathing toggle on row, group toggles for Dots/Glow/Ring. `CP_STATE_DEFAULTS` unchanged (real CSS values). `orb.js` untouched.
- `static/css/companion-panel.css` — Presence section replaced. New `.cp-prop-row`, `.cp-prop-tog-space`, `.cp-prop-label`, `.cp-prop-slider`, `.cp-prop-val`. New `.cp-color-overlay` modal. `.companion-panel` gets `position: relative` for overlay positioning. Old inline picker styles removed.
- `static/chat.html` — Presence accordion restructured with new header layout (name left, toggle+chevron right). Overlay modal HTML added inside companion panel before footer.

### Key architecture note
The 0–100 slider scale is **purely a UI conversion**. `fromSlider()` converts to real CSS values before storing; `toSlider()` converts back when rendering. `orb.js` and the config format are unchanged — they always work in real CSS units.

---

## Session notes — 2026-04-13

**Mood system design complete. MOOD.md written. No code changes this session.**

---

## Session notes — 2026-04-12 #2

**Memory pipeline items 1–3 complete. New feature entries added to FEATURES.md.**

- `static/js/chat.js` — `reloadMemoryContext()`: added 120ms deferred `onMemorySurface('')` call.
- `scripts/memory_store.py` — Added `write_system_note()`.
- `scripts/memory_server.py` — Added `_process_unconsolidated_sessions()`, `_index_mind_files()`.

### Memory pipeline status

1. ~~Session-start context UI signal~~ — Done.
2. ~~Background embedding queue (session history ingestion)~~ — Done.
3. ~~Mind file indexing into ChromaDB~~ — Done.
4. **Tool self-registration refactor** — full session needed.
5. **Token budget empirical test** — run a session with 20+ notes, measure system prompt sizes.

---

## Session notes — 2026-04-12

**Bug fixes: companion settings ghost bar, TTS browse/defaults.**

---

## Session notes — 2026-04-11

**Memory system foundation pass — review, diagnostics, and fixes.**

- `static/js/chat.js` — Added `_assocTurnsSinceLast`, `_assocInterval()`, `_triggerAssociativeRetrieval()`.
- `scripts/config.py` — `memory.enabled` default `False` → `True`. Deep-merge for `memory` block.
- `tools/supersede_memory.py` — New tool.

---

## Session notes — 2026-04-10

**Bug fixes: TTS settings reset, dropdown colors, Kokoro file browser title, markdown render reverting.**

---

## Session notes — 2026-04-08

**Gemma 4 tool calling, memory link pipeline, multimodal toggle.**

---

## Session notes — 2026-04-06 #8

**Bug fixes: history loading, embedding timeout, role alternation 500, misc.**

---

## Session notes — 2026-04-06 #7

**System prompt XML format examples — complete.**

---

## Session notes — 2026-04-06 #6

**Tool call parser fix — Qwen XML format mismatch.**

---

## Session notes — 2026-04-06 #5

**CLAUDE.md refactor — split into design/ modules.**

---

## Session notes — 2026-04-06 #4

**Disk-backed history, associative memory retrieval, memory pill UI.**

---

## Session notes — 2026-04-06

**Memory system design finalised and implementation begun. TTS confirmed working.**

---

## Design folder

Large design decisions live in `design/` as standalone docs. These are NOT loaded into context automatically — search project knowledge when you need them. Do not reproduce their full content in CLAUDE.md.

| File | Contents |
|------|----------|
| `design/ARCHITECTURE.md` | Modularity plan, completed refactors, planned modules, script/stylesheet load orders. Updated 2026-04-13 #4. |
| `design/BOOT.md` | Boot & process lifecycle, TOCTOU problem, per-OS path resolution, file browsing via tkinter |
| `design/SYSTEMS.md` | Current state: Orb, Presence, Heartbeat, Companion window, Settings dirty tracking, Chat tabs, Vision mode, associative memory pill |
| `design/TTS.md` | Kokoro TTS architecture, config schema, Aurini integration boundary, what's done/pending |
| `design/FEATURES.md` | All planned features and changes, grouped by area |
| `design/MEMORY.md` | Full memory architecture — primitives, composites, primitive_ratios, retrieval, consolidation, ChromaDB stack. Updated 2026-04-06. |
| `design/COMPANION_STACK.md` | Cognitive function stack format, O+J axis pairing, charge as directionality, stack position as probability. Updated 2026-04-06. |
| `design/ORB_DESIGN.md` | Orb positioning, layout modes, CSS variable documentation |
| `design/MOOD.md` | Mood system — full design + implementation notes. Config schema, default moods, orb schema translation, tool hook pending. Updated 2026-04-13 #4. |
| `design/WIZARD.md` | Companion Creation Wizard — V2 character card format, Birth Certificate architecture, step flow, appearance sub-steps, morphing silhouette plan. Updated 2026-04-16 #7. |

When starting a session that touches any of these systems, search project knowledge for the relevant design doc rather than asking the user to explain it.

---

## Design sessions needed

These items are too open-ended to task out. They need a dedicated design conversation before any implementation.

- **Main Chat UI redesign** — overall feel should be "smoother, fuller, cozier". Known starting points: sidebar is too large (split into sections or cards?), buttons to pill shape, tools list moved out of sidebar into Settings, companion state/mood pills near the orb area. Color scheme is already good. Needs visual exploration before touching code.
- **Companion Creation Wizard — appearance sections** — Hair style grid, face shape, eyes, nose, outfit system, accessories, fetishes/kinks, natural triggers, and several other sections are marked "design needs expanding on". These need fleshing out before wizard implementation begins.
- **Closeness/relationship progression** — may become a gamified system (develop closeness over time). Needs design before the wizard's closeness step is finalized.
- **Companion Templates rework** — templates need redesigning to fit the new memory system and future features. Goals: don't clash with ChromaDB/soul/mind architecture; future-proof for Wizard and Mood system; keep token totals reasonable. Needs a design conversation before touching template files.
