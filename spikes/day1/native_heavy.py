"""Heavy-query timing on the native lib: nearest exit for every cell, in-memory and .rl."""
import time
from pathlib import Path

import relate

from native_test import build_grid

ALL = """MATCH (:Exit)-[:AT]->(t:Cell)
MATCH (s:Cell) WHERE s.walkable AND s <> t
MATCH p = shortestPath((s)-[:ADJACENT*]-(t))
RETURN count(p) AS paths, max(length(p)) AS maxHops"""

for target in (":memory:", str(Path(__file__).parent / "heavy.rl")):
    with relate.connect(target) as conn:
        build_grid(conn, 40, 30)
        t0 = time.perf_counter()
        cur = conn.cursor()
        cur.execute(ALL, {})
        rows = cur.fetchall()
        print(target, rows, f"{(time.perf_counter() - t0) * 1000:.1f} ms")
