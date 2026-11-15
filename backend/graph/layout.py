"""Write layout changes to the graph.

A change list is what the agent or the manual editor proposes:
  {"op": "add",    "type": "pressing_machine", "x": 34, "y": 10, "rotation": 0,
                   "line": "B", "panel": "DB-X1"}          (line, panel, id optional)
  {"op": "move",   "id": "A3", "x": 5, "y": 2, "rotation": 90, "panel": "DB-A"}
  {"op": "remove", "id": "R2"}

This module only writes. Pass or fail is decided by backend.checks.
"""
from __future__ import annotations

from typing import Any

from .db import Graph
from .geometry import ROTATIONS, footprint, work_cell


class LayoutError(ValueError):
    """The change list itself is invalid (unknown id, unknown type, bad value)."""


# ---------------------------------------------------------------- reads
def floor_info(g: Graph, floor: str) -> dict:
    f = g.one("MATCH (f:Floor {name:$f})-[:USES_PACK]->(p:RulePack) RETURN f.name AS name, f.cols AS cols, "
              "f.rows AS rows, f.cell_m AS cell_m, f.sprinklered AS sprinklered, p.name AS pack", {"f": floor})
    if not f:
        raise LayoutError(f"unknown floor {floor!r}")
    return f


def item_types(g: Graph, pack: str) -> dict[str, dict]:
    rows = g.q("MATCH (t:ItemType {pack:$p}) RETURN t.name AS name, t.w AS w, t.d AS d, t.h AS h, t.kw AS kw", {"p": pack})
    return {r["name"]: r for r in rows}


def items(g: Graph, floor: str) -> dict[str, dict]:
    rows = g.q("""MATCH (i:Item {floor:$f})
        OPTIONAL MATCH (i)-[:POWERED_BY]->(p:PowerPanel)
        OPTIONAL MATCH (i)-[r:IN_LINE]->(l:Line)
        RETURN i.id AS id, i.type AS type, i.x AS x, i.y AS y, i.rotation AS rotation,
               p.name AS panel, l.name AS line, r.seq AS seq""", {"f": floor})
    return {r["id"]: r for r in rows}


def panels(g: Graph, floor: str) -> list[dict]:
    return g.q("MATCH (p:PowerPanel {floor:$f}) RETURN p.name AS name, p.kind AS kind, p.x AS x, p.y AS y", {"f": floor})


def lines(g: Graph, floor: str) -> set[str]:
    return {r["name"] for r in g.q("MATCH (l:Line {floor:$f}) RETURN l.name AS name", {"f": floor})}


# ---------------------------------------------------------------- writes
def _prepare(item: dict, t: dict) -> dict:
    x, y, rot = item["x"], item["y"], item.get("rotation", 0)
    cells = footprint(x, y, t["w"], t["d"], rot)
    fw = max(c[0] for c in cells) - x + 1
    fd = max(c[1] for c in cells) - y + 1
    return {
        "id": item["id"], "type": item["type"], "x": x, "y": y, "rotation": rot,
        "w": fw, "d": fd, "h": t["h"], "cells": [list(c) for c in cells],
        "work": list(work_cell(x, y, t["w"], t["d"], rot)),
        "panel": item.get("panel"), "line": item.get("line"), "seq": item.get("seq"),
    }


def place_items(g: Graph, floor: str, pack: str, prepared: list[dict]) -> None:
    """Create Item nodes and their links. Items must already be validated."""
    if not prepared:
        return
    p = {"f": floor, "pack": pack, "items": prepared}
    g.q("""UNWIND $items AS it
        CREATE (i:Item {floor:$f, id:it.id, type:it.type, x:it.x, y:it.y, w:it.w, d:it.d, h:it.h, rotation:it.rotation})
        WITH i, it MATCH (t:ItemType {pack:$pack, name:it.type}) CREATE (i)-[:IS_A]->(t)""", p)
    g.q("""UNWIND $items AS it MATCH (i:Item {floor:$f, id:it.id})
        WITH i, it UNWIND it.cells AS k MATCH (c:Cell {floor:$f, x:k[0], y:k[1]})
        CREATE (i)-[:OCCUPIES]->(c)""", p)
    g.q("""UNWIND $items AS it MATCH (i:Item {floor:$f, id:it.id})
        MATCH (c:Cell {floor:$f, x:it.work[0], y:it.work[1]}) CREATE (i)-[:WORKS_AT]->(c)""", p)
    powered = [it for it in prepared if it["panel"]]
    if powered:
        g.q("""UNWIND $items AS it MATCH (i:Item {floor:$f, id:it.id})
            MATCH (pp:PowerPanel {floor:$f, name:it.panel}) CREATE (i)-[:POWERED_BY]->(pp)""", {**p, "items": powered})
    in_line = [it for it in prepared if it["line"]]
    if in_line:
        g.q("""UNWIND $items AS it MATCH (i:Item {floor:$f, id:it.id})
            MATCH (l:Line {floor:$f, name:it.line}) CREATE (i)-[:IN_LINE {seq:it.seq}]->(l)""", {**p, "items": in_line})


def refresh_cells(g: Graph, floor: str, cells: list[list[int]] | None = None) -> None:
    """Recompute Cell.walkable and the ADJACENT links for the given cells (or all)."""
    p = {"f": floor, "cells": cells}
    if cells is None:
        g.q("MATCH (c:Cell {floor:$f}) SET c.walkable = NOT EXISTS { (c)<-[:OCCUPIES]-(:Item) }", p)
        g.q("MATCH (:Cell {floor:$f})-[r:ADJACENT]->() DELETE r", p)
        g.q("""MATCH (a:Cell {floor:$f})-[:NEIGHBOR]->(b:Cell) WHERE a.walkable AND b.walkable
            CREATE (a)-[:ADJACENT]->(b), (b)-[:ADJACENT]->(a)""", p)
        return
    if not cells:
        return
    g.q("""UNWIND $cells AS k MATCH (c:Cell {floor:$f, x:k[0], y:k[1]})
        SET c.walkable = NOT EXISTS { (c)<-[:OCCUPIES]-(:Item) }""", p)
    g.q("""UNWIND $cells AS k MATCH (c:Cell {floor:$f, x:k[0], y:k[1]}) WHERE NOT c.walkable
        MATCH (c)-[r:ADJACENT]-() DELETE r""", p)
    g.q("""UNWIND $cells AS k MATCH (c:Cell {floor:$f, x:k[0], y:k[1]}) WHERE c.walkable
        MATCH (c)-[:NEIGHBOR]-(n:Cell) WHERE n.walkable
        MERGE (c)-[:ADJACENT]->(n) MERGE (n)-[:ADJACENT]->(c)""", p)


def rebuild_feeds(g: Graph, floor: str, line: str) -> None:
    """Chain the items of a line with FEEDS links in seq order."""
    p = {"f": floor, "l": line}
    g.q("MATCH (a:Item)-[:IN_LINE]->(:Line {floor:$f, name:$l}) MATCH (a)-[r:FEEDS]->() DELETE r", p)
    g.q("""MATCH (i:Item)-[r:IN_LINE]->(:Line {floor:$f, name:$l})
        WITH i, r ORDER BY r.seq, i.id
        WITH collect(i) AS xs WHERE size(xs) > 1
        UNWIND range(0, size(xs) - 2) AS k
        WITH xs[k] AS a, xs[k + 1] AS b CREATE (a)-[:FEEDS]->(b)""", p)


# ---------------------------------------------------------------- change lists
def _int(v: Any, name: str) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
        raise LayoutError(f"{name} must be a whole number, got {v!r}")
    return int(v)


def _nearest_drop_box(pans: list[dict], x: int, y: int) -> str | None:
    boxes = [p for p in pans if p["kind"] == "drop_box"]
    if not boxes:
        return None
    return min(boxes, key=lambda p: (abs(p["x"] - x) + abs(p["y"] - y), p["name"]))["name"]


def normalize_changes(changes: list[dict]) -> list[dict]:
    """Merge changes that touch the same item, so each item is written at most once.

    add+move -> add, add+remove -> nothing, move+move -> move, move+remove -> remove.
    Needed because Relate 1.0.1 panics when a transaction deletes a node or link
    it created itself (see docs/relate-notes.md).
    """
    if not isinstance(changes, list):
        raise LayoutError("changes must be a list")
    out: list[dict] = []
    last: dict[str, int] = {}  # id -> index in out
    for n, ch in enumerate(changes):
        if not isinstance(ch, dict):
            raise LayoutError(f"change {n} is not an object")
        ch = dict(ch)
        iid = ch.get("id")
        k = last.get(iid) if iid is not None else None
        if k is None or out[k] is None:
            if iid is not None:
                last[iid] = len(out)
            out.append(ch)
            continue
        prev, op = out[k], ch.get("op")
        if op == "move" and prev["op"] in ("add", "move"):
            out[k] = {**prev, **{f: v for f, v in ch.items() if f != "op"}}
        elif op == "remove" and prev["op"] == "add":
            out[k] = None
            del last[iid]
        elif op == "remove" and prev["op"] == "move":
            out[k] = {"op": "remove", "id": iid}
        else:
            last[iid] = len(out)
            out.append(ch)
    return [c for c in out if c is not None]


def apply_changes(g: Graph, floor: str, changes: list[dict]) -> dict:
    """Apply a change list inside the current transaction.

    Returns {"inverse": [...], "placed": [ids]}. Raises LayoutError on bad input.
    """
    changes = normalize_changes(changes)
    info = floor_info(g, floor)
    types = item_types(g, info["pack"])
    current = items(g, floor)
    pans = panels(g, floor)
    pan_names = {p["name"] for p in pans}
    line_names = lines(g, floor)
    touched_cells: list[list[int]] = []
    touched_lines: set[str] = set()
    inverse: list[dict] = []
    placed: list[str] = []
    new_counter = 1

    def old_cells(it: dict) -> list[list[int]]:
        t = types[it["type"]]
        return [list(c) for c in footprint(it["x"], it["y"], t["w"], t["d"], it["rotation"])]

    def check_panel(name: str | None) -> None:
        if name is not None and name not in pan_names:
            raise LayoutError(f"unknown power panel {name!r}")

    for n, ch in enumerate(changes):
        if not isinstance(ch, dict):
            raise LayoutError(f"change {n} is not an object")
        op = ch.get("op")
        if op == "add":
            tname = ch.get("type")
            if tname not in types:
                raise LayoutError(f"unknown item type {tname!r}")
            rot = _int(ch.get("rotation", 0), "rotation")
            if rot not in ROTATIONS:
                raise LayoutError(f"rotation must be one of {ROTATIONS}")
            x, y = _int(ch.get("x"), "x"), _int(ch.get("y"), "y")
            iid = ch.get("id")
            if iid is None:
                while f"N{new_counter}" in current:
                    new_counter += 1
                iid = f"N{new_counter}"
            if iid in current:
                raise LayoutError(f"item id {iid!r} already exists")
            line = ch.get("line")
            if line is not None and line not in line_names:
                raise LayoutError(f"unknown line {line!r}")
            seq = ch.get("seq")
            if line is not None and seq is None:
                seqs = [it["seq"] for it in current.values() if it["line"] == line and it["seq"] is not None]
                seq = (max(seqs) if seqs else 0) + 1
            panel = ch.get("panel")
            if panel is None and types[tname]["kw"]:
                panel = _nearest_drop_box(pans, x, y)
            check_panel(panel)
            item = {"id": iid, "type": tname, "x": x, "y": y, "rotation": rot, "panel": panel, "line": line, "seq": seq}
            prep = _prepare(item, types[tname])
            place_items(g, floor, info["pack"], [prep])
            current[iid] = item
            touched_cells += prep["cells"]
            if line:
                touched_lines.add(line)
            inverse.insert(0, {"op": "remove", "id": iid})
            placed.append(iid)
        elif op in ("move", "remove"):
            iid = ch.get("id")
            if iid not in current:
                raise LayoutError(f"unknown item id {iid!r}")
            old = dict(current[iid])
            touched_cells += old_cells(old)
            if old["line"]:
                touched_lines.add(old["line"])
            g.q("MATCH (i:Item {floor:$f, id:$id}) DETACH DELETE i", {"f": floor, "id": iid})
            del current[iid]
            if op == "remove":
                inverse.insert(0, {"op": "add", **{k: old[k] for k in ("id", "type", "x", "y", "rotation", "panel", "line", "seq")}})
                continue
            rot = _int(ch.get("rotation", old["rotation"]), "rotation")
            if rot not in ROTATIONS:
                raise LayoutError(f"rotation must be one of {ROTATIONS}")
            panel = ch.get("panel", old["panel"])
            check_panel(panel)
            item = {**old, "x": _int(ch.get("x", old["x"]), "x"), "y": _int(ch.get("y", old["y"]), "y"),
                    "rotation": rot, "panel": panel}
            prep = _prepare(item, types[item["type"]])
            place_items(g, floor, info["pack"], [prep])
            current[iid] = item
            touched_cells += prep["cells"]
            inverse.insert(0, {"op": "move", "id": iid, "x": old["x"], "y": old["y"],
                               "rotation": old["rotation"], "panel": old["panel"]})
            placed.append(iid)
        else:
            raise LayoutError(f"change {n}: op must be add, move or remove")

    uniq = sorted({tuple(c) for c in touched_cells})
    refresh_cells(g, floor, [list(c) for c in uniq])
    for line in sorted(touched_lines):
        rebuild_feeds(g, floor, line)
    return {"inverse": inverse, "placed": placed}
