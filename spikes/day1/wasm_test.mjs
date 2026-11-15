// Day-1 test of Relate Cypher features, using the WASM build in Node.
// Same engine as the native lib, but in-memory only (no .rl, no transactions).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, RelateDb } from '@relate/relate-wasm';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('@relate/relate-wasm/relate_bg.wasm');
initSync({ module: readFileSync(wasmPath) });

const db = new RelateDb();
function q(cypher, params = null) {
  const t0 = performance.now();
  const env = JSON.parse(db.execute(cypher, params ? JSON.stringify(params) : null));
  const ms = performance.now() - t0;
  if (env.error) throw new Error(JSON.stringify(env.error));
  return { env, ms };
}
function show(label, r) {
  console.log(`\n== ${label} (${r.ms.toFixed(1)} ms)`);
  console.log(JSON.stringify(r.env).slice(0, 600));
}

// Version
show('version', q('CALL dbms.components() YIELD name, versions RETURN name, versions'));

// Build a W x H grid with ADJACENT both ways, using UNWIND (one statement each).
function buildGrid(W, H, blocked = []) {
  db.reset();
  const cells = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++)
    cells.push({ x, y, walkable: !blocked.some(([bx, by]) => bx === x && by === y) });
  const a = q('UNWIND $cells AS c CREATE (:Cell {x: c.x, y: c.y, walkable: c.walkable})', { cells });
  const b = q('CREATE INDEX cell_xy IF NOT EXISTS FOR (c:Cell) ON (c.x, c.y)');
  const c = q(`MATCH (a:Cell), (b:Cell)
               WHERE a.walkable AND b.walkable
                 AND ((b.x = a.x + 1 AND b.y = a.y) OR (b.y = a.y + 1 AND b.x = a.x))
               CREATE (a)-[:ADJACENT]->(b), (b)-[:ADJACENT]->(a)`);
  q('MATCH (c:Cell {x: $x, y: $y}) CREATE (:Exit {name: "E1"})-[:AT]->(c)', { x: W - 1, y: H - 1 });
  return { create: a.ms, index: b.ms, adj: c.ms };
}

// --- Small grid 5x5 with a wall at x=2 except y=4
let t = buildGrid(5, 5, [[2, 0], [2, 1], [2, 2], [2, 3]]);
show('count adj 5x5', q('MATCH ()-[r:ADJACENT]->() RETURN count(r) AS n'));

show('shortestPath (MATCH form)', q(`
  MATCH (s:Cell {x:0, y:0}), (e:Exit)-[:AT]->(t:Cell)
  MATCH p = shortestPath((s)-[:ADJACENT*]-(t))
  RETURN length(p) AS hops, [n IN nodes(p) | [n.x, n.y]] AS cells`));

show('ANY SHORTEST (GQL form)', q(`
  MATCH (e:Exit)-[:AT]->(t:Cell)
  MATCH p = ANY SHORTEST (s:Cell {x:0, y:0})-[:ADJACENT]-+(t)
  RETURN length(p) AS hops`));

show('variable-length reach *1..20', q(`
  MATCH (s:Cell {x:0, y:0}), (e:Exit)-[:AT]->(t:Cell)
  RETURN EXISTS { MATCH (s)-[:ADJACENT*1..20]->(t) } AS reachable`));

show('quantified path {1,20}', q(`
  MATCH (e:Exit)-[:AT]->(t:Cell)
  MATCH p = ANY (s:Cell {x:0, y:0})-[:ADJACENT]->{1,20}(t)
  RETURN length(p) AS hops`));

// Unreachable: full wall
buildGrid(5, 5, [[2, 0], [2, 1], [2, 2], [2, 3], [2, 4]]);
show('shortestPath when blocked (expect 0 rows)', q(`
  MATCH (s:Cell {x:0, y:0}), (e:Exit)-[:AT]->(t:Cell)
  MATCH p = shortestPath((s)-[:ADJACENT*]-(t))
  RETURN length(p) AS hops`));

// --- Sum: total kw per panel, then up the FED_BY tree
db.reset();
q(`CREATE (m:PowerPanel {name:'MAIN', kind:'main', capacity_kw: 100}),
          (s:PowerPanel {name:'SUB-B', kind:'sub', capacity_kw: 40})-[:FED_BY]->(m),
          (d1:PowerPanel {name:'DB-1', kind:'drop', capacity_kw: 10})-[:FED_BY]->(s),
          (d2:PowerPanel {name:'DB-2', kind:'drop', capacity_kw: 10})-[:FED_BY]->(s),
          (t:ItemType {name:'press', kw: 4.5}),
          (i1:Item {id:'i1'})-[:IS_A]->(t), (i2:Item {id:'i2'})-[:IS_A]->(t), (i3:Item {id:'i3'})-[:IS_A]->(t),
          (i1)-[:POWERED_BY]->(d1), (i2)-[:POWERED_BY]->(d1), (i3)-[:POWERED_BY]->(d2)`);
show('sum kw per drop box', q(`
  MATCH (i:Item)-[:IS_A]->(t:ItemType), (i)-[:POWERED_BY]->(p:PowerPanel)
  RETURN p.name AS panel, sum(t.kw) AS kw, p.capacity_kw AS cap ORDER BY panel`));
show('sum kw at every level (multi-hop FED_BY*0..)', q(`
  MATCH (i:Item)-[:IS_A]->(t:ItemType), (i)-[:POWERED_BY]->(:PowerPanel)-[:FED_BY*0..]->(p:PowerPanel)
  RETURN p.name AS panel, p.kind AS kind, sum(t.kw) AS kw, p.capacity_kw AS cap ORDER BY panel`));

// --- Timing on 40 x 30
t = buildGrid(40, 30);
console.log(`\n== build 40x30: create ${t.create.toFixed(1)} ms, index ${t.index.toFixed(1)} ms, adjacency ${t.adj.toFixed(1)} ms`);
show('count adj 40x30', q('MATCH ()-[r:ADJACENT]->() RETURN count(r) AS n'));
for (let i = 0; i < 3; i++)
  show(`40x30 shortestPath corner->exit run ${i + 1}`, q(`
    MATCH (s:Cell {x:0, y:0}), (e:Exit)-[:AT]->(t:Cell)
    MATCH p = shortestPath((s)-[:ADJACENT*]-(t))
    RETURN length(p) AS hops`));
show('40x30 ANY SHORTEST', q(`
  MATCH (e:Exit)-[:AT]->(t:Cell)
  MATCH p = ANY SHORTEST (s:Cell {x:0, y:0})-[:ADJACENT]-+(t)
  RETURN length(p) AS hops`));
show('40x30 shortest from ALL cells to exit (batch)', q(`
  MATCH (e:Exit)-[:AT]->(t:Cell)
  MATCH (s:Cell) WHERE s.walkable AND s <> t
  MATCH p = shortestPath((s)-[:ADJACENT*]-(t))
  RETURN count(p) AS paths, max(length(p)) AS maxHops`));
