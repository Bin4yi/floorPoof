"""Exit distance: shortest walk to the nearest exit, times cell size, within the rule limit.

Multi-hop: shortestPath length over ADJACENT cells (see paths.py).
Walks move in grid steps, so the measured length is never shorter than the real walk.
"""
from .base import Ctx, Result, fail, ok, skipped
from .paths import nearest_exits


def run(ctx: Ctx) -> Result:
    p = ctx.params
    key = "max_m_sprinklered" if ctx.sprinklered else "max_m_unsprinklered"
    limit = p.get(key)
    if limit is None:
        return skipped(ctx, f"Limit {key} is TBD (no source yet).")
    near = nearest_exits(ctx)
    walks = {iid: n["hops"] * ctx.cell_m for iid, n in near.items() if n["hops"] is not None}
    if not walks:
        return ok(ctx, "No reachable work positions to measure.", limit_m=limit)
    worst_id = max(walks, key=walks.get)
    over = sorted((iid for iid, w in walks.items() if w > limit), key=lambda i: -walks[i])
    data = {"limit_m": limit, "worst_m": round(walks[worst_id], 2), "worst_item": worst_id}
    if not over:
        return ok(ctx, f"Longest walk to an exit is {walks[worst_id]:.1f} m ({worst_id}), limit {limit} m.", **data)
    cells = [c for iid in over for c in near[iid]["cells"]]
    names = ", ".join(f"{i} {walks[i]:.1f} m" for i in over[:5]) + (" ..." if len(over) > 5 else "")
    return fail(ctx, f"Walk to nearest exit over {limit} m: {names}.", cells,
                paths={i: near[i]["cells"] for i in over[:5]}, **data)
