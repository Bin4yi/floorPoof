"""Panel load: sum of item kW at every level of the power tree, against the continuous limit.

Multi-hop: (Item)-[:POWERED_BY]->(drop box)-[:FED_BY*0..8]->(panel) reaches the
drop box, its sub-panel and the main breaker in one pattern. The upper bound (8
levels, far more than any power tree here) follows Relate's own query notice.
"""
from .base import Ctx, Result, fail, item_cells, ok, skipped

LOADS = """MATCH (p:PowerPanel {floor:$f})
OPTIONAL MATCH (i:Item)-[:POWERED_BY]->(:PowerPanel)-[:FED_BY*0..8]->(p)
OPTIONAL MATCH (i)-[:IS_A]->(t:ItemType)
RETURN p.name AS name, p.kind AS kind, p.capacity_kw AS cap, p.x AS x, p.y AS y,
       sum(coalesce(t.kw, 0.0)) AS kw, collect(i.id) AS items
ORDER BY name"""

DIRECT = """MATCH (i:Item {floor:$f})-[:POWERED_BY]->(p:PowerPanel) WHERE p.name IN $names RETURN collect(i.id) AS ids"""

KIND_ORDER = {"drop_box": 0, "sub_panel": 1, "main_breaker": 2}


def run(ctx: Ctx) -> Result:
    factor = ctx.params.get("continuous_factor")
    if factor is None:
        return skipped(ctx, "Continuous load factor is TBD (no source yet).")
    rows = ctx.g.q(LOADS, {"f": ctx.floor})
    if not rows:
        return ok(ctx, "No power panels on this floor.", loads=[])
    loads = [{"name": r["name"], "kind": r["kind"], "capacity_kw": r["cap"], "limit_kw": round(r["cap"] / factor, 2),
              "kw": round(r["kw"], 2), "items": sorted(r["items"])} for r in rows]
    loads.sort(key=lambda l: (KIND_ORDER.get(l["kind"], 9), l["name"]))
    over = [l for l in loads if l["kw"] > l["limit_kw"] + 1e-9]
    if not over:
        return ok(ctx, f"All {len(loads)} power units within {100 / factor:.0f}% of rating.", loads=loads)
    by_xy = {r["name"]: [r["x"], r["y"]] for r in rows}
    cells = [by_xy[l["name"]] for l in over]
    direct = ctx.g.one(DIRECT, {"f": ctx.floor, "names": [l["name"] for l in over if l["kind"] == "drop_box"]})
    cells += item_cells(ctx, direct["ids"] if direct else [])
    names = "; ".join(f"{l['kind'].replace('_', ' ')} {l['name']} {l['kw']} kW > limit {l['limit_kw']} kW"
                      for l in over)
    return fail(ctx, names + ".", cells, loads=loads, over=[l["name"] for l in over])
