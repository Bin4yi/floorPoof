// Graph explorer: the floor graph loaded into Relate's WebAssembly build, queried in this browser tab.
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserGraph, type Envelope, engineVersion, openBrowserGraph } from "./relateBrowser";

const LABEL_COLORS: Record<string, string> = {
  Item: "#2a78d6", PowerPanel: "#eb6834", Exit: "#1baf7a", Line: "#eda100", Zone: "#e87ba4",
  ItemType: "#6250d6", Rule: "#e34948", RulePack: "#008300", Floor: "#334155", Cell: "#a3b1c2",
};

export interface Preset { title: string; query: string; params?: Record<string, any> }

export function presets(itemId: string | null): Preset[] {
  return [
    { title: "Power tree", query: "MATCH p = (:PowerPanel)-[:FED_BY*1..3]->(:PowerPanel {kind:'main_breaker'})\nRETURN p" },
    { title: "What plugs into each power unit", query: "MATCH (i:Item)-[r:POWERED_BY]->(d:PowerPanel)\nRETURN i, r, d" },
    { title: "Production lines (FEEDS chains)", query: "MATCH (i:Item)-[r:IN_LINE]->(l:Line)\nOPTIONAL MATCH (i)-[f:FEEDS]->(j:Item)\nRETURN i, r, l, f, j" },
    { title: "Walk from an item to its nearest exit", params: { id: itemId ?? "A1" },
      query: "MATCH (i:Item {id: $id})-[:WORKS_AT]->(w:Cell)\nMATCH (e:Exit)-[:AT]->(t:Cell)\nMATCH p = shortestPath((w)-[:ADJACENT*]->(t))\nRETURN i, e, p, length(p) * 0.5 AS walk_m\nORDER BY walk_m LIMIT 1" },
    { title: "Panel load at every level (same pattern as the check)",
      query: "MATCH (p:PowerPanel)\nOPTIONAL MATCH (i:Item)-[:POWERED_BY]->(:PowerPanel)-[:FED_BY*0..8]->(p)\nOPTIONAL MATCH (i)-[:IS_A]->(t:ItemType)\nRETURN p.name AS unit, p.kind AS kind, sum(coalesce(t.kw, 0.0)) AS kw,\n       p.capacity_kw * 0.8 AS limit_kw\nORDER BY kind, unit" },
    { title: "Rules and what they apply to", query: "MATCH (pk:RulePack)-[h:HAS_RULE]->(r:Rule)\nOPTIONAL MATCH (r)-[a:APPLIES_TO]->(t:ItemType)\nRETURN pk, h, r, a, t" },
    { title: "Material flows between item types", query: "MATCH (a:ItemType)-[f:FLOWS_TO]->(b:ItemType)\nRETURN a, f, b" },
    { title: "What is in the graph (labels)", query: "MATCH (n)\nRETURN labels(n)[0] AS label, count(*) AS nodes\nORDER BY nodes DESC" },
  ];
}

type GNode = { id: number; labels: string[]; props: Record<string, any>; x: number; y: number; vx: number; vy: number; ax?: number; ay?: number };
type GEdge = { id: number; s: number; t: number; type: string };

function caption(n: { labels: string[]; props: Record<string, any> }) {
  const p = n.props;
  if (n.labels[0] === "Cell") return `${p.x},${p.y}`;
  return String(p.id ?? p.name ?? p.label ?? n.labels[0]);
}

function collect(rows: Record<string, any>[], into: { nodes: Map<number, GNode>; edges: Map<number, GEdge> }) {
  const visit = (v: any) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v.kind === "node") {
      if (!into.nodes.has(v.id)) into.nodes.set(v.id, { id: v.id, labels: v.labels, props: v.properties ?? {}, x: Math.random() * 400, y: Math.random() * 300, vx: 0, vy: 0 });
    } else if (v.kind === "relationship") {
      into.edges.set(v.id, { id: v.id, s: v.start_node, t: v.end_node, type: v.type });
    } else Object.values(v).forEach(visit);
  };
  rows.forEach((r) => Object.values(r).forEach(visit));
}

function show(v: any): string {
  if (v == null) return "–";
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === "object" && (x.kind === "node" || x.kind === "relationship")))
      return `path · ${v.filter((x) => x.kind === "relationship").length} hops`;
    return v.length > 6 ? `[${v.length} items]` : JSON.stringify(v);
  }
  if (typeof v === "object") {
    if (v.kind === "node") return `(${v.labels[0]} ${caption({ labels: v.labels, props: v.properties })})`;
    if (v.kind === "relationship") return `-[${v.type}]->`;
    return JSON.stringify(v);
  }
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

export default function Explorer({ floor, itemId, request, onRequestDone }: {
  floor: string; itemId: string | null;
  request: Preset | null; onRequestDone: () => void;
}) {
  const [g, setG] = useState<BrowserGraph | null>(null);
  const [status, setStatus] = useState("Loading Relate (WebAssembly) ...");
  const [version, setVersion] = useState("");
  const [query, setQuery] = useState(presets(itemId)[0].query);
  const [params, setParams] = useState("{}");
  const [env, setEnv] = useState<Envelope | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [floorMode, setFloorMode] = useState(true);
  const [graph, setGraph] = useState<{ nodes: Map<number, GNode>; edges: Map<number, GEdge> }>({ nodes: new Map(), edges: new Map() });
  const [view, setView] = useState<"graph" | "table">("graph");
  const [exportMs, setExportMs] = useState(0);

  // Load wasm once, then (re)load the floor graph into it.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        setG(null); setEnv(null); setGraph({ nodes: new Map(), edges: new Map() });
        const db = await openBrowserGraph();
        if (!live) return;
        setVersion(engineVersion(db));
        setStatus("Downloading the floor graph ...");
        const t0 = performance.now();
        const data = await (await fetch(`/api/export/${floor}`)).json();
        setExportMs(performance.now() - t0);
        await db.load(data, (s) => live && setStatus(s));
        if (!live) return;
        setG(db);
        setStatus("");
      } catch (e) { setStatus(`Could not start Relate in the browser: ${e}`); }
    })();
    return () => { live = false; };
  }, [floor]);

  const run = (q = query, pjson = params, merge = false) => {
    if (!g) return;
    setErr(null);
    let p: Record<string, any> | undefined;
    try { p = pjson.trim() ? JSON.parse(pjson) : undefined; } catch { setErr("Parameters must be a JSON object."); return; }
    const e = g.run(q, p);
    setEnv(e);
    if (e.error) { setErr(typeof e.error === "string" ? e.error : (e.error.message ?? JSON.stringify(e.error))); return; }
    const into = merge ? { nodes: new Map(graph.nodes), edges: new Map(graph.edges) } : { nodes: new Map<number, GNode>(), edges: new Map<number, GEdge>() };
    collect(e.rows, into);
    setGraph(into);
    setView(into.nodes.size ? "graph" : "table");
  };

  // A query sent from elsewhere in the app (for example "Run in browser" on a check).
  useEffect(() => {
    if (request && g) {
      setQuery(request.query); setParams(JSON.stringify(request.params ?? {}, null, 0));
      run(request.query, JSON.stringify(request.params ?? {}));
      onRequestDone();
    }
  }, [request, g]);

  const expand = (n: GNode) => run("MATCH (n)-[r]-(m) WHERE n._k = $k RETURN n, r, m LIMIT 40", JSON.stringify({ k: n.props._k }), true);

  return (
    <div className="explorer">
      <div className="ex-side">
        <div className="ex-head">
          <b>Graph explorer</b>
          <small>{g ? `Relate ${version} running in this tab (WebAssembly) · ${g.nodes} nodes, ${g.rels} links loaded in ${(g.loadMs / 1000).toFixed(1)} s` : status}</small>
        </div>
        <p className="hint">Every query here runs inside your browser on a copy of the floor graph. No server call. Pick a question or write Cypher.</p>
        <div className="presets">
          {presets(itemId).map((p) => (
            <button key={p.title} disabled={!g} onClick={() => { setQuery(p.query); setParams(JSON.stringify(p.params ?? {})); run(p.query, JSON.stringify(p.params ?? {})); }}>{p.title}</button>
          ))}
        </div>
        <label className="ex-label">Cypher</label>
        <textarea className="cypher" rows={7} value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); }} />
        <label className="ex-label">Parameters (JSON)</label>
        <input className="cypher" value={params} onChange={(e) => setParams(e.target.value)} />
        <div className="row">
          <button className="primary" disabled={!g} onClick={() => run()}>Run in browser <small>(Ctrl+Enter)</small></button>
        </div>
        {err && <pre className="ex-err">{err}</pre>}
        {env && !env.error && (
          <p className="hint">{env.rows.length} row{env.rows.length === 1 ? "" : "s"} · Relate {env.elapsed_ms?.toFixed(2)} ms
            (parse {env.parse_ms?.toFixed(2)}, plan {env.plan_ms?.toFixed(2)}, run {env.execute_ms?.toFixed(2)})
            {exportMs ? ` · graph downloaded once in ${exportMs.toFixed(0)} ms` : ""}</p>)}
        {env?.notifications?.length ? (
          <div className="ex-notes">{env.notifications.slice(0, 3).map((n: any, i: number) => (
            <p key={i}><b>Relate notice:</b> {n.description}{n.remedy ? <> · <i>{n.remedy}</i></> : null}</p>))}</div>) : null}
      </div>
      <div className="ex-main">
        <div className="ex-tabs">
          <button className={view === "graph" ? "on" : ""} onClick={() => setView("graph")}>Graph ({graph.nodes.size})</button>
          <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table ({env?.rows.length ?? 0})</button>
          {view === "graph" && <label className="check-label"><input type="checkbox" checked={floorMode} onChange={(e) => setFloorMode(e.target.checked)} /> Place nodes at their floor position</label>}
          {view === "graph" && <small className="hint">Drag to pan, wheel to zoom, drag a node, double-click a node to expand its links.</small>}
        </div>
        {view === "graph"
          ? <GraphCanvas graph={graph} floorMode={floorMode} onExpand={expand} />
          : <Table env={env} />}
        {!g && <div className="ex-loading"><div className="spinner dark" />{status}</div>}
      </div>
    </div>
  );
}

function Table({ env }: { env: Envelope | null }) {
  if (!env || env.error) return <p className="hint pad">Run a query to see rows.</p>;
  return (
    <div className="ex-table">
      <table>
        <thead><tr>{env.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{env.rows.slice(0, 500).map((r, i) => <tr key={i}>{env.columns.map((c) => <td key={c}>{show(r[c])}</td>)}</tr>)}</tbody>
      </table>
      {env.rows.length > 500 && <p className="hint pad">Showing 500 of {env.rows.length} rows.</p>}
    </div>
  );
}

function GraphCanvas({ graph, floorMode, onExpand }: { graph: { nodes: Map<number, GNode>; edges: Map<number, GEdge> }; floorMode: boolean; onExpand: (n: GNode) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ n?: GNode; e?: GEdge; x: number; y: number } | null>(null);
  const view = useRef({ ox: 0, oy: 0, k: 1 });
  const nodes = useMemo(() => [...graph.nodes.values()].slice(0, 900), [graph]);
  const edges = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    return [...graph.edges.values()].filter((e) => ids.has(e.s) && ids.has(e.t));
  }, [graph, nodes]);

  // Layout: floor positions (x, y on the 0.5 m grid) when nodes have them, else a force layout.
  useEffect(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const S = 12;
    for (const n of nodes) {
      const p = n.props;
      const x = typeof p.x === "number" ? p.x + (p.w ?? 0) / 2 : typeof p.x0 === "number" ? (p.x0 + p.x1) / 2 : undefined;
      const y = typeof p.y === "number" ? p.y + (p.d ?? 0) / 2 : typeof p.y0 === "number" ? (p.y0 + p.y1) / 2 : undefined;
      if (floorMode && x !== undefined && y !== undefined) { n.ax = x * S; n.ay = y * S; n.x = n.ax; n.y = n.ay; }
      else { n.ax = undefined; n.ay = undefined; }
    }
    for (let it = 0; it < 220; it++) {
      const alpha = 1 - it / 220;
      for (const a of nodes) {
        if (a.ax !== undefined) continue;
        for (const b of nodes) {
          if (a === b) continue;
          const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
          if (d2 > 90000) continue;
          const f = 900 / d2;
          a.vx += dx * f * alpha; a.vy += dy * f * alpha;
        }
      }
      for (const e of edges) {
        const a = byId.get(e.s)!, b = byId.get(e.t)!;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 70) * 0.02 * alpha;
        if (a.ax === undefined) { a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
        if (b.ax === undefined) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      }
      for (const n of nodes) {
        if (n.ax !== undefined) continue;
        n.x += Math.max(-20, Math.min(20, n.vx)); n.y += Math.max(-20, Math.min(20, n.vy));
        n.vx *= 0.55; n.vy *= 0.55;
      }
    }
    // Fit to view.
    const c = canvas.current, w = wrap.current;
    if (c && w && nodes.length) {
      const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const k = Math.min(w.clientWidth / Math.max(x1 - x0 + 80, 1), w.clientHeight / Math.max(y1 - y0 + 80, 1), 2.5);
      view.current = { k, ox: w.clientWidth / 2 - ((x0 + x1) / 2) * k, oy: w.clientHeight / 2 - ((y0 + y1) / 2) * k };
    }
    draw();
  }, [nodes, edges, floorMode]);

  const draw = () => {
    const c = canvas.current, w = wrap.current;
    if (!c || !w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w.clientWidth * dpr || c.height !== w.clientHeight * dpr) {
      c.width = w.clientWidth * dpr; c.height = w.clientHeight * dpr;
      c.style.width = `${w.clientWidth}px`; c.style.height = `${w.clientHeight}px`;
    }
    const ctx = c.getContext("2d")!;
    const { ox, oy, k } = view.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w.clientWidth, w.clientHeight);
    ctx.translate(ox, oy); ctx.scale(k, k);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    ctx.lineWidth = 1.2 / k;
    for (const e of edges) {
      const a = byId.get(e.s)!, b = byId.get(e.t)!;
      ctx.strokeStyle = e.type === "ADJACENT" ? "rgba(42,120,214,.55)" : "rgba(71,85,105,.45)";
      ctx.lineWidth = (e.type === "ADJACENT" ? 3 : 1.4) / k;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (e.type !== "ADJACENT") { // arrow head
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, r = 9 / Math.sqrt(k) + 2;
        const hx = b.x - (dx / d) * r, hy = b.y - (dy / d) * r;
        ctx.fillStyle = "rgba(71,85,105,.7)";
        ctx.beginPath(); ctx.moveTo(hx, hy);
        ctx.lineTo(hx - (dx / d) * 7 / k - (dy / d) * 4 / k, hy - (dy / d) * 7 / k + (dx / d) * 4 / k);
        ctx.lineTo(hx - (dx / d) * 7 / k + (dy / d) * 4 / k, hy - (dy / d) * 7 / k - (dx / d) * 4 / k);
        ctx.fill();
      }
    }
    for (const n of nodes) {
      const cell = n.labels[0] === "Cell";
      const r = (cell ? 3.5 : 8) / Math.sqrt(k) + (cell ? 0 : 2);
      ctx.fillStyle = LABEL_COLORS[n.labels[0]] ?? "#64748b";
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 / k;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (!cell || nodes.length < 60) {
        ctx.fillStyle = "#0f172a"; ctx.font = `${11 / k}px Inter, system-ui, sans-serif`;
        ctx.fillText(caption(n), n.x + r + 2 / k, n.y + 4 / k);
      }
    }
  };

  // Pan, zoom, drag, hover, double-click to expand.
  useEffect(() => {
    const c = canvas.current!;
    let dragging: GNode | null = null, panning = false, lx = 0, ly = 0;
    const toWorld = (ev: MouseEvent) => {
      const r = c.getBoundingClientRect(), { ox, oy, k } = view.current;
      return { x: (ev.clientX - r.left - ox) / k, y: (ev.clientY - r.top - oy) / k, sx: ev.clientX - r.left, sy: ev.clientY - r.top };
    };
    const hit = (x: number, y: number) => {
      const k = view.current.k;
      let best: GNode | null = null, bd = (12 / k) ** 2;
      for (const n of nodes) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = n; } }
      return best;
    };
    const down = (ev: MouseEvent) => { const p = toWorld(ev); dragging = hit(p.x, p.y); panning = !dragging; lx = ev.clientX; ly = ev.clientY; };
    const move = (ev: MouseEvent) => {
      const p = toWorld(ev);
      if (dragging) { dragging.x = p.x; dragging.y = p.y; draw(); return; }
      if (panning) { view.current.ox += ev.clientX - lx; view.current.oy += ev.clientY - ly; lx = ev.clientX; ly = ev.clientY; draw(); return; }
      const n = hit(p.x, p.y);
      setHover(n ? { n, x: p.sx, y: p.sy } : null);
    };
    const up = () => { dragging = null; panning = false; };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const p = toWorld(ev), f = ev.deltaY < 0 ? 1.15 : 1 / 1.15, v = view.current;
      v.k *= f; v.ox = p.sx - p.x * v.k; v.oy = p.sy - p.y * v.k; draw();
    };
    const dbl = (ev: MouseEvent) => { const p = toWorld(ev); const n = hit(p.x, p.y); if (n) onExpand(n); };
    c.addEventListener("mousedown", down); window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    c.addEventListener("wheel", wheel, { passive: false }); c.addEventListener("dblclick", dbl);
    const ro = new ResizeObserver(() => draw()); ro.observe(wrap.current!);
    return () => {
      c.removeEventListener("mousedown", down); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up);
      c.removeEventListener("wheel", wheel); c.removeEventListener("dblclick", dbl); ro.disconnect();
    };
  }, [nodes, edges, onExpand]);

  const labels = [...new Set(nodes.map((n) => n.labels[0]))];
  return (
    <div className="ex-canvas" ref={wrap}>
      <canvas ref={canvas} />
      {nodes.length === 0 && <p className="hint pad">Results with nodes, links or paths are drawn here.</p>}
      {graph.nodes.size > 900 && <p className="ex-warn">Showing 900 of {graph.nodes.size} nodes.</p>}
      {labels.length > 0 && (
        <div className="ex-legend">{labels.map((l) => <span key={l}><i style={{ background: LABEL_COLORS[l] ?? "#64748b" }} />{l}</span>)}</div>)}
      {hover?.n && (
        <div className="ex-tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          <b>{hover.n.labels.join(":")} {caption(hover.n)}</b>
          {Object.entries(hover.n.props).filter(([k]) => k !== "_k").slice(0, 10).map(([k, v]) => (
            <div key={k}><span>{k}</span> {typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v)}</div>))}
        </div>
      )}
    </div>
  );
}
