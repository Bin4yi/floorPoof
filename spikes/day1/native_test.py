"""Day-1 test of the native Relate Python library (relate-db).

Covers: open .rl file, write/close/reopen/read, path query, sum query,
40x30 timing, and transaction rollback.
Run: .venv\\Scripts\\python spikes\\day1\\native_test.py
"""
import os
import time
from pathlib import Path

import relate

HERE = Path(__file__).parent
STORE = HERE / "day1.rl"


def timed(conn, cypher, params=None):
    t0 = time.perf_counter()
    cur = conn.cursor()
    cur.execute(cypher, params or {})
    rows = cur.fetchall()
    return rows, (time.perf_counter() - t0) * 1000


def build_grid(conn, w, h, blocked=()):
    conn.cursor().execute("MATCH (n) DETACH DELETE n")
    blocked = set(blocked)
    cells = [{"x": x, "y": y, "walkable": (x, y) not in blocked}
             for x in range(w) for y in range(h)]
    pairs = []
    for c in cells:
        if not c["walkable"]:
            continue
        for dx, dy in ((1, 0), (0, 1)):
            nx, ny = c["x"] + dx, c["y"] + dy
            if nx < w and ny < h and (nx, ny) not in blocked:
                pairs.append({"ax": c["x"], "ay": c["y"], "bx": nx, "by": ny})
    _, t1 = timed(conn, "UNWIND $cells AS c CREATE (:Cell {x:c.x, y:c.y, walkable:c.walkable})", {"cells": cells})
    _, t2 = timed(conn, "CREATE INDEX cell_xy IF NOT EXISTS FOR (c:Cell) ON (c.x, c.y)")
    _, t3 = timed(conn, """UNWIND $pairs AS p
        MATCH (a:Cell {x:p.ax, y:p.ay}), (b:Cell {x:p.bx, y:p.by})
        CREATE (a)-[:ADJACENT]->(b), (b)-[:ADJACENT]->(a)""", {"pairs": pairs})
    timed(conn, "MATCH (c:Cell {x:$x, y:$y}) CREATE (:Exit {name:'E1'})-[:AT]->(c)", {"x": w - 1, "y": h - 1})
    return t1, t2, t3


SHORTEST = """MATCH (s:Cell {x:0, y:0}), (:Exit)-[:AT]->(t:Cell)
MATCH p = shortestPath((s)-[:ADJACENT*]-(t)) RETURN length(p) AS hops"""


def main():
    if STORE.exists():
        STORE.unlink()

    # 1. Open single-file store, write, close
    with relate.connect(str(STORE)) as conn:
        rows, ms = timed(conn, "CREATE (:Probe {msg:'hello'}) RETURN 1 AS ok")
        print(f"write: {rows} ({ms:.1f} ms)")
    print("file exists after close:", STORE.exists(), STORE.stat().st_size, "bytes")

    # 2. Reopen and read back
    with relate.connect(str(STORE)) as conn:
        rows, _ = timed(conn, "MATCH (p:Probe) RETURN p.msg AS msg")
        print("read back:", rows)

        # 3. Path query, small grid with a wall
        build_grid(conn, 5, 5, [(2, 0), (2, 1), (2, 2), (2, 3)])
        print("5x5 shortest:", timed(conn, SHORTEST))

        # 4. Sum per panel, all levels
        conn.cursor().execute("MATCH (n) DETACH DELETE n")
        conn.cursor().execute("""CREATE (m:PowerPanel {name:'MAIN', capacity_kw:100}),
          (s:PowerPanel {name:'SUB', capacity_kw:40})-[:FED_BY]->(m),
          (d:PowerPanel {name:'DB1', capacity_kw:10})-[:FED_BY]->(s),
          (t:ItemType {name:'press', kw:4.5}),
          (:Item {id:'i1'})-[:IS_A]->(t), (:Item {id:'i2'})-[:IS_A]->(t)
          WITH d MATCH (i:Item) CREATE (i)-[:POWERED_BY]->(d)""")
        print("sum all levels:", timed(conn, """
          MATCH (i:Item)-[:IS_A]->(t:ItemType), (i)-[:POWERED_BY]->(:PowerPanel)-[:FED_BY*0..]->(p)
          RETURN p.name AS panel, sum(t.kw) AS kw, p.capacity_kw AS cap ORDER BY panel"""))

        # 5. Timing 40 x 30
        t1, t2, t3 = build_grid(conn, 40, 30)
        print(f"40x30 build: cells {t1:.1f} ms, index {t2:.1f} ms, adjacency {t3:.1f} ms")
        for i in range(3):
            print(f"40x30 shortest run {i+1}:", timed(conn, SHORTEST))

    # 6. Transaction: write a draft, query, roll back, check unchanged
    with relate.connect(str(STORE)) as conn:
        before, _ = timed(conn, "MATCH (n) RETURN count(n) AS n")
        conn.autocommit = False
        cur = conn.cursor()
        cur.execute("UNWIND range(1, 10) AS i CREATE (:Draft {i:i})")
        cur.execute("MATCH (d:Draft) RETURN count(d) AS n")
        print("inside txn, drafts:", cur.fetchall())
        conn.rollback()
        conn.autocommit = True
        after, _ = timed(conn, "MATCH (n) RETURN count(n) AS n")
        drafts, _ = timed(conn, "MATCH (d:Draft) RETURN count(d) AS n")
        print("before:", before, "after:", after, "drafts after rollback:", drafts)

    # 7. Reopen after rollback, still unchanged on disk
    with relate.connect(str(STORE)) as conn:
        print("drafts after reopen:", timed(conn, "MATCH (d:Draft) RETURN count(d) AS n")[0])


if __name__ == "__main__":
    os.chdir(HERE)
    main()
