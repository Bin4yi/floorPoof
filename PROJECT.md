# FloorProof — Project Doc

Nov 15, 2026 · @Binula

## Overview

FloorProof plans floor layouts with an AI agent, and proves every layout with graph checks before the user sees it.

**The problem.** A small change on a factory floor can cause hidden trouble. Adding four machines can block a fire exit path, overload a power panel, or break the work flow of a line. Today people check this by hand, and they miss things.

**The solution.** The user changes the floor in two ways: by hand in the 3D view (add, drag, remove items), or by typing a request so the agent proposes layouts. Graph queries in Relate check each layout against the rules. Failed layouts go back to the agent with the reason. Only proven layouts are shown, in a 3D view.

**One engine, many floors.** The rules are stored as data in the graph, in "rule packs". This project ships two packs:

- Garment factory: the full pack, with all rules and the test set
- Warehouse: a small pack with 3 or 4 rules, to prove the same engine works on another floor type

**One-line pitch.** The AI suggests, the graph proves.

**What it is not.** It is a planning aid. It does not replace a fire officer or a certified engineer. The README must say this.

## Hackathon rules

The entry is for the [Relate by Neo4j Hackathon](https://relate.devpost.com/). The deadline is December 11, 2026 at 6:00pm PST, which is December 12 at 7:30am in Sri Lanka. Plan to submit on the evening of December 11, Sri Lanka time.

**Must submit**

- [ ] Project description: the use case and what connects to what
- [ ] Public GitHub repo with the topic `relate`
- [ ] README: setup, use, how Relate is used and why, and the storage mode chosen
- [ ] A saved Relate store that judges can open (single file, `floorproof.rl`)
- [ ] Working code with Relate running
- [ ] Demo video, 1 to 2 minutes

**Judging**

| Criterion | Points | How FloorProof earns them |
| --- | --- | --- |
| Relate and connected context | 30 | Floor, items, rules and results all live in one graph. Every check is a graph query. |
| Functionality and completeness | 25 | Full loop works: propose, check, reject or pass, show in 3D. |
| Usefulness | 20 | Real rules from real codes, with source links. |
| Documentation and reproducibility | 15 | One command to run. Replay mode needs no API key. |
| Creativity | 10 | Rules as graph data, so a new floor type needs no new code. |

All eight judges work at Neo4j. Source: [hackathon page](https://relate.devpost.com/).

## How it works

The agent never has the last word. Plain graph checks decide pass or fail.

&#91;embedded content: propose and check loop · 4 steps, 1 decision\]

A failed layout loops back to the agent with the reason. After 3 failed rounds, the open problems go back to the user.

**What the user sees**

1. The user types a change, for example "Add 4 pressing machines to Line B".
2. The agent proposes up to 3 layouts.
3. Each layout is written to the graph as a proposal.
4. All checks run on each proposal.
5. A failed proposal goes back to the agent with the rule that failed and the place it failed. The agent tries again, up to 3 rounds.
6. The screen shows every proposal: rejected ones with the reason and the red path, and passed ones in green.
7. The user accepts one. The 3D floor updates and the store file is saved.

**Manual mode: change the floor by hand**

1. Pick an item from the side list and drop it on the floor. It snaps to the grid.
2. Drag any item to move it, or select it and remove it.
3. After every drop, the same checks run on the draft layout.
4. The consequences show at once: the blocked exit path in red, the load bar of each power unit, the broken line flow, and the list of failed rules with reasons.
5. Nothing is saved until the user presses Accept. Undo goes back one step.
6. If the draft fails, the user can press "Fix it" and the agent proposes the smallest change that passes.

Manual mode needs no language model, so the whole demo also works with no API key. A manual change is stored as a `Proposal` in the graph, the same as an agent proposal.

**Two rules for the build**

- The language model only proposes positions. It never decides if a layout is safe.
- Every result shown to the user comes from a check, with the rule and its source link.

## Graph schema

One graph holds the floor, the items, the rules and the check results. The floor is a grid of cells, so "can a person walk from here to an exit" becomes a path question.

**Nodes**

| Label | Key properties | Meaning |
| --- | --- | --- |
| `Floor` | name, width\_m, depth\_m, cell\_m | One floor plan |
| `Cell` | x, y, walkable | One grid square of the floor |
| `Exit` | name | A fire exit |
| `Item` | id, x, y, w, d, h, rotation | A machine, table, rack or desk |
| `ItemType` | name, kw, heat, pack | Kind of item, with power use |
| `PowerPanel` | name, kind, capacity\_kw | Electrical unit. The kind is drop box, sub-panel or main breaker. |
| `Line` | name | A production line |
| `Zone` | name, kind | Area such as fabric store or cold zone |
| `RulePack` | name | Factory or warehouse |
| `Rule` | id, kind, params, source\_url | One rule, with a link to its real source |
| `Proposal` | id, round, status | One layout proposed by the agent |
| `CheckResult` | passed, detail, ms | Result of one rule on one proposal |

**Links**

| Link | Meaning |
| --- | --- |
| `(Cell)-[:ADJACENT]->(Cell)` | Walkable neighbours |
| `(Exit)-[:AT]->(Cell)` | Where the exit is |
| `(Item)-[:OCCUPIES]->(Cell)` | Cells the item covers |
| `(Item)-[:IS_A]->(ItemType)` | Kind of item |
| `(Item)-[:POWERED_BY]->(PowerPanel)` | Which drop box the item plugs into |
| `(Item)-[:IN_LINE {seq}]->(Line)` | Place in the line order |
| `(Item)-[:FEEDS]->(Item)` | Work flows from one item to the next |
| `(Item)-[:IN_ZONE]->(Zone)` | Area the item sits in |
| `(ItemType)-[:MUST_BE_FAR_FROM {min_m}]->(ItemType)` | Separation rule |
| `(RulePack)-[:HAS_RULE]->(Rule)` | Rules in a pack |
| `(Rule)-[:APPLIES_TO]->(ItemType)` | What a rule covers |
| `(Proposal)-[:PLACES]->(Item)` | Items added or moved |
| `(Proposal)-[:HAS_RESULT]->(CheckResult)` | Check results |
| `(CheckResult)-[:FOR_RULE]->(Rule)` | Which rule |
| `(CheckResult)-[:FAILED_AT]->(Cell)` | Where it failed, for the red path |

**Power tree.** Power units link upward with `(PowerPanel)-[:FED_BY]->(PowerPanel)`: drop box, then sub-panel, then main breaker. A new machine must fit at every level above it.

**Why rules are data.** A new floor type is a new `RulePack` with its `Rule` and `ItemType` nodes. No new code. This is the main "connected context" point for the judges.

**Open point.** Check in the Relate docs which path features of Cypher are supported (shortest path, variable-length paths). If something is missing, walk the `ADJACENT` links step by step in code, but keep all data in the graph.

## Checks

Each check is plain code plus a graph query. It gives pass or fail, a short reason, and the cells where it failed.

**Garment factory pack (full)**

| Check | Question it answers | Graph work |
| --- | --- | --- |
| No overlap | Do two items sit on the same cell? | Cells with more than one `OCCUPIES` link |
| Exit reach | Can every work position still walk to an exit? | Path over `ADJACENT` walkable cells to an `Exit` |
| Exit distance | Is the walk to the nearest exit short enough? | Shortest path length times cell size, against the rule limit |
| Aisle width | Are the main aisles still wide enough? | Free cells across each aisle, against the rule limit |
| Panel load | Is any drop box, sub-panel or main breaker over its limit? | Sum of `kw` over `POWERED_BY` links, then up every FED\_BY level of the power tree |
| Separation | Are hot machines far enough from fabric storage? | Distance between items joined by `MUST_BE_FAR_FROM` |
| Line flow | Does work still move forward along the line? | `FEEDS` order against `IN_LINE` seq, and distance between steps |

**Keep the checks graph-shaped.** The judges are Neo4j engineers. If the checks are only rectangle math in Python, Relate looks like a plain table. So the floor is a grid of `Cell` nodes, and space questions become path queries. At least four checks must need a multi-hop path: exit reach, exit distance, the power tree, and line flow.

**Scratch testing.** A draft layout is tested without touching the accepted floor. First choice: write the draft inside a Relate transaction, run the checks, and roll back if it fails. This needs a day-1 test. Fallback: keep the draft as `Proposal` nodes and links, and check those.

**Warehouse pack (small)**

| Check | Question it answers |
| --- | --- |
| Exit reach | Same check as the factory, reused with no change |
| Aisle width | Are aisles wide enough for a forklift? |
| Separation | Are goods that must stay apart kept apart? |

**Rule numbers must be real.** Every limit (exit distance, aisle width, panel margin, separation distance) needs a real source, with the link saved in `Rule.source_url`. Until a number has a source, mark it `TBD` in the rule and in the README. Do not invent numbers.

- [ ] Find a real fire code or factory safety standard for exit distance and aisle width
- [ ] Find a real source for the power panel load limit
- [ ] Find a real source for warehouse aisle width

## Tech stack and repo layout

Python runs the graph, the checks and the agent. A React page shows the 3D floor.

| Part | Choice | Note |
| --- | --- | --- |
| Graph store | Relate, single-file mode (`floorproof.rl`) | Single file so judges can open it and it can be committed to the repo |
| Backend | Python, FastAPI | Uses the Relate Python library, in process |
| Agent | LangGraph | Nodes: propose, check, retry, finish |
| Language model | Any, set by an environment variable | Only proposes positions |
| Frontend | React, TypeScript, React Three Fiber | Floor and items drawn as simple boxes from graph data. No 3D model files. |
| Tests | pytest | Checks and the test set |
| Replay | Saved run in JSON | Demo works with no API key |

**Known facts about Relate** (from [relatedb.ai](https://relatedb.ai/), read on 15 Nov 2026)

- Data can live in memory, in a directory, or in one file. Single files use the `.rl` extension.
- It uses openCypher.
- The command-line install is a bash script. On Windows, check the docs for the Windows way, or use the Python library only.
- Agent skill: `relate skill install --agent claude-code`
- Docs: [relatedb.ai/docs](https://relatedb.ai/docs/) · Cookbook: [relatedb.ai/cookbook](https://relatedb.ai/cookbook/) · Code: [github.com/relatedb/relate](https://github.com/relatedb/relate)
- Not confirmed yet: the Python package name, the browser (WebAssembly) package name, and which path queries are supported.

**Repo layout**

```text
floorproof/
  README.md
  PROJECT.md              this doc
  floorproof.rl           the saved Relate store (committed)
  backend/
    graph/                schema, seed, Relate wrapper
    checks/               one file per check
    packs/                factory.json, warehouse.json (rules as data)
    agent/                LangGraph loop
    api/                  FastAPI routes
    replay/               saved runs for the no-key demo
  frontend/
    src/                  3D floor, proposals panel, graph path panel
  tests/
    cases/                the 30 test cases (JSON)
    test_checks.py
    test_cases.py
  scripts/
    seed.py               builds floorproof.rl from the packs
    reproduce.py          runs the test set and prints the numbers
  docs/
    relate-notes.md       what was learned about Relate on day 1
```

**Stretch goal, only if time allows.** A read-only viewer that loads `floorproof.rl` in the browser with Relate's WebAssembly build, with no server.

## Test set and numbers

The README reports real numbers from `scripts/reproduce.py`. No number is typed by hand.

**Part 1: planted-bug layouts (tests the checks)**

- 20 layouts, each breaking exactly one rule on purpose, plus 10 safe layouts
- Target line for the README: "unsafe layouts blocked: X of 20, safe layouts wrongly blocked: Y of 10"
- Needs no language model, so anyone can run it

**Part 2: change requests (tests the full loop)**

- 30 requests in plain words: 20 factory, 10 warehouse
- Each case file holds the start layout, the request, and what a correct answer must satisfy
- Numbers to report: passed on the first round, passed after retries, never solved, average check time in milliseconds

**Part 3: model alone against model plus checks**

- Run the same 30 requests twice: once taking the model's first layout with no checks, once with the full loop
- Report how many first layouts broke a rule, and how many final layouts are proven
- This one line goes at the top of the README. Every number in it must come from a real run.

**Honesty rules**

- Report the failures too, with one line on why each failed
- If the agent never solves a case, show it as "handed back to the user with the open problems"
- Never change a test case to make it pass

## Demo script

The video shows the real product working, start to end, in about 90 seconds. No promo style.

| Time | On screen | Words |
| --- | --- | --- |
| 0:00 to 0:10 | 3D garment factory floor | "One change on a factory floor can block a fire exit. FloorProof proves a layout before you accept it." |
| 0:10 to 0:30 | Drag a pressing machine into an aisle. The exit path turns red and the sub-panel bar goes over its limit. | "Move anything by hand. The graph shows the consequences at once." |
| 0:30 to 0:40 | Press Undo, then type: "Add 4 pressing machines to Line B" | "Or ask the agent." |
| 0:40 to 1:00 | Attempts panel: attempt 1 rejected (exit path blocked), attempt 2 rejected (sub-panel over limit), attempt 3 proven. Click attempt 1 to see its red path. | "Graph checks reject two layouts. Here is the rule and the exact path." |
| 1:00 to 1:10 | Click Accept. Floor updates. | "Only the proven layout is saved." |
| 1:10 to 1:20 | Switch pack to Warehouse. Drag one pallet. | "Same engine, new rules. The rules are data in the graph." |
| 1:20 to 1:30 | Open `floorproof.rl`, run one Cypher query, then show the `reproduce.py` output | "Everything lives in one Relate file. Here are the test numbers." |

Record with a typed script and on-screen captions, so the voice track can be short.

## Schedule

The graph and checks come first, the 3D view comes third. If time runs out, the part that scores most is already done.

| Dates | Goal | Done when |
| --- | --- | --- |
| Nov 16 to 22 | Relate day-1 checks, schema, seed script, all factory checks, Part 1 tests | `reproduce.py` prints the planted-bug numbers from the terminal |
| Nov 23 to 29 | Agent loop, API, replay mode, Part 2 cases | A typed request returns checked proposals through the API |
| Nov 30 to Dec 6 | 3D floor, drag to add and move items, live consequences, attempts panel, red path view, accept and undo | Full loop works in the browser |
| Dec 7 to 9 | Warehouse pack, README, real rule sources filled in | A fresh clone runs with one command |
| Dec 10 | Record the demo video | Video under 2 minutes, shows the full working loop |
| Dec 11 | Submit, add the `relate` topic to the repo | Submitted by evening, Sri Lanka time |

Other deadlines in the same weeks: StitchLock on Dec 22 and Ratakata on Dec 31.

## Risks and day-1 checks

Relate launched on November 11, 2026, so some details are not confirmed. Test these first, before any other code.

**Day-1 checks**

- [ ] Install Relate on Windows and run one query
- [ ] Find the Python package and open a single-file store (`.rl`)
- [ ] Write data, close, reopen, and read it back
- [ ] Test a path query on a small grid (variable-length path or shortest path)
- [ ] Test a sum query (total `kw` per panel)
- [ ] Time a path query on a 40 by 30 grid
- [ ] Write what was learned in `docs/relate-notes.md`

* [ ] Test a transaction: write a draft, run a query, roll back, and confirm the store is unchanged

**Risks**

| Risk | What to do |
| --- | --- |
| A needed Cypher path feature is missing | Walk the links in code, keep the data in the graph |
| Rule numbers have no real source | Mark `TBD`, say so in the README, never invent |
| The agent proposes bad layouts again and again | Give it the free cells and the failed rule each round. After 3 rounds, hand back to the user. |
| 3D view takes too long | Fall back to a flat 2D grid. The checks do not depend on 3D. |
| The floor data is made up | Say so clearly. The checks are objective, and the rules are real. |
| Factory layout tools already exist | State the difference: agent proposes, graph proves, one offline file |
| Too many projects at once | Keep to two rule packs. No extra features. |

## Claude Code prompt

Save this doc as `PROJECT.md` in an empty repo folder, then paste the prompt below into Claude Code.

```text
You are building FloorProof for the Relate by Neo4j hackathon.
Read PROJECT.md in this folder fully before you do anything. It is the
source of truth for scope, graph schema, checks, tests and schedule.

MY SETUP
- I work on a Windows laptop. Give Windows-compatible commands
  (PowerShell). Do not assume bash, WSL or Docker unless I say so.
- Reply to me in simple English. Short sentences.

GIT RULES (strict)
- Do NOT add Claude as an author, co-author or contributor anywhere.
- No "Co-Authored-By: Claude" line in any commit message.
- No "Generated with Claude Code" line in commits, PRs or the README.
- No Claude session links, no AI emoji lines, no AI tool credit.
- Commits use only my own git user.name and user.email.
- Also turn off attribution in the Claude Code settings for this repo.
  Check the current Claude Code docs for the right setting name, set
  it in .claude/settings.json, and tell me what you set.
- Before every commit, show me the commit message. After the first
  commit, run "git log -1 --format=%B%n%an%n%ae" and confirm it is clean.
- Small commits with plain messages, for example
  "Add exit reach check".

STEP 0: LEARN RELATE FIRST (no project code yet)
Relate is new (released November 2026). Do not guess its API.
1. Read https://relatedb.ai/docs/ and https://relatedb.ai/cookbook/
   and the repo https://github.com/relatedb/relate
2. Install the Relate Python library on Windows.
3. Do every item in "Day-1 checks" in PROJECT.md with tiny test
   scripts.
4. Write what you learned in docs/relate-notes.md: package names,
   how to open a single-file .rl store, which Cypher path features
   work, and query timings.
5. STOP and report to me. If anything in PROJECT.md is not possible
   with Relate, say so and suggest the smallest change.

BUILD ORDER
Phase 1. Graph core: schema, Relate wrapper, seed script that builds
  floorproof.rl for the garment factory from packs/factory.json.
Phase 2. Checks: one file per check, as listed in PROJECT.md. Then
  the 30 planted-bug layouts and scripts/reproduce.py. Model the
  power tree (drop box, sub-panel, main breaker) and check load at
  every level. All tests
  must pass before Phase 3.
Phase 3. Agent loop in LangGraph (propose, check, retry up to 3
  rounds, finish) and the FastAPI routes. Add replay mode that
  works with no API key.
Phase 4. Frontend: React, TypeScript, React Three Fiber. Draw the
  floor and items as simple boxes from graph data. Proposals panel
  with pass or fail, the reason, and the failed cells in red.
  Accept and Undo buttons.
  Manual edit mode: pick an item from a side list and drop it on
  the floor, drag to move, select to remove. Items snap to the grid.
  After every drop, run the same checks on the draft and show the
  consequences live: red exit path, load bar for each power unit,
  broken line flow, failed rules with reasons. Nothing is saved
  until Accept. A "Fix it" button asks the agent for the smallest
  change that passes. Manual mode must work with no API key.
  Attempts panel: list every agent attempt with pass or fail, the
  rule, the check time, and a click to view that attempt in 3D.
Phase 5. Warehouse pack (rules as data only, no new engine code),
  README, final test numbers.

HARD RULES
- The language model only proposes item positions. Pass or fail is
  always decided by the checks. Never let the model judge safety.
- Rules are data in the graph (RulePack, Rule nodes), not if-statements
  spread through the code.
- Never invent rule numbers (exit distance, aisle width, panel
  limits). If a number has no real source, set it to TBD, list it
  for me, and I will supply the source.
- Never write test results or benchmark numbers by hand. The README
  numbers must come from scripts/reproduce.py output.
- Never edit a test case just to make it pass. Tell me instead.
- Keep the checks graph-shaped. Space questions are path queries
  over Cell nodes in Relate, not rectangle math in Python. At least
  four checks must use multi-hop paths.
- Test a draft layout without changing the accepted floor: use a
  Relate transaction with rollback if it works, else Proposal nodes.
- Add the baseline run: model alone against model plus checks, on
  the same 30 requests.
- No 3D model files, no Blender, no CAD parsers. Boxes only.
- Keep floorproof.rl committed in the repo so judges can open it.
- Ask me before adding any large dependency or any paid service.
- If you are blocked for more than 2 tries on the same error, stop
  and tell me what you tried.

README MUST HAVE
- What FloorProof does, in 3 lines
- How Relate is used and why, and the storage mode (single file)
- What connects to what (the schema, short)
- Setup and run steps for Windows, one command where possible
- How to run replay mode with no API key
- How to open floorproof.rl and one example query
- Test numbers from reproduce.py, including failures
- Sources for every rule
- A clear note: planning aid only, not a certified safety tool

```

**Before the first commit.** Check the git log yourself once. If a Claude line still shows, the setting was not applied.
