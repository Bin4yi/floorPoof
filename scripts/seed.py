"""Build floorproof.rl from the rule packs.

Usage: python scripts/seed.py [--out floorproof.rl] [--packs factory warehouse]
"""
import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.graph.db import Graph  # noqa: E402
from backend.graph.seed import PACK_FILES, seed  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "floorproof.rl"))
    ap.add_argument("--packs", nargs="*", default=[n for n, p in PACK_FILES.items() if p.exists()])
    a = ap.parse_args()
    out = Path(a.out)
    if out.exists():
        out.unlink()
    t0 = time.perf_counter()
    g = Graph(str(out))
    seed(g, a.packs)
    counts = g.q("MATCH (n) RETURN labels(n)[0] AS label, count(*) AS n ORDER BY label")
    rels = g.one("MATCH ()-[r]->() RETURN count(r) AS n")
    g.close()
    print(f"built {out.name} with packs {a.packs} in {(time.perf_counter() - t0) * 1000:.0f} ms")
    for r in counts:
        print(f"  {r['label']:<12} {r['n']}")
    print(f"  links        {rels['n']}")


if __name__ == "__main__":
    main()
