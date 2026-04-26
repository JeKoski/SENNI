# Main Chat UI Redesign

**Status:** ✓ Implemented (2026-04-26). All 10 steps shipped in branch `claude/dreamy-saha-5855c2`.
**Priority:** High — do this before Tauri so the app Tauri wraps is already polished.
**Source material:** `static/style-rulebook/` (Design Claude mockup), `design/UI_DESIGN.md` (existing system).

The redesign brings the main chat UI up to the visual language established by the Setup Wizard and Companion Creation Wizard. It does not break existing functionality — it is a CSS + HTML structural pass, not a JS rewrite.

---

## Design references

- `static/style-rulebook/SENNI Rulebook.html` — rendered mockup (open in browser)
- `static/style-rulebook/css/rulebook.css` — extended token system to adopt
- `static/style-rulebook/css/chat.css` — chat layout reference
- `static/style-rulebook/css/base.css` — updated base reference
- Screenshot: chat mockup shared 2026-04-26 — confirms sidebar/header/bubble direction

---

## 1. Token system

**Action:** Merge `static/style-rulebook/css/rulebook.css` token block into `static/css/base.css` `:root`. Pure addition — nothing breaks.

### New tokens to add

**Surface tiers** (replaces ambiguous `--surface` / `--surface2`):
```css
--surface-sunken:   rgba(0,0,0,0.22);
--surface-base:     rgba(255,255,255,0.04);
--surface-raised:   rgba(255,255,255,0.07);
--surface-floating: rgba(255,255,255,0.09);
```

**Surface tints:**
```css
--tint-indigo-soft: rgba(129,140,248,0.05);
--tint-indigo:      rgba(129,140,248,0.10);
--tint-indigo-on:   rgba(129,140,248,0.14);
```

**Border tiers** (replaces `--border` / `--border-hi`):
```css
--border-subtle:  rgba(140,145,220,0.08);
--border-default: rgba(140,145,220,0.15);
--border-strong:  rgba(140,145,220,0.28);
--border-focus:   rgba(129,140,248,0.55);
```

**Radius vars** (replaces inline border-radius values):
```css
--r-xs: 6px; --r-sm: 10px; --r-md: 14px;
--r-lg: 18px; --r-xl: 22px; --r-pill: 999px;
```

**Elevation presets** — the key to physical depth. Inner top highlight (`0 1px 0 rgba(255,255,255,N) inset`) fakes a lit top edge:
```css
--elev-1: 0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.18);
--elev-2: 0 1px 0 rgba(255,255,255,0.05) inset, 0 6px 16px -4px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.22);
--elev-3: 0 1px 0 rgba(255,255,255,0.06) inset, 0 14px 36px -8px rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.25);
--elev-4: 0 1px 0 rgba(255,255,255,0.07) inset, 0 28px 60px -12px rgba(0,0,0,0.55), 0 10px 22px rgba(0,0,0,0.3);
```

**Ambient glow vars** (standardizes orb/avatar halos):
```css
--glow-indigo-sm: 0 0 0 1px rgba(129,140,248,0.18), 0 0 18px -2px rgba(129,140,248,0.22);
--glow-indigo-md: 0 0 0 1px rgba(129,140,248,0.22), 0 0 32px -4px rgba(129,140,248,0.28);
--glow-indigo-lg: 0 0 0 1px rgba(129,140,248,0.28), 0 0 60px -6px rgba(129,140,248,0.35);
```

**Focus ring:**
```css
--focus-ring: 0 0 0 1px rgba(28,30,38,1), 0 0 0 3px rgba(129,140,248,0.55);
```

**Named easing curves:**
```css
--ease-out-soft:    cubic-bezier(.22,1,.36,1);
--ease-in-out-soft: cubic-bezier(.65,.05,.36,1);
--ease-spring:      cubic-bezier(.175,.885,.32,1.275);
```

**Duration vars:**
```css
--dur-fast: .18s; --dur-base: .32s; --dur-slow: .55s; --dur-glacial: .85s;
```

**Spacing vars** (4px base):
```css
--sp-1: 4px; --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
--sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;
```

---

## 2. Background system

**Body ambient glow** — upgrade `body::before` from two gradients to three:
```css
body::before {
  background:
    radial-gradient(ellipse 50% 60% at 8% 18%,  rgba(99,102,200,0.10) 0%, transparent 70%),
    radial-gradient(ellipse 45% 55% at 92% 82%, rgba(130,80,180,0.07) 0%, transparent 70%),
    radial-gradient(ellipse 30% 30% at 50% 50%, rgba(109,212,168,0.025) 0%, transparent 70%);
}
```

**Sidebar** — visually sunken vs chat area:
```css
.sidebar {
  background: linear-gradient(180deg, rgba(33,35,46,0.92) 0%, rgba(28,30,38,0.92) 100%);
  /* vs chat area which sits on the page bg with ambient gradient only */
}
```

**Grid overlay** — subtle version of the wizard grid, chat area only. Test opacity in implementation — may need to be very low (0.025–0.03) or omitted if it clashes:
```css
.chat-bg-grid {
  position: absolute; inset: 0; pointer-events: none;
  background-image: linear-gradient(rgba(140,145,220,0.03) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(140,145,220,0.03) 1px, transparent 1px);
  background-size: 60px 60px;
}
```

**Film grain** — already in wizard, add same to main chat:
```css
.chat-bg-grain { /* SVG fractalNoise, opacity 0.018 */ }
```

---

## 3. Layout structure

```
┌──────────────────────────────────────────────────────┐
│ .sidebar (280px, resizable)    │ .chat-area (flex: 1) │
│                                │                      │
│  [avatar portrait 4:5]         │  [header strip 60px] │
│  [mood strip]                  │                      │
│  CHATS ⋯                       │  [messages]          │
│  [session list]                │                      │
│                                │  [composer]          │
│  [Settings] [Restart]          │                      │
└──────────────────────────────────────────────────────┘
```

---

## 4. Sidebar

### Avatar portrait card

Full-width at top of sidebar. 4:5 aspect ratio. Multi-layer gradient placeholder (shown when no avatar image):

```css
.sidebar-avatar {
  width: 100%; aspect-ratio: 4 / 5;
  border-radius: var(--r-lg);
  border: 1px solid var(--border-strong);
  box-shadow:
    0 0 0 1px rgba(129,140,248,0.18),
    0 0 40px -4px rgba(129,140,248,0.28),
    0 14px 30px -10px rgba(0,0,0,0.5),
    0 1px 0 rgba(255,255,255,0.06) inset;
  /* inner top highlight via ::after */
}
```

- Companion name overlaid at bottom (Lora 500 15px)
- Online/offline status badge top-right corner: small pill with pulsing dot + "ONLINE"

### Mood strip

Below avatar, before session list:
```css
.sidebar-mood-strip {
  /* background: var(--surface-sunken), border: var(--border-subtle) */
  /* pulsing mood-colored dot + mood name in --indigo-hi + "88%" or mood intensity right-aligned */
}
```

### Session list (chats)

Section header: "CHATS" label + ⋯ button (replaces current + button).

⋯ dropdown contains: `+ New Chat`, `Import`, `Export`.

Active session item — left-edge gradient stripe:
```css
.session-item.active::before {
  content: ''; position: absolute;
  left: -1px; top: 8px; bottom: 8px; width: 2px;
  background: linear-gradient(180deg, transparent, var(--indigo), transparent);
}
.session-item.active {
  background: linear-gradient(90deg, rgba(129,140,248,0.14), rgba(129,140,248,0.04));
  border-color: rgba(129,140,248,0.22);
}
```

Each item: title (DM Sans 500 13px), preview text (DM Sans 400 12px muted), timestamp (DM Mono 10px dim).

The existing ⋯ per-tab rename/delete menu stays.

### Sidebar footer

Two pills in a 2-column grid: `⚙ Settings` and `↺ Restart`. No Import/Export (moved to chats ⋯ menu). No Companion Settings (moved to header ⋯ menu).

---

## 5. Header strip

60px height, `backdrop-filter: blur(12px)`, bottom border subtle.

```
[orb-or-sphere]  [Name]                    [search] [⋯]
                 [mood · status · memories]
```

**Left side**: orb element (content depends on orb mode — see §7).

**Center-left**: companion name (Lora 500 16px) + meta line (DM Sans 11.5px muted): `Resonant · tuned in · 12 memories surfaced today`. Mood name and memory surface count pulled from live state.

**Right side**: search icon button + ⋯ icon button.

**Header ⋯ menu** contains:
- Companion Settings (opens existing companion panel)
- Memory Manager (stub — opens modal/panel with "Memory Manager" heading + "Coming soon" body)

---

## 6. Messages

### Bubbles

**Companion bubble:**
```css
.bubble.companion {
  background: rgba(255,255,255,0.025);
  border: 1px solid var(--border-subtle);
  border-radius: 4px var(--r-lg) var(--r-lg) var(--r-lg);
  box-shadow: -8px 0 28px -10px rgba(129,140,248,0.25), 0 4px 14px -6px rgba(0,0,0,0.3);
}
.bubble.companion::before {
  /* left-edge indigo halo — implies orb is the light source */
  content: ''; position: absolute;
  left: -1px; top: 12%; bottom: 12%; width: 1px;
  background: linear-gradient(180deg, transparent, rgba(129,140,248,0.45), transparent);
}
```

Italic text in companion bubbles (`em` or `*...*` rendered as `<em>`) uses Lora serif — convention for roleplay/atmospheric text.

**User bubble:**
```css
.bubble.user {
  background: linear-gradient(135deg, rgba(99,102,241,0.22), rgba(124,58,237,0.18));
  border: 1px solid rgba(129,140,248,0.32);
  border-radius: var(--r-lg) var(--r-lg) 4px var(--r-lg);
  box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset,
              0 6px 18px -6px rgba(99,102,241,0.35),
              0 2px 6px rgba(0,0,0,0.18);
}
```

**Message entrance animation:**
```css
@keyframes msgIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.bubble { animation: msgIn var(--dur-slow) var(--ease-out-soft) both; }
```

### Per-message orb (companion messages only)

Small static CSS sphere — speaker indicator. No JS, no state machine, no avatar. Just a gradient circle that reflects current orb color / mood color.

```css
.msg-orb {
  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; margin-top: 4px;
  background:
    radial-gradient(circle at 38% 32%, [mood-hi-color] 0%, transparent 55%),
    radial-gradient(circle at 62% 68%, [orb-primary-color] 0%, transparent 55%),
    #2a1f38;
  border: 1.5px solid rgba(129,140,248,0.4);
  box-shadow: 0 0 0 3px rgba(129,140,248,0.06), 0 0 16px -2px rgba(129,140,248,0.4);
}
```

Colors pulled from CSS variables set by orb.js / mood system — no hardcoded values.

### Day markers

```css
.day-marker {
  align-self: center;
  font: 400 10px/1 'DM Mono', monospace;
  text-transform: uppercase; letter-spacing: .18em; color: var(--text-dim);
  padding: 6px 14px;
  background: var(--surface-sunken); border: 1px solid var(--border-subtle);
  border-radius: var(--r-pill);
}
```

---

## 7. Orb modes

Two modes selectable in Companion Settings > Presence (alongside existing layout/preset selector).

### Mode A — "In chat" (default)

Main animated orb stays in its current inline position in the chat area (large, scales with `--orb-size`, full avatar/state machine/animation).

Header gets a **simple mood sphere** — CSS only, no JS state:
```css
.header-mood-sphere {
  width: 36px; height: 36px; border-radius: 50%;
  background:
    radial-gradient(circle at 38% 32%, [mood-hi] 0%, transparent 55%),
    radial-gradient(circle at 62% 68%, [orb-primary] 0%, transparent 55%),
    #2a1f38;
  border: 1.5px solid rgba(129,140,248,0.4);
  box-shadow: var(--glow-indigo-sm);
  animation: orbGlow 3s ease-in-out infinite;  /* slow ambient pulse */
}
```

Updates color when mood changes (same CSS var system as main orb). No avatar.

When performance mode is active: animation disabled (static glow only).

### Mode B — "In header"

No chat-position orb.

Header orb = **full animated orb** (existing `#companion-orb`, full state machine, avatar image, mood colors, all presence presets active). The orb moves to the header.

- Scales with `--orb-size`
- Anchored to top of header, **overflows downward** into chat area (header `overflow: visible`, messages area gets `padding-top: max(0px, calc(var(--orb-size) - 60px + 16px))`)
- Visual effect: orb hovers at the header/chat junction, floating downward from the ceiling
- Header name + meta shifts right by `var(--orb-size) + gap`

Only one orb instance exists in the DOM regardless of mode. JS toggles a class on `<body>` (e.g. `orb-mode-header` vs `orb-mode-chat`) and CSS repositions accordingly.

---

## 8. Composer

Full adopt from `static/style-rulebook/css/chat.css` `.cs-composer` pattern.

```css
.composer-wrap {
  /* gradient fade from transparent to bg at bottom — hides message overflow */
  background: linear-gradient(180deg, transparent 0%, rgba(28,30,38,0.65) 40%, rgba(28,30,38,0.85) 100%);
}
.composer {
  background: var(--surface-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-xl);
  box-shadow: 0 1px 0 rgba(255,255,255,0.05) inset,
              0 16px 40px -8px rgba(0,0,0,0.45),
              0 0 0 1px rgba(129,140,248,0.06),
              0 0 32px -8px rgba(129,140,248,0.18);
  transition: all var(--dur-base) var(--ease-out-soft);
}
.composer:focus-within {
  border-color: rgba(129,140,248,0.4);
  box-shadow: /* expanded glow version */;
}
```

Buttons: attach (📎), link (🔗), mic (🎤), send (gradient pill).
**No orb inside the composer.**

### Token meter

Small version above composer, right-aligned. Replaces current full-width token bar:
```
32,168 tokens    context ————————————— 43%
```
DM Mono 10.5px dim. 80px progress bar with indigo gradient fill.

---

## 9. Tool call visual polish

Replaces raw XML/JSON tool call display in chat. **Settings toggle** to show full technical view for power users.

| Tool | Friendly display | Hidden by default? |
|------|------------------|--------------------|
| `write_memory` | Green pill: `+ Saved to [context_summary]` | No — show |
| `retrieve_memory` | Indigo pill: `◦ Recalling [query snippet]...` then result summary | No — show |
| `set_mood` | Hidden entirely | Yes |
| `memory` (file read) | Hidden | Yes |
| `memory` (file write) | Hidden | Yes |
| `supersede_memory` | Green pill: `↺ Updated memory` | No — show |
| `update_relational_state` | Hidden | Yes |

When "Show technical details" enabled in Settings: all calls visible with full raw JSON, plus normally-hidden log data (full memory save/recall payloads).

Memory pill design (green):
```css
.memory-pill {
  background: rgba(109,212,168,0.06);
  border: 1px solid rgba(109,212,168,0.22);
  border-radius: var(--r-pill);
  color: rgba(109,212,168,0.85);
  font: 400 11.5px/1 'DM Sans', sans-serif;
  padding: 5px 12px 5px 10px;
}
```

---

## 10. Performance mode hooks

All animations in the redesign must be toggleable via a body class (`body.perf-mode`).

Orb animations: already handled via `--anim-*Enabled` vars + `data-no-*` attributes.

New elements to wire up:
- `body.perf-mode .header-mood-sphere { animation: none; }` (static glow)
- `body.perf-mode .msgIn { animation: none; }` (no entrance animation)
- `body.perf-mode .sidebar-avatar { transition: none; }`
- `body.perf-mode .bg-mesh { animation: none; }` (mesh shift)

Performance mode toggle: Settings > Display (not yet built). When active, adds `perf-mode` class to `<body>` and writes to config.

---

## 11. What's deferred

- **Settings windows redesign** — adopt new tokens/elevation after main chat is done. Same design language, not a structural change.
- **Memory Manager panel** — stub (title + "coming soon") now; full implementation in a future design session.
- **Wizard appearance sections** — blocked on layered avatar / new PC.

---

## Implementation order

1. **Token merge** — add `rulebook.css` vars to `base.css`. No visible change, foundation for everything.
2. **Body ambient + background** — three-gradient body::before, sidebar bg, grain layer, grid (test opacity).
3. **Sidebar restructure** — avatar card, mood strip, session list active state, ⋯ menu, footer 2-pill.
4. **Header strip** — structure, companion info, search/⋯ buttons, ⋯ menu with stub memory manager.
5. **Orb mode system** — body class toggle, Mode A header sphere, Mode B positioning.
6. **Bubble upgrades** — companion halo + shadow, user gradient, msgIn animation, Lora italic, day markers.
7. **Per-message orbs** — static CSS sphere on companion messages.
8. **Composer** — full adopt, token meter small version.
9. **Tool call visual polish** — friendly pill display, hide map, settings toggle.
10. **Elevation + focus pass** — apply `--elev-*`, `--focus-ring`, `--glow-*` vars across all remaining interactive elements.
