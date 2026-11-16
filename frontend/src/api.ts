import type { Memory, AgentRun, Change, Evaluation, FloorData, FloorSpec, ItemDraft, ItemType, Suggestion } from "./types";

async function call<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch(path, body === undefined && !method ? undefined : {
    method: method ?? "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = (data as any).detail;
    if (r.status === 404 && d === "Not Found")
      throw new Error("The server is older than this page. Stop it and run .\\scripts\\run.ps1 again.");
    if (r.status === 405) throw new Error("The server is older than this page. Restart it with .\\scripts\\run.ps1.");
    throw new Error(typeof d === "string" ? d : d?.message ? `${d.message} ${d.failed ? d.failed.join(", ") : ""}` : r.statusText);
  }
  return data as T;
}

export type FloorRow = { name: string; label: string; pack: string; custom: boolean };

export const api = {
  status: () => call<{ floors: FloorRow[]; store: string; storage: string;
                       llm: { mode: string; live: boolean; model: string } }>("/api/status"),
  floor: (f: string) => call<FloorData>(`/api/floor/${f}`),
  evaluate: (floor: string, changes: Change[]) => call<Evaluation>("/api/evaluate", { floor, changes }),
  accept: (floor: string, changes: Change[]) => call<{ accepted: string; floor: FloorData }>("/api/accept", { floor, changes }),
  acceptProposal: (id: string) => call<{ accepted: string; floor: FloorData }>(`/api/accept-proposal/${id}`, {}),
  undo: (floor: string) => call<{ undone: string; floor: FloorData }>(`/api/undo/${floor}`, {}),
  agent: (floor: string, request: string) => call<AgentRun>("/api/agent", { floor, request }),
  fix: (floor: string, changes: Change[]) => call<AgentRun>("/api/fix", { floor, changes }),
  replays: (floor: string) => call<{ request: string; recorded_at: string; model: string }[]>(`/api/replays/${floor}`),
  suggest: (body: { floor: string; changes: Change[]; type?: string; rotation?: number; line?: string | null;
                    panel?: string | null; move_id?: string | null }) => call<Suggestion>("/api/suggest", body),
  describe: (text: string) => call<ItemDraft>("/api/item-types/describe", { text }),
  addItemType: (floor: string, t: ItemDraft) =>
    call<{ item_type: ItemType; floor: FloorData }>("/api/item-types", { floor, ...t }),
  createFloor: (spec: FloorSpec) => call<{ name: string; floor: FloorData }>("/api/floors", { spec }),
  editFloor: (name: string, spec: FloorSpec) =>
    call<{ name: string; floor: FloorData; kept_items: number; sent_items: number }>(`/api/floors/${name}`, { spec }, "PUT"),
  floorSpec: (name: string) => call<FloorSpec>(`/api/floors/${name}/spec`),
  memory: (floor: string, q: string) => call<Memory[]>(`/api/memory/${floor}?q=${encodeURIComponent(q)}`),
  deleteFloor: (name: string) => call<{ deleted: string }>(`/api/floors/${name}`, undefined, "DELETE"),
};
