"""Does a change list do what a test request asked? Used only to score Part 2 and 3.

This is not a safety check. Safety is decided by backend.checks.
"""
from __future__ import annotations

from ..graph.db import Graph
from ..graph.layout import LayoutError, normalize_changes


def satisfies(g: Graph, floor: str, must: dict, changes: list) -> tuple[bool, str]:
    try:
        ch = normalize_changes(changes)
    except LayoutError as e:
        return False, str(e)
    zones = {z["name"]: z for z in g.q("""MATCH (z:Zone {floor:$f}) RETURN z.name AS name, z.x0 AS x0, z.y0 AS y0,
                                           z.x1 AS x1, z.y1 AS y1""", {"f": floor})}
    adds = [c for c in ch if c.get("op") == "add"]
    for want in must.get("add", []):
        got = [c for c in adds if c.get("type") == want["type"]
               and ("line" not in want or c.get("line") == want["line"])]
        if "zone" in want:
            z = zones[want["zone"]]
            got = [c for c in got if z["x0"] <= c.get("x", -1) <= z["x1"] and z["y0"] <= c.get("y", -1) <= z["y1"]]
        if len(got) != want["count"]:
            where = f" in line {want['line']}" if "line" in want else (f" in {want['zone']}" if "zone" in want else "")
            return False, f"asked for {want['count']} {want['type']}{where}, layout adds {len(got)}"
    asked_removed = set(must.get("remove", []))
    extra = sorted(c.get("id") for c in ch if c.get("op") == "remove" and c.get("id") not in asked_removed)
    if extra:
        return False, f"removes items nobody asked to remove ({', '.join(extra)})"
    for iid in must.get("remove", []):
        if not any(c.get("op") == "remove" and c.get("id") == iid for c in ch):
            return False, f"{iid} was not removed"
    for iid in must.get("move", []):
        if not any(c.get("op") == "move" and c.get("id") == iid for c in ch):
            return False, f"{iid} was not moved"
    return True, "does what was asked"
