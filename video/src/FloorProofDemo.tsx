import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { SECTIONS, TOTAL, type Section, type SectionId } from "./timeline";
import { FONTS, T } from "./theme";
import { Intro } from "./scenes/Intro";
import { SCENES } from "./scenes";

export type DemoProps = { bgm: boolean };

const Placeholder: React.FC<{ s: Section }> = ({ s }) => (
  <AbsoluteFill style={{ background: T.bg, alignItems: "center", justifyContent: "center", fontFamily: FONTS.display, fontSize: 60, color: T.ink }}>
    {s.id}
  </AbsoluteFill>
);

// BGM bed: fades in and out, ducks under the voice.
const voiceAt = (f: number) => SECTIONS.some((s) => f >= s.voFrom - 6 && f <= s.voFrom + s.voFrames + 4);
const Bgm: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Audio src={staticFile("audio/house-vibez.mp3")} startFrom={30 * 4}
      volume={(f) => {
        const fade = Math.min(interpolate(f, [0, 45], [0, 1], { extrapolateRight: "clamp" }),
                              interpolate(f, [TOTAL - 75, TOTAL - 5], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
        // Smooth duck: average the voice flag over a short window.
        let v = 0;
        for (let k = -6; k <= 6; k += 2) v += voiceAt(f + k) ? 1 : 0;
        const duck = v / 7;
        return fade * (0.26 - 0.17 * duck);
      }} />
  );
  void frame;
};

export const FloorProofDemo: React.FC<DemoProps> = ({ bgm }) => (
  <AbsoluteFill style={{ background: T.navy }}>
    {SECTIONS.map((s) => {
      const Scene = (SCENES as Partial<Record<SectionId, React.FC<{ s: Section }>>>)[s.id];
      return (
        <Sequence key={s.id} from={s.from} durationInFrames={s.duration} name={s.id}>
          {s.id === "intro" ? <Intro duration={s.duration} /> : Scene ? <Scene s={s} /> : <Placeholder s={s} />}
        </Sequence>
      );
    })}
    {SECTIONS.map((s) => (
      <Sequence key={`vo-${s.id}`} from={s.voFrom} durationInFrames={s.voFrames + 6} name={`vo ${s.id}`}>
        <Audio src={staticFile(`audio/vo/${s.id}_t.wav`)} volume={1} />
      </Sequence>
    ))}
    {bgm && <Bgm />}
  </AbsoluteFill>
);
