import type React from "react";
import type { Section, SectionId } from "../timeline";
import { OneFile } from "./OneFile";
import { Model } from "./Model";
import { AppClip } from "./AppClip";
import { Hub } from "./Hub";
import { Mcp } from "./Mcp";
import { Results } from "./Results";
import { Outro } from "./Outro";

export const SCENES: Partial<Record<SectionId, React.FC<{ s: Section }>>> = {
  onefile: OneFile,
  model: Model,
  hub: Hub,
  mcp: Mcp,
  results: Results,
  outro: Outro,
  floor: AppClip, spots: AppClip, fail: AppClip, efficiency: AppClip, agent: AppClip, explorer: AppClip, builder: AppClip,
};
