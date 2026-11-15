"""API smoke test on a temporary store, with the model in replay mode (no API key used)."""
import shutil

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(scope="module")
def client(tmp_path_factory, monkeypatch_module):
    from backend import config

    store = tmp_path_factory.mktemp("store") / "test.rl"
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
    assert any(not a["passed"] for a in r["attempts"])  # rejected attempts are shown too


def test_agent_without_recording_or_key(client):
    r = client.post("/api/agent", json={"floor": "factory", "request": "a request nobody recorded"}).json()
    assert r["outcome"]["status"] == "not_run" and "META_API_KEY" in r["error"]
