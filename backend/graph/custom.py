"""Custom floors and custom item types, made by the user in the app.

A custom floor is a normal rule pack (same JSON shape as packs/factory.json),
built from what the user drew: floor size, exits, zones, power panels, lines.
It is saved in packs/custom/<name>.json and seeded into the graph like the
built-in packs, so every check runs on it with no new engine code.

Custom item types are saved in packs/custom/types.json (keyed by pack), so a
rebuild of floorproof.rl keeps them. The test set never loads these files.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

from .db import Graph
from .seed import PACK_FILES, PACKS_DIR, load_pack, seed_pack

CUSTOM_DIR = PACKS_DIR / "custom"
TYPES_FILE = CUSTOM_DIR / "types.json"
CELL_M = 0.5
MAX_SIDE_M = 80
MAX_CELLS = 16000
PANEL_KINDS = ("main_breaker", "sub_panel", "drop_box")
ZONE_KINDS = ("aisle", "forklift_aisle", "area")
SHAPES = ("machine", "table", "rack", "press", "tank", "conveyor", "robot", "pallet", "box")

# The rule texts and sources are the same as the built-in factory pack.
# Users may type their own number; then the source note says it came from them.
EXIT_DIST_SOURCE = ("https://lawfilesext.leg.wa.gov/Law/WACArchive/2024/htm/WAC%20%2051%20-%2054A%20CHAPTER/"
                    "WAC%20%2051%20-%2054A-1017.htm")


class SpecError(ValueError):
    pass


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")
    return s[:40] or "item"


def custom_files() -> dict[str, Path]:
    if not CUSTOM_DIR.exists():
        return {}
    return {p.stem: p for p in sorted(CUSTOM_DIR.glob("*.json")) if p.name != "types.json"}


def is_custom(floor: str) -> bool:
    return floor in custom_files()


# ---------------------------------------------------------------- item types
def _load_types() -> dict[str, list[dict]]:
    if TYPES_FILE.exists():
        return json.loads(TYPES_FILE.read_text(encoding="utf-8"))
    return {}


def extra_types(pack: str) -> list[dict]:
    return _load_types().get(pack, [])


def make_item_type(spec: dict, cell_m: float = CELL_M) -> dict:
    """Turn a user item (sizes in metres) into an ItemType row (sizes in cells)."""
    label = str(spec.get("label") or "").strip()
    if not label:
        raise SpecError("the item needs a name")
    out = {"name": slug(spec.get("name") or label), "label": label[:60]}
    for k, lo, hi in (("w_m", 0.3, 30), ("d_m", 0.3, 30), ("h_m", 0.1, 15)):
        v = spec.get(k)
        if not isinstance(v, (int, float)) or not lo <= v <= hi:
            raise SpecError(f"{k} must be a number from {lo} to {hi} m")
    kw = spec.get("kw", 0)
    if not isinstance(kw, (int, float)) or not 0 <= kw <= 500:
        raise SpecError("kw must be a number from 0 to 500")
    out["w"] = max(1, math.ceil(spec["w_m"] / cell_m - 1e-9))
    out["d"] = max(1, math.ceil(spec["d_m"] / cell_m - 1e-9))
    out["h"] = round(float(spec["h_m"]), 2)
    out["kw"] = round(float(kw), 2)
    out["heat"] = bool(spec.get("heat", False))
    color = str(spec.get("color") or "#5ad1ff")
    out["color"] = color if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else "#5ad1ff"
    shape = spec.get("shape") or "machine"
    out["shape"] = shape if shape in SHAPES else "machine"
    out["custom"] = True
    out["description"] = str(spec.get("description") or "")[:300]
    return out


def add_item_type(g: Graph, floor: str, spec: dict) -> dict:
    f = g.one("MATCH (f:Floor {name:$f})-[:USES_PACK]->(p:RulePack) RETURN p.name AS pack, f.cell_m AS c",
              {"f": floor})
    if not f:
        raise SpecError(f"unknown floor {floor!r}")
    t = make_item_type(spec, f["c"])
    taken = {r["name"] for r in g.q("MATCH (t:ItemType {pack:$p}) RETURN t.name AS name", {"p": f["pack"]})}
    base, k = t["name"], 2
    while t["name"] in taken:
        t["name"] = f"{base}_{k}"
        k += 1
    g.q("""CREATE (:ItemType {pack:$p, name:$name, label:$label, w:$w, d:$d, h:$h, kw:$kw, heat:$heat,
                              color:$color, shape:$shape, custom:true, description:$description})""",
        {"p": f["pack"], **t})
    data = _load_types()
    data.setdefault(f["pack"], []).append(t)
    CUSTOM_DIR.mkdir(parents=True, exist_ok=True)
    TYPES_FILE.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return t


# ---------------------------------------------------------------- floors
def _library_types() -> list[dict]:
    """Every built-in item type, offered on custom floors too."""
    seen, out = set(), []
    for p in PACK_FILES.values():
        if p.exists():
            for t in load_pack(p)["item_types"]:
                if t["name"] not in seen:
                    seen.add(t["name"])
                    out.append(t)
    return out


def _num(v, name: str, lo: float, hi: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise SpecError(f"{name} must be a number from {lo} to {hi}")
    return float(v)


def _rules(prefix: str, spec: dict, has_panels: bool, has_lines: bool) -> list[dict]:
    r = spec.get("rules") or {}
    rules = [
        {"id": f"{prefix}-OVERLAP", "kind": "overlap", "title": "No two items on the same floor cell, and no item off the floor",
         "params": {}, "status": "no_number", "source_url": None, "source_note": "Physical constraint. No number needed."},
        {"id": f"{prefix}-EXIT-REACH", "kind": "exit_reach",
         "title": "Every work position can walk to an exit, and no exit is blocked", "params": {}, "status": "sourced",
         "source_url": "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.37",
         "source_note": "OSHA 29 CFR 1910.37(a)(3): exit routes must be free and unobstructed."},
    ]
    own = r.get("exit_distance_m")
    if own is not None:
        m = _num(own, "exit distance", 5, 500)
        rules.append({"id": f"{prefix}-EXIT-DIST", "kind": "exit_distance",
                      "title": "Walk from each work position to the nearest exit is within the limit",
                      "params": {"max_m_unsprinklered": m, "max_m_sprinklered": m}, "status": "user",
                      "source_url": None, "source_note": f"Number given by the user: {r.get('exit_distance_source') or 'no source given'}."})
    else:
        rules.append({"id": f"{prefix}-EXIT-DIST", "kind": "exit_distance",
                      "title": "Walk from each work position to the nearest exit is within the limit",
                      "params": {"max_m_unsprinklered": 60.96, "max_m_sprinklered": 76.2}, "status": "sourced",
                      "source_url": EXIT_DIST_SOURCE,
                      "source_note": "IBC Table 1017.2 (as adopted in WAC 51-54A-1017), occupancy F-1: 200 ft without "
                                     "sprinklers, 250 ft with. Other occupancy groups can differ; set your own number."})
    rules.append({"id": f"{prefix}-AISLE", "kind": "aisle_width", "title": "Aisles keep a clear width at every point",
                  "params": {"min_m": 0.711, "zone_kind": "aisle"}, "status": "sourced",
                  "source_url": "https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.36",
                  "source_note": "OSHA 29 CFR 1910.36(g)(2): an exit access must be at least 28 inches (71.1 cm) wide at all points."})
    fl = r.get("forklift_aisle_m")
    if any(z.get("kind") == "forklift_aisle" for z in spec.get("zones", [])):
        rules.append({"id": f"{prefix}-AISLE-FORKLIFT", "kind": "aisle_width",
                      "title": "Forklift aisles keep a clear width at every point",
                      "params": {"min_m": None if fl is None else _num(fl, "forklift aisle width", 0.5, 20),
                                 "zone_kind": "forklift_aisle"},
                      "status": "TBD" if fl is None else "user", "source_url": None,
                      "source_note": ("OSHA 29 CFR 1910.176(a) asks for sufficient safe clearances but gives no number (TBD)."
                                      if fl is None else f"Number given by the user: {r.get('forklift_aisle_source') or 'no source given'}.")})
    if has_panels:
        rules.append({"id": f"{prefix}-PANEL", "kind": "panel_load",
                      "title": "No drop box, sub-panel or main breaker over its continuous-load limit",
                      "params": {"continuous_factor": 1.25}, "status": "sourced",
                      "source_url": "https://iaeimagazine.org/2016/may2016/100-vs-80-choosing-the-right-ocpd-solution/",
                      "source_note": "NEC 210.20(A): a continuous load may use at most 80% of the rating. All machines "
                                     "are treated as continuous (3 h or more)."})
    if has_lines:
        rules.append({"id": f"{prefix}-LINE", "kind": "line_flow", "title": "Work moves forward along each line",
                      "params": {"max_step_m": None}, "status": "partial", "source_url": None,
                      "source_note": "Process rule: each step sits further along the line direction than the one "
                                     "before. Maximum distance between steps: TBD."})
    return rules


def build_pack(spec: dict, *, existing: set[str] = frozenset(), editing: bool = False) -> dict:
    """Validate what the user drew and turn it into a rule pack."""
    name = slug(str(spec.get("name") or "")).replace("_", "-")
    if not name or name in ("factory", "warehouse"):
        raise SpecError("pick another floor name")
    if name in existing and not editing:
        raise SpecError(f"a floor called {name!r} already exists")
    label = str(spec.get("label") or name)[:60]
    w = _num(spec.get("width_m"), "width", 5, MAX_SIDE_M)
    d = _num(spec.get("depth_m"), "depth", 5, MAX_SIDE_M)
    cols, rows = round(w / CELL_M), round(d / CELL_M)
    if cols * rows > MAX_CELLS:
        raise SpecError(f"the floor has {cols * rows} cells; the limit is {MAX_CELLS} (about 63 x 63 m)")
    w, d = cols * CELL_M, rows * CELL_M

    def inside(x, y) -> bool:
        return isinstance(x, int) and isinstance(y, int) and 0 <= x < cols and 0 <= y < rows

    exits = []
    for e in spec.get("exits", []):
        if not inside(e.get("x"), e.get("y")):
            raise SpecError(f"exit {e.get('name')} is off the floor")
        if e["x"] not in (0, cols - 1) and e["y"] not in (0, rows - 1):
            raise SpecError(f"exit {e.get('name')} must be on an outside wall")
        exits.append({"name": str(e.get("name") or f"E{len(exits) + 1}")[:12], "x": e["x"], "y": e["y"]})
    if not exits:
        raise SpecError("add at least one exit on an outside wall")
    if len({e["name"] for e in exits}) != len(exits):
        raise SpecError("exit names must be different")

    zones = []
    for z in spec.get("zones", []):
        kind = z.get("kind")
        if kind not in ZONE_KINDS:
            raise SpecError(f"zone kind must be one of {ZONE_KINDS}")
        x0, x1 = sorted((z.get("x0"), z.get("x1")))
        y0, y1 = sorted((z.get("y0"), z.get("y1")))
        if not (inside(x0, y0) and inside(x1, y1)):
            raise SpecError(f"zone {z.get('name')} is off the floor")
        zone = {"name": str(z.get("name") or f"Zone {len(zones) + 1}")[:30], "kind": kind, "x0": x0, "y0": y0, "x1": x1, "y1": y1}
        if kind in ("aisle", "forklift_aisle"):
            zone["axis"] = z.get("axis") or ("x" if (x1 - x0) >= (y1 - y0) else "y")
        zones.append(zone)
    if len({z["name"] for z in zones}) != len(zones):
        raise SpecError("zone names must be different")

    panels = []
    for p in spec.get("panels", []):
        if p.get("kind") not in PANEL_KINDS:
            raise SpecError(f"power unit kind must be one of {PANEL_KINDS}")
        if not inside(p.get("x"), p.get("y")):
            raise SpecError(f"power unit {p.get('name')} is off the floor")
        panels.append({"name": str(p.get("name"))[:12], "kind": p["kind"],
                       "capacity_kw": _num(p.get("capacity_kw"), f"capacity of {p.get('name')}", 0.5, 5000),
                       "fed_by": p.get("fed_by") or None, "x": p["x"], "y": p["y"]})
    names = [p["name"] for p in panels]
    if len(set(names)) != len(names):
        raise SpecError("power unit names must be different")
    by = {p["name"]: p for p in panels}
    for p in panels:
        if p["fed_by"] is not None and p["fed_by"] not in by:
            raise SpecError(f"{p['name']} is fed by unknown unit {p['fed_by']}")
        seen, cur = set(), p
        while cur["fed_by"]:
            if cur["name"] in seen:
                raise SpecError(f"the power tree has a loop at {p['name']}")
            seen.add(cur["name"])
            cur = by[cur["fed_by"]]

    lines = []
    for ln in spec.get("lines", []):
        if ln.get("direction") not in ("+x", "-x", "+y", "-y"):
            raise SpecError("line direction must be +x, -x, +y or -y")
        lines.append({"name": str(ln.get("name"))[:12], "direction": ln["direction"]})

    types = _library_types()
    tnames = {t["name"] for t in types}
    for t in extra_types(f"custom-{name}") + list(spec.get("item_types", [])):
        if t.get("name") and t["name"] not in tnames:
            types.append(t)
            tnames.add(t["name"])

    items = []
    for it in spec.get("items", []):  # carried over when the structure is edited
        if it.get("type") in tnames and inside(it.get("x"), it.get("y")):
            items.append({k: it.get(k) for k in ("id", "type", "x", "y", "rotation", "panel", "line", "seq")})
            if items[-1]["panel"] not in by:
                items[-1]["panel"] = None
            if items[-1]["line"] not in {ln["name"] for ln in lines}:
                items[-1]["line"] = items[-1]["seq"] = None

    prefix = "CU-" + name.upper()[:16]
    return {
        "floor": {"name": name, "label": label, "width_m": w, "depth_m": d, "cell_m": CELL_M,
                  "sprinklered": bool(spec.get("sprinklered", False)), "industry": str(spec.get("industry") or "")[:60],
                  "data_note": "Custom floor drawn by the user."},
        "pack": {"name": f"custom-{name}", "label": f"Custom: {str(spec.get('industry') or label)[:40]}"},
        "exits": exits, "zones": zones, "panels": panels, "lines": lines,
        "item_types": types, "separations": [], "items": items,
        "rules": _rules(prefix, spec, bool(panels), bool(lines)),
        "user_rules": spec.get("rules") or {},
    }


FLOOR_LABELS = ["Cell", "Item", "Zone", "Exit", "PowerPanel", "Line", "CheckResult", "Proposal", "Floor"]


def delete_floor(g: Graph, floor: str) -> None:
    g.q("MATCH (p:Proposal {floor:$f})-[:HAS_RESULT]->(c:CheckResult) DETACH DELETE c", {"f": floor})
    for label in FLOOR_LABELS:
        if label == "Floor":
            g.q("MATCH (n:Floor {name:$f}) DETACH DELETE n", {"f": floor})
        elif label != "CheckResult":
            g.q(f"MATCH (n:{label} {{floor:$f}}) DETACH DELETE n", {"f": floor})


def save_floor(g: Graph, spec: dict, *, editing: bool = False) -> dict:
    existing = {r["name"] for r in g.q("MATCH (f:Floor) RETURN f.name AS name")}
    pack = build_pack(spec, existing=existing, editing=editing)
    name = pack["floor"]["name"]
    if editing and name not in custom_files():
        raise SpecError("only custom floors can be edited")
    if name in existing:
        delete_floor(g, name)
        # Rules are rebuilt from the new spec (a rule can come or go, e.g. no panels any more).
        g.q("MATCH (:RulePack {name:$p})-[:HAS_RULE]->(r:Rule) DETACH DELETE r", {"p": pack["pack"]["name"]})
    seed_pack(g, pack)
    CUSTOM_DIR.mkdir(parents=True, exist_ok=True)
    (CUSTOM_DIR / f"{name}.json").write_text(json.dumps(pack, indent=1), encoding="utf-8")
    return pack


def floor_spec(g: Graph, floor: str) -> dict:
    """What the builder needs to edit a custom floor, with the current items from the graph."""
    p = custom_files().get(floor)
    if not p:
        raise SpecError("not a custom floor")
    pack = json.loads(p.read_text(encoding="utf-8"))
    fl = pack["floor"]
    spec = {"name": fl["name"], "label": fl["label"], "industry": fl.get("industry", ""), "width_m": fl["width_m"],
            "depth_m": fl["depth_m"], "sprinklered": fl["sprinklered"], "exits": pack["exits"], "zones": pack["zones"],
            "panels": pack["panels"], "lines": pack["lines"], "rules": pack.get("user_rules", {})}
    spec["items"] = g.q("""MATCH (i:Item {floor:$f})
        OPTIONAL MATCH (i)-[:POWERED_BY]->(pp:PowerPanel) OPTIONAL MATCH (i)-[r:IN_LINE]->(l:Line)
        RETURN i.id AS id, i.type AS type, i.x AS x, i.y AS y, i.rotation AS rotation, pp.name AS panel,
               l.name AS line, r.seq AS seq ORDER BY id""", {"f": floor})
    return spec


def remove_floor(g: Graph, floor: str) -> None:
    p = custom_files().get(floor)
    if not p:
        raise SpecError("only custom floors can be deleted")
    delete_floor(g, floor)
    p.unlink()
