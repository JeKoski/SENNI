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
- **Surface tradeoffs, don't pick silently** — if multiple valid approaches exist, name them and let user choose. If a simpler path exists than what was asked for, say so. If something is unclear, stop and ask rather than assuming.
- **Stop and check in** if things start going wrong rather than pushing through. Escalating complexity when stuck makes things worse.
- **Never ask the user to remember to do things** at specific times — ADHD means this won't work. Automate it or build it into existing flows instead.
- **Suggest Extended Thinking** and/or Opus when the architecture is genuinely uncertain or a wrong call would cause cascading problems. For most feature work, standard Sonnet is fine.
- **Goal-driven execution** — for any non-trivial task, define success criteria upfront before writing code. e.g. "Fix the scenario field" → "wizard_compile.py outputs correct scenario value; round-trip import restores it." Verifiable goals enable looping to completion without constant check-ins.
- **End every session by updating CLAUDE.md, BACKLOG.md, and any relevant design docs.** This is non-negotiable — it's what makes the next session productive.
- **PyInstaller build compatibility** — all Python code must stay bundle-safe:
  - Never use `__file__` for runtime paths — import constants from `scripts.paths` instead (`RESOURCE_ROOT`, `DATA_ROOT`, named constants)
  - Any pip extra with native extensions (`.pyd`/`.so`) must install into `python-embed` via `"embed"` mode — `--target` breaks DLL loading on Windows
  - New subprocess wrappers must use `PYTHON_EMBED_DIR` from `scripts.paths` to find `python.exe` in frozen mode
  - New static resource directories must be added to `DATAS` in `senni-backend.spec`
  - After dynamic `sys.path` changes in frozen mode, call `importlib.invalidate_caches()`

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

## Session notes — 2026-04-26 (Quick wins + memory instruction rewrite)

**4 quick wins shipped. Memory system instructions fully rewritten.**

### What changed

**`static/js/wizard.js` — boot spinner delayed until TTS ready:**
- Removed premature `ring.classList.add('done')` at llama-server ready signal. Ring now keeps spinning until `_markBootDone` fires (after TTS resolves, or immediately if TTS disabled). "Say Hello" button was already correctly delayed — only the ring flip was wrong.

**`static/chat.html` + `static/css/messages.css` + `static/js/tts.js` + `static/js/chat-controls.js` — TTS stop button:**
- Added `#tts-stop-btn` (amber ♪, distinct from red generation stop). Appears when TTS is fetching or playing, disappears when queue empties.
- `_ttsUpdateStopBtn()` called at 4 state transitions: `_ttsEnqueue`, `_ttsDrainFetchQueue` end, `_ttsPlayNext` when queue empties, `ttsStop`.
- `stopGeneration()` now also calls `ttsStop()` — pressing ■ kills both stream and audio.

**`static/companion-wizard.html` — appearance step titles swapped:**
- Eyebrow now static: "Step 02 — How do they look?". H1 gets the sub-step label ("Foundation", "Body", "Face", etc.) via `id="step2-heading"`. Removed `id="step2-eyebrow"` (no longer dynamic).

**`static/companion-wizard.html` + `scripts/config.py` — avatar PNG normalization:**
- `write_avatar_file` (config.py) now converts to PNG via Pillow (RGBA, `img.save(png)`). Falls back to original format if Pillow unavailable. All companion avatars now saved as `.png`.
- `wizFinish` is now `async`. If no avatar uploaded, `_avatarFallbackPng()` renders the species silhouette SVG to a 512×512 canvas with species color + dark background, outputs PNG. Runs during compile animation — no visible delay.

**`static/js/system-prompt.js` — full refactor + memory instruction rewrite:**
- Shared semantic text extracted into `_buildMemFileBlock(rule2, agencyMode)` and `_memEpisodicBlock` constant. Gemma4 and generic paths no longer duplicate content — generic path appends `_memFileXml` + `_memEpisodicXml` on top of the same semantics.
- `soul_edit_mode` config now wired into system prompt via `_memSoulBlock(agencyMode)`. Four modes (display names match Wizard): Settled (user_profile.md only), Reflective (+ self_notes.md), Adaptive (+ companion_identity.md), Unbound (full freedom).
- Removed stale `Types: Fact (S) . Concept (N) . Vibe (F) . Logic (T)` — no `type` field in write_memory schema.
- Removed numerical estimates from write_memory ("sparingly 2-5") — replaced with qualitative triggers.
- `supersede_memory` added to episodic section header.
- De-duplication rule added: one fact, one place.
- `mind/` now described with topic file support (`mind/<topic>.md` for projects, collaborations).
- Generic XML write_memory example no longer includes `<parameter=type>Fact</parameter>`.

**`static/js/tool-parser.js` + `tools/memory.py` + `tools/write_memory.py` + `tools/retrieve_memory.py` — tool description updates:**
- `memory`: positive framing, `mind/` "not loaded into active context automatically", `memory/` archive reference removed.
- `write_memory`: dropped "sparingly 2-5", now "encode a vivid moment, insight, or meaningful fact".
- `retrieve_memory`: tighter phrasing, same meaning.

### Next session
- Settings: Features tab (post-wizard reconfiguration)
- Gemma4: observe console logs during real tool call session — debug logging is in place (Path F + plain reply log)
- soul_edit_mode: verify branching works correctly for each mode in a real session

---

## Session notes — 2026-04-24 #6 (Senni template wiring + Gemma4 rescue)

**Senni avatar wired. Gemma4 partial tool call rescue added.**

### What changed

**`static/js/api.js` — streaming-first architecture:**
- `callModel` now streams every round (`stream: true`). No probe fetch, no double-fetch.
- `_streamFinalReply` → `_streamRound`: streams live into provisional bubble + TTS, returns `{text, thinkContent, structuredCalls, finishReason, bubbleHandle}` without finalizing.
- Tool call detection happens post-stream. Tool call rounds: `ttsStop()` + remove provisional bubble. Plain reply: `_finaliseStreamBubble()` + `ttsEndGeneration()`.
- Path A structured tool_calls now accumulated from `delta.tool_calls` during streaming (was only available from non-streaming `choice.message.tool_calls`).
- Root cause of both streaming bugs: double-fetch caused second request to fail intermittently → one-chunk fallback + TTS left in dirty state. Now eliminated.

**`static/js/chat-controls.js` — pre-existing duplicate bubble bug:**
- Regenerate and edit-resend now check `streamWasRendered()` before calling `appendMessage` — was adding a second bubble when streaming worked.

**`scripts/setup_router.py` + `static/js/wizard.js` — cancel model download:**
- `_download_to_queue`: writes to `.tmp` file, renames on success, deletes on cancel/error. Partial files no longer left at real dest path.
- `cancel_event` (threading.Event) passed to download thread; generator polls `request.is_disconnected()` every 1s and signals cancellation.
- `cancelModelDownload()`: restores card's hidden dl-btn + mm section so card UI fully resets.

**`static/css/base.css` + `static/js/chat-session.js` — offline indicator:**
- `.is-offline` CSS class: red static dot (ripple circle hidden), muted red text color.
- `_setOnlineIndicator(bool)`: called from `loadStatus()` after `config.model_running` is set, and from `watchBootLog` on ready event.

**`static/css/base.css` — default sidebar avatar:**
- `.avatar` background changed from solid `linear-gradient(135deg, #6366f1, #7c3aed)` to `rgba(129,140,248,0.12)` — matches orb body. Image avatars unaffected (`object-fit:cover`).

**`static/wizard.html` + `static/css/wizard.css` + `static/js/wizard.js` + `scripts/setup_router.py` — Features install UX:**
- Indeterminate progress bar: `fill.classList.add('indeterminate')` sets width 100% with `transition: none`. Existing `::after` shimmer sweep runs. Removed on done/error.
- Live pip log: `#extras-pip-log` div appended to extras step. `_run_pip` reads `proc.stdout` line-by-line, pushes `{"type":"log","line":"..."}` events. Backend queue loop changed from single `queue.get()` to a proper while-loop. `_streamPost` gains optional `onLog` 8th param.

### Bugs fixed / closed

| Item | Fix |
|------|-----|
| Chat: message arrives as one chunk | Streaming-first — no second request to fail |
| TTS skips / huge chunks | `ttsEndGeneration` now always called on plain reply |
| Regenerate/edit: duplicate bubble | `streamWasRendered()` check added to chat-controls.js |
| Cancel download bricks UI | Temp files + cancel event + card UI reset |
| Offline indicator always green | `_setOnlineIndicator()` wired to `loadStatus` + boot-ready |
| Sidebar avatar solid purple placeholder | Transparent background matching orb |
| Features install: static bar | Indeterminate shimmer + live pip log |

### Next session
- Quick wins batch: boot spinner until TTS ready, TTS stop button, wizard appearance step titles, wizard avatar PNG normalization
- Settings Features tab (post-wizard reconfiguration)
- Gemma tool call continuation: review console logs from Path F to determine if format mismatch is the root cause

---

## Session notes — 2026-04-24 #6 (Senni template wiring + Gemma4 rescue)

**Senni avatar wired. Gemma4 partial tool call rescue added.**

### What changed

**`scripts/setup_router.py` — auto-install Senni template:**
- `instantiate_companion_template("senni", "senni")` called in `GET /api/setup/status` — no-op if folder already exists
- `"senni_companion": bool` added to status response

**`static/js/wizard.js` + `static/css/wizard.css` — Senni avatar display:**
- `_applySenniAvatar()`: replaces `.senni-placeholder` div with `<img src="/api/companion/senni/avatar">` in `#senni-orb-icon` and `#meet-portrait`. `onerror` fallback removes img (placeholder stays on 404).
- Called at DOMContentLoaded (rerun path) and after status fetch when `detected.senni_companion` is true (first-run path).
- `.meet-portrait img { object-fit: cover }` added to wizard.css (`.senni-orb-icon img` rule already existed).

**`static/js/tool-parser.js` — Gemma4 rescue + artifact strip:**
- `rescuePartialGemma4ToolCall(text)`: finds `<|tool_call>call:name{` without closing `<tool_call|>`, locates last `}`, tries JSON parse with same unescape+relax logic as Path E. Returns `[{name, args}]` on success, `[]` otherwise.
- `stripGemma4Artifacts(text)`: removes unclosed `<|tool_call>` fragments, trailing `word|>` patterns, trailing `<|` sequences.

**`static/js/api.js` — Path F + debug logging:**
- Path F: if Gemma4 and rawText contains `<|tool_call>` but Path E missed → try `rescuePartialGemma4ToolCall()` → if rescued, execute and continue. If rescue fails → `stripGemma4Artifacts()` before bubble/TTS + console.warn.
- Debug log: all Gemma4 plain replies (no tool call matched) logged to console — enables observing actual rawText for format investigation.
- Header comment updated to include Path F.

### Bugs fixed / closed

| Item | Fix |
|------|-----|
| Senni wizard portrait: placeholder forever | `instantiate_companion_template` in status + `_applySenniAvatar()` wired to status fetch |
| Gemma4 partial `<|tool_call>` artifacts in bubble | Path F strips unclosed fragments before display |

### Remaining Gemma4 investigation
Path F and debug logging are in place. Next step: observe console logs during a real Gemma4 tool call session to determine if the root cause is format mismatch vs prose-before-call vs truncation.

---

## Session notes — 2026-04-24 #6 (removed — see git)

**`static/js/wizard.js`:**
- `_applyModelStatus`: when auto-selecting a downloaded model card, now also fills `mmprojPath` and enables multimodal if the model has a mmproj on disk. Previously only did this on user click, leaving mmproj unset when model was already downloaded.

### Bugs fixed

| Bug | Fix |
|-----|-----|
| ChromaDB always "not installed" | sys.path patch ran before dir existed + no `invalidate_caches()` |
| chromadb import: `No module named 'chromadb'` | `invalidate_caches()` missing in frozen mode |
| chromadb import: `No module named 'graphlib'` | Added stdlib zip fallback + graphlib to hidden imports |
| chromadb import: `_sqlite3` missing | Added sqlite3/_sqlite3 to hidden imports |
| chromadb import: DLL load failed (rust bindings) | Switched to embed mode; `os.add_dll_directory` for python-embed |
| Diagnostics always failing for kokoro/chromadb | Replaced import-based check with path-based `_check_extra()` |
| mmproj not auto-set on wizard re-run | `_applyModelStatus` now fills mmprojPath when auto-selecting downloaded card |

### Status
ChromaDB install pending final smoke test (switching to embed mode requires reinstall). TTS confirmed working end-to-end from previous session.

### Next session
- Verify ChromaDB smoke test (embed mode install + memory system init)
- Begin working through BACKLOG bugs (streaming, bubbles, tab order, mood pill save)
- Settings: Features tab design
- espeak bundling

---

## Session notes — 2026-04-24 #3 (Bug fixes — mood pill, bubbles, TTS chunking, wizard orb)

**5 isolated bugs fixed. ChromaDB smoke test confirmed working (user). Phase B next.**

### What changed

**`scripts/settings_router.py`:**
- GET `/api/settings`: added `mood_pill_visibility` to response (was missing — UI always fell back to `'always'`)
- POST `/api/settings/companion` allowlist: added `mood_pill_visibility` (was never written to config)

**`static/css/base.css`:**
- Added `::before { content:''; flex:1; }` on `.messages` — pushes bubbles/pills to bottom when few messages exist; spacer shrinks to 0 on overflow so scrolling still works

**`static/js/tts.js`:**
- `_TTS_SENTENCE_RE`: changed `(?:\s|$)` → `\s+` — requires real whitespace after punctuation, not end-of-buffer. Fixes false mid-token splits when streaming delivers `filename.` before the rest of the extension arrives. End-of-stream remainder handled by `_ttsFlushBuffer()`

**`scripts/tts_server.py`:**
- Added `_humanise_inline_code()` — strips backticks, replaces underscores with spaces, expands file extensions (`.md` → ` dot md`)
- `strip_markdown()` now calls `_humanise_inline_code()` before the `_MD_RULES` pass instead of silently dropping inline code

**`static/companion-wizard.html`:**
- `_buildReview()`: review step orb (`#review-avatar-icon`) now uses `_getSilhouette()` with species color instead of emoji
- `wizFinish()`: compile overlay orb (`#compile-orb-icon`) now uses `_getSilhouette()` with species color instead of emoji

### Bugs fixed

| Bug | Fix |
|-----|-----|
| Mood pill visibility not saving | Missing field in GET response + POST allowlist |
| Chat bubbles/pills anchor to top | `::before` flex spacer in `.messages` |
| TTS splits mid-filename (e.g. `file.md`) | Regex requires whitespace, not end-of-buffer |
| TTS silently drops inline code | Humanization pass: underscores→spaces, `.ext`→"dot ext" |
| Wizard review/compile orb shows emoji | Wired `_getSilhouette()` with species color into both |

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
