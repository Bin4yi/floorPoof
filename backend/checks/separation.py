"""Separation: items whose types are joined by MUST_BE_FAR_FROM keep the minimum gap.

The gap is the closest centre distance between occupied cells, minus one cell.
"""
from .base import Ctx, Result, fail, item_cells, ok, skipped

PAIRS = """MATCH (ta:ItemType)-[r:MUST_BE_FAR_FROM]->(tb:ItemType)
WHERE (ta)<-[:APPLIES_TO]-(:Rule {id:$rule})
RETURN ta.name AS a, tb.name AS b, r.min_m AS min_m"""

GAPS = """MATCH (ta:ItemType {name:$a})-[r:MUST_BE_FAR_FROM]->(tb:ItemType {name:$b})
MATCH (x:Item {floor:$f})-[:IS_A]->(ta), (y:Item {floor:$f})-[:IS_A]->(tb)
MATCH (x)-[:OCCUPIES]->(cx:Cell), (y)-[:OCCUPIES]->(cy:Cell)
WITH x, y, min(sqrt((cx.x - cy.x) ^ 2 + (cx.y - cy.y) ^ 2)) AS d
RETURN x.id AS a, y.id AS b, d"""


def run(ctx: Ctx) -> Result:
    pairs = ctx.g.q(PAIRS, {"rule": ctx.rule["id"]})
    if not pairs:
        return ok(ctx, "No separation pairs in this pack.")
    pending = [f"{p['a']} / {p['b']}" for p in pairs if p["min_m"] is None]
    live = [p for p in pairs if p["min_m"] is not None]
    if not live:
        return skipped(ctx, f"Minimum distance is TBD (no source yet) for {', '.join(pending)}.")
    bad, ids = [], []
    for p in live:
        for r in ctx.g.q(GAPS, {"f": ctx.floor, "a": p["a"], "b": p["b"]}):
            gap = max(0.0, r["d"] - 1) * ctx.cell_m
            if gap < p["min_m"]:
                bad.append(f"{r['a']} is {gap:.1f} m from {r['b']} (min {p['min_m']} m)")
                ids += [r["a"], r["b"]]
    note = f" Not checked (TBD): {', '.join(pending)}." if pending else ""
    if not bad:
        return ok(ctx, "All separated pairs keep their distance." + note)
    return fail(ctx, "; ".join(bad) + "." + note, item_cells(ctx, sorted(set(ids))))
