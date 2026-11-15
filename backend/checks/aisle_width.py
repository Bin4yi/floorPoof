"""Aisle width: every cross-section of each aisle zone keeps a clear run of free cells.

Reads the cells linked IN_ZONE to each aisle Zone and their walkable flag.
"""
from collections import defaultdict

from .base import Ctx, Result, cells_needed, fail, ok, skipped

AISLE_CELLS = """MATCH (z:Zone {floor:$f, kind:$kind})<-[:IN_ZONE]-(c:Cell)
RETURN z.name AS zone, z.axis AS axis, c.x AS x, c.y AS y, c.walkable AS walkable"""


def _longest_run(flags: list[bool]) -> int:
    best = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return best


def run(ctx: Ctx) -> Result:
    p = ctx.params
    min_m = p.get("min_m")
    kind = p.get("zone_kind", "aisle")
    if min_m is None:
        return skipped(ctx, f"Minimum width for '{kind}' zones is TBD (no source yet).")
    need = cells_needed(min_m, ctx.cell_m)
    sections: dict[tuple, list] = defaultdict(list)
    axis_of = {}
    for r in ctx.g.q(AISLE_CELLS, {"f": ctx.floor, "kind": kind}):
        along = r["x"] if r["axis"] == "x" else r["y"]
        across = r["y"] if r["axis"] == "x" else r["x"]
        sections[(r["zone"], along)].append((across, r["walkable"], [r["x"], r["y"]]))
        axis_of[r["zone"]] = r["axis"]
    if not sections:
        return ok(ctx, f"No '{kind}' zones on this floor.")
    narrow: dict[str, list] = defaultdict(list)
    cells = []
    for (zone, along), cs in sorted(sections.items()):
        cs.sort()
        clear = _longest_run([w for _, w, _ in cs])
        if clear < need:
            narrow[zone].append((along, clear))
            cells += [c for _, w, c in cs if not w]
    if not narrow:
        return ok(ctx, f"All aisles keep at least {min_m} m clear ({need} cells of {ctx.cell_m} m).")
    parts = []
    for zone, lst in narrow.items():
        lo, hi = lst[0][0], lst[-1][0]
        worst = min(c for _, c in lst) * ctx.cell_m
        parts.append(f"{zone} at {axis_of[zone]}={lo}..{hi}: clear width {worst:.1f} m < {min_m} m")
    return fail(ctx, "; ".join(parts) + ".", cells)
