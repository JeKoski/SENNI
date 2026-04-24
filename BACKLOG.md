# BACKLOG.md — SENNI Feature & Task Backlog

Single source of truth for what's next. Linked to relevant design docs where applicable.
Update at end of each session. Completed items get deleted, not struck through.

---

## High Priority

### Packaging-oriented modular refactor

Goal: reduce packaging risk before PyInstaller + Tauri by shrinking the biggest hotspots, making runtime/resource boundaries explicit, and keeping behaviour stable while structure improves.

**Refactor guardrails:**
- Refactor for packaging readiness, not for abstract code cleanliness.
- Keep endpoint shapes and UI behaviour stable unless a change is required.
- Prefer extraction and boundary cleanup over rewrites.
- Avoid deep subsystem redesigns before the first packaged build works.

**Phase A - Backend modular split**
- **History router extraction complete** — `scripts/history_router.py` owns `/api/history/*`.
- **Settings router extraction complete** — `scripts/settings_router.py` owns settings/companion/soul routes.
- **Boot service extraction complete** — `scripts/boot_service.py` owns all llama-server lifecycle: state globals, `kill_llama_server()`, `get_boot_status()`, `_build_and_launch`, `_run_subprocess`, `POST /api/boot`, `GET /api/boot/log`. `server.py` lost ~200 lines.
- **Centralize runtime path resolution** ✓ — `scripts/paths.py` owns all path constants. `RESOURCE_ROOT` (bundled assets) vs `DATA_ROOT` (writable user data) split handles PyInstaller correctly. All modules import from here.
- **Harden file/path boundaries** ✓ — `sanitize_folder()`, `sanitize_filename()`, `confine_path()` added to `config.py`. Applied at all route boundaries in `history_router`, `settings_router`, `server.py`. Path traversal via `companion_folder`, `session_id`, `filename`, and `target_folder` inputs closed.

**Phase B - Frontend chat modular split** ✓ *(complete 2026-04-24)*
- `system-prompt.js`, `chat-session.js`, `chat-send.js` extracted from `chat.js` ✓
- `chat.js` now ~230 lines (down from 1219) ✓
- Tab order fixed (sort by created) + ⋯ menu with inline rename ✓
- `design/ARCHITECTURE.md` + `chat.html` load order updated ✓
- **Streaming chunk + TTS skip bugs fixed** ✓ — stream-first architecture, single `_streamRound` call, post-stream tool detection

**Phase C - Packaging prep** *(largely complete 2026-04-24)*
- **PyInstaller resource audit** ✓ — all `__file__` antipatterns fixed in tool files; `auto_backup.py` rewritten; `diagnostics.py` uses `STATIC_DIR`; `tts_server.py` + `setup_router.py` use `PYTHON_EMBED_DIR`
- **`senni-backend.spec`** ✓ — one-dir mode, correct DATAS list, python-embed conditional, optional-extras excludes
- **`build_prep.py` + `build.bat`** ✓ — python embeddable download + pip bootstrap; auto-runs if `python-embed/` missing
- **First packaged smoke test** ✓ — bundle boots, wizard runs, TTS fully working end-to-end. ChromaDB confirmed working in embed mode ✓.
- **Extras install mode rule** ✓ — any extra with native extensions (.pyd/.so) must use `"embed"` mode (python-embed site-packages). `--target` breaks DLL loading on Windows. Both kokoro and chromadb confirmed. Pure-Python-only extras could use `"target"` but none exist currently.
- **Sidecar runtime contract** — define how Tauri launches, monitors, and shuts down the Python backend sidecar without changing the current HTTP model.
- **espeak bundling** — bundle a portable espeak-ng binary (like llama-server). Currently still a system dependency. Wizard warns if missing; auto-set `config["tts"]["espeak_path"]` on detection. Target: Phase 3 / Tauri packaging.
- **Settings "Install features" button** — post-wizard install path for users who skipped features in the wizard. Triggers same pip flow as wizard extras step.

**Do later - after first packaged build works**
- **Deep memory subsystem cleanup**
- **Major UI architecture redesign**
- **Large-scale wizard internals cleanup**
- **Broad “clean up everything” pass**

### Automated smoke testing

**Harness established (2026-04-23).** 33 tests, all green, 1.73s. Run: `python -m pytest tests/ -v`

**Files:**
- `tests/conftest.py` — `isolated_paths` fixture patches `COMPANIONS_DIR`/`CONFIG_FILE` in `scripts.config` + each router module. `test_config` writes minimal config + companion dir. Per-router `_client` fixtures use `httpx.AsyncClient(transport=ASGITransport(...))` — no real server.
- `tests/test_history_router.py` — 12 tests (save/load/list/delete, path traversal sanitisation)
- `tests/test_settings_router.py` — 12 tests (settings shape, generation/memory/companion save, soul file CRUD, protected file guard)
- `tests/test_boot_service.py` — 9 tests (state, kill, no-model-path, already-launching/ready, SSE stream)

**Pattern for each new extraction:**
1. Add `monkeypatch.setattr` lines in `conftest.isolated_paths` for any new module-level constants
2. Add `_client` async fixture
3. Write `tests/test_<module>.py`

**Not in scope yet:** full boot flow (requires llama-server binary), TTS, ChromaDB memory, setup_router, GitHub Actions CI.

---

### Tauri distribution - phased roadmap

Goal: zero-dependency install for end users. Double-click → runs. Auto-updates. No terminal, no Python knowledge required.

**Architecture decision (2026-04-19):**
- No separate launcher app. Aurini concept absorbed into SENNI.
- Tauri wraps the existing web UI in a native shell. Python backend runs as a PyInstaller-compiled sidecar.
- Frontend (HTML/CSS/JS) is served by FastAPI as today — no frontend recompile needed for UI updates.
- Release flow: `git tag vX.Y.Z && git push --tags` → GitHub Actions builds Windows + Linux binaries → auto-update notification to existing users.
- Code signing: apply for **SignPath Foundation** (free for OSS) — eliminates Windows SmartScreen warning.

**Phase 1 — First-run setup wizard** *(pre-Tauri, ships with Python)*
Visual redesign + step structure complete (`wizard.html` / `wizard.css` / `wizard.js` rewritten 2026-04-19).
Backend wiring complete (2026-04-19 session 2): `scripts/setup_router.py` added with all 4 endpoints live.
Remaining Phase 1 work:
- **espeak-ng install/bundle** — espeak is a system binary (not pip). Wizard detects and warns if missing. For distribution: bundle a portable espeak-ng binary inside the Tauri package, auto-set `config["tts"]["espeak_path"]`. Deferred to Phase 3 / Tauri packaging.
- **Checksum verify on downloads** — not yet implemented. llama.cpp releases don't publish checksums; could do size check only.
- **Senni companion folder** (`companions/senni/`) — create with config + avatar so Meet Senni step shows real portrait. Portrait placeholder JPG already at `static/images/senni_placeholder.jpg`.
- **End-to-end test** — run wizard on a clean install to verify binary download + extraction + model download + extras install flow

**Phase 2 — PyInstaller sidecar**
Compile Python backend (`main.py` + all scripts + static files) into a single binary via PyInstaller.
- Windows: `senni-backend.exe`
- Linux: `senni-backend`
- GitHub Actions build step — never compiled manually; prerequisite for Phase 3
- **`main.py` entry point** ✓ — exists, uses direct `from scripts.server import app` import (PyInstaller-friendly).
- **`output_dir` refactor** ✓ — `wizard_compile.py` uses `COMPANIONS_DIR` from `scripts.paths`, which resolves to `DATA_ROOT/companions` (writable) in bundled mode. No fix needed.
- **Next: write PyInstaller spec** — after Phase C audit completes.

**Phase 3 — Tauri shell**
Tauri wraps the webview, manages the Python sidecar, provides tray icon + window chrome.
- Webview points to `http://localhost:8000` (same as browser today)
- Sidecar: the PyInstaller binary from Phase 2
- Auto-updater wired to GitHub Releases
- GitHub Actions builds full Tauri package for Windows (.msi / .exe) and Linux (.AppImage)
- `output_dir` refactor in `wizard_compile.py` prerequisite for clean packaging

*Note: macOS not a current target. Requires Apple Developer account ($99/yr) for notarization.*

---

---

## Housekeeping

- **Docs audit** — go through all `design/*.md` docs to prune stale content and move any buried to-dos into BACKLOG.md. WIZARD.md still needs looking through.
- **SYSTEMS.md freshen-up** — lists mood system and companion-mood.js as "not yet built" but both were completed 2026-04-13. Needs a pass to reflect current state.

---

## Bugs

- **Gemma parsing: broken tool call continuation** — Gemma 4 sometimes ends a turn with "I'll call those tools now" without actually emitting the tool call, or trails off with `channel|>` or similar artefact. Likely tries to continue a reply after the jinja template closes the turn. Needs investigation of the jinja template and any post-processing that strips partial tokens.


---

## Quick Wins

*Ready to build — no design conversation needed.*

- **Senni app icon** — design and add an icon for the binary (`.ico` for Windows PyInstaller spec), wizard header, and elsewhere in the UI. Needs design conversation for the visual; wiring into the spec is straightforward once an `.ico` exists.
- **Setup: Boot spinner stays active until TTS ready** — on the boot step ("Bringing your companion online"), the spinner flips to ✓ as soon as llama-server is ready, but TTS service can take several more seconds to load. Keep the spinner running and delay showing the "Say Hello →" button until TTS also reports ready (or a short grace-period timeout if TTS is disabled/unavailable). Prevents the user clicking through before voice is usable.
- **Setup: Manual path entry for features** — add optional path fields to the Features step for users who already have kokoro/chromadb installed globally or in a custom location. Entering a path should skip the local install and let setup boot TTS/memory cleanly. Also add a "skip, I'll configure later" option so setup can complete without installing.
- **Settings: Features tab** — new tab in Settings consolidating all optional-feature paths and status. Should include: TTS enable/python path/espeak path/voice path (currently scattered), ChromaDB enable/packages path, per-feature reinstall/detect buttons. Goal: full post-wizard reconfiguration without re-running setup.
- **TTS: Stop button for current generation** — add a stop/cancel button that appears while TTS is generating for a message. Aborts the in-flight `/api/tts/speak` request and stops any playback.
- **Mood → TTS override UI** — speed/blend per mood in Companion Settings Mood tab. Schema already in config, just needs UI. See `design/TTS.md`.
- **History folder pruning** — WAV voice files + images accumulate in session folders with no cleanup. Need a pruning strategy (auto-delete media older than N days, or manual "clean up" action). See `design/FEATURES.md`.
- **Mid-session gap detection** — long idle → re-inject updated timestamp into system prompt. Piggyback on consolidation idle timer. Low priority.
- **Tool settings UI** — global enable/disable per tool + per-companion overrides. Settings > Tools tab. See `design/FEATURES.md`.
- **llama-server args drift** — launch args in `server.py` may have drifted from current llama.cpp API. Needs a pass against current docs.
- **Import QA round-trip** — ongoing edge case testing as real use surfaces issues.
- **Companion Wizard appearance step titles** — swap subtitle/heading order. Currently: small="Step 02 - face", large="How do they look?". Should be: small="Step 02 - How do they look?", large="Face". Apply to all appearance sub-steps.
- **Companion Wizard avatar PNG normalization** — on compile, convert avatar to PNG regardless of upload format (JPG, WEBP, etc.) so embedded card image is always PNG. If no avatar uploaded, render the current silhouette SVG to a PNG canvas and use that. Prevents blank avatar slot.
- **Setup Wizard — model step downloaded state on load** — `_applyModelStatus` runs during system check, but if user navigates directly to model step without running check (e.g. back-nav from engine step), downloaded state won't be applied. Consider calling `_applyModelStatus` also on `goTo('model')` with a lightweight fetch, or caching last status.
- **Setup Wizard — system check extras reporting** — extend the system check step to detect extras (same logic as `GET /api/setup/extras-status`). Show result inline only if found ("✓ Kokoro found at …"). Loading label "Checking for extras…" disappears silently if nothing found.
- **Settings — show resolved paths for extras** — after wizard or detection, Settings should display `./features/packages/` path and espeak binary path so user can verify what's actually being used. Paths already stored in config; just needs Settings UI wiring.
- **Setup Wizard — skip steps on rerun** — when wizard is launched a second time (not first-run), allow skipping steps where existing valid config is already detected. Each step should show a "Skip — already configured" option when the relevant asset is present.

---

## Needs looking into

- **Companion Mood activation** — Companions use moods inconsistently or not at all. How are we instructing mood tool usage? Something we should change?

---

## Design Sessions Needed

*Too open-ended to task out. Need a dedicated design conversation first.*

- **Companion Wizard orb animations** — the orb needs to feel alive throughout the whole wizard (currently too static). Requirements gathered: orb present on every step; gentle idle bounce + swirling energy effect; first step shows empty orb (no silhouette, just the circle + ambient color/glow). Silhouette appears only after type/gender chosen, disappears if deselected. Each user selection optionally streams particles into the orb. Needs reference images, animation spec, and a discussion of what's feasible in CSS/canvas vs. too resource-heavy. Design conversation before any implementation.
- **Companion type card theming + orb color absorption** — each companion type card (Assistant / Friend / Companion / Role-play) should have its own color theme. Selecting a type changes the orb's color scheme, as if the orb absorbs that "energy" and takes that shape. If particle streaming is implemented, the color shift should be delayed until particles start arriving and fade in until they stop. Each type also ships with a corresponding default Presence preset baked in. Needs color palette decisions and animation timing spec. Ties into orb animation design session above.
- **Companion Templates section** — premade companions that ship with SENNI, plus a way for users to recreate existing companions from within the app. Entry point: a button near the Import button that opens a selection window. Needs design: how templates are stored (JSON? partial config? full companion folder zip?), how they're browsed, whether user can submit community templates. See `design/FEATURES.md` → Companion section.
- **Main Chat UI redesign** — "smoother, fuller, cozier". The companion wizard has established the visual language — now apply it to the main app. Known starting points: sidebar companion state card (mood, recent memory), memory viewer/editor panel. Do this before Tauri so the app Tauri wraps is already polished. See `design/FEATURES.md` → Sidebar/UI section.
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
- **Tauri shell (Phase 3)** — waiting on Phase 1 + 2. See Tauri roadmap in High Priority.
