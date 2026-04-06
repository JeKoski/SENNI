"""
memory_store.py — Episodic memory data layer for SENNI
=======================================================
Pure data layer. No FastAPI, no model calls, fully testable in isolation.
Mounted and used by memory_server.py.

Storage:
  - ChromaDB persistent client, one collection per companion
  - all-MiniLM-L6-v2 via ChromaDB's default embedding function (local, CPU)
  - One JSON sidecar per companion for Tier 1 core blocks + consolidation state

Memory model:
  - Four primitive types: Fact (S), Concept (N), Vibe (F), Logic (T)
  - Notes store primitive_ratios (float dict summing to 1.0)
  - composite_label derived automatically from dominant O+J pair
  - Cognitive stack determines write weights and retrieval pathway
  - Masculine-sourced notes → direct query (semantic search)
  - Feminine-sourced notes → associative trigger (mood/valence filtered)

See design/MEMORY.md and design/COMPANION_STACK.md for full architecture.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger("senni.memory")

# ── Lazy imports (chromadb is optional — memory disabled if not installed) ──────

_chroma_available = False
_chroma_client_class = None
_chroma_ef_class = None

def _ensure_chroma():
    global _chroma_available, _chroma_client_class, _chroma_ef_class
    if _chroma_available:
        return True
    try:
        import chromadb
        from chromadb.utils import embedding_functions
        _chroma_client_class = chromadb.PersistentClient
        _chroma_ef_class = embedding_functions.DefaultEmbeddingFunction
        _chroma_available = True
        return True
    except ImportError:
        return False


# ── Constants ──────────────────────────────────────────────────────────────────

# Stack position → write weight score
POSITION_SCORES = {1: 1.0, 2: 0.7, 3: 0.4, 4: 0.15}

# Charge → write weight multiplier
CHARGE_MULTIPLIERS = {"m": 1.0, "f": 0.6}

# Mood → which function type it resonates with (for mood_resonance bonus)
MOOD_RESONANCE = {
    "curious":    "N",
    "analytical": "T",
    "playful":    "F",
    "melancholy": "F",
    "nostalgic":  "F",
    "focused":    "T",
    "affectionate": "F",
    "excited":    "N",
    "calm":       "S",
    "creative":   "N",
}
MOOD_RESONANCE_BONUS = 0.35   # applied when mood resonates with a function type

# O+J composite pairs → label. Observer first, then Judging.
COMPOSITE_LABELS = {
    frozenset({"N", "T"}): "conclusion",
    frozenset({"N", "F"}): "relation",
    frozenset({"S", "T"}): "reason",
    frozenset({"S", "F"}): "impression",
}

# Similarity threshold for embedding-only link pass (no LLM needed)
EMBEDDING_LINK_THRESHOLD = 0.82

# How many candidates to fetch before Python-side mood/valence filtering
ASSOCIATIVE_OVERSAMPLE = 4


# ── MemoryStore ────────────────────────────────────────────────────────────────

class MemoryStore:
    """
    Episodic memory store for a single companion.

    Instantiate once per companion at session start. Keep alive for the
    duration of the session. Call close() on shutdown.

    Args:
        companion_id:  Companion folder name (e.g. "senni"). Used as the
                       ChromaDB collection name and sidecar file key.
        stack:         Cognitive function stack as a list of slot dicts:
                       [{"position": 1, "charge": "m", "function": "T"}, ...]
        data_dir:      Path to the companion's base folder
                       (companions/<folder>/). ChromaDB lives in
                       data_dir/memory_store/, sidecar in
                       data_dir/memory_meta.json.
    """

    def __init__(self, companion_id: str, stack: list[dict], data_dir: Path):
        self.companion_id = companion_id
        self.data_dir = Path(data_dir)
        self._stack = stack                          # list of slot dicts
        self._stack_weights = self._load_stack_weights()
        self._collection = None
        self._sidecar_path = self.data_dir / "memory_meta.json"
        self._meta = self._load_meta()

        if not _ensure_chroma():
            log.warning(
                "chromadb not installed — memory system disabled. "
                "Run: pip install chromadb --break-system-packages"
            )
            return

        self._collection = self._get_or_create_collection()
        log.info(f"MemoryStore ready for '{companion_id}' "
                 f"({self._collection.count()} notes)")

    # ── Stack helpers ──────────────────────────────────────────────────────────

    def _load_stack_weights(self) -> dict:
        """
        Pre-compute base write weights per function type from the stack.
        Returns dict like {"T": 0.70, "S": 0.42, "N": 0.24, "F": 0.09}
        (before mood_resonance is applied).
        """
        weights = {}
        for slot in self._stack:
            pos = slot.get("position", 4)
            charge = slot.get("charge", "f")
            fn = slot.get("function", "T")
            weights[fn] = POSITION_SCORES.get(pos, 0.15) * CHARGE_MULTIPLIERS.get(charge, 0.6)
        return weights

    def _dominant_function(self) -> str:
        """Return the function type with the highest base write weight."""
        if not self._stack_weights:
            return "T"
        return max(self._stack_weights, key=self._stack_weights.get)

    def _dominant_charge(self) -> str:
        """Return the charge of the highest-position stack slot."""
        if not self._stack:
            return "m"
        top = min(self._stack, key=lambda s: s.get("position", 4))
        return top.get("charge", "m")

    def _slot_for_function(self, fn: str) -> Optional[dict]:
        """Return the stack slot dict for a given function type."""
        for slot in self._stack:
            if slot.get("function") == fn:
                return slot
        return None

    # ── ChromaDB collection ────────────────────────────────────────────────────

    def _get_or_create_collection(self):
        """Initialise or open the ChromaDB collection for this companion."""
        store_path = self.data_dir / "memory_store"
        store_path.mkdir(parents=True, exist_ok=True)

        import chromadb
        from chromadb.utils import embedding_functions

        client = chromadb.PersistentClient(path=str(store_path))
        ef = embedding_functions.DefaultEmbeddingFunction()  # all-MiniLM-L6-v2

        collection = client.get_or_create_collection(
            name=f"episodic_{self.companion_id}",
            embedding_function=ef,
            metadata={"hnsw:space": "cosine"},
        )
        return collection

    # ── Sidecar meta (Tier 1 + consolidation state) ────────────────────────────

    def _load_meta(self) -> dict:
        """Load the JSON sidecar, or return defaults if it doesn't exist."""
        if self._sidecar_path.exists():
            try:
                return json.loads(self._sidecar_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {
            "identity_block": "",
            "relational_state": "",
            "stack_initialised": False,
            "last_consolidated_at": None,
            "pending_llm_consolidation": [],  # list of note_ids awaiting LLM link eval
        }

    def _save_meta(self) -> None:
        self._sidecar_path.write_text(
            json.dumps(self._meta, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )

    # ── Primitive ratio computation ────────────────────────────────────────────

    def _compute_primitive_ratios(self, mood: Optional[str] = None) -> dict:
        """
        Compute S/N/F/T write weights for this moment, then normalise to
        a float dict summing to 1.0.

        In v1 we treat the dominant function as the active lens.
        The mood_resonance bonus is applied to whichever function the mood
        resonates with.

        Returns: {"S": 0.12, "N": 0.48, "F": 0.08, "T": 0.32}
        """
        weights = dict(self._stack_weights)   # copy base weights

        # Apply mood resonance bonus
        if mood:
            resonant_fn = MOOD_RESONANCE.get(mood.lower())
            if resonant_fn and resonant_fn in weights:
                weights[resonant_fn] *= (1 + MOOD_RESONANCE_BONUS)

        total = sum(weights.values())
        if total == 0:
            # Fallback: equal distribution
            return {"S": 0.25, "N": 0.25, "F": 0.25, "T": 0.25}

        return {fn: round(w / total, 4) for fn, w in weights.items()}

    @staticmethod
    def _derive_composite_label(ratios: dict) -> str:
        """
        Find the dominant O+J pair and return the composite label.

        O functions: S, N  |  J functions: T, F

        We find the top Observing function and top Judging function by ratio,
        then look up their pair in COMPOSITE_LABELS.
        """
        o_fns = {fn: ratios.get(fn, 0) for fn in ("S", "N")}
        j_fns = {fn: ratios.get(fn, 0) for fn in ("T", "F")}
        top_o = max(o_fns, key=o_fns.get)
        top_j = max(j_fns, key=j_fns.get)
        return COMPOSITE_LABELS.get(frozenset({top_o, top_j}), "impression")

    def _infer_retrieval_mode(self, dominant_fn: str) -> str:
        """
        Return "direct" if the dominant function is masculine-sourced,
        "associative" if feminine-sourced.
        """
        slot = self._slot_for_function(dominant_fn)
        if slot and slot.get("charge") == "m":
            return "direct"
        return "associative"

    # ── Write ──────────────────────────────────────────────────────────────────

    def write_note(
        self,
        content: str,
        keywords: list[str],
        emotional_valence: float,       # -1.0 to 1.0
        intensity: float,               # 0.0 to 1.0
        context_summary: str,
        mood: Optional[str] = None,
    ) -> str:
        """
        Write an episodic memory note. Returns the note_id (uuid).

        The companion calls this via the write_memory tool. The system
        infers primitive_ratios, composite_label, function_source, and
        retrieval_mode automatically.

        The document stored in ChromaDB is context_summary (used for
        embedding-based similarity search / linking). The full content
        is stored in metadata.
        """
        if not self._collection:
            return "error: memory system not available"

        ratios = self._compute_primitive_ratios(mood)
        dominant_fn = max(ratios, key=ratios.get)
        composite = self._derive_composite_label(ratios)
        retrieval_mode = self._infer_retrieval_mode(dominant_fn)
        note_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        # Determine decay_weight default by composite type
        # Conclusions and Reasons have higher default (more structured/stable)
        # Relations and Impressions start lighter (more associative/ephemeral)
        decay_defaults = {
            "conclusion": 0.8,
            "reason":     0.75,
            "relation":   0.65,
            "impression": 0.6,
        }
        decay_weight = decay_defaults.get(composite, 0.7)

        metadata = {
            # Primitive ratios — stored as flat keys since ChromaDB metadata
            # doesn't support nested dicts
            "ratio_S":         ratios.get("S", 0.0),
            "ratio_N":         ratios.get("N", 0.0),
            "ratio_F":         ratios.get("F", 0.0),
            "ratio_T":         ratios.get("T", 0.0),
            "composite_label": composite,
            "content":         content,
            "keywords":        json.dumps(keywords),
            "emotional_valence": float(emotional_valence),
            "intensity":       float(intensity),
            "mood_at_write":   mood or "",
            "function_source": dominant_fn,
            "retrieval_mode":  retrieval_mode,
            "decay_weight":    decay_weight,
            "created_at":      now,
            "last_recalled_at": now,
            "superseded_by":   "",
            "supersedes":      "",
        }

        # ChromaDB embeds context_summary — this is what links are formed on
        self._collection.add(
            ids=[note_id],
            documents=[context_summary],
            metadatas=[metadata],
        )

        # Queue for LLM link evaluation at next consolidation
        self._meta["pending_llm_consolidation"].append(note_id)
        self._save_meta()

        log.debug(f"wrote note {note_id[:8]} [{composite}] retrieval={retrieval_mode}")
        return note_id

    # ── Retrieve ───────────────────────────────────────────────────────────────

    def retrieve_session_start(
        self,
        mood: Optional[str] = None,
        k: int = 6,
    ) -> list[dict]:
        """
        Retrieve notes to load at session start.

        Queries against the relational state block (the compact summary of
        where the relationship currently is). If relational state is empty
        (new companion, first session), falls back to most recent notes.

        The dominant function type shapes what surfaces:
          T-dominant → prefers conclusions and reasons
          F-dominant → prefers relations and impressions
          N-dominant → prefers high-N-ratio notes
          S-dominant → prefers high-S-ratio notes

        Dominant charge shapes retrieval form:
          masculine → clean semantic query
          feminine  → mood/valence-biased first, then semantic supplement
        """
        if not self._collection or self._collection.count() == 0:
            return []

        relational_state = self._meta.get("relational_state", "").strip()
        dominant_fn = self._dominant_function()
        dominant_charge = self._dominant_charge()

        # Build the type preference filter for post-retrieval re-ranking
        type_prefs = self._session_start_type_prefs(dominant_fn)

        if dominant_charge == "f" and mood:
            # Feminine-dominant: associative pull first
            associative = self.retrieve_associative(mood=mood, valence=None, k=k)
            if len(associative) >= k:
                return self._apply_recency_boost(associative)

        # Semantic query against relational state (or fallback query)
        query_text = relational_state if relational_state else "recent conversations and shared experiences"

        try:
            results = self._collection.query(
                query_texts=[query_text],
                n_results=min(k * 2, self._collection.count()),
                where={"superseded_by": {"$eq": ""}},   # exclude superseded notes
            )
        except Exception as e:
            log.warning(f"session-start retrieval error: {e}")
            return []

        notes = self._unpack_results(results)
        notes = self._apply_type_preference(notes, type_prefs)
        notes = self._apply_recency_boost(notes)
        return notes[:k]

    def retrieve_direct(self, query_text: str, k: int = 4) -> list[dict]:
        """
        Masculine pathway — deliberate semantic retrieval.
        Called when the companion uses the retrieve_memory tool.
        Only returns notes with retrieval_mode="direct" unless there
        aren't enough, in which case it supplements with associative notes.
        """
        if not self._collection or self._collection.count() == 0:
            return []

        try:
            results = self._collection.query(
                query_texts=[query_text],
                n_results=min(k * 2, self._collection.count()),
                where={"superseded_by": {"$eq": ""}},
            )
        except Exception as e:
            log.warning(f"direct retrieval error: {e}")
            return []

        notes = self._unpack_results(results)

        # Prefer direct-mode notes, but don't exclude associative if we're short
        direct = [n for n in notes if n.get("retrieval_mode") == "direct"]
        if len(direct) < k:
            direct += [n for n in notes if n.get("retrieval_mode") != "direct"]

        notes = direct[:k]
        self._batch_mark_recalled([n["id"] for n in notes])
        return notes

    def retrieve_associative(
        self,
        mood: Optional[str],
        valence: Optional[float],       # current conversation valence, -1 to 1
        k: int = 4,
    ) -> list[dict]:
        """
        Feminine pathway — associative / mood-biased retrieval.
        Auto-triggered by the system on topic/valence shift.

        Fetches k * ASSOCIATIVE_OVERSAMPLE candidates by embedding similarity,
        then filters and re-ranks in Python by:
          1. mood match (mood_at_write == current mood)
          2. valence proximity (|note_valence - current_valence| < 0.4)
          3. decay_weight (more recalled = more central)

        Returns top k after filtering.
        """
        if not self._collection or self._collection.count() == 0:
            return []

        # Query text: use mood as the semantic anchor if available
        query_text = mood if mood else "emotional resonance and felt experience"

        fetch_k = min(k * ASSOCIATIVE_OVERSAMPLE, self._collection.count())
        try:
            results = self._collection.query(
                query_texts=[query_text],
                n_results=fetch_k,
                where={"superseded_by": {"$eq": ""}},
            )
        except Exception as e:
            log.warning(f"associative retrieval error: {e}")
            return []

        notes = self._unpack_results(results)

        # Score each note: mood match + valence proximity + decay weight
        def score(note: dict) -> float:
            s = note.get("decay_weight", 0.6)
            if mood and note.get("mood_at_write", "").lower() == mood.lower():
                s += 0.3
            if valence is not None:
                note_valence = note.get("emotional_valence", 0.0)
                proximity = max(0.0, 1.0 - abs(note_valence - valence) / 2.0)
                s += proximity * 0.2
            return s

        notes.sort(key=score, reverse=True)
        notes = notes[:k]
        self._batch_mark_recalled([n["id"] for n in notes])
        return notes

    def mark_recalled(self, note_id: str) -> None:
        """Bump decay_weight and update last_recalled_at for a single note."""
        if not self._collection:
            return
        try:
            result = self._collection.get(ids=[note_id])
            if not result["ids"]:
                return
            meta = result["metadatas"][0]
            meta["decay_weight"] = min(1.0, meta.get("decay_weight", 0.6) + 0.05)
            meta["last_recalled_at"] = datetime.now(timezone.utc).isoformat()
            self._collection.update(ids=[note_id], metadatas=[meta])
        except Exception as e:
            log.warning(f"mark_recalled error for {note_id}: {e}")

    def _batch_mark_recalled(self, note_ids: list[str]) -> None:
        for nid in note_ids:
            self.mark_recalled(nid)

    # ── Tier 1 — Core memory ───────────────────────────────────────────────────

    def get_core_blocks(self) -> str:
        """
        Return formatted Tier 1 content for injection into the system prompt.
        Returns empty string if both blocks are empty (new companion).
        """
        identity = self._meta.get("identity_block", "").strip()
        relational = self._meta.get("relational_state", "").strip()

        parts = []
        if identity:
            parts.append(f"## Identity\n{identity}")
        if relational:
            parts.append(f"## Relational state\n{relational}")

        if not parts:
            return ""

        return "\n\n".join(parts)

    def update_relational_state(self, new_state: str) -> None:
        """
        Called by the companion via a tool (update_relational_state).
        Not called automatically — the companion decides when to update.
        """
        self._meta["relational_state"] = new_state.strip()
        self._save_meta()
        log.debug("relational state updated")

    def update_identity_block(self, new_identity: str) -> None:
        """
        Sync identity block from soul/companion_identity.md content.
        Called at session start to keep Tier 1 in sync with the human-editable file.
        """
        self._meta["identity_block"] = new_identity.strip()
        self._save_meta()

    def is_stack_initialised(self) -> bool:
        return self._meta.get("stack_initialised", False)

    def set_stack_initialised(self, value: bool = True) -> None:
        self._meta["stack_initialised"] = value
        self._save_meta()

    # ── Temporal — supersede ───────────────────────────────────────────────────

    def supersede_note(
        self,
        old_id: str,
        new_content: str,
        new_keywords: list[str],
        new_valence: float,
        new_intensity: float,
        new_context_summary: str,
        mood: Optional[str] = None,
    ) -> str:
        """
        Supersede an existing note with updated content. Preserves history.

        Marks old note as superseded (it stays in the store but is excluded
        from normal retrieval). Writes the new note and links them.

        Returns the new note_id.
        """
        if not self._collection:
            return "error: memory system not available"

        # Mark old note superseded
        try:
            result = self._collection.get(ids=[old_id])
            if result["ids"]:
                meta = result["metadatas"][0]
                new_id_placeholder = "pending"
                meta["superseded_by"] = new_id_placeholder
                self._collection.update(ids=[old_id], metadatas=[meta])
        except Exception as e:
            log.warning(f"supersede: could not mark old note {old_id}: {e}")

        # Write new note
        new_id = self.write_note(
            content=new_content,
            keywords=new_keywords,
            emotional_valence=new_valence,
            intensity=new_intensity,
            context_summary=new_context_summary,
            mood=mood,
        )

        # Update old note with real new_id
        try:
            result = self._collection.get(ids=[old_id])
            if result["ids"]:
                meta = result["metadatas"][0]
                meta["superseded_by"] = new_id
                self._collection.update(ids=[old_id], metadatas=[meta])
        except Exception as e:
            log.warning(f"supersede: could not update superseded_by on {old_id}: {e}")

        # Update new note with supersedes reference
        try:
            result = self._collection.get(ids=[new_id])
            if result["ids"]:
                meta = result["metadatas"][0]
                meta["supersedes"] = old_id
                self._collection.update(ids=[new_id], metadatas=[meta])
        except Exception as e:
            log.warning(f"supersede: could not set supersedes on {new_id}: {e}")

        log.debug(f"superseded {old_id[:8]} → {new_id[:8]}")
        return new_id

    # ── Consolidation ──────────────────────────────────────────────────────────

    def consolidate_embedding_pass(self) -> int:
        """
        Embedding-only link pass. No model needed. Always safe to run.

        For each note in pending_llm_consolidation, finds similar notes
        by embedding similarity above EMBEDDING_LINK_THRESHOLD and
        establishes bidirectional links in metadata.

        Returns number of new links added.
        """
        if not self._collection:
            return 0

        pending = list(self._meta.get("pending_llm_consolidation", []))
        if not pending:
            return 0

        links_added = 0

        for note_id in pending:
            try:
                result = self._collection.get(ids=[note_id], include=["embeddings", "metadatas", "documents"])
                if not result["ids"]:
                    continue

                embedding = result["embeddings"][0]
                meta = result["metadatas"][0]
                current_links = json.loads(meta.get("links", "[]"))

                # Query for similar notes (exclude self and already superseded)
                candidates = self._collection.query(
                    query_embeddings=[embedding],
                    n_results=min(10, self._collection.count()),
                    where={"superseded_by": {"$eq": ""}},
                )

                candidate_ids = candidates["ids"][0]
                candidate_distances = candidates["distances"][0]

                for cid, dist in zip(candidate_ids, candidate_distances):
                    if cid == note_id:
                        continue
                    # ChromaDB cosine distance: 0 = identical, 2 = opposite
                    # Convert to similarity: similarity = 1 - (dist / 2)
                    similarity = 1.0 - (dist / 2.0)
                    if similarity < EMBEDDING_LINK_THRESHOLD:
                        continue
                    if cid in current_links:
                        continue

                    # Add bidirectional link
                    current_links.append(cid)
                    self._add_link_to_note(cid, note_id)
                    links_added += 1

                meta["links"] = json.dumps(current_links)
                self._collection.update(ids=[note_id], metadatas=[meta])

            except Exception as e:
                log.warning(f"embedding pass error for {note_id}: {e}")

        log.info(f"embedding consolidation pass: {links_added} links added for {len(pending)} notes")
        return links_added

    def consolidate_llm_pass(self, llm_client, pending_ids: Optional[list] = None) -> int:
        """
        LLM quality-filter pass. Requires model to be available.

        llm_client must implement:
            llm_client.complete(prompt: str) -> str

        For each pending note, asks the LLM to evaluate embedding-candidate
        links and confirm which are genuinely related (not just superficially
        similar). Confirmed links are added; rejected candidates are removed.

        On completion, clears the pending list and updates last_consolidated_at.

        Returns number of links confirmed by LLM.
        """
        if not self._collection:
            return 0

        pending = pending_ids or list(self._meta.get("pending_llm_consolidation", []))
        if not pending:
            self._mark_consolidation_complete()
            return 0

        links_confirmed = 0

        for note_id in pending:
            try:
                result = self._collection.get(ids=[note_id], include=["metadatas", "documents"])
                if not result["ids"]:
                    continue

                note_doc = result["documents"][0]       # context_summary
                note_meta = result["metadatas"][0]
                note_content = note_meta.get("content", "")
                current_links = json.loads(note_meta.get("links", "[]"))

                if not current_links:
                    continue

                # Fetch candidate link content for LLM evaluation
                candidates_result = self._collection.get(
                    ids=current_links,
                    include=["metadatas", "documents"],
                )
                if not candidates_result["ids"]:
                    continue

                candidate_summaries = []
                for cid, cdoc, cmeta in zip(
                    candidates_result["ids"],
                    candidates_result["documents"],
                    candidates_result["metadatas"],
                ):
                    candidate_summaries.append(
                        f"ID: {cid}\nSummary: {cdoc}\nContent: {cmeta.get('content', '')[:120]}"
                    )

                prompt = _build_link_eval_prompt(
                    note_summary=note_doc,
                    note_content=note_content,
                    candidates=candidate_summaries,
                )

                response = llm_client.complete(prompt)
                confirmed_ids = _parse_link_eval_response(response, current_links)

                # Update links to only confirmed ones
                note_meta["links"] = json.dumps(confirmed_ids)
                self._collection.update(ids=[note_id], metadatas=[note_meta])
                links_confirmed += len(confirmed_ids)

                # Remove this note from any candidate that was rejected
                rejected = [cid for cid in current_links if cid not in confirmed_ids]
                for rid in rejected:
                    self._remove_link_from_note(rid, note_id)

            except Exception as e:
                log.warning(f"LLM pass error for {note_id}: {e}")

        # Clear pending list and mark complete
        self._meta["pending_llm_consolidation"] = []
        self._mark_consolidation_complete()

        log.info(f"LLM consolidation pass: {links_confirmed} links confirmed for {len(pending)} notes")
        return links_confirmed

    def get_pending_llm_consolidation(self) -> list[str]:
        """Return list of note IDs awaiting LLM link evaluation."""
        return list(self._meta.get("pending_llm_consolidation", []))

    def get_last_consolidated_at(self) -> Optional[str]:
        return self._meta.get("last_consolidated_at")

    def set_last_consolidated_at(self, timestamp: Optional[str] = None) -> None:
        self._meta["last_consolidated_at"] = timestamp or datetime.now(timezone.utc).isoformat()
        self._save_meta()

    def _mark_consolidation_complete(self) -> None:
        self._meta["last_consolidated_at"] = datetime.now(timezone.utc).isoformat()
        self._save_meta()

    # ── Link helpers ───────────────────────────────────────────────────────────

    def _add_link_to_note(self, note_id: str, link_id: str) -> None:
        """Add link_id to note_id's links list (bidirectional helper)."""
        try:
            result = self._collection.get(ids=[note_id], include=["metadatas"])
            if not result["ids"]:
                return
            meta = result["metadatas"][0]
            links = json.loads(meta.get("links", "[]"))
            if link_id not in links:
                links.append(link_id)
                meta["links"] = json.dumps(links)
                self._collection.update(ids=[note_id], metadatas=[meta])
        except Exception as e:
            log.warning(f"_add_link_to_note error: {e}")

    def _remove_link_from_note(self, note_id: str, link_id: str) -> None:
        """Remove link_id from note_id's links list."""
        try:
            result = self._collection.get(ids=[note_id], include=["metadatas"])
            if not result["ids"]:
                return
            meta = result["metadatas"][0]
            links = json.loads(meta.get("links", "[]"))
            if link_id in links:
                links.remove(link_id)
                meta["links"] = json.dumps(links)
                self._collection.update(ids=[note_id], metadatas=[meta])
        except Exception as e:
            log.warning(f"_remove_link_from_note error: {e}")

    # ── Result unpacking ───────────────────────────────────────────────────────

    @staticmethod
    def _unpack_results(results: dict) -> list[dict]:
        """
        Convert ChromaDB query results into a list of note dicts.
        Reconstructs primitive_ratios from flat metadata keys.
        """
        notes = []
        ids = results.get("ids", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        documents = results.get("documents", [[]])[0]
        distances = results.get("distances", [[]])[0]

        for nid, meta, doc, dist in zip(ids, metadatas, documents, distances):
            note = dict(meta)
            note["id"] = nid
            note["context_summary"] = doc
            note["similarity"] = round(1.0 - (dist / 2.0), 4) if dist is not None else None
            note["keywords"] = json.loads(meta.get("keywords", "[]"))
            note["links"] = json.loads(meta.get("links", "[]"))
            note["primitive_ratios"] = {
                "S": meta.get("ratio_S", 0.0),
                "N": meta.get("ratio_N", 0.0),
                "F": meta.get("ratio_F", 0.0),
                "T": meta.get("ratio_T", 0.0),
            }
            notes.append(note)

        return notes

    # ── Retrieval helpers ──────────────────────────────────────────────────────

    def _session_start_type_prefs(self, dominant_fn: str) -> list[str]:
        """
        Return preferred composite labels for session-start retrieval
        based on the dominant function type.
        """
        prefs = {
            "T": ["conclusion", "reason"],
            "F": ["relation", "impression"],
            "N": ["conclusion", "relation"],
            "S": ["reason", "impression"],
        }
        return prefs.get(dominant_fn, ["conclusion", "reason"])

    @staticmethod
    def _apply_type_preference(notes: list[dict], preferred_labels: list[str]) -> list[dict]:
        """
        Re-rank notes so preferred composite types appear first.
        Preserves relative order within each group.
        """
        preferred = [n for n in notes if n.get("composite_label") in preferred_labels]
        others = [n for n in notes if n.get("composite_label") not in preferred_labels]
        return preferred + others

    @staticmethod
    def _apply_recency_boost(notes: list[dict]) -> list[dict]:
        """
        Slightly boost notes that haven't been recalled recently.
        This surfaces "forgotten" memories that are still relevant.
        Notes never recalled recently get a small bump in sort order.
        """
        now = datetime.now(timezone.utc)

        def recency_score(note: dict) -> float:
            last = note.get("last_recalled_at", "")
            try:
                dt = datetime.fromisoformat(last)
                days_ago = (now - dt).days
                # Notes not recalled in >7 days get a bump
                return min(days_ago / 7.0, 1.0) * 0.15
            except Exception:
                return 0.1   # unknown = small boost

        notes_scored = [(n, recency_score(n)) for n in notes]
        # Add recency boost to similarity score if available
        notes_scored.sort(
            key=lambda x: (x[0].get("similarity") or 0.5) + x[1],
            reverse=True,
        )
        return [n for n, _ in notes_scored]

    # ── Debug / inspection ─────────────────────────────────────────────────────

    def count(self) -> int:
        """Return total number of notes in the store."""
        if not self._collection:
            return 0
        return self._collection.count()

    def get_note(self, note_id: str) -> Optional[dict]:
        """Fetch a single note by ID. Returns None if not found."""
        if not self._collection:
            return None
        try:
            result = self._collection.get(
                ids=[note_id],
                include=["metadatas", "documents"],
            )
            if not result["ids"]:
                return None
            meta = result["metadatas"][0]
            note = dict(meta)
            note["id"] = note_id
            note["context_summary"] = result["documents"][0]
            note["keywords"] = json.loads(meta.get("keywords", "[]"))
            note["links"] = json.loads(meta.get("links", "[]"))
            note["primitive_ratios"] = {
                "S": meta.get("ratio_S", 0.0),
                "N": meta.get("ratio_N", 0.0),
                "F": meta.get("ratio_F", 0.0),
                "T": meta.get("ratio_T", 0.0),
            }
            return note
        except Exception as e:
            log.warning(f"get_note error: {e}")
            return None

    def is_available(self) -> bool:
        """Return True if ChromaDB is installed and the collection is open."""
        return self._collection is not None


# ── LLM link evaluation helpers ────────────────────────────────────────────────

def _build_link_eval_prompt(
    note_summary: str,
    note_content: str,
    candidates: list[str],
) -> str:
    """
    Build the prompt for LLM-based link evaluation during consolidation.
    The LLM returns a JSON list of IDs it considers genuinely related.
    """
    candidates_text = "\n\n".join(candidates)
    return f"""You are evaluating memory connections for a companion AI.

A memory note has been written:
Summary: {note_summary}
Content: {note_content}

The following candidate notes have been flagged as potentially related by
semantic similarity. Evaluate each one and decide if it is GENUINELY related
to the main note — meaning there is a real conceptual, emotional, or factual
connection — not just superficial word overlap.

Candidates:
{candidates_text}

Reply with ONLY a JSON array of the IDs of genuinely related candidates.
If none are genuinely related, reply with an empty array: []
Do not include any other text."""


def _parse_link_eval_response(response: str, valid_ids: list[str]) -> list[str]:
    """
    Parse the LLM's JSON array response from link evaluation.
    Validates that returned IDs are in the valid_ids list.
    Falls back to empty list on any parse error.
    """
    response = response.strip()
    # Strip any accidental markdown fences
    if response.startswith("```"):
        lines = response.splitlines()
        response = "\n".join(
            line for line in lines
            if not line.startswith("```")
        ).strip()
    try:
        parsed = json.loads(response)
        if not isinstance(parsed, list):
            return []
        # Only return IDs that actually exist in the candidate set
        return [str(item) for item in parsed if str(item) in valid_ids]
    except json.JSONDecodeError:
        log.warning(f"link eval parse error: {response[:100]}")
        return []
