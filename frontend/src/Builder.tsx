// Floor builder: draw a custom floor (size, exits, aisles, areas, power tree, lines), then check it.
import { useMemo, useRef, useState } from "react";
import type { BuildHooks } from "./Floor3D";
import type { FloorData, FloorSpec, Panel, Zone } from "./types";

export const CELL = 0.5;

export function blankSpec(): FloorSpec {
  return {
    name: "", label: "My floor", industry: "", width_m: 30, depth_m: 20, sprinklered: false,
    exits: [{ name: "E1", x: 0, y: 20 }], zones: [{ name: "Main aisle", kind: "aisle", axis: "x", x0: 0, y0: 18, x1: 59, y1: 21 }],
    panels: [], lines: [], rules: {}, items: [],
  };
}

const ZONE_KIND: Record<string, string> = { aisle: "aisle", forklift_aisle: "forklift_aisle" };

export function specFromFloor(d: FloorData, withItems: boolean): FloorSpec {
  return {
    name: "", label: `${d.floor.label} copy`, industry: "", width_m: d.floor.width_m, depth_m: d.floor.depth_m,
    sprinklered: d.floor.sprinklered, exits: d.exits.map((e) => ({ ...e })),
    zones: d.zones.map((z) => ({ ...z, kind: ZONE_KIND[z.kind] ?? "area" })),
    panels: d.panels.map((p) => ({ ...p })), lines: d.lines.map((l) => ({ ...l })), rules: {},
    items: withItems ? d.items.map((i) => ({ id: i.id, type: i.type, x: i.x, y: i.y, rotation: i.rotation, panel: i.panel, line: i.line, seq: i.seq })) : [],
  };
}

export const TOOLS: { id: string; label: string; icon: string; hint: string }[] = [
  { id: "exit", label: "Exit", icon: "⇥", hint: "Click near a wall to add an exit there. Click an exit again to remove it." },
  { id: "aisle", label: "Aisle", icon: "▭", hint: "Drag a rectangle. Aisles must stay clear (28 in, OSHA)." },
  { id: "forklift_aisle", label: "Forklift aisle", icon: "⇆", hint: "Drag a rectangle. Width rule is TBD unless you give a number." },
  { id: "area", label: "Area", icon: "▦", hint: "Drag a named area (storage, finishing ...). No rule of its own." },
  { id: "main_breaker", label: "Main breaker", icon: "⏻", hint: "Click to place. Set its rating first." },
  { id: "sub_panel", label: "Sub-panel", icon: "⌁", hint: "Click to place. It is fed by the nearest main breaker." },
  { id: "drop_box", label: "Drop box", icon: "⚡", hint: "Click to place. Machines plug into drop boxes." },
  { id: "erase", label: "Erase", icon: "⌫", hint: "Click an exit, a power unit or an area to remove it." },
];
const DEFAULT_KW: Record<string, number> = { main_breaker: 60, sub_panel: 30, drop_box: 10 };
const PREFIX: Record<string, string> = { main_breaker: "MAIN", sub_panel: "SUB-", drop_box: "DB-" };

function nearest(ps: Panel[], kinds: string[], x: number, y: number) {
  const c = ps.filter((p) => kinds.includes(p.kind));
  c.sort((a, b) => Math.abs(a.x - x) + Math.abs(a.y - y) - (Math.abs(b.x - x) + Math.abs(b.y - y)));
  return c[0]?.name ?? null;
}

export function useBuild(spec: FloorSpec, setSpec: (f: (s: FloorSpec) => FloorSpec) => void) {
  const [tool, setTool] = useState<string | null>("aisle");
  const [kw, setKw] = useState<Record<string, number>>(DEFAULT_KW);
  const [preview, setPreview] = useState<BuildHooks["preview"]>(null);
  const start = useRef<[number, number] | null>(null);
  const cols = Math.round(spec.width_m / CELL), rows = Math.round(spec.depth_m / CELL);

  const hooks: BuildHooks = useMemo(() => ({
    tool, preview,
    onDown: (x, y) => {
      if (!tool) return;
      if (["aisle", "forklift_aisle", "area"].includes(tool)) {
        start.current = [x, y];
        setPreview({ x0: x, y0: y, x1: x, y1: y, kind: tool });
        return;
      }
      if (tool === "exit") {
        const d = [x, cols - 1 - x, y, rows - 1 - y];
        const k = d.indexOf(Math.min(...d));
        const ex = k === 0 ? 0 : k === 1 ? cols - 1 : x, ey = k === 2 ? 0 : k === 3 ? rows - 1 : y;
        setSpec((s) => {
          const hit = s.exits.find((e) => Math.abs(e.x - ex) + Math.abs(e.y - ey) <= 1);
          if (hit) return { ...s, exits: s.exits.filter((e) => e !== hit) };
          let n = 1; while (s.exits.some((e) => e.name === `E${n}`)) n++;
          return { ...s, exits: [...s.exits, { name: `E${n}`, x: ex, y: ey }] };
        });
        return;
      }
      if (tool === "erase") {
        setSpec((s) => {
          const e = s.exits.find((q) => Math.abs(q.x - x) + Math.abs(q.y - y) <= 1);
          if (e) return { ...s, exits: s.exits.filter((q) => q !== e) };
          const p = s.panels.find((q) => Math.abs(q.x - x) + Math.abs(q.y - y) <= 1);
          if (p) return { ...s, panels: s.panels.filter((q) => q !== p).map((q) => q.fed_by === p.name ? { ...q, fed_by: null } : q),
                          items: (s.items ?? []).map((i) => i.panel === p.name ? { ...i, panel: null } : i) };
          const zs = s.zones.filter((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1)
            .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
          if (zs[0]) return { ...s, zones: s.zones.filter((z) => z !== zs[0]) };
          return s;
        });
        return;
      }
      // power units
      const kind = tool;
      setSpec((s) => {
        let n = 1;
        const name = () => kind === "main_breaker" ? (n === 1 ? "MAIN" : `MAIN${n}`) : `${PREFIX[kind]}${n}`;
        while (s.panels.some((p) => p.name === name())) n++;
        const fed = kind === "main_breaker" ? null
          : kind === "sub_panel" ? nearest(s.panels, ["main_breaker"], x, y)
          : nearest(s.panels, ["sub_panel"], x, y) ?? nearest(s.panels, ["main_breaker"], x, y);
        return { ...s, panels: [...s.panels, { name: name(), kind, capacity_kw: kw[kind], x, y, fed_by: fed }] };
      });
    },
    onMove: (x, y) => {
      if (start.current && preview) setPreview({ ...preview, x1: x, y1: y });
    },
    onUp: (x, y) => {
      if (!start.current || !tool) return;
      const [x0, y0] = start.current;
      start.current = null;
      setPreview(null);
      const z: Zone = { name: "", kind: tool, x0: Math.min(x0, x), y0: Math.min(y0, y), x1: Math.max(x0, x), y1: Math.max(y0, y) };
      if (tool !== "area") z.axis = z.x1 - z.x0 >= z.y1 - z.y0 ? "x" : "y";
      setSpec((s) => {
        const base = tool === "aisle" ? "Aisle" : tool === "forklift_aisle" ? "Forklift aisle" : "Area";
        let n = 1; while (s.zones.some((q) => q.name === `${base} ${n}`)) n++;
        return { ...s, zones: [...s.zones, { ...z, name: `${base} ${n}` }] };
      });
    },
  }), [tool, preview, cols, rows, kw, setSpec]);

  return { hooks, tool, setTool, kw, setKw, cols, rows };
}

export default function BuilderPanel({ spec, setSpec, build, editing, busy, current, onSave, onCancel }: {
  spec: FloorSpec; setSpec: (f: (s: FloorSpec) => FloorSpec) => void; build: ReturnType<typeof useBuild>;
  editing: string | null; busy: boolean; current: FloorData | null; onSave: () => void; onCancel: () => void;
}) {
  const up = (patch: Partial<FloorSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const t = TOOLS.find((x) => x.id === build.tool);
  const hasForklift = spec.zones.some((z) => z.kind === "forklift_aisle");
  const outside = (spec.items ?? []).filter((i) => i.x >= build.cols || i.y >= build.rows).length;
  const ownDist = spec.rules.exit_distance_m != null;
  return (
    <div className="builder">
      <h3>{editing ? `Edit floor ${editing}` : "Build a new floor"}</h3>
      <p className="hint">Draw your own floor for any industry. Every rule check runs on it, the same as on the demo floors.</p>
      <div className="form">
        {!editing && <label className="wide">Floor id <input value={spec.name} placeholder="e.g. bakery-1" onChange={(e) => up({ name: e.target.value })} /></label>}
        <label className="wide">Name <input value={spec.label} onChange={(e) => up({ label: e.target.value })} /></label>
        <label className="wide">Industry <input value={spec.industry} placeholder="e.g. food, print shop, auto parts" onChange={(e) => up({ industry: e.target.value })} /></label>
        <label>Width m <input type="number" min={5} max={80} step={0.5} value={spec.width_m} onChange={(e) => up({ width_m: Number(e.target.value) })} /></label>
        <label>Depth m <input type="number" min={5} max={80} step={0.5} value={spec.depth_m} onChange={(e) => up({ depth_m: Number(e.target.value) })} /></label>
        <label className="check-label wide"><input type="checkbox" checked={spec.sprinklered} onChange={(e) => up({ sprinklered: e.target.checked })} /> Building has sprinklers</label>
      </div>
      {!editing && current && (
        <div className="row">
          <button onClick={() => setSpec(() => ({ ...blankSpec(), name: spec.name }))}>Start blank</button>
          <button onClick={() => setSpec(() => ({ ...specFromFloor(current, false), name: spec.name }))}>Copy {current.floor.name} walls</button>
          <button onClick={() => setSpec(() => ({ ...specFromFloor(current, true), name: spec.name }))}>… with items</button>
        </div>
      )}

      <h3>Draw</h3>
      <div className="tools">
        {TOOLS.map((x) => (
          <button key={x.id} className={build.tool === x.id ? "on" : ""} onClick={() => build.setTool(build.tool === x.id ? null : x.id)} title={x.hint}>
            <span className="ico">{x.icon}</span>{x.label}
          </button>
        ))}
      </div>
      <p className="hint">{t ? t.hint : "Pick a tool. Right-drag pans the camera, left-drag turns it."}</p>
      {build.tool && DEFAULT_KW[build.tool] !== undefined && (
        <label className="inline">Rating of the next {t?.label.toLowerCase()} (kW)
          <input type="number" min={1} value={build.kw[build.tool]} onChange={(e) => build.setKw({ ...build.kw, [build.tool!]: Number(e.target.value) })} />
        </label>
      )}

      <h3>Exits <small>{spec.exits.length}</small></h3>
      {spec.exits.length === 0 && <p className="bad">Add at least one exit on an outside wall.</p>}
      <div className="chips">{spec.exits.map((e) => <span key={e.name} className="chip exit">{e.name} <small>({e.x},{e.y})</small></span>)}</div>

      <h3>Areas and aisles <small>{spec.zones.length}</small></h3>
      {spec.zones.map((z, i) => (
        <div key={i} className="listrow">
          <input value={z.name} onChange={(e) => setSpec((s) => ({ ...s, zones: s.zones.map((q, k) => k === i ? { ...q, name: e.target.value } : q) }))} />
          <select value={z.kind} onChange={(e) => setSpec((s) => ({ ...s, zones: s.zones.map((q, k) => k === i ? { ...q, kind: e.target.value } : q) }))}>
            <option value="aisle">aisle</option><option value="forklift_aisle">forklift aisle</option><option value="area">area</option>
          </select>
          <button className="ghost" onClick={() => setSpec((s) => ({ ...s, zones: s.zones.filter((_, k) => k !== i) }))}>×</button>
        </div>
      ))}

      <h3>Power tree <small>{spec.panels.length} units</small></h3>
      {spec.panels.map((p, i) => (
        <div key={p.name} className={`listrow panel ${p.kind}`}>
          <span className="pname">{p.name}</span>
          <input type="number" min={1} value={p.capacity_kw} title="rating in kW"
                 onChange={(e) => setSpec((s) => ({ ...s, panels: s.panels.map((q, k) => k === i ? { ...q, capacity_kw: Number(e.target.value) } : q) }))} />
          <select value={p.fed_by ?? ""} title="fed by" onChange={(e) => setSpec((s) => ({ ...s, panels: s.panels.map((q, k) => k === i ? { ...q, fed_by: e.target.value || null } : q) }))}>
            <option value="">top of tree</option>
            {spec.panels.filter((q) => q.name !== p.name).map((q) => <option key={q.name} value={q.name}>fed by {q.name}</option>)}
          </select>
          <button className="ghost" onClick={() => setSpec((s) => ({ ...s, panels: s.panels.filter((_, k) => k !== i).map((q) => q.fed_by === p.name ? { ...q, fed_by: null } : q) }))}>×</button>
        </div>
      ))}

      <h3>Production lines <small>{spec.lines.length}</small></h3>
      {spec.lines.map((l, i) => (
        <div key={i} className="listrow">
          <input value={l.name} onChange={(e) => setSpec((s) => ({ ...s, lines: s.lines.map((q, k) => k === i ? { ...q, name: e.target.value } : q) }))} />
          <select value={l.direction} onChange={(e) => setSpec((s) => ({ ...s, lines: s.lines.map((q, k) => k === i ? { ...q, direction: e.target.value } : q) }))}>
            <option value="+x">flows east (+x)</option><option value="-x">flows west (-x)</option>
            <option value="+y">flows south (+y)</option><option value="-y">flows north (-y)</option>
          </select>
          <button className="ghost" onClick={() => setSpec((s) => ({ ...s, lines: s.lines.filter((_, k) => k !== i) }))}>×</button>
        </div>
      ))}
      <button onClick={() => setSpec((s) => {
        let n = 1; while (s.lines.some((l) => l.name === `L${n}`)) n++;
        return { ...s, lines: [...s.lines, { name: `L${n}`, direction: "+x" }] };
      })}>+ Add line</button>

      <h3>Rule numbers</h3>
      <div className="rulebox">
        <label className="check-label"><input type="checkbox" checked={ownDist}
          onChange={(e) => up({ rules: { ...spec.rules, exit_distance_m: e.target.checked ? 45 : null } })} />
          Use my own exit distance limit</label>
        {ownDist ? (
          <div className="form">
            <label>Limit m <input type="number" min={5} value={spec.rules.exit_distance_m ?? 0}
              onChange={(e) => up({ rules: { ...spec.rules, exit_distance_m: Number(e.target.value) } })} /></label>
            <label className="wide">Source <input value={spec.rules.exit_distance_source ?? ""} placeholder="your code and section"
              onChange={(e) => up({ rules: { ...spec.rules, exit_distance_source: e.target.value } })} /></label>
          </div>
        ) : <p className="hint">Default: IBC Table 1017.2, occupancy F-1: 60.96 m, or 76.2 m with sprinklers.</p>}
        {hasForklift && (
          <div className="form">
            <label>Forklift aisle m <input type="number" min={0.5} step={0.1} value={spec.rules.forklift_aisle_m ?? ""} placeholder="TBD"
              onChange={(e) => up({ rules: { ...spec.rules, forklift_aisle_m: e.target.value === "" ? null : Number(e.target.value) } })} /></label>
            <label className="wide">Source <input value={spec.rules.forklift_aisle_source ?? ""} placeholder="OSHA gives no number"
              onChange={(e) => up({ rules: { ...spec.rules, forklift_aisle_source: e.target.value } })} /></label>
          </div>
        )}
        <p className="hint">Always on: no overlap, exit reach (OSHA 1910.37), aisle width 0.711 m (OSHA 1910.36), panel load 80% (NEC 210.20(A)), line flow.</p>
      </div>
      {outside > 0 && <p className="bad">{outside} item(s) are outside the new size and will be dropped.</p>}
      <div className="actions sticky">
        <button className="primary" disabled={busy || !spec.exits.length || (!editing && !spec.name.trim())} onClick={onSave}>
          {editing ? "Save and re-check" : "Create floor and check it"}</button>
        <button onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </div>
  );
}
