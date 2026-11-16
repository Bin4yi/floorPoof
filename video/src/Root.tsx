import React from "react";
import { AbsoluteFill, Composition } from "remotion";
import { FloorProofDemo, type DemoProps } from "./FloorProofDemo";
import { SECTIONS, TOTAL, type Section } from "./timeline";
import { SCENES } from "./scenes";
import { Intro } from "./scenes/Intro";
import { Cover, GalleryCard, type CardProps } from "./gallery";
import { AppClip } from "./scenes/AppClip";

// One composition per section (for QA stills), plus the full film.
const One: React.FC<{ s: Section }> = ({ s }) => {
  const Scene = SCENES[s.id];
  return <AbsoluteFill>{s.id === "intro" ? <Intro duration={s.duration} /> : Scene ? <Scene s={s} /> : null}</AbsoluteFill>;
};

export const Root: React.FC = () => (
  <>
    <Composition id="FloorProofDemo" component={FloorProofDemo as React.FC<DemoProps>} durationInFrames={TOTAL}
                 fps={30} width={1920} height={1080} defaultProps={{ bgm: true }} />
    <Composition id="GalleryCard" component={GalleryCard as React.FC<CardProps>} durationInFrames={1} fps={30} width={1800} height={1200}
                 defaultProps={{ img: "shots/app-floor.png", n: "01", title: "Title", caption: "Caption" }} />
    <Composition id="Cover" component={Cover} durationInFrames={1} fps={30} width={1500} height={1000} />
    {/* App sections without chip/caption, for gallery stills */}
    {SECTIONS.filter((s) => s.chapter).map((s) => (
      <Composition key={`b-${s.id}`} id={`B-${s.id}`} component={AppClip as React.FC<{ s: Section; bare?: boolean }>} durationInFrames={s.duration}
                   fps={30} width={1920} height={1080} defaultProps={{ s, bare: true }} />
    ))}
    {SECTIONS.map((s) => (
      <Composition key={s.id} id={`S-${s.id}`} component={One as React.FC<{ s: Section }>} durationInFrames={s.duration}
                   fps={30} width={1920} height={1080} defaultProps={{ s }} />
    ))}
  </>
);
