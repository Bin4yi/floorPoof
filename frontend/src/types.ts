export type Change =
  | { op: "add"; id: string; type: string; x: number; y: number; rotation: number; line?: string; panel?: string }
  | { op: "move"; id: string; x?: number; y?: number; rotation?: number; panel?: string }
  | { op: "remove"; id: string };

export interface Item {
  id: string; type: string; x: number; y: number; w: number; d: number; h: number;
  rotation: number; work: [number, number] | null; panel: string | null; line: string | null; seq: number | null;
}
export interface ItemType {
  name: string; label: string; w: number; d: number; h: number; kw: number; heat: boolean; color: string;
  shape?: string | null; custom?: boolean; description?: string | null;
}
export interface Zone { name: string; kind: string; axis?: string | null; x0: number; y0: number; x1: number; y1: number }
export interface Panel { name: string; kind: string; capacity_kw: number; x: number; y: number; fed_by: string | null }
export interface Exit { name: string; x: number; y: number }
export interface Rule { id: string; kind: string; title: string; params: string; status: string; source_url: string | null; source_note: string }
export interface CheckResult {
  rule_id: string; kind: string; status: "pass" | "fail" | "skipped"; detail: string; cells: [number, number][];
  data: Record<string, any>; ms: number; title: string; source_url: string | null; source_note: string;
}
export interface Evaluation {
  valid: boolean; error: string | null; passed: boolean; results: CheckResult[]; failed: string[]; skipped: string[]; ms: number;
}
export interface FloorInfo {
  name: string; label: string; cols: number; rows: number; cell_m: number; width_m: number; depth_m: number;
  sprinklered: boolean; data_note: string; pack: string; pack_label: string; custom?: boolean;
}
export interface FloorData extends Evaluation {
  floor: FloorInfo;
  item_types: ItemType[]; zones: Zone[]; exits: Exit[];
  panels: Panel[]; lines: { name: string; direction: string }[]; rules: Rule[]; items: Item[];
}
export interface Attempt {
  proposal_id: string | null; round: number; index: number; note: string; changes: Change[]; valid: boolean;
  error: string | null; passed: boolean; failed: string[]; ms: number; results: CheckResult[];
}
export interface AgentRun {
  run_id?: string; request?: string; attempts: Attempt[]; error?: string; mode?: string; seconds?: number;
  outcome: { status: string; best?: string; best_index?: number; open_problems?: string[] };
}
export interface Pick {
  rank: number; change: Change | Omit<Extract<Change, { op: "add" }>, "id">; x: number; y: number; w: number; d: number;
  rotation: number; score: number; panel: string | null; passed: boolean; failed: string[]; error: string | null;
  ms: number; path: [number, number][]; walk_m: number; exit: string | null; why: string[];
}
export interface Suggestion {
  type: string; rotation: number; line: string | null; move_id: string | null; w: number; d: number;
  heat: [number, number, number][]; picks: Pick[]; counts: Record<string, number>; scan_ms: number; ms: number;
}
export interface ItemDraft {
  label: string; w_m: number; d_m: number; h_m: number; kw: number; heat: boolean; shape: string; color: string;
  description?: string; assumed?: string[]; source?: string; model?: string;
}
export interface FloorSpec {
  name: string; label: string; industry: string; width_m: number; depth_m: number; sprinklered: boolean;
  exits: Exit[]; zones: Zone[]; panels: Panel[]; lines: { name: string; direction: string }[];
  rules: { exit_distance_m?: number | null; exit_distance_source?: string; forklift_aisle_m?: number | null; forklift_aisle_source?: string };
  items?: { id: string; type: string; x: number; y: number; rotation: number; panel: string | null; line: string | null; seq: number | null }[];
}
