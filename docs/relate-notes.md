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
  first choice. **Tested and works** (see native timings).
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


## Native timings (Python 3.14, relate-db 1.0.1, WSL2 Ubuntu 26.04, store on /mnt/c)

| Query | Time |
| --- | --- |
| Create 1,200 cells (UNWIND) | 19 ms |
| Adjacency via `UNWIND $pairs` | 89 ms |
| 40x30 shortestPath corner to exit (68 hops) | 0.8 to 1.4 ms |
| Shortest path from all 1,199 cells to the exit | 299 ms (memory), 303 ms (.rl) |
| Sum kw at all power-tree levels | 0.4 ms |
| Write, close, reopen `.rl`, read back | works; empty store file is 32 KB |
| Transaction: create 10 drafts, query (sees 10), `rollback()` | works; count unchanged, 0 drafts after reopen |

Native is about 4x to 6x faster than WASM. The `.rl` file on the Windows drive (`/mnt/c`) is fine.

## How we run it: WSL2

On this laptop the Python code runs inside WSL2 Ubuntu (see blocker below).
- Code stays in the Windows folder; WSL reads it via `/mnt/c/...`.
- venv lives in Linux home: `~/.venvs/floorproof` (python3.14-venv installed with `wsl -u root`).
- Run: `wsl -d Ubuntu --cd <repo path in /mnt/c> -- bash -lc '~/.venvs/floorproof/bin/python <script>'`

## Why WSL: native library blocked on Windows here

`import relate` fails:

```
ImportError: DLL load failed while importing _native: An Application Control policy has blocked this file.
```

Cause: **Windows Smart App Control is On** (`Get-MpComputerStatus` -> `SmartAppControlState: On`).
`relate\_native.pyd` has no Authenticode signature and no reputation yet (new release),
so Windows blocks it. Other native wheels (e.g. `pydantic_core`) load fine.
The `relate.exe` CLI and the Node native client are also unsigned, so they will be blocked too.
The WASM build runs (inside signed node.exe) but cannot open `.rl` and has no transactions.

Windows machines without Smart App Control load it fine. The README will tell
Windows users: if you see this error, use WSL2.

## Bug found: delete-after-create in one transaction panics (Relate 1.0.1)

Inside an explicit transaction (`autocommit = False`), deleting a node or a
relationship that was **created earlier in the same transaction** raises
`pyo3_runtime.PanicException: update counters are non-negative: TryFromIntError(())`.
The same statements in autocommit mode work. Deleting things that existed before
the transaction works. Repro: `spikes/day1/panic_probe.py`.

Workaround in FloorProof: `normalize_changes()` in `backend/graph/layout.py` merges
changes to the same item (add+move -> add, move+move -> move, add+remove -> nothing),
so a draft never deletes what it created.

## Windows update

Later on day 1 the native `_native.pyd` started loading on Windows too (Smart App
Control seems to allow it now). `scripts/py.ps1` uses native Windows Python when
`import relate` works there, and WSL2 otherwise.

## Day-1 checklist status

- [x] Install Relate and run one query (native in WSL2; WASM in Node on Windows)
- [x] Open a single-file store (.rl)
- [x] Write, close, reopen, read back
- [x] Path query on a small grid (shortestPath, ANY SHORTEST, var-length)
- [x] Sum query (kw per panel, and up the FED_BY tree)
- [x] Path query timing on 40x30
- [x] Transaction write, query, rollback, store unchanged
- [x] This file

Scripts: `spikes/day1/native_test.py`, `native_heavy.py`, `wasm_test.mjs`, `wasm_build_test.mjs`.

## Later findings (16 Nov 2026)

- **CLI on Windows:** Smart App Control blocks the unsigned `relate-windows-amd64.exe` ("An Application Control
  policy has blocked this file"), like `_native.pyd` on day 1. The Linux binary in WSL works. We checked the
  release ourselves: `SHA256SUMS.sig` verifies with `ssh-keygen -Y verify -n relate-release` against the key
  pinned in `install.sh`, and the binary matches its SHA-256 line.
- **MCP:** `relate serve --mcp stdio --database floorproof.rl --read-only` works on the `.rl` file written by the
  Windows Python client, from WSL (`/mnt/c/...`). Tools: `read_cypher`, `get_schema`. Results carry timings and
  notices with remedies (it flagged our unbounded `FED_BY*0..`).
- **Seeding speed:** `UNWIND $pairs AS p MATCH (a:Cell {floor:$f, x:p.ax, y:p.ay}), (b:Cell {...})` did not use the
  composite index `(floor, x, y)`: 26 s for 7,860 links. A one-property key index (`Cell.key = "floor:x:y"`) with
  `MATCH (a:Cell {key:p.a}) MATCH (b:Cell {key:p.b})` takes 1.4 s. Splitting into two MATCH clauses on the
  composite index was slower still (28 s).
- **Vector search:** `CREATE VECTOR INDEX ... WITH [p.floor, p.status]` plus
  `SEARCH p IN (VECTOR INDEX ... FOR vector($q, 256, FLOAT32) WHERE p.floor = $f LIMIT k) SCORE AS score` works from
  Python; a status change after indexing is seen by the filter.
- **WASM:** `init({ module_or_path: wasmUrl })` with Vite's `?url` import works. Loading 4,082 nodes and 15,722
  links with grouped `UNWIND ... CREATE` (label-specific `_k` index for the link MATCH) is quick enough to do on open.
  Envelope rows give nodes as `{kind:"node", id, labels, properties}`, links as `{kind:"relationship", start_node,
  end_node, type}` and paths as alternating arrays.
