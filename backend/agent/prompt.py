"""Build the model prompt from the graph, and parse the model's answer.

The model gets a map of the floor, the items, power use and the rules with
their numbers. It answers with change lists only. It never decides pass or fail.
"""
from __future__ import annotations

import json
import re

from ..checks import run_checks
from ..graph.db import Graph

SYSTEM = """You are a floor layout planner. You propose where to put, move or remove items on a factory or
warehouse floor. You do NOT decide whether a layout is safe: a separate graph checker tests every layout
against the rules and tells you what failed. Propose the smallest set of changes that does what the user asks.
Never remove items unless the request asks for it. If the request cannot be done within the rules, still give
your best attempt; the checker will report what blocks it and the user decides.

Coordinates are grid cells: x grows east (left to right), y grows south (top to bottom). (x, y) of an item is
its top-left cell. An item of type w x d covers w cells along x and d cells along y at rotation 0 or 180, and
d along x and w along y at rotation 90 or 270. The operator stands one cell outside the front side, at the
middle: rotation 0 faces +y (below), 90 faces +x (right), 180 faces -y (above), 270 faces -x (left).
That work cell must be free floor and must have a walking route to an exit.

Answer with JSON only, no prose, in this shape:
{"layouts": [{"note": "one short line", "changes": [
  {"op": "add", "type": "<item type>", "x": 0, "y": 0, "rotation": 0, "line": "<line or omit>", "panel": "<drop box or omit>"},
  {"op": "move", "id": "<item id>", "x": 0, "y": 0, "rotation": 0},
  {"op": "remove", "id": "<item id>"}]}]}
Give 1 to 3 different layouts. Powered items need a drop box ("panel"); pick one with spare capacity."""

MAP_LEGEND = "Map legend: '#' item, '.' free floor, ':' free aisle cell (keep aisles clear), 'E' exit, 'P' power panel."


def floor_context(g: Graph, floor: str) -> str:
    f = g.one("""MATCH (f:Floor {name:$f})-[:USES_PACK]->(p:RulePack)
                 RETURN f.label AS label, f.cols AS cols, f.rows AS rows, f.cell_m AS cell_m,
                        f.sprinklered AS spr, p.name AS pack""", {"f": floor})
    cells = g.q("""MATCH (c:Cell {floor:$f})
                   RETURN c.x AS x, c.y AS y, c.walkable AS w,
                          EXISTS { (c)-[:IN_ZONE]->(:Zone {kind:'aisle'}) } AS aisle""", {"f": floor})
    grid = [["."] * f["cols"] for _ in range(f["rows"])]
    for c in cells:
        grid[c["y"]][c["x"]] = "#" if not c["w"] else (":" if c["aisle"] else ".")
    for p in g.q("MATCH (p:PowerPanel {floor:$f}) RETURN p.x AS x, p.y AS y", {"f": floor}):
        grid[p["y"]][p["x"]] = "P"
    for e in g.q("MATCH (e:Exit {floor:$f}) RETURN e.x AS x, e.y AS y", {"f": floor}):
        grid[e["y"]][e["x"]] = "E"
    tens = "".join(str((x // 10) % 10) if x % 10 == 0 else " " for x in range(f["cols"]))
    rows = [f"     {tens}"] + [f"y={y:<3}{''.join(r)}" for y, r in enumerate(grid)]

    types = g.q("""MATCH (t:ItemType {pack:$p}) RETURN t.name AS name, t.w AS w, t.d AS d, t.kw AS kw, t.heat AS heat
                   ORDER BY name""", {"p": f["pack"]})
    items = g.q("""MATCH (i:Item {floor:$f})
                   OPTIONAL MATCH (i)-[:POWERED_BY]->(p:PowerPanel)
                   OPTIONAL MATCH (i)-[r:IN_LINE]->(l:Line)
                   RETURN i.id AS id, i.type AS type, i.x AS x, i.y AS y, i.rotation AS rot, p.name AS panel,
                          l.name AS line, r.seq AS seq ORDER BY id""", {"f": floor})
    lines = g.q("MATCH (l:Line {floor:$f}) RETURN l.name AS name, l.direction AS dir ORDER BY name", {"f": floor})
    zones = g.q("""MATCH (z:Zone {floor:$f}) RETURN z.name AS name, z.kind AS kind, z.x0 AS x0, z.y0 AS y0,
                   z.x1 AS x1, z.y1 AS y1 ORDER BY name""", {"f": floor})
    checks = run_checks(g, floor)
    loads = next((r["data"].get("loads", []) for r in checks if r["kind"] == "panel_load"), [])
    feeds = {r["name"]: r["fed_by"] for r in g.q("""MATCH (p:PowerPanel {floor:$f})
               OPTIONAL MATCH (p)-[:FED_BY]->(q) RETURN p.name AS name, q.name AS fed_by""", {"f": floor})}
    rules = g.q("""MATCH (:Floor {name:$f})-[:USES_PACK]->(:RulePack)-[:HAS_RULE]->(r:Rule)
                   RETURN r.id AS id, r.title AS title, r.params AS params, r.status AS status ORDER BY id""",
                {"f": floor})

    out = [f"FLOOR {floor}: {f['label']}. {f['cols']} x {f['rows']} cells, each cell {f['cell_m']} m. "
           f"Sprinklered: {bool(f['spr'])}.", MAP_LEGEND, *rows, "", "ITEM TYPES (w x d cells, kW):"]
    out += [f"  {t['name']}: {t['w']} x {t['d']}, {t['kw']} kW{', hot' if t['heat'] else ''}" for t in types]
    out += ["", "ZONES:"] + [f"  {z['name']} ({z['kind']}): x {z['x0']}..{z['x1']}, y {z['y0']}..{z['y1']}" for z in zones]
    if lines:
        out += ["", "PRODUCTION LINES (work must move forward in the line direction; new line items go after the last one):"]
        for l in lines:
            members = [i for i in items if i["line"] == l["name"]]
            last = max(members, key=lambda i: i["seq"]) if members else None
            out.append(f"  Line {l['name']} direction {l['dir']}, {len(members)} items"
                       + (f", last is {last['id']} at x={last['x']}, y={last['y']}" if last else ""))
    if loads:
        by = {l["name"]: l for l in loads}

        def chain(n):
            while n:
                yield by[n]
                n = feeds.get(n)

        out += ["", "POWER. Power units are fixed: you cannot add, move or remove them. Each powered item plugs into "
                "one drop box (\"panel\"); you may re-plug an existing item with a move change that sets \"panel\". "
                "Load counts at the drop box AND its sub-panel AND the main breaker, and each has a limit.",
                "  unit kind: kW now / limit kW, fed by"]
        out += [f"  {l['name']} {l['kind']}: {l['kw']} / {l['limit_kw']}"
                + (f", fed by {feeds[l['name']]}" if feeds.get(l["name"]) else "") for l in loads]
        boxes = [l for l in loads if l["kind"] == "drop_box"]
        if boxes:
            out.append("  Spare kW you can still add per drop box (smallest spare along its chain; spare on a "
                       "sub-panel is shared by all its drop boxes):")
            out += [f"    {b['name']}: {min(c['limit_kw'] - c['kw'] for c in chain(b['name'])):.2f} "
                    f"(via {' -> '.join(c['name'] for c in chain(b['name']))})" for b in boxes]
    out += ["", "ITEMS (id type x,y rotation [line seq] [panel]):"]
    out += [f"  {i['id']} {i['type']} {i['x']},{i['y']} r{i['rot']}"
            + (f" line {i['line']} #{i['seq']}" if i["line"] else "") + (f" panel {i['panel']}" if i["panel"] else "")
            for i in items]
    out += ["", "RULES CHECKED BY THE GRAPH:"]
    for r in rules:
        params = {k: v for k, v in json.loads(r["params"] or "{}").items() if k != "zone_kind"}
        nums = ", ".join(f"{k}={'TBD' if v is None else v}" for k, v in params.items())
        out.append(f"  {r['id']}: {r['title']}" + (f" ({nums})" if nums else ""))
    return "\n".join(out)


def format_feedback(failures: list[dict]) -> str:
    if not failures:
        return ""
    out = ["PREVIOUS ATTEMPTS FAILED THE GRAPH CHECKS. Fix these problems:"]
    for k, f in enumerate(failures, 1):
        out.append(f"Attempt {k}: changes {json.dumps(f['changes'])}")
        if f.get("error"):
            out.append(f"  invalid: {f['error']}")
        for r in f.get("failed", []):
            cells = r["cells"][:12]
            out.append(f"  {r['rule_id']} failed: {r['detail']}" + (f" Cells: {cells}" if cells else ""))
    return "\n".join(out)


def build_messages(context: str, request: str, base_changes: list[dict], feedback: str) -> list[dict]:
    user = [context, ""]
    if base_changes:
        user += ["The user has an unsaved draft with these changes (keep them unless they cause the problem):",
                 json.dumps(base_changes), ""]
    user.append(f"REQUEST: {request}")
    if feedback:
        user += ["", feedback]
    return [{"role": "developer", "content": SYSTEM}, {"role": "user", "content": "\n".join(user)}]


def parse_layouts(text: str) -> list[dict]:
    """Pull the layouts out of the model's answer. Returns [] if it is not usable JSON."""
    text = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M).strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return []
    layouts = data.get("layouts") if isinstance(data, dict) else None
    if not isinstance(layouts, list):
        return []
    out = []
    for lay in layouts[:3]:
        if isinstance(lay, dict) and isinstance(lay.get("changes"), list):
            out.append({"note": str(lay.get("note", ""))[:200], "changes": lay["changes"]})
    return out
