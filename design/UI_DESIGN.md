# SENNI UI Design System

Visual language reference for all SENNI UI surfaces. Two wizards established this system — keep new work consistent with it.

**Living showcase:** open `static/ui-showcase.html` in a browser to see all components rendered and interact with the orb studio.

---

## 1. Color Tokens

All defined in `static/css/wizard.css:4-22` (also duplicated in `base.css:4-22`).

### Background & Surface

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#1c1e26` | Page background |
| `--bg2` | `#21232e` | Panels, sidebars, modals |
| `--surface` | `rgba(255,255,255,0.04)` | Card backgrounds |
| `--surface2` | `rgba(255,255,255,0.07)` | Hover surface, elevated cards |

### Borders

| Token | Value | Usage |
|---|---|---|
| `--border` | `rgba(140,145,220,0.15)` | Default edges |
| `--border-hi` | `rgba(129,140,248,0.5)` | Focused / selected / highlighted |

### Text

| Token | Value | Usage |
|---|---|---|
| `--text` | `#dde1f0` | Primary body text |
| `--text-bright` | `#eef0fb` | Emphasized, headings |
| `--text-muted` | `rgba(221,225,240,0.45)` | Secondary, descriptions |
| `--text-dim` | `rgba(221,225,240,0.22)` | Disabled, tertiary |
| `--label` | `rgba(221,225,240,0.38)` | UI control labels |

### Accent

| Token | Value | Usage |
|---|---|---|
| `--indigo` | `#818cf8` | Primary accent, orb default, active states |
| `--indigo-hi` | `#a5b4fc` | Bright indigo for text on dark |
| `--indigo-glow` | `rgba(129,140,248,0.12)` | Subtle fills, ghost hover bg |
| `--purple` | `#a78bfa` | Secondary accent, gradient end |

### Semantic

| Token | Value | Usage |
|---|---|---|
| `--green` | `#6dd4a8` | Success, step complete, set state |
| `--red` | `#f87171` | Error, destructive |
| `--amber` | `#fbbf24` | Warning, info notes |

### Gradients

| Name | Value | Usage |
|---|---|---|
| CTA gradient | `linear-gradient(135deg, #6366f1, #7c3aed)` | Primary buttons |
| Progress gradient | `linear-gradient(90deg, #6366f1, #a78bfa)` | Progress bars, download fill |

---

## 2. Typography

Imported from Google Fonts (`wizard.html:8-9`). Three families, each with a clear role.

### Font Families

| Family | Role | Weights |
|---|---|---|
| **Lora** (serif) | Headings, brand name, eyebrows, narrative | 400, 500, italic |
| **DM Sans** (sans) | Body text, buttons, UI controls | 300, 400, 500, italic |
| **DM Mono** (mono) | Labels, metadata, step counters, file paths, code | 400 |

### Scale (`wizard.css:384-397`)

| Use | Size | Family | Weight | Notes |
|---|---|---|---|---|
| Intro heading | 46px | Lora | 400 | line-height 1.25, letter-spacing -0.02em |
| Step heading | 38px | Lora | 400 | letter-spacing -0.02em |
| Step eyebrow | 11px | DM Mono | 400 | uppercase, letter-spacing 0.2em, `--indigo` |
| Step sub | 15px | DM Sans | 400 | `--text-muted`, line-height 1.7 |
| Body | 15px | DM Sans | 400 | line-height 1.6 |
| Button | 14px | DM Sans | 500 | |
| Labels | 11px | DM Sans | 400 | uppercase, letter-spacing 0.09em |
| Mono label | 11px | DM Mono | 400 | uppercase, letter-spacing 0.09–0.2em |
| Metadata | 11.5px | DM Mono | 400 | |

---

## 3. Background System

Three composited layers used across both wizards (`wizard.css:34-59`). Always used together.

```html
<div class="bg-layer">
  <div class="bg-mesh"></div>
  <div class="bg-grain"></div>
  <div class="bg-grid"></div>
</div>
```

| Layer | Class | Effect |
|---|---|---|
| Mesh gradient | `.bg-mesh` | Three radial gradients (indigo/purple/green tints), animated `meshShift` 14s |
| Film grain | `.bg-grain` | SVG fractal noise, opacity 0.018 — adds texture without being visible |
| Grid | `.bg-grid` | 60×60px CSS grid at `rgba(140,145,220,0.04)` |

**Mesh gradient values:**
- Gradient 1: `ellipse 900px 600px at 20% 50%`, `rgba(99,102,241,0.07)` — indigo, left
- Gradient 2: `ellipse 600px 800px at 80% 30%`, `rgba(124,58,237,0.05)` — purple, top-right
- Gradient 3: `ellipse 400px 400px at 60% 80%`, `rgba(109,212,168,0.03)` — green, bottom

**`meshShift` keyframe:**
```css
0%   { opacity: 0.7; transform: scale(1) translate(0,0); }
100% { opacity: 1;   transform: scale(1.04) translate(-10px,8px); }
```

---

## 4. Component Library

### Buttons (`wizard.css:432-461`)

**Primary** — CTA gradient, use for the main forward action.
```css
background: linear-gradient(135deg, #6366f1, #7c3aed);
color: #eef0fb; padding: 13px 28px; border-radius: 11px; font: 500 14px/1 'DM Sans';
hover: opacity 0.88, translateY(-1px); disabled: opacity 0.35;
```

**Ghost** — no fill, bordered, use for back/cancel.
```css
background: none; border: 1px solid var(--border); color: var(--text-muted);
border-radius: 11px; padding: 13px 28px;
hover: border-color rgba(129,140,248,0.35), color var(--text);
```

**Secondary** — subtle indigo fill, use for secondary actions.
```css
background: rgba(129,140,248,0.1); border: 1px solid rgba(129,140,248,0.22);
color: var(--indigo-hi); border-radius: 9px; padding: 8px 14px; font-size: 12px; font-weight: 500;
hover: background rgba(129,140,248,0.18);
```

**Download (dashed)** — dashed border, use for optional download actions.
```css
background: rgba(129,140,248,0.08); border: 1.5px dashed rgba(129,140,248,0.32);
border-radius: 12px; padding: 14px 20px; width: 100%;
```

---

### Cards

**Model card** (`wizard.css:676`) — selectable list item.
```
border-radius: 14px; padding: 16px 18px;
default: bg var(--surface), border var(--border)
hover:   border rgba(129,140,248,0.38), bg rgba(129,140,248,0.05)
selected: border rgba(129,140,248,0.55), bg rgba(129,140,248,0.1)
```

**Feature card** (`wizard.css:722`) — toggle-able feature block with icon.
```
border-radius: 16px; padding: 18px 20px;
disabled: bg var(--surface), border var(--border)
enabled:  border rgba(129,140,248,0.35), bg rgba(129,140,248,0.07)
icon box: 40×40px, bg rgba(129,140,248,0.1), border-radius 10px
```

**HW category card** (`wizard.css:849`) — hardware selection tile.
```
border-radius: 14px; padding: 14px 16px;
hover/selected: same pattern as model card
```

---

### Badges (`wizard.css:684-719`)

Pill-shaped (border-radius 20px), 10.5px DM Mono uppercase.

| Variant | Background | Text | Border |
|---|---|---|---|
| `.recommended` | `rgba(129,140,248,0.14)` | `#a5b4fc` | none |
| `.capable` | `rgba(167,139,250,0.14)` | `#c4b5fd` | none |
| `.light` | `rgba(109,212,168,0.12)` | `#6dd4a8` | none |
| `.fallback` | `rgba(221,225,240,0.06)` | `var(--text-dim)` | none |

---

### Toggle Switch (`wizard.css:571-589`)

```
Track: 36×20px, border-radius 10px
  off: bg rgba(140,145,220,0.2)
  on:  bg #6366f1
Thumb: 16×16px circle, white
  off: translateX(0)
  on:  translateX(16px)
Transition: 0.2s
```

---

### File Chip (`wizard.css:533-548`)

Dashed border drop zone for file selection.
```
border-radius: 12px; padding: 12px 16px;
empty: border 1.5px dashed rgba(129,140,248,0.3), bg rgba(129,140,248,0.08)
set:   border solid rgba(109,212,168,0.45), bg rgba(109,212,168,0.07), text --green
```

---

### Progress Bar (`wizard.css:636-657`)

```
height: 5px; border-radius: 3px;
track: bg rgba(129,140,248,0.12)
fill:  linear-gradient(90deg, #6366f1, #a78bfa)
shimmer: ::after overlay, translateX(-100%→100%), 1.6s ease-in-out infinite
```

---

### Step Navigation Dots (`wizard.css:86-95`)

28px circles, DM Mono 10px, connected by 20px lines.

| State | Border | Text color | Background |
|---|---|---|---|
| pending | `var(--border)` | `var(--text-dim)` | none |
| active | `var(--border-hi)` | `var(--indigo-hi)` | `rgba(129,140,248,0.1)` |
| done | `rgba(109,212,168,0.3)` | `var(--green)` | `rgba(109,212,168,0.06)` |

---

### Info Note (`wizard.css:611-622`)

Amber warning/info block.
```
background: rgba(251,191,36,0.06); border: 1px solid rgba(251,191,36,0.18);
border-radius: 12px; padding: 14px 16px; gap: 12px;
icon: --amber color
```

---

### Tabs (`companion-panel.css:59-79`)

```
padding: 7px 13px 11px; font: 500 12.5px 'DM Sans'; border-radius: 8px 8px 0 0;
inactive: color rgba(221,225,240,0.38), border-bottom 2px solid transparent
active:   color #a5b4fc, border-bottom 2px solid #818cf8
```

---

## 5. Orb System

Three separate orb implementations share the same keyframes with different CSS variable prefixes.

| Context | ID/prefix | Default size | File |
|---|---|---|---|
| Main chat orb | `#companion-orb`, no prefix | 36px (`--orb-size`) | `orb.css` |
| Companion panel preview | `.cpp-orb`, `--cpp-*` | small fixed | `companion-panel.css` |
| Wizard Senni guide | `.senni-orb-body`, `--s-*` | 120–170px | `wizard.css:200` |

### HTML Structure

```html
<div class="companion-orb idle" id="companion-orb">
  <div class="orb-dots">
    <span></span><span></span><span></span>
  </div>
  <div class="orb-body">
    <div class="orb-ring"></div>
    <div class="orb-icon">⬡</div>
  </div>
</div>
```

### CSS Variable API (`orb.css:20-47`)

Set on `#companion-orb` (or inline on element for standalone use):

| Variable | Default | Controls |
|---|---|---|
| `--orb-size` | `36px` | Orb diameter |
| `--dot-color` | `#818cf8` | Dots + icon tint |
| `--orb-bg` | `rgba(129,140,248,0.12)` | Orb fill |
| `--orb-border` | `rgba(129,140,248,0.35)` | Orb edge |
| `--glow-color` | `rgba(129,140,248,0.4)` | Glow box-shadow |
| `--glow-min` | `6px` | Min glow blur |
| `--glow-max` | `16px` | Max glow blur |
| `--glow-speed` | `2s` | Glow animation duration |
| `--ring-color` | `rgba(129,140,248,0.3)` | Ring pulse color |
| `--ring-speed` | `1.8s` | Ring animation duration |
| `--dot-speed` | `1.2s` | Dot bounce duration |
| `--breath-speed` | `3s` | Breathing scale duration |
| `--anim-glowEnabled` | `1` | 0 disables glow |
| `--anim-breathEnabled` | `1` | 0 disables breathing |
| `--anim-ringEnabled` | `1` | 0 disables ring pulse |
| `--anim-dotsEnabled` | `1` | 0 disables dot animation |

Animation disables also require `data-no-glow`, `data-no-breath`, `data-no-ring`, `data-no-dots` attributes — CSS can't branch on custom property values directly (see `orb.css:199-212`).

### State Classes (`orb.css:214-286`)

Apply to the `.companion-orb` element:

| State class | Glow speed | Breath speed | Ring speed | Dots |
|---|---|---|---|---|
| `.idle` | 4s | 5s | 4s | opacity 0.12, static |
| `.thinking` | 2s | 3s | 1.8s | `dotBounce` 1.2s |
| `.streaming` | 2.5s | — (no breath) | 2.4s | `dotStream` 1.4s |
| `.heartbeat` | 1.4s | 2s | 1.4s | `dotBounce` 0.9s |
| `.chaos` | 0.8s | 0.6s | 0.9s | `dotBounce` 0.6s |

### Keyframes (`orb.css:174-193`)

| Keyframe | Animation |
|---|---|
| `orbGlow` | box-shadow pulses between `--glow-min` and `--glow-max` |
| `orbBreath` | scale 1 → 1.04 → 1 |
| `ringPulse` | scale 1 → 1.55, opacity 0.6 → 0 |
| `dotBounce` | opacity 0.25 → 1, scale 0.78 → 1.15 |
| `dotStream` | opacity 0.2 → 0.65 (no scale, softer) |

### `orb.js` API (`static/js/orb.js`)

```javascript
orb.init()                     // call on load
orb.setState('thinking')       // idle|thinking|streaming|heartbeat|chaos
orb.applyPreset(preset, mood)  // apply color/animation config
orb.setAvatar(src)             // set avatar image
orb.syncAvatar()               // sync from companion config
orb.setMode('inline'|'strip')  // layout mode
```

**`applyPreset` payload** (all optional):
```javascript
{
  dotColor, edgeColor, glowColor, glowAlpha,
  ringColor, ringAlpha, glowMax, glowSpeed,
  ringSpeed, dotSpeed, breathSpeed, orbSize,
  glowEnabled, breathEnabled, ringEnabled, dotsEnabled
}
```

**Mood overlay** — same fields, plus `_enabled: { fieldName: bool }` to control which fields override the preset.

---

## 6. Animation Catalogue

### Keyframes

| Keyframe | Duration | Easing | Use | File |
|---|---|---|---|---|
| `meshShift` | 14s | ease-in-out | Background breathing | wizard.css:44 |
| `stepIn` | 0.65s | `cubic-bezier(.22,1,.36,1)` | Step content entrance | wizard.css:373 |
| `fadeUp` | 0.25s | ease | Modal / overlay appear | wizard.css:879 |
| `popIn` | 0.5s | `cubic-bezier(.175,.885,.32,1.275)` | Card bounce entrance | wizard.css:776 |
| `checkIn` | 0.35s (staggered) | ease | System check item reveal | wizard.css:493 |
| `speechFadeIn` | 0.5s | ease | Speech text fade + rise | wizard.css:348 |
| `orbGlow` | `--glow-speed` | ease-in-out | Orb glow pulse | orb.css:174 |
| `orbBreath` | `--breath-speed` | ease-in-out | Orb scale breathe | orb.css:178 |
| `ringPulse` | `--ring-speed` | ease-out | Orb ring expand | orb.css:182 |
| `dotBounce` | `--dot-speed` | ease-in-out | Thinking/active dots | orb.css:186 |
| `dotStream` | 1.4s | ease-in-out | Streaming dots (no scale) | orb.css:190 |
| `shimmer` | 1.6s | ease-in-out | Progress bar shine | wizard.css:648 |
| `moodPulse` | 2.5s | ease-in-out | Mood indicator dot | wizard.css:284 |

### Timing Conventions

| Category | Duration |
|---|---|
| Hover state changes | 0.15s |
| Color / border transitions | 0.2–0.3s |
| Structural / slide animations | 0.5–0.65s |
| Slow breathing / ambient | 3–14s |

---

## 7. SVG & Iconography

**Rules for all icons:**
- Stroke-based only — no fill paths
- `currentColor` stroke — inherits from surrounding text color
- `stroke-width: 1.5`
- `stroke-linecap: round; stroke-linejoin: round`
- ViewBox: `0 0 24 24`
- Size: 20×20 (hardware/nav icons), 22×22 (feature card icons)

Any new icon that doesn't follow this spec will look inconsistent. If an icon library is used, filter for rounded stroke variants only.

---

## 8. Layout Patterns

### Wizard pair layout
```
flex-direction: row; gap: 52px; max-width: 920px; margin: 0 auto;
Left: Senni guide panel, 200px, sticky top 100px
Right: Step content, flex: 1
```

### Intro layout
```
flex-direction: column; align-items: center; max-width: 580px;
gap: 24px between sections
```

### Fixed chrome
```
Nav: height 72px, fixed top, backdrop-filter: blur(14px)
Footer: height 72px, fixed bottom, backdrop-filter: blur(14px)
Main: padding-top 72px, padding-bottom 80px
```

### Spacing grid (4px base)

Common gaps: `8 / 12 / 16 / 24 / 28 / 52px`

### Border radii

| Size | Usage |
|---|---|
| 9px | Secondary buttons, small inputs |
| 11px | Primary/ghost buttons |
| 12px | Download buttons, file chips, info notes |
| 14px | Model cards, HW cards |
| 16px | Feature cards |
| 20px | Badges (pill) |
| 50% | Orbs, toggles, dots |

---

## 9. Reuse Opportunities (future refactor)

The CSS variable block (`:root { --bg: ... }`) is currently duplicated between `wizard.css` and `base.css`. One source of truth would be cleaner. No change this session — flag for a future consolidation pass.

The orb keyframes (`orbGlow`, `orbBreath`, `ringPulse`, `dotBounce`, `dotStream`) are duplicated as `cppGlow`, `cppBreath`, `cppRing`, `cppDot`, `cppStream` in `companion-panel.css` with different prefixed variables. These could share keyframes with scoped variables.
