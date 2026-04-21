# CLAUDE.md — Instructions for Claude

This file is for Claude to read at the start of every session.
Search for it using project knowledge before doing anything else.

---

## Session Flow

1. Start session with CLAUDE.md
2. Check BACKLOG.md for what's next
3. Surgical work happens (Claude reads files directly — no uploads needed)

---

## Critical working rules

- **Modular Architecture:** We should work towards making everything modular - within reason - while creating new code and also noting down possible refactors when going over old code. Adding, editing or replacing small or large components shouldn't require edits across multiple files. Creating separate helper scripts when functionality repeats will help with consistency and bug fixing.
- **Simplicity and efficiency** — are to be prioritized when it makes sense. Overengineering is to be avoided.
- **Prefer surgical edits** — use targeted find-and-replace edits for most changes. Full file rewrites are fine for large refactors where most of the file is changing. The old "complete files only" rule was a Web UI workaround — Claude Code applies edits directly, so partial edits are no longer a problem. Every changed line should trace directly to the user's request. Don't "improve" adjacent code, comments, or formatting unless asked. If unrelated dead code is spotted, mention it — don't delete it.
- **One file at a time** where possible. Flag upfront if a feature will require touching multiple files and get agreement before proceeding.
- **Surface tradeoffs, don't pick silently** — if multiple valid approaches exist, name them and let Jesse choose. If a simpler path exists than what was asked for, say so. If something is unclear, stop and ask rather than assuming.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won't work. Automate it or build it into existing flows instead.
- **Suggest Extended Thinking** and/or Opus when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **Goal-driven execution** — for any non-trivial task, define success criteria upfront before writing code. e.g. "Fix the scenario field" → "wizard_compile.py outputs correct scenario value; round-trip import restores it." Verifiable goals enable looping to completion without constant check-ins.
- **End every session by updating CLAUDE.md, BACKLOG.md, and any relevant design docs.** This is non-negotiable — it's what makes the next session productive.

---

## Project overview

SENNI is a local AI companion framework. Currently running with Gemma 4 E4B Q4_K_M, Intel Arc A750 GPU.

Two servers:

- **Python bridge** (`scripts/server.py`) — FastAPI, handles UI, tools, config. Needs terminal restart for changes.
- **llama-server** — the model itself. Can be restarted in-app.

Runs on Linux (primary dev) and Windows (also tested and supported). Currently on Windows.

**New PC incoming (within 1-2 weeks as of 2026-04-17):** Core Ultra 7 270K + RTX 5060 Ti 16GB + 32GB DDR5. Will need CUDA llama-server build (switching from SYCL/Intel Arc). Larger models and OmniSVG become viable.

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

---

## Bugs

### Active

- **llama-server version drift** — `server.py` launch args may have drifted from current llama.cpp API. Needs a pass against current llama.cpp docs.

---

## Environment

- OS: Linux (primary) + Windows (also supported and tested)
- GPU: Intel Arc A750 (SYCL build on Windows, oneAPI on Linux) — switching to RTX 5060 Ti + CUDA soon
- Models tested: Gemma 4 (primary), Qwen3.5 9B Q4_K_M
- Temperature: 0.8 (critical for Qwen — higher breaks tool call syntax)
- `--reasoning-format deepseek` enabled (Qwen3 only — disable for Gemma 4)
- Flash attention: auto-enabled by llama-server

---

## Known model quirks

**Qwen3.5 9B tool calls in thinking blocks** — confirmed llama.cpp bug (issue #20837): Qwen3.5 9B often prints tool calls in XML inside thinking blocks when thinking is enabled. Not a SENNI bug. Memory write discipline should be robust to unreliable self-initiation — associative pathway is system-driven, masculine self-retrieval has auto-trigger fallback.

**Gemma 4 tool call format** — Gemma 4 uses XML-style tool calls (`<tool_call><function=name>...`) via its jinja template, not SENNI's custom XML examples. System prompt must NOT include XML tool call examples for Gemma 4 — the jinja template handles it, and showing examples causes it to write XML instead of its native format. Handled via `modelFamily` detection in `chat.js`.

---

## Documentation convention

- **CLAUDE.md** — operational instructions, active bugs, design folder index, last 2 session notes. Update at end of every session.
- **BACKLOG.md** — all pending work: quick wins, design sessions needed, on-hold items. Single source of truth for "what's next".
- **design/*.md** — system docs and design decisions. Update when the relevant system is touched.
- Rule: when we touch a system in a session, we document it in that session. Don't defer.

---

## Session notes — 2026-04-21 #2 (Setup Wizard — QA fixes + extras architecture)

**Config overwrite fixed. Features install architecture reworked. Multimodal download wired. Setup_complete flag added. Multiple wizard bugs fixed.**

### Key architecture decisions

**Extras install: single shared `./features/packages/` dir**
- All extras (kokoro, chromadb) install to one shared dir via `pip install --target`
- No duplicates — shared numpy etc.
- `server.py` adds `./features/packages/` to `sys.path` before tts/memory router imports (chromadb in-process)
- `tts_server.py` injects `PYTHONPATH=./features/packages/` into the tts.py subprocess env (subprocess doesn't inherit parent sys.path)
- `config["tts"]["python_path"]` = empty → uses sys.executable; PYTHONPATH carries the packages

**espeak-ng:** system binary, not pip. Wizard detects via PATH / `config["tts"]["espeak_path"]`. Not installed by wizard. Bundle with Tauri package in Phase 3.

**Voices:** Kokoro downloads `.pt` voice files to `~/.cache/` on first use. `voices_path` config for custom location. Auto-discovered by `discover_voices()`. No wizard action needed.

**`setup_complete` flag** in config (default: `True` for legacy compat):
- `api_setup` sets it `False` at boot start
- `POST /api/setup/complete` sets it `True` (called by wizard on boot ready)
- Root route redirects to wizard if `False`

### What changed

**`scripts/server.py`:**
- `api_setup` — now calls `load_config()` + patches only wizard fields (config overwrite bug fixed)
- sys.path patch uses `./features/packages/` (single dir, was `./features/*/`)
- `setup_complete = False` written at boot start
- Root route checks both `model_path` and `setup_complete`

**`scripts/setup_router.py`:**
- `FEATURES_PACKAGES_DIR = PROJECT_ROOT / "features" / "packages"` (shared dir)
- MODELS updated: both models have `subfolder`, `mmproj_url`, `mmproj_filename`, `multimodal: True`
- `_detect_extra()` checks `./features/packages/<pkg>/` then importlib fallback
- `_detect_espeak()` — checks config path then PATH (`shutil.which`)
- `GET /api/setup/extras-status` — includes espeak detection
- `GET /api/setup/extras-status` — local-only sets skip flag; system Python shows warning
- `POST /api/setup/complete` — sets `setup_complete: True`
- `install-extras` uses `--target ./features/packages/` for all packages
- `download-model` — uses `./models/<subfolder>/`, streams model then mmproj in sequence with `phase` field

**`scripts/tts_server.py`:**
- `_FEATURES_PACKAGES` path constant
- `_start_tts_process()` — builds env with `PYTHONPATH=./features/packages/` before `Popen`

**`static/wizard.html`:**
- Model step: mm-toggle moved out of browse tab, now shared below both tabs, default ON; mmproj picker stays browse-only
- Extras step: "Install locally" toggle + espeak status row added

**`static/js/wizard.js`:**
- `multimodal = true` default
- `_modelDownloading = false` on download success (continue button bug fixed)
- `navContinue` skips re-download if `modelPath` already set
- `enabledFn` for model step: `||modelPath` fallback
- `toggleMultimodal` + `switchModelTab` — mmproj picker only on browse tab
- `startModelDownload` — passes `include_mmproj`, handles `phase` in progress, stores `mmprojPath`
- `_applyExtrasStatus` — local/system/espeak all surfaced; `localInstall` toggle controls skip logic
- `toggleLocalInstall()` function
- Boot: ring + button only show after TTS boot completes (`_markBootDone`)
- `fetch('/api/setup/complete')` called on boot ready

---

## Session notes — 2026-04-21 (Quick wins + duplicate bubble fix)

**Chara card fields wired. first_mes injected. Duplicate bubble fixed. Species color-shift. Image lightbox. Voice warning.**

### What changed

**`scripts/wizard_compile.py`:**
- 5 new builder functions: `_build_description`, `_build_scenario`, `_build_first_mes`, `_build_system_prompt`, `_build_post_history_instructions`
- `scenario` field fixed — was wrongly using `personality.lore`; now generates from relationship type + closeness band
- `description` field extended — appearance prose + archetype + traits + comm style
- `first_mes` auto-generated at compile — archetype × closeness band templates (12 variants). Stored in `config.json` + V2 card
- `system_prompt` — character anchor instruction block, `{{char}}` placeholder, stored in `config.json` + V2 card
- `post_history_instructions` — cognitive stack framing at prompt end, `{{char}}` placeholder, stored in `config.json` + V2 card
- `creator_notes` — auto-populated SENNI export note

**`static/js/chat.js`:**
- `_resolveTemplate(str)` — substitutes `{{char}}` → companionName, `{{user}}` → "you"
- `_injectFirstMes()` — injects `config.first_mes` as first companion bubble when `conversationHistory.length === 0`; called in `startSession()` (fresh load) and `newChat()` (!keepVisible only)
- `buildSystemPrompt()` — `config.system_prompt` prepended; `config.post_history_instructions` appended (skipped for heartbeat mode)
- `triggerFirstRun()` — fixed duplicate bubble bug: missing `streamWasRendered()` guard caused streaming bubble + `appendMessage` both firing. Added `_attachMessageControls` on non-streaming fallback path too
- `_openImageLightbox(src, alt)` — fullscreen overlay on `msg-img` click; close via click or Escape

**`static/companion-wizard.html`:**
- `SPECIES_COLORS` lookup table (8 species → hex)
- `_updatePortrait()` — always shows silhouette now; species color applied via `svg.style.color`. Emojis no longer shown in portrait/orb (still used in review header + compile orb)

**`static/js/companion-tts.js`:**
- `_cpTtsRenderAll()` — injects warning banner when TTS available but voice list empty after init

---

## Session notes — 2026-04-19 #4 (Setup Wizard — extras install, TTS boot, intro redesign)

**Extras install wired. TTS startup on boot. Model continue button fixed. Intro layout redesigned.**

### What changed

**`scripts/setup_router.py`:**
- `POST /api/setup/install-extras` — installs `kokoro` and/or `chromadb` via pip with SSE progress (status per package, progress pct after each, done on completion)
- `GET /api/setup/status` — now falls back to scanning `llama/` and `models/` default dirs when config path is missing/stale (`_scan_default_binary`, `_scan_default_model`)
- `POST /api/setup` handler — now accepts `tts_enabled` and `memory_enabled` booleans; patches `config["tts"]["enabled"]` and `config["memory"]["enabled"]` before saving

**`static/js/wizard.js`:**
- `_installExtras()` — replaced stub with real `_streamPost` call to `/api/setup/install-extras`
- `_modelDownloading` flag — disables Continue during active model download; `cancelModelDownload()` now calls `_refreshContinue()`
- `_startBoot()` — sends `tts_enabled`/`memory_enabled` in `/api/setup` body
- `streamBootLog()` — after "Server is ready", if TTS selected: runs `_bootStartTts()` then shows "Say hello →"
- `_bootStartTts(logEl)` — calls `/api/tts/start`, logs "→ Starting voice system…" + result
- `_initMeetStep()` / `hearSenni()` — "▶ Hear Senni" button on meet step; shows only if TTS installed; calls `/api/tts/speak` with preset greeting, plays WAV
- Intro step: `_initMeetStep()` hooked into `goTo('meet')`

**`static/wizard.html`:**
- Intro step redesigned: heading row + Senni orb/bubble row + button row as direct `wiz-pair` children
- `senni-orb-col` wrapper groups orb+name+mood for row layout
- `step-intro` now empty (heading/button live outside `wiz-content`)
- `hear-senni-btn` added to meet step

**`static/css/wizard.css`:**
- `.wiz-pair.intro` — column with 3 children: heading row, senni-panel row, button row
- `.intro-heading-row`, `.intro-btn-row` — hidden outside intro, shown in intro
- `.wiz-pair.intro .wiz-content` — hidden during intro
- `.wiz-pair.intro .senni-panel` — flex-row for orb-left / bubble-right layout
- `.senni-orb-col` — column wrapper for orb+name+mood
- Bubble tail overrides for intro (left-pointing triangle)
- `.senni-placeholder` — uses `static/images/senni_placeholder.jpg` with gradient fallback
- `.btn-hear-voice` — green pill button style for "Hear Senni"
- Intro orb bumped to 170px

### Senni portrait placeholder
- `static/images/senni_placeholder.jpg` — drop Senni's portrait JPG here. Referenced in `.senni-placeholder` CSS. Falls back to crimson→violet gradient if file missing.

### Default Senni companion — first message note
When building the Senni companion folder, her first unprompted message should reference the setup completion:
> "Now that we've got everything up and running — nice to properly meet you! I'm Senni…"

---

## Session notes — 2026-04-19 #3 (Setup Wizard UI polish)

**Hardware selection redesign, system check continue button, intro cleanup, engine path display, continue button fix.**

### What changed

**wizard.html:**
- Intro step: removed redundant sub paragraph (Senni's speech covers it), button centered
- Engine step: replaced flat gpu-row with 2-level hardware selection — category cards (Graphics Card / No GPU), brand chips (NVIDIA/AMD/Intel Arc/Other), build variant cards (reuse model-card style)
- Engine file section: added `engine-path-display` div showing `dim-dir/` + `green-filename` after chip

**wizard.css:**
- `.hw-cat-row`, `.hw-cat-card`, `.hw-cat-icon`, `.hw-cat-name`, `.hw-cat-sub` — category card styles
- `.model-badge.fallback` — grey badge for Fallback/No GPU/No extras
- `.file-path-display`, `.path-dir`, `.path-file` — split path display
- Fade-up animation on brand/build sections

**wizard.js:**
- State: replaced `selectedGPU` with `hwCategory`, `gpuBrand`, `selectedBuild`; added `_checkDestination`, `_lastDetected`
- `selectGPU()` → `selectHWCategory()`, `selectGPUBrand()`, `selectBuildCard()`, `_updateEngineDlBtn()`
- `setDetectedGPU()` → `setDetectedHW(gpu, buildType)` — auto-selects all 3 levels from status API response
- `CONTINUE_MAP` now includes `check` step (enabled once `_checkDestination` set)
- `navContinue()` handles check step via `_proceedFromCheck()`
- `runSystemCheck()` sets `_checkDestination` / `_lastDetected` + calls `_refreshContinue()` instead of auto-navigating
- `_updateFooter()` now clears `visibility:hidden` on continue button (was set on init, never cleared — root cause of "no continue after download" bug)
- `setFileDisplay()` populates `engine-path-display` for binary type
- `browseFile()` passes `initial_dir` to `/api/browse` when path already known
- `downloadEngine()` sends `build_type: selectedBuild` instead of `gpu_type: selectedGPU`
- `_startBoot()` updated from `selectedGPU` → `gpuBrand`

**server.py:**
- `_run_file_dialog()` accepts `initialdir` param; only applied if path exists on disk
- `api_browse` extracts `initial_dir` from request body and passes it through

---

## Session notes — 2026-04-19 #2 (Setup Wizard backend wiring)

**All 4 `/api/setup/` endpoints live. `/wizard` route fixed. First-run detection updated.**

### What changed

**`scripts/setup_router.py` created (new APIRouter, included in server.py):**
- `GET /api/setup/status` — binary path + exists, model path + exists, GPU detection, build type, oneAPI present
- `GET /api/setup/models` — MODELS list (easy to extend: add entries at top of file)
- `POST /api/setup/download-binary` — fetches latest llama.cpp release from GitHub, finds right asset via BINARY_PATTERNS dict, downloads with SSE progress (queue-based threading), extracts to `./llama/`, saves path to config
- `POST /api/setup/download-model` — downloads GGUF from HuggingFace with SSE progress, saves to `./models/`, saves path to config
- GPU → build type mapping: nvidia→cuda, intel→sycl (with oneAPI fallback to vulkan), amd→vulkan, cpu→cpu
- SSE format: `{type: "progress"|"status"|"done"|"error", ...}`

**`server.py` changes (3 surgical edits):**
- Setup router included at top (before TTS/memory routers)
- `GET /wizard` route added — fixes the Settings → About → Re-run wizard 404
- `/` root route updated: checks `model_path` exists on disk instead of `first_run` flag

**`static/js/wizard.js` changes:**
- `runSystemCheck()` updated to call `/api/setup/status` (new field names: `gpu`, `binary_found`, `binary_path`, `model_found`)
- `downloadEngine()` — real SSE download replacing stub
- `startModelDownload()` — real SSE download with AbortController for cancel
- `_streamPost()` helper added — generic POST + SSE stream consumer
- `_formatSpeed()` helper added — formats bytes/sec to human-readable

**`static/wizard.html`:**
- Model card `data-model` IDs updated to match MODELS list IDs (`gemma4-e4b-q4km`, `qwen35-9b-q4km`)

### Known pending (Phase 1)
- `_installExtras()` in wizard.js still a stub — needs `/api/setup/install-extras` endpoint (pip install kokoro/chromadb + SSE)
- Senni companion folder not yet created
- End-to-end test on clean install

---

## Session notes — 2026-04-19 (Setup Wizard redesign)

**Full ground-up redesign of `static/wizard.html` + companion CSS/JS. Distribution roadmap planned.**

### What changed

**Tauri distribution roadmap (BACKLOG.md):**

- Architecture decision: no separate launcher. Tauri wraps existing web UI, Python as PyInstaller sidecar.
- Phase 1 = setup wizard expansion (this session). Phase 2 = PyInstaller sidecar. Phase 3 = Tauri shell.
- SignPath Foundation (free OSS) for Windows code signing — eliminates SmartScreen warning.
- Aurini concept absorbed into SENNI. No separate project.

**`design/SETUP_WIZARD.md` created** — full spec:

- Fullscreen two-column layout (Senni panel 260px left, content flex-1 right)
- Per-step Senni speech + mood + color table
- GPU→binary mapping (NVIDIA→CUDA, Intel Arc→SYCL, AMD→Vulkan, CPU→CPU)
- Installable components: llama-server, model, Kokoro TTS (optional), ChromaDB memory (optional)
- Default models: Gemma 4 E4B Q4_K_M (recommended ~3GB), Qwen 3.5 9B Q4_K_M (more capable ~5.5GB)
- Meet Senni final step — prominent Chat button + secondary "Create your own" chip
- Backend endpoints needed: `/api/setup/status`, `/api/setup/download-binary`, `/api/setup/models`, `/api/setup/download-model`

**`static/wizard.html` full rewrite:**

- Fullscreen layout matching companion wizard visual language exactly
- Steps: check → welcome → engine → model → extras → boot → meet
- Senni guide panel: animated portrait placeholder (crimson→violet gradient), mood chip (dot + label), per-step Lora italic speech
- Step-extras: TTS + Memory feature cards with SVG icons, both default ON
- Step-meet: meet-card (portrait placeholder + "Chat with Senni" button) + "Design your own companion →" secondary chip
- Nav: 4 numbered dots (Engine / Model / Features / Start up)

**`static/css/wizard.css` full rewrite:**

- Root vars: `--senni-ring`, `--senni-glow`, `--text-bright`, `--purple`
- Animations: `meshShift`, `senniRingPulse`, `moodPulse`, `speechFadeIn`, `stepIn`, `popIn`
- `.senni-placeholder` gradient: crimson (#be123c) → violet (#7c3aed), matches Senni's actual hair colors
- All companion-wizard layout patterns ported in

**`static/js/wizard.js` full rewrite:**

- `SENNI_GUIDE` object: per-step mood name, hex color, speech text
- `goTo(name)` — centralized navigation: updates step visibility, Senni panel, nav dots, footer state, triggers `_startBoot()` when entering boot
- **Fixed**: `goTo()` was defined twice (first def was dead code). Merged into single clean definition.
- State: `currentStep`, `selectedGPU`, `enginePath`, `modelPath`, `mmprojPath`, `multimodal`, `featTts`, `featMemory`
- All engine/model/extras downloads are stubs pending Phase 1 backend wiring

### Known pending

- Phase 1 backend wiring: 4 `/api/setup/` endpoints (all stubs currently)
- Senni companion folder (`companions/senni/`) not yet created — placeholder orb used
- Main Chat UI redesign should happen before Tauri wrapping

---

## Session notes — 2026-04-17 #6 (Wizard session 7)

**Wizard — Inkscape-traced silhouettes (female/male/neutral), SVG gen tool, gender chip wiring, icon pass.**

### What changed

**Inkscape silhouette workflow:**

- Hand-coded SVG bust attempts all produced hourglass shapes → pivoted to Inkscape Trace Bitmap (multicolor mode) → Path > Union → Plain SVG export
- User got 4 reference images from Grok (2 male variants, 1 female long hair, 1 neutral)
- Resulting paths embedded as constants: `_SILHOUETTE_PATH` (female), `_MALE_PATH`, `_NEUTRAL_PATH`

**ViewBox values (QA confirmed):**

- Female: `"20 20 115 154"` — A4 space mm units, head ~7px from top at 155px wide
- Male: `"265 198 340 420"`
- Neutral: `"0 195 848 960"` — full canvas width

**Gender chip wiring:**

- `_getSilhouette()` reads `_data.appearance.gender` → returns correct SVG string
- `_updatePortrait()` calls `_getSilhouette()` — gender switching automatic, no extra hook needed
- `_onSpeciesChange` calls `_getSilhouette()` so silhouette restores to correct gender when special species deselected
- Both orbs use `overflow: hidden` + `border-radius: 50%` for circle cropping
- Small orb: `width: 64px; margin-top: 6px`

**Icon pass (complete — species deferred):**

- Import zone: upload arrow SVG
- Adult toggle: crescent moon SVG
- Step gate: padlock SVG
- Species emoji (elf/vampire/etc.) deferred — will use color-shifting short-term, silhouette variants long-term

**SVG gen tool (functional, parked):**

- `svg_gen_server.py` + `svg_gen.html` at project root
- Standalone FastAPI on port 8082, boots llama-server on 8083
- Run: `python svg_gen_server.py --model "path/to/model.gguf"` (needs chat-template model)

**Docs:**

- `BACKLOG.md` created — single source of truth for all pending work, replaces "Pending for next session" and "Design sessions needed" in CLAUDE.md

---

## Session notes — 2026-04-17 #5 (Wizard session 6)

**Wizard — Import QA fixes, icon style pass, neutral bust silhouette.**

### What changed

**Import QA fixes:**

- Custom chip values not restoring → `_restoreUI()` now detects values without matching static chip
- Adult chips not restoring → `_renderStep6()` restores from `_data.adult` after `_initChipGrids(el)`
- Heartbeat + memory toggles not restoring → `_restoreUI()` syncs toggle states and panel visibility
- Avatar not showing after PNG import → `_importCard(card)` now called inside `reader.onload`
- Duplicate entries on custom chip edit → old value removed before pushing new value
- Cognitive archetype not restoring → `_restoreUI()` handles `data-archetype` / `_selectArchetype()` separately
- `avatarData` in `wizard_selections` → stripped at compile time (PNG image is the avatar, no double-embed)

**New utility:**

- `read_card.py` — `python read_card.py companions/FOLDER/character_card.png` to inspect embedded chara JSON

**Icon style pass:**

- All 4 type card icons: notebook+pen (Assistant), two-person (Friend), sprout+ellipse (Companion), wand+star (Role-play)
- Neutral bust silhouette in portrait orb and wiz-orb corner

---

## Design folder

Large design decisions live in `design/` as standalone docs. These are NOT loaded into context automatically — search project knowledge when you need them.

| File                        | Contents                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BACKLOG.md`                | All pending work — quick wins, design sessions, on-hold items. Check this at session start.                                         |
| `design/ARCHITECTURE.md`    | Modularity plan, completed refactors, planned modules, script/stylesheet load orders.                                               |
| `design/BOOT.md`            | Boot & process lifecycle, TOCTOU problem, per-OS path resolution, file browsing via tkinter                                         |
| `design/SYSTEMS.md`         | Current state: Orb, Presence, Heartbeat, Companion window, Settings dirty tracking, Chat tabs, Vision mode, associative memory pill |
| `design/TTS.md`             | Kokoro TTS architecture, config schema, Aurini integration boundary, what's done/pending                                            |
| `design/FEATURES.md`        | All planned features and changes, grouped by area                                                                                   |
| `design/MEMORY.md`          | Full memory architecture — primitives, composites, primitive_ratios, retrieval, consolidation, ChromaDB stack.                      |
| `design/COMPANION_STACK.md` | Cognitive function stack format, O+J axis pairing, charge as directionality, stack position as probability.                         |
| `design/ORB_DESIGN.md`      | Orb positioning, layout modes, CSS variable documentation                                                                           |
| `design/MOOD.md`            | Mood system — full design + implementation notes. Config schema, default moods, orb schema translation.                             |
| `design/SETUP_WIZARD.md`    | Setup wizard — step flow, GPU→binary mapping, animation principles, backend endpoints needed.                                       |
| `design/WIZARD.md`          | Companion Creation Wizard — V2 character card format, Birth Certificate architecture, step flow, appearance sub-steps.              |
| `design/CHARA_CARD.md`      | Chara card V2 field reference, SENNI alignment, soul file best practices, first_mes, system_prompt, character_book/lorebook design. |
