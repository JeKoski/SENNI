# Setup Wizard Design

The setup wizard (`static/wizard.html`) is SENNI's first-run and reconfiguration experience.
It runs inside the existing FastAPI web UI — no separate app or installer.
When wrapped in Tauri (Phase 3), it becomes the Tauri webview's first screen. No rewrite needed.

---

## Layout

Matches the companion wizard visual language exactly:
- Full-screen, not a centered card
- Same top nav (SENNI logo left, numbered step circles + lines center)
- Same background (mesh gradient + grain + grid layers)
- Same bottom footer bar (Back left · step counter center · Continue right)
- **Two-column stage:** Senni guide panel left (~260px fixed) + step content right (flex 1, max-width ~560px centered)
- No Cancel button — can't cancel setup

### Senni guide panel
Persistent left sidebar throughout the wizard. Contains:
- Her portrait in a circle with animated ring (orb-style glow + breath). Placeholder: crimson→violet gradient orb. Replaced with `sidebar_avatar.jpg` when companion folder exists.
- Her name + mood chip below (colored dot + mood word)
- Speech text in Lora italic — changes per step, fades in on transition
- Mood color shifts per step (ring color + dot color changes)

### Senni speech + mood per step
| Step | Mood | Color | Speech |
|------|------|-------|--------|
| check | Curious | indigo | *"Let me take a quick look at your setup…"* |
| welcome | Warm | green | *"Good to see you. Everything's looking good."* |
| engine | Focused | indigo-hi | *"I need a small engine to run on. I'll grab the right one for your hardware."* |
| model | Playful | violet | *"This is basically picking my brain. Literally. Choose whichever sounds right."* |
| extras | Thoughtful | amber | *"A couple of optional extras. Voice lets me speak to you. Memory means I'll actually remember you."* |
| boot | Anticipating | indigo | *"Almost there. I'm waking up now — just a moment."* |
| meet | Ready | green | *"I'm here."* |

---

## Goals

- A complete newcomer with no terminal experience can go from nothing → chatting in one flow
- Non-technical language throughout — explain what things are, not just what to click
- Feels alive and calm — animated, never frozen-looking, good vibes
- Returning users / manual setups are handled gracefully via Browse fallbacks

---

## What the wizard does NOT expose

- **Startup arguments / launch flags** — not shown in the wizard. If the server fails to load, the user can reach Settings → Server from the main UI to adjust. Keeps the wizard focused and non-overwhelming.
- **ROCm (AMD Linux)** — too complex to automate. AMD users get Vulkan by default. However, if an AMD card is detected, show an informational note: what ROCm is, that it can improve performance, and a link to the llama.cpp ROCm docs. User can set it up manually and point SENNI at the ROCm binary via Browse.
- **oneAPI / SYCL runtime install** — wizard detects if it's present; if not, falls back to Vulkan silently. No asking the user to install GPU runtimes.

---

## GPU → binary mapping

| User's GPU | Preferred build | Fallback |
|------------|----------------|---------|
| NVIDIA | CUDA | Vulkan |
| Intel Arc | SYCL (if oneAPI detected) | Vulkan |
| AMD | Vulkan | CPU |
| CPU / unknown | CPU | — |

Vulkan is a valid first-run experience. Performance difference is minor for casual use.
User can switch builds later via Settings → Server.

---

## Installable components (wizard scope)

Everything SENNI ships with should be installable from the wizard — no terminal needed.

| Component | Required | Notes |
|-----------|----------|-------|
| llama-server binary | Yes | Downloaded in Engine step |
| Model (.gguf) | Yes | Downloaded or browsed in Model step |
| Kokoro TTS | Optional | Toggled in Extras step. pip install + voice model download |
| ChromaDB memory | Optional | Toggled in Extras step. pip install only (small) |

### Extras step (Step 3 of 4)
Two feature cards, both default ON:
- **Voice responses** — "I can speak to you out loud. Kokoro TTS runs locally, no internet needed once installed." Shows download size estimate.
- **Memory** — "I'll remember our conversations across sessions. Stored entirely on your PC." Small install, no notable download.

User can turn either off. Downloads happen when Continue is clicked (with progress), then moves to Boot.

## Default models

| Model | Badge | Size | Description |
|-------|-------|------|-------------|
| Gemma 4 E4B Q4_K_M | Recommended | ~3 GB | SENNI's primary model. Fast, capable, great for companions. |
| Qwen 3.5 9B Q4_K_M | More capable | ~5.5 GB | Better reasoning. Needs more RAM / VRAM. |

Larger models TBD — pending testing on new hardware.

## Step flow

### Step 0 — System check *(always runs, brief)*

Animated scan. Non-technical status lines, e.g.:
- "Looking for your AI engine…"
- "Checking for a model…"
- "Detecting your GPU…"

Routes based on findings:
- **Nothing found** → full first-run flow (Steps 1 → 4)
- **Binary found, no model** → skip to Step 2
- **Everything found** → Welcome back screen → option to reconfigure or go straight to boot

---

### Step 1 — AI Engine *(first-run only)*

**What it says to the user (roughly):**
> "SENNI needs a small engine to run AI locally on your PC. We'll download the right one for your hardware — it's about 15MB and only takes a moment."

- GPU displayed in friendly terms: "We found your NVIDIA GPU ✓"
- Detected binary (if any) shown as a path chip — always editable. Auto-detect is a suggestion, not a lock. A winget or PATH binary may be outdated; user should be able to Browse to a different one even when something was found.
- Browse button always visible alongside the detected path
- Download button → progress bar with:
  - File name + size
  - Download speed + estimated time remaining
  - Friendly status line ("Downloading… almost there")
  - Cancel option
- On complete: brief success state before advancing

---

### Step 2 — Model *(first-run, or re-enter if no model found)*

**What it says to the user (roughly):**
> "Now for the brain. A model is the AI itself — a file your engine loads and runs. You can download one or point SENNI at one you already have."

Two paths, equal prominence:
- **Download a starter model** — curated short list (3–4 options), each showing:
  - Friendly name (not just filename)
  - What it's good for ("Great all-rounder", "Lighter, faster")
  - File size + estimated download time
  - Progress bar with speed / ETA / cancel
- **Browse for existing .gguf** — file picker, same as current wizard. If a model is already configured (returning user), shown as a path chip that can be changed — not silently locked in.

Multimodal toggle stays here (collapsed by default, for vision-capable models).

---

### Step 3 — Extras *(optional features)*

Feature cards with toggles, both default ON:
- **Voice responses** (Kokoro TTS)
- **Memory** (ChromaDB)

Downloads triggered by Continue click, with progress bars inline. Then advances to Boot.

### Step 4 — Boot

Existing boot log step, visual refresh only.
- Friendly status lines replace raw llama-server output where possible
- Boot ring animation continues throughout
- "Something went wrong?" link → opens Settings → Server (does not try to explain the error inline)

---

### Step 5 — Meet Senni *(final, unnumbered)*

Two options, not a standard Continue:
- **Meet Senni** (prominent) — her portrait, name, one-liner tagline. Button: "Chat with Senni →"
- **Create your own** — small secondary chip below: "or design your own companion →" → Companion Creation Wizard

Senni is the predominant recommendation for new users. Creating your own is available but not pushed.

---

## Returning user / reconfiguration entry

**Entry point:** Settings → About → "Re-run wizard" navigates to `/wizard?rerun=1`.

The `?rerun=1` param causes the wizard to skip the intro screen (first-run copy) and jump straight to the system check. This is also how a factory-reset user re-enters setup.

System check detects an existing setup and shows:
> "Welcome back. Everything looks good."

Two options:
- **Continue** → skips straight to Boot (Step 4)
- **Reconfigure** → enters the flow at Step 1 (binary) or Step 2 (model), with existing values pre-filled and Browse available

This is also the path for users who installed manually and already have a binary + model — they just Browse to their files and proceed.

---

## Animation + UX principles

- **Never looks frozen** — every waiting state has motion (spinner, progress bar, animated text)
- **One thing at a time** — each step has a single focus. No walls of options.
- **Friendly status copy** — "Downloading your AI engine… almost there" not "GET /releases/download/... 200 OK"
- **Progress bars always show context** — size, speed, ETA alongside the bar
- **Quiet success** — brief checkmark/confirmation before moving on, not a big celebration for every micro-step
- **Errors don't dead-end** — if something fails, show a calm message + a path forward (retry / browse manually / skip)

Visual language matches the companion wizard: Lora headings, DM Sans body, indigo accents, dark card, thin-line icons.
Step indicator: numbered (1 of 4) rather than dots — more steps than dots handle gracefully.

---

## Backend requirements (Phase 1 implementation)

New FastAPI endpoints needed:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/setup/status` | Returns: binary path (if found), model path (if found), detected GPU, oneAPI present |
| `POST /api/setup/download-binary` | Downloads correct llama-server build for given GPU type. Streams progress via SSE. |
| `GET /api/setup/models` | Returns curated starter model list (name, description, size, URL) |
| `POST /api/setup/download-model` | Downloads selected model to a configurable path. Streams progress via SSE. |

`main.py` first-run detection: if `setup/status` returns no binary or no model → redirect `/` to `/setup` instead of `/chat`.
