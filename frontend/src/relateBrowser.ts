// Relate in the browser tab (WebAssembly). The floor graph is copied from the server once,
// then every query runs locally in this tab: no server call, no network.
import init, { RelateDb } from "@relate/relate-wasm";
import wasmUrl from "@relate/relate-wasm/relate_bg.wasm?url";

export interface Envelope {
  columns: string[]; rows: Record<string, any>[]; error: any; stats?: Record<string, number>;
  elapsed_ms?: number; parse_ms?: number; plan_ms?: number; execute_ms?: number; notifications?: any[];
}
type Exported = { floor: string; nodes: [string, string, Record<string, any>][]; rels: [string, string, string, Record<string, any> | null][] };

let ready: Promise<void> | null = null;

export class BrowserGraph {
  db: RelateDb;
  floor = "";
  nodes = 0;
  rels = 0;
  loadMs = 0;
  constructor() { this.db = new RelateDb(); }

  run(query: string, params?: Record<string, any>): Envelope {
    const env = JSON.parse(this.db.execute(query, params ? JSON.stringify(params) : null));
    return env;
  }

  private must(query: string, params?: Record<string, any>) {
    const env = this.run(query, params);
    if (env.error) throw new Error(`${typeof env.error === "string" ? env.error : JSON.stringify(env.error)}\n${query.slice(0, 200)}`);
    return env;
  }

  /** Copy the exported floor graph into this tab's Relate. Each node keeps its server key in _k. */
  async load(data: Exported, onStep: (s: string) => void) {
    const t0 = performance.now();
    this.db.reset();
    const byLabel = new Map<string, { k: string; p: Record<string, any> }[]>();
    const labelOf = new Map<string, string>();
    for (const [k, label, p] of data.nodes) {
      labelOf.set(k, label);
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label)!.push({ k, p });
    }
    for (const [label, rows] of byLabel) {
      onStep(`Creating ${rows.length} ${label} nodes`);
      this.must(`CREATE INDEX IF NOT EXISTS FOR (n:${label}) ON (n._k)`);
      for (let i = 0; i < rows.length; i += 2000) {
        this.must(`UNWIND $rows AS r CREATE (n:${label}) SET n += r.p, n._k = r.k`, { rows: rows.slice(i, i + 2000) });
      }
      await tick();
    }
    const groups = new Map<string, { s: string; t: string; p: Record<string, any> }[]>();
    for (const [s, t, type, p] of data.rels) {
      const key = `${labelOf.get(s)}|${type}|${labelOf.get(t)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ s, t, p: p ?? {} });
    }
    for (const [key, rows] of groups) {
      const [a, type, b] = key.split("|");
      onStep(`Linking ${rows.length} ${type}`);
      for (let i = 0; i < rows.length; i += 3000) {
        this.must(`UNWIND $rows AS r MATCH (a:${a} {_k: r.s}) MATCH (b:${b} {_k: r.t}) CREATE (a)-[x:${type}]->(b) SET x += r.p`,
                  { rows: rows.slice(i, i + 3000) });
        await tick();
      }
    }
    this.floor = data.floor;
    this.nodes = data.nodes.length;
    this.rels = data.rels.length;
    this.loadMs = performance.now() - t0;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function openBrowserGraph(): Promise<BrowserGraph> {
  if (!ready) ready = init({ module_or_path: wasmUrl }).then(() => undefined);
  await ready;
  return new BrowserGraph();
}

export function engineVersion(g: BrowserGraph): string {
  const e = g.run("CALL dbms.components() YIELD name, versions WHERE name = 'Relate' RETURN versions[0] AS v");
  return e.rows?.[0]?.v ?? "?";
}
