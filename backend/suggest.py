"""Best spots for one item: a quick scan of the whole floor, then real checks on the top picks.

1. Scan (fast, a hint only): inside a rolled-back draft, read the walkable cells,
   work positions, zones and power loads from the graph. Walk distances to the
   exits are found with a breadth-first search over the same walkable grid that
   the ADJACENT links describe. Every position where the item fits gets a score.
2. Prove: the best few, spread over the floor, are each written in their own
   draft and run through every graph check. Only those that pass are shown as
   proven picks. The scan never decides pass or fail.
"""
from __future__ import annotations

import json
import math
import time
from collections import deque

from .checks.panel_load import LOADS
from .engine import evaluate
from .graph.db import Graph
from .graph.geometry import ROTATIONS, footprint, work_cell
from .graph.layout import LayoutError, apply_changes, floor_info, item_types

BLOCKING_ZONES = ("aisle", "forklift_aisle")
AXIS = {"+x": (0, 1), "-x": (0, -1), "+y": (1, 1), "-y": (1, -1)}


def _read_state(tx: Graph, floor: str, changes: list[dict]) -> dict:
    apply_changes(tx, floor, changes)
    info = floor_info(tx, floor)
    p = {"f": floor}
    rules = {r["kind"]: json.loads(r["params"] or "{}") for r in tx.q(
        "MATCH (:Floor {name:$f})-[:USES_PACK]->(:RulePack)-[:HAS_RULE]->(r:Rule) RETURN r.kind AS kind, r.params AS params", p)}
    return {
        "info": info,
        "types": item_types(tx, info["pack"]),
        "rules": rules,
        "cells": tx.q("MATCH (c:Cell {floor:$f}) RETURN c.x AS x, c.y AS y, c.walkable AS w", p),
        "works": tx.q("MATCH (:Item {floor:$f})-[:WORKS_AT]->(c:Cell) RETURN c.x AS x, c.y AS y", p),
        "zones": tx.q("MATCH (z:Zone {floor:$f}) RETURN z.kind AS kind, z.x0 AS x0, z.y0 AS y0, z.x1 AS x1, z.y1 AS y1", p),
        "exits": tx.q("MATCH (e:Exit {floor:$f}) RETURN e.name AS name, e.x AS x, e.y AS y", p),
        "panels": tx.q("""MATCH (pp:PowerPanel {floor:$f}) OPTIONAL MATCH (pp)-[:FED_BY]->(q:PowerPanel)
                          RETURN pp.name AS name, pp.kind AS kind, pp.x AS x, pp.y AS y, q.name AS fed_by""", p),
        "loads": tx.q(LOADS, p),
        "same": tx.q("MATCH (i:Item {floor:$f}) RETURN i.type AS type, i.x AS x, i.y AS y, i.w AS w, i.d AS d", p),
        "line_items": tx.q("""MATCH (i:Item {floor:$f})-[r:IN_LINE]->(l:Line)
                              RETURN l.name AS line, l.direction AS dir, i.id AS id, i.x AS x, i.y AS y,
                                     i.w AS w, i.d AS d, r.seq AS seq""", p),
    }


def _bfs(free: set, exits: list[tuple[int, int]]) -> tuple[dict, dict]:
    """Walk distance (in cells) from every free cell to its nearest exit, and which exit."""
    dist, origin = {}, {}
    q = deque()
    for e in exits:
        if e in free:
            dist[e], origin[e] = 0, e
            q.append(e)
    while q:
        c = q.popleft()
        x, y = c
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n in free and n not in dist:
                dist[n] = dist[c] + 1
                origin[n] = origin[c]
                q.append(n)
    return dist, origin


def suggest(g: Graph, floor: str, changes: list[dict], type_name: str | None = None, rotation: int = 0,
            line: str | None = None, panel: str | None = None, move_id: str | None = None,
            top: int = 4, prove_max: int = 7) -> dict:
    t0 = time.perf_counter()
    if rotation not in ROTATIONS:
        raise LayoutError(f"rotation must be one of {ROTATIONS}")
    scan_changes = list(changes) + ([{"op": "remove", "id": move_id}] if move_id else [])
    moving = None
    if move_id:
        moving = g.one("""MATCH (i:Item {floor:$f, id:$id}) OPTIONAL MATCH (i)-[:POWERED_BY]->(p:PowerPanel)
                          OPTIONAL MATCH (i)-[r:IN_LINE]->(l:Line)
                          RETURN i.type AS type, p.name AS panel, l.name AS line, r.seq AS seq""",
                       {"f": floor, "id": move_id})
        if moving is None:  # an item added in this draft
            add = next((c for c in changes if c.get("op") == "add" and c.get("id") == move_id), None)
            if add is None:
                raise LayoutError(f"unknown item id {move_id!r}")
            moving = {"type": add["type"], "panel": add.get("panel"), "line": add.get("line"), "seq": None}
        type_name = moving["type"]
        panel = panel or moving["panel"]
        line = moving["line"]
    s = g.draft(lambda tx: _read_state(tx, floor, scan_changes))
    info, types = s["info"], s["types"]
    if type_name not in types:
        raise LayoutError(f"unknown item type {type_name!r}")
    t = types[type_name]
    cols, rows, cm = info["cols"], info["rows"], info["cell_m"]

    free = {(c["x"], c["y"]) for c in s["cells"] if c["w"]}
    exits = [(e["x"], e["y"]) for e in s["exits"]]
    exit_at = {(e["x"], e["y"]): e["name"] for e in s["exits"]}
    works = {(w["x"], w["y"]) for w in s["works"]}
    blocked_zone = set()
    for z in s["zones"]:
        if z["kind"] in BLOCKING_ZONES:
            blocked_zone |= {(x, y) for x in range(z["x0"], z["x1"] + 1) for y in range(z["y0"], z["y1"] + 1)}
    dist, origin = _bfs(free, exits)
    ed = s["rules"].get("exit_distance", {})
    limit_m = ed.get("max_m_sprinklered" if info["sprinklered"] else "max_m_unsprinklered")
    factor = s["rules"].get("panel_load", {}).get("continuous_factor")

    # Power: spare kW along each drop box's chain up to the main breaker.
    pans = {p["name"]: p for p in s["panels"]}
    load = {r["name"]: r["kw"] for r in s["loads"]}
    cap = {r["name"]: r["cap"] for r in s["loads"]}

    def spare(name: str) -> float:
        out, cur, seen = math.inf, name, set()
        while cur and cur in pans and cur not in seen:
            seen.add(cur)
            if factor:
                out = min(out, cap[cur] / factor - load.get(cur, 0))
            cur = pans[cur]["fed_by"]
        return out

    boxes = [p for p in s["panels"] if p["kind"] == "drop_box"]
    box_spare = {b["name"]: spare(b["name"]) for b in boxes}

    # Line: where along the line axis the item must sit.
    lo = hi = None
    k = sign = None
    if line:
        members = sorted((m for m in s["line_items"] if m["line"] == line), key=lambda m: (m["seq"] or 0, m["id"]))
        dirs = {m["dir"] for m in s["line_items"] if m["line"] == line}
        d = dirs.pop() if dirs else (g.one("MATCH (l:Line {floor:$f, name:$l}) RETURN l.direction AS d",
                                           {"f": floor, "l": line}) or {}).get("d", "+x")
        k, sign = AXIS.get(d, (0, 1))

        def centre(m):
            return (m["x"] + m["w"] / 2) if k == 0 else (m["y"] + m["d"] / 2)

        my_seq = moving["seq"] if moving and moving.get("seq") is not None else math.inf
        before = [m for m in members if (m["seq"] or 0) < my_seq]
        after = [m for m in members if (m["seq"] or 0) > my_seq]
        if before:
            lo = centre(before[-1]) * sign
        if after:
            hi = centre(after[0]) * sign
        anchor = before[-1] if before else (after[0] if after else None)

    # Keep like with like: items of the same type already on the floor (racks near racks ...).
    same = [(m["x"] + m["w"] / 2, m["y"] + m["d"] / 2) for m in s["same"] if m["type"] == type_name]
    heat, cands = [], []
    counts = {"fits": 0, "blocked_cells": 0, "aisle": 0, "no_exit": 0, "too_far": 0, "power": 0, "line": 0}
    kw = t["kw"] or 0
    for x in range(cols):
        for y in range(rows):
            fp = footprint(x, y, t["w"], t["d"], rotation)
            fw = max(c[0] for c in fp) - x + 1
            fd = max(c[1] for c in fp) - y + 1
            if x + fw > cols or y + fd > rows:
                continue
            fps = set(fp)
            if not fps <= free or fps & works or any(c in exit_at for c in fps):
                counts["blocked_cells"] += 1
                continue
            if fps & blocked_zone:
                counts["aisle"] += 1
                continue
            wc = work_cell(x, y, t["w"], t["d"], rotation)
            if wc not in free or wc in fps or wc not in dist:
                counts["no_exit"] += 1
                continue
            # The item itself blocks cells: the walk from its own work cell may get longer.
            walk = dist[wc] * cm
            if limit_m and walk > limit_m:
                counts["too_far"] += 1
                continue
            use_panel, cable = panel, 0.0
            if kw and boxes:
                if panel is None:
                    ok_boxes = [b for b in boxes if box_spare[b["name"]] >= kw - 1e-9]
                    if not ok_boxes:
                        counts["power"] += 1
                        continue
                    b = min(ok_boxes, key=lambda b: (abs(b["x"] - x) + abs(b["y"] - y), b["name"]))
                    use_panel = b["name"]
                elif box_spare.get(panel, spare(panel)) < kw - 1e-9:
                    counts["power"] += 1
                    continue
                pb = pans.get(use_panel)
                if pb:
                    cable = (abs(pb["x"] - (x + fw / 2)) + abs(pb["y"] - (y + fd / 2))) * cm
            line_s = None
            if line:
                c = ((x + fw / 2) if k == 0 else (y + fd / 2)) * sign
                if (lo is not None and c <= lo) or (hi is not None and c >= hi):
                    counts["line"] += 1
                    continue
                if anchor is not None:
                    step = (abs(anchor["x"] - x) + abs(anchor["y"] - y)) * cm
                    line_s = 1 / (1 + step / 4)
            ring = [(cx, cy) for cx in range(x - 1, x + fw + 1) for cy in range(y - 1, y + fd + 1)
                    if (cx, cy) not in fps]
            clear = sum(1 for c in ring if c in free) / max(len(ring), 1)
            exit_s = 1 - min(walk / (limit_m or 60), 1)
            cable_s = 1 - min(cable / 30, 1) if kw else None
            parts = [(exit_s, 0.25), (clear, 0.2)]
            near_s = None
            if same and not line:
                gap = min(abs(sx - (x + fw / 2)) + abs(sy - (y + fd / 2)) for sx, sy in same) * cm
                near_s = 1 / (1 + gap / 4)
                parts.append((near_s, 0.35))
            if cable_s is not None:
                parts.append((cable_s, 0.2))
            if line_s is not None:
                parts.append((line_s, 0.45))
            score = sum(v * w for v, w in parts) / sum(w for _, w in parts)
            counts["fits"] += 1
            heat.append([x, y, round(score, 3)])  # corner cell of the footprint
            cands.append({"x": x, "y": y, "w": fw, "d": fd, "score": score, "walk_m": walk, "panel": use_panel,
                          "cable_m": round(cable, 1), "work": list(wc), "exit": exit_at.get(origin[wc]),
                          "line_score": line_s, "clear": clear, "near_s": near_s})
    scan_ms = (time.perf_counter() - t0) * 1000

    # Prove the best, spread out, with the real checks.
    cands.sort(key=lambda c: -c["score"])
    picks, tried = [], []
    for c in cands:
        if len(picks) >= top or len(tried) >= prove_max:
            break
        if any(abs(c["x"] - o["x"]) < max(c["w"], 4) + 3 and abs(c["y"] - o["y"]) < max(c["d"], 4) + 3 for o in tried):
            continue
        tried.append(c)
        if move_id:
            ch = {"op": "move", "id": move_id, "x": c["x"], "y": c["y"], "rotation": rotation}
            if c["panel"] and c["panel"] != (moving or {}).get("panel"):
                ch["panel"] = c["panel"]
        else:
            ch = {"op": "add", "type": type_name, "x": c["x"], "y": c["y"], "rotation": rotation}
            if line:
                ch["line"] = line
            if c["panel"]:
                ch["panel"] = c["panel"]
        ev = evaluate(g, floor, list(changes) + [ch])
        iid = move_id or (ev.get("placed") or [None])[-1]
        reach = next((r for r in ev.get("results", []) if r["kind"] == "exit_reach"), None)
        path = (reach or {}).get("data", {}).get("paths", {}).get(iid) if iid else None
        why = [f"{c['walk_m']:.1f} m walk to exit {c['exit']}"]
        if kw and c["panel"]:
            why.append(f"{c['cable_m']} m to {c['panel']}, {box_spare.get(c['panel'], 0) - kw:.1f} kW spare after")
        if line:
            why.append(f"next step on line {line}")
        elif c.get("near_s") is not None and c["near_s"] >= 0.4:  # within about 6 m
            why.append("near other " + type_name.replace("_", " ") + "s")
        why.append(f"{c['clear'] * 100:.0f}% clear around it")
        picks.append({"change": ch, "x": c["x"], "y": c["y"], "w": c["w"], "d": c["d"], "rotation": rotation,
                      "score": round(c["score"], 3), "panel": c["panel"], "passed": ev["passed"],
                      "failed": ev["failed"], "error": ev.get("error"), "ms": ev.get("ms", 0),
                      "path": (path or {}).get("cells", []), "walk_m": (path or {}).get("m", c["walk_m"]),
                      "exit": (path or {}).get("exit", c["exit"]), "why": why})
    picks.sort(key=lambda p: (not p["passed"], -p["score"]))
    for n, p in enumerate(picks, 1):
        p["rank"] = n
    fw0, fd0 = (t["d"], t["w"]) if rotation in (90, 270) else (t["w"], t["d"])
    return {"type": type_name, "rotation": rotation, "line": line, "move_id": move_id, "heat": heat, "w": fw0, "d": fd0,
            "picks": picks, "counts": counts, "scan_ms": round(scan_ms, 1),
            "ms": round((time.perf_counter() - t0) * 1000, 1)}
