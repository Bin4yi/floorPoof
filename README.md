# FloorProof

**The AI suggests, the graph proves.**

FloorProof plans factory and warehouse floor layouts. You change the floor by hand in a 3D view, or you type a
request and an AI agent proposes layouts. Every layout is checked by graph queries in Relate (fire exit reach,
exit distance, aisle width, power load at every level, line flow), and only proven layouts can be saved.

> **Planning aid only.** FloorProof is not a certified safety tool. It does not replace a fire officer, a
> licensed electrician or a certified engineer. The example floors are made up; the rule numbers come from the
> sources listed below, and some are still marked TBD.

**Model alone vs model plus checks, same 30 requests** (from `scripts/reproduce.py`): the model's first layout broke a rule (or was unusable) in **5 of 30** requests; with the graph checks in the loop, **29 of 30** final layouts were proven and did what was asked, and **1** was handed back to the user with the open problems. No rule-breaking layout was shown.

## Test numbers

Output of `.\scripts\py.ps1 scripts/reproduce.py --mode replay` (replays the recorded live run of `muse-spark-1.1`; the checks run again for real). Full output, including one line per request: [docs/reproduce-output.txt](docs/reproduce-output.txt).

```text
Part 1: planted-bug layouts
  unsafe layouts blocked: 18 of 20, safe layouts wrongly blocked: 0 of 10
  not counted as blocked, rule number TBD: 2 (u16_sep_press_by_racks, u17_sep_press_moved)
  check time per layout: mean 228 ms, max 338 ms

Part 2: change requests through the full loop
  requests run: 30 of 30 (model answers: replay)
  passed on the first round: 26, passed after retries: 3, never solved: 1
  average check time per layout: 187 ms over 81 layouts
  NEVER r15_factory "Add 5 pressing machines anywhere on the floor": handed back to the user with the open problems: FP-PANEL: sub panel SUB-N 26.8 kW > limit 24.0 kW; main breaker MAIN 53.6 kW > limit 49.6 kW.

Part 3: model alone against model plus checks (same requests)
  model alone: 5 of 30 first layouts broke a rule (or were unusable)
  BROKE r01_factory "Add 4 pressing machines to Line B": FP-PANEL
  BROKE r07_factory "Add 2 more fabric racks in the fabric store": FP-EXIT-REACH
  BROKE r15_factory "Add 5 pressing machines anywhere on the floor": FP-EXIT-REACH, FP-PANEL
  BROKE r21_warehouse "Add 2 pallet racks in the empty area east of the east forklift aisle": WH-EXIT-REACH
  BROKE r27_warehouse "Add 3 flammable liquid pallets to the hazmat staging area": WH-EXIT-REACH
  model plus checks: 29 of 30 final layouts proven by the graph checks, 29 of 30 proven and doing what was asked; the rest handed back to the user
  every layout shown by model plus checks passed the checks; unchecked, the model alone would have shown 5 rule-breaking layouts

```

What the numbers mean:
- Part 1 needs no model. The 2 separation layouts are not counted as blocked because that rule's distance is TBD.
- r15 asks for 5 pressing machines, but the power tree only has room for 4. The agent's layouts were rejected and the request was handed back, which is the correct result.
- Part 3 counts a layout as broken if it fails any check or is not usable. The model alone gets no feedback.

## How Relate is used, and why

Everything lives in one Relate graph: the floor grid, the items, the power tree, the production lines, the
rules, every proposal and every check result.

- **Storage mode: single file.** The store is `floorproof.rl`, committed in this repo, so you can open exactly
  what the app uses. The Python backend opens it in process with `relate-db` (`relate.connect("floorproof.rl")`).
- **Space questions are path queries.** The floor is a grid of `Cell` nodes. Walkable neighbours are linked by
  `ADJACENT`. When an item is placed, its cells lose their `ADJACENT` links, so "can this worker still reach an
  exit, and how far is it" is a `shortestPath` over `ADJACENT` from the item's `WORKS_AT` cell to an `Exit`.
- **Multi-hop checks.** Exit reach and exit distance (`shortestPath` over `ADJACENT*`), panel load
  (`POWERED_BY` then `FED_BY*0..` up the drop box, sub-panel, main breaker tree, summed at every level), and line
  flow (walk the `FEEDS*` chain and check it covers the line in order, moving forward).
- **Drafts never touch the accepted floor.** A draft is written inside a Relate transaction, all checks run on it,
  and the transaction is rolled back. Accept re-applies the changes in a transaction, re-runs the checks, and
  commits only if every check passes.
- **Rules are data.** A `RulePack` has `Rule` nodes (kind, numbers, source link). The engine reads the rules of
  the floor's pack and runs the check for each rule kind. The warehouse pack was added as data only
  (`backend/packs/warehouse.json`), with no new engine code. Floors drawn in the app become packs the same way.
- **Why Relate:** one embedded file, no server, openCypher with real path search, and transactions with
  rollback. That fits a planning tool you can hand to someone as a single file.

Notes from testing Relate on day 1, including timings and one bug we found, are in
[docs/relate-notes.md](docs/relate-notes.md).

## What connects to what

```
(Floor)-[:USES_PACK]->(RulePack)-[:HAS_RULE]->(Rule)-[:APPLIES_TO]->(ItemType)
(Cell)-[:NEIGHBOR]->(Cell)              static grid
(Cell)-[:ADJACENT]->(Cell)              walkable neighbours, kept in sync with items
(Cell)-[:IN_ZONE]->(Zone)               aisles, fabric store, staging ...
(Exit)-[:AT]->(Cell)   (PowerPanel)-[:AT]->(Cell)
(Item)-[:OCCUPIES]->(Cell)   (Item)-[:WORKS_AT]->(Cell)   (Item)-[:IS_A]->(ItemType)
(Item)-[:POWERED_BY]->(PowerPanel)-[:FED_BY]->(PowerPanel)-[:FED_BY]->(PowerPanel)
(Item)-[:IN_LINE {seq}]->(Line)   (Item)-[:FEEDS]->(Item)
(ItemType)-[:MUST_BE_FAR_FROM {min_m}]->(ItemType)
(Proposal)-[:PLACES]->(Item)   (Proposal)-[:HAS_RESULT]->(CheckResult)-[:FOR_RULE]->(Rule)
(CheckResult)-[:FAILED_AT]->(Cell)      the red cells and paths in the 3D view
```

Code: `backend/graph` (Relate wrapper, schema, seed, layout writer), `backend/checks` (one file per check),
`backend/engine.py` (draft, accept, undo), `backend/agent` (LangGraph loop, Meta model client, replay),
`backend/suggest.py` (best spots), `backend/graph/custom.py` (custom floors and items), `backend/api` (FastAPI),
`frontend` (React, TypeScript, React Three Fiber; item models are built from boxes and cylinders in code, no model files).

## Setup and run (Windows)

Needs Python 3.12 or newer and Node 18 or newer.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install relate-db fastapi "uvicorn[standard]" langgraph httpx pytest
.\scripts\run.ps1            # builds the frontend once, then serves http://localhost:8000
```

`scripts\py.ps1` runs Python for every script. It uses the Windows `.venv` when `import relate` works there.

**If Windows blocks Relate** with `ImportError: DLL load failed ... An Application Control policy has blocked
this file`, Smart App Control is blocking the unsigned Relate DLL. Use WSL2 instead (no other changes needed;
`py.ps1` switches to WSL automatically):

```powershell
wsl -d Ubuntu -u root -- apt-get install -y python3-venv python3-pip
wsl -d Ubuntu -- bash -lc "python3 -m venv ~/.venvs/floorproof && ~/.venvs/floorproof/bin/pip install relate-db fastapi 'uvicorn[standard]' langgraph httpx pytest"
.\scripts\run.ps1
```

Other commands:

```powershell
.\scripts\py.ps1 scripts/seed.py          # rebuild floorproof.rl from backend/packs/*.json
.\scripts\py.ps1 -m pytest -q tests       # unit tests and the 30 planted-bug layouts
.\scripts\py.ps1 scripts/reproduce.py     # prints the test numbers below
```

## Replay mode (no API key)

The agent uses Meta's Model API (Muse Spark, `muse-spark-1.1`). To run it live, put your key in `.env`:

```
META_API_KEY=...
```

With no key, FloorProof runs in **replay mode**: every model answer from a recorded run is stored in
`backend/replay/`, and the app plays those answers back. The graph checks still run for real on every replayed
layout. Force replay even with a key:

```powershell
.\scripts\run.ps1 -Replay
.\scripts\py.ps1 scripts/reproduce.py --mode replay
```

## Your own items, your own floors, best spots

- **Describe a new item.** In Manual edit, click **+ Describe a new item** and type something like
  "Industrial dryer, 2 x 1.5 m, 1.8 m tall, 6 kW". With a key, Muse Spark fills in the form; with no key, a simple
  text parser does. Values that were not in your text are marked *guess*. You check every value, then save. The item
  becomes an `ItemType` node in the floor's pack and is checked like any other item. Saved in
  `backend/packs/custom/types.json`.
- **Build a whole floor.** Click **+ New floor**. Set the size, then draw exits, aisles, forklift aisles, areas,
  main breakers, sub-panels and drop boxes, and add production lines. Saving builds the floor graph and runs every
  check. A custom floor gets the same sourced rules as the demo floors (no overlap, exit reach, exit distance from
  IBC Table 1017.2 F-1, aisle width 0.711 m, panel load 80%, line flow). You can type your own exit distance limit
  with its source. The forklift aisle width stays TBD unless you give one. Saved in `backend/packs/custom/<id>.json`.
  **Edit floor** re-draws it and keeps the items.
- **Best spots and paths.** Pick an item type, or select an item, and the floor shows a heat map of where it fits.
  The map is a quick scan of the draft graph state. The numbered beacons are the best picks, and each one was
  proven by the full graph checks in a rolled-back draft. Click a beacon or press its number to use it. The green
  ribbon is the walk from that spot to the nearest exit. Exit paths come from the same `shortestPath` query that
  the exit checks use. The scan only suggests; pass or fail still comes from the checks.
- **Worker efficiency.** Besides the rule checks, every floor and every draft is measured on the graph
  (`backend/metrics.py`). These are measurements, not rules, so nothing passes or fails on them. They cover:
  - the walk to the nearest exit;
  - the walk between consecutive line stations (`FEEDS`, then `shortestPath`);
  - the walk along material flows (`(ItemType)-[:FLOWS_TO]->(ItemType)`, data in the pack, e.g. fabric rack to
    cutting table);
  - crowding: how many operators' exit routes share the busiest cell;
  - elbow room: free cells within two `NEIGHBOR` hops of each work position;
  - power headroom and open floor area.

  Each aspect also has a 0-100 index, with its formula shown in the app. The Efficiency tab shows a radar of the
  draft against the saved floor, a live trend after each change, metric tiles showing the change from the saved
  floor, and bar charts and a histogram. Each chart can show its routes or hot spots on the 3D floor.
- Deep links for demos: `/?floor=warehouse&place=pallet_rack&rot=90`, `/?select=R1&paths=1&layers=line,flow,crowd`,
  `/?build=1`, `/?agent=Add 4 pressing machines to Line B`.

In the app, the **Ask the agent** tab lists the recorded requests you can run without a key. **Manual edit**
needs no model at all: pick an item, click the floor, drag to move, R to rotate, Delete to remove. Every change
re-runs all checks on the draft and shows the red cells, the power load bars and the failed rules with their
reasons. Nothing is saved until Accept, and Accept only works when every check passes. **Fix it** asks the agent
for the smallest change that makes a failing draft pass (needs a key, or a recorded run).

## Open floorproof.rl yourself

With the Relate CLI ([install](https://relatedb.ai/docs/get-started/install/)):

```powershell
relate query --database .\floorproof.rl --read-only "MATCH (i:Item {floor:'factory'})-[:POWERED_BY]->(:PowerPanel)-[:FED_BY*0..]->(p:PowerPanel) MATCH (i)-[:IS_A]->(t:ItemType) RETURN p.name AS unit, p.kind AS kind, sum(t.kw) AS kw, p.capacity_kw AS rating ORDER BY unit"
```

Or from Python:

```python
import relate
with relate.connect("floorproof.rl", read_only=True) as conn:
    cur = conn.cursor()
    cur.execute("""MATCH (s:Cell {floor:'factory', x:94, y:3}), (:Exit {floor:'factory'})-[:AT]->(t:Cell)
                   MATCH p = shortestPath((s)-[:ADJACENT*]->(t)) RETURN length(p) * 0.5 AS walk_m""", {})
    print(cur.fetchall())
```

Stop the app first: a `.rl` file allows one writing process at a time.

## Rules and their sources

| Rule | Number used | Source |
| --- | --- | --- |
| Exit reach (both packs) | no number: every work position must reach an exit; exits not blocked | [OSHA 29 CFR 1910.37(a)(3)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.37): "Exit routes must be free and unobstructed." |
| Exit distance (factory) | 60.96 m (200 ft) without sprinklers, 76.2 m (250 ft) with | [IBC Table 1017.2, occupancy F-1, as adopted in WAC 51-54A-1017](https://lawfilesext.leg.wa.gov/Law/WACArchive/2024/htm/WAC%20%2051%20-%2054A%20CHAPTER/WAC%20%2051%20-%2054A-1017.htm) |
| Aisle width (factory main aisles, warehouse walking aisle) | 0.711 m (28 in) clear | [OSHA 29 CFR 1910.36(g)(2)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.36): "An exit access must be at least 28 inches (71.1 cm) wide at all points." |
| Panel load (factory) | continuous load at most 80% of rating (rating at least 125% of continuous load), at every level | NEC 210.20(A), quoted in [IAEI Magazine](https://iaeimagazine.org/2016/may2016/100-vs-80-choosing-the-right-ocpd-solution/). All machines treated as continuous (3 h or more). |
| Line flow (factory) | no number: each step sits further along the line than the last | Process rule. Maximum distance between steps: **TBD** |
| Separation, pressing machine to fabric rack (factory) | **TBD** | no source yet |
| Forklift aisle width (warehouse) | **TBD** | [OSHA 29 CFR 1910.176(a)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.176) asks for "sufficient safe clearances" but gives no number |
| Separation, oxidizer to flammable liquid pallets (warehouse) | **TBD** | no source yet |
| No overlap (both packs) | no number | physical constraint |

A rule with a TBD number is shown as "not checked" in the app and is never counted as a pass in the test
numbers. To fill one in, edit the pack JSON and run `scripts/seed.py`.

Limits of the model: walking paths move in grid steps of 0.5 m, so measured walks are never shorter than real
ones; path cells are 0.5 m wide (aisle width is checked separately on the marked aisles); power is in kW, not
amps; the codes cited are US codes (OSHA, IBC, NEC) and local codes may differ.
