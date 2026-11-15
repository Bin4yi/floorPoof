import type { AgentRun, Change, Evaluation, FloorData } from "./types";

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = (data as any).detail;
    throw new Error(typeof d === "string" ? d : d?.message ? `${d.message} ${d.failed ? d.failed.join(", ") : ""}` : r.statusText);
  }
  return data as T;
}

export const api = {
  status: () => call<{ floors: { name: string; label: string; pack: string }[]; store: string; storage: string;
                       llm: { mode: string; live: boolean; model: string } }>("/api/status"),
  floor: (f: string) => call<FloorData>(`/api/floor/${f}`),
  evaluate: (floor: string, changes: Change[]) => call<Evaluation>("/api/evaluate", { floor, changes }),
  accept: (floor: string, changes: Change[]) => call<{ accepted: string; floor: FloorData }>("/api/accept", { floor, changes }),
  acceptProposal: (id: string) => call<{ accepted: string; floor: FloorData }>(`/api/accept-proposal/${id}`, {}),
  undo: (floor: string) => call<{ undone: string; floor: FloorData }>(`/api/undo/${floor}`, {}),
  agent: (floor: string, request: string) => call<AgentRun>("/api/agent", { floor, request }),
  fix: (floor: string, changes: Change[]) => call<AgentRun>("/api/fix", { floor, changes }),
  replays: (floor: string) => call<{ request: string; recorded_at: string; model: string }[]>(`/api/replays/${floor}`),
};
