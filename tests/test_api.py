"""API smoke test on a temporary store, with the model in replay mode (no API key used)."""
import shutil

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory, monkeypatch_module):
    from backend import config
    from backend.graph import custom

    store = tmp_path_factory.mktemp("store") / "test.rl"
    user_dir = tmp_path_factory.mktemp("custom")
    monkeypatch_module.setattr(custom, "CUSTOM_DIR", user_dir)
    monkeypatch_module.setattr(custom, "TYPES_FILE", user_dir / "types.json")
    monkeypatch_module.setattr(config, "STORE", str(store))
    monkeypatch_module.setattr(config, "LLM_MODE", "replay")
    from backend.api.app import app

    with TestClient(app) as c:
        yield c
    shutil.rmtree(store.parent, ignore_errors=True)


@pytest.fixture(scope="module")
def monkeypatch_module():
    mp = pytest.MonkeyPatch()
    yield mp
    mp.undo()


def test_floor_and_checks(client):
    d = client.get("/api/floor/factory").json()
    assert d["passed"] and len(d["items"]) == 42 and d["floor"]["cols"] == 100


def test_evaluate_draft_does_not_change_floor(client):
    r = client.post("/api/evaluate", json={"floor": "factory",
                                           "changes": [{"op": "add", "type": "cutting_table", "x": 10, "y": 18}]})
    assert r.json()["failed"] == ["FP-AISLE"]
    assert len(client.get("/api/floor/factory").json()["items"]) == 42


def test_accept_refuses_failing_layout(client):
    r = client.post("/api/accept", json={"floor": "factory",
                                         "changes": [{"op": "add", "type": "cutting_table", "x": 10, "y": 18}]})
    assert r.status_code == 409


def test_accept_then_undo(client):
    r = client.post("/api/accept", json={"floor": "factory",
                                         "changes": [{"op": "add", "type": "packing_table", "x": 60, "y": 30}]})
    assert r.status_code == 200 and len(r.json()["floor"]["items"]) == 43
    r = client.post("/api/undo/factory")
    assert r.status_code == 200 and len(r.json()["floor"]["items"]) == 42


def test_agent_replay_needs_no_key(client):
    r = client.post("/api/agent", json={"floor": "factory", "request": "Add 4 pressing machines to Line B"}).json()
    assert r["mode"] == "replay"
    assert r["outcome"]["status"] == "proven"
    assert all(a["results"] for a in r["attempts"] if a["valid"])  # checks re-ran on the replayed answers


def test_agent_without_recording_or_key(client):
    r = client.post("/api/agent", json={"floor": "factory", "request": "a request nobody recorded"}).json()
    assert r["outcome"]["status"] == "not_run" and "META_API_KEY" in r["error"]


def test_suggest_route(client):
    r = client.post("/api/suggest", json={"floor": "factory", "type": "pressing_machine", "line": "B"}).json()
    assert r["picks"] and r["picks"][0]["passed"] and r["heat"]


def test_describe_and_custom_item(client):
    d = client.post("/api/item-types/describe", json={"text": "Dryer 2 x 1.5 m, 1.8 m tall, 6 kW"}).json()
    assert d["source"] == "parser" and d["w_m"] == 2.0  # replay mode: no model call
    r = client.post("/api/item-types", json={"floor": "factory", **{k: d[k] for k in ("label", "w_m", "d_m", "h_m", "kw", "shape")}})
    assert r.status_code == 200
    assert any(t["custom"] and t["name"] == r.json()["item_type"]["name"] for t in r.json()["floor"]["item_types"])


def test_custom_floor_routes(client):
    spec = {"name": "shop", "label": "Shop", "width_m": 10, "depth_m": 8, "exits": [{"name": "E1", "x": 0, "y": 3}],
            "zones": [], "panels": [], "lines": []}
    r = client.post("/api/floors", json={"spec": spec})
    assert r.status_code == 200 and r.json()["floor"]["passed"] and r.json()["floor"]["floor"]["custom"]
    assert client.post("/api/floors", json={"spec": spec}).status_code == 400  # name taken
    assert client.get("/api/floors/shop/spec").json()["width_m"] == 10
    r = client.put("/api/floors/shop", json={"spec": {**spec, "width_m": 12}})
    assert r.status_code == 200 and r.json()["floor"]["floor"]["cols"] == 24
    assert client.delete("/api/floors/shop").status_code == 200
    assert client.delete("/api/floors/factory").status_code == 400  # built-in floors cannot be deleted