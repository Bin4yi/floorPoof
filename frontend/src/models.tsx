// Procedural item models built from boxes and cylinders (no model files).
// Every model is drawn unrotated: W across x, D along z, H up, front (operator side) at +z.
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TIME } from "./fx";
import type { ItemType } from "./types";

export const SHAPE_OF: Record<string, string> = {
  sewing_machine: "machine", pressing_machine: "press", cutting_table: "cutting", fabric_rack: "rolls",
  packing_table: "packing", pallet_rack: "rack", oxidizer_pallet: "pallet", flammable_pallet: "drums",
  packing_bench: "packing",
};
export const SHAPES = ["machine", "table", "rack", "press", "tank", "conveyor", "robot", "pallet", "box"];

export function shapeOf(t: ItemType | undefined): string {
  if (!t) return "box";
  return SHAPE_OF[t.name] ?? t.shape ?? "box";
}

type Look = "normal" | "ghost-ok" | "ghost-bad";

interface Mats { body: THREE.Material; dark: THREE.Material; accent: THREE.Material; glow: THREE.Material; metal: THREE.Material }

function useMats(color: string, look: Look, heat: boolean): Mats {
  return useMemo(() => {
    if (look !== "normal") {
      const c = look === "ghost-ok" ? "#12b76a" : "#e34948";
      const holo = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.28, depthWrite: false });
      return { body: holo, dark: holo, accent: holo, glow: holo, metal: holo };
    }
    const col = new THREE.Color(color);
    return {
      body: new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color("#f4f7fb"), 0.78), metalness: 0.15, roughness: 0.45 }),
      dark: new THREE.MeshStandardMaterial({ color: "#3b4658", metalness: 0.4, roughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: "#a3afbf", metalness: 0.6, roughness: 0.3 }),
      accent: new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.18, metalness: 0.2, roughness: 0.45 }),
      glow: new THREE.MeshBasicMaterial({ color: heat ? "#ff7a3d" : col.clone().lerp(new THREE.Color("#ffffff"), 0.35),
                                          toneMapped: false }),
    };
  }, [color, look, heat]);
}

function B({ s, p, m }: { s: [number, number, number]; p: [number, number, number]; m: THREE.Material }) {
  return <mesh position={p} material={m} castShadow><boxGeometry args={s} /></mesh>;
}
function C({ r, h, p, m, rot, seg = 18 }: { r: number; h: number; p: [number, number, number]; m: THREE.Material; rot?: [number, number, number]; seg?: number }) {
  return <mesh position={p} rotation={rot} material={m} castShadow><cylinderGeometry args={[r, r, h, seg]} /></mesh>;
}

function Legs({ W, D, h, m, inset = 0.08 }: { W: number; D: number; h: number; m: THREE.Material; inset?: number }) {
  const x = W / 2 - inset, z = D / 2 - inset;
  return <>{[[-x, -z], [x, -z], [-x, z], [x, z]].map(([a, b], i) => <B key={i} s={[0.06, h, 0.06]} p={[a, h / 2, b]} m={m} />)}</>;
}

function Machine({ W, D, H, m }: Dims & { m: Mats }) {
  const top = H * 0.62;
  return (
    <>
      <Legs W={W * 0.9} D={D * 0.9} h={top} m={m.metal} />
      <B s={[W * 0.92, 0.06, D * 0.9]} p={[0, top, 0]} m={m.body} />
      <B s={[W * 0.92, 0.03, 0.04]} p={[0, top + 0.02, D * 0.45]} m={m.glow} />
      {/* machine head and arm */}
      <B s={[W * 0.18, H * 0.32, D * 0.22]} p={[W * 0.25, top + H * 0.16, -D * 0.1]} m={m.accent} />
      <B s={[W * 0.5, H * 0.08, D * 0.18]} p={[0.05, top + H * 0.3, -D * 0.1]} m={m.accent} />
      <B s={[0.07, H * 0.1, 0.07]} p={[-W * 0.18, top + H * 0.22, -D * 0.1]} m={m.metal} />
      <C r={0.05} h={0.02} p={[W * 0.25, top + H * 0.33, D * 0.02]} m={m.glow} />
    </>
  );
}

function Press({ W, D, H, m }: Dims & { m: Mats }) {
  const ram = useRef<THREE.Group>(null);
  const phase = useMemo(() => Math.random() * 6, []);
  useFrame(() => { if (ram.current) ram.current.position.y = H * (0.74 + 0.07 * Math.sin(TIME.value * 2.2 + phase)); });
  return (
    <>
      <B s={[W * 0.9, H * 0.45, D * 0.85]} p={[0, H * 0.225, 0]} m={m.body} />
      <B s={[W * 0.7, 0.05, D * 0.6]} p={[0, H * 0.47, 0.02]} m={m.glow} />
      <B s={[W * 0.12, H, D * 0.3]} p={[-W * 0.38, H / 2, -D * 0.25]} m={m.dark} />
      <B s={[W * 0.12, H, D * 0.3]} p={[W * 0.38, H / 2, -D * 0.25]} m={m.dark} />
      <B s={[W * 0.88, H * 0.14, D * 0.4]} p={[0, H * 0.93, -D * 0.15]} m={m.accent} />
      <group ref={ram}>
        <B s={[W * 0.62, H * 0.08, D * 0.5]} p={[0, 0, 0]} m={m.accent} />
        <C r={0.08} h={H * 0.2} p={[0, H * 0.12, -D * 0.1]} m={m.metal} />
      </group>
      <B s={[W * 0.2, 0.05, 0.05]} p={[0, H * 0.3, D * 0.43]} m={m.glow} />
    </>
  );
}

function Table({ W, D, H, m, kind }: Dims & { m: Mats; kind: "table" | "cutting" | "packing" }) {
  const top = H * 0.95;
  const laser = useRef<THREE.Mesh>(null);
  useFrame(() => { if (laser.current) laser.current.position.x = Math.sin(TIME.value * 0.8) * W * 0.42; });
  return (
    <>
      <Legs W={W} D={D} h={top} m={m.metal} />
      <B s={[W * 0.98, 0.07, D * 0.96]} p={[0, top, 0]} m={m.body} />
      <B s={[W * 0.98, 0.025, 0.03]} p={[0, top + 0.04, D * 0.48]} m={m.glow} />
      <B s={[W * 0.98, 0.025, 0.03]} p={[0, top + 0.04, -D * 0.48]} m={m.accent} />
      {kind === "cutting" && (
        <>
          <B s={[W * 0.9, 0.012, D * 0.85]} p={[0, top + 0.042, 0]} m={m.accent} />
          <mesh ref={laser} position={[0, top + 0.28, 0]} material={m.glow}><boxGeometry args={[0.05, 0.5, D * 0.95]} /></mesh>
          <B s={[0.12, 0.12, D]} p={[0, top + 0.56, 0]} m={m.dark} />
        </>
      )}
      {kind === "packing" && [[-0.28, -0.1, 0.34], [0.05, 0.1, 0.28], [0.3, -0.05, 0.4]].map(([a, b, s], i) => (
        <B key={i} s={[s * D, s * D * 0.8, s * D]} p={[a * W, top + s * D * 0.4 + 0.04, b * D]} m={i === 1 ? m.accent : m.body} />
      ))}
    </>
  );
}

function Rack({ W, D, H, m, kind }: Dims & { m: Mats; kind: "rack" | "rolls" }) {
  const levels = Math.max(2, Math.round(H / 0.7));
  const xs = [-W / 2 + 0.05, W / 2 - 0.05], zs = [-D / 2 + 0.05, D / 2 - 0.05];
  const shelves = Array.from({ length: levels }, (_, i) => (i + 0.15) * (H / levels));
  return (
    <>
      {xs.flatMap((x) => zs.map((z) => <B key={`${x}${z}`} s={[0.07, H, 0.07]} p={[x, H / 2, z]} m={m.accent} />))}
      {shelves.map((y, i) => (
        <group key={i}>
          <B s={[W, 0.04, D]} p={[0, y, 0]} m={m.dark} />
          <B s={[W, 0.02, 0.025]} p={[0, y + 0.03, D / 2]} m={m.glow} />
          {kind === "rolls"
            ? [-0.3, 0, 0.3].map((f, k) => (
                <C key={k} r={Math.min(D, H / levels) * 0.22} h={D * 0.85} rot={[Math.PI / 2, 0, 0]}
                   p={[f * W, y + Math.min(D, H / levels) * 0.25, 0]} m={k === 1 ? m.accent : m.body} />))
            : [-0.3, 0, 0.3].map((f, k) => (
                <B key={k} s={[W * 0.26, (H / levels) * 0.55, D * 0.8]} p={[f * W, y + (H / levels) * 0.3, 0]} m={(i + k) % 3 ? m.body : m.accent} />))}
        </group>
      ))}
    </>
  );
}

function Pallet({ W, D, H, m, drums }: Dims & { m: Mats; drums: boolean }) {
  const ph = 0.14;
  return (
    <>
      <B s={[W, ph, D]} p={[0, ph / 2, 0]} m={m.dark} />
      <B s={[W, 0.02, 0.03]} p={[0, ph + 0.01, D / 2]} m={m.glow} />
      {drums
        ? [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].map(([a, b], i) => (
            <group key={i}>
              <C r={Math.min(W, D) * 0.2} h={H - ph} p={[a * W, ph + (H - ph) / 2, b * D]} m={m.accent} />
              <C r={Math.min(W, D) * 0.205} h={0.03} p={[a * W, ph + (H - ph) * 0.7, b * D]} m={m.glow} />
            </group>))
        : <>
            <B s={[W * 0.9, (H - ph) * 0.95, D * 0.9]} p={[0, ph + (H - ph) / 2, 0]} m={m.accent} />
            <B s={[W * 0.92, 0.03, D * 0.92]} p={[0, ph + (H - ph) * 0.5, 0]} m={m.glow} />
          </>}
    </>
  );
}

function Tank({ W, D, H, m }: Dims & { m: Mats }) {
  const r = Math.min(W, D) * 0.42;
  return (
    <>
      <B s={[W * 0.9, 0.12, D * 0.9]} p={[0, 0.06, 0]} m={m.dark} />
      <C r={r} h={H * 0.85} p={[0, 0.12 + H * 0.425, 0]} m={m.body} seg={28} />
      <C r={r * 1.02} h={0.05} p={[0, H * 0.35, 0]} m={m.glow} seg={28} />
      <C r={r * 1.02} h={0.05} p={[0, H * 0.7, 0]} m={m.accent} seg={28} />
      <mesh position={[0, 0.12 + H * 0.85, 0]} material={m.accent}><sphereGeometry args={[r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
    </>
  );
}

function Conveyor({ W, D, H, m }: Dims & { m: Mats }) {
  const top = Math.max(0.5, H * 0.8);
  const boxes = useRef<THREE.Group>(null);
  useFrame(() => {
    boxes.current?.children.forEach((c, i) => { c.position.x = ((TIME.value * 0.6 + i * (W / 3)) % W) - W / 2; });
  });
  return (
    <>
      <Legs W={W} D={D * 0.8} h={top} m={m.metal} />
      <B s={[W, 0.08, D * 0.8]} p={[0, top, 0]} m={m.dark} />
      <B s={[W, 0.02, 0.03]} p={[0, top + 0.05, D * 0.4]} m={m.glow} />
      <B s={[W, 0.02, 0.03]} p={[0, top + 0.05, -D * 0.4]} m={m.glow} />
      <group ref={boxes}>{[0, 1, 2].map((i) => <B key={i} s={[D * 0.35, D * 0.3, D * 0.4]} p={[0, top + D * 0.19, 0]} m={m.accent} />)}</group>
    </>
  );
}

function Robot({ W, D, H, m }: Dims & { m: Mats }) {
  const arm = useRef<THREE.Group>(null);
  const fore = useRef<THREE.Group>(null);
  useFrame(() => {
    if (arm.current) arm.current.rotation.y = Math.sin(TIME.value * 0.7) * 1.2;
    if (fore.current) fore.current.rotation.z = -0.9 + Math.sin(TIME.value * 1.3) * 0.4;
  });
  const s = Math.min(W, D);
  return (
    <>
      <B s={[W * 0.95, 0.04, D * 0.95]} p={[0, 0.02, 0]} m={m.glow} />
      <C r={s * 0.18} h={0.3} p={[0, 0.17, 0]} m={m.dark} />
      <group ref={arm} position={[0, 0.32, 0]}>
        <C r={s * 0.1} h={0.12} p={[0, 0.06, 0]} m={m.accent} />
        <group position={[0, 0.12, 0]} rotation={[0, 0, -0.5]}>
          <B s={[0.14, H * 0.45, 0.14]} p={[0, H * 0.22, 0]} m={m.accent} />
          <group ref={fore} position={[0, H * 0.45, 0]}>
            <C r={0.08} h={0.16} rot={[Math.PI / 2, 0, 0]} p={[0, 0, 0]} m={m.metal} />
            <B s={[0.1, H * 0.38, 0.1]} p={[0, H * 0.19, 0]} m={m.body} />
            <C r={0.05} h={0.08} p={[0, H * 0.4, 0]} m={m.glow} />
          </group>
        </group>
      </group>
    </>
  );
}

function Cabinet({ W, D, H, m }: Dims & { m: Mats }) {
  return (
    <>
      <B s={[W * 0.96, H, D * 0.96]} p={[0, H / 2, 0]} m={m.body} />
      <B s={[W * 0.6, H * 0.25, 0.02]} p={[0, H * 0.68, D * 0.485]} m={m.accent} />
      <B s={[W * 0.96, 0.03, D * 0.97]} p={[0, H * 0.35, 0]} m={m.glow} />
      <B s={[0.05, 0.05, 0.02]} p={[W * 0.36, H * 0.86, D * 0.49]} m={m.glow} />
    </>
  );
}

interface Dims { W: number; D: number; H: number }

export function ItemModel({ t, W, D, H, look = "normal" }: { t: ItemType | undefined; W: number; D: number; H: number; look?: Look }) {
  const m = useMats(t?.color ?? "#5ad1ff", look, !!t?.heat);
  const shape = shapeOf(t);
  const p = { W, D, H, m };
  switch (shape) {
    case "machine": return <Machine {...p} />;
    case "press": return <Press {...p} />;
    case "table": case "cutting": case "packing": return <Table {...p} kind={shape} />;
    case "rack": case "rolls": return <Rack {...p} kind={shape} />;
    case "pallet": return <Pallet {...p} drums={false} />;
    case "drums": return <Pallet {...p} drums />;
    case "tank": return <Tank {...p} />;
    case "conveyor": return <Conveyor {...p} />;
    case "robot": return <Robot {...p} />;
    default: return <Cabinet {...p} />;
  }
}
