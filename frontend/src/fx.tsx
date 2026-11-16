// Shared visual effects: the neon grid floor, flowing paths and cables, glow labels. No model files.
import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export const TIME = { value: 0 };

export function Clock() {
  useFrame((_, dt) => { TIME.value += Math.min(dt, 0.1); });
  return null;
}

// ------------------------------------------------------------------ grid floor
const gridVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const gridFrag = `
uniform vec2 uSize; uniform float uTime; varying vec2 vUv;
float gridLine(vec2 g, float w){ vec2 f = abs(fract(g - 0.5) - 0.5) / (fwidth(g) * w); return 1.0 - min(min(f.x, f.y), 1.0); }
void main(){
  vec2 g = vUv * uSize;
  float minor = gridLine(g, 1.0);
  float major = gridLine(g / 10.0, 1.4);
  float scan = exp(-pow((vUv.x - fract(uTime * 0.04)) * 30.0, 2.0));
  vec2 c = vUv - 0.5; float vig = 1.0 - dot(c, c) * 0.9;
  vec3 col = vec3(0.975, 0.982, 0.992) * (0.97 + 0.03 * vig);
  col = mix(col, vec3(0.80, 0.85, 0.91), minor * 0.55);
  col = mix(col, vec3(0.45, 0.62, 0.85), major * 0.55);
  col = mix(col, vec3(0.55, 0.75, 1.0), scan * 0.10);
  gl_FragColor = vec4(col, 1.0);
}`;

export function GridFloor({ W, D, cols, rows, ...events }: { W: number; D: number; cols: number; rows: number } & Record<string, any>) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uSize: { value: new THREE.Vector2(cols, rows) }, uTime: TIME },
    vertexShader: gridVert, fragmentShader: gridFrag,
  }), [cols, rows]);
  return (
    <mesh rotation-x={-Math.PI / 2} material={mat} {...events}>
      <planeGeometry args={[W, D]} />
    </mesh>
  );
}

// ------------------------------------------------------------------ flowing light (paths, cables)
const flowVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const flowFrag = `
uniform vec3 uColor; uniform float uTime; uniform float uLen; uniform float uSpeed; uniform float uOpacity; varying vec2 vUv;
void main(){
  float d = vUv.x * uLen;
  float pulse = smoothstep(0.55, 1.0, fract(d * 0.45 - uTime * uSpeed));
  float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float a = uOpacity * (0.55 + 0.45 * pulse) * (0.5 + 0.5 * edge);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), pulse * 0.35), a);
}`;

export function flowMaterial(color: string, len: number, opacity = 0.9, speed = 1.2) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: TIME, uLen: { value: len },
                uSpeed: { value: speed }, uOpacity: { value: opacity } },
    vertexShader: flowVert, fragmentShader: flowFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
}

/** Flat glowing ribbon on the floor through world points [x, z]. Light flows from the first point to the last. */
export function Ribbon({ points, color, width = 0.22, y = 0.06, opacity = 0.9, speed = 1.2 }: {
  points: [number, number][]; color: string; width?: number; y?: number; opacity?: number; speed?: number;
}) {
  const { geom, mat } = useMemo(() => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let total = 0;
    const along = [0];
    for (let i = 1; i < points.length; i++) {
      total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      along.push(total);
    }
    points.forEach((p, i) => {
      const a = points[Math.max(i - 1, 0)], b = points[Math.min(i + 1, points.length - 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz * width / 2, nz = dx * width / 2;
      pos.push(p[0] + nx, y, p[1] + nz, p[0] - nx, y, p[1] - nz);
      const u = total ? along[i] / total : 0;
      uv.push(u, 0, u, 1);
      if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return { geom: g, mat: flowMaterial(color, Math.max(total, 0.01), opacity, speed) };
  }, [points, color, width, y, opacity, speed]);
  if (points.length < 2) return null;
  return <mesh geometry={geom} material={mat} raycast={() => null} renderOrder={3} />;
}

/** A cable arching through the air between two world points. */
export function Cable({ from, to, color, opacity = 0.7, lift = 1.2 }: {
  from: [number, number, number]; to: [number, number, number]; color: string; opacity?: number; lift?: number;
}) {
  const { geom, mat } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const mid = a.clone().lerp(b, 0.5); mid.y = Math.max(a.y, b.y) + lift + a.distanceTo(b) * 0.08;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const len = curve.getLength();
    return { geom: new THREE.TubeGeometry(curve, 24, 0.035, 5, false), mat: flowMaterial(color, len, opacity, 0.9) };
  }, [from[0], from[1], from[2], to[0], to[1], to[2], color, opacity, lift]);
  return <mesh geometry={geom} material={mat} raycast={() => null} />;
}

// ------------------------------------------------------------------ text labels
const texCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>();
function textTexture(text: string, color: string, bg: boolean) {
  const key = `${text}|${color}|${bg}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "600 44px 'Segoe UI', system-ui, sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  c.width = w; c.height = 72;
  ctx.font = font;
  if (bg) {
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(2, 2, w - 4, 68, 14); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = bg ? "#0f172a" : color; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText(text, w / 2, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const out = { tex, aspect: w / 72 };
  texCache.set(key, out);
  return out;
}

export function Label({ text, position, color = "#bdf3ff", size = 0.55, bg = true }: {
  text: string; position: [number, number, number]; color?: string; size?: number; bg?: boolean;
}) {
  const { tex, aspect } = textTexture(text, color, bg);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} raycast={() => null} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} depthTest={false} />
    </sprite>
  );
}

// ------------------------------------------------------------------ misc
/** Scale or fade a ref'd object in a loop. */
export function usePulse(ref: { current: THREE.Object3D | THREE.Material | null }, kind: "scale" | "opacity",
                         speed = 2, min = 0.4, max = 1) {
  useFrame(() => {
    const v = min + (max - min) * (0.5 + 0.5 * Math.sin(TIME.value * speed));
    const o = ref.current as any;
    if (!o) return;
    if (kind === "scale") o.scale.setScalar(v);
    else o.opacity = v;
  });
}

export function outlineGeometry(w: number, h: number, d: number) {
  return new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
}

export function heatColor(t: number): THREE.Color {
  // one hue, light to dark: better spots are darker blue
  return new THREE.Color("#c7dcf7").lerp(new THREE.Color("#1d4fb8"), Math.max(0, Math.min(1, t)));
}

export function crowdColor(t: number): THREE.Color {
  return new THREE.Color("#fcd9a8").lerp(new THREE.Color("#c2410c"), Math.max(0, Math.min(1, t)));
}
