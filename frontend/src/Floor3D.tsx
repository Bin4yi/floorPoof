import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Exit, Item, ItemType, Panel, Pick, Suggestion, Zone } from "./types";
import { size } from "./draft";
import { Cable, Clock, GridFloor, Label, Ribbon, TIME, crowdColor, heatColor, outlineGeometry, usePulse } from "./fx";
import { ItemModel } from "./models";

export interface Load { name: string; kind: string; kw: number; limit_kw: number; capacity_kw: number }
export interface PathInfo { exit: string; cells: [number, number][]; m: number }
export interface BuildHooks {
  tool: string | null;
  preview: { x0: number; y0: number; x1: number; y1: number; kind: string } | null;
  onDown: (x: number, y: number) => void;
  onMove: (x: number, y: number) => void;
  onUp: (x: number, y: number) => void;
}

interface Props {
  floor: { cols: number; rows: number; cell_m: number };
  itemTypes: ItemType[]; zones: Zone[]; exits: Exit[]; panels: Panel[];
  items: Item[];
  changedIds: Set<string>;
  selectedId: string | null;
  placing: { type: string; rotation: number } | null;
  redCells: [number, number][];
  editable: boolean;
  loads: Load[];
  paths: Record<string, PathInfo>;
  showPaths: boolean; showPower: boolean; showHeat: boolean;
  suggestion: Suggestion | null;
  routes?: { line: Route[]; flow: Route[] } | null;
  crowd?: [number, number, number][] | null;
  showLine?: boolean; showFlow?: boolean; showCrowd?: boolean;
  build?: BuildHooks;
  onSelect: (id: string | null) => void;
  onPlace: (x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onHover: (text: string | null) => void;
  onPick: (p: Pick) => void;
}

export interface Route { a: string; b: string; m: number | null; cells: [number, number][]; line?: string; flow?: string }

// Light theme colours. Status colours are kept for pass/fail only.
export const COL = {
  ok: "#12b76a", bad: "#e34948", warn: "#eda100", blue: "#2a78d6", select: "#1d4ed8",
  line: "#eb6834", flow: "#6250d6", exit: "#2a78d6", power: "#0e9fb8", feed: "#6250d6",
};
const ZONE_STYLE: Record<string, { color: string; opacity: number }> = {
  aisle: { color: "#eda100", opacity: 0.16 }, forklift_aisle: { color: "#eb6834", opacity: 0.14 },
};
const PANEL_H: Record<string, number> = { main_breaker: 2.2, sub_panel: 1.7, drop_box: 1.1 };

let controls: OrbitControls | null = null;

/** Place the camera so the whole floor fits the view, for this panel's shape. Runs once per floor size. */
function FitCamera({ W, D }: { W: number; D: number }) {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(size.height, 1);
    const v = (cam.fov * Math.PI) / 180;
    const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
    const dist = Math.max((W * 0.56) / Math.tan(h / 2), (D * 0.9) / Math.tan(v / 2)) + D * 0.35;
    const dir = new THREE.Vector3(0, 0.78, 0.63).normalize();
    cam.position.copy(dir.multiplyScalar(dist));
    cam.lookAt(0, 0, 0);
    controls?.target.set(0, 0, 0);
    controls?.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W, D]);
  return null;
}

/** window.__fpProject(x, y, h) gives the screen point of a floor cell, for scripted demos and tests. */
function ProjectHook({ toWorld }: { toWorld: (x: number, y: number) => [number, number] }) {
  const { camera, size, gl } = useThree();
  useEffect(() => {
    (window as any).__fpProject = (x: number, y: number, h = 0) => {
      const [wx, wz] = toWorld(x + 0.5, y + 0.5);
      const v = new THREE.Vector3(wx, h, wz).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * size.width, y: r.top + ((1 - v.y) / 2) * size.height };
    };
  }, [camera, size, gl, toWorld]);
  return null;
}

function Controls({ target }: { target: [number, number, number] }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.maxPolarAngle = Math.PI / 2.15;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.target.set(...target);
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls = c;
    let raf = 0;
    const tick = () => { c.update(); raf = requestAnimationFrame(tick); };
    tick();
    const up = () => { c.enabled = true; };
    window.addEventListener("pointerup", up);
    return () => { cancelAnimationFrame(raf); c.dispose(); window.removeEventListener("pointerup", up); controls = null; };
  }, [camera, gl]);
  return null;
}
const holdCamera = () => { if (controls) controls.enabled = false; };

function Cells({ cells, toWorld, cell, color, y, pulse }: {
  cells: [number, number][]; toWorld: (x: number, y: number) => [number, number]; cell: number; color: string; y: number; pulse?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  usePulse(mat, "opacity", 5, 0.35, 0.95);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    cells.forEach(([x, z], i) => {
      const [wx, wz] = toWorld(x + 0.5, z + 0.5);
      m.makeTranslation(wx, y, wz);
      ref.current!.setMatrixAt(i, m);
    });
    ref.current!.count = cells.length;
    ref.current!.instanceMatrix.needsUpdate = true;
  }, [cells, toWorld, y]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(cells.length, 1)]} key={cells.length} raycast={() => null}>
      <boxGeometry args={[cell * 0.9, 0.05, cell * 0.9]} />
      <meshBasicMaterial ref={pulse ? mat : undefined} color={color} transparent opacity={0.85} toneMapped={false} />
    </instancedMesh>
  );
}

function Heat({ s, toWorld, cell }: { s: Suggestion; toWorld: (x: number, y: number) => [number, number]; cell: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  // Draw each candidate at its footprint centre cell; keep the best score per cell.
  const cells = useMemo(() => {
    const best = new Map<string, [number, number, number]>();
    const ox = Math.floor(s.w / 2), oy = Math.floor(s.d / 2);
    for (const [x, y, v] of s.heat) {
      const k = `${x + ox},${y + oy}`;
      const cur = best.get(k);
      if (!cur || cur[2] < v) best.set(k, [x + ox, y + oy, v]);
    }
    return [...best.values()];
  }, [s]);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const vals = cells.map((c) => c[2]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const m = new THREE.Matrix4();
    cells.forEach(([x, z, v], i) => {
      const [wx, wz] = toWorld(x + 0.5, z + 0.5);
      m.makeTranslation(wx, 0.025, wz);
      ref.current!.setMatrixAt(i, m);
      ref.current!.setColorAt(i, heatColor(hi > lo ? (v - lo) / (hi - lo) : 1));
    });
    ref.current.count = cells.length;
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [cells, toWorld]);
  if (!cells.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} key={cells.length} raycast={() => null}>
      <boxGeometry args={[cell * 0.8, 0.02, cell * 0.8]} />
      <meshBasicMaterial transparent opacity={0.5} toneMapped={false} depthWrite={false} />
    </instancedMesh>
  );
}

function Beacon({ p, c, toWorld, onPick, onHover }: {
  p: Pick; c: number; toWorld: (x: number, y: number) => [number, number]; onPick: (p: Pick) => void; onHover: (t: string | null) => void;
}) {
  const [x, z] = toWorld(p.x + p.w / 2, p.y + p.d / 2);
  const W = p.w * c, D = p.d * c;
  const col = p.passed ? COL.ok : COL.bad;
  const beam = useRef<THREE.Mesh>(null);
  usePulse(beam, "scale", 3, 0.85, 1.1);
  const edges = useMemo(() => outlineGeometry(W, 0.02, D), [W, D]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.04, 0]} onClick={(e) => { e.stopPropagation(); if (p.passed) onPick(p); }}
            onPointerOver={(e) => { e.stopPropagation(); onHover(`Pick ${p.rank}: ${p.passed ? "proven by the graph checks" : "fails " + p.failed.join(", ")} · ${p.why.join(" · ")}${p.passed ? " · click or press " + p.rank : ""}`); }}
            onPointerOut={() => onHover(null)}>
        <boxGeometry args={[W, 0.04, D]} />
        <meshBasicMaterial color={col} transparent opacity={0.18} depthWrite={false} toneMapped={false} />
      </mesh>
      <lineSegments geometry={edges} position={[0, 0.06, 0]}><lineBasicMaterial color={col} toneMapped={false} /></lineSegments>
      <mesh ref={beam} position={[0, 2.2, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.06, 0.25, 4.4, 12, 1, true]} />
        <meshBasicMaterial color={col} transparent opacity={0.2} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <Label text={`${p.rank}${p.passed ? " ✓" : " ✗"}`} position={[0, 4.7, 0]} color={col} size={0.8} />
    </group>
  );
}

function ExitGate({ e, toWorld, c, cols, rows }: { e: Exit; toWorld: (x: number, y: number) => [number, number]; c: number; cols: number; rows: number }) {
  const [x, z] = toWorld(e.x + 0.5, e.y + 0.5);
  const alongZ = e.x === 0 || e.x === cols - 1; // gate on the west or east wall spans along z
  const beam = useRef<THREE.MeshBasicMaterial>(null);
  usePulse(beam, "opacity", 2.5, 0.12, 0.35);
  const span = c * 2.4;
  return (
    <group position={[x, 0, z]} rotation={[0, alongZ ? Math.PI / 2 : 0, 0]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * span / 2, 1.1, 0]}><boxGeometry args={[0.08, 2.2, 0.08]} />
          <meshBasicMaterial color={COL.ok} toneMapped={false} /></mesh>))}
      <mesh position={[0, 2.2, 0]}><boxGeometry args={[span + 0.08, 0.08, 0.08]} /><meshBasicMaterial color={COL.ok} toneMapped={false} /></mesh>
      <mesh position={[0, 1.1, 0]} raycast={() => null}><planeGeometry args={[span, 2.2]} />
        <meshBasicMaterial ref={beam} color={COL.ok} transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} /></mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} raycast={() => null}><ringGeometry args={[c * 0.8, c * 1.1, 32]} />
        <meshBasicMaterial color={COL.ok} transparent opacity={0.8} toneMapped={false} /></mesh>
      <Label text={`EXIT ${e.name}`} position={[0, 2.75, 0]} color={COL.ok} size={0.5} />
    </group>
  );
}

function PanelTower({ p, load, toWorld, c, onHover }: {
  p: Panel; load?: Load; toWorld: (x: number, y: number) => [number, number]; c: number; onHover: (t: string | null) => void;
}) {
  const [x, z] = toWorld(p.x + 0.5, p.y + 0.5);
  const h = PANEL_H[p.kind] ?? 1.2;
  const ratio = load ? load.kw / Math.max(load.limit_kw, 0.01) : 0;
  const col = ratio > 1 ? COL.bad : ratio > 0.85 ? COL.warn : COL.power;
  const ring = useRef<THREE.Mesh>(null);
  usePulse(ring, "scale", ratio > 1 ? 6 : 1.5, 0.9, 1.15);
  const r = c * (p.kind === "main_breaker" ? 0.55 : p.kind === "sub_panel" ? 0.45 : 0.35);
  return (
    <group position={[x, 0, z]}
           onPointerOver={(e) => { e.stopPropagation(); onHover(`${p.name} · ${p.kind.replace("_", " ")} · ${load ? `${load.kw} / ${load.limit_kw} kW (80% of ${p.capacity_kw} kW)` : `${p.capacity_kw} kW`}${p.fed_by ? ` · fed by ${p.fed_by}` : ""}`); }}
           onPointerOut={() => onHover(null)}>
      <mesh position={[0, h / 2, 0]} castShadow><cylinderGeometry args={[r, r * 1.1, h, 6]} />
        <meshStandardMaterial color="#e9eef4" metalness={0.2} roughness={0.4} transparent opacity={0.75} /></mesh>
      {/* load fill: a glowing core that rises with the load */}
      <mesh position={[0, (h * Math.min(ratio, 1)) / 2 + 0.02, 0]} raycast={() => null}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, Math.max(h * Math.min(ratio, 1), 0.02), 6]} />
        <meshBasicMaterial color={col} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, h + 0.05, 0]} raycast={() => null}>
        <torusGeometry args={[r * 1.25, 0.035, 8, 32]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
      <Label text={`${p.name}${load ? ` ${Math.round(ratio * 100)}%` : ""}`} position={[0, h + 0.55, 0]} color={col} size={0.42} />
    </group>
  );
}

function SelectRing({ W, D }: { W: number; D: number }) {
  const ref = useRef<THREE.Group>(null);
  const r = Math.max(W, D) * 0.62 + 0.2;
  usePulse(ref, "scale", 3, 0.96, 1.04);
  return (
    <group ref={ref}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, 0]} raycast={() => null}>
        <ringGeometry args={[r, r + 0.1, 48]} /><meshBasicMaterial color={COL.select} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh position={[0, 3, 0]} raycast={() => null}>
        <cylinderGeometry args={[r * 0.98, r, 6, 32, 1, true]} />
        <meshBasicMaterial color={COL.select} transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function ItemView({ it, t, c, toWorld, pos, selected, changed, failing, editable, onDown, onUp, onSelect, onHover }: {
  it: Item; t: ItemType | undefined; c: number; toWorld: (x: number, y: number) => [number, number];
  pos: { x: number; y: number }; selected: boolean; changed: boolean; failing: boolean; editable: boolean;
  onDown: (e: ThreeEvent<PointerEvent>) => void; onUp: () => void; onSelect: () => void; onHover: (t: string | null) => void;
}) {
  const [x, z] = toWorld(pos.x + it.w / 2, pos.y + it.d / 2);
  const W = it.w * c, D = it.d * c;
  const [W0, D0] = it.rotation === 90 || it.rotation === 270 ? [D, W] : [W, D];
  const edges = useMemo(() => outlineGeometry(W * 0.99, it.h, D * 0.99), [W, D, it.h]);
  const edgeCol = failing ? COL.bad : selected ? COL.select : changed ? COL.blue : (t?.color ?? COL.blue);
  return (
    <group position={[x, 0, z]}
           onPointerDown={(e) => { if (!editable) return; e.stopPropagation(); onDown(e); }}
           onPointerUp={onUp}
           onClick={(e) => { e.stopPropagation(); onSelect(); }}
           onPointerOver={(e) => { e.stopPropagation(); onHover(`${it.id} · ${t?.label ?? it.type}${it.line ? ` · line ${it.line}` : ""}${it.panel ? ` · ${it.panel}` : ""}${t?.kw ? ` · ${t.kw} kW` : ""}`); }}
           onPointerOut={() => onHover(null)}>
      <group rotation={[0, (it.rotation * Math.PI) / 180, 0]}>
        <ItemModel t={t} W={W0} D={D0} H={it.h} />
      </group>
      <lineSegments geometry={edges} position={[0, it.h / 2, 0]} raycast={() => null}>
        <lineBasicMaterial color={edgeCol} transparent opacity={selected || failing ? 1 : changed ? 0.95 : 0.45} toneMapped={false} />
      </lineSegments>
      {/* invisible hit box, so the whole footprint is easy to grab */}
      <mesh position={[0, it.h / 2, 0]} visible={false}><boxGeometry args={[W, it.h, D]} /></mesh>
      {selected && <SelectRing W={W} D={D} />}
      {(selected || changed) && <Label text={it.id} position={[0, it.h + 0.5, 0]} color={changed ? COL.blue : COL.select} size={0.42} />}
      {failing && <Label text="⚠" position={[0, it.h + 0.5, 0]} color={COL.bad} size={0.7} bg={false} />}
    </group>
  );
}

export default function Floor3D(p: Props) {
  const { cols, rows, cell_m: c } = p.floor;
  const W = cols * c, D = rows * c;
  const toWorld = useMemo(() => (x: number, y: number): [number, number] => [x * c - W / 2, y * c - D / 2], [c, W, D]);
  const types = useMemo(() => Object.fromEntries(p.itemTypes.map((t) => [t.name, t])), [p.itemTypes]);
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);
  const loads = useMemo(() => Object.fromEntries(p.loads.map((l) => [l.name, l])), [p.loads]);

  const cellOf = (pt: THREE.Vector3): [number, number] =>
    [Math.min(cols - 1, Math.max(0, Math.floor((pt.x + W / 2) / c))), Math.min(rows - 1, Math.max(0, Math.floor((pt.z + D / 2) / c)))];

  const failing = useMemo(() => {
    const red = new Set(p.redCells.map(([x, y]) => `${x},${y}`));
    const out = new Set<string>();
    if (!red.size) return out;
    for (const it of p.items)
      for (let i = 0; i < it.w && !out.has(it.id); i++)
        for (let j = 0; j < it.d; j++) if (red.has(`${it.x + i},${it.y + j}`)) { out.add(it.id); break; }
    return out;
  }, [p.redCells, p.items]);

  const ghostSize = p.placing && types[p.placing.type] ? size(types[p.placing.type], p.placing.rotation) : null;
  const ghost = ghostSize && hoverCell
    ? { x: hoverCell[0] - Math.floor(ghostSize[0] / 2), y: hoverCell[1] - Math.floor(ghostSize[1] / 2), w: ghostSize[0], d: ghostSize[1] }
    : null;
  const anchors = useMemo(() => new Set((p.suggestion?.heat ?? []).map(([x, y]) => `${x},${y}`)), [p.suggestion]);
  const ghostOk = ghost ? (p.suggestion && p.suggestion.type === p.placing?.type && p.suggestion.rotation === p.placing?.rotation
    ? anchors.has(`${ghost.x},${ghost.y}`) : true) : false;

  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    const [x, y] = cellOf(e.point);
    setHoverCell([x, y]);
    if (drag) setDrag({ ...drag, x: x - drag.dx, y: y - drag.dy });
    p.build?.onMove(x, y);
  };
  const onFloorUp = (e?: ThreeEvent<PointerEvent>) => {
    if (drag) {
      const it = p.items.find((i) => i.id === drag.id);
      if (it && (it.x !== drag.x || it.y !== drag.y)) p.onMove(drag.id, drag.x, drag.y);
      setDrag(null);
    }
    if (p.build && e) { const [x, y] = cellOf(e.point); p.build.onUp(x, y); }
  };
  const onFloorDown = (e: ThreeEvent<PointerEvent>) => {
    if (p.build?.tool && e.button === 0) {
      holdCamera();
      const [x, y] = cellOf(e.point);
      p.build.onDown(x, y);
    }
  };
  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || p.build) return; // a camera drag, or the builder handles it
    if (p.placing && ghost) p.onPlace(ghost.x, ghost.y);
    else p.onSelect(null);
  };

  const pathList = useMemo(() => {
    const out: { id: string; pts: [number, number][]; sel: boolean }[] = [];
    for (const [id, info] of Object.entries(p.paths)) {
      const sel = id === p.selectedId;
      if (!sel && !p.showPaths) continue;
      if (!info.cells || info.cells.length < 2) continue;
      out.push({ id, sel, pts: info.cells.map(([x, y]) => toWorld(x + 0.5, y + 0.5)) });
    }
    return out;
  }, [p.paths, p.selectedId, p.showPaths, toWorld]);

  const panelsBy = useMemo(() => Object.fromEntries(p.panels.map((x) => [x.name, x])), [p.panels]);
  const target: [number, number, number] = [0, 0, 0];
  const bestPick = p.suggestion?.picks.find((x) => x.passed);

  return (
    <Canvas camera={{ position: [0, Math.max(W, D * 1.4) * 0.5 + 3, D * 0.5 + Math.max(W, D * 1.4) * 0.55], fov: 42, near: 0.1, far: 900 }} shadows
            dpr={[1, 2]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
            onPointerMissed={() => p.onSelect(null)}>
      <color attach="background" args={["#eef3f9"]} />
      <fog attach="fog" args={["#eef3f9", Math.max(W, D) * 1.1, Math.max(W, D) * 2.8]} />
      <Clock />
      <ambientLight intensity={0.75} />
      <hemisphereLight args={["#ffffff", "#c9d6e6", 0.7]} />
      <directionalLight position={[W * 0.3, 40, D * 0.5]} intensity={1.5} castShadow
                        shadow-mapSize={[2048, 2048]} shadow-camera-left={-W / 1.6} shadow-camera-right={W / 1.6}
                        shadow-camera-top={D / 1.2} shadow-camera-bottom={-D / 1.2} />
      <Controls target={target} />
      <FitCamera W={W} D={D} />
      <ProjectHook toWorld={toWorld} />

      <GridFloor W={W} D={D} cols={cols} rows={rows} receiveShadow onPointerMove={onFloorMove} onPointerUp={onFloorUp}
                 onPointerDown={onFloorDown} onClick={onFloorClick} onPointerLeave={() => setHoverCell(null)} />
      {/* shadow catcher over the shader floor */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.003, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[W, D]} /><shadowMaterial opacity={0.16} />
      </mesh>
      <Border W={W} D={D} />

      {p.zones.map((z) => {
        const [x0, y0] = toWorld(z.x0, z.y0);
        const w = (z.x1 - z.x0 + 1) * c, d = (z.y1 - z.y0 + 1) * c;
        const st = ZONE_STYLE[z.kind] ?? { color: "#6250d6", opacity: 0.07 };
        return <ZoneMark key={z.name} name={z.name} kind={z.kind} x={x0 + w / 2} z={y0 + d / 2} w={w} d={d} color={st.color} opacity={st.opacity} />;
      })}
      {p.build?.preview && (() => {
        const b = p.build.preview;
        const [x0, y0] = toWorld(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
        const w = (Math.abs(b.x1 - b.x0) + 1) * c, d = (Math.abs(b.y1 - b.y0) + 1) * c;
        return <ZoneMark name="" kind={b.kind} x={x0 + w / 2} z={y0 + d / 2} w={w} d={d} color={COL.select} opacity={0.18} />;
      })()}

      {p.exits.map((e) => <ExitGate key={e.name} e={e} toWorld={toWorld} c={c} cols={cols} rows={rows} />)}
      {p.panels.map((pn) => <PanelTower key={pn.name} p={pn} load={loads[pn.name]} toWorld={toWorld} c={c} onHover={p.onHover} />)}

      {p.showPower && p.panels.filter((pn) => pn.fed_by && panelsBy[pn.fed_by]).map((pn) => {
        const a = toWorld(pn.x + 0.5, pn.y + 0.5), q = panelsBy[pn.fed_by!], b = toWorld(q.x + 0.5, q.y + 0.5);
        return <Cable key={`f-${pn.name}`} from={[a[0], PANEL_H[pn.kind] ?? 1.2, a[1]]} to={[b[0], PANEL_H[q.kind] ?? 1.2, b[1]]}
                      color={COL.feed} opacity={0.75} lift={2.5} />;
      })}
      {p.showPower && p.items.filter((it) => it.panel && panelsBy[it.panel]).map((it) => {
        const a = toWorld(it.x + it.w / 2, it.y + it.d / 2), q = panelsBy[it.panel!], b = toWorld(q.x + 0.5, q.y + 0.5);
        const sel = it.id === p.selectedId;
        return <Cable key={`c-${it.id}`} from={[a[0], it.h, a[1]]} to={[b[0], PANEL_H[q.kind] ?? 1.2, b[1]]}
                      color={sel ? COL.select : COL.power} opacity={sel ? 1 : 0.4} lift={0.8} />;
      })}

      {p.items.map((it) => {
        const pos = drag && drag.id === it.id ? { x: drag.x, y: drag.y } : it;
        return (
          <ItemView key={it.id} it={it} t={types[it.type]} c={c} toWorld={toWorld} pos={pos}
                    selected={it.id === p.selectedId} changed={p.changedIds.has(it.id)} failing={failing.has(it.id)}
                    editable={p.editable && !p.placing && !p.build}
                    onDown={(e) => {
                      holdCamera();
                      const [cx, cy] = cellOf(e.point);
                      p.onSelect(it.id);
                      setDrag({ id: it.id, dx: cx - it.x, dy: cy - it.y, x: it.x, y: it.y });
                    }}
                    onUp={() => onFloorUp()} onSelect={() => !p.build && p.onSelect(it.id)} onHover={p.onHover} />
        );
      })}

      {pathList.map((x) => (
        <Ribbon key={`p-${x.id}`} points={x.pts} color={x.sel ? COL.select : COL.exit} width={x.sel ? 0.28 : 0.14}
                opacity={x.sel ? 1 : 0.55} speed={x.sel ? 1.6 : 0.8} />
      ))}

      {p.showHeat && p.suggestion && <Heat s={p.suggestion} toWorld={toWorld} cell={c} />}
      {p.suggestion?.picks.map((pk) => <Beacon key={`b-${pk.rank}`} p={pk} c={c} toWorld={toWorld} onPick={p.onPick} onHover={p.onHover} />)}
      {bestPick && bestPick.path.length > 1 && (
        <Ribbon points={bestPick.path.map(([x, y]) => toWorld(x + 0.5, y + 0.5))} color={COL.ok} width={0.24} opacity={0.95} speed={1.8} y={0.07} />
      )}

      {ghost && p.placing && (
        <group position={[toWorld(ghost.x + ghost.w / 2, 0)[0], 0, toWorld(0, ghost.y + ghost.d / 2)[1]]}>
          <group rotation={[0, (p.placing.rotation * Math.PI) / 180, 0]}>
            {(() => {
              const t = types[p.placing.type];
              const [W0, D0] = p.placing.rotation === 90 || p.placing.rotation === 270 ? [ghost.d * c, ghost.w * c] : [ghost.w * c, ghost.d * c];
              return <ItemModel t={t} W={W0} D={D0} H={t.h} look={ghostOk ? "ghost-ok" : "ghost-bad"} />;
            })()}
          </group>
          <GhostBox w={ghost.w * c} d={ghost.d * c} h={types[p.placing.type].h} ok={ghostOk} />
        </group>
      )}
      {p.redCells.length > 0 && <Cells cells={p.redCells} toWorld={toWorld} cell={c} color={COL.bad} y={0.035} pulse />}
      {p.showCrowd && p.crowd && p.crowd.length > 0 && <Crowd cells={p.crowd} toWorld={toWorld} cell={c} />}
      {p.showLine && p.routes?.line.map((r, i) => (
        <Ribbon key={`l-${i}`} points={r.cells.map(([x, y]) => toWorld(x + 0.5, y + 0.5))} color={COL.line} width={0.2} opacity={0.9} speed={1.4} y={0.08} />))}
      {p.showFlow && p.routes?.flow.map((r, i) => (
        <Ribbon key={`f-${i}`} points={r.cells.map(([x, y]) => toWorld(x + 0.5, y + 0.5))} color={COL.flow} width={0.2} opacity={0.85} speed={1.0} y={0.09} />))}
    </Canvas>
  );
}

function GhostBox({ w, d, h, ok }: { w: number; d: number; h: number; ok: boolean }) {
  const edges = useMemo(() => outlineGeometry(w, h, d), [w, d, h]);
  return (
    <>
      <lineSegments geometry={edges} position={[0, h / 2, 0]} raycast={() => null}>
        <lineBasicMaterial color={ok ? COL.ok : COL.bad} toneMapped={false} />
      </lineSegments>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, 0]} raycast={() => null}>
        <planeGeometry args={[w, d]} /><meshBasicMaterial color={ok ? COL.ok : COL.bad} transparent opacity={0.25} depthWrite={false} />
      </mesh>
    </>
  );
}

function Border({ W, D }: { W: number; D: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(
      [-W / 2, 0, -D / 2, W / 2, 0, -D / 2, W / 2, 0, D / 2, -W / 2, 0, D / 2, -W / 2, 0, -D / 2], 3));
    return g;
  }, [W, D]);
  const wall = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: TIME },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.22 * (0.85 + 0.15 * sin(uTime * 1.5 + vUv.x * 40.0)); gl_FragColor = vec4(0.16, 0.47, 0.84, a); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }), []);
  const h = 0.9;
  return (
    <>
      <LineStrip geom={geom} color="#5b7fae" opacity={1} />
      {[[0, -D / 2, W, 0], [0, D / 2, W, 0], [-W / 2, 0, D, Math.PI / 2], [W / 2, 0, D, Math.PI / 2]].map(([x, z, len, r], i) => (
        <mesh key={i} position={[x, h / 2, z]} rotation={[0, r, 0]} material={wall} raycast={() => null}>
          <planeGeometry args={[len, h]} />
        </mesh>
      ))}
    </>
  );
}

function ZoneMark({ name, kind, x, z, w, d, color, opacity }: {
  name: string; kind: string; x: number; z: number; w: number; d: number; color: string; opacity: number;
}) {
  const edges = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(
      [-w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2, -w / 2, 0, -d / 2], 3));
    return g;
  }, [w, d]);
  const isAisle = kind === "aisle" || kind === "forklift_aisle";
  return (
    <group position={[x, 0, z]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]} raycast={() => null}>
        <planeGeometry args={[w, d]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
      </mesh>
      <group position={[0, 0.02, 0]}><LineStrip geom={edges} color={color} opacity={isAisle ? 0.9 : 0.6} /></group>
      {name && <Label text={name.toUpperCase()} position={[0, 0.35, 0]} color={color} size={0.38} bg={false} />}
    </group>
  );
}

function LineStrip({ geom, color, opacity }: { geom: THREE.BufferGeometry; color: string; opacity: number }) {
  const obj = useMemo(() => new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false })),
                      [geom, color, opacity]);
  return <primitive object={obj} raycast={() => null} />;
}
function Crowd({ cells, toWorld, cell }: { cells: [number, number, number][]; toWorld: (x: number, y: number) => [number, number]; cell: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const hi = Math.max(...cells.map((c) => c[2]));
    const m = new THREE.Matrix4();
    cells.forEach(([x, z, n], i) => {
      const [wx, wz] = toWorld(x + 0.5, z + 0.5);
      const h = 0.05 + (n / hi) * 0.6;
      m.makeScale(1, h, 1).setPosition(wx, h / 2, wz);
      ref.current!.setMatrixAt(i, m);
      ref.current!.setColorAt(i, crowdColor(n / hi));
    });
    ref.current.count = cells.length;
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [cells, toWorld]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, cells.length]} key={cells.length} raycast={() => null}>
      <boxGeometry args={[cell * 0.85, 1, cell * 0.85]} />
      <meshBasicMaterial transparent opacity={0.75} toneMapped={false} depthWrite={false} />
    </instancedMesh>
  );
}
