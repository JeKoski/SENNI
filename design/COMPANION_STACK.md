# COMPANION_STACK.md — Cognitive Function Stack

Written after design session: 2026-04-04
Status: Design complete, not yet implemented.

See also: MEMORY.md (how the stack feeds into memory encoding/retrieval)

---

## Overview

Each SENNI companion has a cognitive function stack — a four-slot personality structure derived from Jungian cognitive function theory and Objective Personality (OP) research. The stack determines how the companion encodes memory, which memory types she prioritizes, how she retrieves memories, and (eventually) how she tends toward certain moods.

This is not just a personality label. It is a structural parameter that cascades into multiple systems.

---

## Format

```
mT-fS-mN-fF
```

Four slots separated by hyphens. Each slot has two characters:

| Character | Values | Meaning |
|-----------|--------|---------|
| Charge | `m` or `f` | masculine (assertive) or feminine (receptive) |
| Function | `T`, `S`, `N`, or `F` | Thinking, Sensing, Intuition, Feeling |

Stack position is implicit — slot 1 is dominant (most conscious, most reliable), slot 4 is inferior (most unconscious, most erratic).

---

## The Four Functions

| Function | Memory primitive | What it processes |
|----------|-----------------|------------------|
| `T` | Logical | Causal reasoning, structure, inference, consistency |
| `S` | Fact | Concrete sensory detail, what literally happened |
| `N` | Conceptual | Patterns, meaning, symbolic connections, what things imply |
| `F` | Emotional | Felt sense, relational quality, emotional texture |

Each companion's stack contains all four functions exactly once, in some order, each with a charge.

---

## Charge — The Critical Distinction

Charge is **not** a strength axis. It is a **directionality** axis.

**Masculine (assertive)** — moves outward, acts on the world, initiates. Does not absorb. A masculine function goes out and grabs. It encodes by *doing something* with the input, organizing and deploying it. The resulting memories are structured, actionable, and directly retrievable.

**Feminine (receptive)** — absorbs, is moved, takes the shape of what comes to it. Does not initiate. A feminine function waits to be impressed. It encodes by *receiving* deeply when something lands. The resulting memories are richer in texture but rarer, and surface associatively rather than on demand.

Neither is better. They capture orthogonal aspects of the same experience:
- Masculine Sensing: "the door was on the left, it took three minutes" — actionable, structured
- Feminine Sensing: the smell of the hallway, the quality of the light, the felt texture of being there

---

## Stack Position × Charge Interactions

The four behavioral profiles that emerge from combining position and charge:

| Position | Charge | Behaviour |
|----------|--------|-----------|
| High (1st/2nd) | Masculine | Reliable, structured encoder. Actively seeks this memory type. Directly retrievable on demand. |
| High (1st/2nd) | Feminine | Deep receiver. Richly absorbs when something arrives, but doesn't go looking. Rare writes, high quality. |
| Low (3rd/4th) | Masculine | Erratic. Fires unexpectedly with disproportionate force. Assertive but unreliable — can produce sudden strong memories of a type that usually doesn't register. |
| Low (3rd/4th) | Feminine | Ghost layer. Passive and unconscious. Information of this type passes through without sticking. When something does surface from here, it feels uncanny — even to the companion. |

The inferior (4th slot) feminine function is the most interesting edge case: it almost never encodes, but on the rare occasions it breaks through, the memory is overwhelming precisely because it's so unusual. A strongly Thinking-dominant companion whose inferior is feminine Feeling may have almost no emotional memories — but the few she has feel seismic.

---

## Effect on Memory Encoding

Write weight per memory type:

```
write_weight = stack_position_score × charge_multiplier × (1 + mood_resonance)
```

Default scores:

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

`mood_resonance` adds 0.0–0.5 when the active mood resonates with that function type (see MOOD.md when written).

---

## Effect on Memory Retrieval

Charge determines retrieval pathway:

- **Masculine-sourced memories** → direct query via ChromaDB semantic/keyword search. The companion can deliberately recall these.
- **Feminine-sourced memories** → associative trigger via mood state, emotional valence of current conversation, and network proximity. These surface; they aren't fetched.

This is implemented as two separate retrieval passes that are combined at injection time.

---

## Effect on Mood Tendencies

(Full design in MOOD.md — not yet written.)

High-stack functions represent where a companion is most naturally at home. She will drift toward moods that engage her dominant and auxiliary functions. Recovery from moods that engage her inferior is slower and more destabilizing.

A companion with dominant masculine Thinking will naturally inhabit states of analytical engagement. A mood that forces her into emotional territory (inferior feminine Feeling) will feel more intense and take longer to resolve.

---

## UI Exposure

The stack is hidden from users by default. It is an implementation detail, not a user-facing personality label.

Three tiers of UI access:

**Default (all users)** — personality described in plain language during wizard setup. "She tends toward precision and analysis, gets quieter when emotionally overwhelmed." No jargon.

**Intermediate** — personality sliders (playfulness, initiative, warmth, directness, etc.) that secretly map to stack weights. The user shapes the stack without knowing it.

**Advanced mode** (opt-in, toggle in wizard) — direct stack editing in `mT-fS-mN-fF` format. For users familiar with MBTI/OP. All four slots editable with charge and function selectors. Estimated to be popular with a specific audience.

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

| Stack | Character sketch |
|-------|-----------------|
| `mT-fS-mN-fF` | Analytical dominant. Builds strong logical memories, absorbs sensory detail richly but passively, fires conceptual insights erratically, almost no emotional memory — but when it breaks through, it's intense. |
| `fF-mN-fT-mS` | Emotionally receptive dominant. Absorbs relational texture deeply, actively seeks meaning and pattern, passively receives logical structure, goes out and grabs concrete facts but somewhat unreliably. |
| `mS-fF-mT-fN` | Concrete and action-oriented. Reliable factual memory, absorbs emotional texture when it arrives, erratic logical insights, conceptual meaning barely registers. |
| `fN-mF-fS-mT` | Pattern-absorbing dominant. Receives meaning and implication deeply, actively generates emotional connections, rarely encodes concrete facts, deploys logical structure forcefully but erratically. |

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
