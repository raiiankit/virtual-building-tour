"""Exact vector extraction for structured PDF floor plans (one page = one floor).

A vector PDF carries the plan as real geometry — wall lines, door-swing curves and text
labels with true metre dimensions ("5.00 x 4.50 m"). We read those vectors directly: render
the CLEAN walls to a barrier image, watershed-segment from the exact label positions (so every
labelled room grows to its real walls), name each room from its label and recover the true
scale from the "10.00 m" building dimension. No CV guessing, no rasterisation of a photo.

Returns an `analysis.analyse`-shaped dict (pixels, normalised to 0.02 m/px so real metres come
out right; rooms tagged with their floor `level`), or None when the PDF isn't a vector plan.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from . import rooms as room_svc
from ..ubm.rooms import _merge, _trace_boundary, _largest_component, _simplify

try:
    import fitz  # PyMuPDF
    _OK = True
except Exception:                       # pragma: no cover
    _OK = False

_DIM = re.compile(r"([\d.]+)\s*x\s*([\d.]+)\s*m", re.I)
_ONE = re.compile(r"^([\d.]+)\s*m$", re.I)
TARGET = 0.02                           # metres per output pixel
PPP = 2.0                               # render pixels per PDF point
Pt = Tuple[float, float]


def _text_lines(pg) -> List[dict]:
    out = []
    for b in pg.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"]).strip()
            if t:
                x0, y0, x1, y1 = l["bbox"]
                out.append({"t": t, "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2})
    return out


def _wall_segs(pg) -> List[Tuple[Pt, Pt]]:
    segs = []
    for p in pg.get_drawings():
        for it in p["items"]:
            if it[0] == "l":
                segs.append(((it[1].x, it[1].y), (it[2].x, it[2].y)))
            elif it[0] == "re":
                r = it[1]
                if (r.x1 - r.x0) * (r.y1 - r.y0) < 0.6 * abs(pg.rect.width * pg.rect.height):
                    segs += [((r.x0, r.y0), (r.x1, r.y0)), ((r.x1, r.y0), (r.x1, r.y1)),
                             ((r.x1, r.y1), (r.x0, r.y1)), ((r.x0, r.y1), (r.x0, r.y0))]
    return segs


def _door_pts(pg) -> List[Pt]:
    pts = []
    for p in pg.get_drawings():
        for it in p["items"]:
            if it[0] == "c":                        # bezier — a door-swing arc; hinge ≈ first point
                pts.append((it[1].x, it[1].y))
    return pts


def _extract_page(pg, level: int):
    lines = _text_lines(pg)
    walls = _wall_segs(pg)
    if len(walls) < 6 or len(lines) < 3:
        return None
    # split text into room-name labels, room dims and standalone building dims
    names, dims, overall = [], [], []
    for ln in lines:
        t = ln["t"]
        m = _DIM.search(t)
        if m:
            dims.append({"cx": ln["cx"], "cy": ln["cy"], "w": float(m.group(1)), "h": float(m.group(2))})
            continue
        o = _ONE.match(t)
        if o:
            overall.append(float(o.group(1)))
            continue
        bad = ("|" in t or "Villa" in t or "Plan" in t or "Scale" in t or "Floor" in t)
        if 3 <= len(t) <= 22 and re.match(r"^[A-Za-z]", t) and not bad:
            names.append({"cx": ln["cx"], "cy": ln["cy"], "t": t})
    if len(names) < 2:
        return None

    # scale + building bbox (largest wall span = the labelled building dimension in metres)
    axs = [p[0] for s in walls for p in s]
    ays = [p[1] for s in walls for p in s]
    bx0, by0, bx1, by1 = min(axs), min(ays), max(axs), max(ays)
    span_pt = max(bx1 - bx0, by1 - by0)
    span_m = max(overall) if overall else max((d["w"] for d in dims), default=10)
    m_per_pt = span_m / span_pt if span_pt else 0.02

    def to_px(p):
        return (round((p[0] - bx0) * PPP), round((p[1] - by0) * PPP))
    Wpx, Hpx = round((bx1 - bx0) * PPP), round((by1 - by0) * PPP)
    px_per_m = PPP / m_per_pt

    # keep only real wall segments inside the shell (drops dimension arrows / the N marker)
    seg = []
    for a, b in walls:
        pa, pb = to_px(a), to_px(b)
        if all(-3 <= v <= Wpx + 3 for v in (pa[0], pb[0])) and all(-3 <= v <= Hpx + 3 for v in (pa[1], pb[1])):
            seg.append((pa, pb))

    # Partition on the ACTUAL WALL GRID. A cell joins its neighbour only when NO wall lies on the
    # shared edge — but a door gap must NOT connect two rooms, so an edge also blocks whenever the
    # two cells are geodesically closer to different labels. Net effect: each wall-bounded room,
    # split cleanly at doorways, named by the label inside it. Exact, wall-true rooms.
    tol = 0.25 * px_per_m
    et = 0.35 * px_per_m
    gx = _merge([(a[0] + b[0]) / 2 for a, b in seg if abs(b[0] - a[0]) <= abs(b[1] - a[1])] + [0, Wpx], tol)
    gz = _merge([(a[1] + b[1]) / 2 for a, b in seg if abs(b[0] - a[0]) > abs(b[1] - a[1])] + [0, Hpx], tol)
    if len(gx) < 2 or len(gz) < 2:
        return None
    vseg = [(a[0], min(a[1], b[1]), max(a[1], b[1])) for a, b in seg if abs(b[0] - a[0]) <= abs(b[1] - a[1])]
    hseg = [(a[1], min(a[0], b[0]), max(a[0], b[0])) for a, b in seg if abs(b[0] - a[0]) > abs(b[1] - a[1])]

    def wall_v(x, z0, z1):                     # a vertical wall on the edge at x over [z0,z1]?
        m = (z0 + z1) / 2
        return any(abs(vx - x) < et and vz0 - et <= m <= vz1 + et for vx, vz0, vz1 in vseg)

    def wall_h(z, x0, x1):
        m = (x0 + x1) / 2
        return any(abs(hz - z) < et and hx0 - et <= m <= hx1 + et for hz, hx0, hx1 in hseg)

    ncx, ncz = len(gx) - 1, len(gz) - 1
    lab_px = [to_px((n["cx"], n["cy"])) for n in names]

    def nearest(cx, cy):
        return min(range(len(names)), key=lambda k: (lab_px[k][0] - cx) ** 2 + (lab_px[k][1] - cy) ** 2)

    parent: Dict[Tuple[int, int], Tuple[int, int]] = {(i, j): (i, j) for i in range(ncx) for j in range(ncz)}

    def find(c):
        while parent[c] != c:
            parent[c] = parent[parent[c]]
            c = parent[c]
        return c

    cen = [[( (gx[i] + gx[i + 1]) / 2, (gz[j] + gz[j + 1]) / 2 ) for j in range(ncz)] for i in range(ncx)]
    own = [[nearest(*cen[i][j]) for j in range(ncz)] for i in range(ncx)]
    for i in range(ncx):
        for j in range(ncz):
            if i + 1 < ncx and own[i][j] == own[i + 1][j] and not wall_v(gx[i + 1], gz[j], gz[j + 1]):
                parent[find((i, j))] = find((i + 1, j))
            if j + 1 < ncz and own[i][j] == own[i][j + 1] and not wall_h(gz[j + 1], gx[i], gx[i + 1]):
                parent[find((i, j))] = find((i, j + 1))

    comps: Dict[Tuple[int, int], list] = defaultdict(list)
    for i in range(ncx):
        for j in range(ncz):
            comps[find((i, j))].append((i, j))
    # each room = the union of components whose cells are nearest to its label
    cells_by: Dict[int, list] = defaultdict(list)
    for cid, cells in comps.items():
        i0, j0 = cells[0]
        cells_by[own[i0][j0]].extend(cells)

    def corner(i, j):
        return (gx[i], gz[j])

    rooms = []
    for k, n in enumerate(names):
        cells = cells_by.get(k)
        if not cells:
            continue
        ring = _simplify([list(p) for p in _trace_boundary(_largest_component(cells), corner)])
        if len(ring) < 4:
            continue
        rxs = [p[0] for p in ring]
        rys = [p[1] for p in ring]
        dm = min(dims, key=lambda d: math.hypot(d["cx"] - n["cx"], d["cy"] - n["cy"]), default=None)
        exact = [dm["w"], dm["h"]] if dm and math.hypot(dm["cx"] - n["cx"], dm["cy"] - n["cy"]) < 40 else None
        rooms.append({"x": int(min(rxs)), "y": int(min(rys)), "w": int(max(rxs) - min(rxs)),
                      "h": int(max(rys) - min(rys)), "polygon": [[int(p[0]), int(p[1])] for p in ring],
                      "name": n["t"], "type": room_svc.classify(n["t"])[0], "confidence": 0.98,
                      "status": "detected", "label": n["t"], "level": level, "dim_values": exact})
    if len(rooms) < 2:
        return None

    out_walls = [{"x1": a[0], "y1": a[1], "x2": b[0], "y2": b[1], "confidence": 0.98, "level": level}
                 for a, b in seg]

    # a door swing is drawn as several bezier curves — collapse nearby curve starts into ONE door,
    # and keep only those that sit on a wall (drops the N compass arc and stray curves)
    def near_wall(px, py):
        return (any(abs(px - vx) < 0.5 * px_per_m and vz0 - et <= py <= vz1 + et for vx, vz0, vz1 in vseg)
                or any(abs(py - hz) < 0.5 * px_per_m and hx0 - et <= px <= hx1 + et for hz, hx0, hx1 in hseg))
    dth = 0.6 * px_per_m
    dpts: List[Tuple[int, int]] = []
    for p in _door_pts(pg):
        q = to_px(p)
        if not near_wall(*q):
            continue
        if not any((q[0] - r[0]) ** 2 + (q[1] - r[1]) ** 2 < dth * dth for r in dpts):
            dpts.append(q)
    out_doors = [{"x": p[0], "y": p[1], "orient": "h", "width": 0.9, "confidence": 0.95, "level": level} for p in dpts]
    return {"rooms": rooms, "walls": out_walls, "doors": out_doors, "windows": [],
            "size": (Wpx, Hpx), "m_per_px": m_per_pt / PPP, "level": level}


def _rescale(result: Dict[str, Any], f: float):
    def s(v):
        return int(round(v * f))
    for r in result["rooms"]:
        r["x"], r["y"], r["w"], r["h"] = s(r["x"]), s(r["y"]), s(r["w"]), s(r["h"])
        r["polygon"] = [[s(p[0]), s(p[1])] for p in r["polygon"]]
    for w in result["walls"]:
        w["x1"], w["y1"], w["x2"], w["y2"] = s(w["x1"]), s(w["y1"]), s(w["x2"]), s(w["y2"])
    for d in result["doors"] + result["windows"]:
        d["x"], d["y"] = s(d["x"]), s(d["y"])


def extract(path: str) -> Optional[Dict[str, Any]]:
    if not _OK:
        return None
    try:
        doc = fitz.open(path)
    except Exception:
        return None
    pages = []
    for level, pg in enumerate(doc):
        pd = _extract_page(pg, level)
        if pd:
            # normalise each page so TARGET (0.02 m/px) yields true metres
            _rescale(pd, pd["m_per_px"] / TARGET)
            pages.append(pd)
    if not pages:
        return None

    rooms, walls, doors, windows = [], [], [], []
    W = H = 0
    for pd in pages:
        rooms += pd["rooms"]
        walls += pd["walls"]           # exterior shell shared across floors
        doors += pd["doors"]
        W = max(W, max((r["x"] + r["w"] for r in pd["rooms"]), default=0))
        H = max(H, max((r["y"] + r["h"] for r in pd["rooms"]), default=0))
    return {"image_size": [W + 1, H + 1], "rooms": rooms, "walls": walls, "doors": doors,
            "windows": windows, "stairs": [], "ocr_available": True,
            "source": "pdf-vector", "scale_m_per_px": TARGET, "levels": len(pages)}
