"""UBM orchestration:  file → detect → extract → validate → convert → enrich → validate
→ clean SVG.  This is the single entry point the API and pipeline call."""
from __future__ import annotations

import math
import os
import shutil
import subprocess
import tempfile
from typing import Optional, Tuple

from .. import config
from .detect import detect_format
from .base import for_format, registry
from .models import UniversalBuildingModel, ValidationReport, ProjectMeta
from .validate import validate_ubm, _dist_seg, _centroid
from .svg_gen import ubm_to_svg
from .rooms import rectilinearize_rooms
from . import extractors  # noqa: F401  (registers PlanExtractor + IfcExtractor)


class UBMError(Exception):
    pass


UBM_DIR = config.STORAGE_DIR / "ubm"


def ubm_paths(pid: int):
    return UBM_DIR / f"{pid}.ubm.json", UBM_DIR / f"{pid}.svg", UBM_DIR / f"{pid}.report.json"


def store_ubm(pid: int, ubm: UniversalBuildingModel, svg: str, report: ValidationReport) -> None:
    """Persist the UBM, its editable SVG and validation report for a project."""
    UBM_DIR.mkdir(parents=True, exist_ok=True)
    up, sp, rp = ubm_paths(pid)
    up.write_text(ubm.model_dump_json())
    sp.write_text(svg)
    rp.write_text(report.model_dump_json())


def _rvt_to_ifc(path: str) -> Optional[str]:
    """Best-effort RVT→IFC. Needs an external exporter on PATH (Revit / ODA / forge).
    Returns an .ifc path or None (the API then reports it clearly, never a fake model)."""
    for exe in ("rvt2ifc", "RevitIFCExporter"):
        tool = shutil.which(exe)
        if tool:
            out = os.path.join(tempfile.mkdtemp(), os.path.splitext(os.path.basename(path))[0] + ".ifc")
            try:
                subprocess.run([tool, path, out], check=True, stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL, timeout=180)
                if os.path.exists(out):
                    return out
            except Exception:
                return None
    return None


def _project_onto_seg(p, a, b):
    """Foot of the perpendicular from p onto segment [a, b], clamped to the segment.
    Snaps a detected opening exactly onto its host wall centreline."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    if L == 0:
        return [ax, ay]
    t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
    return [ax + t * dx, ay + t * dy]


def enrich_connectivity(ubm: UniversalBuildingModel) -> None:
    """Link doors/windows to their wall and the rooms they connect (populates
    room.doors / room.windows / room.connectedRooms and door.wallId), and SNAP every
    opening onto its host wall so it never floats mid-room (clears 'not on a wall')."""
    cents = [(r, _centroid(r.polygon)) for r in ubm.rooms]

    def nearest_wall(p):
        best, bd = None, 1e9
        for w in ubm.walls:
            d = _dist_seg(p, w.startPoint, w.endPoint)
            if d < bd:
                bd, best = d, w
        return best

    def nearest_rooms(p, k=2):
        return [r for r, _ in sorted(cents, key=lambda rc: math.hypot(rc[1][0] - p[0], rc[1][1] - p[1]))[:k]]

    for d in ubm.doors:
        w = nearest_wall(d.position)
        if w:
            d.wallId = w.id
            d.position = _project_onto_seg(d.position, w.startPoint, w.endPoint)
            d.rotation = math.atan2(w.endPoint[1] - w.startPoint[1], w.endPoint[0] - w.startPoint[0])
        rs = nearest_rooms(d.position, 2)
        for r in rs:
            if d.id not in r.doors:
                r.doors.append(d.id)
        if len(rs) == 2:
            a, b = rs
            if b.id not in a.connectedRooms:
                a.connectedRooms.append(b.id)
            if a.id not in b.connectedRooms:
                b.connectedRooms.append(a.id)

    for wd in ubm.windows:
        w = nearest_wall(wd.position)
        if w:
            wd.wallId = w.id
            wd.position = _project_onto_seg(wd.position, w.startPoint, w.endPoint)
        rs = nearest_rooms(wd.position, 1)
        if rs and wd.id not in rs[0].windows:
            rs[0].windows.append(wd.id)


def build_ubm_from_vectors(result: dict, meta: ProjectMeta, *, scale: float,
                           floor_count: int = 1,
                           source_format: str = "approved") -> Tuple[UniversalBuildingModel, ValidationReport, str]:
    """Build the UBM from an already-computed analysis result (the APPROVED plan vectors)
    instead of re-detecting the plan. This keeps the 2D editor consistent with the AI analysis
    and the 3D model — all three then share ONE source of truth (the approved plan), so the
    editor can never disagree with the analysis on how many rooms exist."""
    from .extractors.plan import analysis_to_ubm
    ubm = analysis_to_ubm(result, meta, scale=scale or 0.02, source_format=source_format,
                          extractor="approved-plan", floor_count=floor_count)
    rectilinearize_rooms(ubm)
    enrich_connectivity(ubm)
    report = validate_ubm(ubm)
    return ubm, report, ubm_to_svg(ubm)


def build_ubm(path: str, meta: ProjectMeta, *, scale: Optional[float] = None,
              floor_count: int = 1) -> Tuple[UniversalBuildingModel, ValidationReport, str]:
    """Convert any supported file into (UBM, validation report, editable SVG)."""
    fmt = detect_format(path)
    if fmt == "rvt":
        ifc = _rvt_to_ifc(path)
        if not ifc:
            raise UBMError("RVT needs an external RVT→IFC export (Revit/ODA/Forge). "
                           "Export the model to IFC and upload that.")
        path, fmt = ifc, "ifc"
    if fmt == "unknown":
        raise UBMError(f"Unsupported file type for {os.path.basename(path)}.")
    ex = for_format(fmt)
    if ex is None:
        raise UBMError(f"No extractor registered for '{fmt}'. Available: {sorted(registry())}")

    raw = ex.extract(path)
    pre_issues = ex.validate(raw)
    ubm = ex.convert_to_ubm(raw, meta)
    if scale and fmt in ("raster", "vector-pdf", "svg", "dxf", "dwg"):
        # re-scale a pixel-space model to the calibrated metres-per-pixel
        _rescale(ubm, scale)
    ubm.metadata.source_file = os.path.basename(path)
    ubm.metadata.source_format = fmt

    if fmt in ("raster", "vector-pdf", "svg"):
        # clean up jagged/overlapping segmentation blobs into crisp non-overlapping rooms
        # (CAD/BIM sources are already clean, so leave them untouched)
        rectilinearize_rooms(ubm)
    enrich_connectivity(ubm)
    report = validate_ubm(ubm)
    report.issues = pre_issues + report.issues
    report.blocking += sum(1 for i in pre_issues if i.level == "blocking")
    report.warnings += sum(1 for i in pre_issues if i.level == "warning")
    report.ok = report.blocking == 0
    svg = ubm_to_svg(ubm)
    return ubm, report, svg


def _rescale(ubm: UniversalBuildingModel, new_scale: float) -> None:
    """Model geometry came out at the default m/px; rescale to the calibrated value."""
    old = ubm.metadata.scale_m_per_unit or 0.02
    if not old or abs(new_scale - old) < 1e-9:
        return
    k = new_scale / old
    for r in ubm.rooms:
        r.polygon = [[p[0] * k, p[1] * k] for p in r.polygon]
        r.area_m2 = round(r.area_m2 * k * k, 2)
    for w in ubm.walls:
        w.startPoint = [w.startPoint[0] * k, w.startPoint[1] * k]
        w.endPoint = [w.endPoint[0] * k, w.endPoint[1] * k]
        w.length_m = round(w.length_m * k, 3)
    for d in ubm.doors:
        d.position = [d.position[0] * k, d.position[1] * k]
    for wd in ubm.windows:
        wd.position = [wd.position[0] * k, wd.position[1] * k]
        wd.width_m = round(wd.width_m * k, 2)
    if ubm.metadata.bounds:
        ubm.metadata.bounds = {kk: v * k for kk, v in ubm.metadata.bounds.items()}
    ubm.metadata.scale_m_per_unit = new_scale
