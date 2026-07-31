"""Presentation-quality 2D floor-plan SVG, generated fresh from the UBM (never annotating
the uploaded image). Pastel room fills + name/area labels, thick walls with column nodes,
oriented door swings, window openings, overall + per-room dimension lines and light furniture
symbols — a clean architectural plan. Every wall/room/door/window keeps its UBM id so a
vector editor can still select and edit it."""
from __future__ import annotations

import html
import math
from .models import UniversalBuildingModel

PPM = 100.0          # px per metre
PAD = 90.0           # room for the dimension lines + title
BG = "#f7f8fa"
WALL = "#2f3542"
NODE = "#aab0bb"
DIM = "#9aa1ac"
DIM_HL = "#e8833a"   # overall-width highlight (orange)

ROOM_FILL = {
    "living_room": "#e6e9f4", "drawing": "#e6e9f4", "hall": "#e6e9f4",
    "bedroom": "#e4e0f1", "master_bedroom": "#ddd8ee", "guest": "#ece7f3",
    "kitchen": "#f6e3ca", "dining": "#f3ead6", "bathroom": "#d9ede8", "powder": "#d9ede8",
    "garage": "#e7e9ee", "foyer": "#eef0f6", "corridor": "#eef0f6", "passage": "#eef0f6",
    "balcony": "#e6f4e9", "utility": "#eef1f6", "store": "#eef1f6", "staircase": "#f0eef6",
    "office": "#efe9f6", "room": "#eef1f6",
}

# room-type -> one furniture symbol (label, w_m, h_m, anchor) drawn only when it fully fits
FURNITURE = {
    "bedroom": ("Bed", 1.4, 1.9, "top"),
    "master_bedroom": ("Bed", 1.6, 2.0, "top"),
    "guest": ("Bed", 1.4, 1.9, "top"),
    "living_room": ("Sofa", 2.0, 0.85, "bottom"),
    "drawing": ("Sofa", 2.2, 0.85, "bottom"),
    "hall": ("Sofa", 2.0, 0.85, "bottom"),
    "kitchen": ("Sink", 0.6, 0.45, "top"),
    "dining": ("Table", 1.6, 0.9, "bottom"),
    "bathroom": ("Shower", 0.85, 0.85, "top"),
    "powder": ("WC", 0.4, 0.55, "top"),
}


def _bounds(ubm):
    pts = [p for r in ubm.rooms for p in r.polygon] + [w.startPoint for w in ubm.walls] + [w.endPoint for w in ubm.walls]
    if not pts:
        return {"minx": 0, "minz": 0, "maxx": 10, "maxz": 10}
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    return {"minx": min(xs), "minz": min(zs), "maxx": max(xs), "maxz": max(zs)}


def _centroid(poly):
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    return [sum(xs) / len(xs), sum(zs) / len(zs)]


def _poly_bbox(poly):
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    return min(xs), min(zs), max(xs), max(zs)


def ubm_to_svg(ubm: UniversalBuildingModel) -> str:
    bd = ubm.metadata.bounds or _bounds(ubm)
    minx, minz, maxx, maxz = bd["minx"], bd["minz"], bd["maxx"], bd["maxz"]
    W = (maxx - minx) * PPM + 2 * PAD
    H = (maxz - minz) * PPM + 2 * PAD
    tx = lambda x: (x - minx) * PPM + PAD
    tz = lambda z: (z - minz) * PPM + PAD
    e = html.escape
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" '
           f'viewBox="0 0 {W:.0f} {H:.0f}" preserveAspectRatio="xMidYMid meet" '
           f'font-family="Inter,Segoe UI,Arial,sans-serif" data-ubm="{e(ubm.metadata.version)}">',
           f'<rect width="{W:.0f}" height="{H:.0f}" fill="{BG}"/>',
           f'<text x="{PAD-30:.0f}" y="34" font-size="13" fill="#8a94a6">'
           f'{e(ubm.project.name or "Extracted Project")}</text>']

    # ---------- rooms + labels ----------
    out.append('<g id="rooms">')
    for r in ubm.rooms:
        pts = " ".join(f"{tx(p[0]):.1f},{tz(p[1]):.1f}" for p in r.polygon)
        fill = ROOM_FILL.get(r.type, ROOM_FILL["room"])
        out.append(f'<polygon id="{e(r.id)}" class="room" data-type="{e(r.type)}" points="{pts}" '
                   f'fill="{fill}" stroke="#c3c9d4" stroke-width="1"/>')
    out.append('</g>')

    # ---------- furniture (one light symbol per room, only if it fully fits) ----------
    out.append('<g id="furniture" fill="none" stroke="#c3c9d4" stroke-width="1.2">')
    for r in ubm.rooms:
        item = FURNITURE.get(r.type)
        if not item:
            continue
        label, fw, fh, anchor = item
        bx0, bz0, bx1, bz1 = _poly_bbox(r.polygon)
        m = 0.35
        if fw > (bx1 - bx0) - 2 * m or fh > (bz1 - bz0) - 2 * m:
            continue                              # too tight — leave the room empty
        cxr = (bx0 + bx1) / 2 - fw / 2
        fz0 = bz0 + m if anchor == "top" else (bz1 - m - fh if anchor == "bottom" else (bz0 + bz1) / 2 - fh / 2)
        x, y = tx(cxr), tz(fz0)
        out.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{fw*PPM:.1f}" height="{fh*PPM:.1f}" rx="4"/>')
        out.append(f'<text x="{tx(cxr + fw/2):.1f}" y="{tz(fz0 + fh/2)+3:.1f}" font-size="8" fill="#aab0bb" '
                   f'text-anchor="middle" stroke="none">{e(label)}</text>')
    out.append('</g>')

    # ---------- walls (interior first, exterior on top) ----------
    out.append(f'<g id="walls" stroke="{WALL}" stroke-linecap="round" fill="none">')
    for w in sorted(ubm.walls, key=lambda w: w.exterior):
        sw = max(6.0, w.thickness_m * PPM) if w.exterior else max(4.0, w.thickness_m * PPM)
        out.append(f'<line id="{e(w.id)}" class="wall" data-exterior="{str(w.exterior).lower()}" '
                   f'x1="{tx(w.startPoint[0]):.1f}" y1="{tz(w.startPoint[1]):.1f}" '
                   f'x2="{tx(w.endPoint[0]):.1f}" y2="{tz(w.endPoint[1]):.1f}" stroke-width="{sw:.1f}"/>')
    out.append('</g>')

    ang = {w.id: math.atan2(w.endPoint[1] - w.startPoint[1], w.endPoint[0] - w.startPoint[0]) for w in ubm.walls}

    # ---------- windows (white gap + glazing line) ----------
    out.append('<g id="windows">')
    for wd in ubm.windows:
        a = ang.get(wd.wallId or "", 0.0)
        hw = wd.width_m / 2
        dx, dz = math.cos(a) * hw, math.sin(a) * hw
        x1, y1 = tx(wd.position[0] - dx), tz(wd.position[1] - dz)
        x2, y2 = tx(wd.position[0] + dx), tz(wd.position[1] + dz)
        out.append(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{BG}" stroke-width="9" stroke-linecap="butt"/>')
        out.append(f'<line id="{e(wd.id)}" class="window" x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#7aa7d9" stroke-width="2.5"/>')
    out.append('</g>')

    # ---------- doors (gap + oriented swing) ----------
    out.append(f'<g id="doors" fill="none" stroke="#9aa1ac" stroke-width="1.6">')
    for d in ubm.doors:
        a = ang.get(d.wallId or "", d.rotation)
        hw = d.width_m / 2
        alx, alz = math.cos(a), math.sin(a)
        px, pz = -alz, alx                       # perpendicular (swing side)
        hinge = (d.position[0] - alx * hw, d.position[1] - alz * hw)
        jamb = (d.position[0] + alx * hw, d.position[1] + alz * hw)
        leaf = (hinge[0] + px * d.width_m, hinge[1] + pz * d.width_m)
        hx, hy = tx(hinge[0]), tz(hinge[1])
        jx, jy = tx(jamb[0]), tz(jamb[1])
        lx, ly = tx(leaf[0]), tz(leaf[1])
        col = "#6f9f74" if d.entrance else "#9aa1ac"
        # white gap across the wall
        out.append(f'<line x1="{hx:.1f}" y1="{hy:.1f}" x2="{jx:.1f}" y2="{jy:.1f}" stroke="{BG}" stroke-width="7" stroke-linecap="butt"/>')
        out.append(f'<path id="{e(d.id)}" class="door" data-entrance="{str(d.entrance).lower()}" stroke="{col}" '
                   f'd="M {jx:.1f} {jy:.1f} L {hx:.1f} {hy:.1f} L {lx:.1f} {ly:.1f} '
                   f'M {lx:.1f} {ly:.1f} A {d.width_m*PPM:.1f} {d.width_m*PPM:.1f} 0 0 0 {jx:.1f} {jy:.1f}"/>')
    out.append('</g>')

    # ---------- column nodes at wall junctions ----------
    nodes = {}
    for w in ubm.walls:
        for p in (w.startPoint, w.endPoint):
            k = (round(p[0], 1), round(p[1], 1))
            nodes[k] = p
    out.append(f'<g id="nodes" fill="{NODE}" stroke="#ffffff" stroke-width="1.5">')
    for p in nodes.values():
        out.append(f'<circle cx="{tx(p[0]):.1f}" cy="{tz(p[1]):.1f}" r="5"/>')
    out.append('</g>')

    # ---------- room name + area labels (on top) ----------
    out.append('<g id="labels" text-anchor="middle">')
    for r in ubm.rooms:
        cx, cz = _centroid(r.polygon)
        x, y = tx(cx), tz(cz)
        out.append(f'<text x="{x:.1f}" y="{y-2:.1f}" font-size="12.5" font-weight="600" fill="#2f3542">{e(r.name)}</text>')
        out.append(f'<text x="{x:.1f}" y="{y+13:.1f}" font-size="10.5" fill="#6b7280">{r.area_m2:.2f} m²</text>')
    out.append('</g>')

    # ---------- dimensions ----------
    out.append('<g id="dims" font-size="10" fill="#6b7280" text-anchor="middle">')
    left, right = tx(minx), tx(maxx)
    top, bottom = tz(minz), tz(maxz)
    # overall width (top, highlighted)
    yb = top - 46
    out.append(_dim_h(left, right, yb, f"{maxx-minx:.2f} m", DIM_HL, "Overall width"))
    # overall height (right side)
    xb = right + 46
    out.append(_dim_v(top, bottom, xb, f"{maxz-minz:.2f} m", DIM))
    # per-room widths just inside their top edge
    for r in ubm.rooms:
        bx0, bz0, bx1, bz1 = _poly_bbox(r.polygon)
        if (bx1 - bx0) >= 1.4 and (bz1 - bz0) >= 1.2:
            out.append(_dim_h(tx(bx0), tx(bx1), tz(bz0) + 16, f"{bx1-bx0:.2f} m", DIM, None, small=True))
    out.append('</g>')

    out.append('</svg>')
    return "".join(out)


def _dim_h(x1, x2, y, label, color, caption=None, small=False):
    tick = 5
    parts = [f'<g stroke="{color}" stroke-width="1">',
             f'<line x1="{x1:.1f}" y1="{y:.1f}" x2="{x2:.1f}" y2="{y:.1f}"/>',
             f'<line x1="{x1:.1f}" y1="{y-tick:.1f}" x2="{x1:.1f}" y2="{y+tick:.1f}"/>',
             f'<line x1="{x2:.1f}" y1="{y-tick:.1f}" x2="{x2:.1f}" y2="{y+tick:.1f}"/>',
             '</g>']
    fs = 9 if small else 10
    cx = (x1 + x2) / 2
    if caption:
        parts.append(f'<text x="{cx:.1f}" y="{y-16:.1f}" font-size="10" fill="{color}">{caption}</text>')
    parts.append(f'<text x="{cx:.1f}" y="{y-4:.1f}" font-size="{fs}" fill="{color}">{label}</text>')
    return "".join(parts)


def _dim_v(y1, y2, x, label, color):
    tick = 5
    cy = (y1 + y2) / 2
    return (f'<g stroke="{color}" stroke-width="1">'
            f'<line x1="{x:.1f}" y1="{y1:.1f}" x2="{x:.1f}" y2="{y2:.1f}"/>'
            f'<line x1="{x-tick:.1f}" y1="{y1:.1f}" x2="{x+tick:.1f}" y2="{y1:.1f}"/>'
            f'<line x1="{x-tick:.1f}" y1="{y2:.1f}" x2="{x+tick:.1f}" y2="{y2:.1f}"/></g>'
            f'<text x="{x+4:.1f}" y="{cy:.1f}" font-size="10" fill="{color}" text-anchor="start" '
            f'transform="rotate(90 {x+4:.1f} {cy:.1f})">{label}</text>')
