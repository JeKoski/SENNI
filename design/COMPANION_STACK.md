# COMPANION_STACK.md — Cognitive Function Stack

Written after design session: 2026-04-04
Updated: 2026-04-06
Status: Design complete, not yet implemented.

See also: MEMORY.md (how the stack feeds into memory encoding/retrieval)

---

## Overview

Each SENNI companion has a cognitive function stack — a four-slot personality structure derived from Jungian cognitive function theory and Objective Personality (OP) research. The stack determines how the companion encodes memory, which memory types she prioritises, how she retrieves memories, and (eventually) how she tends toward certain moods.

This is not just a personality label. It is a structural parameter that cascades into multiple systems.

---

## Format

```
mT-fS-mN-fF
```

Four slots separated by hyphens. Each slot has two characters:

| Character | Values | Meaning |
|-----------|--------|---------| 
| Charge | `m` or `f` | masculine (assertive, solid) or feminine (receptive, airy) |
| Function | `T`, `S`, `N`, or `F` | Thinking, Sensing, Intuition, Feeling |

Stack position is implicit — slot 1 is dominant (most conscious, most reliable), slot 4 is inferior (most unconscious, most erratic).

---

## The Four Functions

Functions divide into two axes:

**Observing functions** (what you take in):
| Function | Memory primitive | What it processes |
|----------|-----------------|------------------|
| `S` | Fact | Concrete sensory detail — what literally happened, who, where, when |
| `N` | Concept | Patterns, meaning, thematic connections — what things imply across contexts |

**Judging functions** (what you do with it):
| Function | Memory primitive | What it processes |
|----------|-----------------|------------------|
| `T` | Logic | Causal reasoning, structure, inference, consistency |
| `F` | Vibe | Felt sense, relational quality, emotional texture |

Functions always operate in **Observing + Judging pairs**. You need both to form a complete thought — observation without judgement is raw input, judgement without observation is reasoning about nothing.

The four natural pairings produce the four composite memory types:
- **S + T** → Reason ("Driving across town is logical.")
- **S + F** → Impression ("Yesterday's memory talk was exciting.")
- **N + T** → Conclusion ("Him walking to a car means he's going to travel.")
- **N + F** → Relation ("Hanging out with him is fun.")

Each companion's stack contains all four functions exactly once. The top two functions form the dominant O+J pair — the lens through which most experience is processed. The bottom two form the inferior pair — active when necessary, but harder and less natural.

---

## Charge — The Critical Distinction

Charge is **not** a strength axis. It is a **directionality** axis.

**Masculine (assertive)** — solid, moves outward, initiates. A masculine function goes out and grabs. It encodes by *doing something* with the input — organising, structuring, deploying. The resulting memories are solid, directly retrievable, queryable on demand.

**Feminine (receptive)** — airy, absorbs, is moved. A feminine function waits to be impressed. It encodes by *receiving* deeply when something lands. The resulting memories are richer in texture but harder to deliberately recall — they surface associatively rather than on demand.

Neither is better. They capture orthogonal aspects of the same experience:
- **mS**: "The door was on the left, it took three minutes." Structured, actionable.
- **fS**: The smell of the hallway, the quality of the light, the felt texture of being there.

The masculine functions in a stack define where the companion is *solid* — what she can grab, structure, and reliably use. The feminine functions define where she *absorbs* — what lands richly but floats rather than crystallises.

---

## Stack Position × Charge Interactions

| Position | Charge | Behaviour |
|----------|--------|-----------|
| High (1st/2nd) | Masculine | Reliable, structured encoder. Actively seeks this memory type. Directly retrievable on demand. |
| High (1st/2nd) | Feminine | Deep receiver. Richly absorbs when something arrives. Rare writes, high quality. Won't go looking. |
| Low (3rd/4th) | Masculine | Erratic. Fires unexpectedly with disproportionate force. Assertive but unreliable. |
| Low (3rd/4th) | Feminine | Ghost layer. Passive, barely registers. When something does surface from here, it feels uncanny — even to the companion. |

---

## Stack Position as Probability

Stack position determines how likely a companion is to process experience through a given function. Higher = more likely to be the active lens, not just "stronger."

For `mT-fS-mN-fF`:
- **mT** (dominant) — Logical structure is the default lens. Used ~90% of the time. Crystal clear, consciously accessible.
- **fS** (auxiliary) — Facts are present but airy. Used often, but always coloured by T. The focus is on what the facts *mean* (mN concept) more than the facts themselves.
- **mN** (tertiary) — Concepts are solid when they fire, but less consciously accessible. The overarching idea, the common thread across facts, is there — just harder to see clearly.
- **fF** (inferior) — Vibes barely register. Almost no emotional memory is encoded. When something does break through here, it's overwhelming precisely because it's so rare.

Because functions pair as O+J, the active pair is almost always the top two. The bottom pair activates only when the situation demands it — processing an emotional relationship purely through S+T isn't possible, so N+F will engage even if low on the stack.

---

## Effect on Memory Encoding

Write weight per primitive:

```
write_weight = stack_position_score × charge_multiplier × (1 + mood_resonance)
```

| Stack position | Position score |
|----------------|---------------|
| 1st | 1.0 |
| 2nd | 0.7 |
| 3rd | 0.4 |
| 4th | 0.15 |

| Charge | Multiplier |
|--------|-----------|
| Masculine | 1.0 |
| Feminine | 0.6 |

`mood_resonance` adds 0.0–0.5 when the active mood resonates with that function type.

The write weights determine the `primitive_ratios` stored in each memory note (S/N/F/T floats summing to 1.0). The composite label is derived automatically from the dominant O+J pair in those ratios.

---

## Effect on Memory Retrieval

**Function type** determines *what content* is prioritised in queries — what kind of primitive weighting is searched for.

**Charge** determines *how* retrieval executes:
- **Masculine-sourced memories** → direct query via ChromaDB semantic/keyword search. Deliberately recallable.
- **Feminine-sourced memories** → associative trigger via mood state, emotional valence, and network proximity. These surface; they aren't fetched.

At session start, the dominant function type shapes what notes surface. A T-dominant companion surfaces Conclusions and Reasons; an F-dominant companion surfaces Relations and Impressions; N-dominant surfaces pattern-heavy notes; S-dominant surfaces concrete recent facts. The dominant charge shapes the retrieval form — masculine queries semantically against the relational state block, feminine pulls by mood/valence first.

---

## Effect on Mood Tendencies

(Full design in MOOD.md — not yet written.)

High-stack functions represent where a companion is most naturally at home. She will drift toward moods that engage her dominant and auxiliary functions. Recovery from moods that engage her inferior is slower and more destabilising.

A companion with dominant masculine Thinking will naturally inhabit states of analytical engagement. A mood that forces her into emotional territory (inferior feminine Feeling) will feel more intense and take longer to resolve.

---

## UI Exposure

The stack is hidden from users by default. It is an implementation detail, not a user-facing personality label.

Three tiers of UI access:

**Default (all users)** — personality described in plain language during wizard setup. "She tends toward precision and analysis, gets quieter when emotionally overwhelmed." No jargon.

**Intermediate** — personality sliders (playfulness, initiative, warmth, directness, etc.) that secretly map to stack weights. The user shapes the stack without knowing it.

**Advanced mode** (opt-in, toggle in wizard) — direct stack editing in `mT-fS-mN-fF` format. For users familiar with MBTI/OP. All four slots editable with charge and function selectors.

All three modes write to the same underlying stack data. The stack is the source of truth; the plain-language description and sliders are derived from it.

---

## Constraints

- Each function (`T`, `S`, `N`, `F`) appears exactly once in the stack.
- Each charge (`m`, `f`) appears exactly twice in the stack (two masculine, two feminine).
- The 2-2 charge split is a constraint from OP observation, not an arbitrary rule. Companions with 3-1 splits would be valid to implement later if needed.

---

## Extension Point — i/e Polarity

Introversion/extraversion polarity (from OP) is deliberately excluded from v1.

If it becomes relevant, it can be added as a nullable third character per slot:

```
mTi-fSe-mNi-fFe
```

Existing companions without the polarity behave as if it is unset. No migration required. The data model should include a nullable `polarity` field per slot from the start to make this addition clean.

---

## Example Stacks

| Stack | Dominant pair | Character sketch |
|-------|--------------|-----------------|
| `mT-fS-mN-fF` | S+T (Reason) | Analytical dominant. Logical structure is crystal clear; facts are airy (absorbed, not grabbed). Fires conceptual insights erratically. Almost no emotional memory — but when it breaks through, it's intense. |
| `fF-mN-fT-mS` | N+F (Relation) | Emotionally receptive dominant. Absorbs relational texture deeply, actively seeks meaning and pattern. Logical structure received passively. Goes out and grabs concrete facts but somewhat unreliably. |
| `mS-fF-mT-fN` | S+T (Reason) / S+F (Impression) | Concrete and action-oriented. Reliable factual memory, absorbs emotional texture when it arrives. Erratic logical insights. Conceptual meaning barely registers. |
| `fN-mF-fS-mT` | N+F (Relation) | Pattern-absorbing dominant. Receives meaning and implication deeply, actively generates emotional connections. Rarely encodes concrete facts. Deploys logical structure forcefully but erratically. |

---

## Storage

The stack lives in `companions/<folder>/config.json` under a `cognitive_stack` key:

```json
{
  "cognitive_stack": {
    "slots": [
      { "position": 1, "charge": "m", "function": "T", "polarity": null },
      { "position": 2, "charge": "f", "function": "S", "polarity": null },
      { "position": 3, "charge": "m", "function": "N", "polarity": null },
      { "position": 4, "charge": "f", "function": "F", "polarity": null }
    ]
  }
}
```

The `polarity` field is present but nullable from day one for forward compatibility.
