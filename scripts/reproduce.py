"""Run the test sets and print the numbers for the README.

  Part 1  planted-bug layouts (no language model needed)
  Part 2  change requests through the full agent loop
  Part 3  model alone vs model plus checks, same requests

Parts 2 and 3 need a live model (META_API_KEY) or recorded runs in
backend/replay/cases/. With neither, they are reported as not run.

Usage: python scripts/reproduce.py [--part 1 2 3] [--mode auto|live|replay] [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.testset import PLANTED_DIR, fresh_graph, load_cases, run_planted_case  # noqa: E402


def part1(g) -> dict:
    rows = [run_planted_case(g, c) for c in load_cases(PLANTED_DIR)]
    unsafe = [r for r in rows if r["unsafe"]]
    safe = [r for r in rows if not r["unsafe"]]
    blocked = [r for r in unsafe if r["outcome"] == "ok"]
    pending = [r for r in unsafe if r["outcome"] == "pending"]
    missed = [r for r in unsafe if r["outcome"] not in ("ok", "pending")]
    wrongly = [r for r in safe if r["failed"]]
    print("\nPart 1: planted-bug layouts")
    print(f"  unsafe layouts blocked: {len(blocked)} of {len(unsafe)}, "
          f"safe layouts wrongly blocked: {len(wrongly)} of {len(safe)}")
    if pending:
        print(f"  not counted as blocked, rule number TBD: {len(pending)} "
              f"({', '.join(r['id'] for r in pending)})")
    for r in missed:
        print(f"  MISSED {r['id']}: expected {r['expected']}, got {r['failed']} {r['error'] or ''}")
    for r in wrongly:
        print(f"  WRONGLY BLOCKED {r['id']}: {r['failed']} {r['details']}")
    ms = [r["ms"] for r in rows]
    print(f"  check time per layout: mean {statistics.mean(ms):.0f} ms, max {max(ms):.0f} ms")
    return {"rows": rows, "blocked": len(blocked), "unsafe": len(unsafe), "pending": len(pending),
            "missed": len(missed), "wrongly_blocked": len(wrongly), "safe": len(safe),
            "mean_ms": statistics.mean(ms), "max_ms": max(ms)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--part", nargs="*", type=int, default=[1, 2, 3])
    ap.add_argument("--mode", default="auto", choices=["auto", "live", "replay"])
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    t0 = time.perf_counter()
    g = fresh_graph()
    out: dict = {}
    if 1 in a.part:
        out["part1"] = part1(g)
    if 2 in a.part or 3 in a.part:
        from backend.agent.evaluate_requests import run_parts  # noqa: E402
        out.update(run_parts(g, parts=[p for p in a.part if p in (2, 3)], mode=a.mode))
    g.close()
    print(f"\nreproduce.py finished in {time.perf_counter() - t0:.0f} s")
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
