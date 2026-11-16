"""Build a floor, its items and its rule pack in the graph from a pack JSON file."""
from __future__ import annotations

import json
from pathlib import Path

from .db import Graph
from .layout import _prepare, place_items, rebuild_feeds, refresh_cells
from .schema import create_indexes

PACKS_DIR = Path(__file__).resolve().parent.parent / "packs"
PACK_FILES = {"factory": PACKS_DIR / "factory.json", "warehouse": PACKS_DIR / "warehouse.json"}


def load_pack(name_or_path: str | Path) -> dict:
    path = PACK_FILES.get(str(name_or_path), Path(name_or_path))
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _num_or_none(v):
    """Rule numbers marked "TBD" are stored as null, never as a guess."""
    return None if v == "TBD" else v


def seed_pack(g: Graph, pack: dict) -> None:
    create_indexes(g)
    fl, pk = pack["floor"], pack["pack"]
    f = fl["name"]
    cols = round(fl["width_m"] / fl["cell_m"])
    rows = round(fl["depth_m"] / fl["cell_m"])

    g.q("""CREATE (fl:Floor {name:$f, label:$label, width_m:$w, depth_m:$d, cell_m:$c, cols:$cols, rows:$rows,
                             sprinklered:$s, data_note:$note})
           MERGE (p:RulePack {name:$pack}) ON CREATE SET p.label = $plabel
           CREATE (fl)-[:USES_PACK]->(p)""",
        {"f": f, "label": fl["label"], "w": fl["width_m"], "d": fl["depth_m"], "c": fl["cell_m"], "cols": cols,
         "rows": rows, "s": fl["sprinklered"], "note": fl.get("data_note", ""), "pack": pk["name"], "plabel": pk["label"]})

    # Grid cells and the static NEIGHBOR structure
    cells = [{"x": x, "y": y} for x in range(cols) for y in range(rows)]
    g.q("UNWIND $cells AS c CREATE (:Cell {floor:$f, x:c.x, y:c.y, walkable:true})", {"f": f, "cells": cells})
    pairs = [{"ax": x, "ay": y, "bx": x + dx, "by": y + dy}
             for x in range(cols) for y in range(rows) for dx, dy in ((1, 0), (0, 1))
             if x + dx < cols and y + dy < rows]
    g.q("""UNWIND $pairs AS p MATCH (a:Cell {floor:$f, x:p.ax, y:p.ay}), (b:Cell {floor:$f, x:p.bx, y:p.by})
           CREATE (a)-[:NEIGHBOR]->(b)""", {"f": f, "pairs": pairs})

    for z in pack.get("zones", []):
        zc = [[x, y] for x in range(z["x0"], z["x1"] + 1) for y in range(z["y0"], z["y1"] + 1)]
        g.q("""CREATE (zn:Zone {floor:$f, name:$name, kind:$kind, axis:$axis, x0:$x0, y0:$y0, x1:$x1, y1:$y1})
               WITH zn UNWIND $cells AS k MATCH (c:Cell {floor:$f, x:k[0], y:k[1]}) CREATE (c)-[:IN_ZONE]->(zn)""",
            {"f": f, "name": z["name"], "kind": z["kind"], "axis": z.get("axis"), "x0": z["x0"], "y0": z["y0"],
             "x1": z["x1"], "y1": z["y1"], "cells": zc})

    g.q("""UNWIND $exits AS e MATCH (c:Cell {floor:$f, x:e.x, y:e.y})
           CREATE (:Exit {floor:$f, name:e.name, x:e.x, y:e.y})-[:AT]->(c)""", {"f": f, "exits": pack["exits"]})

    g.q("""UNWIND $types AS t
           MERGE (it:ItemType {pack:$pack, name:t.name})
           ON CREATE SET it.label = t.label, it.w = t.w, it.d = t.d, it.h = t.h, it.kw = t.kw, it.heat = t.heat,
                         it.color = t.color, it.shape = t.shape, it.custom = coalesce(t.custom, false),
                         it.description = t.description""",
        {"pack": pk["name"], "types": [{"shape": None, "custom": False, "description": None, **t}
                                       for t in pack["item_types"]]})
    seps = [{**s, "min_m": _num_or_none(s["min_m"])} for s in pack.get("separations", [])]
    if seps:
        g.q("""UNWIND $seps AS s MATCH (a:ItemType {pack:$pack, name:s.from}), (b:ItemType {pack:$pack, name:s.to})
               MERGE (a)-[r:MUST_BE_FAR_FROM]->(b) ON CREATE SET r.min_m = s.min_m""",
            {"pack": pk["name"], "seps": seps})

    pans = pack.get("panels", [])
    if pans:
        g.q("""UNWIND $p AS p MATCH (c:Cell {floor:$f, x:p.x, y:p.y})
               CREATE (:PowerPanel {floor:$f, name:p.name, kind:p.kind, capacity_kw:p.capacity_kw, x:p.x, y:p.y})-[:AT]->(c)""",
            {"f": f, "p": pans})
        g.q("""UNWIND $p AS p MATCH (a:PowerPanel {floor:$f, name:p.name}), (b:PowerPanel {floor:$f, name:p.fed_by})
               CREATE (a)-[:FED_BY]->(b)""", {"f": f, "p": [p for p in pans if p["fed_by"]]})

    if pack.get("lines"):
        g.q("UNWIND $l AS l CREATE (:Line {floor:$f, name:l.name, direction:l.direction})", {"f": f, "l": pack["lines"]})

    rules = [{**r, "params": json.dumps({k: _num_or_none(v) for k, v in r["params"].items()})} for r in pack["rules"]]
    g.q("""UNWIND $rules AS r MATCH (p:RulePack {name:$pack})
           MERGE (ru:Rule {id:r.id})
           SET ru.kind = r.kind, ru.title = r.title, ru.params = r.params, ru.status = r.status,
               ru.source_url = r.source_url, ru.source_note = r.source_note
           MERGE (p)-[:HAS_RULE]->(ru)""", {"pack": pk["name"], "rules": rules})
    for s in pack.get("separations", []):
        g.q("""MATCH (p:RulePack {name:$pack})-[:HAS_RULE]->(r:Rule {kind:'separation'})
               MATCH (t:ItemType {pack:$pack}) WHERE t.name IN [$a, $b]
               MERGE (r)-[:APPLIES_TO]->(t)""", {"pack": pk["name"], "a": s["from"], "b": s["to"]})

    seed_flows(g, pack)

    # Items
    types = {t["name"]: t for t in pack["item_types"]}
    place_items(g, f, pk["name"], [_prepare(it, types[it["type"]]) for it in pack.get("items", [])])
    refresh_cells(g, f, None)
    for line in pack.get("lines", []):
        rebuild_feeds(g, f, line["name"])


def seed_flows(g: Graph, pack: dict) -> None:
    """Material flows between item types (used by the efficiency metrics, not by the rules)."""
    flows = [{"from_role": None, "to_role": None, **fl} for fl in pack.get("flows", [])]
    if flows:
        g.q("""UNWIND $fl AS fl
               MATCH (a:ItemType {pack:$pack, name:fl.from}), (b:ItemType {pack:$pack, name:fl.to})
               MERGE (a)-[r:FLOWS_TO {name:fl.name}]->(b)
               SET r.from_role = fl.from_role, r.to_role = fl.to_role""", {"pack": pack["pack"]["name"], "fl": flows})


def ensure_flows(g: Graph) -> None:
    """Add the material flows to a store built before flows existed. Safe to run again."""
    for p in PACK_FILES.values():
        if p.exists():
            seed_flows(g, load_pack(p))


def seed(g: Graph, names: list[str], *, user_files: bool = False) -> None:
    """Seed the named packs. user_files=True also loads the user's custom floors and
    custom item types (packs/custom/). The test set never does."""
    custom_dir = PACKS_DIR / "custom"
    extras = {}
    if user_files and (custom_dir / "types.json").exists():
        extras = json.loads((custom_dir / "types.json").read_text(encoding="utf-8"))
    packs = [load_pack(n) for n in names]
    if user_files and custom_dir.exists():
        packs += [load_pack(p) for p in sorted(custom_dir.glob("*.json")) if p.name != "types.json"]
    for pack in packs:
        have = {t["name"] for t in pack["item_types"]}
        pack["item_types"] += [t for t in extras.get(pack["pack"]["name"], []) if t["name"] not in have]
        seed_pack(g, pack)
