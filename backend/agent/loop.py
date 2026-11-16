"""The agent loop in LangGraph: propose -> check -> (retry | finish).

propose  asks the model for up to 3 layouts (positions only)
check    tests each layout in a rolled-back Relate transaction and stores a Proposal
retry    if none passed and rounds are left, the failures go back to the model
finish   picks the passed layout with the fewest changes, or hands the open
         problems back to the user after the last round
"""
from __future__ import annotations

import time
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..engine import evaluate, record_proposal
from ..graph.db import Graph
from ..graph.layout import normalize_changes
from .prompt import build_messages, floor_context, format_feedback, parse_layouts

MAX_ROUNDS = 3


class State(TypedDict, total=False):
    floor: str
    request: str
    base_changes: list
    round: int
    run_id: str
    context: str
    pending: list
    attempts: list
    feedback: list
    outcome: dict
    llm_seconds: float


def build_agent(g: Graph, llm, *, record: bool = True, max_rounds: int = MAX_ROUNDS, source: str = "agent"):
    def propose(s: State) -> dict:
        context = s.get("context") or floor_context(g, s["floor"])
        msgs = build_messages(context, s["request"], s.get("base_changes", []), format_feedback(s.get("feedback", [])))
        t0 = time.perf_counter()
        try:
            text = llm.complete(msgs)
            err = None
        except Exception as e:  # noqa: BLE001 - reported as a failed round, never as a pass
            text, err = "", f"model call failed: {e}"
        layouts = parse_layouts(text)
        if not layouts:
            layouts = [{"note": "", "changes": None, "error": err or "model answer was not valid layout JSON"}]
        return {"context": context, "pending": layouts, "round": s.get("round", 0) + 1,
                "llm_seconds": s.get("llm_seconds", 0.0) + time.perf_counter() - t0}

    def check(s: State) -> dict:
        attempts = list(s.get("attempts", []))
        failures = []
        for k, lay in enumerate(s["pending"], 1):
            if lay.get("changes") is None or not (lay["changes"] or s.get("base_changes")):
                err = lay.get("error") or "layout proposes no changes"
                ev = {"valid": False, "error": err, "passed": False, "results": [], "failed": [], "ms": 0.0}
                changes: list = []
            else:
                changes = list(s.get("base_changes", [])) + lay["changes"]
                try:
                    changes = normalize_changes(changes)
                except ValueError:
                    pass  # evaluate() reports it as invalid
                ev = evaluate(g, s["floor"], changes)
            pid = record_proposal(g, s["floor"], changes, ev, source=source, request=s["request"],
                                  round_no=s["round"], run_id=s["run_id"], note=lay.get("note", "")) if record else None
            att = {"proposal_id": pid, "round": s["round"], "index": k, "note": lay.get("note", ""),
                   "changes": changes, "extra_changes": lay.get("changes") or [], "valid": ev["valid"],
                   "error": ev.get("error"), "passed": ev["passed"], "failed": ev["failed"], "ms": ev["ms"],
                   "results": ev["results"]}
            attempts.append(att)
            if not ev["passed"]:
                failures.append({"changes": lay.get("changes") or [], "error": ev.get("error"),
                                 "failed": [r for r in ev["results"] if r["status"] == "fail"]})
        return {"attempts": attempts, "feedback": failures, "pending": []}

    def route(s: State) -> str:
        this_round = [a for a in s["attempts"] if a["round"] == s["round"]]
        if any(a["passed"] for a in this_round) or s["round"] >= max_rounds:
            return "finish"
        return "propose"

    def finish(s: State) -> dict:
        passed = [a for a in s["attempts"] if a["passed"]]
        if passed:
            best = min(passed, key=lambda a: (len(a["changes"]), a["round"], a["index"]))
            outcome = {"status": "proven", "best": best["proposal_id"], "best_index": s["attempts"].index(best),
                       "round": best["round"], "changes": best["changes"]}
        else:
            last = [a for a in s["attempts"] if a["round"] == s["round"]]
            problems = sorted({f"{r['rule_id']}: {r['detail']}" for a in last for r in a["results"]
                               if r["status"] == "fail"} | {a["error"] for a in last if a["error"]})
            outcome = {"status": "handed_back", "round": s["round"], "open_problems": problems}
        return {"outcome": outcome}

    sg = StateGraph(State)
    sg.add_node("propose", propose)
    sg.add_node("check", check)
    sg.add_node("finish", finish)
    sg.add_edge(START, "propose")
    sg.add_edge("propose", "check")
    sg.add_conditional_edges("check", route, {"propose": "propose", "finish": "finish"})
    sg.add_edge("finish", END)
    return sg.compile()


def run_agent(g: Graph, llm, floor: str, request: str, base_changes: list | None = None,
              context: str | None = None, **kw: Any) -> dict:
    """context: the floor context for the prompt; built from the graph when not given."""
    run_id = f"R-{uuid.uuid4().hex[:8]}"
    t0 = time.perf_counter()
    start = {"floor": floor, "request": request, "base_changes": base_changes or [], "round": 0, "run_id": run_id,
             "attempts": [], "feedback": []}
    if context:
        start["context"] = context
    state = build_agent(g, llm, **kw).invoke(start, config={"recursion_limit": 4 * MAX_ROUNDS + 4})
    return {"run_id": run_id, "floor": floor, "request": request, "attempts": state["attempts"],
            "outcome": state["outcome"], "rounds": state["round"], "llm": getattr(llm, "name", "?"),
            "llm_seconds": round(state.get("llm_seconds", 0.0), 1),
            "seconds": round(time.perf_counter() - t0, 1)}
