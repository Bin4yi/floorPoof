"""Check runner. Rules come from the graph; each Rule.kind maps to one check file."""
from __future__ import annotations

import time

from ..graph.db import Graph
from . import aisle_width, exit_distance, exit_reach, line_flow, overlap, panel_load, separation
from .base import Ctx, Result

CHECKS = {
    "overlap": overlap.run,
    "exit_reach": exit_reach.run,
    "exit_distance": exit_distance.run,
    "aisle_width": aisle_width.run,
    "panel_load": panel_load.run,
    "separation": separation.run,
    "line_flow": line_flow.run,
}

RULES = """MATCH (f:Floor {name:$f})-[:USES_PACK]->(:RulePack)-[:HAS_RULE]->(r:Rule)
RETURN r.id AS id, r.kind AS kind, r.title AS title, r.params AS params, r.status AS status,
       r.source_url AS source_url, r.source_note AS source_note, f.cell_m AS cell_m, f.sprinklered AS sprinklered
ORDER BY r.id"""


def run_checks(g: Graph, floor: str) -> list[dict]:
    """Run every rule of the floor's pack against the current graph state."""
    rules = g.q(RULES, {"f": floor})
    cache: dict = {}
    out = []
    for r in rules:
        ctx = Ctx(g, floor, r["cell_m"], bool(r["sprinklered"]), r, cache)
        t0 = time.perf_counter()
        fn = CHECKS.get(r["kind"])
        g.trace = []  # record the graph queries this check runs, with Relate's timings
        try:
            if fn is None:
                res = Result(r["id"], r["kind"], "skipped", f"No check for rule kind {r['kind']!r}.")
            else:
                res = fn(ctx)
        finally:
            queries, g.trace = g.trace, None
        res.ms = round((time.perf_counter() - t0) * 1000, 2)
        res.title, res.source_url, res.source_note = r["title"], r["source_url"], r["source_note"] or ""
        out.append({**res.to_dict(), "queries": queries})
    return out


def summary(results: list[dict]) -> dict:
    failed = [r["rule_id"] for r in results if r["status"] == "fail"]
    return {"passed": not failed, "failed": failed,
            "skipped": [r["rule_id"] for r in results if r["status"] == "skipped"],
            "ms": round(sum(r["ms"] for r in results), 2)}
