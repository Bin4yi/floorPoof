"""Line flow: walking the FEEDS chain of each line, work keeps moving forward.

Multi-hop: (head)-[:FEEDS*0..]->(tail) must cover every item IN_LINE, in seq
order, and each step must sit further along the line direction than the last.
"""
from .base import Ctx, Result, fail, item_cells, ok

CHAINS = """MATCH (l:Line {floor:$f})
OPTIONAL MATCH (m:Item)-[:IN_LINE]->(l)
WITH l, collect(m.id) AS members
OPTIONAL MATCH (h:Item)-[:IN_LINE]->(l) WHERE NOT EXISTS { (:Item)-[:FEEDS]->(h) }
OPTIONAL MATCH p = (h)-[:FEEDS*0..]->(t:Item) WHERE NOT EXISTS { (t)-[:FEEDS]->(:Item) }
RETURN l.name AS line, l.direction AS dir, members,
       [n IN nodes(p) | [n.id, n.x, n.y, n.w, n.d]] AS chain
ORDER BY line"""

AXIS = {"+x": (0, 1), "-x": (0, -1), "+y": (1, 1), "-y": (1, -1)}


def run(ctx: Ctx) -> Result:
    step_note = ""
    if "max_step_m" in ctx.params and ctx.params["max_step_m"] is None:
        step_note = " Step distance not checked (TBD)."
    by_line: dict[str, dict] = {}
    for r in ctx.g.q(CHAINS, {"f": ctx.floor}):
        d = by_line.setdefault(r["line"], {"dir": r["dir"], "members": set(r["members"]), "chains": []})
        if r["chain"]:
            d["chains"].append(r["chain"])
    if not by_line:
        return ok(ctx, "No production lines on this floor.")
    reasons, bad_ids = [], []
    for line, d in sorted(by_line.items()):
        if not d["members"]:
            continue
        if len(d["chains"]) != 1 or {c[0] for c in d["chains"][0]} != d["members"]:
            reasons.append(f"line {line} flow chain is broken")
            bad_ids += sorted(d["members"])
            continue
        k, sign = AXIS.get(d["dir"], (0, 1))
        prev = None
        for iid, x, y, w, dd in d["chains"][0]:
            centre = (x + w / 2) if k == 0 else (y + dd / 2)
            if prev is not None and (centre - prev[1]) * sign <= 0:
                reasons.append(f"line {line}: {iid} sits behind {prev[0]} (work flows backward)")
                bad_ids.append(iid)
            prev = (iid, centre)
    if not reasons:
        return ok(ctx, f"All {len(by_line)} lines flow forward." + step_note)
    return fail(ctx, "; ".join(reasons) + "." + step_note, item_cells(ctx, bad_ids))
