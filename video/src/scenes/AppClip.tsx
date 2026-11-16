// Real app walkthrough shots: the screen recording is the page texture of a 2.5D camera
// (camera math from video-shotcraft assets/lib/PageCam.tsx: focal point to centre, CSS `zoom` for
// sharp glyphs, rotations about the focal point). Segments of the recording are trimmed and sped up;
// sped-up parts carry an honest ×N badge. Chapter label + one caption line per section.
import React from "react";
import { AbsoluteFill, Easing, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { EASE, ramp, softShadow } from "../demos/_fixtures/Polish";
import { FONTS, T } from "../theme";
import type { Section } from "../timeline";

type Seg = { s: [number, number]; out?: number }; // source seconds, output seconds (last segment fills the rest)
type Key = { at: number; cx: number; cy: number; zoom: number; rotX?: number; rotY?: number }; // at = 0..1 of section
type ClipDef = { file: string; segs: Seg[]; keys: Key[]; caption: string; captionAt?: number };

export const CLIPS: Record<string, ClipDef> = {
  floor: {
    file: "clips/floor.mp4",
    segs: [{ s: [0.4, 6.4], out: 3.0 }, { s: [7.0, 11.6], out: 2.0 }, { s: [13.8, 21.5] }],
    keys: [{ at: 0, cx: 960, cy: 560, zoom: 1.0, rotX: 10 }, { at: 0.18, cx: 940, cy: 560, zoom: 1.32 }, { at: 0.62, cx: 960, cy: 560, zoom: 1.32 }, { at: 1, cx: 1060, cy: 560, zoom: 1.2 }],
    caption: "Exit routes and power cables, read straight from the graph",
  },
  spots: {
    file: "clips/spots.mp4",
    segs: [{ s: [0.2, 3.4], out: 1.8 }, { s: [4.6, 8.2], out: 2.6 }, { s: [9.6, 13.6], out: 2.4 }, { s: [14.2, 18.8] }],
    keys: [{ at: 0, cx: 640, cy: 480, zoom: 1.32 }, { at: 0.3, cx: 700, cy: 520, zoom: 1.3 }, { at: 0.62, cx: 820, cy: 470, zoom: 1.22 }, { at: 1, cx: 760, cy: 440, zoom: 1.28 }],
    caption: "Each numbered spot is proven by every check, in a rolled-back transaction",
  },
  fail: {
    file: "clips/fail.mp4",
    segs: [{ s: [0.3, 3.6], out: 1.1 }, { s: [5.5, 11.0], out: 2.0 }, { s: [12.6, 14.0], out: 0.8 }, { s: [19.5, 25.0] }],
    keys: [{ at: 0, cx: 930, cy: 560, zoom: 1.45 }, { at: 0.55, cx: 940, cy: 540, zoom: 1.45 }, { at: 0.72, cx: 1150, cy: 430, zoom: 1.12 }, { at: 1, cx: 1150, cy: 430, zoom: 1.12 }],
    caption: "Table in the main aisle → FP-AISLE fails. Accept stays locked.",
  },
  efficiency: {
    file: "clips/efficiency.mp4",
    segs: [{ s: [0.5, 7.5], out: 2.2 }, { s: [11.3, 13.5], out: 1.0 }, { s: [23.5, 29.5], out: 2.6 }, { s: [30.0, 35.5] }],
    keys: [{ at: 0, cx: 900, cy: 520, zoom: 1.18 }, { at: 0.35, cx: 950, cy: 520, zoom: 1.18 }, { at: 0.62, cx: 1500, cy: 480, zoom: 1.28 }, { at: 1, cx: 1680, cy: 560, zoom: 1.5 }],
    caption: "Walking, material flow, crowding, elbow room: measured on the graph",
  },
  agent: {
    file: "clips/agent.mp4",
    segs: [{ s: [0.3, 4.2], out: 1.4 }, { s: [7.5, 12.0], out: 1.2 }, { s: [12.0, 19.8], out: 0.9 }, { s: [19.8, 24.5], out: 2.4 }, { s: [31.5, 42.5] }],
    keys: [{ at: 0, cx: 420, cy: 400, zoom: 1.5 }, { at: 0.38, cx: 520, cy: 480, zoom: 1.25 }, { at: 0.6, cx: 640, cy: 520, zoom: 1.12 }, { at: 0.75, cx: 260, cy: 520, zoom: 1.6 }, { at: 1, cx: 260, cy: 540, zoom: 1.65 }],
    caption: "Muse Spark proposes · the graph decides · vector search recalls proven layouts",
  },
  explorer: {
    file: "clips/explorer.mp4",
    segs: [{ s: [0.0, 2.5], out: 1.1 }, { s: [3.0, 21.0], out: 1.2 }, { s: [33.0, 41.5], out: 2.4 }, { s: [47.0, 56.0] }],
    keys: [{ at: 0, cx: 760, cy: 380, zoom: 1.35 }, { at: 0.3, cx: 900, cy: 480, zoom: 1.2 }, { at: 0.6, cx: 980, cy: 560, zoom: 1.28 }, { at: 1, cx: 1000, cy: 600, zoom: 1.32 }],
    caption: "Relate in WebAssembly: the whole floor graph, queried inside the browser tab",
  },
  builder: {
    file: "clips/builder.mp4",
    segs: [{ s: [0.8, 7.2], out: 1.6 }, { s: [8.5, 21.8], out: 2.4 }, { s: [23.5, 27.9] }],
    keys: [{ at: 0, cx: 700, cy: 460, zoom: 1.25 }, { at: 0.5, cx: 800, cy: 520, zoom: 1.15 }, { at: 1, cx: 960, cy: 540, zoom: 1.05 }],
    caption: "Draw any floor: exits, aisles, power tree. The same checks run on it.",
  },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const camEase = Easing.bezier(0.33, 0, 0.15, 1);

const X = 4;
// Lay out the segments on the output timeline; the last one fills the rest. 4f crossfade between them.
const layout = (def: ClipDef, total: number) => {
  let at = 0;
  return def.segs.map((g, i) => {
    const outF = i === def.segs.length - 1 ? Math.max(12, total - at) : Math.round((g.out ?? 1) * 30);
    const from = Math.max(0, at - (i ? X : 0));
    const dur = outF + (i ? X : 0);
    const rate = ((g.s[1] - g.s[0]) * 30) / outF;
    at += outF;
    return { g, from, dur, rate, i };
  });
};

const Page: React.FC<{ def: ClipDef; total: number }> = ({ def, total }) => {
  const parts = layout(def, total);
  return (
    <>
      {parts.map(({ g, from, dur, rate, i }) => (
        <Sequence key={i} from={from} durationInFrames={dur} layout="none">
          <SegVideo src={def.file} startS={g.s[0]} rate={rate} fadeIn={i ? X : 0} />
        </Sequence>
      ))}
    </>
  );
};

const SegVideo: React.FC<{ src: string; startS: number; rate: number; fadeIn: number }> = ({ src, startS, rate, fadeIn }) => {
  void rate;
  const f = useCurrentFrame();
  const op = fadeIn ? Math.min(1, f / fadeIn) : 1;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: op }}>
      <OffthreadVideo src={staticFile(src)} startFrom={Math.round(startS * 30)} playbackRate={rate} muted
                      style={{ position: "absolute", width: 1920, height: 1080 }} />
    </div>
  );
};

export const AppClip: React.FC<{ s: Section; bare?: boolean }> = ({ s, bare }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const def = CLIPS[s.id];
  const u = frame / Math.max(1, durationInFrames - 1);
  let a = def.keys[0], b = def.keys[def.keys.length - 1];
  for (let i = 0; i < def.keys.length - 1; i++) if (u >= def.keys[i].at && u <= def.keys[i + 1].at) { a = def.keys[i]; b = def.keys[i + 1]; break; }
  const t = a.at === b.at ? 1 : interpolate(u, [a.at, b.at], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: camEase });
  const cx = lerp(a.cx, b.cx, t), cy = lerp(a.cy, b.cy, t), zoom = lerp(a.zoom, b.zoom, t);
  const rotX = lerp(a.rotX ?? 0, b.rotX ?? 0, t), rotY = lerp(a.rotY ?? 0, b.rotY ?? 0, t);

  // Section entrance: the page window settles in from a slight lift (one motion voice for all app shots).
  const enter = ramp(frame, 0, 16, EASE.out);
  const chipIn = ramp(frame, 4, 16, EASE.out);
  const capIn = ramp(frame, 14, 18, EASE.out) * (1 - ramp(frame, durationInFrames - 10, 10, EASE.out));

  return (
    <AbsoluteFill style={{ background: T.bg2, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, perspective: `${1400 * zoom}px`, perspectiveOrigin: "960px 540px", opacity: 0.4 + 0.6 * enter }}>
        <div style={{
          position: "absolute", width: 1920, height: 1080, zoom,
          transform: `translate(${960 / zoom - cx}px, ${540 / zoom - cy + (1 - enter) * 24}px) rotateY(${rotY}deg) rotateX(${rotX}deg)`,
          transformOrigin: `${cx}px ${cy}px`, transformStyle: "preserve-3d", boxShadow: softShadow(30, { strength: 1.6 }), background: "#fff",
        }}>
          <Page def={def} total={durationInFrames} />
        </div>
      </div>
      {!bare && <>
      {/* Chapter chip */}
      <div style={{ position: "absolute", left: 40, top: 34, display: "flex", alignItems: "center", gap: 14, opacity: chipIn, transform: `translateX(${(1 - chipIn) * -20}px)` }}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: "#fff", background: T.blue, borderRadius: 10, padding: "8px 14px", letterSpacing: "0.08em" }}>{s.chapter}</div>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 26, color: T.ink, background: "rgba(255,255,255,.92)", borderRadius: 10, padding: "8px 16px", letterSpacing: "0.12em", textTransform: "uppercase", boxShadow: softShadow(8, { strength: 1 }) }}>{s.label}</div>
      </div>
      {/* Honest speed badge while a sped-up segment plays */}
      {(() => {
        const cur = layout(def, durationInFrames).filter((p) => frame >= p.from && frame < p.from + p.dur).pop();
        if (!cur || cur.rate <= 2.6) return null;
        return (
          <div style={{ position: "absolute", right: 40, top: 38, fontFamily: FONTS.mono, fontWeight: 600, fontSize: 26, color: "#fff", background: "rgba(15,23,42,.8)", borderRadius: 10, padding: "6px 14px" }}>
            ▶▶ ×{Math.round(cur.rate)}
          </div>
        );
      })()}
      {/* Caption */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 46, display: "flex", justifyContent: "center", opacity: capIn, transform: `translateY(${(1 - capIn) * 14}px)` }}>
        <div style={{ fontFamily: FONTS.body, fontWeight: 600, fontSize: 34, color: "#fff", background: "rgba(15,23,42,.86)", borderRadius: 16, padding: "14px 28px", maxWidth: 1500, textAlign: "center", boxShadow: softShadow(16, { strength: 1.4 }) }}>
          {def.caption}
        </div>
      </div>
      </>}
    </AbsoluteFill>
  );
};
