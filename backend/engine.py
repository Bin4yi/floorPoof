"""Evaluate, accept and undo layouts.

evaluate(): writes the draft inside a Relate transaction, runs every check,
and always rolls back, so the accepted floor never changes.
accept(): applies the changes in a transaction, re-runs the checks, and
commits only if they all pass.
"""
from __future__ import annotations

import json
import time
import uuid

from .checks import run_checks, summary
from .graph.db import Graph
from .graph.layout import LayoutError, apply_changes
from .memory import set_vector


class NotProven(Exception):
    def __init__(self, results: list[dict]):
        self.results = results
        super().__init__("layout does not pass the checks")


def evaluate(g: Graph, floor: str, changes: list[dict], metrics: bool = False) -> dict:
    """metrics=True also measures worker efficiency on the draft (backend/metrics.py)."""
    def go(tx: Graph) -> dict:
        t0 = time.perf_counter()
        try:
            applied = apply_changes(tx, floor, changes)
        except LayoutError as e:
            return {"valid": False, "error": str(e), "passed": False, "results": [], "failed": [],
                    "skipped": [], "ms": 0.0}
        write_ms = (time.perf_counter() - t0) * 1000
        results = run_checks(tx, floor)
        out = {"valid": True, "error": None, "results": results, "placed": applied["placed"],
               "write_ms": round(write_ms, 2), **summary(results)}
        if metrics:
            from .metrics import compute
            out["metrics"] = compute(tx, floor, results)
        return out

    return g.draft(go)


def record_proposal(g: Graph, floor: str, changes: list[dict], evaluation: dict, *, source: str,
                    request: str = "", round_no: int = 0, run_id: str = "", status: str | None = None,
                    note: str = "") -> str:
    """Store a Proposal and its CheckResults in the graph (committed)."""
    pid = f"P-{uuid.uuid4().hex[:10]}"
    status = status or ("passed" if evaluation["passed"] else ("invalid" if not evaluation["valid"] else "rejected"))

    def go(tx: Graph) -> None:
        tx.q("""CREATE (p:Proposal {id:$id, floor:$f, source:$src, request:$req, round:$round, run_id:$run,
                                    status:$status, changes:$changes, note:$note, error:$err, ms:$ms, created:$t})""",
             {"id": pid, "f": floor, "src": source, "req": request, "round": round_no, "run": run_id,
              "status": status, "changes": json.dumps(changes), "note": note, "err": evaluation.get("error"),
              "ms": evaluation.get("ms", 0.0), "t": time.time()})
        set_vector(tx, pid, request)  # agent memory: vector of the request text (backend/memory.py)
        for r in evaluation.get("results", []):
            tx.q("""MATCH (p:Proposal {id:$id}) MATCH (ru:Rule {id:$rule})
                    CREATE (p)-[:HAS_RESULT]->(c:CheckResult {passed:$passed, status:$status, detail:$detail, ms:$ms})
                    CREATE (c)-[:FOR_RULE]->(ru)
                    WITH c UNWIND $cells AS k MATCH (cell:Cell {floor:$f, x:k[0], y:k[1]})
                    CREATE (c)-[:FAILED_AT]->(cell)""",
                 {"id": pid, "rule": r["rule_id"], "passed": r["status"] != "fail", "status": r["status"],
                  "detail": r["detail"], "ms": r["ms"], "f": floor, "cells": r["cells"][:400]})

    g.commit(go)
    return pid


def accept(g: Graph, floor: str, changes: list[dict], *, source: str, request: str = "") -> dict:
    """Apply changes for real, only if every check passes. Raises NotProven or LayoutError."""
    holder: dict = {}

    def go(tx: Graph) -> None:
        applied = apply_changes(tx, floor, changes)
        results = run_checks(tx, floor)
        s = summary(results)
        if not s["passed"]:
            raise NotProven(results)
        pid = f"P-{uuid.uuid4().hex[:10]}"
        tx.q("""CREATE (p:Proposal {id:$id, floor:$f, source:$src, request:$req, round:0, status:'accepted',
                                    changes:$changes, inverse:$inv, ms:$ms, created:$t})
                WITH p UNWIND $placed AS iid MATCH (i:Item {floor:$f, id:iid}) CREATE (p)-[:PLACES]->(i)""",
             {"id": pid, "f": floor, "src": source, "req": request, "changes": json.dumps(changes),
              "inv": json.dumps(applied["inverse"]), "placed": applied["placed"], "ms": s["ms"], "t": time.time()})
        set_vector(tx, pid, request)
        holder.update(id=pid, results=results, **s)

    g.commit(go)
    return holder


def undo(g: Graph, floor: str) -> dict | None:
    """Revert the last accepted proposal on this floor."""
    last = g.one("""MATCH (p:Proposal {floor:$f, status:'accepted'})
                    RETURN p.id AS id, p.inverse AS inverse ORDER BY p.created DESC LIMIT 1""", {"f": floor})
    if not last:
        return None

    def go(tx: Graph) -> None:
        apply_changes(tx, floor, json.loads(last["inverse"]))
        tx.q("MATCH (p:Proposal {id:$id}) SET p.status = 'undone'", {"id": last["id"]})

    g.commit(go)
    return {"undone": last["id"]}
