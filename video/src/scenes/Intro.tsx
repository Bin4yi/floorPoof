// Intro — adapted from video-shotcraft demos/ui-entrance/neon-frame-forerun (NeonFrameForerun.tsx).
// Kept: frame trace (two heads, 20f swift, collision flash), tunnel echoes strike/quench, page lit 24→84,
// parts fall with soft same-shape shadows (24f accelerate + soft landing, staggered 54→104), camera settle.
// Changed: neon recoloured to FloorProof blue/cyan; the page is the real app screenshot with blank slots,
// and real crops of the screenshot (HUD, 3D floor, item list, efficiency) drop into their exact slots.
import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { EASE, bezier, mix, ramp } from "../demos/_fixtures/Polish";
import { LOOKS, Stage, alpha } from "../demos/_fixtures/Look";
import { FONTS, T } from "../theme";

const L = LOOKS.midnight;
const NEON_A = "#5ad1ff";
const NEON_B = "#6d5dfc";
const SHOT = staticFile("shots/app-floor.png");

const PW = 1440;
const PH = 810;
const S = PW / 1920; // screenshot px -> panel px
const PAD = 22;
const PERSP = 1600;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeFall = bezier(0.55, 0, 0.75, 0.95);

const Float: React.FC<{ x: number; y: number; w: number; h: number; lit: number; vis: number; children: React.ReactNode }> = ({ x, y, w, h, lit, vis, children }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, transformStyle: "preserve-3d" }}>
    {h > 0.5 && (
      <div style={{
        position: "absolute", left: 0, top: 0, width: w,
        transform: `translate3d(${(h * 0.34).toFixed(2)}px, ${(h * 0.5).toFixed(2)}px, 0.5px) scale(${(1 + h * 0.0011).toFixed(4)})`,
        filter: `brightness(0) blur(${(2 + h * 0.12).toFixed(2)}px)`,
        opacity: (0.42 - h * 0.0016) * lit * vis, pointerEvents: "none",
      }}>{children}</div>
    )}
    <div style={{ transform: `translateZ(${(h + 1).toFixed(2)}px)`, opacity: vis, filter: lit < 0.995 ? `brightness(${Math.max(0.04, lit).toFixed(3)})` : undefined }}>
      {children}
    </div>
  </div>
);

// Regions of the real screenshot (screenshot px) that fly in. land = order in the landing window.
const REGIONS = [
  { key: "hud", x: 604, y: 146, w: 664, h: 84, land: 0.05, H: 160 },
  { key: "toggles", x: 412, y: 144, w: 164, h: 294, land: 0.12, H: 140 },
  { key: "palette", x: 14, y: 240, w: 372, h: 342, land: 0.2, H: 150 },
  { key: "floor", x: 448, y: 412, w: 994, h: 330, land: 0.36, H: 170 },
  { key: "eff", x: 1488, y: 150, w: 416, h: 198, land: 0.5, H: 150 },
  { key: "radar", x: 1488, y: 356, w: 416, h: 366, land: 0.66, H: 140 },
];

const Crop: React.FC<{ r: (typeof REGIONS)[number] }> = ({ r }) => (
  <div style={{
    width: r.w * S, height: r.h * S, borderRadius: 8, overflow: "hidden",
    backgroundImage: `url(${SHOT})`, backgroundSize: `${PW}px ${PH}px`, backgroundPosition: `${-r.x * S}px ${-r.y * S}px`,
  }} />
);

const FW = PW + PAD * 2;
const FH = PH + PAD * 2;
const FRAME_D = `M 0 ${FH / 2} L 0 0 L ${FW} 0 L ${FW} ${FH} L 0 ${FH} Z`;
const PERIM = 2 * (FW + FH);
const pointAt = (u: number): [number, number] => {
  let s = (((u % 1) + 1) % 1) * PERIM;
  const segs: [number, number, number, number][] = [[0, FH / 2, 0, 0], [0, 0, FW, 0], [FW, 0, FW, FH], [FW, FH, 0, FH], [0, FH, 0, FH / 2]];
  for (const [x1, y1, x2, y2] of segs) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (s <= len) return [x1 + ((x2 - x1) * s) / len, y1 + ((y2 - y1) * s) / len];
    s -= len;
  }
  return [0, FH / 2];
};
const STRIKE = [0, 0.7, 0.15, 0.9, 0.35, 1];
const strike = (f: number, on: number) => (f < on ? 0 : f - on >= STRIKE.length ? 1 : STRIKE[Math.floor(f - on)]);
const FADE = [1, 0.3, 0.8, 0.12, 0.4, 0];
const quench = (f: number, off: number) => (f < off ? 1 : f - off >= FADE.length ? 0 : FADE[Math.floor(f - off)]);

const Tube: React.FC<{ d: string; grad: string; dash?: string; offset?: number; a: number; core?: number; w?: number }> = ({ d, grad, dash, offset, a, core = 1, w = 1 }) => (
  <g fill="none" strokeLinejoin="miter" strokeDasharray={dash} strokeDashoffset={offset}>
    <path d={d} pathLength={dash ? 1000 : undefined} stroke={grad} strokeWidth={34 * w} opacity={0.07 * a} />
    <path d={d} pathLength={dash ? 1000 : undefined} stroke={grad} strokeWidth={14 * w} opacity={0.18 * a} />
    <path d={d} pathLength={dash ? 1000 : undefined} stroke={grad} strokeWidth={5 * w} opacity={0.9 * a} />
    <path d={d} pathLength={dash ? 1000 : undefined} stroke="#f2fbff" strokeWidth={1.6 * w} opacity={0.85 * a * core} />
  </g>
);

const ECHO = Array.from({ length: 5 }, (_, i) => {
  const k = i + 1;
  const z = 320 * k;
  const g = 1.13 + 0.2 * k;
  return { k, z, s: (g * (PERSP + z)) / PERSP, on: 20 + i * 4, off: 94 + [2, 1, 0, 1, 2][i] * 7 + (i % 2) * 2 };
});

export const Intro: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const gid = "fpIntro";

  const trace = ramp(frame, 2, 20, EASE.swift);
  const half = trace * 500;
  const meet = ramp(frame, 21, 14, EASE.out);
  const flash = frame >= 21 ? 1 - meet : 0;
  const vis = ramp(frame, 16, 14, EASE.out);
  const lit = ramp(frame, 24, 60, EASE.smooth);
  const landFrame = (u: number) => 54 + EASE.out(u) * 50;
  const liftOf = (r: (typeof REGIONS)[number]) => {
    const lf = landFrame(r.land);
    const q = clamp01((frame - (lf - 24)) / 24);
    return (1 - easeFall(q)) * r.H;
  };
  const settle = ramp(frame, 0, 96, EASE.out);
  const drift = ramp(frame, 90, duration - 90, EASE.smooth);
  // After the page lands, the camera eases out of the slant toward a near-front view for the title.
  const front = ramp(frame, 120, 70, EASE.smooth);
  const rotY = mix(mix(-30, -12, settle) + 1.5 * drift, -6, front);
  const rotX = mix(mix(10, 5, settle), 3, front);
  const rotZ = mix(mix(-7, -2.5, settle), -1, front);
  const scale = mix(0.8, 0.88, settle) + 0.01 * drift - 0.06 * front;
  const shiftY = -40 * front;
  const frameCore = mix(1, 0.35, ramp(frame, 60, 40, EASE.smooth));
  const frameA = 1 - 0.35 * ramp(frame, 96, 30, EASE.smooth);
  const rim = ramp(frame, 40, 40, EASE.out) * (1 + 0.25 * ramp(frame, 100, 30, EASE.smooth));
  const stageI = 0.55 + 0.45 * ramp(frame, 18, 30, EASE.out) - 0.3 * ramp(frame, 96, 30, EASE.smooth);
  const heads = trace < 1 ? [pointAt(trace * 0.5), pointAt(1 - trace * 0.5)] : [];

  // Title lock-up (lands after the page is lit).
  const tIn = ramp(frame, 128, 26, EASE.out);
  const subIn = ramp(frame, 146, 24, EASE.out);
  const letters = "FLOORPROOF".split("");

  return (
    <AbsoluteFill style={{ background: L.bg[2], overflow: "hidden", fontFamily: FONTS.body }}>
      <Stage look={L} keyLight={{ x: 0.3, y: 0.05 }} fill={{ x: 0.85, y: 0.95 }} intensity={stageI} vignette={0.7} />
      <div style={{ position: "absolute", inset: 0, perspective: PERSP, perspectiveOrigin: "50% 45%" }}>
        <div style={{
          position: "absolute", left: (1920 - PW) / 2, top: (1080 - PH) / 2 + shiftY, width: PW, height: PH,
          transform: `scale(${scale.toFixed(4)}) rotateY(${rotY.toFixed(3)}deg) rotateX(${rotX.toFixed(3)}deg) rotateZ(${rotZ.toFixed(3)}deg)`,
          transformStyle: "preserve-3d",
        }}>
          {ECHO.map((e) => {
            const a = strike(frame, e.on) * quench(frame, e.off) * (0.42 - e.k * 0.06) * (0.85 + 0.15 * Math.sin(frame / 7 + e.k));
            if (a <= 0.002) return null;
            return (
              <svg key={e.k} width={FW} height={FH} viewBox={`0 0 ${FW} ${FH}`} style={{ position: "absolute", left: -PAD, top: -PAD, overflow: "visible", transform: `translateZ(${-e.z}px) scale(${e.s.toFixed(4)})` }}>
                <Tube d={FRAME_D} grad={e.k % 2 ? NEON_A : NEON_B} a={a} core={0.5} w={1.2 + e.k * 0.3} />
              </svg>
            );
          })}
          <div style={{
            position: "absolute", inset: 0, borderRadius: 18, transform: "translateZ(-2px)",
            boxShadow: `0 40px 120px -10px rgba(2,6,16,0.85), -30px -10px 80px 6px ${alpha(NEON_A, 0.3 * rim)}, 30px 30px 90px 10px ${alpha(NEON_B, 0.24 * rim)}`,
            opacity: clamp01(trace * 2),
          }} />
          {/* Base page: the real screenshot, with blank slots where the flying regions will land. */}
          <div style={{ position: "absolute", inset: 0, borderRadius: 18, overflow: "hidden", opacity: vis, filter: lit < 0.995 ? `brightness(${Math.max(0.03, lit).toFixed(3)})` : undefined }}>
            <Img src={SHOT} style={{ width: PW, height: PH, display: "block" }} />
            {REGIONS.map((r) => (
              <div key={r.key} style={{ position: "absolute", left: r.x * S, top: r.y * S, width: r.w * S, height: r.h * S, borderRadius: 8, background: T.bg, boxShadow: `inset 0 0 0 1px ${T.line}` }} />
            ))}
            <div style={{ position: "absolute", inset: 0, background: `linear-gradient(90deg, rgba(10,30,80,0) ${mix(-40, 100, lit)}%, rgba(10,30,80,0.6) ${mix(0, 160, lit)}%)` }} />
          </div>
          <div style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
            {REGIONS.map((r) => (
              <Float key={r.key} x={r.x * S} y={r.y * S} w={r.w * S} h={liftOf(r)} lit={lit} vis={vis}><Crop r={r} /></Float>
            ))}
          </div>
          <svg width={FW} height={FH} viewBox={`0 0 ${FW} ${FH}`} style={{ position: "absolute", left: -PAD, top: -PAD, overflow: "visible", transform: "translateZ(2px)" }}>
            <defs>
              <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={FW} y2={FH}>
                <stop offset="0" stopColor={NEON_A} />
                <stop offset="0.55" stopColor="#4f8dff" />
                <stop offset="1" stopColor={NEON_B} />
              </linearGradient>
              <radialGradient id={`${gid}h`}>
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="0.25" stopColor="#e6f6ff" stopOpacity={0.9} />
                <stop offset="1" stopColor={NEON_A} stopOpacity={0} />
              </radialGradient>
            </defs>
            {trace > 0 && (
              <>
                <Tube d={FRAME_D} grad={`url(#${gid})`} dash={`${half} 1000`} offset={0} a={frameA} core={frameCore} />
                <Tube d={FRAME_D} grad={`url(#${gid})`} dash={`${half} 1000`} offset={-(1000 - half)} a={frameA} core={frameCore} />
              </>
            )}
            {frame < 3 && <circle cx={0} cy={FH / 2} r={34} fill={`url(#${gid}h)`} />}
            {heads.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={46} fill={`url(#${gid}h)`} />)}
            {flash > 0.01 && <circle cx={FW} cy={FH / 2} r={60 + 160 * meet} fill={`url(#${gid}h)`} opacity={flash} />}
          </svg>
        </div>
      </div>
      {/* Title lock-up under the page */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 74, textAlign: "center", opacity: tIn }}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 64, letterSpacing: "0.22em", color: "#ffffff" }}>
          {letters.map((ch, i) => {
            const a = ramp(frame, 128 + i * 2, 18, EASE.out);
            return <span key={i} style={{ display: "inline-block", opacity: a, transform: `translateY(${(1 - a) * 18}px)`, color: i >= 5 ? NEON_A : "#fff" }}>{ch}</span>;
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 28, color: "#c9d6ea", opacity: subIn, transform: `translateY(${(1 - subIn) * 10}px)` }}>
          The AI suggests, the graph proves. · Built on <b style={{ color: "#fff" }}>Relate</b> by Neo4j
        </div>
      </div>
    </AbsoluteFill>
  );
};
