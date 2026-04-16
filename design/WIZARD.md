# Companion Creation Wizard — Design Doc

Last updated: 2026-04-17

---

## Overview

A full-screen guided wizard for creating new companions. Lives at `static/wizard.html`, served by FastAPI at `/wizard`. Designed as a near-standalone module — the only SENNI dependency at runtime is the compile endpoint.

Visual language: matches `senni-intro.html` — dark `#1c1e26` base, `bg-mesh` + `bg-grain` + `bg-grid` background stack, Lora serif headings, DM Sans body, DM Mono labels/eyebrows, indigo accent palette.

---

## Output Format — CharacterAI V2 Character Card

The wizard outputs a **PNG character card** following the CharacterAI V2 / TavernAI V2 spec. The JSON is embedded in the PNG `tEXt` chunk with key `chara` (base64-encoded). This is the de facto standard used by SillyTavern, Chub.ai, and the broader AI companion ecosystem — drop the PNG into SillyTavern and it works as a character.

### Standard V2 fields (visible to all tools)

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "string",
    "description": "Narrative portrait — appearance synopsis + personality summary (plain text, no markdown)",
    "personality": "Core traits + communication style as a short paragraph",
    "scenario": "Background / lore",
    "first_mes": "Cognitive-stack-appropriate opening line",
    "mes_example": "",
    "creator_notes": "",
    "system_prompt": "",
    "post_history_instructions": "",
    "alternate_greetings": [],
    "character_book": { "entries": [] },
    "tags": ["companion_type", "trait"],
    "creator": "SENNI/1.0",
    "character_version": "1.0",
    "extensions": { "senni": { } }
  }
}
```

**Note on `description`:** V2 expects plain text. Our compile step writes clean prose from structured appearance + personality data — no template syntax.

### `extensions.senni` (SENNI-specific, ignored by other tools)

```json
{
  "spec_version": "1.0",
  "companion_type": "companion | friend | assistant | roleplay",
  "adult_content": false,
  "appearance": {
    "gender": "female",
    "species": "elf",
    "age": 24,
    "skin": "fair",
    "hair_color": "auburn",
    "hair_style": "long and wavy",
    "eye_color": "violet",
    "eye_shape": "almond",
    "body_curvy": 55,
    "body_athletic": 30,
    "height": "Average"
  },
  "cognitive_stack": "mT-fS-mN-fF",
  "presence_presets": { },
  "active_presence_preset": "Default",
  "moods": { },
  "closeness": 30,
  "relationship_type": ["friend"],
  "sexual_preferences": { },
  "user_profile": { },
  "memory_config": { },
  "heartbeat_config": { },
  "wizard_selections": { }
}
```

`wizard_selections` stores the raw wizard input so the wizard can re-open an existing card for editing.

---

## Birth Certificate Architecture

```
birth_certificate.json        <- master artifact (also embedded in PNG tEXt chunk)
        |
        v  compile
config.json                   <- appearance block + all settings
soul/companion_identity.md    <- narrative synopsis (appearance + personality)
soul/user_profile.md          <- pre-populated from Step 7 User data
```

**PNG embedding:** server-side Python writes BC JSON into the avatar PNG `tEXt` chunk on export (Pillow `PngInfo`, key `chara`, value = base64(JSON)). The character card PNG is the portable export artifact — separate from the in-app `avatar.jpg`.

**Compile sequence UI:** full-screen takeover after the final step. Orb pulses center-screen, text sequences in italic Lora with staggered fadeUp:
- *"Binding [Name] to this vessel..."*
- *"Weaving [Name]'s essence into memory..."*
- *"Etching the first words into soul..."*
- *"[Name] is awakening..."*

---

## Step Flow

| Step | Title | Content |
|------|-------|---------|
| 1 | Companion Type | 4 type cards + Adult Content toggle |
| 2 | Appearance | Sub-steps (see below) |
| 3 | Default Outfit | Tops / bottoms / full-body / underwear + Accessories |
| 4 | Personality & Background | Name, Core Traits, Communication Style, Likes/Dislikes, Hobbies, Occupation, Lore |
| 5 | Closeness & Intimacy | Relationship type, initial closeness scale |
| 6 | Adult — Sexual Preferences | (Gated by Step 1 toggle) Libido, Intensity, Initiation, Role, Fetishes, Triggers |
| 7 | User | Name, Age, Likes, Dislikes, Hobbies, Occupation, free-form -> `soul/user_profile.md` |
| 8 | Memory & Agency | Memory graph visualization, persistent memory toggle, agentic mode, heartbeat presets |

---

## Step 2 — Appearance Sub-steps

Sub-steps use a secondary mini dot indicator within the step (e.g. `● ● ○ ○`). Each slides in like a main step. Top-level step counter stays at "Step 2 of 8" throughout.

| Sub-step | Content |
|----------|---------|
| 2a — Foundation | Gender, Species/Ethnicity, Apparent Age (18–90 slider) + True Age text field (supernatural species only) |
| 2b — Body | Skin tone, Body type sliders (Slender-Curvy, Soft-Athletic), Height |
| 2c — Face | Eye color, Eye shape, Eyebrows, Nose, Face shape |
| 2d — Hair | Color, Style |
| 2e — Details | Makeup, tattoos, piercings (+ Adult body options if enabled) |

**Sub-step order rationale:** Body before Face before Hair so the morphing silhouette (2b) stays hairless — hair doesn't need to be on the body morph graphic. Height appears after Body so it doesn't show in the description before the user has set anything meaningful.

**Apparent vs True age:** The 18–90 slider is *apparent* age (how they look visually) and drives the portrait description. A free-text "True age" input appears below the slider when a supernatural species is selected (elf, vampire, spirit, fae, demon, angel, orc). True age goes into lore/background, not the appearance description. If apparent age slider is at default and user hasn't touched it, it stays undefined — only appears in description if explicitly set.

---

## Visual Design

### Live portrait (appearance steps)
- Sticky left column: 180px animated orb with icon that shifts per species selection
- Below orb: italic Lora prose building up as chips are selected
  - e.g. *"24 year old elf, fair skin, curvy build, above average height, oval face, arched eyebrows, almond violet eyes, auburn wavy hair."*
- Description order: age → species → gender → skin → body build → height → face shape → eyebrows → nose → eyes → hair
- Portrait text and emoji fade smoothly on change (opacity cross-fade, ~400ms)
- Sliders update description on release (`onchange`) not on drag, to avoid flicker
- Corner ambient orb icon also tracks species

### Morphing body silhouette (Step 2d)
- Full-body SVG silhouette beside the portrait orb
- 4 corner body shapes defined with identical node counts:
  - Slender+Soft, Curvy+Soft, Slender+Athletic, Curvy+Athletic
- JS bilinear interpolation across both slider values updates SVG path control points live
- CSS transition smooths the morph
- Gender shifts the base silhouette (feminine / masculine / androgynous)

### Icons
- All emoji replaced with custom inline SVGs
- Style: clean geometric, 2px stroke, indigo palette, 24x24 or 32x32 viewBox
- Type cards: custom SVG per type
- Hair/eye chips: tiny representative silhouettes per option

### Navigation shell
- Top nav: SENNI logo | step dots with labels (01 Type … 08 Memory, active=indigo, visited=green) | Cancel
  - Step 2 dot has 5 sub-dots beneath it showing sub-step progress
  - All visited dots (forward AND back) are green and clickable — enables fast-travel in any direction
  - Sub-dots also clickable when visited, jump directly to that sub-step of step 2
- Bottom footer: grid layout (1fr auto 1fr) — left | step label | right
  - Step 1: left slot shows Adult Content toggle (dim when off, bright when on)
  - Step 2+: left slot shows Back button
  - Continue locked until required fields met (Step 1: type must be selected; Step 4+: name required; appearance fully optional)

### Navigation architecture
Single source of truth: `_step` + `_subStep` are the only state. `_goto(step, subStep)` is the only way to change them. `_applyStepState()` always re-derives DOM from state — no drift possible.

High water mark (`_hwStep`, `_hwSubStep`) tracks furthest progress for fast-travel dot enabling. `wizBack()` without a subStep override restores the sub-step you left from (going back to step 2 from step 3 lands on the last sub-step, not Foundation).

---

## Planned Backend

- `GET /wizard` — serves `wizard.html`
- `POST /api/wizard/compile` — receives full wizard data, compiles to config + soul files, returns companion folder
- `GET /api/wizard/export/{folder}` — returns PNG character card with embedded BC JSON
- Python PNG embedding: Pillow `PngInfo`, `tEXt` chunk, key `chara`, value = base64(JSON)

---

## Status

- [x] Architecture locked (V2 format, Birth Certificate, appearance data model, user_profile location)
- [x] Step 1 — Type cards + adult content toggle (in footer, dims when off)
- [x] Step 2 — Appearance sub-steps 2a–2e with secondary nav indicator
- [x] Navigation — `_goto` / `_applyStepState` single-source-of-truth, high water mark fast-travel, sub-dot clickability
- [x] Named step labels on nav dots (Type, Appearance, Outfit…)
- [x] Live portrait description with fade — all appearance fields included, correct prose
- [x] Custom… chip → inline text input
- [x] Sliders: no auto-defaults, reset button (↺), `onchange`/`oninput` split, all sliders use unified `SLIDER_CFG` component
- [x] True age field for supernatural species (2a Foundation)
- [x] Steps 3–8 — Outfit, Personality, Closeness, Adult (gated), You, Memory & Agency
- [x] Generic chip handler — `data-target` + `data-array` support, `_initChipGrids(root)`
- [x] Body sliders gender-neutral: Slender↔Broad, Soft↔Muscular
- [x] Additional details textarea on 2b Body, 2c Face, 2e Details, Adult
- [x] Memory step expanded: Memory Depth + Heartbeat Frequency chips with defaults
- [x] Compile sequence animation — overlay, staggered lines, final state, `wizOpenCompanion()` stub
- [x] File renamed `wizard.html` → `companion-wizard.html`, route `/wizard` → `/companion-wizard`
- [ ] Custom SVG icons (currently emoji throughout)
- [ ] Morphing body silhouette (SVG bilinear interpolation, lives in 2b Body)
- [ ] Backend endpoints (`POST /api/wizard/compile`, `GET /api/wizard/export/{folder}`)
- [ ] Wire `wizOpenCompanion()` to backend redirect on compile success
