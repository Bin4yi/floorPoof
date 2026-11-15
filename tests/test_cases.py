"""Part 1: planted-bug layouts. Each must fail exactly its expected rules."""
import pytest

from backend.testset import PLANTED_DIR, load_cases, run_planted_case

CASES = load_cases(PLANTED_DIR)


def test_case_count():
    assert len(CASES) == 30
    assert sum(1 for c in CASES if c["expect_fail"]) == 20


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_planted(g, case):
    r = run_planted_case(g, case)
    if r["outcome"] == "pending":
        pytest.skip(f"rule value TBD: {', '.join(r['pending_rules'])}")
    assert r["outcome"] == "ok", f"expected {r['expected']}, got {r['failed']}: {r['details']}"
