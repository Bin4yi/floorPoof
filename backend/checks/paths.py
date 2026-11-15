"""Shared multi-hop path query: shortest walk from each work position to each exit.

Walks follow ADJACENT links, which exist only between walkable cells, so any
item standing in the way removes the link and the path must go around it.
Used by exit_reach and exit_distance. Cached per check run.
"""
from __future__ import annotations

from .base import Ctx

NEAREST_EXIT = """
MATCH (i:Item {floor:$f})
OPTIONAL MATCH (i)-[:WORKS_AT]->(w:Cell)
WITH i, w
MATCH (e:Exit {floor:$f})-[:AT]->(t:Cell)
OPTIONAL MATCH p = shortestPath((w)-[:ADJACENT*0..]->(t))
RETURN i.id AS id, w.x AS wx, w.y AS wy, w.walkable AS walkable, e.name AS exit,
       length(p) AS hops, [n IN nodes(p) | [n.x, n.y]] AS cells
"""


def nearest_exits(ctx: Ctx) -> dict[str, dict]:
    """item id -> {work: [x,y] | None, walkable, exit, hops (None if no path), cells}"""
    if "nearest" in ctx.cache:
        return ctx.cache["nearest"]
    best: dict[str, dict] = {}
    for r in ctx.g.q(NEAREST_EXIT, {"f": ctx.floor}):
        cur = best.get(r["id"])
        work = None if r["wx"] is None else [r["wx"], r["wy"]]
        cand = {"work": work, "walkable": bool(r["walkable"]), "exit": r["exit"], "hops": r["hops"],
                "cells": r["cells"] or []}
        if cur is None or (cand["hops"] is not None and (cur["hops"] is None or cand["hops"] < cur["hops"])):
            best[r["id"]] = cand
    ctx.cache["nearest"] = best
    return best
