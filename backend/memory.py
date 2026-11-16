"""Agent memory with Relate vector search.

Every recorded or accepted proposal stores a vector of its request text on the
Proposal node. A vector index (with the floor and status as filter properties)
lets the agent find proven layouts for similar past requests:

    MATCH (p:Proposal)
    SEARCH p IN (VECTOR INDEX proposal_request FOR vector($q, 256, FLOAT32)
                 WHERE p.floor = $f LIMIT 12) SCORE AS score

The vector is a hashed bag of words and word pairs (no embedding model, no
network call): good at "same words", not at synonyms. The model only sees past
layouts as examples; the graph checks still decide pass or fail.
"""
from __future__ import annotations

import hashlib
import json
import math
import re

from .graph.db import Graph

DIM = 256
INDEX = "proposal_request"
GOOD = ("passed", "chosen", "accepted")
STOP = {"a", "an", "the", "to", "of", "in", "on", "and", "for", "with", "at", "by", "please", "it", "is", "be"}


def embed(text: str) -> list[float]:
    words = [w for w in re.findall(r"[a-z]+|\d+", text.lower()) if w not in STOP]
    words = [w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words]  # machines -> machine
    feats = words + [f"{a}_{b}" for a, b in zip(words, words[1:])]
    v = [0.0] * DIM
    for f in feats:
        h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
        v[h % DIM] += (1.0 if (h >> 32) & 1 else -1.0) * (1.0 if "_" not in f else 0.7)
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [round(x / n, 6) for x in v]


def ensure_index(g: Graph) -> None:
    g.q(f"""CREATE VECTOR INDEX {INDEX} IF NOT EXISTS FOR (p:Proposal) ON (p.req_vec) WITH [p.floor, p.status]
            OPTIONS {{indexConfig: {{`vector.dimensions`: {DIM}, `vector.similarity_function`: 'cosine'}}}}""")


def set_vector(g: Graph, proposal_id: str, request: str) -> None:
    if request.strip():
        g.q(f"MATCH (p:Proposal {{id:$id}}) SET p.req_vec = vector($v, {DIM}, FLOAT32)",
            {"id": proposal_id, "v": embed(request)})


def backfill(g: Graph) -> int:
    """Give older proposals (stored before memory existed) a vector."""
    rows = g.q("MATCH (p:Proposal) WHERE p.req_vec IS NULL AND p.request IS NOT NULL AND p.request <> '' "
               "RETURN p.id AS id, p.request AS r")
    for r in rows:
        set_vector(g, r["id"], r["r"])
    return len(rows)


def recall(g: Graph, floor: str, request: str, k: int = 3, min_score: float = 0.35) -> list[dict]:
    """Proven layouts for the most similar past requests on this floor (one per request text)."""
    if not request.strip():
        return []
    rows = g.q(f"""MATCH (p:Proposal)
        SEARCH p IN (VECTOR INDEX {INDEX} FOR vector($q, {DIM}, FLOAT32) WHERE p.floor = $f LIMIT 40) SCORE AS score
        RETURN p.id AS id, p.request AS request, p.status AS status, p.changes AS changes, p.note AS note,
               p.source AS source, score ORDER BY score DESC""", {"q": embed(request), "f": floor})
    out, seen = [], set()
    for r in rows:
        key = (r["request"] or "").strip().lower()
        if r["status"] not in GOOD or r["score"] < min_score or key in seen or not r["changes"]:
            continue
        seen.add(key)
        out.append({"id": r["id"], "request": r["request"], "status": r["status"], "note": r["note"] or "",
                    "source": r["source"], "score": round(float(r["score"]), 3), "changes": json.loads(r["changes"])})
        if len(out) >= k:
            break
    return out


def as_prompt(memories: list[dict]) -> str:
    if not memories:
        return ""
    lines = ["PROVEN LAYOUTS FOR SIMILAR PAST REQUESTS (found by vector search in the graph; they passed every "
             "check on the floor as it was then; the floor may have changed since, so use them as hints only):"]
    for m in memories:
        lines.append(f"- request: {m['request']!r} (similarity {m['score']}) changes: {json.dumps(m['changes'])}")
    return "\n".join(lines)
