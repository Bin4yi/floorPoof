"""Unit tests for the engine and the checks."""
import json

import pytest

from backend.checks import CHECKS, run_checks
from backend.engine import NotProven, accept, evaluate, undo
from backend.graph.db import Graph
from backend.graph.layout import LayoutError, apply_changes
from backend.graph.seed import load_pack, seed_pack

F = "factory"


def snapshot(g):
    items = g.q("MATCH (i:Item {floor:$f}) RETURN i.id AS id, i.x AS x, i.y AS y, i.rotation AS r ORDER BY id", {"f": F})
    adj = g.one("MATCH (:Cell {floor:$f})-[r:ADJACENT]->() RETURN count(r) AS n", {"f": F})["n"]
    feeds = g.one("MATCH (:Item {floor:$f})-[r:FEEDS]->() RETURN count(r) AS n", {"f": F})["n"]
    return items, adj, feeds


def test_every_rule_kind_has_a_check(g):
    kinds = {r["kind"] for r in g.q("MATCH (r:Rule) RETURN DISTINCT r.kind AS kind")}
    assert kinds <= set(CHECKS)


def test_accepted_floor_passes(g):
    results = run_checks(g, F)
    assert [r["rule_id"] for r in results if r["status"] == "fail"] == []


def test_tbd_rule_is_skipped_not_passed(g):
    sep = next(r for r in run_checks(g, F) if r["rule_id"] == "FP-SEP")
    assert sep["status"] == "skipped" and "TBD" in sep["detail"]


def test_draft_rolls_back(g):
    before = snapshot(g)
    ev = evaluate(g, F, [{"op": "add", "type": "cutting_table", "x": 10, "y": 18},
                         {"op": "move", "id": "B3", "x": 40, "y": 12}, {"op": "remove", "id": "R1"}])
    assert ev["valid"] and not ev["passed"]
    assert snapshot(g) == before


def test_invalid_change_is_reported(g):
    ev = evaluate(g, F, [{"op": "add", "type": "spaceship", "x": 1, "y": 1}])
    assert not ev["valid"] and "unknown item type" in ev["error"]
    with pytest.raises(LayoutError):
        g.draft(lambda tx: apply_changes(tx, F, [{"op": "move", "id": "nope", "x": 1, "y": 1}]))


CELL = "MATCH (c:Cell {floor:$f, x:$x, y:$y}) RETURN c.walkable AS w, COUNT { (c)-[:ADJACENT]->() } AS n"


def test_adding_item_removes_walkable_links(g):
    def go(tx):
        apply_changes(tx, F, [{"op": "add", "type": "packing_table", "x": 60, "y": 30, "id": "T1"}])
        return tx.one(CELL, {"f": F, "x": 60, "y": 30})

    assert g.one(CELL, {"f": F, "x": 60, "y": 30}) == {"w": True, "n": 4}
    assert g.draft(go) == {"w": False, "n": 0}


def test_moving_item_frees_its_old_cells(g):
    def go(tx):
        apply_changes(tx, F, [{"op": "move", "id": "CUT2", "x": 50, "y": 2}])
        return tx.one(CELL, {"f": F, "x": 43, "y": 3})

    assert g.one(CELL, {"f": F, "x": 43, "y": 3}) == {"w": False, "n": 0}
    assert g.draft(go) == {"w": True, "n": 4}


def test_same_item_changed_twice_in_one_draft(g):
    """add+move and move+move are merged, so the draft never deletes what it created."""
    ev = evaluate(g, F, [{"op": "add", "type": "packing_table", "x": 60, "y": 30, "id": "T1"},
                         {"op": "move", "id": "T1", "x": 70, "y": 30},
                         {"op": "move", "id": "CUT2", "x": 50, "y": 2},
                         {"op": "move", "id": "CUT2", "x": 52, "y": 2},
                         {"op": "add", "type": "packing_table", "x": 60, "y": 35, "id": "T2"},
                         {"op": "remove", "id": "T2"}])
    assert ev["valid"] and ev["passed"], ev


def test_exit_distance_reports_path(g):
    ev = evaluate(g, F, json.loads(open("tests/cases/planted/u09_dist_se_pocket.json").read())["changes"])
    r = next(x for x in ev["results"] if x["rule_id"] == "FP-EXIT-DIST")
    assert r["status"] == "fail" and r["data"]["worst_m"] > r["data"]["limit_m"]
    path = next(iter(r["data"]["paths"].values()))
    assert path[-1] in ([0, 8], [0, 31])  # ends at an exit cell


def test_panel_load_sums_every_level(g):
    r = next(x for x in run_checks(g, F) if x["rule_id"] == "FP-PANEL")
    loads = {l["name"]: l for l in r["data"]["loads"]}
    assert loads["SUB-N"]["kw"] == pytest.approx(loads["DB-A"]["kw"] + loads["DB-B"]["kw"]
                                                + loads["DB-X1"]["kw"] + loads["DB-X2"]["kw"])
    assert loads["MAIN"]["kw"] == pytest.approx(sum(loads[s]["kw"] for s in ("SUB-N", "SUB-S", "SUB-F")))


def test_accept_and_undo():
    g = Graph(":memory:")
    seed_pack(g, load_pack("factory"))
    before = snapshot(g)
    with pytest.raises(NotProven):
        accept(g, F, [{"op": "add", "type": "cutting_table", "x": 10, "y": 18}], source="test")
    assert snapshot(g) == before
    out = accept(g, F, [{"op": "add", "type": "packing_table", "x": 60, "y": 30}], source="test")
    assert out["passed"]
    assert len(snapshot(g)[0]) == len(before[0]) + 1
    assert g.one("MATCH (p:Proposal {status:'accepted'})-[:PLACES]->(i:Item) RETURN i.id AS id")["id"]
    undo(g, F)
    assert snapshot(g) == before
    g.close()


def test_separation_logic_with_fixture_value():
    """Exercises the separation code path. 2.0 m is a TEST FIXTURE, not a rule value."""
    pack = load_pack("factory")
    pack["separations"][0]["min_m"] = 2.0
    g = Graph(":memory:")
    seed_pack(g, pack)
    ev = evaluate(g, F, [{"op": "add", "type": "pressing_machine", "x": 87, "y": 9, "panel": "DB-X2"}])
    assert ev["failed"] == ["FP-SEP"]
    assert evaluate(g, F, [])["passed"]
    g.close()
