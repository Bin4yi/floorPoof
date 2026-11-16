// Devpost gallery cards (3:2) and the project cover image, in the app's own look.
import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { FONTS, T } from "./theme";

export type CardProps = { img: string; n: string; title: string; caption: string };

// 1800 x 1200: header with number, title and caption, then the scene still.
export const GalleryCard: React.FC<CardProps> = ({ img, n, title, caption }) => (
  <AbsoluteFill style={{ background: `linear-gradient(180deg, #ffffff 0%, ${T.bg} 100%)`, fontFamily: FONTS.body }}>
    <div style={{ position: "absolute", left: 60, top: 40, right: 60, display: "flex", alignItems: "center", gap: 22 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 34, color: "#fff", background: T.blue, borderRadius: 14, padding: "10px 18px", letterSpacing: "0.06em" }}>{n}</div>
      <div>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 42, color: T.ink, letterSpacing: "0.04em" }}>{title}</div>
        <div style={{ fontSize: 28, color: T.ink2, marginTop: 6 }}>{caption}</div>
      </div>
      <div style={{ marginLeft: "auto", fontFamily: FONTS.display, fontWeight: 800, fontSize: 24, letterSpacing: "0.16em", color: T.ink }}>
        ◆ FLOOR<span style={{ color: T.blue }}>PROOF</span>
      </div>
    </div>
    <div style={{ position: "absolute", left: 60, top: 196, width: 1680, height: 945, borderRadius: 20, overflow: "hidden", boxShadow: "0 30px 60px -20px rgba(15,23,42,.35), 0 0 0 1px rgba(15,23,42,.08)" }}>
      <Img src={staticFile(img)} style={{ width: 1680, height: 945, display: "block" }} />
    </div>
  </AbsoluteFill>
);

// 1500 x 1000 cover image for the Devpost project.
export const Cover: React.FC = () => (
  <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 70% at 70% 45%, #16305c 0%, #0a1426 55%, #050a14 100%)", fontFamily: FONTS.body, overflow: "hidden" }}>
    {/* faint grid */}
    <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(90,209,255,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(90,209,255,.07) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />
    {/* the real app, tilted */}
    <div style={{ position: "absolute", left: 800, top: 250, width: 1100, height: 619, perspective: 1600 }}>
      <div style={{ width: 1100, height: 619, transform: "rotateY(-18deg) rotateX(6deg) rotateZ(-2deg)", borderRadius: 18, overflow: "hidden",
                    boxShadow: "0 0 0 2px rgba(90,209,255,.7), 0 0 60px rgba(90,209,255,.45), 0 40px 90px rgba(0,0,0,.6)" }}>
        <Img src={staticFile("shots/app-select.png")} style={{ width: 1100, height: 619, display: "block" }} />
      </div>
    </div>
    <div style={{ position: "absolute", left: 80, top: 250, width: 680 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 70, letterSpacing: "0.1em", color: "#fff", lineHeight: 1 }}>
        FLOOR<span style={{ color: "#5ad1ff" }}>PROOF</span>
      </div>
      <div style={{ marginTop: 34, fontSize: 46, fontWeight: 700, color: "#fff", lineHeight: 1.15 }}>
        The AI suggests.<br /><span style={{ color: "#5ad1ff" }}>The graph proves.</span>
      </div>
      <div style={{ marginTop: 28, fontSize: 28, color: "#c4d3e6", lineHeight: 1.4 }}>
        Factory floor layouts checked by graph queries before they can be saved.
      </div>
      <div style={{ marginTop: 40, display: "inline-flex", alignItems: "center", gap: 12, fontSize: 26, fontWeight: 600, color: "#04121f", background: "#5ad1ff", borderRadius: 12, padding: "12px 20px" }}>
        Built on Relate by Neo4j
      </div>
    </div>
    <div style={{ position: "absolute", left: 80, bottom: 70, display: "flex", gap: 14 }}>
      {["Cypher paths", "Transactions", "Vector search", "WebAssembly", "MCP"].map((t) => (
        <div key={t} style={{ fontFamily: FONTS.mono, fontSize: 22, color: "#bfe6ff", border: "1.5px solid rgba(90,209,255,.45)", borderRadius: 10, padding: "8px 14px" }}>{t}</div>
      ))}
    </div>
  </AbsoluteFill>
);
