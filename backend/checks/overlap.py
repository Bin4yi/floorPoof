"""No overlap: no cell has more than one OCCUPIES link, and no item hangs off the floor."""
from .base import Ctx, Result, fail, ok

SHARED = """MATCH (c:Cell {floor:$f})<-[:OCCUPIES]-(i:Item)
WITH c, collect(i.id) AS ids WHERE size(ids) > 1
RETURN c.x AS x, c.y AS y, ids"""

OFF_FLOOR = """MATCH (i:Item {floor:$f})
WITH i, COUNT { (i)-[:OCCUPIES]->(:Cell) } AS n WHERE n < i.w * i.d
RETURN i.id AS id"""


def run(ctx: Ctx) -> Result:
    shared = ctx.g.q(SHARED, {"f": ctx.floor})
    off = [r["id"] for r in ctx.g.q(OFF_FLOOR, {"f": ctx.floor})]
    if not shared and not off:
        return ok(ctx, "No two items share a cell.")
    parts = []
    if shared:
        pairs = sorted({" and ".join(sorted(r["ids"])) for r in shared})
        parts.append(f"{', '.join(pairs)} overlap on {len(shared)} cell(s)")
    if off:
        parts.append(f"{', '.join(sorted(off))} partly off the floor")
    return fail(ctx, "; ".join(parts) + ".", [[r["x"], r["y"]] for r in shared], items=sorted(off))
