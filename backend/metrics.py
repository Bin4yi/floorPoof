"""Worker efficiency metrics, measured on the graph. These are measurements, not rules:
nothing here passes or fails a layout.

Aspects (each also given as a 0-100 index with a stated formula):
  evacuation   walk from each work position to its nearest exit (shortestPath over ADJACENT)
               index = 100 * (1 - mean walk / exit-distance limit of the floor's rule,
               or floor width + depth when the floor has no such rule)
  line_travel  walk between consecutive stations of each line (FEEDS, then shortestPath)
  material     walk along the pack's material flows (ItemType)-[:FLOWS_TO]->(ItemType),
               from each source item to its nearest target item
  travel       index = 100 * (1 - mean route walk / (floor width + depth)), over line and material routes
  crowding     how many operators' exit routes pass through the busiest cell
               index = 100 * (1 - busiest cell / operators)
  elbow_room   free cells within 2 steps of each work position (NEIGHBOR, two hops)
               index = 100 * mean free cells / 12 (12 cells lie within 2 steps)
  power        index = 100 * mean spare share of every power unit (1 - load / limit)
  openness     index = 100 * walkable cells / all cells
"""
from __future__ import annotations

import json
import statistics
import time
from collections import Counter

from .checks.panel_load import LOADS
from .checks.paths import NEAREST_EXIT
from .graph.db import Graph

LINE_STEPS = """
MATCH (a:Item {floor:$f})-[:FEEDS]->(b:Item)
MATCH (a)-[:IN_LINE]->(l:Line)
MATCH (a)-[:WORKS_AT]->(wa:Cell), (b)-[:WORKS_AT]->(wb:Cell)
OPTIONAL MATCH p = shortestPath((wa)-[:ADJACENT*0..]->(wb))
RETURN l.name AS line, a.id AS a, b.id AS b, wa.x AS ax, wa.y AS ay, wb.x AS bx, wb.y AS by,
       length(p) AS hops, [n IN nodes(p) | [n.x, n.y]] AS cells
"""

# A flow can be limited to line ends: role 'head' = first station of a line, 'tail' = last station.
FLOWS = """
MATCH (:Floor {name:$f})-[:USES_PACK]->(pk:RulePack)
MATCH (ta:ItemType {pack:pk.name})-[fl:FLOWS_TO]->(tb:ItemType {pack:pk.name})
MATCH (a:Item {floor:$f})-[:IS_A]->(ta)
WHERE fl.from_role IS NULL
   OR (fl.from_role = 'tail' AND EXISTS { (a)-[:IN_LINE]->() } AND NOT EXISTS { (a)-[:FEEDS]->(:Item) })
MATCH (b:Item {floor:$f})-[:IS_A]->(tb)
WHERE fl.to_role IS NULL
   OR (fl.to_role = 'head' AND EXISTS { (b)-[:IN_LINE]->() } AND NOT EXISTS { (:Item)-[:FEEDS]->(b) })
MATCH (a)-[:WORKS_AT]->(wa:Cell), (b)-[:WORKS_AT]->(wb:Cell)
OPTIONAL MATCH p = shortestPath((wa)-[:ADJACENT*0..]->(wb))
RETURN fl.name AS flow, a.id AS a, b.id AS b, wa.x AS ax, wa.y AS ay, wb.x AS bx, wb.y AS by,
       length(p) AS hops, [n IN nodes(p) | [n.x, n.y]] AS cells
"""

ELBOW = """
MATCH (i:Item {floor:$f})-[:WORKS_AT]->(w:Cell)
OPTIONAL MATCH (w)-[:NEIGHBOR]-(n1:Cell)
OPTIONAL MATCH (n1)-[:NEIGHBOR]-(n2:Cell)
WITH i, w, collect(DISTINCT n1) + collect(DISTINCT n2) AS ns
UNWIND ns AS n
WITH i, w, n WHERE n <> w AND n.walkable
RETURN i.id AS id, count(DISTINCT n) AS free
"""


def _clip(v: float) -> float:
    return round(max(0.0, min(100.0, v)), 1)


def compute(g: Graph, floor: str, results: list[dict] | None = None) -> dict:
    t0 = time.perf_counter()
    p = {"f": floor}
    info = g.one("""MATCH (f:Floor {name:$f}) OPTIONAL MATCH (f)-[:USES_PACK]->(:RulePack)-[:HAS_RULE]->(r:Rule {kind:'exit_distance'})
                    RETURN f.cell_m AS c, f.sprinklered AS s, f.cols * f.rows AS cells, r.params AS ed,
                           f.width_m + f.depth_m AS span""", p)
    cm = info["c"]
    ed = json.loads(info["ed"]) if info["ed"] else {}
    limit = ed.get("max_m_sprinklered" if info["s"] else "max_m_unsprinklered")
    span = info["span"]
    evac_basis = f"exit distance limit {limit} m" if limit else f"floor width + depth {span} m"
    limit = limit or span

    # Evacuation: reuse the exit check's paths when we have them (same query).
    paths = None
    for r in results or []:
        if r["kind"] == "exit_reach":
            paths = r.get("data", {}).get("paths")
    if paths is None:
        best: dict = {}
        for r in g.q(NEAREST_EXIT, p):
            if r["hops"] is not None and (r["id"] not in best or r["hops"] < best[r["id"]]["hops"]):
                best[r["id"]] = {"exit": r["exit"], "cells": r["cells"], "hops": r["hops"]}
        paths = {k: {"exit": v["exit"], "cells": v["cells"], "m": v["hops"] * cm} for k, v in best.items()}
    walks = sorted(v["m"] for v in paths.values())
    n_items = g.one("MATCH (i:Item {floor:$f}) RETURN count(i) AS n", p)["n"]

    crowd = Counter()
    for v in paths.values():
        for c in v["cells"][1:]:  # not the operator's own cell
            crowd[tuple(c)] += 1
    busiest = max(crowd.values()) if crowd else 0
    hot = [[x, y, n] for (x, y), n in crowd.most_common() if n >= 3][:400]

    def routes(rows: list[dict], key: str) -> list[dict]:
        out = []
        for r in rows:
            out.append({key: r[key], "a": r["a"], "b": r["b"],
                        "m": None if r["hops"] is None else r["hops"] * cm,
                        "straight_m": (abs(r["ax"] - r["bx"]) + abs(r["ay"] - r["by"])) * cm, "cells": r["cells"] or []})
        return out

    steps = routes(g.q(LINE_STEPS, p), "line")
    flow_rows = routes(g.q(FLOWS, p), "flow")
    # Each source item goes to its nearest target, per flow.
    nearest: dict = {}
    for r in flow_rows:
        k = (r["flow"], r["a"])
        if r["m"] is not None and (k not in nearest or r["m"] < nearest[k]["m"]):
            nearest[k] = r
    flows = list(nearest.values())

    per_line: dict = {}
    for s in steps:
        d = per_line.setdefault(s["line"], {"name": s["line"], "m": 0.0, "steps": 0, "blocked": 0})
        if s["m"] is None:
            d["blocked"] += 1
        else:
            d["m"] += s["m"]
            d["steps"] += 1
    per_flow: dict = {}
    for f in flows:
        d = per_flow.setdefault(f["flow"], {"name": f["flow"], "m": 0.0, "trips": 0})
        d["m"] += f["m"]
        d["trips"] += 1
    walked = [r for r in steps + flows if r["m"]]
    travel = 100 * (1 - statistics.mean(r["m"] for r in walked) / span) if walked else None

    elbow = {r["id"]: r["free"] for r in g.q(ELBOW, p)}
    elbow_vals = [elbow.get(i, 0) for i in paths] or list(elbow.values())

    loads = g.q(LOADS, p)
    factor = 1.25
    pl = g.one("""MATCH (:Floor {name:$f})-[:USES_PACK]->(:RulePack)-[:HAS_RULE]->(r:Rule {kind:'panel_load'})
                  RETURN r.params AS params""", p)
    if pl and pl["params"]:
        factor = json.loads(pl["params"]).get("continuous_factor") or factor
    spare = [1 - r["kw"] / (r["cap"] / factor) for r in loads if r["cap"]]
    walkable = g.one("MATCH (c:Cell {floor:$f}) WHERE c.walkable RETURN count(c) AS n", p)["n"]

    aspects = {
        "evacuation": _clip(100 * (1 - statistics.mean(walks) / limit)) if walks and limit else None,
        "travel": _clip(travel) if travel is not None else None,
        "crowding": _clip(100 * (1 - busiest / max(len(paths), 1))) if paths else None,
        "elbow_room": _clip(100 * statistics.mean(elbow_vals) / 12) if elbow_vals else None,
        "power": _clip(100 * statistics.mean(spare)) if spare else None,
        "openness": _clip(100 * walkable / info["cells"]),
    }
    vals = [v for v in aspects.values() if v is not None]
    return {
        "index": round(statistics.mean(vals), 1) if vals else None,
        "aspects": aspects,
        "kpi": {
            "workers": n_items,
            "evac_mean_m": round(statistics.mean(walks), 1) if walks else None,
            "evac_max_m": round(max(walks), 1) if walks else None,
            "line_travel_m": round(sum(d["m"] for d in per_line.values()), 1),
            "material_m": round(sum(d["m"] for d in per_flow.values()), 1),
            "busiest_cell": busiest,
            "elbow_mean": round(statistics.mean(elbow_vals), 1) if elbow_vals else None,
            "walkable_pct": round(100 * walkable / info["cells"], 1),
        },
        "walks": walks,
        "elbow": elbow,
        "lines": sorted(per_line.values(), key=lambda d: d["name"]),
        "flows": sorted(per_flow.values(), key=lambda d: d["name"]),
        "routes": {"line": [{k: s[k] for k in ("line", "a", "b", "m", "cells")} for s in steps if s["cells"]],
                   "flow": [{k: f[k] for k in ("flow", "a", "b", "m", "cells")} for f in flows if f["cells"]]},
        "crowd": hot,
        "limit_m": limit, "evac_basis": evac_basis, "span_m": span,
        "ms": round((time.perf_counter() - t0) * 1000, 1),
    }
