"""Shared types for checks.

A check reads the graph only. It returns pass, fail or skipped (when the rule
number is TBD), a short reason, and the cells where it failed.
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any

from ..graph.db import Graph


@dataclass
class Ctx:
    g: Graph
    floor: str
    cell_m: float
    sprinklered: bool
    rule: dict
    cache: dict = field(default_factory=dict)

    @property
    def params(self) -> dict:
        return json.loads(self.rule["params"] or "{}")


@dataclass
class Result:
    rule_id: str
    kind: str
    status: str  # "pass" | "fail" | "skipped"
    detail: str
    cells: list[list[int]] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)
    ms: float = 0.0
    title: str = ""
    source_url: str | None = None
    source_note: str = ""

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


def ok(ctx: Ctx, detail: str, **data: Any) -> Result:
    return Result(ctx.rule["id"], ctx.rule["kind"], "pass", detail, data=data)


def fail(ctx: Ctx, detail: str, cells: list, **data: Any) -> Result:
    uniq = sorted({(int(c[0]), int(c[1])) for c in cells})
    return Result(ctx.rule["id"], ctx.rule["kind"], "fail", detail, [list(c) for c in uniq], data)


def skipped(ctx: Ctx, detail: str, **data: Any) -> Result:
    return Result(ctx.rule["id"], ctx.rule["kind"], "skipped", detail, data=data)


def cells_needed(width_m: float, cell_m: float) -> int:
    """Whole cells needed to give at least width_m of clear width."""
    return math.ceil(width_m / cell_m - 1e-9)


def item_cells(ctx: Ctx, ids: list[str]) -> list[list[int]]:
    if not ids:
        return []
    rows = ctx.g.q("""MATCH (i:Item {floor:$f})-[:OCCUPIES]->(c:Cell) WHERE i.id IN $ids
                      RETURN c.x AS x, c.y AS y""", {"f": ctx.floor, "ids": ids})
    return [[r["x"], r["y"]] for r in rows]
