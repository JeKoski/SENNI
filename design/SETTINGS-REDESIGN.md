# Settings Windows Redesign

**Status:** Largely implemented. Settings panel fully done. Companion Settings fully done (token system + all tabs). Sidebar changes still pending.
**Scope:** Both the global Settings panel and the Companion Settings window.
**Goal:** Adopt the new token/elevation system from the main chat redesign. Consolidate scattered settings. Add missing tabs (Features, Tools). Cleaner visual hierarchy throughout.

---

## Locked tab layouts

### Settings panel (6 tabs)

| Tab | Contents |
|-----|----------|
| **Model** | Model file, mmproj, binary, GPU, ports, built-in + custom args. Restart note + button in footer. Renamed from "Server" — TTS moves to Features. |
| **Generation** | Sampling params (temp, top-p, top-k, repeat penalty), max tokens, max tool rounds, vision mode. Pure generation — no display/behaviour toggles. |
| **Display** | Markdown toggle, controls visibility toggle, thinking auto-open toggle, tool pill visibility toggles (memory_writes, mood, relational, episodic_write, episodic_read, web, other), "Show technical details" toggle. |
| **Features** | TTS accordion (enable + python/voices/espeak paths + resolved path display + status + reinstall button), ChromaDB accordion (enable + paths + status + reinstall). Expandable for future extras. |
| **Tools** | Global per-tool enable/disable list. |
| **About** | Version, model, GPU, ports, paths, diagnostics, re-run wizard, danger zone (factory reset). |

*Companions removed as a tab — companion switching lives in the sidebar (see sidebar changes below).*

### Companion Settings window (7 tabs)

| Tab | Contents |
|-----|----------|
| **Identity & Memory** | Name, avatar (orb slot + sidebar slot with crop tool), evolution level selector (Settled/Reflective/Adaptive/Unbound), mid_convo_k, session_start_k, → Memory Manager link. |
| **Generation** | Per-companion overrides: temp, top-p, top-k, repeat penalty, max tokens, max tool rounds, thinking auto-open. |
| **Heartbeat** | Enable, interval, prompt, timing — no changes from current. |
| **Expression ✦** | Segmented `[Presence | Mood]` toggle at top. Full Presence UI or full Mood UI depending on selection. Both panels include reset-to-default buttons. Mood panel includes TTS override UI (speed/blend per mood). |
| **Voice** | Voice blend slots, speed, pitch, preview — no changes from current. |
| **Tools** | Per-companion tool overrides (inherits global defaults, override per tool). |
| **Library** *(stub)* | Keyword-triggered lore entry editor — stub until in-chat keyword scanning is built. See Library system section below. |

### Sidebar + orb changes

- **Sidebar footer:** Settings \| **Companions** \| Restart. Heartbeat button removed.
- **Orb — manual heartbeat trigger:** Clicking the orb fires a manual heartbeat turn. On hover: orb dims, heartbeat icon appears centered in orb, tooltip at cursor explains the action. Disabled during active generation. This replaces the sidebar button entirely.
- **Companions button** opens a companion switcher (the current companion list from the old Settings Companion tab).

### Memory Manager window

Separate floating window (not full-screen, not a tab). Accessible from:
- Chat header ⋯ menu (stub already wired)
- Identity & Memory tab → link

**Phase 1 (ship with Settings redesign):** Soul/mind markdown file editor — move current editor UI from Companion Settings here.

**Phase 2 (future design session):** ChromaDB episodic note browser — list, read, edit, delete individual notes. Dedup button. Note breakdown by source. Note health indicators (surfaced count, last retrieved, superseded status).

---

## Library system

The Library tab surfaces the V2 character card `character_book` — a keyword-triggered lore injection system. Each entry: keyword list + content block + enabled toggle + insertion order. `constant: true` entries always inject.

**For the user:** the companion silently gains relevant context when certain keywords appear in conversation, without that content permanently occupying context budget. Dynamic reference library — world facts, NPC profiles, location details, recurring concepts.

**Companion-authored entries:** A `write_library_entry` tool (future) lets the companion write their own entries — the same way `write_memory` writes to ChromaDB. The distinction: ChromaDB = *what happened* (episodic), Library = *what is true* (permanent world fact). Companions could naturally graduate important recurring facts from episodic notes into permanent library entries.

**Implementation tiers:**
1. **Compile-time seed** — "First things to know" textarea seeds the character_book at compile time. Already planned in CHARA_CARD.md.
2. **Library tab editor** — manual add/edit/delete UI in Companion Settings. Keyword tag chip input, content textarea, enable toggle, ordering. Stub until keyword scanning is built.
3. **In-chat keyword scanning** — scan last N turns before each `buildSystemPrompt()` call, inject matched entries into memory context block, token budget (e.g. 500 tokens max). The runtime engine that makes entries actually fire.
4. **Companion tool** — `write_library_entry` tool call lets companion write their own permanent facts. Alongside existing `write_memory` / `retrieve_memory` family.
5. **ChromaDB → Library promotion** (far future) — UI in MM to promote important episodic notes to permanent library entries.

---

## Current state — what exists ✅

### Settings panel (global) — 6 tabs ✅ COMPLETE

| Tab | Status | Contents |
|-----|--------|----------|
| **Model** | ✅ | Model file, mmproj, binary, GPU, ports, built-in + custom args |
| **Generation** | ✅ | Sampling params only (temp, top-p, top-k, repeat penalty, max tokens, max tool rounds, DRY settings, vision mode) |
| **Display** | ✅ | Markdown, controls visibility, thinking auto-open, tool pill toggles, show technical details |
| **Features** | ✅ | TTS accordion + ChromaDB accordion — reinstall buttons still stub |
| **Tools** | ✅ | Global per-tool enable/disable (9 tools) |
| **About** | ✅ | Version, model, GPU, ports, paths, diagnostics, re-run wizard, factory reset |

### Companion Settings window — 7 tabs ✅ COMPLETE

| Tab | Status | Contents |
|-----|--------|----------|
| **Identity & Memory** | ✅ | Name, avatar (both slots + crop), evolution level cards (Settled/Reflective/Adaptive/Unbound), episodic memory toggle, K sliders, cognitive stack, → Memory Manager link |
| **Generation** | ✅ | Per-companion overrides: temp, top-p, top-k, min-p, repeat penalty, max tokens, max tool rounds, DRY settings |
| **Heartbeat** | ✅ | Enable/interval, silent/message/idle triggers, timing instructions |
| **Expression ✦** | ✅ | Segmented [Presence \| Mood] toggle. Full presence preset + state UI. Full mood card list + active mood + pill visibility |
| **Voice** | ✅ | Voice blend slots (up to 5), speed, pitch, preview |
| **Tools** | ✅ | 3-state per-companion overrides: Global / On / Off per tool |
| **Library** | ⏳ stub | Keyword-triggered lore entries — waiting on in-chat keyword scanning engine |

### Memory Manager window — Phase 1 ✅ COMPLETE

Soul/mind markdown file editor. Accessible from Identity & Memory tab → link. Phase 2 (ChromaDB browser) is a future session.

### Token/elevation system — ✅ COMPLETE on both panels

Both `settings.css` and `companion-panel.css` fully migrated: pill-chip tab bars, gradient panel chrome, `--elev-3` panel shadow, `--surface-*`/`--border-*`/`--text-*` tokens throughout, `--focus-ring` on all inputs.

### Still pending

- **Sidebar changes** — Companions button (replaces heartbeat button), orb click → manual heartbeat trigger

---

## Everything that needs a home — inventory

### Needs a UI that doesn't have one yet

- **Tool pill visibility toggles** — `config.tool_pills` keys (`memory_writes`, `mood`, `relational`, `episodic_write`, `episodic_read`, `web`, `other`) are config-driven but have no Settings UI. Referenced in session notes 2026-04-29 as "deferred to Settings redesign."
- **"Show technical details" toggle** — global toggle to show full raw tool call JSON in chat (vs. friendly pill display). Hook in `message-renderer.js` exists, Settings UI does not.
- **Features tab** — post-wizard install path for users who skipped TTS/ChromaDB in wizard. Reinstall/detect buttons per feature. Resolved path display ("currently using: `./features/packages/...`"). Also needs to surface espeak path.
- **Global tool enable/disable** — per-tool global on/off. Tools tab in Settings is a stub.
- **Per-companion tool overrides** — Tools tab in Companion Settings is also a stub.
- **Memory viewer/editor** — browse, edit, delete soul/mind markdown files and ChromaDB episodic notes. Dedup button. Could live in Companion Settings > Memory tab (expanded) or as a separate panel. Needs design.
- **Lorebook editor** — new tab in Companion Settings. See `design/CHARA_CARD.md`.
- **Mood → TTS override UI** — speed/blend per mood. Schema already in config (`companions/<folder>/config.json`). Goes in Companion Settings > Mood tab (already the right place).
- **Presence/Mood reset-to-default buttons** — "Reset all" and "Reset a preset" actions. Goes in Companion Settings > Presence and Mood tabs.

### Currently misplaced / could move

- **TTS paths** — live in Settings > Server tab today, buried under model/binary/GPU config. Arguably belongs in a dedicated Features tab alongside ChromaDB.
- **Display/behaviour toggles** — markdown toggle, thinking auto-open, message controls visibility are in Generation tab but aren't generation parameters. Could move to a Display tab.
- **Global memory enable/disable** (`config.memory.enabled`) — no Settings UI at all today. Lives in global config only.

### Deferred to post-Tauri (do not design for now)

- Performance mode toggle (CSS hooks in place, Settings UI deferred)
- History folder pruning UI

---

## Open implementation questions

- **Settings panel width** — currently narrow. Features tab with path displays + status badges may need it wider. Decide during visual pass.
- **Companions button** — does it open a dropdown/popover inline, or a separate mini panel? Current companion list in Settings is just a list + create button, so a popover is probably fine.
- **Expression tab segmented control** — needs visual testing to confirm it looks right. Presence is complex (tall); Mood is also tall. Make sure the switch feels natural and doesn't cause layout jank.
- **Tools tab content** — what tools exist that need toggles? Enumerate from `tools/` directory when implementing.

---

## Visual direction (from UI-REDESIGN.md)

Settings windows get the same token/elevation system as the main chat redesign:

- Surface tiers: `--surface-sunken`, `--surface-raised`, `--surface-floating`
- Elevation presets: `--elev-1` through `--elev-4` for modal chrome
- Border tiers: `--border-subtle`, `--border-default`, `--border-strong`
- Focus ring: `--focus-ring`
- Tab bar: adopt pill-chip style (matching wizard/companion wizard) rather than plain button tabs
- Section labels: adopt from main chat pattern (monospace caps, subtle border-bottom)
- Toggles: adopt pill toggle style from wizard
- Input fields: `--surface-sunken` background, `--border-default` border, `--focus-ring` on focus

The Settings panel is a floating panel (not full-screen). Elevation = `--elev-3` for the panel itself. Backdrop blur on overlay.

Companion Settings is a full-height side panel. Same surface + elevation treatment.

---

## JS module map (current)

**Settings panel:**
- `settings.js` — coordinator: open/close, tab switching, load, dirty tracking
- `settings-server.js` → `settings-model.js` (tab renamed; file still `settings-server.js`)
- `settings-generation.js` — Generation tab
- `settings-display.js` — Display tab (markdown, controls, thinking, tool pills, show_technical_details)
- `settings-features.js` — Features tab (TTS + ChromaDB accordions)
- `settings-tools.js` — Tools tab (global per-tool enable/disable)
- `settings-companion.js` — Companion tab + About tab
- `settings_os_paths.js` — per-OS path resolution (inside Model tab)

**Companion Settings:**
- `companion.js` — coordinator: open/close, load, tab switching, avatar, generation, heartbeat, save, toast, dirty tracking, evolution level logic (`_cpEvoSelect`, Unbound modal functions)
- `companion-memory.js` — memory status badge, K sliders, cognitive stack (Identity & Memory tab)
- `companion-presence.js` — Presence panel (inside Expression ✦ tab)
- `companion-mood.js` — Mood panel (inside Expression ✦ tab)
- `companion-tts.js` — Voice tab
- `companion-tools.js` — Tools tab (3-state per-companion overrides)
- `memory-manager.js` — Memory Manager floating modal (soul/mind file editor)
