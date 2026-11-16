"""FastAPI routes. Run: uvicorn backend.api.app:app --port 8000"""
from __future__ import annotations

import json
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .. import config
from ..agent.runner import agent_run, live_available, replay_path
from ..checks import run_checks, summary
from ..engine import NotProven, accept, evaluate, undo
from ..graph.db import Graph
from ..agent.describe import describe
from ..graph.custom import SpecError, add_item_type, floor_spec, is_custom, remove_floor, save_floor
from ..graph.layout import LayoutError
from ..graph.seed import PACK_FILES, ensure_flows, seed
from ..metrics import compute as compute_metrics
from ..memory import backfill, ensure_index, recall
from ..suggest import suggest

mimetypes.add_type("application/wasm", ".wasm")  # Relate's browser build; Windows may not know the type
STATE: dict = {}


def graph() -> Graph:
    return STATE["g"]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store = Path(config.STORE)
    fresh = not store.exists()
    g = Graph(str(store))
    if fresh:
        seed(g, [n for n, p in PACK_FILES.items() if p.exists()], user_files=True)
    else:
        ensure_flows(g)
    ensure_index(g)  # vector index for agent memory
    backfill(g)
    STATE["g"] = g
    yield
    g.close()


app = FastAPI(title="FloorProof", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2000)


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
    f["custom"] = is_custom(floor)
    return {
        "floor": f,
        "item_types": g.q("""MATCH (t:ItemType {pack:$pack}) RETURN t.name AS name, t.label AS label, t.w AS w,
                             t.d AS d, t.h AS h, t.kw AS kw, t.heat AS heat, t.color AS color, t.shape AS shape,
                             coalesce(t.custom, false) AS custom, t.description AS description
                             ORDER BY custom, name""", p),
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
        "metrics": compute_metrics(g, floor, results),
        **summary(results),
    }


@app.get("/api/status")
def status() -> dict:
    g = graph()
    floors = g.q("MATCH (f:Floor)-[:USES_PACK]->(p:RulePack) RETURN f.name AS name, f.label AS label, "
                 "p.label AS pack ORDER BY name")
    mode = config.LLM_MODE
    for f in floors:
        f["custom"] = is_custom(f["name"])
    return {"floors": floors, "store": Path(config.STORE).name, "storage": "single file (.rl)",
            "llm": {"mode": mode, "live": live_available() and mode != "replay", "model": config.META_MODEL}}


@app.get("/api/floor/{floor}")
def floor(floor: str) -> dict:
    return _floor_payload(graph(), floor)


@app.post("/api/evaluate")
def api_evaluate(body: Changes) -> dict:
    """Test a draft. The draft is written in a transaction that is always rolled back."""
    return evaluate(graph(), body.floor, body.changes, metrics=True)


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
                     folder="runs" if body.changes else "demo", memory=True)


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


@app.get("/api/memory/{floor}")
def api_memory(floor: str, q: str, k: int = 5) -> list[dict]:
    """Proven layouts for requests like q, by Relate vector search over Proposal nodes."""
    return recall(graph(), floor, q, k=k, min_score=0.2)


EXPORT_SKIP = ["NEIGHBOR", "HAS_RESULT", "FOR_RULE", "FAILED_AT", "PLACES"]


@app.get("/api/export/{floor}")
def api_export(floor: str) -> dict:
    """The floor's graph as compact JSON, for the in-browser Relate (WASM) explorer.
    Leaves out proposal history and the static NEIGHBOR grid; keeps walkable ADJACENT links.
    nodes: [key, label, props]   rels: [from key, to key, type, props or null]"""
    g = graph()
    f = g.one("MATCH (fl:Floor {name:$f})-[:USES_PACK]->(pk:RulePack) RETURN pk.name AS pack", {"f": floor})
    if not f:
        raise HTTPException(404, f"unknown floor {floor}")
    p = {"f": floor, "pack": f["pack"], "skip": EXPORT_SKIP}
    node_q = [
        "MATCH (n) WHERE n.floor = $f AND NOT n:Proposal AND NOT n:CheckResult RETURN n",
        "MATCH (n:Floor {name:$f}) RETURN n",
        "MATCH (n:RulePack {name:$pack}) RETURN n",
        "MATCH (:RulePack {name:$pack})-[:HAS_RULE]->(n:Rule) RETURN n",
        "MATCH (n:ItemType {pack:$pack}) RETURN n",
    ]
    rel_q = [
        "MATCH (a)-[r]->(b) WHERE a.floor = $f AND b.floor = $f AND NOT type(r) IN $skip RETURN a, r, b",
        "MATCH (a:Item {floor:$f})-[r:IS_A]->(b) RETURN a, r, b",
        "MATCH (a:Floor {name:$f})-[r:USES_PACK]->(b) RETURN a, r, b",
        "MATCH (a:RulePack {name:$pack})-[r:HAS_RULE]->(b) RETURN a, r, b",
        "MATCH (a:ItemType {pack:$pack})-[r]->(b:ItemType) RETURN a, r, b",
        "MATCH (a:Rule)-[r:APPLIES_TO]->(b:ItemType {pack:$pack}) RETURN a, r, b",
    ]
    nodes: dict = {}
    for q in node_q:
        for row in g.q(q.replace("RETURN n", "RETURN elementId(n) AS k, labels(n)[0] AS label, properties(n) AS props"), p):
            nodes[row["k"]] = [row["k"], row["label"],
                               {k: v for k, v in row["props"].items()
                                if k != "req_vec" and not (isinstance(v, str) and len(v) > 400)}]
    rels = []
    for q in rel_q:
        q = q.replace("RETURN a, r, b", "RETURN elementId(a) AS s, elementId(b) AS t, type(r) AS type, properties(r) AS props")
        for row in g.q(q, p):
            if row["s"] in nodes and row["t"] in nodes:
                rels.append([row["s"], row["t"], row["type"], row["props"] or None])
    return {"floor": floor, "nodes": list(nodes.values()), "rels": rels}


class SuggestRequest(BaseModel):
    floor: str
    changes: list[dict] = Field(default_factory=list)
    type: str | None = None
    rotation: int = 0
    line: str | None = None
    panel: str | None = None
    move_id: str | None = None


@app.post("/api/suggest")
def api_suggest(body: SuggestRequest) -> dict:
    """Best spots for one item: a fast scan, then the top picks are proven by the real checks."""
    if not body.type and not body.move_id:
        raise HTTPException(400, "give a type or an item to move")
    try:
        return suggest(graph(), body.floor, body.changes, body.type, body.rotation, body.line, body.panel, body.move_id)
    except LayoutError as e:
        raise HTTPException(400, str(e))


class Describe(BaseModel):
    text: str


@app.post("/api/item-types/describe")
def api_describe(body: Describe) -> dict:
    """Fill the new-item form from a plain description. The user checks the values before saving."""
    try:
        return describe(body.text)
    except ValueError as e:
        raise HTTPException(400, str(e))


class NewItemType(BaseModel):
    floor: str
    label: str
    w_m: float
    d_m: float
    h_m: float
    kw: float = 0
    heat: bool = False
    color: str = "#5ad1ff"
    shape: str = "machine"
    description: str = ""


@app.post("/api/item-types")
def api_add_item_type(body: NewItemType) -> dict:
    try:
        t = add_item_type(graph(), body.floor, body.model_dump())
    except SpecError as e:
        raise HTTPException(400, str(e))
    return {"item_type": t, "floor": _floor_payload(graph(), body.floor)}


class FloorSpec(BaseModel):
    spec: dict


@app.post("/api/floors")
def api_create_floor(body: FloorSpec) -> dict:
    """Create a custom floor from what the user drew. It gets the generic rule pack."""
    try:
        pack = save_floor(graph(), body.spec)
    except SpecError as e:
        raise HTTPException(400, str(e))
    return {"name": pack["floor"]["name"], "floor": _floor_payload(graph(), pack["floor"]["name"])}


@app.put("/api/floors/{floor}")
def api_edit_floor(floor: str, body: FloorSpec) -> dict:
    try:
        pack = save_floor(graph(), {**body.spec, "name": floor}, editing=True)
    except SpecError as e:
        raise HTTPException(400, str(e))
    return {"name": floor, "floor": _floor_payload(graph(), floor),
            "kept_items": len(pack["items"]), "sent_items": len(body.spec.get("items", []))}


@app.get("/api/floors/{floor}/spec")
def api_floor_spec(floor: str) -> dict:
    try:
        return floor_spec(graph(), floor)
    except SpecError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/floors/{floor}")
def api_delete_floor(floor: str) -> dict:
    try:
        remove_floor(graph(), floor)
    except SpecError as e:
        raise HTTPException(400, str(e))
    return {"deleted": floor}


DIST = config.ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(DIST / "index.html")
