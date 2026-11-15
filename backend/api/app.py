"""FastAPI routes. Run: uvicorn backend.api.app:app --port 8000"""
from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .. import config
from ..agent.runner import agent_run, live_available, replay_path
from ..checks import run_checks, summary
from ..engine import NotProven, accept, evaluate, undo
from ..graph.db import Graph
from ..graph.layout import LayoutError
from ..graph.seed import PACK_FILES, seed

STATE: dict = {}


def graph() -> Graph:
    return STATE["g"]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store = Path(config.STORE)
    fresh = not store.exists()
    g = Graph(str(store))
    if fresh:
        seed(g, [n for n, p in PACK_FILES.items() if p.exists()])
    STATE["g"] = g
    yield
    g.close()


app = FastAPI(title="FloorProof", lifespan=lifespan)


class Changes(BaseModel):
    floor: str
    changes: list[dict] = Field(default_factory=list)


class AgentRequest(BaseModel):
    floor: str
    request: str
    changes: list[dict] = Field(default_factory=list)  # draft to fix (Fix it)


def _floor_payload(g: Graph, floor: str) -> dict:
    f = g.one("""MATCH (f:Floor {name:$f})-[:USES_PACK]->(p:RulePack)
                 RETURN f.name AS name, f.label AS label, f.cols AS cols, f.rows AS rows, f.cell_m AS cell_m,
                        f.width_m AS width_m, f.depth_m AS depth_m, f.sprinklered AS sprinklered,
                        f.data_note AS data_note, p.name AS pack, p.label AS pack_label""", {"f": floor})
    if not f:
        raise HTTPException(404, f"unknown floor {floor}")
    p = {"f": floor, "pack": f["pack"]}
    items = g.q("""MATCH (i:Item {floor:$f})
                   OPTIONAL MATCH (i)-[:WORKS_AT]->(w:Cell)
                   OPTIONAL MATCH (i)-[:POWERED_BY]->(pp:PowerPanel)
                   OPTIONAL MATCH (i)-[r:IN_LINE]->(l:Line)
                   RETURN i.id AS id, i.type AS type, i.x AS x, i.y AS y, i.w AS w, i.d AS d, i.h AS h,
                          i.rotation AS rotation, [w.x, w.y] AS work, pp.name AS panel, l.name AS line, r.seq AS seq
                   ORDER BY id""", p)
    for i in items:
        if i["work"] == [None, None]:
            i["work"] = None
    results = run_checks(g, floor)
    return {
        "floor": f,
        "item_types": g.q("""MATCH (t:ItemType {pack:$pack}) RETURN t.name AS name, t.label AS label, t.w AS w,
                             t.d AS d, t.h AS h, t.kw AS kw, t.heat AS heat, t.color AS color ORDER BY name""", p),
        "zones": g.q("""MATCH (z:Zone {floor:$f}) RETURN z.name AS name, z.kind AS kind, z.axis AS axis,
                        z.x0 AS x0, z.y0 AS y0, z.x1 AS x1, z.y1 AS y1 ORDER BY name""", p),
        "exits": g.q("MATCH (e:Exit {floor:$f}) RETURN e.name AS name, e.x AS x, e.y AS y ORDER BY name", p),
        "panels": g.q("""MATCH (pp:PowerPanel {floor:$f}) OPTIONAL MATCH (pp)-[:FED_BY]->(q:PowerPanel)
                         RETURN pp.name AS name, pp.kind AS kind, pp.capacity_kw AS capacity_kw, pp.x AS x,
                                pp.y AS y, q.name AS fed_by ORDER BY name""", p),
        "lines": g.q("MATCH (l:Line {floor:$f}) RETURN l.name AS name, l.direction AS direction ORDER BY name", p),
        "rules": g.q("""MATCH (:Floor {name:$f})-[:USES_PACK]->(:RulePack)-[:HAS_RULE]->(r:Rule)
                        RETURN r.id AS id, r.kind AS kind, r.title AS title, r.params AS params, r.status AS status,
                               r.source_url AS source_url, r.source_note AS source_note ORDER BY id""", p),
        "items": items,
        "results": results,
        **summary(results),
    }


@app.get("/api/status")
def status() -> dict:
    g = graph()
    floors = g.q("MATCH (f:Floor)-[:USES_PACK]->(p:RulePack) RETURN f.name AS name, f.label AS label, "
                 "p.label AS pack ORDER BY name")
    mode = config.LLM_MODE
    return {"floors": floors, "store": Path(config.STORE).name, "storage": "single file (.rl)",
            "llm": {"mode": mode, "live": live_available() and mode != "replay", "model": config.META_MODEL}}


@app.get("/api/floor/{floor}")
def floor(floor: str) -> dict:
    return _floor_payload(graph(), floor)


@app.post("/api/evaluate")
def api_evaluate(body: Changes) -> dict:
    """Test a draft. The draft is written in a transaction that is always rolled back."""
    return evaluate(graph(), body.floor, body.changes)


@app.post("/api/accept")
def api_accept(body: Changes) -> dict:
    try:
        out = accept(graph(), body.floor, body.changes, source="manual")
    except NotProven as e:
        raise HTTPException(409, {"message": "Layout does not pass the checks, so it was not saved.",
                                  "failed": summary(e.results)["failed"]})
    except LayoutError as e:
        raise HTTPException(400, str(e))
    return {"accepted": out["id"], "floor": _floor_payload(graph(), body.floor)}


@app.post("/api/accept-proposal/{proposal_id}")
def api_accept_proposal(proposal_id: str) -> dict:
    p = graph().one("MATCH (p:Proposal {id:$id}) RETURN p.floor AS floor, p.changes AS changes, p.request AS req",
                    {"id": proposal_id})
    if not p:
        raise HTTPException(404, "unknown proposal")
    try:
        out = accept(graph(), p["floor"], json.loads(p["changes"]), source="agent", request=p["req"] or "")
    except NotProven as e:
        raise HTTPException(409, {"message": "Proposal no longer passes the checks.",
                                  "failed": summary(e.results)["failed"]})
    graph().q("MATCH (p:Proposal {id:$id}) SET p.status = 'chosen'", {"id": proposal_id})
    return {"accepted": out["id"], "floor": _floor_payload(graph(), p["floor"])}


@app.post("/api/undo/{floor}")
def api_undo(floor: str) -> dict:
    out = undo(graph(), floor)
    if not out:
        raise HTTPException(404, "nothing to undo")
    return {**out, "floor": _floor_payload(graph(), floor)}


@app.post("/api/agent")
def api_agent(body: AgentRequest) -> dict:
    """Agent loop: the model proposes, the graph checks decide. Replays a recorded run if there is no key."""
    return agent_run(graph(), body.floor, body.request, body.changes or None,
                     folder="runs" if body.changes else "demo")


@app.post("/api/fix")
def api_fix(body: Changes) -> dict:
    req = "Make the smallest change to this draft so that it passes every rule."
    return agent_run(graph(), body.floor, req, body.changes, folder="runs")


@app.get("/api/replays/{floor}")
def api_replays(floor: str) -> list[dict]:
    out = []
    for p in sorted((config.REPLAY_DIR / "demo").glob(f"{floor}__*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if replay_path(floor, d["request"], d.get("base_changes") or None, "demo") == p:
            out.append({"request": d["request"], "recorded_at": d.get("recorded_at"), "model": d.get("model")})
    return out


@app.get("/api/attempts/{floor}")
def api_attempts(floor: str, limit: int = 30) -> list[dict]:
    rows = graph().q("""MATCH (p:Proposal {floor:$f})
        OPTIONAL MATCH (p)-[:HAS_RESULT]->(c:CheckResult)-[:FOR_RULE]->(r:Rule) WHERE c.status = 'fail'
        WITH p, collect(r.id) AS failed
        RETURN p.id AS id, p.source AS source, p.request AS request, p.round AS round, p.status AS status,
               p.note AS note, p.ms AS ms, p.created AS created, p.run_id AS run_id, failed
        ORDER BY p.created DESC LIMIT $n""", {"f": floor, "n": limit})
    return rows


DIST = config.ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(DIST / "index.html")
