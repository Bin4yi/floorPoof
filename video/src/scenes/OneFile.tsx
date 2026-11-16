// "Everything in one Relate file" — adapted from video-shotcraft demos/ui-entrance/bezier-source-converge-merge.
// Kept: cubic paths with arc-length lookup, staggered draw-on (0.04 + i*0.045, 0.17), overshoot node pop,
// three-stage shrink along the path (44→15→0 scaled), comet-tail packets, single receive ripple at 0.72,
// erase from the source end, centring pan, word-by-word caption darkening.
// Changed: six sources (the graph's parts) with labels, FloorProof blue accent, the sink is the .rl file.
import React from "react";
import { AbsoluteFill } from "remotion";
import { DesignStage, E, lerp, seg, useT } from "../demos/_fixtures/Motion";
import { Backdrop, EASE, softShadow } from "../demos/_fixtures/Polish";
import { FONTS, T } from "../theme";

const TXT = T.ink;
const DIM = "#c4cad3";
const LINE = "rgba(20,22,28,0.09)";
const ACCENT = T.blue2;
const ACCENT_HI = "#5ea2ff";
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const h2r = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (p: number, a: string, b: string) => {
  const A = h2r(a), B = h2r(b), q = clamp01(p);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * q)},${Math.round(A[1] + (B[1] - A[1]) * q)},${Math.round(A[2] + (B[2] - A[2]) * q)})`;
};

const XC = 332, YC = 120;
const NODE = 30;
const SRCS = [
  { y: 22, icon: "grid", c: "#2a2c33", label: "Floor cells", sub: "ADJACENT" },
  { y: 62, icon: "gear", c: "#334155", label: "Machines", sub: "OCCUPIES · WORKS_AT" },
  { y: 102, icon: "bolt", c: T.orange, label: "Power panels", sub: "FED_BY" },
  { y: 142, icon: "flow", c: "#475569", label: "Production lines", sub: "FEEDS" },
  { y: 182, icon: "shield", c: T.ok, label: "Rules", sub: "HAS_RULE" },
  { y: 222, icon: "spark", c: T.violet, label: "Proposals", sub: "+ vectors" },
];
const ICON: Record<string, React.ReactNode> = {
  grid: <path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16" />,
  gear: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3.5v2.6M12 17.9v2.6M3.5 12h2.6M17.9 12h2.6M6 6l1.9 1.9M16.1 16.1 18 18M6 18l1.9-1.9M16.1 7.9 18 6" /></>,
  bolt: <path d="M13 3 5.5 13.2h5.6L10.4 21 18.5 10.4h-5.7z" />,
  flow: <><rect x="3" y="9" width="5" height="6" rx="1.2" /><rect x="16" y="9" width="5" height="6" rx="1.2" /><path d="M8 12h8M13.5 9.5 16 12l-2.5 2.5" /></>,
  shield: <><path d="M12 3.5 19 6.3v5.4c0 4.4-3 7.3-7 8.8-4-1.5-7-4.4-7-8.8V6.3z" /><path d="m8.8 12 2.2 2.2 4.4-4.6" /></>,
  spark: <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />,
};

type Pt = { x: number; y: number };
const cubic = (y0: number, u: number): Pt => {
  const v = 1 - u;
  return {
    x: v * v * v * 120 + 3 * v * v * u * 206 + 3 * v * u * u * 228 + u * u * u * XC,
    y: v * v * v * y0 + 3 * v * v * u * y0 + 3 * v * u * u * YC + u * u * u * YC,
  };
};
const SAMPLES = 1600;
const START = 64, LINE_LEN = 120 - START;
const mkPathGeom = (y0: number) => {
  const cum: number[] = [0];
  let px = 120, py = y0, acc = 0;
  for (let k = 1; k <= SAMPLES; k++) {
    const p = cubic(y0, k / SAMPLES);
    acc += Math.hypot(p.x - px, p.y - py);
    cum.push(acc);
    px = p.x; py = p.y;
  }
  const len = LINE_LEN + acc;
  const pointAt = (s: number): Pt => {
    const sc = Math.max(0, Math.min(len, s));
    if (sc <= LINE_LEN) return { x: START + sc, y: y0 };
    const target = sc - LINE_LEN;
    let lo = 0, hi = SAMPLES;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
    const i = Math.max(1, lo);
    const s0 = cum[i - 1], s1 = cum[i];
    const u = (i - 1 + (s1 > s0 ? (target - s0) / (s1 - s0) : 0)) / SAMPLES;
    return cubic(y0, u);
  };
  return { len, pointAt, f0: LINE_LEN / len };
};
const GEOMS = SRCS.map((s) => mkPathGeom(s.y));
const CAP_WORDS = "One embedded graph, one file: floorproof.rl".split(" ");
const CAP_ST = 0.78 / CAP_WORDS.length;
const CAP_WIN = CAP_ST * 1.5;
const BADGE = 46;
const TAIL = 9, TAIL_GAP = 0.0055;
const SHIFT = 352 - 240;

export const OneFile: React.FC = () => {
  const t = useT();
  const conv = seg(t, 0.5, 0.8, E.inOutCubic);
  const erase = seg(t, 0.82, 0.92, E.outQuad);
  const pkCycle = (seg(t, 0.1, 0.8, E.linear) * 3) % 1;
  const pan = seg(t, 0.8, 0.94, EASE.smooth);
  const bp = seg(t, 0.12, 0.22, E.outCubic);
  const badgeScale = lerp(bp, 0.7, 1) * (1 + seg(t, 0.77, 0.83, E.outBack) * 0.12 - seg(t, 0.83, 0.9, E.outQuad) * 0.12);
  const ripple = seg(t, 0.78, 0.9, EASE.out);
  const capShow = seg(t, 0.86, 0.91, EASE.out);
  const capInn = seg(t, 0.86, 0.97);
  const titleIn = seg(t, 0.0, 0.06, EASE.out) * (1 - seg(t, 0.8, 0.86, EASE.out));

  return (
    <AbsoluteFill>
      <Backdrop tone="light" light={{ x: 0.62, y: 0.3 }} accent={ACCENT} grain={0.04} vignette={0.12} />
      <div style={{ position: "absolute", left: 96, top: 70, fontFamily: FONTS.display, fontWeight: 800, fontSize: 30, letterSpacing: "0.14em", color: T.ink, opacity: titleIn }}>
        WHAT LIVES IN THE GRAPH
      </div>
      <DesignStage bg="transparent" raster="zoom">
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", fontFamily: FONTS.body, WebkitFontSmoothing: "antialiased" }}>
          <div style={{ position: "absolute", left: "50%", top: "50%", width: 440, height: 244, margin: "-112px 0 0 -220px", transform: `translateX(${(-pan * SHIFT).toFixed(2)}px)` }}>
            <svg width={440} height={244} viewBox="0 0 440 244" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
              <defs>
                <linearGradient id="fp-ofs" gradientUnits="userSpaceOnUse" x1={START} y1={0} x2={XC} y2={0}>
                  <stop offset="0" stopColor="#b8c2d0" /><stop offset="0.45" stopColor="#7c8aa0" /><stop offset="1" stopColor={T.blue} />
                </linearGradient>
              </defs>
              {SRCS.map((s, i) => {
                const { len } = GEOMS[i];
                const draw = seg(t, 0.04 + i * 0.03, 0.04 + i * 0.03 + 0.17, E.outQuad);
                const off = erase > 0 ? -erase * len : len * (1 - draw);
                return (
                  <path key={i} d={`M ${START},${s.y} L 120,${s.y} C 206,${s.y} 228,${YC} ${XC},${YC}`} fill="none" stroke="url(#fp-ofs)"
                        strokeWidth={0.9} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={off.toFixed(1)}
                        opacity={(draw * (1 - clamp01((erase - 0.85) / 0.15))).toFixed(3)} />
                );
              })}
            </svg>
            <div style={{ position: "absolute", left: 0, top: 0, width: 440, height: 244 }}>
              {SRCS.map((s, i) => {
                const { len, pointAt, f0 } = GEOMS[i];
                const tt = conv;
                const frac = f0 + (1 - f0) * tt;
                const pt = pointAt(len * frac);
                const size = tt < 0.75 ? lerp(tt / 0.75, NODE, 11) : lerp((tt - 0.75) / 0.25, 11, 0);
                const appear = seg(t, 0.02 + i * 0.03, 0.02 + i * 0.03 + 0.1, EASE.overshoot);
                const appearOp = seg(t, 0.02 + i * 0.03, 0.02 + i * 0.03 + 0.06, EASE.out);
                const ph = (pkCycle + i * 0.13) % 1;
                const pkOn = seg(t, 0.1, 0.16) * (1 - seg(t, 0.76, 0.8));
                const pkOp = pkOn * (1 - Math.abs(ph - 0.5) * 0.6);
                const k = size / NODE;
                const labelOp = appearOp * (1 - seg(t, 0.5, 0.58, EASE.out));
                return (
                  <React.Fragment key={i}>
                    {pkOp > 0.01 && Array.from({ length: TAIL }, (_, j) => TAIL - j).map((j) => {
                      const pj = ph - j * TAIL_GAP;
                      if (pj < 0) return null;
                      const q = pointAt(len * (f0 + (1 - f0) * pj));
                      const r = 2.2 * (1 - j / (TAIL + 1));
                      return <div key={`t${j}`} style={{ position: "absolute", width: r * 2, height: r * 2, borderRadius: "50%", background: ACCENT, transform: `translate(${(q.x - r).toFixed(2)}px,${(q.y - r).toFixed(2)}px)`, opacity: (pkOp * 0.38 * (1 - j / (TAIL + 1))).toFixed(3) }} />;
                    })}
                    {pkOp > 0.01 && (() => {
                      const q = pointAt(len * (f0 + (1 - f0) * ph));
                      return <div style={{ position: "absolute", width: 5, height: 5, borderRadius: "50%", background: `radial-gradient(circle at 35% 35%, ${ACCENT_HI}, ${ACCENT})`, boxShadow: "0 1px 3px rgba(42,120,214,0.45)", transform: `translate(${(q.x - 2.5).toFixed(2)}px,${(q.y - 2.5).toFixed(2)}px)`, opacity: pkOp.toFixed(3) }} />;
                    })()}
                    {/* label to the left of the node */}
                    <div style={{ position: "absolute", left: -40, top: s.y - 9, width: 138, textAlign: "right", paddingRight: 0, boxSizing: "border-box", opacity: labelOp, transform: `translateX(${(-(1 - appear) * 8).toFixed(2)}px)` }}>
                      <div style={{ font: `600 8.6px/1.1 ${FONTS.body}`, color: TXT, whiteSpace: "nowrap" }}>{s.label}</div>
                      <div style={{ font: `500 5.6px/1.4 ${FONTS.mono}`, color: T.muted, whiteSpace: "nowrap" }}>{s.sub}</div>
                    </div>
                    <div style={{
                      position: "absolute", left: 0, top: 0, borderRadius: "50%", background: "linear-gradient(180deg, #ffffff 0%, #f4f6f9 100%)",
                      border: `0.5px solid ${LINE}`, boxSizing: "border-box", boxShadow: `inset 0 0.5px 0 rgba(255,255,255,1), ${softShadow(2 + 4 * k, { strength: 0.8 })}`,
                      display: "flex", alignItems: "center", justifyContent: "center", color: s.c,
                      width: Math.max(0.1, size), height: Math.max(0.1, size),
                      transform: `translate(${(pt.x - size / 2 + (pt.x === START ? 0 : 0)).toFixed(2)}px,${(pt.y - size / 2).toFixed(2)}px) scale(${appear.toFixed(3)})`,
                      opacity: (appearOp * (tt > 0.92 ? clamp01((1 - tt) / 0.08) : 1)).toFixed(3),
                    }}>
                      <svg width={Math.max(0.1, size * 0.5)} height={Math.max(0.1, size * 0.5)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{ICON[s.icon]}</svg>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
            <div style={{ position: "absolute", left: XC - BADGE / 2, top: YC - BADGE / 2, width: BADGE, height: BADGE, borderRadius: "50%", border: `0.75px solid ${ACCENT}`, boxSizing: "border-box", transform: `scale(${lerp(ripple, 1, 2.1)})`, opacity: ripple > 0 && ripple < 1 ? (1 - ripple) * 0.55 : 0 }} />
            {/* The sink: the single Relate store file */}
            <div style={{
              position: "absolute", width: BADGE, height: BADGE, left: XC - BADGE / 2, top: YC - BADGE / 2, borderRadius: "50%",
              background: "linear-gradient(180deg, #ffffff 0%, #f4f6f9 100%)", border: `0.5px solid ${LINE}`, boxSizing: "border-box",
              boxShadow: `inset 0 0.5px 0 rgba(255,255,255,1), ${softShadow(8, { strength: 1 })}`,
              display: "flex", alignItems: "center", justifyContent: "center", opacity: bp, transform: `scale(${badgeScale})`, color: T.blue,
            }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
                <ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" />
              </svg>
            </div>
            <div style={{ position: "absolute", left: XC - 40, width: 80, top: YC + 27, textAlign: "center", font: `600 6.4px/1 ${FONTS.mono}`, color: T.blue, opacity: bp * (1 - capShow) }}>floorproof.rl</div>
            <div style={{ position: "absolute", display: "flex", alignItems: "baseline", justifyContent: "center", whiteSpace: "nowrap", left: XC - 160, width: 320, top: YC + 34, opacity: capShow, transform: `translateY(${((1 - capShow) * 4).toFixed(2)}px)` }}>
              {CAP_WORDS.map((w, i) => {
                const q = clamp01((capInn - i * CAP_ST) / CAP_WIN);
                return <span key={i} style={{ font: `600 12px/1.25 ${FONTS.body}`, color: mixc(q, DIM, i === CAP_WORDS.length - 1 ? T.blue : TXT), letterSpacing: "-0.012em", marginRight: i === CAP_WORDS.length - 1 ? 0 : 4 }}>{w}</span>;
              })}
            </div>
          </div>
        </div>
      </DesignStage>
    </AbsoluteFill>
  );
};
