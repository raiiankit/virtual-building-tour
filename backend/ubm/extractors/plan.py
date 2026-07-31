"""PlanExtractor — the workhorse for raster / vector-PDF / SVG / DXF / DWG.

It reuses the proven CV+OCR+vector pipeline (services.analysis, which already routes
every one of these formats through services.plan_loader) and normalises the detected
walls / rooms / doors / windows into the Universal Building Model. One code path, many
formats — exactly the point of the UBM."""
from __future__ import annotations

import math
from typing import Any, Dict, List

from ..base import Extractor, register
from ..models import (UniversalBuildingModel, UBMMetadata, ProjectMeta, Room, Wall, Door,
                       Window, Stair, Floor, Building, Material, ValidationIssue)
from ...services import analysis

DEFAULT_SCALE = 0.02          # metres per pixel until calibrated (matches the editor default)
_STD_MATS = [
    Material(id="m-plaster", name="Matte plaster", kind="plaster", color="#eceae4"),
    Material(id="m-wood", name="Natural wood", kind="wood", color="#9c6b3f"),
    Material(id="m-aluminium", name="Aluminium", kind="aluminium", color="#c8ccd0"),
    Material(id="m-glass", name="Clear glass", kind="glass", color="#bcd6e6"),
]


def _exterior(a, b, bnds, tol):
    minx, minz, maxx, maxz = bnds
    on = lambda v, lo, hi: abs(v - lo) < tol or abs(v - hi) < tol
    if abs(a[0] - b[0]) < 1e-6:                       # vertical
        return on(a[0], minx, maxx)
    if abs(a[1] - b[1]) < 1e-6:                       # horizontal
        return on(a[1], minz, maxz)
    return False


def analysis_to_ubm(result: Dict[str, Any], meta: ProjectMeta, *, scale: float = DEFAULT_SCALE,
                    unit: str = "m", source_format: str = "raster", extractor: str = "plan",
                    floor_count: int = 1) -> UniversalBuildingModel:
    S = scale
    ubm = UniversalBuildingModel(project=meta, materials=list(_STD_MATS))
    rooms_px = result.get("rooms", [])

    # footprint bounds (metres) from rooms
    xs, zs = [], []
    for r in rooms_px:
        xs += [r["x"] * S, (r["x"] + r["w"]) * S]
        zs += [r["y"] * S, (r["y"] + r["h"]) * S]
    bnds = (min(xs) if xs else 0, min(zs) if zs else 0, max(xs) if xs else 0, max(zs) if zs else 0)
    tol = max(0.25, (bnds[2] - bnds[0]) * 0.03)

    for i, r in enumerate(rooms_px):
        x, y, w, h = r["x"] * S, r["y"] * S, r["w"] * S, r["h"] * S
        rid = f"room-{i + 1}"
        rtype = r.get("type", "room")
        # use the true detected polygon (real room shape) when available, else the bbox
        pxpoly = r.get("polygon")
        poly = [[p[0] * S, p[1] * S] for p in pxpoly] if pxpoly and len(pxpoly) >= 3 \
            else [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
        conf = float(r.get("confidence", 0.7))
        ubm.rooms.append(Room(id=rid, name=r.get("name", "Room"), type=rtype, polygon=poly,
                              area_m2=round(w * h, 2), floor=r.get("level", 0),
                              confidence=conf, status=r.get("status", "detected"),
                              ocrText=r.get("label") or None))
        if rtype in ("staircase", "stair"):
            ubm.stairs.append(Stair(id=f"stair-{i + 1}", polygon=poly, floor=r.get("level", 0)))

    for i, w in enumerate(result.get("walls", [])):
        a = [w["x1"] * S, w["y1"] * S]
        b = [w["x2"] * S, w["y2"] * S]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.15:
            continue
        ext = _exterior(a, b, bnds, tol)
        ubm.walls.append(Wall(id=f"wall-{i + 1}", startPoint=a, endPoint=b, length_m=round(L, 3),
                              thickness_m=0.2 if ext else 0.12, exterior=ext, material="plaster",
                              floor=int(w.get("level", 0))))

    for i, d in enumerate(result.get("doors", [])):
        ubm.doors.append(Door(id=f"door-{i + 1}", position=[d["x"] * S, d["y"] * S],
                              rotation=0.0 if d.get("orient") == "h" else math.pi / 2,
                              width_m=float(d.get("width") or (1.1 if d.get("entrance") else 0.9)),
                              entrance=bool(d.get("entrance")),
                              openingDirection="slide" if d.get("glass") else "in",
                              floor=int(d.get("level", 0))))

    for i, wd in enumerate(result.get("windows", [])):
        ln = float(wd.get("len") or 24) * S
        ubm.windows.append(Window(id=f"win-{i + 1}", position=[wd["x"] * S, wd["y"] * S],
                                  width_m=round(max(0.6, min(ln, 3.0)), 2), floor=int(wd.get("level", 0))))

    levels = sorted({r.floor for r in ubm.rooms}) or [0]
    fc = max(floor_count, len(levels))
    ubm.building = Building(type=meta_building_type(meta), floor_count=fc,
                            entrances=[d.position for d in ubm.doors if d.entrance])
    ubm.floors = [Floor(level=lv, name=f"Floor {lv + 1}",
                        rooms=[r.id for r in ubm.rooms if r.floor == lv]) for lv in range(fc)]
    ubm.metadata = UBMMetadata(source_format=source_format, extractor=extractor, unit=unit,
                               scale_m_per_unit=S, confidence=round(_avg_conf(result), 2),
                               bounds={"minx": bnds[0], "minz": bnds[1], "maxx": bnds[2], "maxz": bnds[3]},
                               extra={"detector": result.get("source", "")})
    return ubm


def meta_building_type(meta: ProjectMeta) -> str:
    return "villa" if (getattr(meta, "building_type", "") == "villa") else "apartment"


def _avg_conf(result) -> float:
    ds = result.get("detections", [])
    vals = [d.get("confidence", 0.5) for d in ds] or [0.7]
    return sum(vals) / len(vals)


@register
class PlanExtractor(Extractor):
    name = "plan"
    formats = ("raster", "vector-pdf", "svg", "dxf", "dwg")

    def extract(self, path: str) -> Dict[str, Any]:
        return analysis.analyse(path)

    def validate(self, raw: Dict[str, Any]) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        if not raw.get("rooms"):
            issues.append(ValidationIssue(level="blocking", code="no_rooms", message="No rooms detected."))
        if len(raw.get("walls", [])) < 4:
            issues.append(ValidationIssue(level="warning", code="few_walls", message="Very few walls detected."))
        if str(raw.get("source", "")).startswith("demo"):
            issues.append(ValidationIssue(level="warning", code="template_used",
                                          message="Low detection confidence — a template layout was used; verify carefully."))
        return issues

    def convert_to_ubm(self, raw: Dict[str, Any], meta: ProjectMeta) -> UniversalBuildingModel:
        src = "raster"
        return analysis_to_ubm(raw, meta, source_format=src, extractor=self.name)
