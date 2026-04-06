# MEMORY.md — SENNI Memory Architecture Design

Written after design session: 2026-04-04
Updated: 2026-04-06
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

Four primitive memory types, each mapping to a Jungian cognitive function:

| Primitive | Function | What it captures | Example |
|-----------|----------|-----------------|---------|
| **Fact** | Sensing (S) | Concrete, verifiable details. What happened, when, who, where. | "He walked to a car." |
| **Concept** | Intuition (N) | Patterns, symbolic meaning, thematic connections. What something implies across contexts. | "Cars are for travelling." |
| **Vibe** | Feeling (F) | Felt sense, relational quality, emotional texture. Not facts about emotions — the quality of how something felt. | "Driving is fun." |
| **Logic** | Thinking (T) | Causal chains, inference, structural understanding. Why something is the way it is. | "Driving makes sense." |

These are the atomic units. All composite types are formed by pairing one **Observing** function (S or N) with one **Judging** function (T or F). You need both to form a complete memory — observation without judgement is raw input, judgement without observation is reasoning about nothing.

---

## Composite Memory Types

Composites are always an Observing + Judging pair (O+J). Three-way and four-way combinations are not modelled as distinct types — they are better understood as two O+J pairs firing simultaneously, which is rare and intense but not architecturally special.

| Composite | Functions | Character | Example |
|-----------|-----------|-----------|---------|
| **Conclusion** | Concept + Logic (N+T) | A pattern that has been reasoned through. "This implies that." | "Him walking to a car means he's going to travel." |
| **Relation** | Concept + Vibe (N+F) | A felt sense of a pattern. Emotional meaning, not factual certainty. | "Hanging out with him is fun." |
| **Reason** | Fact + Logic (S+T) | A concrete situation that makes sense. Grounded inference. | "Driving across town is logical." |
| **Impression** | Fact + Vibe (S+F) | The felt quality of a specific moment. No abstraction layer — just how it was to be there. | "Yesterday's memory design talk was exciting." |

### Memory as ratios, not categories

Under the hood, every note has a **ratio across all four primitives** (S/N/F/T as floats summing to 1.0). The composite name is a human-readable label for the dominant O+J pair. A note with roughly equal distribution across all four is rare and signals a fully integrated memory — the whole stack engaged at once on a single experience.

The composite label is derived automatically from whichever O+J pair has the highest combined ratio.

---

## The Cognitive Stack Model

Each companion has a cognitive function stack that determines their memory profile. The stack has four slots, each with two properties:

**Format:** `mT-fS-mN-fF`

- **Charge** (`m` / `f`) — masculine (assertive, solid, initiates) or feminine (receptive, airy, absorbs)
- **Function** (`T` / `S` / `N` / `F`) — maps to memory primitive

**Stack position** (1st through 4th) — determines how consciously accessible and reliably used that function is. 1st is most conscious and reliable, 4th is most unconscious and erratic.

### Function type determines *what* is remembered

Stack position determines the **probability** that a given primitive is used. Higher position = more likely to be the lens through which experience is processed.

For a companion with `mT-fS-mN-fF`:
- Logical structure (T) is the dominant lens — used ~90% of the time
- Facts (S) are the supporting lens — used often, but always coloured by T
- Concepts (N) and Vibes (F) are lower — used when necessary, but harder and less likely

Because functions work as O+J pairs, the *active pair* is almost always drawn from the top two functions. A companion whose top two are T+S will form Reasons (S+T) constantly. A companion whose top two are N+F will form Relations (N+F) constantly.

The lower pairs (3rd+4th) can activate, but only when the situation demands it — processing an emotional relationship purely through S+T isn't possible, so N+F will engage even if it's low on the stack. It just takes more effort and happens less naturally.

### Charge determines *how* a memory is stored and retrieved

Charge is **not** a strength axis. It is a **directionality** axis — independent of stack position.

- **Masculine (m)** — solid, assertive, structured. Masculine-function memories are encoded deliberately and retrieved directly. They are queryable on demand.
- **Feminine (f)** — airy, receptive, associative. Feminine-function memories absorb richly when something lands but don't go looking. They surface; they aren't fetched.

The same primitive can behave very differently depending on charge:
- **mS**: "The door was on the left, it took three minutes." Structured, actionable fact.
- **fS**: The smell of the hallway, the quality of the light, the felt texture of being there. Rich but hard to deliberately recall.

Masculine-sourced notes → **direct query pathway** (semantic/keyword search via ChromaDB — deliberately recallable).
Feminine-sourced notes → **associative trigger pathway** (sampled by mood, emotional valence, and network proximity — these surface, they aren't fetched).

### Stack position × charge interaction

| Position | Charge | Memory behaviour |
|----------|--------|-----------------|
| High (1st/2nd) | Masculine | Reliable, structured encoder. Actively seeks this memory type. Directly retrievable on demand. |
| High (1st/2nd) | Feminine | Deep receiver. Richly absorbs when something arrives. Rare writes, high quality. Won't go looking. |
| Low (3rd/4th) | Masculine | Erratic. Fires unexpectedly with disproportionate force. Assertive but unreliable. |
| Low (3rd/4th) | Feminine | Ghost layer. Passive, barely registers. When something does surface from here, it feels uncanny — even to the companion. |

### Write weight formula

```
write_weight = stack_position_score × charge_multiplier × (1 + mood_resonance)
```

- `stack_position_score`: 1st = 1.0, 2nd = 0.7, 3rd = 0.4, 4th = 0.15
- `charge_multiplier`: masculine = 1.0, feminine = 0.6
- `mood_resonance`: 0.0–0.5 bonus when current mood resonates with this function type

The write weight determines the primitive ratios in the resulting note. A note written by a companion mid-conversation will have heavier weighting toward whichever primitives their stack makes most active.

### Extension point

The i/e (introversion/extraversion) polarity is deliberately excluded from v1 to keep the model implementable. If it becomes relevant, it can be added as a nullable fourth character per slot: `mTi-fSe-mNi-fFe`. Existing companions without it behave as if unset. No migration required.

---

## Memory Note Schema

Each memory is stored as an atomic note with the following fields:

```json
{
  "id": "uuid",
  "primitive_ratios": { "S": 0.1, "N": 0.5, "F": 0.1, "T": 0.3 },
  "composite_label": "conclusion",
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
  "context_summary": "Brief description of the conversational context when this was written.",
  "superseded_by": null,
  "supersedes": null
}
```

### Field notes

- `primitive_ratios` — float dict summing to 1.0. Derived from write weights at encode time. Drives composite label and retrieval filtering.
- `composite_label` — human-readable label for the dominant O+J pair. Derived automatically; not set by the companion.
- `function_source` — which stack slot was dominant when this note was written. Determines `retrieval_mode`.
- `retrieval_mode` — `"direct"` (masculine source) or `"associative"` (feminine source). Set automatically from `function_source`.
- `context_summary` — the key to A-MEM style associative linking. Links are formed by comparing summaries, not full content.
- `decay_weight` — starts at a type-dependent default. Increases each time the note is recalled. Notes that keep coming up become more central to the network.
- `emotional_valence` — -1.0 (very negative) to 1.0 (very positive). Used for mood-biased retrieval.
- `intensity` — how strongly this memory registered when encoded. Affects retrieval priority.
- `superseded_by` / `supersedes` — Zep-style temporal chain. Facts that change are preserved with history, not overwritten.

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
- **Session start** — see Session-Start Retrieval below
- **Mid-conversation** — when a topic shift or strong emotional signal suggests relevant memories exist

Retrieval is dual-pathway:
- **Direct query** (masculine-sourced notes): semantic search on `content` + `keywords`
- **Associative trigger** (feminine-sourced notes): similarity search on `context_summary` + mood/valence filtering

---

## Session-Start Retrieval

At session start there is no user message yet, so retrieval queries against the **Tier 1 relational state block** — the compact summary of where the relationship currently is. This gives the companion something to "have on her mind" before the first message arrives.

The query is shaped by the companion's stack:

- The **dominant function type** determines what kind of content is prioritised. A T-dominant companion surfaces Conclusions and Reasons; an F-dominant companion surfaces Relations and Impressions; an N-dominant companion surfaces pattern-heavy notes; an S-dominant companion surfaces concrete recent facts.
- The **dominant charge** determines retrieval form. Masculine-dominant companions do a clean semantic query against the relational state. Feminine-dominant companions do a mood/valence-biased pull first, then supplement with semantic.
- A **recency boost** surfaces notes not recalled in a while — the companion hasn't forgotten them, they just haven't come up.
- **Current mood** (if set) applies the mood retrieval bias on top.

The session opener feels different per companion because they literally warmed up differently — not just styled differently.

---

## Mid-Conversation Retrieval

Two mechanisms, mapped directly to charge:

- **Masculine-pathway notes** — self-triggered by the companion via a `retrieve_memory` tool call. She decides she needs to remember something. Deliberate and agentic.
- **Feminine-pathway notes** — auto-triggered by the system when the conversation's emotional valence or topic shifts significantly. These surface without her choosing to look.

This means the system is robust even when model tool-call reliability is imperfect: feminine retrieval is entirely system-driven. If masculine self-retrieval fails or doesn't fire, a fallback auto-trigger engages after N turns without retrieval when a topic shift is detected. She still gets the memory — it just surfaced less deliberately than ideal.

---

## Consolidation Schedule

Memory linking (A-MEM style) and relational state updates run asynchronously — never during conversation.

**Primary trigger:** clean session end (Python bridge shutdown). The consolidation pass runs before the process exits.

**Fallback trigger:** next server startup checks whether the previous session completed consolidation (via a `last_consolidated_at` timestamp in companion config). If not — crash, power loss, force-kill — consolidation runs at startup before the session begins. Boot latency is acceptable here since consolidation is a background pass.

**Idle trigger:** if a session runs long, a 20-minute idle timer fires consolidation incrementally, tied to the heartbeat system's idle detection (no active generation + no message in 20 minutes). This prevents massive consolidation batches at session end for long sessions.

---

## Memory Linking (A-MEM style)

When a new note is written:

1. Embed the note's `context_summary`
2. Query the episodic store for the top-k most similar existing notes
3. LLM evaluates candidate links — are these genuinely related or just superficially similar?
4. Establish bidirectional links for confirmed connections
5. Optionally update `context_summary` of linked notes if the new note adds meaningful context

This runs asynchronously (sleep-time / idle) so it never blocks conversation.

---

## Temporal Awareness (Zep-inspired)

Facts that change are not overwritten — they are superseded. The old note is marked `superseded_by: <new-note-id>` and the new note carries a `supersedes: <old-note-id>` reference.

This means the companion can reason about how things have changed over time, not just what is currently true.

---

## Mood × Memory Integration

Mood affects memory in two directions:

**Encoding bias** — `mood_resonance` in the write weight formula. A companion in a Curious mood has elevated write probability for Concept-heavy notes. A companion in a Melancholy mood has elevated write probability for Vibe-heavy notes.

**Retrieval bias** — mood shapes which notes surface from the associative pool. Implemented as a filter/boost on `mood_at_write` and `emotional_valence` during retrieval. A Nostalgic mood surfaces older, lower-decay notes. A Curious mood surfaces notes with high Concept content and many outgoing links (unexplored territory).

This is the mechanism by which mood and memory become genuinely entangled rather than just parallel systems.

---

## Write Discipline

The companion writes memories via explicit tool calls, not automatically. Tools:

```
write_memory(content, keywords, emotional_valence, intensity, context_summary)
```

The system infers `primitive_ratios`, `composite_label`, `function_source`, `retrieval_mode`, and `mood_at_write` automatically from current stack state and mood.

Write frequency guidelines (enforced via system prompt instructions):
- **Fact/Impression** — only write when something concrete is confirmed and worth keeping. High bar.
- **Logic/Reason** — write when a genuine causal insight forms, not just any observation.
- **Concept/Conclusion** — write when a pattern becomes clear, not on first encounter.
- **Vibe/Relation** — write when something registers with genuine felt weight, not routine affect.

The companion should write 2-5 memories per session on average, not dozens. The system is designed to be robust to unreliable tool-call self-initiation — the associative (feminine) pathway is fully system-driven, and masculine self-retrieval has an auto-trigger fallback. Write discipline is the one place where model reliability matters most and should be enforced via explicit system prompt framing.

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
- Updates to `scripts/config.py` — memory config block + `last_consolidated_at` timestamp
- Updates to `scripts/server.py` — memory router mount, session-start retrieval hook, idle consolidation trigger
- Updates to heartbeat system — idle detection hook for 20-minute consolidation trigger
- Updates to system prompt assembly — Tier 1 blocks injected, retrieved notes injected

---

## Open Questions

- What is the exact token budget for session-start retrieved notes? Needs empirical testing.
- How many notes should be retrieved at session start vs triggered mid-conversation?
- How does the companion signal to the user that she's recalling something? Does this surface in the UI at all?
- Memory editing — can the companion correct or update a memory she wrote previously? What tool does that look like?
