"""Room geometry cleanup — turn raw CV segmentation blobs into clean, non-overlapping
rectilinear rooms.

Raster watershed produces jagged polygons that overlap their neighbours (a room can fill as
little as a third of its own bounding box). This pass:
  1. grid-partitions the footprint on a FINE uniform grid so areas stay accurate — every cell
     is awarded to exactly ONE room, the smallest room whose blob covers the cell centre, so
     small rooms (bath, powder, store) get carved cleanly out of larger ones;
  2. traces each room's cells into one outline, then SNAPS that outline onto the actual wall
     lines so the stair-steps collapse into straight walls.
Result: no overlaps, accurate areas, straight walls, low vertex count.
"""
from __future__ import annotations

import math
from collections import defaultdict, deque
from typing import Callable, Dict, List, Set, Tuple

from .models import Polygon, UniversalBuildingModel

Cell = Tuple[int, int]
Pt = Tuple[float, float]


def _poly_area(poly: Polygon) -> float:
    a = 0.0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _point_in_poly(x: float, y: float, poly: Polygon) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def _largest_component(cells: List[Cell]) -> Set[Cell]:
    remaining = set(cells)
    best: Set[Cell] = set()
    while remaining:
        seed = next(iter(remaining))
        comp: Set[Cell] = set()
        q = deque([seed])
        remaining.discard(seed)
        while q:
            i, j = q.popleft()
            comp.add((i, j))
            for n in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if n in remaining:
                    remaining.discard(n)
                    q.append(n)
        if len(comp) > len(best):
            best = comp
    return best


def _trace_boundary(cells: Set[Cell], corner: Callable[[int, int], Pt]) -> List[Pt]:
    """Outer boundary of a set of grid cells → one CCW ring. Directed edges are emitted with
    the filled interior on the left, then chained."""
    nxt: Dict[Pt, List[Pt]] = defaultdict(list)
    for (i, j) in cells:
        if (i, j - 1) not in cells:  # bottom  BL -> BR
            nxt[corner(i, j)].append(corner(i + 1, j))
        if (i + 1, j) not in cells:  # right   BR -> TR
            nxt[corner(i + 1, j)].append(corner(i + 1, j + 1))
        if (i, j + 1) not in cells:  # top     TR -> TL
            nxt[corner(i + 1, j + 1)].append(corner(i, j + 1))
        if (i - 1, j) not in cells:  # left    TL -> BL
            nxt[corner(i, j + 1)].append(corner(i, j))
    if not nxt:
        return []
    start = min(nxt.keys())
    loop: List[Pt] = [start]
    cur = start
    for _ in range(500000):
        outs = nxt.get(cur)
        if not outs:
            break
        n = outs.pop()
        if n == start:
            break
        loop.append(n)
        cur = n
    return loop


def _merge(coords: List[float], tol: float) -> List[float]:
    out: List[float] = []
    for c in sorted(coords):
        if not out or c - out[-1] > tol:
            out.append(c)
    return out


def _snap(ring: List[Pt], wall_xs: List[float], wall_zs: List[float], tol: float) -> List[List[float]]:
    """Pull each vertex onto the nearest wall grid line (within tol) so stair-steps that sit on
    a wall collapse to a straight edge."""
    def near(v: float, lines: List[float]) -> float:
        best, bd = v, tol
        for L in lines:
            d = abs(L - v)
            if d < bd:
                bd, best = d, L
        return best
    return [[round(near(x, wall_xs), 3), round(near(z, wall_zs), 3)] for x, z in ring]


def _simplify(poly: List[List[float]]) -> Polygon:
    # drop consecutive duplicates, then collinear middle vertices
    dedup: List[List[float]] = []
    for p in poly:
        if not dedup or abs(dedup[-1][0] - p[0]) > 1e-6 or abs(dedup[-1][1] - p[1]) > 1e-6:
            dedup.append(p)
    if len(dedup) > 1 and dedup[0] == dedup[-1]:
        dedup.pop()
    n = len(dedup)
    if n < 3:
        return dedup
    out: List[List[float]] = []
    for i in range(n):
        ax, ay = dedup[(i - 1) % n]
        bx, by = dedup[i]
        cx, cy = dedup[(i + 1) % n]
        cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        if abs(cross) > 1e-6:
            out.append([round(bx, 3), round(by, 3)])
    return out if len(out) >= 3 else dedup


def _owner_of(cx: float, cz: float, polys) -> int:
    """Smallest room whose blob covers (cx, cz) — small rooms carve out of large ones."""
    best, best_area = -1, 1e18
    for idx, (_, poly, area) in enumerate(polys):
        if area < best_area and _point_in_poly(cx, cz, poly):
            best, best_area = idx, area
    return best


def rectilinearize_rooms(ubm: UniversalBuildingModel, tol: float = 0.25, sub: float = 0.15) -> None:
    if not ubm.walls:
        return
    # partition EACH floor separately — a multi-storey plan stacks floors in the same X-Z
    # footprint, so mixing their rooms would let one floor's room steal another's cells.
    for lv in sorted({r.floor for r in ubm.rooms}):
        _partition_floor([r for r in ubm.rooms if r.floor == lv and len(r.polygon) >= 3], ubm.walls, tol, sub)
    pts = [p for r in ubm.rooms for p in r.polygon]
    if pts:
        axs = [p[0] for p in pts]
        azs = [p[1] for p in pts]
        ubm.metadata.bounds = {"minx": min(axs), "minz": min(azs), "maxx": max(axs), "maxz": max(azs)}


def _partition_floor(rooms: List, walls: List, tol: float, sub: float) -> None:
    if len(rooms) < 2:
        return
    polys = [(r, r.polygon, _poly_area(r.polygon)) for r in rooms]

    # Grid lines = wall coords AND room-edge coords (no clamping). Room-edge lines give every
    # room a boundary to snap to (so nothing collapses to a sliver); wall lines make shared
    # edges land on walls. Rooms keep their true extent — we never clip against possibly-
    # incomplete wall detection.
    wx = [w.startPoint[0] for w in walls] + [w.endPoint[0] for w in walls]
    wz = [w.startPoint[1] for w in walls] + [w.endPoint[1] for w in walls]
    rx = [p[0] for _, poly, _ in polys for p in poly]
    rz = [p[1] for _, poly, _ in polys for p in poly]
    xs = _merge(wx + rx, tol)
    zs = _merge(wz + rz, tol)
    if len(xs) < 2 or len(zs) < 2 or (len(xs) - 1) * (len(zs) - 1) > 200_000:
        return

    # award each wall-bounded cell to the room owning the MAJORITY of its area (accurate),
    # not just its centre (which distorts on big cells)
    owner: Dict[Cell, int] = {}
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            x0, x1, z0, z1 = xs[i], xs[i + 1], zs[j], zs[j + 1]
            nx = max(1, int((x1 - x0) / sub))
            nz = max(1, int((z1 - z0) / sub))
            votes: Dict[int, int] = defaultdict(int)
            total = 0
            for a in range(nx):
                sx = x0 + (a + 0.5) * (x1 - x0) / nx
                for b in range(nz):
                    sz = z0 + (b + 0.5) * (z1 - z0) / nz
                    total += 1
                    o = _owner_of(sx, sz, polys)
                    if o >= 0:
                        votes[o] += 1
            if votes:
                win = max(votes, key=votes.get)
                if votes[win] >= 0.4 * total:      # cell is mostly one room (not wall/void)
                    owner[(i, j)] = win

    cells_by: Dict[int, List[Cell]] = defaultdict(list)
    for cpos, idx in owner.items():
        cells_by[idx].append(cpos)

    def corner(i: int, j: int) -> Pt:
        return (xs[i], zs[j])

    for idx, (r, orig, area0) in enumerate(polys):
        cs = cells_by.get(idx)
        if not cs:
            continue                              # fully absorbed by neighbours — keep original
        ring = _simplify([list(p) for p in _trace_boundary(_largest_component(cs), corner)])
        if len(ring) >= 4 and _poly_area(ring) > 0.5:
            r.polygon = ring
            r.area_m2 = round(_poly_area(ring), 2)
