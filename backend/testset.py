"""Load and run the test sets in tests/cases.

Part 1 (planted): each layout must fail exactly the rules in expect_fail.
A case whose rule number is still TBD is reported as "pending", not passed.
"""
from __future__ import annotations

import json
from pathlib import Path

from .engine import evaluate
from .graph.db import Graph
from .graph.seed import PACK_FILES, seed

ROOT = Path(__file__).resolve().parent.parent
PLANTED_DIR = ROOT / "tests" / "cases" / "planted"
REQUESTS_DIR = ROOT / "tests" / "cases" / "requests"


def load_cases(folder: Path) -> list[dict]:
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(folder.glob("*.json"))]


def fresh_graph(packs: list[str] | None = None) -> Graph:
    g = Graph(":memory:")
    seed(g, packs or [n for n, p in PACK_FILES.items() if p.exists()])
    return g


def rule_has_value(g: Graph, rule_id: str) -> bool:
    """False while the rule (or its separation pairs) has a TBD number."""
    r = g.one("MATCH (r:Rule {id:$id}) RETURN r.status AS status, r.kind AS kind", {"id": rule_id})
    if not r:
        return False
    if r["kind"] == "separation":
        n = g.one("""MATCH (:Rule {id:$id})-[:APPLIES_TO]->(t:ItemType)-[m:MUST_BE_FAR_FROM]->()
                     RETURN count(m) AS all, count(m.min_m) AS known""", {"id": rule_id})
        return bool(n and n["known"] > 0)
    return r["status"] != "TBD"


def run_planted_case(g: Graph, case: dict) -> dict:
    ev = evaluate(g, case["floor"], case["changes"])
    failed = sorted(ev["failed"])
    expected = sorted(case["expect_fail"])
    pending = [r for r in case.get("needs_rule_value", []) if not rule_has_value(g, r)]
    if not ev["valid"]:
        outcome = "invalid"
    elif pending:
        outcome = "pending"
    elif failed == expected:
        outcome = "ok"
    else:
        outcome = "wrong"
    return {"id": case["id"], "description": case["description"], "unsafe": bool(expected), "expected": expected,
            "failed": failed, "outcome": outcome, "pending_rules": pending, "error": ev.get("error"),
            "ms": ev["ms"], "details": {r["rule_id"]: r["detail"] for r in ev["results"] if r["status"] == "fail"}}
