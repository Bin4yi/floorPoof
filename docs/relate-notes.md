# Relate notes (day 1, 15 Nov 2026)

What we learned about Relate before writing project code.
Sources: relatedb.ai/docs (Python API, patterns, transactions, WASM API, install),
github.com/relatedb/relate README. Engine version seen: **Relate 1.0.1**
(`CALL dbms.components()` returns Cypher `5` and `25`).

## Packages

| Use | Package | Import / entry |
| --- | --- | --- |
| Python (native, in process) | `pip install relate-db` | `import relate` |
| Browser / WASM | `npm install @relate/relate-wasm` | `init`, `initSync`, `RelateDb` |
| Node (native) | separate client, loads `librelate_ffi` native lib | see docs/get-started/node |
| CLI | PowerShell block on docs/get-started/install (Windows tab) | `relate.exe` in `%LOCALAPPDATA%\Programs\relate` |

The Python wheel for Windows exists: `relate_db-1.0.1-cp39-abi3-win_amd64.whl`.

## Open a single-file store (Python)

```python
import relate
with relate.connect("floorproof.rl") as conn:   # path ending in .rl = single file
    cur = conn.cursor()
    cur.execute("MATCH (c:Cell) RETURN count(c) AS n", {})
    print(cur.fetchall())                        # rows are dicts
```

- `relate.connect(":memory:")`, a directory path, or a `.rl` path.
- `read_only=True` for a read-only open. Only **one writing open** per file store, across all processes.
- Parameters: dict, `$name` in the query. All named params must be present.
- `close()` (or leaving `with`) rolls back any open transaction, then checkpoints.
- A connection belongs to the thread that opened it (`WrongThread` error otherwise).
  FastAPI note: keep all Relate calls on one worker thread.

## Transactions (Python)

- `conn.autocommit = False` starts a transaction on the next `execute()`.
- `conn.commit()` returns a bookmark like `relate:<n>`; `conn.rollback()` discards.
- Writes are private until commit. No nested transactions. After a failed statement,
  you must roll back before anything else runs.
- Plan for drafts: write the draft, run checks, `rollback()`. This matches PROJECT.md's
  first choice. **Not yet run on this laptop** (see blocker below).
- The WASM build has **no transactions** and **cannot open `.rl` files** (only `:memory:` and `opfs://`).

## Cypher path features (tested in WASM build, same engine)

| Feature | Works | Note |
| --- | --- | --- |
| `shortestPath((s)-[:ADJACENT*]-(t))` in MATCH | yes | Returns 0 rows when no path. Fast. |
| `ANY SHORTEST (s)-[:ADJACENT]-+(t)` (GQL) | yes | Same speed as shortestPath |
| `EXISTS { (s)-[:ADJACENT*1..20]->(t) }` | yes | Fine on small grids |
| `[:FED_BY*0..]` var-length + `sum()` | yes | Power tree sum at every level in one query |
| `nodes(p)`, `length(p)`, list comprehension | yes | Gives the cell list for the red path |
| `OPTIONAL MATCH p = shortestPath(...)` + `p IS NULL` | yes | Clean "blocked" test |
| `UNWIND $list ... CREATE` | yes | Bulk create |
| Composite index `FOR (c:Cell) ON (c.x, c.y)` | yes | |
| `ANY (s)-[:ADJACENT]->{1,20}(t)` (no SHORTEST) | works but **273 s** on 5x5 | **Never use.** It enumerates paths. Always use a SHORTEST selector. |

Limits: explicit upper bounds above 500 hops fail (`TraversalDepthExceeded`);
unbounded `*` is exempt. `shortestPath` used as an *expression* caps at 32 hops,
so always use it inside `MATCH`. `CREATE`/`MERGE` accept only fixed-length patterns.

## Timings (WASM build in Node 24, this laptop)

| Query | Time |
| --- | --- |
| Create 1,200 cells (UNWIND) | 66 to 130 ms |
| Adjacency via cartesian `MATCH (a),(b) WHERE ...` | 7,092 ms (avoid) |
| Adjacency via `UNWIND $pairs` (pairs computed in code) | 289 ms |
| 40x30 shortestPath corner to exit (68 hops) | 5 to 6 ms |
| Nearest of 2 exits from one cell | 17 ms |
| Nearest exit for 50 work positions, wall on the floor | 149 ms |
| Shortest path from all 1,199 cells to the exit | 1,064 ms |
| Sum kw per panel, all power-tree levels | 3 ms |

Native Python should be faster than WASM, but this is not measured yet.

## BLOCKER: native library blocked on this laptop

`import relate` fails:

```
ImportError: DLL load failed while importing _native: An Application Control policy has blocked this file.
```

Cause: **Windows Smart App Control is On** (`Get-MpComputerStatus` -> `SmartAppControlState: On`).
`relate\_native.pyd` has no Authenticode signature and no reputation yet (new release),
so Windows blocks it. Other native wheels (e.g. `pydantic_core`) load fine.
The `relate.exe` CLI and the Node native client are also unsigned, so they will be blocked too.
The WASM build runs (inside signed node.exe) but cannot open `.rl` and has no transactions.

`spikes/day1/native_test.py` is ready and covers the remaining day-1 checks
(.rl write/close/reopen, transaction rollback, native timings). Run it once the DLL loads.

## Day-1 checklist status

- [ ] Install Relate on Windows and run one query: installed; native import blocked; WASM query OK
- [ ] Open a single-file store (.rl): API known, not run (blocked)
- [ ] Write, close, reopen, read back: script ready, not run (blocked)
- [x] Path query on a small grid (shortestPath, ANY SHORTEST, var-length)
- [x] Sum query (kw per panel, and up the FED_BY tree)
- [x] Path query timing on 40x30
- [ ] Transaction write, query, rollback, store unchanged: script ready, not run (blocked)
- [x] This file
