"""Footprint helpers used when *writing* items to the graph.

Checks never use these; they read OCCUPIES / WORKS_AT links from the graph.
"""
from __future__ import annotations

ROTATIONS = (0, 90, 180, 270)


def size(w: int, d: int, rotation: int) -> tuple[int, int]:
    """Footprint (width along x, depth along y) after rotation."""
    return (d, w) if rotation in (90, 270) else (w, d)


def footprint(x: int, y: int, w: int, d: int, rotation: int) -> list[tuple[int, int]]:
    fw, fd = size(w, d, rotation)
    return [(x + i, y + j) for i in range(fw) for j in range(fd)]


def work_cell(x: int, y: int, w: int, d: int, rotation: int) -> tuple[int, int]:
    """Cell where the operator stands: one cell out from the front side.

    rotation 0 faces +y, 90 faces +x, 180 faces -y, 270 faces -x.
    """
    fw, fd = size(w, d, rotation)
    if rotation == 0:
        return (x + fw // 2, y + fd)
    if rotation == 90:
        return (x + fw, y + fd // 2)
    if rotation == 180:
        return (x + fw // 2, y - 1)
    return (x - 1, y + fd // 2)
