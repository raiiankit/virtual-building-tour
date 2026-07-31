"""UBM → DXF (R2010) — clean CAD round-trip export.

Turns the Universal Building Model back into a real, layered CAD drawing that opens
in AutoCAD / BricsCAD / DraftSight / LibreCAD: double-line walls, door leaves + swing
arcs, window glazing, closed room polylines and room-name text — each on its own layer.
Geometry is authored in metres (DXF $INSUNITS = 6). Plan Y is flipped so the drawing
reads Y-up, the CAD convention.
"""
from __future__ import annotations

import io
import math
from typing import Dict, List, Optional

import ezdxf
from ezdxf.enums import TextEntityAlignment

from .models import Point, UniversalBuildingModel, Wall

# layer name -> AutoCAD Color Index
LAYERS: Dict[str, int] = {
    "A-WALL": 7,        # walls        — white/black
    "A-WALL-PATT": 8,   # wall hatch   — grey (reserved)
    "A-DOOR": 1,        # doors        — red
    "A-GLAZ": 5,        # windows      — blue
    "A-AREA": 3,        # room outline — green
    "A-AREA-IDEN": 2,   # room labels  — yellow
    "A-COLS": 6,        # columns      — magenta
    "A-ANNO": 4,        # annotations  — cyan
}


def _P(pt: Point) -> tuple[float, float]:
    """UBM plan point → DXF point (Y-up)."""
    return (float(pt[0]), -float(pt[1]))


def _wall_dir(w: Wall) -> tuple[float, float]:
    dx = w.endPoint[0] - w.startPoint[0]
    dy = w.endPoint[1] - w.startPoint[1]
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def _dir_from(ubm: UniversalBuildingModel, wall_id: Optional[str], rotation: float) -> tuple[float, float]:
    """Along-wall unit vector for a door/window — from its host wall if known, else its rotation."""
    if wall_id:
        w = next((w for w in ubm.walls if w.id == wall_id), None)
        if w:
            return _wall_dir(w)
    return math.cos(rotation), math.sin(rotation)


def ubm_to_dxf(ubm: UniversalBuildingModel) -> bytes:
    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.M
    doc.header["$INSUNITS"] = 6  # metres
    for name, color in LAYERS.items():
        if name not in doc.layers:
            doc.layers.add(name, color=color)
    msp = doc.modelspace()

    # ---- walls: closed double-line footprint (thickness honoured) ----
    for w in ubm.walls:
        dx, dy = _wall_dir(w)
        px, py = -dy, dx                      # perpendicular
        h = max(w.thickness_m, 0.02) / 2.0
        s, e = w.startPoint, w.endPoint
        ring = [
            _P([s[0] + px * h, s[1] + py * h]),
            _P([e[0] + px * h, e[1] + py * h]),
            _P([e[0] - px * h, e[1] - py * h]),
            _P([s[0] - px * h, s[1] - py * h]),
        ]
        msp.add_lwpolyline(ring, close=True, dxfattribs={"layer": "A-WALL"})

    # ---- doors: opening line + leaf + swing arc ----
    for d in ubm.doors:
        dx, dy = _dir_from(ubm, d.wallId, d.rotation)
        hw = d.width_m / 2.0
        cx, cy = d.position[0], d.position[1]
        j0 = [cx - dx * hw, cy - dy * hw]     # hinge
        j1 = [cx + dx * hw, cy + dy * hw]     # latch
        # leaf swings 90° off the wall (perpendicular), full width
        px, py = -dy, dx
        leaf_end = [j0[0] + px * d.width_m, j0[1] + py * d.width_m]
        msp.add_line(_P(j0), _P(leaf_end), dxfattribs={"layer": "A-DOOR"})
        # swing arc, hinge-centred; DXF Y is flipped so mirror the sweep
        a_leaf = math.degrees(math.atan2(-py, px))
        a_open = math.degrees(math.atan2(-dy, dx))
        msp.add_arc(center=_P(j0), radius=d.width_m,
                    start_angle=min(a_leaf, a_open), end_angle=max(a_leaf, a_open),
                    dxfattribs={"layer": "A-DOOR"})
        msp.add_line(_P(j0), _P(j1), dxfattribs={"layer": "A-DOOR"})  # threshold

    # ---- windows: double glazing line across the opening ----
    for wn in ubm.windows:
        dx, dy = _dir_from(ubm, wn.wallId, 0.0)
        hw = wn.width_m / 2.0
        cx, cy = wn.position[0], wn.position[1]
        px, py = -dy, dx
        off = 0.04
        for s in (off, -off):
            a = [cx - dx * hw + px * s, cy - dy * hw + py * s]
            b = [cx + dx * hw + px * s, cy + dy * hw + py * s]
            msp.add_line(_P(a), _P(b), dxfattribs={"layer": "A-GLAZ"})

    # ---- rooms: closed outline + name at centroid ----
    for r in ubm.rooms:
        poly: List[Point] = r.polygon or []
        if len(poly) >= 3:
            msp.add_lwpolyline([_P(p) for p in poly], close=True, dxfattribs={"layer": "A-AREA"})
            cx = sum(p[0] for p in poly) / len(poly)
            cy = sum(p[1] for p in poly) / len(poly)
            label = r.name or r.type
            if r.area_m2:
                label = f"{label}\n{r.area_m2:.1f} m²"
            msp.add_text(label.split("\n")[0], height=0.28, dxfattribs={"layer": "A-AREA-IDEN"}) \
               .set_placement(_P([cx, cy]), align=TextEntityAlignment.MIDDLE_CENTER)

    # ---- columns ----
    for c in ubm.columns:
        hx, hy = c.width_m / 2.0, c.depth_m / 2.0
        x, y = c.at[0], c.at[1]
        ring = [[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy]]
        msp.add_lwpolyline([_P(p) for p in ring], close=True, dxfattribs={"layer": "A-COLS"})

    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue().encode("utf-8")
