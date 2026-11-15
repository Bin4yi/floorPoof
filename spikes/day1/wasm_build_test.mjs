// Time building a 40x30 grid with adjacency pairs computed in JS, plus exit reach checks.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initSync, RelateDb } from '@relate/relate-wasm';

const require = createRequire(import.meta.url);
initSync({ module: readFileSync(require.resolve('@relate/relate-wasm/relate_bg.wasm')) });
const db = new RelateDb();
function q(c, p = null) {
  const t0 = performance.now();
  const env = JSON.parse(db.execute(c, p ? JSON.stringify(p) : null));
  if (env.error) throw new Error(JSON.stringify(env.error));
  return { rows: env.rows, ms: performance.now() - t0 };
}
const W = 40, H = 30;
const cells = [], pairs = [];
for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
  cells.push({ x, y });
  if (x + 1 < W) pairs.push({ ax: x, ay: y, bx: x + 1, by: y });
  if (y + 1 < H) pairs.push({ ax: x, ay: y, bx: x, by: y + 1 });
}
console.log('cells', q('UNWIND $cells AS c CREATE (:Cell {x:c.x, y:c.y, walkable:true})', { cells }).ms.toFixed(1), 'ms');
console.log('index', q('CREATE INDEX cell_xy IF NOT EXISTS FOR (c:Cell) ON (c.x, c.y)').ms.toFixed(1), 'ms');
console.log('adjacency (pairs)', q(`UNWIND $pairs AS p MATCH (a:Cell {x:p.ax, y:p.ay}), (b:Cell {x:p.bx, y:p.by})
  CREATE (a)-[:ADJACENT]->(b), (b)-[:ADJACENT]->(a)`, { pairs }).ms.toFixed(1), 'ms');
q('MATCH (c:Cell {x:39, y:29}) CREATE (:Exit {name:"E1"})-[:AT]->(c)');
q('MATCH (c:Cell {x:0, y:29}) CREATE (:Exit {name:"E2"})-[:AT]->(c)');

// Nearest exit from one cell, over 2 exits
let r = q(`MATCH (s:Cell {x:0, y:0}), (:Exit)-[:AT]->(t:Cell)
  MATCH p = shortestPath((s)-[:ADJACENT*]-(t))
  RETURN min(length(p)) AS nearest`);
console.log('nearest exit from one cell', r.rows, r.ms.toFixed(1), 'ms');

// Block a full column except one gap, then check reach from 50 work positions
q('MATCH (c:Cell) WHERE c.x = 20 AND c.y > 0 MATCH (c)-[r:ADJACENT]-() DELETE r SET c.walkable = false');
const starts = Array.from({ length: 50 }, (_, i) => ({ x: i % 20, y: i % 30 }));
r = q(`UNWIND $starts AS st MATCH (s:Cell {x:st.x, y:st.y})
  OPTIONAL MATCH (:Exit)-[:AT]->(t:Cell)
  OPTIONAL MATCH p = shortestPath((s)-[:ADJACENT*]-(t))
  WITH s, min(length(p)) AS hops RETURN count(*) AS positions, count(hops) AS reachable, max(hops) AS worst`, { starts });
console.log('50 positions nearest-exit (with wall)', r.rows, r.ms.toFixed(1), 'ms');

// Fully block: no path
q('MATCH (c:Cell {x:20, y:0}) MATCH (c)-[r:ADJACENT]-() DELETE r SET c.walkable = false');
r = q(`MATCH (s:Cell {x:0, y:0}), (e:Exit {name:'E1'})-[:AT]->(t:Cell)
  OPTIONAL MATCH p = shortestPath((s)-[:ADJACENT*]-(t)) RETURN p IS NULL AS blocked`);
console.log('fully blocked to E1', r.rows, r.ms.toFixed(1), 'ms');
