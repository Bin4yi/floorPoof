// Apply a change list to the item list, for drawing only. The server re-applies it in the graph.
import type { Change, Item, ItemType } from "./types";

export function size(t: { w: number; d: number }, rotation: number): [number, number] {
  return rotation === 90 || rotation === 270 ? [t.d, t.w] : [t.w, t.d];
}

export function applyDraft(items: Item[], changes: Change[], types: ItemType[]): Item[] {
  const byType = Object.fromEntries(types.map((t) => [t.name, t]));
  const map = new Map(items.map((i) => [i.id, { ...i }]));
  let anon = 0;
  for (const raw of changes) {
    // Agent proposals may add items with no id; give them a display id so they can be drawn and keyed.
    const c = raw.op === "add" && !raw.id ? { ...raw, id: `new${++anon}` } : raw;
    if (c.op === "add") {
      const t = byType[c.type];
      if (!t) continue;
      const [w, d] = size(t, c.rotation);
      map.set(c.id, { id: c.id, type: c.type, x: c.x, y: c.y, w, d, h: t.h, rotation: c.rotation, work: null,
                      panel: c.panel ?? null, line: c.line ?? null, seq: null });
    } else if (c.op === "move") {
      const it = map.get(c.id);
      if (!it) continue;
      const rot = c.rotation ?? it.rotation;
      const [w, d] = size(byType[it.type], rot);
      map.set(c.id, { ...it, x: c.x ?? it.x, y: c.y ?? it.y, rotation: rot, w, d, panel: c.panel ?? it.panel });
    } else if (c.op === "remove") {
      map.delete(c.id);
    }
  }
  return [...map.values()];
}

export function nextId(items: Item[], changes: Change[]): string {
  const used = new Set([...items.map((i) => i.id), ...changes.map((c) => c.id)]);
  let k = 1;
  while (used.has(`N${k}`)) k++;
  return `N${k}`;
}
