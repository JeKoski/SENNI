# MEMORY.md — SENNI Memory Architecture Design

Written after design session: 2026-04-04
Status: Design complete, not yet implemented.

---

## Overview

SENNI's memory system is designed around three core principles derived from research into existing systems (MemGPT/Letta, A-MEM, Zep) and Jungian cognitive function theory:

1. **Tiered storage** — a small always-in-context core plus a large external episodic store, never loading everything at once.
2. **Structured note format** — memories are atomic, typed notes with rich metadata, not freeform prose.
3. **Psychologically-modelled encoding** — what gets written, how richly, and how it's retrieved is determined by the companion's cognitive function stack, not uniform probability.

The result is a memory system where different companions genuinely remember differently — not as a surface personality trait, but as a structural property of how they encode and retrieve experience.

---

## Prior Art — What We Learned

### MemGPT / Letta
Core insight: treat context window like RAM, external storage like disk. The companion actively manages her own memory via tools — writing, editing, and retrieving deliberately rather than passively accumulating. This is the right model for SENNI.

Key pattern: **sleep-time memory consolidation** — memory management happens between sessions asynchronously, not during conversation. No context cost while talking.

### A-MEM (NeurIPS 2025)
Core insight: Zettelkasten-style linking. Each memory note links to related notes based on semantic similarity and shared attributes. When new memories are added, they can trigger updates to older linked notes — memories evolve each other over time. Uses ChromaDB for storage and a small local embedding model for similarity.

This is the linking and evolution model we're adopting.

### Zep
Core insight: temporal knowledge graph with bi-temporal modeling. Facts that change are updated with history preserved, not overwritten. "Robbie used to wear Adidas, now wears Nike" — both states exist with timestamps.

We adopt the temporal awareness principle without the full graph infrastructure.

### The gap none of them fill
All three systems treat memory encoding and retrieval as uniform. None model subjective vs objective memory, none distinguish assertive vs receptive encoding modes, none connect memory behavior to personality structure. That's the layer SENNI adds.

---

## Memory Primitives

Four primitive memory types, each mapping to a Jungian cognitive function axis:

| Primitive | Function | What it captures |
|-----------|----------|-----------------|
| **Fact** | Sensing (S) | Concrete, verifiable details. What happened, when, who, where. Low write bar — only genuinely confirmed things. |
| **Logical** | Thinking (T) | Causal chains, inference, structural understanding. Not just "this happened" but "this happened *because* of that, which implies this." |
| **Conceptual** | Intuition (N) | Patterns, symbolic meaning, thematic connections. What something *means* in a larger context. Strengthens with repeated relevance. |
| **Emotional** | Feeling (F) | Felt sense, relational quality, emotional impression. Not facts about emotions but the texture of how something felt. |

These are the atomic units. All other memory types are composites.

---

## Composite Memory Types

Composites inherit the storage and retrieval characteristics of their component primitives — specifically the *strictest* write bar among the components.

| Composite | Components | Character |
|-----------|-----------|-----------|
| **Event** | Fact + Conceptual | Something that happened and what it meant. |
| **Reflection** | Emotional + Conceptual | An impression about a pattern. Doesn't require factual certainty. |
| **Relational** | Fact + Emotional | Something definitive about the relationship. High bar — combines factual and felt. |
| **Full composite** | Fact + Logical + Emotional + Conceptual | Rare. A memory that is simultaneously concrete, understood, felt, and meaningful. |

The system writes the correct composite type automatically based on which primitives are present in a given `write_memory` tool call.

---

## The Cognitive Stack Model

Each companion has a cognitive function stack that determines their memory profile. The stack has four slots, each with two properties:

**Format:** `mT-fS-mN-fF`

- **Charge** (`m` / `f`) — masculine (assertive, moves outward, initiates) or feminine (receptive, absorbs, is moved)
- **Function** (`T` / `S` / `N` / `F`) — maps to memory primitive

**Stack position** (1st through 4th) — encodes reliability and conscious accessibility. 1st is most conscious and reliable, 4th is most unconscious and erratic.

### The two axes interact independently

Position and charge are not the same axis. They multiply together:

| Position | Charge | Memory behaviour |
|----------|--------|-----------------|
| High (1st/2nd) | Masculine | Actively seeks and reliably encodes. Structured, queryable, consistent. |
| High (1st/2nd) | Feminine | Richly absorbs when encountered, doesn't chase. Deep texture when it lands, but won't go looking. |
| Low (3rd/4th) | Masculine | Erratic — fires unexpectedly with disproportionate force. Assertive but unreliable. |
| Low (3rd/4th) | Feminine | Ghost layer. Passive and unconscious — barely registers. Facts/emotions/patterns just pass through without sticking. When something does surface from here, it feels uncanny even to the companion. |

### Write weight formula

```
write_weight = stack_position_score × charge_multiplier × (1 + mood_resonance)
```

- `stack_position_score`: 1st = 1.0, 2nd = 0.7, 3rd = 0.4, 4th = 0.15
- `charge_multiplier`: masculine = 1.0 (assertive encoder), feminine = 0.6 (receptive — writes less, but richer when it does)
- `mood_resonance`: 0.0–0.5 bonus when current mood resonates with this function type

### Retrieval mode

Charge also determines *how* a memory is retrieved:

- **Masculine-sourced notes** → direct query pathway. Semantic/keyword search via ChromaDB. The companion can deliberately recall these.
- **Feminine-sourced notes** → associative trigger pathway. Sampled based on mood state, current emotional valence of conversation, and proximity in the memory network. These surface, they aren't fetched.

This is why feminine inferior function memories feel uncanny when they do appear — they weren't retrieved, they arrived.

### Extension point

The i/e (introversion/extraversion) polarity is deliberately excluded from v1 to keep the model implementable. If it becomes relevant, it can be added as a nullable fourth character per slot: `mTi-fSe-mNi-fFe`. Existing companions without it behave as if unset. No migration required.

---

## Memory Note Schema

Each memory is stored as an atomic note with the following fields:

```json
{
  "id": "uuid",
  "type": "fact | logical | emotional | conceptual",
  "composite_of": ["fact", "conceptual"],
  "content": "The memory itself, written in the companion's voice.",
  "keywords": ["keyword1", "keyword2"],
  "emotional_valence": 0.3,
  "intensity": 0.7,
  "mood_at_write": "curious",
  "function_source": "mN",
  "retrieval_mode": "associative",
  "links": ["uuid-of-related-note", "uuid-of-another"],
  "decay_weight": 0.8,
  "created_at": "2026-04-04T20:00:00Z",
  "last_recalled_at": "2026-04-04T21:00:00Z",
  "context_summary": "Brief description of the conversational context when this was written."
}
```

### Field notes

- `function_source` — which stack slot wrote this note. Determines `retrieval_mode` automatically.
- `context_summary` — the key to A-MEM style associative linking. Links are formed by comparing summaries, not full content. Keeps the linker fast.
- `decay_weight` — starts at a type-dependent default. Increases each time the note is recalled. Notes that keep coming up become more central to the network.
- `emotional_valence` — -1.0 (very negative) to 1.0 (very positive). Used for mood-biased retrieval.
- `intensity` — how strongly this memory registered when encoded. Affects retrieval priority.
- `links` — established by the linker at write time and updated as new related notes are added. Bidirectional.

---

## Tiered Storage Architecture

Following the MemGPT model, memory is split into two tiers:

### Tier 1 — Core memory (always in context)

Small, dense, always loaded. Token budget: ~400 tokens max.

Contains:
- **Identity block** — fundamental personality traits, stack, core values. Set at creation, rarely changes.
- **Relational state block** — how the relationship has evolved. Closeness, recurring dynamics, things that have become "ours". Updated deliberately, not every session.

These are loaded as part of the system prompt. They replace the current soul file loading approach — instead of prose files, they are compact structured summaries maintained by the companion herself.

### Tier 2 — Episodic store (retrieved selectively)

Large, never fully loaded. Lives in ChromaDB on disk, one collection per companion.

Contains all memory notes. Retrieved at:
- Session start — top-k relevant notes based on time since last session, relational state, and current mood
- Mid-conversation — when a topic shift or strong emotional signal suggests relevant memories exist

Retrieval is dual-pathway:
- **Direct query** (masculine-sourced notes): semantic search on `content` + `keywords`
- **Associative trigger** (feminine-sourced notes): similarity search on `context_summary` + mood/valence filtering

---

## Embedding Stack

Fully local, no external APIs required:

- **Vector store**: ChromaDB with persistent client, one collection per companion
- **Embedding model**: `all-MiniLM-L6-v2` (ChromaDB default, ~300MB, runs on CPU)
- **Alternative**: `nomic-embed-text` via Ollama if better quality is needed

The embedding model runs as a lightweight subprocess, similar to the TTS architecture. It doesn't need GPU — CPU inference is fast enough for the write volumes expected.

---

## Memory Linking (A-MEM style)

When a new note is written:

1. Embed the note's `context_summary`
2. Query the episodic store for the top-k most similar existing notes
3. LLM evaluates candidate links — are these genuinely related or just superficially similar?
4. Establish bidirectional links for confirmed connections
5. Optionally update `context_summary` of linked notes if the new note adds meaningful context

This runs asynchronously (sleep-time) so it doesn't block conversation.

---

## Temporal Awareness (Zep-inspired)

Facts that change are not overwritten — they are superseded. The old note is marked `superseded_by: <new-note-id>` and the new note carries a `supersedes: <old-note-id>` reference.

This means the companion can reason about how things have changed over time, not just what is currently true.

---

## Mood × Memory Integration

Mood affects memory in two directions:

**Encoding bias** — `mood_resonance` in the write weight formula. A companion in a Curious mood has elevated write probability for Conceptual notes. A companion in a Melancholy mood has elevated write probability for Emotional notes.

**Retrieval bias** — mood shapes which notes surface from the associative pool. Implemented as a filter/boost on `mood_at_write` and `emotional_valence` during retrieval. A Nostalgic mood surfaces older, lower-decay notes. A Curious mood surfaces notes with high Conceptual content and many outgoing links (unexplored territory).

This is the mechanism by which mood and memory become genuinely entangled rather than just parallel systems.

---

## Write Discipline

The companion writes memories via explicit tool calls, not automatically. Tools:

```
write_memory(type, content, keywords, emotional_valence, intensity, context_summary)
```

The system infers `function_source`, `retrieval_mode`, `composite_of`, and `mood_at_write` automatically from current state.

Write frequency guidelines (enforced via system prompt instructions):
- **Fact** — only write when something is confirmed and worth keeping. High bar.
- **Logical** — write when a genuine causal insight forms, not just any observation.
- **Conceptual** — write when a pattern becomes clear, not on first encounter.
- **Emotional** — write when something registers with genuine felt weight, not routine affect.

The companion should write 2-5 memories per session on average, not dozens.

---

## What This Replaces

The current soul file system (freeform prose files loaded at boot) is replaced by:

- **Identity block** → compact structured summary in Tier 1
- **Session notes** → replaced by the episodic store + session-start retrieval
- **Memory guidebook** → replaced by the write discipline system prompt instructions and typed tool interface

The soul folder structure can remain for human-readable companion configuration, but the memory content moves into ChromaDB.

---

## Implementation Dependencies

- `chromadb` — pip install, no infrastructure required
- `sentence-transformers` — for `all-MiniLM-L6-v2` embeddings (or Ollama for `nomic-embed-text`)
- New `scripts/memory_server.py` — FastAPI router, mirrors `tts_server.py` architecture
- New `scripts/memory_store.py` — ChromaDB client, write/retrieve/link operations
- Updates to `scripts/config.py` — memory config block
- Updates to `scripts/server.py` — memory router mount, session-start retrieval hook
- Updates to system prompt assembly — Tier 1 blocks injected, retrieved notes injected

---

## Open Questions

- What is the exact token budget for session-start retrieved notes? Needs empirical testing.
- How many notes should be retrieved at session start vs triggered mid-conversation?
- Should the linker run synchronously on write (simpler) or asynchronously between sessions (better UX)?
- How does the companion signal to the user that she's recalling something? Does this surface in the UI at all?
- Memory editing — can the companion correct or update a memory she wrote previously? What tool does that look like?
