import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, ThreeEvent, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { FloorData, Item } from "./types";
import { size } from "./draft";

interface Props {
  data: FloorData;
  items: Item[];
  changedIds: Set<string>;
  selectedId: string | null;
  placing: { type: string; rotation: number } | null;
  redCells: [number, number][];
  editable: boolean;
  onSelect: (id: string | null) => void;
  onPlace: (x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onHover: (text: string | null) => void;
}

function Controls({ enabled }: { enabled: boolean }) {
  const { camera, gl } = useThree();
  const ref = useRef<OrbitControls>();
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.maxPolarAngle = Math.PI / 2.2;
    c.enableDamping = true;
    ref.current = c;
    let raf = 0;
    const tick = () => { c.update(); raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); c.dispose(); };
  }, [camera, gl]);
  useEffect(() => { if (ref.current) ref.current.enabled = enabled; }, [enabled]);
  return null;
}

function Cells({ cells, toWorld, cell, color, y }: {
  cells: [number, number][]; toWorld: (x: number, y: number) => [number, number]; cell: number; color: string; y: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
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
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(cells.length, 1)]} key={cells.length}>
      <boxGeometry args={[cell * 0.92, 0.04, cell * 0.92]} />
      <meshBasicMaterial color={color} transparent opacity={0.85} />
    </instancedMesh>
  );
}

function GridLines({ cols, rows, cell }: { cols: number; rows: number; cell: number }) {
  const geom = useMemo(() => {
    const W = cols * cell, D = rows * cell, pts: number[] = [];
    for (let x = 0; x <= cols; x++) pts.push(x * cell - W / 2, 0, -D / 2, x * cell - W / 2, 0, D / 2);
    for (let y = 0; y <= rows; y++) pts.push(-W / 2, 0, y * cell - D / 2, W / 2, 0, y * cell - D / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [cols, rows, cell]);
  return (
    <lineSegments geometry={geom} position={[0, 0.005, 0]}>
      <lineBasicMaterial color="#cfd6de" transparent opacity={0.5} />
    </lineSegments>
  );
}

const ZONE_COLORS: Record<string, string> = { aisle: "#f2d16b", forklift_aisle: "#f0a35e" };
const PANEL_COLORS: Record<string, string> = { drop_box: "#2f3b4a", sub_panel: "#1f6f8b", main_breaker: "#0b3954" };

export default function Floor3D(p: Props) {
  const { cols, rows, cell_m: c } = p.data.floor;
  const W = cols * c, D = rows * c;
  const toWorld = useMemo(() => (x: number, y: number): [number, number] => [x * c - W / 2, y * c - D / 2], [c, W, D]);
  const types = useMemo(() => Object.fromEntries(p.data.item_types.map((t) => [t.name, t])), [p.data.item_types]);
  const [hoverCell, setHoverCell] = useState<[number, number] | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);

  const cellOf = (pt: THREE.Vector3): [number, number] =>
    [Math.floor((pt.x + W / 2) / c), Math.floor((pt.z + D / 2) / c)];

  const onFloorMove = (e: ThreeEvent<PointerEvent>) => {
    const [x, y] = cellOf(e.point);
    setHoverCell([x, y]);
    if (drag) setDrag({ ...drag, x: x - drag.dx, y: y - drag.dy });
  };
  const onFloorUp = () => {
    if (drag) {
      const it = p.items.find((i) => i.id === drag.id);
      if (it && (it.x !== drag.x || it.y !== drag.y)) p.onMove(drag.id, drag.x, drag.y);
      setDrag(null);
    }
  };
  const onFloorClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // it was a camera drag
    const [x, y] = cellOf(e.point);
    if (p.placing) p.onPlace(x, y);
    else p.onSelect(null);
  };

  const ghost = p.placing && hoverCell && types[p.placing.type]
    ? (() => { const [w, d] = size(types[p.placing.type], p.placing.rotation); return { x: hoverCell[0], y: hoverCell[1], w, d, h: types[p.placing.type].h }; })()
    : null;

  return (
    <Canvas camera={{ position: [0, Math.max(W, D) * 0.75, D * 1.1], fov: 45 }} shadows>
      <color attach="background" args={["#eef2f6"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[W * 0.3, 40, D * 0.4]} intensity={0.9} castShadow />
      <Controls enabled={!drag} />
      <mesh rotation-x={-Math.PI / 2} receiveShadow onPointerMove={onFloorMove} onPointerUp={onFloorUp}
            onClick={onFloorClick} onPointerLeave={() => setHoverCell(null)}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <GridLines cols={cols} rows={rows} cell={c} />
      {p.data.zones.map((z) => {
        const [x0, y0] = toWorld(z.x0, z.y0);
        const w = (z.x1 - z.x0 + 1) * c, d = (z.y1 - z.y0 + 1) * c;
        return (
          <mesh key={z.name} rotation-x={-Math.PI / 2} position={[x0 + w / 2, 0.01, y0 + d / 2]} raycast={() => null}>
            <planeGeometry args={[w, d]} />
            <meshBasicMaterial color={ZONE_COLORS[z.kind] ?? "#9ec5e8"} transparent opacity={ZONE_COLORS[z.kind] ? 0.35 : 0.18} />
          </mesh>
        );
      })}
      {p.data.exits.map((e) => {
        const [x, z] = toWorld(e.x + 0.5, e.y + 0.5);
        return (
          <mesh key={e.name} position={[x, 0.6, z]} raycast={() => null}>
            <boxGeometry args={[c, 1.2, c]} />
            <meshStandardMaterial color="#2e9e5b" transparent opacity={0.8} />
          </mesh>
        );
      })}
      {p.data.panels.map((pn) => {
        const [x, z] = toWorld(pn.x + 0.5, pn.y + 0.5);
        const h = pn.kind === "main_breaker" ? 1.8 : pn.kind === "sub_panel" ? 1.4 : 0.9;
        return (
          <mesh key={pn.name} position={[x, h / 2, z]} raycast={() => null}
                onPointerOver={() => p.onHover(`${pn.name} (${pn.kind.replace("_", " ")})`)}>
            <boxGeometry args={[c * 0.6, h, c * 0.6]} />
            <meshStandardMaterial color={PANEL_COLORS[pn.kind] ?? "#333"} />
          </mesh>
        );
      })}
      {p.items.map((it) => {
        const pos = drag?.id === it.id ? { x: drag.x, y: drag.y } : it;
        const [x, z] = toWorld(pos.x + it.w / 2, pos.y + it.d / 2);
        const sel = it.id === p.selectedId;
        const changed = p.changedIds.has(it.id);
        return (
          <mesh key={it.id} position={[x, it.h / 2, z]} castShadow
                onPointerDown={(e) => {
                  if (!p.editable || p.placing) return;
                  e.stopPropagation();
                  const [cx, cy] = cellOf(e.point);
                  p.onSelect(it.id);
                  setDrag({ id: it.id, dx: cx - it.x, dy: cy - it.y, x: it.x, y: it.y });
                }}
                onPointerUp={onFloorUp}
                onClick={(e) => { e.stopPropagation(); p.onSelect(it.id); }}
                onPointerOver={(e) => { e.stopPropagation(); p.onHover(`${it.id} · ${types[it.type]?.label ?? it.type}${it.line ? ` · line ${it.line}` : ""}${it.panel ? ` · ${it.panel}` : ""}`); }}
                onPointerOut={() => p.onHover(null)}>
            <boxGeometry args={[it.w * c * 0.96, it.h, it.d * c * 0.96]} />
            <meshStandardMaterial color={types[it.type]?.color ?? "#888"} emissive={sel ? "#ffcc33" : changed ? "#3355ff" : "#000"}
                                  emissiveIntensity={sel ? 0.55 : changed ? 0.3 : 0} />
          </mesh>
        );
      })}
      {ghost && (
        <mesh position={[toWorld(ghost.x + ghost.w / 2, 0)[0], ghost.h / 2, toWorld(0, ghost.y + ghost.d / 2)[1]]} raycast={() => null}>
          <boxGeometry args={[ghost.w * c, ghost.h, ghost.d * c]} />
          <meshStandardMaterial color="#3355ff" transparent opacity={0.4} />
        </mesh>
      )}
      {p.redCells.length > 0 && <Cells cells={p.redCells} toWorld={toWorld} cell={c} color="#e0302a" y={0.03} />}
    </Canvas>
  );
}
