// Worker efficiency: measured on the graph (backend/metrics.py). Measurements, not rules.
import { useState } from "react";
import type { Metrics } from "./types";

const DRAFT = "#2a78d6";   // categorical slot 1: this draft
const SAVED = "#eb6834";   // categorical slot 2: saved floor
const ASPECTS: { key: string; label: string; help: string }[] = [
  { key: "evacuation", label: "Evacuation", help: "100 × (1 − mean walk to the nearest exit ÷ basis). Basis: the exit-distance limit of the floor's rule, else floor width + depth." },
  { key: "travel", label: "Travel", help: "100 × (1 − mean walk of line steps and material trips ÷ (floor width + depth)). Walks are shortestPath over walkable cells." },
  { key: "crowding", label: "Low crowding", help: "100 × (1 − operators whose exit route crosses the busiest cell ÷ all operators)." },
  { key: "elbow_room", label: "Elbow room", help: "100 × mean free cells within 2 steps of each work position ÷ 12." },
  { key: "power", label: "Power headroom", help: "100 × mean spare share (1 − load ÷ limit) over every power unit." },
  { key: "openness", label: "Openness", help: "100 × walkable cells ÷ all cells." },
];

export type Layer = "paths" | "line" | "flow" | "crowd";

export default function Efficiency({ m, base, history, layers, onLayer }: {
  m: Metrics | undefined; base: Metrics | undefined; history: { t: number; index: number }[];
  layers: Record<Layer, boolean>; onLayer: (l: Layer) => void;
}) {
  if (!m) return <p className="hint">Efficiency is measured when the floor loads. Restart the server if this stays empty.</p>;
  const isDraft = base && base !== m;
  const d = m.index != null && base?.index != null ? m.index - base.index : 0;
  return (
    <div className="eff">
      <div className="hero card">
        <div>
          <small>Worker efficiency index</small>
          <b className="big">{m.index ?? "–"}</b>
          {isDraft && <Delta v={d} unit="" goodUp />}
        </div>
        <p className="hint">Mean of the six aspects below, each 0–100. Measured on the graph in {m.ms.toFixed(0)} ms. A measurement, not a rule.</p>
      </div>

      <Card title="Aspects" sub={isDraft ? "this draft vs saved floor" : "saved floor"}>
        <Radar m={m} base={isDraft ? base : undefined} />
      </Card>

      <Card title="Live trend" sub="index after each change">
        <Trend history={history} />
      </Card>

      <div className="kpis">
        <Kpi label="Mean walk to exit" v={m.kpi.evac_mean_m} b={base?.kpi.evac_mean_m} unit="m" lowGood show={isDraft} />
        <Kpi label="Longest walk to exit" v={m.kpi.evac_max_m} b={base?.kpi.evac_max_m} unit="m" lowGood show={isDraft} />
        <Kpi label="Line travel" v={m.kpi.line_travel_m} b={base?.kpi.line_travel_m} unit="m" lowGood show={isDraft} />
        <Kpi label="Material travel" v={m.kpi.material_m} b={base?.kpi.material_m} unit="m" lowGood show={isDraft} />
        <Kpi label="Busiest cell" v={m.kpi.busiest_cell} b={base?.kpi.busiest_cell} unit="people" lowGood show={isDraft} />
        <Kpi label="Elbow room" v={m.kpi.elbow_mean} b={base?.kpi.elbow_mean} unit="/12 cells" show={isDraft} />
      </div>

      <Card title="Line travel per line" sub="walk between stations, m" layer="line" layers={layers} onLayer={onLayer} color="#eb6834">
        {m.lines.length ? <Bars rows={m.lines.map((l) => ({ name: `Line ${l.name}`, v: l.m, b: base?.lines.find((x) => x.name === l.name)?.m }))} showBase={!!isDraft} />
          : <p className="hint">No production lines on this floor.</p>}
      </Card>

      <Card title="Material flow" sub="walk per flow, m" layer="flow" layers={layers} onLayer={onLayer} color="#6250d6">
        {m.flows.length ? <Bars rows={m.flows.map((f) => ({ name: f.name, v: f.m, b: base?.flows.find((x) => x.name === f.name)?.m }))} showBase={!!isDraft} />
          : <p className="hint">This floor has no material flows between its item types.</p>}
      </Card>

      <Card title="Walk to nearest exit" sub={`operators per 5 m band · basis ${m.evac_basis}`} layer="paths" layers={layers} onLayer={onLayer} color="#2a78d6">
        <Histogram walks={m.walks} limit={m.limit_m} />
      </Card>

      <Card title="Crowding on exit routes" sub={`busiest cell: ${m.kpi.busiest_cell} of ${m.kpi.workers} operators`} layer="crowd" layers={layers} onLayer={onLayer} color="#c2410c">
        <p className="hint">Cells where 3 or more exit routes meet. Show them on the floor to see the bottlenecks.</p>
      </Card>
    </div>
  );
}

function Card({ title, sub, children, layer, layers, onLayer, color }: {
  title: string; sub?: string; children: React.ReactNode; layer?: Layer; layers?: Record<Layer, boolean>; onLayer?: (l: Layer) => void; color?: string;
}) {
  return (
    <div className="card chart">
      <div className="card-head">
        <div><b>{title}</b>{sub && <small> {sub}</small>}</div>
        {layer && layers && onLayer && (
          <button className={`layer ${layers[layer] ? "on" : ""}`} style={{ ["--c" as any]: color }} onClick={() => onLayer(layer)}>
            {layers[layer] ? "◉ On floor" : "○ Show on floor"}</button>)}
      </div>
      {children}
    </div>
  );
}

function Delta({ v, unit, goodUp, lowGood }: { v: number; unit: string; goodUp?: boolean; lowGood?: boolean }) {
  if (Math.abs(v) < 0.05) return <span className="delta same">no change</span>;
  const good = goodUp ? v > 0 : lowGood ? v < 0 : v > 0;
  return <span className={`delta ${good ? "good" : "bad"}`}>{v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}{unit} {good ? "better" : "worse"}</span>;
}

function Kpi({ label, v, b, unit, lowGood, show }: { label: string; v: number | null; b?: number | null; unit: string; lowGood?: boolean; show?: boolean }) {
  return (
    <div className="kpi">
      <small>{label}</small>
      <b>{v ?? "–"} <em>{unit}</em></b>
      {show && v != null && b != null && <Delta v={v - b} unit={unit === "m" ? " m" : ""} lowGood={lowGood} goodUp={!lowGood} />}
    </div>
  );
}

function Radar({ m, base }: { m: Metrics; base?: Metrics }) {
  const [hover, setHover] = useState<number | null>(null);
  const axes = ASPECTS.filter((a) => m.aspects[a.key] != null);
  const W = 360, H = 230, cx = W / 2, cy = H / 2 + 4, R = 76;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
    return [cx + Math.cos(a) * R * v / 100, cy + Math.sin(a) * R * v / 100];
  };
  const poly = (mm: Metrics) => axes.map((a, i) => pt(i, mm.aspects[a.key] ?? 0).join(",")).join(" ");
  if (axes.length < 3) return <p className="hint">Not enough aspects on this floor.</p>;
  return (
    <div className="radar">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Efficiency aspects radar">
        {[25, 50, 75, 100].map((r) => <polygon key={r} points={axes.map((_, i) => pt(i, r).join(",")).join(" ")} className="grid" />)}
        {axes.map((a, i) => {
          const [x, y] = pt(i, 100), [lx, ly] = pt(i, 122);
          return (
            <g key={a.key}>
              <line x1={cx} y1={cy} x2={x} y2={y} className="grid" />
              <text x={lx} y={ly} textAnchor={Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end"} dominantBaseline="middle" className="axis">{a.label}</text>
            </g>
          );
        })}
        {base && <polygon points={poly(base)} fill={SAVED} fillOpacity={0.08} stroke={SAVED} strokeWidth={2} strokeDasharray="5 3" />}
        <polygon points={poly(m)} fill={DRAFT} fillOpacity={0.16} stroke={DRAFT} strokeWidth={2} />
        {axes.map((a, i) => {
          const [x, y] = pt(i, m.aspects[a.key] ?? 0);
          return (
            <g key={a.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <circle cx={x} cy={y} r={12} fill="transparent" />
              <circle cx={x} cy={y} r={4.5} fill={DRAFT} stroke="#fff" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i style={{ background: DRAFT }} />{base ? "This draft" : "Saved floor"}</span>
        {base && <span><i className="dash" style={{ borderColor: SAVED }} />Saved floor</span>}
      </div>
      {hover != null && (
        <div className="tip">
          <b>{axes[hover].label}: {m.aspects[axes[hover].key]}</b>
          {base && <> (saved {base.aspects[axes[hover].key]})</>}
          <small>{axes[hover].help}</small>
        </div>
      )}
      {hover == null && <p className="hint">Hover a point for its formula. Further out is better.</p>}
    </div>
  );
}

function Trend({ history }: { history: { t: number; index: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (history.length < 2) return <p className="hint">Make a change: each new check run adds a point here.</p>;
  const W = 300, H = 110, L = 30, B = 18, T = 8;
  const vals = history.map((h) => h.index);
  const lo = Math.floor(Math.min(...vals) - 2), hi = Math.ceil(Math.max(...vals) + 2);
  const x = (i: number) => L + (i / (history.length - 1)) * (W - L - 6);
  const y = (v: number) => T + (1 - (v - lo) / Math.max(hi - lo, 1)) * (H - T - B);
  const d = history.map((h, i) => `${i ? "L" : "M"}${x(i)},${y(h.index)}`).join(" ");
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} onMouseLeave={() => setHover(null)}
           onMouseMove={(e) => {
             const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
             const px = ((e.clientX - r.left) / r.width) * W;
             setHover(Math.max(0, Math.min(history.length - 1, Math.round(((px - L) / (W - L - 6)) * (history.length - 1)))));
           }} role="img" aria-label="Efficiency index over recent changes">
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <g key={v}><line x1={L} x2={W - 6} y1={y(v)} y2={y(v)} className="grid" />
            <text x={L - 4} y={y(v)} textAnchor="end" dominantBaseline="middle" className="tick">{v.toFixed(0)}</text></g>))}
        <path d={d} fill="none" stroke={DRAFT} strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(history.length - 1)} cy={y(vals[vals.length - 1])} r={4} fill={DRAFT} stroke="#fff" strokeWidth={2} />
        {hover != null && <>
          <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} className="cross" />
          <circle cx={x(hover)} cy={y(vals[hover])} r={4} fill={DRAFT} stroke="#fff" strokeWidth={2} />
        </>}
        <text x={L} y={H - 4} className="tick">first</text>
        <text x={W - 6} y={H - 4} textAnchor="end" className="tick">now</text>
      </svg>
      {hover != null && <div className="tip inline">Change {hover + 1}: index <b>{vals[hover]}</b></div>}
    </div>
  );
}

function Bars({ rows, showBase }: { rows: { name: string; v: number; b?: number }[]; showBase: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => Math.max(r.v, r.b ?? 0)), 1);
  return (
    <div className="bars">
      {rows.map((r, i) => (
        <div key={r.name} className="barrow" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="name">{r.name}</span>
          <div className="track">
            <div className="fill" style={{ width: `${(r.v / max) * 100}%` }} />
            {showBase && r.b != null && <div className="mark" style={{ left: `${(r.b / max) * 100}%` }} title={`saved floor: ${r.b} m`} />}
          </div>
          <span className="val">{r.v.toFixed(1)}</span>
          {hover === i && <div className="tip">{r.name}: {r.v.toFixed(1)} m{showBase && r.b != null ? ` (saved floor ${r.b.toFixed(1)} m)` : ""}</div>}
        </div>
      ))}
      {showBase && <div className="legend"><span><i style={{ background: DRAFT }} />This draft</span><span><i className="tickmark" style={{ background: SAVED }} />Saved floor</span></div>}
    </div>
  );
}

function Histogram({ walks, limit }: { walks: number[]; limit: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!walks.length) return <p className="hint">No work positions.</p>;
  const top = Math.max(limit, ...walks);
  const n = Math.ceil(top / 5);
  const bins = Array.from({ length: n }, (_, i) => walks.filter((w) => w >= i * 5 && w < (i + 1) * 5).length);
  const W = 300, H = 110, L = 22, B = 18, gap = 2;
  const bw = (W - L - 4) / n;
  const hmax = Math.max(...bins, 1);
  const lx = L + (limit / (n * 5)) * (W - L - 4);
  return (
    <div className="hist">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram of walking distance to the nearest exit">
        <line x1={L} x2={W - 4} y1={H - B} y2={H - B} className="axisline" />
        {bins.map((c, i) => {
          const h = (c / hmax) * (H - B - 10);
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={L + i * bw} y={8} width={bw} height={H - B - 8} fill="transparent" />
              {c > 0 && <rect x={L + i * bw + gap / 2} y={H - B - h} width={bw - gap} height={h} rx={3} fill={DRAFT} opacity={hover === i ? 1 : 0.85} />}
            </g>
          );
        })}
        <line x1={lx} x2={lx} y1={6} y2={H - B} className="limit" />
        <text x={lx - 3} y={12} textAnchor="end" className="tick">basis {limit.toFixed(0)} m</text>
        {[0, Math.round(n / 2) * 5, n * 5].map((v) => (
          <text key={v} x={L + (v / (n * 5)) * (W - L - 4)} y={H - 4} textAnchor="middle" className="tick">{v} m</text>))}
      </svg>
      {hover != null && <div className="tip inline">{hover * 5}–{hover * 5 + 5} m: <b>{bins[hover]}</b> operator{bins[hover] === 1 ? "" : "s"}</div>}
    </div>
  );
}
