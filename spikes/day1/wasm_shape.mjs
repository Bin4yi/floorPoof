// What a relate-wasm envelope looks like for nodes, relationships and paths (for the browser explorer).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import init, { RelateDb, renderResult } from "@relate/relate-wasm";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("@relate/relate-wasm/relate_bg.wasm");
await init({ module_or_path: readFileSync(wasmPath) });
const db = new RelateDb();
const run = (q, p) => JSON.parse(db.execute(q, p ? JSON.stringify(p) : null));
console.log(run("UNWIND $rows AS r CREATE (:Cell {k:r.k, x:r.x})", { rows: [{ k: 1, x: 0 }, { k: 2, x: 1 }] }).stats);
console.log(run("MATCH (a:Cell {k:1}), (b:Cell {k:2}) CREATE (a)-[:ADJACENT {w:1}]->(b)").error);
const e = run("MATCH p = (a:Cell)-[r:ADJACENT]->(b) RETURN a, r, p LIMIT 1");
console.log(JSON.stringify(e.rows, null, 1).slice(0, 1500));
console.log(Object.keys(e));
const rr = renderResult([JSON.stringify(e)]);
console.log(typeof rr, JSON.stringify(rr).slice(0, 800));
console.log(run("SET n:$('X')").error);
