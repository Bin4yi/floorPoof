"""Relate features beyond plain queries: vector search memory, query traces with engine timings."""
from backend.checks import run_checks
from backend.engine import evaluate, record_proposal
from backend.memory import embed, ensure_index, recall
from backend.testset import fresh_graph


def cos(a, b):
    return sum(x * y for x, y in zip(a, b))


def test_request_vectors_rank_similar_requests_higher():
    q = embed("Add 4 pressing machines to Line B")
    assert cos(q, embed("put two pressing machines on line B")) > cos(q, embed("Move the fabric racks to the store"))
    assert abs(cos(q, q) - 1) < 1e-4


def test_recall_finds_proven_layouts_by_vector_search():
    g = fresh_graph()
    try:
        ensure_index(g)
        good = [{"op": "add", "type": "packing_table", "x": 60, "y": 30}]
        ev = evaluate(g, "factory", good)
        assert ev["passed"]
        pid = record_proposal(g, "factory", good, ev, source="agent", request="Add a packing table in finishing")
        bad = [{"op": "add", "type": "cutting_table", "x": 10, "y": 18}]
        record_proposal(g, "factory", bad, evaluate(g, "factory", bad), source="agent", request="Add a cutting table")
        hits = recall(g, "factory", "add one more packing table near finishing", min_score=0.1)
        assert [h["id"] for h in hits] == [pid]           # the rejected proposal is never offered
        assert hits[0]["changes"] == good
        assert recall(g, "warehouse", "add one more packing table", min_score=0.1) == []  # other floor
    finally:
        g.close()


def test_checks_carry_their_graph_queries_and_engine_timing(g):
    res = {r["rule_id"]: r for r in run_checks(g, "factory")}
    q = res["FP-PANEL"]["queries"]
    assert q and "FED_BY*0..8" in q[0]["cypher"] and q[0]["ms"] >= 0 and q[0]["params"] == {"f": "factory"}
    assert all("queries" in r for r in res.values())
