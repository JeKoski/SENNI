# Chara Card V2 — SENNI Alignment Design

Last updated: 2026-04-17

---

## Overview

SENNI compiles companions to the CharacterAI V2 character card spec (`chara_card_v2`). This doc covers:
- What each V2 field means and how SENNI should use it
- How to align SENNI's system prompt with ecosystem conventions
- Soul file format best practices for instruction-tuned models
- New features needed to fully use the spec

The goal isn't to blindly copy SillyTavern — it's to be genuinely compatible (a SENNI PNG drops into ST and works) while using the fields intelligently inside SENNI's own system.

---

## V2 Field Reference & SENNI Mapping

### `name`
Plain character name. Already populated by wizard Step 4.

### `description`
The most comprehensive field. Prose-format physical appearance, personality summary, and role/context. This is what most apps inject as the primary character block. In SENNI, this should be a narrative portrait generated from the wizard's appearance + personality data.

**Current state:** Populated with `_build_appearance_prose()` output — appearance only, no personality.
**Gap:** Should include personality summary (traits, communication style, archetype) in the same prose block.
**Action:** Extend `_build_birth_certificate()` to append personality traits and comm style after the appearance sentence.

### `personality`
Distilled behavioral traits and speech patterns. Shorter than `description`. Apps inject this as a secondary character block, usually labeled.

**Current state:** Populated with `"Traits: X, Y. Communication style: Z."` — functional but minimal.
**Action:** Expand to a short paragraph form: "A [trait] and [trait] [archetype], who [comm style]. Tends to [behavioral pattern]."

### `scenario`
The situational setup when the conversation begins. Relationship context between character and user. In SENNI, this maps to closeness + relationship type + any user context provided.

**Current state:** Populated from `personality.lore` — wrong field. Lore is background, not the current scenario.
**Action:** Generate from closeness (relationship type, starting closeness %) + user context (Step 7). Lore goes in `description`.

### `first_mes`
**The character's opening message.** Sent before any user input. Not injected into the system prompt — it becomes the character's literal first chat message. This is the most meaningful field for UX: the first thing the user sees is the character's own voice.

**Current state:** Empty string. This is the biggest gap.
**Action:** See "first_mes Feature" section below.

### `mes_example`
Example dialogue showing how the character speaks. Used for few-shot style guidance. Format in most apps:
```
<START>
{{user}}: [example user message]
{{char}}: [example character response]
<START>
{{user}}: ...
{{char}}: ...
```
**Current state:** Empty.
**Action:** Low priority. Could add a wizard field or auto-generate from personality + voice style. Good for portability but not critical for SENNI internally (SENNI's soul files serve this function better).

### `creator_notes`
UI-facing notes for humans (not injected into prompts). Good for export: "Created with SENNI. Import into SillyTavern to use. Memory system requires SENNI to be active."

**Current state:** Empty.
**Action:** Auto-populate at compile time with a SENNI export note.

### `system_prompt`
A character-specific instruction block. **Not a full replacement** of the app's system prompt — a high-priority injection that shapes how the character behaves. Can use `{{char}}` / `{{user}}` placeholders. In ST, it's injected early in the system prompt. In SENNI, we should use this field to carry a compact character instruction block that we inject into `buildSystemPrompt()`.

**Current state:** Empty. This is a missed opportunity.
**Action:** See "System Prompt Architecture" section below.

### `post_history_instructions`
A reinforcement block injected after all context, near the end of the system prompt, just before chat history. Because instruction-tuned models weight recency, this is ideal for "final reminder" style instructions: stay in character, use the right voice, never break the fourth wall. This is where the cognitive stack framing belongs.

**Current state:** Empty.
**Action:** See "System Prompt Architecture" section below.

### `alternate_greetings`
Additional opening messages. User picks one; it replaces `first_mes` as the opening. Enables personality range — the same character can open warmly or guardedly depending on the scenario.

**Current state:** Empty array.
**Action:** Future. Wizard could offer "Generate variations" at Step 9. Or allow hand-editing after compile.

### `character_book`
A keyword-triggered lorebook. Entries are injected into context when matched keywords appear in the conversation. See "Character Book" section below.

**Current state:** `{ "entries": [] }` — empty placeholder.
**Action:** Future. Seed from "First things to know" at compile time. Grows with the companion.

### `tags`
Metadata only. Not injected into prompts. Already populated from companion type + traits.

### `extensions.senni`
Our proprietary block. Already well-populated with SENNI-specific config (cognitive stack, closeness, memory settings, wizard selections, etc.). Keep this growing — it's the primary portability layer for reimporting a companion into a fresh SENNI install.

---

## System Prompt Architecture

### Current SENNI structure
```
Your name is [name]. Today is [date], [time].

Your identity:
[soul/companion_identity.md]
[soul/user_profile.md]

[ChromaDB memory context (session-start retrieval)]

MEMORY TOOLS:
[Tool instructions - long block]

[Mood context if active]

[Cognitive stack note if set]
```

### Recommended structure (V2-aligned)

```
[system_prompt field — character-specific instruction block, {{char}} substituted]

Your name is [name]. Today is [date], [time].

[soul/companion_identity.md — identity, appearance, personality, background]
[soul/user_profile.md — user profile if present]

[ChromaDB memory context (session-start retrieval)]

[Mood context if active]

MEMORY TOOLS:
[Tool instructions]

[post_history_instructions field — cognitive stack framing, behavioral reinforcement]
```

### Key changes:
1. **`system_prompt` field injected first** — high-priority character instructions before identity files
2. **`post_history_instructions` field injected last** — cognitive stack framing moved here for recency effect. Currently this appears mid-prompt; moving it to the end increases adherence
3. No structural change to soul files needed — they remain the primary identity layer

### What goes in `system_prompt`:
A compact, instruction-tuned-model-friendly character definition. Written at compile time. Example:
```
You are {{char}}, [archetype]. [1-2 sentence character essence in instruction voice]. 
Respond as {{char}} would — [voice quality]. [Key behavioral constraint if any].
```

This is NOT a duplicate of companion_identity.md. It's the behavioral anchor. The soul file is the reference; this is the instruction.

### What goes in `post_history_instructions`:
Cognitive stack framing + soul_edit_mode reminder. Example:
```
You are {{char}}, with an Analyst's dominant thinking function. Lead with logic, 
ask clarifying questions, value precision over warmth. 
Your sense of self is [settled/reflective/adaptive] — [one-line implication].
```

### Implementation notes
- `buildSystemPrompt()` in chat.js needs to read `config.system_prompt` and `config.post_history_instructions` from companion config and inject them at the right positions
- Both fields need to be written by `wizard_compile.py` and stored in `config.json`
- `{{char}}` → `companionName` substitution should happen at injection time
- `{{user}}` → user's name from soul/user_profile.md (or "you" as fallback)

---

## first_mes Feature

### What it is
The companion's opening message. A static authored string — no model call. Displayed as a companion bubble the moment a new chat starts.

### How it differs from the session_start heartbeat
| | `first_mes` | session_start heartbeat |
|--|--|--|
| When | Fresh chat, zero history | Session start on returning chat |
| Content | Authored at compile time | Generated by the model in context |
| Reliable | Always — no model needed | Only if model is running |
| Tone | Curated, designed voice | Contextual, memory-aware |

These complement each other. `first_mes` greets a brand new companion. The heartbeat greets returning users with context.

### Implementation
**Config:** `config.json` stores `first_mes: string` alongside other companion fields.

**Chat startup logic in `startSession()` / `newChat()`:**
```
if (conversationHistory.length === 0 && config.first_mes) {
  // Inject as a pre-rendered companion message — no model call
  const row = appendMessage('companion', config.first_mes);
  _attachMessageControls(row, 'companion');
  conversationHistory.push({ role: 'assistant', content: config.first_mes });
  _saveCurrentTabState();
}
```

**Wizard compile:** Generate `first_mes` automatically from personality + closeness + archetype. A Visionary companion opens differently than a Guardian. The compile step writes it to config.json and to the V2 card's `first_mes` field.

**Alternate greetings UI (future):** When `alternate_greetings` is populated, show a picker before displaying the opening message.

### Auto-generation at compile time
The compile step has enough data to generate a plausible `first_mes`:
- Archetype → tone (Analyst: precise, Empath: warm, Guardian: grounded, Visionary: evocative)
- Relationship type → distance (friend vs companion vs role-play partner)
- Starting closeness % → familiarity level (low = formal/tentative, high = warm/familiar)
- Communication style → voice texture

This avoids requiring the user to write a custom opening. They can always edit it later in companion settings.

---

## Soul File Format Best Practices

### Recommended structure for `companion_identity.md`

Based on what instruction-tuned models (Gemma 4, Llama 3, Qwen, Mistral) process best: **prose sections under simple markdown headers**. No XML tags, no dense trait lists.

```markdown
# [Name]
*[Type] | [Archetype]*

## Appearance
[Prose sentence from appearance wizard data. Specific, physical, sensory. 1-3 sentences.]
[True age if set.]
[Additional notes (body-notes, face-notes, detail-notes) as further paragraphs.]

## Personality
**Traits:** [comma list — short reference, not the primary description]
**Communication style:** [value]
**Voice:** [voice style]

[Optional: 1-2 sentence prose expansion on how they actually come across in conversation.]

## Background
[Lore/backstory from wizard Step 4. Prose. As long as the user wrote.]

## Default Outfit
**Style:** [value]
**Accessories:** [list]
**Signature item:** [value]

## Relationship
**Type:** [list]
**Starting closeness:** [X%]

## Intimacy  ← only if adult content enabled
**Role:** [value]
**Initiation:** [value]
**Intensity:** [value]
**Interests:** [list]
[Notes]

## Initial Context
[First things to know — ChromaDB seed notes]
```

### Key principles
- **Simple markdown headers** — instruction models use these as section boundaries
- **Short, clear sections** — 1-5 sentences per section. Long walls of text don't help
- **Prose over lists** where possible — the model has seen far more natural language than structured lists
- **No XML tags** — complicates tokenization for smaller instruction models
- **Behavioral Patterns section (future)** — add "how they engage in conversation" once we have more wizard data

### What the model does with this
Instruction-tuned models read the soul file as context, not instructions. The behavioral direction comes from the `system_prompt` + `post_history_instructions` fields (injected before and after). The soul file answers "who are they" — the instruction fields answer "how should I act."

---

## Character Book (Lorebook)

### What it is
A knowledge base of lore entries. Each entry has keywords; when a keyword appears in the conversation, the entry's content is injected into context. Used for world-building, detailed lore, faction info, location descriptions — things too specific to keep in the main identity but needed when referenced.

### Structure
```json
{
  "entries": [
    {
      "keys": ["keyword1", "keyword2"],
      "content": "Lore text injected when keyword matched",
      "enabled": true,
      "insertion_order": 100,
      "case_sensitive": false,
      "constant": false
    }
  ]
}
```

`constant: true` entries always inject regardless of keywords — useful for core world facts.

### SENNI integration plan
Three tiers:

**Tier 1 — Compile-time seed (immediate):**
The "First things to know" textarea (Step 8) currently seeds ChromaDB. It should ALSO populate the `character_book` with a single `constant: true` entry so the data is in the portable card.

**Tier 2 — Manual lorebook editor (future):**
A tab in Companion Settings where users can add/edit/delete lorebook entries. Good for extensive world-building companions.

**Tier 3 — ChromaDB ↔ lorebook bridge (future, complex):**
Consolidated memory notes that have been confirmed important could optionally be promoted to lorebook entries. This turns episodic memory into permanent world-knowledge. Needs design.

### In-chat injection (future feature)
SENNI currently doesn't scan conversation for lorebook keywords. When implemented:
- Scan the last N turns for keywords before each `buildSystemPrompt()` call
- Inject matched entries into the memory context block
- Set a token budget (e.g. max 500 tokens of lorebook per turn)

---

## New Features Checklist

Prioritized by impact and implementation complexity:

| Feature | Impact | Complexity | Notes |
|---------|--------|-----------|-------|
| `first_mes` — new chat opening message | High | Low | Static injection, no model call |
| `system_prompt` field — character instruction block | High | Low | Write at compile, inject in buildSystemPrompt |
| `post_history_instructions` — cognitive stack at prompt end | High | Low | Move stack framing to end of system prompt |
| `creator_notes` — auto-populated export note | Low | Trivial | One line in wizard_compile.py |
| `description` — add personality to prose | Medium | Low | Extend _build_birth_certificate() |
| `scenario` — generate from relationship data | Medium | Low | Fix current wrong mapping |
| `first_mes` auto-generation at compile | Medium | Medium | Archetype + closeness → opening line |
| `alternate_greetings` UI | Low | Medium | Wizard Step 9 or companion settings |
| `mes_example` generation | Low | Medium | Auto-generate from voice style + traits |
| Lorebook editor UI | Medium | Medium | New companion settings tab |
| Lorebook keyword scanning in chat | Medium | High | Per-turn scan, token budget |
| ChromaDB → lorebook promotion | Low | High | Complex, needs separate design |

---

## Portability Note

A companion exported from SENNI (the PNG character card) should work when dropped into SillyTavern or Chub.ai. The fields above, when properly populated, give ST enough to reconstruct a reasonable character. The `extensions.senni` block carries everything SENNI-specific — memory config, cognitive stack, heartbeat settings, etc. — which is ignored by other apps but available for re-import into SENNI.

`GET /api/wizard/export/{folder}` (route already added) serves the PNG. A future `.json` export of just the birth certificate would help non-Pillow installs and programmatic use.

---

## Standalone Wizard & Tauri Architecture

### Design goal
The Companion Creation Wizard is intentionally designed to work as a standalone product — a universal AI companion creator that outputs V2-compatible cards for any app (SillyTavern, Chub.ai, SENNI, Backyard.ai). SENNI is just one consumer of its output.

### Current SENNI coupling points in `wizard_compile.py`
Only the compile step has SENNI deps. The wizard HTML/CSS/JS has zero backend coupling until the final POST.

| Import | Used for | Standalone alternative |
|--------|----------|------------------------|
| `COMPANIONS_DIR` | Root path for output | User-specified `output_dir` |
| `get_companion_paths` | Creates soul/, mind/ subdirs | Simple `Path(output_dir / name).mkdir()` |
| `save_companion_config` | Writes config.json | `json.dump()` directly |
| `write_avatar_file` | Writes avatar to disk | Same function, different root |

**Required change before standalone release:** Add `output_dir: str | None` parameter to `compile_companion()`. When set, write directly to that path without importing SENNI config. When `None` (default, SENNI context), use `COMPANIONS_DIR` as today. This is a small refactor — no structural changes to wizard_compile.py.

### Standalone wizard distribution (pre-Tauri, available now)
A minimal `wizard_server.py` (~80 lines) that serves just the wizard HTML and the compile endpoint. No llama-server, no ChromaDB, no memory, no TTS. Users run:
```
pip install fastapi uvicorn pillow
python wizard_server.py
# → open http://localhost:7770/companion-wizard
```
Output is a companion folder anywhere the user specifies. This can be released immediately once the `output_dir` refactor is done.

### Standalone Tauri wizard (medium effort, ~2-3 sessions)
Wraps the wizard HTML in a native desktop app:
- **Webview**: loads the wizard HTML directly from the app bundle
- **Sidecar**: the minimal `wizard_server.py` packaged as a PyInstaller binary
- **Tauri IPC**: wizard JS calls the sidecar port for compile; Tauri handles file picker for output directory

Effort breakdown:
- PyInstaller packaging of the minimal server: 1 session (fiddly but solved problem)
- Tauri scaffolding, `tauri.conf.json`, sidecar config: 1 session
- Testing across Windows/Linux: ongoing

The wizard HTML file is shared with SENNI's `static/` folder — a symlink or build step keeps them in sync.

### SENNI handoff from standalone wizard
After compile, the standalone wizard can detect a running SENNI bridge:
```js
// After successful compile in standalone mode:
const senniRunning = await fetch('http://localhost:7777/api/status').then(r => r.ok).catch(() => false);
if (senniRunning) {
  // Option: POST compiled data to SENNI's compile endpoint → switch active companion
  // Option: Show "Open in SENNI" button that deep-links to /chat
}
```
This means the standalone wizard works as a full companion creator AND as a companion-creation UI for SENNI when SENNI is running.

### V2 card import into SENNI (needed once standalone is released)
Once users can create V2 cards outside SENNI, SENNI needs an import path:

**`POST /api/companion/import`** — accepts a V2 PNG or JSON:
1. Decode `tEXt` chunk → birth certificate JSON
2. Extract `extensions.senni` block if present
3. Reconstruct companion folder: `config.json`, `soul/companion_identity.md`, `soul/user_profile.md`
4. If avatar image embedded in PNG, extract and save as `avatar.jpg`
5. Switch active companion to the imported folder

This makes SENNI a proper consumer of any V2-compatible card — not just its own output. SillyTavern users can export a character and import it into SENNI.

### Long-term: SENNI as full Tauri app
The wizard HTML is already in `static/` — it bundles naturally. The main additional work is:
- Full Python sidecar (server.py + all deps): complex packaging (ChromaDB's native HNSWLIB, llama-server binary, Kokoro TTS)
- llama-server as a second sidecar: simpler (it's already a compiled binary)
- Separate project — don't attempt until wizard and core features are stable

### Recommended path
1. **Now:** Document `output_dir` refactor as a prerequisite; wizard stays in SENNI as HTML
2. **Post-wizard completion:** Minimal `wizard_server.py` for standalone script distribution
3. **Standalone release:** Tauri wizard with PyInstaller sidecar + SENNI handoff detection
4. **SENNI release:** Full Tauri SENNI, wizard already inside, standalone Tauri wizard becomes optional
