"""Custom floors, custom item types, the best-spot finder and the item description parser."""
import pytest

from backend.agent.describe import parse_text
from backend.checks import run_checks
from backend.engine import accept, evaluate
from backend.graph import custom
from backend.suggest import suggest
from backend.testset import fresh_graph

SPEC = {"name": "Bakery 1", "label": "Bakery", "industry": "Food", "width_m": 20, "depth_m": 12, "sprinklered": True,
        "exits": [{"name": "E1", "x": 0, "y": 5}, {"name": "E2", "x": 39, "y": 20}],
        "zones": [{"name": "Aisle", "kind": "aisle", "x0": 0, "y0": 10, "x1": 39, "y1": 12}],
        "panels": [{"name": "M", "kind": "main_breaker", "capacity_kw": 40, "x": 39, "y": 0},
                   {"name": "D1", "kind": "drop_box", "capacity_kw": 10, "fed_by": "M", "x": 20, "y": 0}],
        "lines": [{"name": "L1", "direction": "+x"}]}
OVEN = {"label": "Oven", "w_m": 2, "d_m": 1.5, "h_m": 1.8, "kw": 6, "shape": "tank", "heat": True}


@pytest.fixture()
def cg(tmp_path, monkeypatch):
    """A fresh graph, with the user's custom files redirected to a temp folder."""
    monkeypatch.setattr(custom, "CUSTOM_DIR", tmp_path)
    monkeypatch.setattr(custom, "TYPES_FILE", tmp_path / "types.json")
    g = fresh_graph()
    yield g
    g.close()


def test_suggest_picks_are_proven_by_the_checks(g):
    r = suggest(g, "factory", [], "pressing_machine", 0, line="B")
    assert r["counts"]["fits"] > 0 and r["picks"]
    for p in r["picks"]:
        ev = evaluate(g, "factory", [{**p["change"]}])
        assert ev["passed"] == p["passed"]  # the pick's label matches a fresh full check
    best = r["picks"][0]
    assert best["passed"] and best["path"] and best["change"]["line"] == "B"


def test_suggest_respects_power_limits(cg):
    custom.save_floor(cg, SPEC)
    too_hot = custom.add_item_type(cg, "bakery-1", {**OVEN, "label": "Big oven", "kw": 9})  # D1 limit is 8 kW
    r = suggest(cg, "bakery-1", [], too_hot["name"], 0)
    assert r["picks"] == [] and r["counts"]["power"] > 0


def test_suggest_for_moving_an_item(g):
    r = suggest(g, "factory", [], move_id="R1")
    assert r["type"] == "fabric_rack" and r["picks"][0]["change"]["op"] == "move"
    assert any(p["passed"] for p in r["picks"])


def test_custom_floor_create_edit_delete(cg, tmp_path):
    pack = custom.save_floor(cg, SPEC)
    assert pack["floor"]["name"] == "bakery-1" and (tmp_path / "bakery-1.json").exists()
    kinds = {r["kind"] for r in run_checks(cg, "bakery-1")}
    assert kinds == {"overlap", "exit_reach", "exit_distance", "aisle_width", "panel_load", "line_flow"}
    assert all(r["status"] == "pass" for r in run_checks(cg, "bakery-1"))

    t = custom.add_item_type(cg, "bakery-1", OVEN)
    pick = suggest(cg, "bakery-1", [], t["name"], 0, line="L1")["picks"][0]
    accept(cg, "bakery-1", [pick["change"]], source="manual")

    spec = custom.floor_spec(cg, "bakery-1")
    assert len(spec["items"]) == 1
    spec["rules"] = {"exit_distance_m": 30, "exit_distance_source": "my local code"}
    spec["panels"] = spec["panels"][:1]  # drop D1: its rule stays, the item loses its plug
    pack = custom.save_floor(cg, spec, editing=True)
    assert len(pack["items"]) == 1 and pack["items"][0]["panel"] is None
    rule = cg.one("MATCH (r:Rule {id:'CU-BAKERY-1-EXIT-DIST'}) RETURN r.params AS p, r.status AS s")
    assert '"max_m_unsprinklered": 30' in rule["p"] and rule["s"] == "user"

    custom.remove_floor(cg, "bakery-1")
    assert cg.one("MATCH (c:Cell {floor:'bakery-1'}) RETURN count(c) AS n")["n"] == 0
    assert not (tmp_path / "bakery-1.json").exists()


def test_custom_floor_validation(cg):
    with pytest.raises(custom.SpecError, match="outside wall"):
        custom.save_floor(cg, {**SPEC, "exits": [{"name": "E1", "x": 5, "y": 5}]})
    with pytest.raises(custom.SpecError, match="loop"):
        custom.save_floor(cg, {**SPEC, "panels": [
            {"name": "A", "kind": "sub_panel", "capacity_kw": 9, "fed_by": "B", "x": 1, "y": 1},
            {"name": "B", "kind": "sub_panel", "capacity_kw": 9, "fed_by": "A", "x": 2, "y": 1}]})
    with pytest.raises(custom.SpecError):
        custom.save_floor(cg, {**SPEC, "name": "factory"})


def test_custom_item_type_on_builtin_floor(cg, tmp_path):
    t = custom.add_item_type(cg, "factory", {**OVEN, "label": "Steam tunnel", "w_m": 2.2})
    assert t["w"] == 5 and t["d"] == 3  # sizes round up to whole 0.5 m cells
    assert (tmp_path / "types.json").exists()
    ev = evaluate(cg, "factory", [{"op": "add", "type": t["name"], "x": 60, "y": 30}])
    assert ev["valid"]


def test_parse_text_reads_sizes_and_power():
    d = parse_text("Industrial dryer, 2 x 1.5 m, 1.8 m tall, 6 kW")
    assert (d["w_m"], d["d_m"], d["h_m"], d["kw"]) == (2.0, 1.5, 1.8, 6.0)
    assert d["label"] == "Industrial dryer" and d["heat"] and d["assumed"] == []
    d = parse_text("steam press 1200 x 800 mm 900 W")
    assert (d["w_m"], d["d_m"], d["kw"]) == (1.2, 0.8, 0.9) and "h_m" in d["assumed"]


def test_efficiency_metrics_move_with_the_layout(g):
    from backend.metrics import compute
    base = compute(g, "factory", run_checks(g, "factory"))
    assert set(base["aspects"]) == {"evacuation", "travel", "crowding", "elbow_room", "power", "openness"}
    assert all(0 <= v <= 100 for v in base["aspects"].values() if v is not None)
    assert len(base["lines"]) == 4 and base["flows"] and base["kpi"]["workers"] == 42
    # Moving the fabric racks far from the cutting tables makes material travel longer.
    far = [{"op": "move", "id": r, "x": 1, "y": y} for r, y in (("R1", 24), ("R2", 27), ("R3", 30), ("R4", 34))]
    ev = evaluate(g, "factory", far, metrics=True)
    fab = lambda m: next(f["m"] for f in m["flows"] if f["name"] == "Fabric to cutting")
    assert fab(ev["metrics"]) != fab(base)
    assert evaluate(g, "factory", [], metrics=False).get("metrics") is None
