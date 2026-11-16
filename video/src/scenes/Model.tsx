// "Rules are Cypher queries" — adapted from video-shotcraft demos/interaction/canvas-materialize-moves
// (DiagramCascadeBuild.tsx, diagram-cascade). Kept: human-rhythm typing, submit press, flowing stroke while
// generating, drip line into the root, edges lead their child by 10f with a comet head, child pulled out of
// its top port (spring damping 14), crane-back camera 1.3→1.0, breathe on completion.
// Changed: light skin from the app tokens; the tree is a real FloorProof graph pattern with labelled
// relationships; the two Cypher patterns the checks run appear when the tree is complete.
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { EASE, mix, ramp, softShadow } from "../demos/_fixtures/Polish";
import { alpha, springAt } from "../demos/_fixtures/Look";
import { FONTS, T } from "../theme";

const A1 = T.blue;
const A2 = T.violet;
const SLOW = 0.78; // motion runs at 78% speed to fit the narration

const PROMPT = "Is this machine safe to place?";
const TYPE_START = 8;
const charGap = (i: number) => (PROMPT[i] === " " ? 1.7 : 0.95 + 0.25 * Math.abs(Math.sin(i * 2.17)));
const CHAR_T: number[] = [];
{ let t = TYPE_START; for (let i = 0; i < PROMPT.length; i++) { t += charGap(i); CHAR_T.push(t); } }
const TYPE_END = CHAR_T[CHAR_T.length - 1];
const SUBMIT = Math.round(TYPE_END) + 4;

const NODE_W = 368;
const NODE_H = 132;
type Node = { id: number; x: number; y: number; level: number; parent: number; label: string; name: string; sub: string; rel?: string; tone?: string };
const NODES: Node[] = [
  { id: 0, x: 960, y: 360, level: 0, parent: -1, label: "Item", name: "P1 · pressing machine", sub: "4.5 kW · heat" },
  { id: 1, x: 560, y: 590, level: 1, parent: 0, label: "Cell", name: "work position", sub: "x 79 · y 29", rel: "WORKS_AT" },
  { id: 2, x: 1360, y: 590, level: 1, parent: 0, label: "PowerPanel", name: "DB-P1 · drop box", sub: "12 kW rating", rel: "POWERED_BY", tone: T.orange },
  { id: 3, x: 300, y: 820, level: 2, parent: 1, label: "Cell", name: "walkable path", sub: "shortestPath", rel: "ADJACENT*" },
  { id: 4, x: 750, y: 820, level: 2, parent: 1, label: "Exit", name: "W2 · west wall", sub: "40.5 m walk", rel: "AT", tone: T.ok },
  { id: 5, x: 1170, y: 820, level: 2, parent: 2, label: "PowerPanel", name: "SUB-F · sub-panel", sub: "30 kW", rel: "FED_BY", tone: T.orange },
  { id: 6, x: 1620, y: 820, level: 2, parent: 2, label: "PowerPanel", name: "MAIN · breaker", sub: "62 kW", rel: "FED_BY", tone: T.orange },
];
const PROMPT_Y = 96;
const PROMPT_H = 96;
const ROOT_DRIP = SUBMIT + 6;
const CASCADE_START = SUBMIT + 14;
const LEVEL_GAP = 22;
const SIBLING_STAGGER = 5;
const LEAD = 10;
const EDGE_DUR = 16;
const nodeStart = (n: Node) => {
  if (n.level === 0) return CASCADE_START;
  const siblingIdx = NODES.filter((m) => m.level === n.level && m.id < n.id).length;
  return CASCADE_START + n.level * LEVEL_GAP + siblingIdx * SIBLING_STAGGER;
};
const LAST = nodeStart(NODES[NODES.length - 1]);
const DONE = LAST + 12;
const BREATHE = DONE + 10;

const R = 22;
const edgeGeom = (p: Node, c: Node) => {
  const x1 = p.x, y1 = p.y + NODE_H / 2 + 8, x2 = c.x, y2 = c.y - NODE_H / 2 - 8;
  const my = (y1 + y2) / 2;
  const dir = Math.sign(x2 - x1);
  const r = Math.min(R, Math.abs(x2 - x1) / 2);
  const sweep1 = dir > 0 ? 0 : 1;
  const sweep2 = dir > 0 ? 1 : 0;
  const d = `M ${x1} ${y1} L ${x1} ${my - r} A ${r} ${r} 0 0 ${sweep1} ${x1 + dir * r} ${my} L ${x2 - dir * r} ${my} A ${r} ${r} 0 0 ${sweep2} ${x2} ${my + r} L ${x2} ${y2}`;
  const s1 = my - r - y1, a = (Math.PI * r) / 2, h = Math.abs(x2 - x1) - 2 * r, s3 = y2 - my - r;
  const len = s1 + a + h + a + s3;
  const at = (u: number) => {
    if (u <= s1) return { x: x1, y: y1 + u };
    u -= s1;
    if (u <= a) { const th = u / r; return { x: x1 + dir * r * (1 - Math.cos(th)), y: my - r + r * Math.sin(th) }; }
    u -= a;
    if (u <= h) return { x: x1 + dir * (r + u), y: my };
    u -= h;
    if (u <= a) { const th = u / r; return { x: x2 - dir * r + dir * r * Math.sin(th), y: my + r - r * Math.cos(th) }; }
    u -= a;
    return { x: x2, y: my + r + Math.min(u, s3) };
  };
  return { d, len, at, mid: { x: (x1 + x2) / 2, y: my } };
};

const NodeCard: React.FC<{ n: Node; t: number }> = ({ n, t }) => {
  const head = ramp(t, 3, 8, EASE.out);
  const row = ramp(t, 8, 9, EASE.out);
  const tone = n.tone ?? A1;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: "18px 24px", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: head, transform: `translateY(${((1 - head) * 6).toFixed(2)}px)` }}>
        <span style={{ fontFamily: FONTS.mono, fontWeight: 600, fontSize: 20, color: tone, background: alpha(tone, 0.1), borderRadius: 8, padding: "3px 10px" }}>:{n.label}</span>
      </div>
      <div style={{ fontFamily: FONTS.body, fontWeight: 650, fontSize: 28, color: T.ink, opacity: head, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{n.name}</div>
      <div style={{ fontFamily: FONTS.mono, fontWeight: 500, fontSize: 20, color: T.muted, opacity: row, transform: `translateX(${((1 - row) * -8).toFixed(2)}px)` }}>{n.sub}</div>
    </div>
  );
};

const CYPHER = [
  { q: "MATCH p = shortestPath((w:Cell)-[:ADJACENT*]->(t:Cell))", note: "exit reach + walk distance", c: T.ok },
  { q: "(:Item)-[:POWERED_BY]->()-[:FED_BY*0..8]->(p) · sum(kw)", note: "load at every level", c: T.orange },
];

export const Model: React.FC = () => {
  const frame = useCurrentFrame() * SLOW;
  let typed = 0;
  while (typed < PROMPT.length && CHAR_T[typed] <= frame) typed++;
  const caretOn = frame < SUBMIT && (typed < PROMPT.length || Math.floor((frame - TYPE_END) / 7) % 2 === 0);
  const confirm = ramp(frame, TYPE_END, 6, EASE.out);
  const press = frame < SUBMIT ? 0 : frame < SUBMIT + 3 ? ramp(frame, SUBMIT, 3, EASE.out) : 1 - ramp(frame, SUBMIT + 3, 10, EASE.out);
  const promptIn = ramp(frame, 0, 14, EASE.snappy);
  const generating = ramp(frame, SUBMIT, 8, EASE.out) * (1 - ramp(frame, DONE, 12, EASE.out));
  const doneIn = ramp(frame, DONE, 14, EASE.snappy);
  const flow = Math.max(0, frame - SUBMIT) * 0.012;
  const pull = ramp(frame, SUBMIT + 2, 72, EASE.smooth);
  const cam = mix(1.3, 1, pull);
  const camY = mix(340, 0, pull);
  const br = ramp(frame, BREATHE, 14, EASE.smooth) - ramp(frame, BREATHE + 14, 14, EASE.smooth);
  const breathe = 1 + 0.03 * br;
  const drip = ramp(frame, ROOT_DRIP, 8, EASE.out);
  const root = NODES[0];
  const dripY1 = PROMPT_Y + PROMPT_H + 4;
  const dripY2 = root.y - NODE_H / 2 - 8;
  // After the tree: the tree shrinks up a little and the two Cypher patterns slide in underneath.
  const cy = ramp(frame, DONE + 40, 30, EASE.smooth);

  return (
    <AbsoluteFill style={{ background: T.bg, overflow: "hidden", fontFamily: FONTS.body }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 50% 40%, #ffffff 0%, ${T.bg} 60%, ${T.bg2} 100%)` }} />
      <AbsoluteFill style={{
        backgroundImage: `radial-gradient(${alpha(T.ink, 0.1)} 1.4px, transparent 1.7px)`, backgroundSize: "40px 40px", backgroundPosition: "0 16px",
        WebkitMaskImage: "radial-gradient(ellipse 60% 62% at 50% 58%, #000 25%, transparent 100%)", maskImage: "radial-gradient(ellipse 60% 62% at 50% 58%, #000 25%, transparent 100%)",
      }} />
      <AbsoluteFill style={{ transform: `translateY(${(camY - 70 * cy).toFixed(2)}px) scale(${(cam * (1 - 0.1 * cy)).toFixed(4)})`, transformOrigin: "50% 14%" }}>
        <div style={{
          position: "absolute", left: 960 - 520, top: PROMPT_Y, width: 1040, height: PROMPT_H, borderRadius: 48, padding: 2, boxSizing: "border-box",
          background: alpha(A1, 0.14 + 0.4 * confirm), boxShadow: `0 0 ${(30 + 40 * generating).toFixed(1)}px ${alpha(A1, 0.08 + 0.2 * generating)}, ${softShadow(20, { strength: 1.4 })}`,
          opacity: promptIn, transform: `translateY(${((1 - promptIn) * -20).toFixed(2)}px)`,
        }}>
          <div style={{ position: "absolute", inset: 0, borderRadius: 48, background: `linear-gradient(90deg, ${A1}, ${A2}, ${A1}, ${A2}, ${A1})`, backgroundSize: "300% 100%", backgroundPosition: `${(-flow * 100).toFixed(2)}% 0`, opacity: Math.max(generating, 0.55 * doneIn) }} />
          <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 46, boxSizing: "border-box", background: "#ffffff", display: "flex", alignItems: "center", padding: "0 16px 0 30px" }}>
            <svg width={34} height={34} viewBox="0 0 24 24" style={{ marginRight: 20, flexShrink: 0 }}>
              <path d="M12 2.5l2.1 6.4 6.4 2.1-6.4 2.1L12 19.5l-2.1-6.4L3.5 11l6.4-2.1z" fill={A1} />
            </svg>
            <span style={{ fontSize: 36, fontWeight: 520, color: T.ink, whiteSpace: "nowrap" }}>
              {PROMPT.slice(0, typed)}
              <span style={{ display: "inline-block", width: 3, height: 40, marginLeft: 4, verticalAlign: -7, borderRadius: 2, background: A1, opacity: caretOn ? 1 : 0 }} />
            </span>
            <div style={{ marginLeft: "auto", position: "relative", height: 64, display: "flex", alignItems: "center" }}>
              <div style={{ position: "absolute", right: 0, top: 0, whiteSpace: "nowrap", height: 64, display: "flex", alignItems: "center", gap: 12, opacity: doneIn, transform: `translateY(${((1 - doneIn) * 12).toFixed(2)}px)`, fontSize: 26, fontWeight: 600, color: T.ink2, paddingRight: 14 }}>
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none"><circle cx={12} cy={12} r={10} fill={alpha(T.ok, 0.16)} /><path d="M7.5 12.3l3 3 6-6.3" stroke={T.ok} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" /></svg>
                2 multi-hop checks
              </div>
              <div style={{ width: 64, height: 64, borderRadius: 32, display: "grid", placeItems: "center", background: confirm > 0 ? `linear-gradient(135deg, ${A1}, ${A2})` : alpha(T.ink, 0.06), opacity: (0.4 + 0.6 * confirm) * (1 - doneIn), transform: `scale(${(1 - 0.1 * press) * (1 - 0.3 * doneIn)})` }}>
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none"><path d="M12 19V5M6 11l6-6 6 6" stroke={confirm > 0.5 ? "#fff" : T.muted} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: "absolute", inset: 0, transform: `scale(${breathe.toFixed(4)})`, transformOrigin: "960px 600px" }}>
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
            <defs>
              <linearGradient id="fpEdge" x1="0" y1="300" x2="0" y2="800" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor={A1} stopOpacity={0.9} /><stop offset="1" stopColor={A2} stopOpacity={0.75} />
              </linearGradient>
              <radialGradient id="fpHead"><stop offset="0" stopColor="#ffffff" /><stop offset="0.35" stopColor={A1} stopOpacity={0.8} /><stop offset="1" stopColor={A1} stopOpacity={0} /></radialGradient>
            </defs>
            {drip > 0 && (
              <g>
                <line x1={960} y1={dripY1} x2={960} y2={mix(dripY1, dripY2, drip)} stroke="url(#fpEdge)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray="2 7" />
                {drip < 1 && <circle cx={960} cy={mix(dripY1, dripY2, drip)} r={16} fill="url(#fpHead)" />}
              </g>
            )}
            {NODES.filter((n) => n.parent >= 0).map((n) => {
              const g = edgeGeom(NODES[n.parent], n);
              const start = nodeStart(n) - LEAD;
              const grow = ramp(frame, start, EDGE_DUR, EASE.out);
              if (grow <= 0) return null;
              const tip = g.at(grow * g.len);
              const headOp = 1 - ramp(frame, start + EDGE_DUR - 4, 8, EASE.out);
              const port = ramp(frame, start + EDGE_DUR - 6, 10, EASE.overshoot);
              const lab = ramp(frame, start + EDGE_DUR - 2, 10, EASE.out);
              return (
                <g key={n.id}>
                  <path d={g.d} stroke={A1} strokeOpacity={0.14} strokeWidth={9} fill="none" strokeLinecap="round" strokeDasharray={`${g.len} ${g.len}`} strokeDashoffset={g.len * (1 - grow)} />
                  <path d={g.d} stroke="url(#fpEdge)" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeDasharray={`${g.len} ${g.len}`} strokeDashoffset={g.len * (1 - grow)} />
                  {headOp > 0 && <circle cx={tip.x} cy={tip.y} r={18} fill="url(#fpHead)" opacity={headOp} />}
                  <circle cx={n.x} cy={n.y - NODE_H / 2 - 8} r={6 * port} fill="#fff" stroke={A2} strokeWidth={2.5} />
                  {n.rel && (
                    <g opacity={lab} transform={`translate(${g.mid.x}, ${g.mid.y - 2})`}>
                      <rect x={-(n.rel.length * 11 + 28) / 2} y={-20} width={n.rel.length * 11 + 28} height={36} rx={18} fill="#fff" stroke={alpha(A1, 0.4)} />
                      <text x={0} y={6} textAnchor="middle" fontFamily={FONTS.mono} fontWeight={600} fontSize={19} fill={A1}>{n.rel}</text>
                    </g>
                  )}
                </g>
              );
            })}
            {NODES.filter((n) => n.level < 2).map((n) => {
              const firstChild = NODES.find((c) => c.parent === n.id)!;
              const port = ramp(frame, nodeStart(firstChild) - LEAD - 4, 8, EASE.overshoot);
              return <circle key={`p${n.id}`} cx={n.x} cy={n.y + NODE_H / 2 + 8} r={6 * port} fill="#fff" stroke={A1} strokeWidth={2.5} />;
            })}
            <circle cx={960} cy={dripY2} r={6 * ramp(frame, ROOT_DRIP + 4, 8, EASE.overshoot)} fill="#fff" stroke={A1} strokeWidth={2.5} />
          </svg>
          {NODES.map((n) => {
            const start = nodeStart(n);
            if (frame < start) return null;
            const pop = springAt(frame, start, { damping: 14, stiffness: 190 });
            const op = ramp(frame, start, 5, EASE.linear);
            const lift = (1 - Math.min(1, pop)) * 22;
            const isRoot = n.level === 0;
            return (
              <div key={n.id} style={{
                position: "absolute", left: n.x - NODE_W / 2, top: n.y - NODE_H / 2, width: NODE_W, height: NODE_H, borderRadius: 22, padding: isRoot ? 2 : 0, boxSizing: "border-box",
                background: isRoot ? `linear-gradient(135deg, ${A1}, ${A2})` : undefined,
                boxShadow: `${softShadow(10 + lift, { strength: 1.6 })}${isRoot ? `, 0 0 50px ${alpha(A1, 0.18 + 0.15 * br)}` : ""}`,
                opacity: op, transform: `translateY(${((1 - pop) * -18).toFixed(2)}px) scale(${(0.7 + 0.3 * pop).toFixed(4)})`, transformOrigin: "50% 0%",
              }}>
                <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: isRoot ? 20 : 22, overflow: "hidden", boxSizing: "border-box", background: "#ffffff", border: isRoot ? undefined : `1px solid ${T.line}` }}>
                  <NodeCard n={n} t={frame - start} />
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
      {/* The Cypher the checks run */}
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 50, display: "flex", gap: 28, justifyContent: "center" }}>
        {CYPHER.map((c, i) => {
          const a = ramp(frame, DONE + 46 + i * 12, 18, EASE.out);
          return (
            <div key={i} style={{ flex: 1, background: T.ink, borderRadius: 16, padding: "16px 22px", opacity: a, transform: `translateY(${((1 - a) * 24).toFixed(2)}px)`, boxShadow: softShadow(14, { strength: 1.4 }) }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 21, color: "#e2e8f0", whiteSpace: "nowrap" }}>{c.q}</div>
              <div style={{ marginTop: 6, fontFamily: FONTS.body, fontSize: 20, color: c.c, fontWeight: 600 }}>{c.note}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
