"""Pick the model client (live, recording or replay) and run the agent."""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from .. import config
from ..graph.db import Graph
from .llm import MetaLLM, Recorder, ReplayLLM
from ..memory import as_prompt, recall
from .loop import run_agent
from .prompt import floor_context


def replay_path(floor: str, request: str, base_changes: list | None = None, folder: str = "runs") -> Path:
    slug = re.sub(r"[^a-z0-9]+", "-", request.lower()).strip("-")[:60] or "request"
    key = hashlib.sha256(json.dumps([floor, request.strip().lower(), base_changes or []],
                                    sort_keys=True).encode()).hexdigest()[:8]
    return config.REPLAY_DIR / folder / f"{floor}__{slug}__{key}.json"


def live_available() -> bool:
    return bool(config.META_API_KEY)


def make_llm(path: Path, mode: str | None = None):
    """Returns (llm, recorder) or (None, None) if no model can be used."""
    mode = mode or config.LLM_MODE
    if mode == "live" or (mode == "auto" and live_available()):
        rec = Recorder(MetaLLM())
        return rec, rec
    if path.exists():
        return ReplayLLM(path), None
    return None, None


def agent_run(g: Graph, floor: str, request: str, base_changes: list | None = None, *, mode: str | None = None,
              folder: str = "runs", record: bool = True, memory: bool = False, **kw) -> dict:
    """memory=True adds proven layouts for similar past requests to the prompt (Relate vector search).
    The test set and reproduce.py leave it off, so their prompts stay as recorded."""
    path = replay_path(floor, request, base_changes, folder)
    llm, rec = make_llm(path, mode)
    if llm is None:
        return {"error": "No model available: set META_API_KEY in .env, or use a request that has a recorded "
                         "run in backend/replay.", "attempts": [], "outcome": {"status": "not_run"}}
    mem = recall(g, floor, request) if memory else []
    context = (floor_context(g, floor) + "\n\n" + as_prompt(mem)) if mem else None
    out = run_agent(g, llm, floor, request, base_changes, context=context, record=record, **kw)
    out["memory"] = [{k: m[k] for k in ("id", "request", "score", "status")} for m in mem]
    if rec is not None and rec.calls:
        rec.save(path, {"floor": floor, "request": request, "base_changes": base_changes or []})
    out["replay_file"] = str(path.relative_to(config.ROOT)).replace("\\", "/")
    out["mode"] = "replay" if isinstance(llm, ReplayLLM) else "live"
    return out
