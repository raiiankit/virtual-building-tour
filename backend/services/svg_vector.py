"""Exact vector extraction for structured SVG floor plans.

When an uploaded SVG carries real geometry — room polygons, wall bands, opening lines, door
swings and text labels (as produced by CAD exporters and plan tools) — we read those vectors
DIRECTLY instead of rasterising and guessing with CV. That yields exact rooms, names, walls,
doors, windows and even the real-world scale (recovered from the "22.50 m²" area labels).

Returns an `analysis.analyse`-shaped dict (pixels, normalised so the app's default 0.02 m/px
gives true metres), or None when the SVG isn't a parseable vector plan (→ fall back to raster).
"""
from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from statistics import median
from typing import Any, Dict, List, Optional, Tuple

from . import rooms as room_svc

_NUM = re.compile(r"-?\d+\.?\d*")
TARGET_SCALE = 0.02          # metres per output pixel — the app's default calibration
Pt = Tuple[float, float]


def _tag(el) -> str:
    return el.tag.rsplit("}", 1)[-1]


def _nums(s: str) -> List[float]:
    return [float(x) for x in _NUM.findall(s or "")]


def _points(s: str) -> List[Pt]:
    n = _nums(s)
    return list(zip(n[0::2], n[1::2]))


def _area(pts: List[Pt]) -> float:
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _centroid(pts: List[Pt]) -> Pt:
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def _pip(x: float, y: float, poly: List[Pt]) -> bool:
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


def _bbox(pts: List[Pt]):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def extract(svg_text: str) -> Optional[Dict[str, Any]]:
    try:
        root = ET.fromstring(svg_text)
    except Exception:
        return None

    polys: List[dict] = []
    lines: List[dict] = []
    paths: List[Pt] = []
    texts: List[dict] = []
    for el in root.iter():
        t = _tag(el)
        a = el.attrib
        if t == "polygon" and a.get("points"):
            polys.append({"pts": _points(a["points"]), "fill": a.get("fill", ""), "op": a.get("fill-opacity")})
        elif t == "rect":
            x, y = float(a.get("x", 0)), float(a.get("y", 0))
            w, h = float(a.get("width", 0)), float(a.get("height", 0))
            polys.append({"pts": [(x, y), (x + w, y), (x + w, y + h), (x, y + h)],
                          "fill": a.get("fill", ""), "op": a.get("fill-opacity")})
        elif t == "line":
            lines.append({"x1": float(a["x1"]), "y1": float(a["y1"]), "x2": float(a["x2"]),
                          "y2": float(a["y2"]), "sw": float(a.get("stroke-width", 1) or 1)})
        elif t == "path" and a.get("d"):
            n = _nums(a["d"])
            if len(n) >= 2:
                paths.append((n[0], n[1]))              # M x y — a door-swing hinge on the wall
        elif t == "text":
            txt = "".join(el.itertext()).strip()
            if txt:
                texts.append({"x": float(a.get("x", 0)), "y": float(a.get("y", 0)), "t": txt})

    # rooms = filled, semi-transparent polygons (the coloured room tints); skip the page + walls
    room_polys = [p for p in polys
                  if p.get("op") and p["fill"] not in ("none", "", "#ffffff") and len(p["pts"]) >= 3]
    if len(room_polys) < 2:
        return None                                     # not a structured vector plan

    area_re = re.compile(r"([\d.]+)\s*m[²2]")
    name_texts = [x for x in texts if not area_re.search(x["t"]) and not re.match(r"^[\d.]+\s*m\b", x["t"])]
    area_texts = [(x["x"], x["y"], float(area_re.search(x["t"]).group(1))) for x in texts if area_re.search(x["t"])]

    # ---- recover the real scale (metres per SVG unit) from area labels ----
    ratios: List[float] = []
    for rp in room_polys:
        cx, cy = _centroid(rp["pts"])
        near = min(area_texts, key=lambda a: math.hypot(a[0] - cx, a[1] - cy), default=None)
        if near and math.hypot(near[0] - cx, near[1] - cy) < max(_bbox(rp["pts"])[2] - _bbox(rp["pts"])[0], 1):
            au = _area(rp["pts"])
            if au > 1 and near[2] > 0:
                ratios.append(math.sqrt(near[2] / au))   # metres per unit
    m_per_unit = median(ratios) if ratios else None
    if not m_per_unit:
        # fall back: assume the drawing is authored in millimetres (common) if spans look large
        allpts = [p for rp in room_polys for p in rp["pts"]]
        span = max(_bbox(allpts)[2] - _bbox(allpts)[0], _bbox(allpts)[3] - _bbox(allpts)[1])
        m_per_unit = 0.001 if span > 300 else 1.0

    # normalise SVG units → output pixels so TARGET_SCALE (0.02 m/px) gives true metres
    allpts = [p for rp in room_polys for p in rp["pts"]]
    ox, oy, mx, my = _bbox(allpts)
    factor = m_per_unit / TARGET_SCALE
    T = lambda p: [round((p[0] - ox) * factor, 1), round((p[1] - oy) * factor, 1)]
    W = int((mx - ox) * factor) + 1
    H = int((my - oy) * factor) + 1

    # ---- rooms ----
    out_rooms: List[dict] = []
    for i, rp in enumerate(room_polys):
        poly = [T(p) for p in rp["pts"]]
        bx0, by0, bx1, by1 = _bbox(poly)
        cx, cy = _centroid(rp["pts"])
        nm = min((n for n in name_texts if _pip(n["x"], n["y"], rp["pts"])),
                 key=lambda n: math.hypot(n["x"] - cx, n["y"] - cy), default=None)
        name = nm["t"] if nm else None
        rtype = room_svc.classify(name)[0] if name else "room"
        out_rooms.append({"x": int(bx0), "y": int(by0), "w": int(bx1 - bx0), "h": int(by1 - by0),
                          "polygon": [[int(p[0]), int(p[1])] for p in poly],
                          "name": name or "Room", "type": rtype,
                          "confidence": 0.98 if name else 0.6,
                          "status": "detected" if name else "estimated", "label": name})

    # ---- walls: solid dark bands → centre-lines ----
    out_walls: List[dict] = []
    for p in polys:
        if p.get("op") or p["fill"] in ("none", "", "#ffffff"):
            continue                                     # a room tint / page, not a wall
        bx0, by0, bx1, by1 = _bbox([T(q) for q in p["pts"]])
        w, h = bx1 - bx0, by1 - by0
        if max(w, h) < 3:
            continue
        if w >= h:                                       # horizontal band
            cy = (by0 + by1) / 2
            out_walls.append({"x1": int(bx0), "y1": int(cy), "x2": int(bx1), "y2": int(cy), "confidence": 0.98})
        else:                                            # vertical band
            cx = (bx0 + bx1) / 2
            out_walls.append({"x1": int(cx), "y1": int(by0), "x2": int(cx), "y2": int(by1), "confidence": 0.98})

    # ---- openings: thin lines = windows, thick lines & swing paths = doors ----
    sws = sorted(l["sw"] for l in lines) or [1]
    thin_max = median(sws)
    out_windows: List[dict] = []
    out_doors: List[dict] = []
    for l in lines:
        (x1, y1), (x2, y2) = T((l["x1"], l["y1"])), T((l["x2"], l["y2"]))
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        ln = math.hypot(x2 - x1, y2 - y1)
        orient = "h" if abs(x2 - x1) >= abs(y2 - y1) else "v"
        if l["sw"] <= thin_max + 1e-6:
            out_windows.append({"x": int(cx), "y": int(cy), "orient": orient, "len": int(ln), "confidence": 0.95})
        else:
            out_doors.append({"x": int(cx), "y": int(cy), "orient": orient, "width": max(0.6, ln * TARGET_SCALE), "confidence": 0.95})
    for (hx, hy) in paths:                               # door-swing arcs → a door at the hinge
        p = T((hx, hy))
        out_doors.append({"x": int(p[0]), "y": int(p[1]), "orient": "h", "width": 0.9, "confidence": 0.95})

    return {
        "image_size": [W, H], "rooms": out_rooms, "walls": out_walls,
        "doors": out_doors, "windows": out_windows,
        "source": "svg-vector", "ocr_available": True,
        "scale_m_per_px": round(TARGET_SCALE, 5),        # exact — coords are pre-normalised to it
    }
