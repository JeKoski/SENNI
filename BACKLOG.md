# BACKLOG.md — SENNI Feature & Task Backlog

Single source of truth for what's next. Linked to relevant design docs where applicable.
Update at end of each session. Completed items get deleted, not struck through.

---

## High Priority

- Making installation and updating easy (design session needed)
  - We need to prioritize actually getting the app out ther
  - Main app is functional, Wizard is functional etc.
  - We'll figure out any UX quirks while we do this (start-up wizard probably needs a redo as well, or perhaps we'll move its functionality to the installer/launcher)
  - Launcher? Wrapper? No clue. App should have a standard installer for installing everything so that regular people can start using it.

---

## Housekeeping

- **Docs audit** — go through all `design/*.md` docs to prune stale content and move any buried to-dos into BACKLOG.md. WIZARD.md still needs looking through.
- **SYSTEMS.md freshen-up** — lists mood system and companion-mood.js as "not yet built" but both were completed 2026-04-13. Needs a pass to reflect current state.

---

## Quick Wins

*Ready to build — no design conversation needed.*

- **Species color-shifting** — tint silhouettes per species via CSS `color` (vampire=charcoal, demon=dark red, elf=forest green etc.). Lookup table only, ~10 min.
- **`first_mes`** — static injection as first companion bubble on new chat. Design in `design/CHARA_CARD.md` → first_mes section.
- **`system_prompt` + `post_history_instructions`** — write at compile, inject in `buildSystemPrompt`. Design in `design/CHARA_CARD.md`.
- **`scenario` field fix** — current mapping in `wizard_compile.py` is wrong. See `design/CHARA_CARD.md`.
- **`description` field** — personality prose not wired into birth certificate. See `design/CHARA_CARD.md`.
- **`creator_notes`** — one line in `wizard_compile.py`. See `design/CHARA_CARD.md`.
- **Mood → TTS override UI** — speed/blend per mood in Companion Settings Mood tab. Schema already in config, just needs UI. See `design/TTS.md`.
- **Image click-to-expand** — `.msg-img` thumbnails in chat show inline but click-to-fullsize not yet implemented. See `design/FEATURES.md`.
- **History folder pruning** — WAV voice files + images accumulate in session folders with no cleanup. Need a pruning strategy (auto-delete media older than N days, or manual "clean up" action). See `design/FEATURES.md`.
- **Mid-session gap detection** — long idle → re-inject updated timestamp into system prompt. Piggyback on consolidation idle timer. Low priority.
- **Tool settings UI** — global enable/disable per tool + per-companion overrides. Settings > Tools tab. See `design/FEATURES.md`.
- **Voice discovery silent failure** — no feedback shown when Kokoro finds no voices. Small UX fix.
- **llama-server args drift** — launch args in `server.py` may have drifted from current llama.cpp API. Needs a pass against current docs.
- **Import QA round-trip** — ongoing edge case testing as real use surfaces issues.

---

## Needs looking into

- **Companion Mood activation** — Companions use moods inconsistently or not at all. How are we instructing mood tool usage? Something we should change?

---

## Design Sessions Needed

*Too open-ended to task out. Need a dedicated design conversation first.*

- **Main Chat UI redesign** — "smoother, fuller, cozier". Known starting points: sidebar companion state card (mood, recent memory), memory viewer/editor panel. Wizard has established the visual language — good time to apply it. See `design/FEATURES.md` → Sidebar/UI section.
- **Memory viewer/editor** — browse/edit/delete soul/, mind/, and ChromaDB notes. Duplicate dedup UI. Can roll into chat UI design session. See `design/FEATURES.md` → Memory section.
- **Closeness/relationship progression** — may become gamified (develop closeness over time). Wizard closeness step is partially blocked on this.
- **Companion Templates rework** — templates need redesigning to fit memory system + Wizard + Mood. See `design/FEATURES.md` → Companion section.
- **Wizard appearance sections** — hair style grid, face shape, eyes, nose, outfit system. Waiting on layered avatar design. See `design/WIZARD.md`.

---

## Wizard Backlog

*Implementation-ready items specific to `static/companion-wizard.html` and `scripts/wizard_compile.py`.*

- **`first_mes` / `system_prompt` / `post_history_instructions`** — see Quick Wins above, wizard is the compile source
- **Lorebook editor UI** — new tab in Companion Settings. Medium complexity. See `design/CHARA_CARD.md` → Character Book section.
- **Alternate greetings UI** — Step 9 or Companion Settings picker. Low priority.
- **`output_dir` refactor** in `wizard_compile.py` — prerequisite for standalone distribution.

---

## On Hold

*Waiting on external factor before proceeding.*

- **Layered avatar / character creator system** — full design session needed, but asset creation is blocked on new PC + OmniSVG experiments. OmniSVG (8.5GB) fits comfortably on RTX 5060 Ti 16GB. See `design/CHARA_CARD.md` → Appearance sections.
- **Silhouette morphing** — shelved in favour of layered avatar system. Revisit after layered avatar design session.
- **Species silhouette variants** — deferred with silhouette morphing. Short-term: use color-shifting (see Quick Wins).
- **TTS upgrade** — newer realistic TTS models (Qwen Audio etc.) worth evaluating once new PC is up. Kokoro on CPU is too slow on current i5-7600K; CUDA on 5060 Ti should be near-instant.
- **App Sounds** — Just an idea right now. App has only TTS, no other audio. Would add a lot of ambiance and polish.
- **Cozy Mode** — full sensory layer (lighting, ambient sounds, warm orb). Wishlist, needs visual/interaction design. See `design/FEATURES.md` → Cozy Mode.
- **Standalone Wizard / Tauri** — architecture documented in `design/CHARA_CARD.md`. Not started.
