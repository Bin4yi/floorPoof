"""Part 2 (full loop) and Part 3 (model alone vs model plus checks) on the 30 requests.

Every model answer is recorded in backend/replay/cases/, so a later run with no
API key replays the same answers and the checks run again for real.
"""
from __future__ import annotations

import statistics

from ..engine import evaluate
from ..graph.db import Graph
from ..testset import REQUESTS_DIR, load_cases
from .prompt import build_messages, floor_context, parse_layouts
from .requests import satisfies
from .runner import agent_run, make_llm, replay_path


def _part2_case(g: Graph, case: dict, mode: str) -> dict:
    run = agent_run(g, case["floor"], case["request"], mode=mode, folder="cases/part2", record=False)
    if run["outcome"]["status"] == "not_run":
        return {"id": case["id"], "status": "not_run"}
    good_rounds = []
    for a in run["attempts"]:
        if a["passed"]:
            ok, why = satisfies(g, case["floor"], case["must"], a["changes"])
            a["satisfies"], a["satisfies_why"] = ok, why
            if ok:
                good_rounds.append(a["round"])
    if good_rounds and min(good_rounds) == 1:
        status = "first_round"
    elif good_rounds:
        status = "after_retries"
    else:
        status = "never"
    last = [a for a in run["attempts"] if a["round"] == run["rounds"]]
    why = ""
    if status == "never":
        passed_wrong = [a.get("satisfies_why") for a in run["attempts"] if a["passed"]]
        why = (f"proven layout did not do the request ({passed_wrong[0]})" if passed_wrong else
               "handed back to the user with the open problems: "
               + "; ".join(run["outcome"].get("open_problems", [])[:2]))
    return {"id": case["id"], "floor": case["floor"], "request": case["request"], "status": status,
            "rounds": run["rounds"], "proven": run["outcome"]["status"] == "proven", "why": why,
            "check_ms": [a["ms"] for a in run["attempts"] if a["valid"]], "mode": run["mode"],
            "last_failed": sorted({r for a in last for r in a["failed"]})}


def _part3_case(g: Graph, case: dict, mode: str) -> dict:
    path = replay_path(case["floor"], case["request"], None, "cases/part3")
    llm, rec = make_llm(path, mode)
    if llm is None:
        return {"id": case["id"], "status": "not_run"}
    msgs = build_messages(floor_context(g, case["floor"]), case["request"], [], "")
    try:
        layouts = parse_layouts(llm.complete(msgs))
    except Exception as e:  # noqa: BLE001
        layouts, err = [], str(e)
    if rec is not None and rec.calls:
        rec.save(path, {"floor": case["floor"], "request": case["request"], "base_changes": []})
    if not layouts or not layouts[0]["changes"]:
        return {"id": case["id"], "status": "broke", "why": "no usable layout"}
    first = layouts[0]["changes"]
    ev = evaluate(g, case["floor"], first)  # measured only; the model alone gets no feedback
    ok, why = satisfies(g, case["floor"], case["must"], first)
    return {"id": case["id"], "status": "ok" if ev["passed"] else "broke", "does_request": ok,
            "failed": ev["failed"], "why": ev.get("error") or ", ".join(ev["failed"])}


def run_parts(g: Graph, parts: list[int], mode: str = "auto") -> dict:
    cases = load_cases(REQUESTS_DIR)
    out: dict = {}
    if 2 in parts:
        rows = []
        for c in cases:
            r = _part2_case(g, c, mode)
            rows.append(r)
            print(f"  part 2 {c['id']}: {r['status']}" + (f" ({r.get('why')})" if r.get("why") else ""), flush=True)
        ran = [r for r in rows if r["status"] != "not_run"]
        print("\nPart 2: change requests through the full loop")
        if not ran:
            print("  not run: no META_API_KEY and no recorded runs in backend/replay/cases/part2")
        else:
            n = {s: sum(1 for r in ran if r["status"] == s) for s in ("first_round", "after_retries", "never")}
            ms = [m for r in ran for m in r["check_ms"]]
            modes = sorted({r["mode"] for r in ran})
            print(f"  requests run: {len(ran)} of {len(rows)} (model answers: {', '.join(modes)})")
            print(f"  passed on the first round: {n['first_round']}, passed after retries: {n['after_retries']}, "
                  f"never solved: {n['never']}")
            print(f"  average check time per layout: {statistics.mean(ms):.0f} ms over {len(ms)} layouts" if ms else "")
            for r in ran:
                if r["status"] == "never":
                    print(f"  NEVER {r['id']} \"{r['request']}\": {r['why']}")
        out["part2"] = {"rows": rows}
    if 3 in parts:
        rows = [_part3_case(g, c, mode) for c in cases]
        ran = [r for r in rows if r["status"] != "not_run"]
        print("\nPart 3: model alone against model plus checks (same requests)")
        if not ran:
            print("  not run: no META_API_KEY and no recorded runs in backend/replay/cases/part3")
        else:
            broke = sum(1 for r in ran if r["status"] == "broke")
            print(f"  model alone: {broke} of {len(ran)} first layouts broke a rule (or were unusable)")
            if "part2" in out:
                p2 = [r for r in out["part2"]["rows"] if r["status"] != "not_run"]
                proven = sum(1 for r in p2 if r["proven"])
                solved = sum(1 for r in p2 if r["status"] in ("first_round", "after_retries"))
                print(f"  model plus checks: {proven} of {len(p2)} final layouts proven by the graph checks, "
                      f"{solved} of {len(p2)} proven and doing what was asked; the rest handed back to the user")
                print(f"  every layout shown by model plus checks passed the checks; "
                      f"unchecked, the model alone would have shown {broke} rule-breaking layouts")
        out["part3"] = {"rows": rows}
    return out
