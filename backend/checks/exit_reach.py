"""Exit reach: every work position can walk to an exit, and no exit cell is blocked.

Multi-hop: shortestPath over ADJACENT walkable cells (see paths.py).
"""
from .base import Ctx, Result, fail, item_cells, ok
from .paths import nearest_exits

BLOCKED_EXITS = """MATCH (e:Exit {floor:$f})-[:AT]->(c:Cell) WHERE NOT c.walkable
MATCH (c)<-[:OCCUPIES]-(i:Item)
RETURN e.name AS exit, c.x AS x, c.y AS y, collect(i.id) AS ids"""

BLOCKED_BY = """UNWIND $cells AS k MATCH (c:Cell {floor:$f, x:k[0], y:k[1]})<-[:OCCUPIES]-(i:Item)
RETURN k AS cell, collect(i.id) AS ids"""


def run(ctx: Ctx) -> Result:
    reasons, cells = [], []
    for r in ctx.g.q(BLOCKED_EXITS, {"f": ctx.floor}):
        reasons.append(f"exit {r['exit']} is blocked by {', '.join(sorted(r['ids']))}")
        cells.append([r["x"], r["y"]])

    near = nearest_exits(ctx)
    off, blocked, stuck = [], [], []
    for iid, n in sorted(near.items()):
        if n["work"] is None:
            off.append(iid)
        elif not n["walkable"]:
            blocked.append((iid, n["work"]))
        elif n["hops"] is None:
            stuck.append((iid, n["work"]))
    if off:
        reasons.append(f"work position of {', '.join(off)} is off the floor")
        cells += item_cells(ctx, off)
    if blocked:
        by = {tuple(r["cell"]): r["ids"] for r in ctx.g.q(BLOCKED_BY, {"f": ctx.floor, "cells": [w for _, w in blocked]})}
        for iid, w in blocked:
            others = [o for o in by.get(tuple(w), []) if o != iid]
            reasons.append(f"work position of {iid} is blocked" + (f" by {', '.join(others)}" if others else ""))
            cells.append(w)
    if stuck:
        ids = [i for i, _ in stuck]
        reasons.append(f"{', '.join(ids)} cannot walk to any exit")
        cells += [w for _, w in stuck] + item_cells(ctx, ids)

    # The walking path of each item to its nearest exit, for drawing in the 3D view.
    paths = {iid: {"exit": n["exit"], "cells": n["cells"], "m": n["hops"] * ctx.cell_m}
             for iid, n in near.items() if n["hops"] is not None}
    if not reasons:
        return ok(ctx, f"All {len(near)} work positions reach an exit.", positions=len(near), paths=paths)
    return fail(ctx, "; ".join(reasons) + ".", cells, positions=len(near), paths=paths)
