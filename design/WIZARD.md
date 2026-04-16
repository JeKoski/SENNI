# Companion Creation Wizard — Design Doc

Last updated: 2026-04-16 #7

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
| 2a — Foundation | Gender, Species/Ethnicity, Age |
| 2b — Hair | Color, Style |
| 2c — Face | Eye color, Eye shape, Eyebrows, Nose, Face shape |
| 2d — Body | Body type sliders (Slender-Curvy, Soft-Athletic), Height, Skin tone |
| 2e — Details | Makeup, tattoos, piercings (+ Adult body options if enabled) |

---

## Visual Design

### Live portrait (appearance steps)
- Sticky left column: 180px animated orb with icon that shifts per species selection
- Below orb: italic Lora prose building up as chips are selected
  - e.g. *"24 year old elf, fair skin, auburn wavy hair, violet almond eyes."*
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
- Top: SENNI logo | step dots (01-08, active=indigo, done=green) | Cancel
- Bottom: Back (text) | "Step N of 8" (DM Mono) | Continue (gradient pill, locked on Step 1 until type selected)

---

## Planned Backend

- `GET /wizard` — serves `wizard.html`
- `POST /api/wizard/compile` — receives full wizard data, compiles to config + soul files, returns companion folder
- `GET /api/wizard/export/{folder}` — returns PNG character card with embedded BC JSON
- Python PNG embedding: Pillow `PngInfo`, `tEXt` chunk, key `chara`, value = base64(JSON)

---

## Status

- [x] Architecture locked (V2 format, Birth Certificate, appearance data model, user_profile location)
- [x] `static/wizard.html` — Steps 1-2 interactive (type cards, adult toggle, appearance chips + sliders, live portrait text, species icon tracking)
- [ ] Appearance sub-steps + secondary indicator
- [ ] Custom SVG icons
- [ ] Morphing body silhouette (SVG bilinear interpolation)
- [ ] Steps 3-8
- [ ] Compile sequence animation
- [ ] Backend endpoints
