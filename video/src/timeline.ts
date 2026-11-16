// The single source of truth for timing. Section length = voiceover + lead/tail pads,
// or the minimum the visuals need. Voiceover lengths come from vo/durations.json (OpenAI TTS, trimmed).
import VO from "./vo-durations.json";
import { FPS } from "./theme";

export type SectionId = keyof typeof VO;
type Def = { id: SectionId; lead: number; tail: number; min?: number; label?: string; chapter?: string };

// lead/tail in frames. Chapters label the app walkthrough sections.
const DEFS: Def[] = [
  { id: "intro", lead: 34, tail: 10 },
  { id: "onefile", lead: 6, tail: 10 },
  { id: "model", lead: 6, tail: 12 },
  { id: "floor", lead: 6, tail: 8, chapter: "01", label: "3D floor" },
  { id: "spots", lead: 4, tail: 8, chapter: "02", label: "Best spots" },
  { id: "fail", lead: 4, tail: 10, chapter: "03", label: "Rule check" },
  { id: "efficiency", lead: 4, tail: 8, chapter: "04", label: "Worker efficiency" },
  { id: "agent", lead: 4, tail: 8, chapter: "05", label: "AI agent + memory" },
  { id: "explorer", lead: 4, tail: 8, chapter: "06", label: "Graph explorer" },
  { id: "builder", lead: 4, tail: 6, min: 180, chapter: "07", label: "Floor builder" },
  { id: "hub", lead: 6, tail: 6 },
  { id: "mcp", lead: 4, tail: 10 },
  { id: "results", lead: 8, tail: 14 },
  { id: "outro", lead: 10, tail: 46 },
];

export type Section = Def & { from: number; duration: number; voFrom: number; voFrames: number };

export const SECTIONS: Section[] = (() => {
  let at = 0;
  return DEFS.map((d) => {
    const voFrames = Math.round(VO[d.id] * FPS);
    const duration = Math.max(d.lead + voFrames + d.tail, d.min ?? 0);
    const s = { ...d, from: at, duration, voFrom: at + d.lead, voFrames };
    at += duration;
    return s;
  });
})();

export const TOTAL = SECTIONS[SECTIONS.length - 1].from + SECTIONS[SECTIONS.length - 1].duration;
export const SEC = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<SectionId, Section>;
