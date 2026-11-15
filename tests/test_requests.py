"""Scoring of change requests (Part 2 and 3). Not a safety check."""
from backend.agent.prompt import parse_layouts
from backend.agent.requests import satisfies

ADD4 = {"add": [{"type": "pressing_machine", "count": 4, "line": "B"}]}


def press(x, line="B"):
    return {"op": "add", "type": "pressing_machine", "x": x, "y": 10, "line": line}


def test_counts_adds_by_type_and_line(g):
    assert satisfies(g, "factory", ADD4, [press(34), press(38), press(42), press(46)])[0]
    assert not satisfies(g, "factory", ADD4, [press(34), press(38), press(42)])[0]
    assert not satisfies(g, "factory", ADD4, [press(34), press(38), press(42), press(46, line="A")])[0]


def test_unasked_removal_is_not_a_correct_answer(g):
    ok, why = satisfies(g, "factory", ADD4, [{"op": "remove", "id": "A1"}, press(34), press(38), press(42), press(46)])
    assert not ok and "A1" in why


def test_zone_requirement(g):
    must = {"add": [{"type": "packing_table", "count": 1, "zone": "Finishing"}]}
    assert satisfies(g, "factory", must, [{"op": "add", "type": "packing_table", "x": 80, "y": 37}])[0]
    assert not satisfies(g, "factory", must, [{"op": "add", "type": "packing_table", "x": 60, "y": 30}])[0]


def test_parse_layouts_tolerates_fences_and_junk():
    text = 'Sure!\n```json\n{"layouts": [{"note": "a", "changes": [{"op": "remove", "id": "R1"}]}]}\n```'
    assert parse_layouts(text)[0]["changes"] == [{"op": "remove", "id": "R1"}]
    assert parse_layouts("no json here") == []
