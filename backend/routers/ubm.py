"""Universal Building Model API (non-breaking additions).

  POST /projects/{pid}/ubm/extract      any uploaded plan → UBM + SVG + validation
  GET  /projects/{pid}/ubm               the stored UBM JSON (single source of truth)
  GET  /projects/{pid}/ubm/svg           the clean editable SVG
  POST /projects/{pid}/ubm/validate      re-validate the stored UBM
  PUT  /projects/{pid}/ubm/element       edit one room/wall/door/window in the UBM
  POST /projects/{pid}/ubm/approve       lock the UBM as approved geometry

Stores original-derived UBM, SVG and validation report per project under storage/ubm/.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import config
from ..database import get_db
from ..models import Project, PlanFile, ApprovedPlanVersion, User
from ..security import current_user
from ..utils import audit
from ..ubm import build_ubm, build_ubm_from_vectors, UBMError
from ..ubm.models import ProjectMeta, UniversalBuildingModel
from ..ubm.validate import validate_ubm
from ..ubm.svg_gen import ubm_to_svg
from ..ubm.dxf_gen import ubm_to_dxf

router = APIRouter(prefix="/api", tags=["ubm"])

UBM_DIR = config.STORAGE_DIR / "ubm"
UBM_DIR.mkdir(parents=True, exist_ok=True)


def _project(db: Session, user: User, pid: int) -> Project:
    p = db.get(Project, pid)
    if not p or (user.role != "super_admin" and p.organisation_id != user.organisation_id):
        raise HTTPException(404, "Project not found")
    return p


def _paths(pid: int):
    return UBM_DIR / f"{pid}.ubm.json", UBM_DIR / f"{pid}.svg", UBM_DIR / f"{pid}.report.json"


def _load_ubm(pid: int) -> UniversalBuildingModel:
    up, _, _ = _paths(pid)
    if not up.exists():
        raise HTTPException(404, "No UBM yet — run extract first.")
    return UniversalBuildingModel.model_validate_json(up.read_text())


def _store(pid: int, ubm: UniversalBuildingModel, svg: str, report) -> None:
    up, sp, rp = _paths(pid)
    up.write_text(ubm.model_dump_json())
    sp.write_text(svg)
    rp.write_text(report.model_dump_json())


@router.post("/projects/{pid}/ubm/extract")
def ubm_extract(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _project(db, user, pid)
    pf = (db.query(PlanFile).filter(PlanFile.project_id == pid, PlanFile.obsolete == False)  # noqa: E712
          .order_by(PlanFile.id.desc()).first())
    if not pf or not pf.stored_path:
        raise HTTPException(400, "Upload a floor plan first.")
    apv = (db.query(ApprovedPlanVersion).filter(ApprovedPlanVersion.project_id == pid)
           .order_by(ApprovedPlanVersion.version.desc()).first())
    scale = apv.scale_m_per_px if apv else None
    floors = p.building.floor_count if p.building else 1
    meta = ProjectMeta(id=p.id, name=p.name, location=p.location, builder=p.builder)
    try:
        # Prefer the APPROVED plan as the single source of truth so the 2D editor always agrees
        # with the AI analysis and the 3D model. Fall back to a fresh detection only when nothing
        # has been approved yet.
        if apv and (apv.vectors or {}).get("rooms"):
            ubm, report, svg = build_ubm_from_vectors(apv.vectors, meta, scale=apv.scale_m_per_px or 0.02, floor_count=floors)
        else:
            ubm, report, svg = build_ubm(pf.stored_path, meta, scale=scale, floor_count=floors)
    except UBMError as e:
        raise HTTPException(422, str(e))
    ubm.metadata.unit = p.unit or "m"
    _store(pid, ubm, svg, report)
    audit(db, user.id, "ubm_extract", "project", pid)
    return {"detail": "UBM extracted", "source_format": ubm.metadata.source_format,
            "counts": {"rooms": len(ubm.rooms), "walls": len(ubm.walls), "doors": len(ubm.doors),
                       "windows": len(ubm.windows), "floors": len(ubm.floors)},
            "validation": report.model_dump(), "unit": ubm.metadata.unit,
            "scale_m_per_unit": ubm.metadata.scale_m_per_unit}


@router.get("/projects/{pid}/ubm")
def ubm_get(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _project(db, user, pid)
    return _load_ubm(pid).model_dump()


@router.get("/projects/{pid}/ubm/svg")
def ubm_svg(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _project(db, user, pid)
    _, sp, _ = _paths(pid)
    if not sp.exists():
        raise HTTPException(404, "No SVG yet — run extract first.")
    return Response(content=sp.read_text(), media_type="image/svg+xml")


def _safe_name(p: Project) -> str:
    base = "".join(c if (c.isalnum() or c in "-_ ") else "" for c in (p.name or "plan")).strip() or "plan"
    return base.replace(" ", "-").lower()


@router.get("/projects/{pid}/ubm/export.dxf")
def ubm_export_dxf(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Round-trip the editable model back out as a real layered CAD drawing (DXF)."""
    p = _project(db, user, pid)
    ubm = _load_ubm(pid)
    audit(db, user.id, "ubm_export_dxf", "project", pid)
    return Response(content=ubm_to_dxf(ubm), media_type="application/dxf",
                    headers={"Content-Disposition": f'attachment; filename="{_safe_name(p)}.dxf"'})


@router.get("/projects/{pid}/ubm/export.svg")
def ubm_export_svg(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _project(db, user, pid)
    _, sp, _ = _paths(pid)
    svg = sp.read_text() if sp.exists() else ubm_to_svg(_load_ubm(pid))
    return Response(content=svg, media_type="image/svg+xml",
                    headers={"Content-Disposition": f'attachment; filename="{_safe_name(p)}.svg"'})


@router.get("/projects/{pid}/ubm/export.json")
def ubm_export_json(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The Universal Building Model itself — one portable, standard JSON per building."""
    p = _project(db, user, pid)
    ubm = _load_ubm(pid)
    return Response(content=ubm.model_dump_json(indent=2), media_type="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{_safe_name(p)}.ubm.json"'})


@router.post("/projects/{pid}/ubm/validate")
def ubm_validate(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _project(db, user, pid)
    ubm = _load_ubm(pid)
    report = validate_ubm(ubm)
    _, _, rp = _paths(pid)
    rp.write_text(report.model_dump_json())
    return report.model_dump()


@router.put("/projects/{pid}/ubm/element")
def ubm_edit_element(pid: int, kind: str = Body(...), id: str = Body(...),
                     patch: dict = Body(...), db: Session = Depends(get_db),
                     user: User = Depends(current_user)):
    """Edit one room/wall/door/window (2D-editor writes back to the UBM)."""
    _project(db, user, pid)
    ubm = _load_ubm(pid)
    coll = {"room": ubm.rooms, "wall": ubm.walls, "door": ubm.doors, "window": ubm.windows}.get(kind)
    if coll is None:
        raise HTTPException(400, "kind must be room|wall|door|window")
    el = next((e for e in coll if e.id == id), None)
    if el is None:
        raise HTTPException(404, f"{kind} {id} not found")
    for k, v in patch.items():
        if hasattr(el, k):
            setattr(el, k, v)
    report = validate_ubm(ubm)
    _store(pid, ubm, ubm_to_svg(ubm), report)
    return {"detail": f"{kind} updated", "validation": report.model_dump()}


@router.put("/projects/{pid}/ubm")
def ubm_replace(pid: int, ubm: UniversalBuildingModel, db: Session = Depends(get_db),
                user: User = Depends(current_user)):
    """Replace the whole UBM (2D-editor bulk save for add / delete / move edits that a
    single-element patch cannot express). Recomputes the footprint bounds so they stay
    consistent with the edited geometry, re-validates, regenerates the editable SVG and
    stores everything. The UBM remains the single source of truth."""
    _project(db, user, pid)
    pts = ([p for r in ubm.rooms for p in r.polygon]
           + [w.startPoint for w in ubm.walls] + [w.endPoint for w in ubm.walls])
    if pts:
        xs = [p[0] for p in pts]
        zs = [p[1] for p in pts]
        ubm.metadata.bounds = {"minx": min(xs), "minz": min(zs), "maxx": max(xs), "maxz": max(zs)}
    report = validate_ubm(ubm)
    _store(pid, ubm, ubm_to_svg(ubm), report)
    audit(db, user.id, "ubm_edit", "project", pid)
    return {"detail": "UBM saved", "validation": report.model_dump()}


@router.post("/projects/{pid}/ubm/approve")
def ubm_approve(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _project(db, user, pid)
    ubm = _load_ubm(pid)
    report = validate_ubm(ubm)
    if report.blocking:
        raise HTTPException(400, {"detail": "Resolve blocking issues before approval",
                                  "issues": [i.model_dump() for i in report.issues if i.level == "blocking"]})
    (UBM_DIR / f"{pid}.approved.ubm.json").write_text(ubm.model_dump_json())
    audit(db, user.id, "ubm_approve", "project", pid)
    return {"detail": "UBM approved — locked as source of truth for 3D generation.",
            "counts": {"rooms": len(ubm.rooms), "walls": len(ubm.walls)}}
