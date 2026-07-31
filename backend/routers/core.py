"""Core project pipeline — dashboard, dynamic forms, upload, AI analysis, 2D
approval, 3D generation, tour, render, notifications.
Covers BRD 7.2–7.10, 8, 9, 10 and the status lifecycle (6.1)."""
import hashlib
import json
from pathlib import Path

from fastapi import (APIRouter, Depends, HTTPException, UploadFile, File,
                     Form, status)
from sqlalchemy.orm import Session

from .. import config
from ..database import get_db
from ..models import (Project, Building, Floor, Room, PlanFile, AnalysisJob,
                      ApprovedPlanVersion, Model3D, Tour, RenderJob, Notification, User)
from ..schemas import (ProjectIn, ProjectOut, BuildingIn, FloorIn, RoomIn,
                       ApprovePlanIn, TourIn, RenderIn, Msg)
from ..security import current_user
from ..services import analysis, generation3d, tour as tour_svc, render as render_svc
from ..utils import audit, notify, set_status, token_hex

router = APIRouter(prefix="/api", tags=["core"])
EDITORS = {"designer", "company_admin", "super_admin"}


# ---------- helpers ----------
def _project(db: Session, user: User, pid: int) -> Project:
    p = db.get(Project, pid)
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    if user.role != "super_admin" and p.organisation_id != user.organisation_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your project")
    return p


def _ensure_editor(user: User):
    if user.role not in EDITORS:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Viewers cannot modify projects")


def _room_hints(p: Project) -> list:
    """User-entered rooms [{name, room_type}] used to name detected rooms when OCR
    is unavailable (biggest room first, to pair with detection order)."""
    hints = []
    if p.building:
        for f in p.building.floors:
            for r in f.rooms:
                if r.name or r.room_type:
                    hints.append({"name": r.name, "room_type": r.room_type})
    return hints


def _scene_url(asset_path: str | None) -> str | None:
    """Furnishing manifest that rides alongside a model's .glb."""
    if not asset_path or not asset_path.endswith(".glb"):
        return None
    return f"/files/{asset_path[:-4]}.scene.json"


# ---------- projects (BRD 7.2) ----------
@router.post("/projects", response_model=ProjectOut)
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_editor(user)
    p = Project(organisation_id=user.organisation_id, owner_id=user.id,
                name=body.name, building_type=body.building_type, location=body.location,
                property_name=body.property_name, builder=body.builder,
                description=body.description, status="draft", unit=body.unit or "m")
    db.add(p)
    db.commit()
    audit(db, user.id, "create_project", "project", p.id)
    return p


@router.get("/projects")
def list_projects(db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = db.query(Project)
    if user.role != "super_admin":
        q = q.filter(Project.organisation_id == user.organisation_id)
    return [{"id": p.id, "name": p.name, "building_type": p.building_type,
             "location": p.location, "status": p.status,
             "created_at": p.created_at.isoformat(),
             "updated_at": p.updated_at.isoformat() if p.updated_at else None}
            for p in q.order_by(Project.updated_at.desc()).all()]


@router.get("/projects/{pid}")
def get_project(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _project(db, user, pid)
    b = p.building
    return {
        "id": p.id, "name": p.name, "building_type": p.building_type, "location": p.location,
        "property_name": p.property_name, "builder": p.builder, "status": p.status, "unit": p.unit or "m",
        "building": None if not b else {
            "id": b.id, "floor_count": b.floor_count, "floor_to_floor_m": b.floor_to_floor_m,
            "width_m": b.width_m, "length_m": b.length_m, "features": b.features,
            "floors": [{"id": f.id, "level": f.level, "name": f.name,
                        "rooms": [{"id": r.id, "name": r.name, "room_type": r.room_type}
                                  for r in f.rooms]} for f in b.floors],
        },
        "plan_files": [{"id": pf.id, "filename": pf.filename, "category": pf.plan_category,
                        "obsolete": pf.obsolete} for pf in p.plan_files],
    }


@router.delete("/projects/{pid}", response_model=Msg)
def delete_project(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    db.delete(p)
    db.commit()
    audit(db, user.id, "delete_project", "project", pid)
    return Msg(detail="Project deleted")


# ---------- dynamic building/floor/room forms (BRD 7.3–7.5, 9) ----------
@router.put("/projects/{pid}/building", response_model=Msg)
def upsert_building(pid: int, body: BuildingIn, db: Session = Depends(get_db),
                    user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    b = p.building or Building(project_id=p.id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(b, k, v)
    if not p.building:
        db.add(b)
    db.commit()
    return Msg(detail="Building details saved", data={"building_id": b.id})


@router.post("/projects/{pid}/floors", response_model=Msg)
def add_floor(pid: int, body: FloorIn, db: Session = Depends(get_db),
              user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    if not p.building:
        raise HTTPException(400, "Add building details first")
    if any(f.level == body.level for f in p.building.floors):
        raise HTTPException(409, f"Floor level {body.level} already exists")
    f = Floor(building_id=p.building.id, **body.model_dump(exclude_unset=True))
    db.add(f)
    db.commit()
    return Msg(detail="Floor added", data={"floor_id": f.id})


@router.post("/projects/{pid}/rooms", response_model=Msg)
def add_room(pid: int, body: RoomIn, db: Session = Depends(get_db),
             user: User = Depends(current_user)):
    _ensure_editor(user)
    _project(db, user, pid)
    floor = db.get(Floor, body.floor_id)
    if not floor:
        raise HTTPException(404, "Floor not found")
    data = body.model_dump(exclude_unset=True)
    if data.get("length_m") and data.get("width_m"):
        data["area_m2"] = round(data["length_m"] * data["width_m"], 2)
    r = Room(**data)
    db.add(r)
    db.commit()
    return Msg(detail="Room added", data={"room_id": r.id})


# ---------- upload (BRD 7.6) ----------
_RASTER_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}


def _validate_upload(blob: bytes, ext: str) -> None:
    """Integrity/resolution validation before storing a plan (BRD UPL-003). Raises 400
    with specific remediation guidance for empty, corrupt or too-small files."""
    if not blob:
        raise HTTPException(400, "The file is empty.")
    if ext in _RASTER_EXTS:
        try:
            import cv2
            import numpy as np
            arr = cv2.imdecode(np.frombuffer(blob, np.uint8), cv2.IMREAD_GRAYSCALE)
        except Exception:
            arr = None
        if arr is None:
            raise HTTPException(400, "The image is corrupt or unreadable — re-export it and upload again.")
        h, w = arr.shape[:2]
        if min(h, w) < 200:
            raise HTTPException(400, f"Image resolution is too low ({w}×{h}px). Upload at least 200px on the short side.")
    elif ext == ".pdf":
        try:
            import pypdfium2 as pdfium
            if len(pdfium.PdfDocument(blob)) == 0:
                raise ValueError("no pages")
        except Exception:
            raise HTTPException(400, "The PDF is corrupt, password-protected or has no pages.")


@router.post("/projects/{pid}/upload", response_model=Msg)
async def upload_plan(pid: int, file: UploadFile = File(...),
                      floor_id: int = Form(None), category: str = Form("floor_plan"),
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    ext = Path(file.filename).suffix.lower()
    if ext not in config.ALLOWED_UPLOAD_EXTS:
        raise HTTPException(400, f"Unsupported format {ext}. Allowed: {sorted(config.ALLOWED_UPLOAD_EXTS)}")
    blob = await file.read()
    if len(blob) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(400, f"File too large (max {config.MAX_UPLOAD_MB} MB)")
    _validate_upload(blob, ext)                       # reject empty/corrupt/low-res (BRD UPL-003)
    checksum = hashlib.sha256(blob).hexdigest()
    stored = config.UPLOAD_DIR / f"{pid}_{token_hex(6)}{ext}"
    stored.write_bytes(blob)
    # A new drawing replaces the previous one for the same floor/category, so
    # re-uploading marks the older versions obsolete (BRD UPL-004) instead of
    # accumulating duplicate entries in the plan set.
    (db.query(PlanFile)
       .filter(PlanFile.project_id == pid,
               PlanFile.floor_id == floor_id,
               PlanFile.plan_category == category,
               PlanFile.obsolete == False)  # noqa: E712
       .update({PlanFile.obsolete: True}, synchronize_session=False))
    pf = PlanFile(project_id=pid, floor_id=floor_id, filename=file.filename,
                  stored_path=str(stored), filetype=ext, plan_category=category,
                  checksum=checksum)
    db.add(pf)
    set_status(db, p, "files_uploaded")
    db.commit()
    audit(db, user.id, "upload_plan", "plan_file", pf.id)
    return Msg(detail="File uploaded", data={"plan_file_id": pf.id, "checksum": checksum})


# ---------- AI analysis (BRD 8) ----------
@router.post("/projects/{pid}/analyse", response_model=Msg)
def analyse_plan(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_editor(user)
    if not user.email_verified:                       # BRD AUTH-002
        raise HTTPException(403, "Verify your email before starting AI processing")
    p = _project(db, user, pid)
    pf = (db.query(PlanFile).filter(PlanFile.project_id == pid, PlanFile.obsolete == False)  # noqa: E712
          .order_by(PlanFile.id.desc()).first())
    if not pf:
        raise HTTPException(400, "Upload a floor plan first")

    set_status(db, p, "analysing")
    job = AnalysisJob(project_id=pid, plan_file_id=pf.id, status="running",
                      model_version=config.AI_MODEL_VERSION)
    db.add(job)
    db.commit()
    try:
        result = analysis.analyse(pf.stored_path, label_hints=_room_hints(p))
        job.result = result
        job.warnings = analysis.quality_warnings(result)
        job.status = "done"
        set_status(db, p, "needs_review")
    except Exception as e:
        job.status = "failed"
        set_status(db, p, "failed")
        db.commit()
        notify(db, user.id, "job_failed", f"Analysis failed: {e}", pid)
        raise HTTPException(500, f"Analysis failed: {e}")
    db.commit()

    # Rebuild the 2D-editor UBM straight from this fresh analysis so the editor always shows the
    # SAME rooms as this tab (best-effort — never let a UBM hiccup fail the analysis).
    try:
        from ..ubm.service import build_ubm_from_vectors, store_ubm
        from ..ubm.models import ProjectMeta
        apv = (db.query(ApprovedPlanVersion).filter(ApprovedPlanVersion.project_id == pid)
               .order_by(ApprovedPlanVersion.version.desc()).first())
        scale = (apv.scale_m_per_px if apv else None) or 0.02
        meta = ProjectMeta(id=p.id, name=p.name, location=p.location, builder=p.builder)
        floors = p.building.floor_count if p.building else 1
        ubm, report, svg = build_ubm_from_vectors(result, meta, scale=scale, floor_count=floors,
                                                  source_format="analysis")
        ubm.metadata.unit = p.unit or "m"
        store_ubm(pid, ubm, svg, report)
    except Exception:
        pass

    notify(db, user.id, "review_required", "AI analysis ready — please verify the plan.", pid)
    return Msg(detail="Analysis complete", data={"analysis_id": job.id,
               "warnings": job.warnings, "counts": {
                   "walls": len(result["walls"]), "rooms": len(result["rooms"])}})


@router.get("/projects/{pid}/analysis")
def get_analysis(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _project(db, user, pid)
    job = (db.query(AnalysisJob).filter(AnalysisJob.project_id == pid)
           .order_by(AnalysisJob.id.desc()).first())
    if not job:
        raise HTTPException(404, "No analysis yet")
    return {"id": job.id, "status": job.status, "result": job.result,
            "warnings": job.warnings, "model_version": job.model_version}


# ---------- 2D verification & approval (BRD 7.7 / EDT-007) ----------
@router.post("/projects/{pid}/approve-plan", response_model=Msg)
def approve_plan(pid: int, body: ApprovePlanIn, db: Session = Depends(get_db),
                 user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    # blocking warnings must be resolved before approval (BRD BR-004)
    warns = analysis.quality_warnings(body.vectors)
    blocking = [w for w in warns if w["level"] == "blocking"]
    if blocking:
        raise HTTPException(400, {"detail": "Resolve blocking warnings first", "warnings": blocking})
    last = (db.query(ApprovedPlanVersion).filter(ApprovedPlanVersion.project_id == pid)
            .order_by(ApprovedPlanVersion.version.desc()).first())
    version = (last.version + 1) if last else 1
    apv = ApprovedPlanVersion(project_id=pid, floor_id=body.floor_id, version=version,
                              vectors=body.vectors, scale_m_per_px=body.scale_m_per_px,
                              approver_id=user.id)
    db.add(apv)
    if body.unit:
        p.unit = body.unit                            # remember calibrated display unit (BLD-002)
    set_status(db, p, "approved_for_3d")
    db.commit()
    audit(db, user.id, "approve_plan", "approved_plan_version", apv.id)

    # Keep the 2D editor (UBM) in lock-step with the approved plan so it always matches the AI
    # analysis and (once generated) the 3D. Best-effort — a UBM hiccup must never block approval.
    try:
        from ..ubm.service import build_ubm_from_vectors, store_ubm
        from ..ubm.models import ProjectMeta
        meta = ProjectMeta(id=p.id, name=p.name, location=p.location, builder=p.builder)
        floors = p.building.floor_count if p.building else 1
        ubm, report, svg = build_ubm_from_vectors(body.vectors, meta,
                                                  scale=body.scale_m_per_px or 0.02, floor_count=floors)
        ubm.metadata.unit = p.unit or "m"
        store_ubm(pid, ubm, svg, report)
    except Exception:
        pass

    return Msg(detail=f"Plan approved (v{version})", data={"approved_version_id": apv.id})


# ---------- 3D generation (BRD 9) ----------
@router.post("/projects/{pid}/generate-3d", response_model=Msg)
def generate_3d(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    apv = (db.query(ApprovedPlanVersion).filter(ApprovedPlanVersion.project_id == pid)
           .order_by(ApprovedPlanVersion.version.desc()).first())
    if not apv:
        raise HTTPException(400, "Approve a 2D plan first")

    set_status(db, p, "generating_3d")
    m = Model3D(project_id=pid, source_plan_version_id=apv.id,
                engine_version=config.GEN3D_ENGINE_VERSION, status="running")
    db.add(m)
    db.commit()
    try:
        floors = p.building.floor_count if p.building else 1
        fh = p.building.floor_to_floor_m if p.building else 3.0
        rel = generation3d.generate(m.id, apv.vectors, apv.scale_m_per_px, floors, fh)
        m.asset_path = rel
        m.status = "done"
        set_status(db, p, "3d_ready")
    except Exception as e:
        m.status = "failed"
        set_status(db, p, "failed")
        db.commit()
        raise HTTPException(500, f"3D generation failed: {e}")
    db.commit()
    notify(db, user.id, "job_done", "3D model is ready to preview.", pid)
    return Msg(detail="3D model generated", data={"model_id": m.id, "asset_url": f"/files/{rel}"})


@router.get("/projects/{pid}/model")
def get_model(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _project(db, user, pid)
    # newest model whose GLB actually exists (a deleted/cleaned file must not 404 the viewer
    # when an older, still-present model is available)
    for m in (db.query(Model3D).filter(Model3D.project_id == pid).order_by(Model3D.id.desc()).limit(8).all()):
        if m.asset_path and (config.STORAGE_DIR / m.asset_path).exists():
            return {"id": m.id, "status": m.status, "engine_version": m.engine_version,
                    "asset_url": f"/files/{m.asset_path}", "scene_url": _scene_url(m.asset_path)}
    raise HTTPException(404, "No 3D model yet")


@router.get("/projects/{pid}/preview")
def project_preview(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Compact ground-floor room rectangles for the dashboard's top-down plan thumbnail."""
    _project(db, user, pid)
    empty = {"rooms": [], "bounds": None}
    # newest model whose manifest actually exists on disk (DB rows can outlive files)
    for m in (db.query(Model3D).filter(Model3D.project_id == pid).order_by(Model3D.id.desc()).limit(8).all()):
        if not m.asset_path:
            continue
        scene = config.STORAGE_DIR / m.asset_path.replace(".glb", ".scene.json")
        if not scene.exists():
            continue
        try:
            data = json.loads(scene.read_text())
        except Exception:
            continue
        rooms = [{"x": r["center"][0], "z": r["center"][1], "w": r["size"][0], "d": r["size"][1], "type": r.get("type", "room")}
                 for r in data.get("rooms", []) if r.get("level", 0) == 0]
        if rooms:
            return {"rooms": rooms, "bounds": data.get("bounds")}
    return empty


# ---------- tour (BRD 10.1 / TOUR) ----------
@router.post("/projects/{pid}/tour", response_model=Msg)
def build_tour(pid: int, body: TourIn, db: Session = Depends(get_db),
               user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    m = (db.query(Model3D).filter(Model3D.project_id == pid).order_by(Model3D.id.desc()).first())
    if not m:
        raise HTTPException(400, "Generate the 3D model first")
    apv = db.get(ApprovedPlanVersion, m.source_plan_version_id)
    route = tour_svc.auto_route(apv.vectors, apv.scale_m_per_px, body.settings or {})
    t = db.query(Tour).filter(Tour.project_id == pid).first() or Tour(project_id=pid)
    t.model_id = m.id
    t.scenes = body.scenes or route["scenes"]
    t.camera_path = route["camera_path"]
    t.settings = route["settings"]
    t.branding = body.branding or {"title": p.name}
    t.access_level = body.access_level or "private"
    t.share_token = t.share_token or token_hex()
    if not t.id:
        db.add(t)
    db.commit()
    return Msg(detail="Tour ready", data={"tour_id": t.id, "scenes": t.scenes,
               "share_token": t.share_token, "access_level": t.access_level,
               "share_url": f"/t/{t.share_token}"})


def _tour_plan(db: Session, t: Tour):
    """Approved 2D vectors + scale behind a tour, for the viewer's minimap."""
    m = db.get(Model3D, t.model_id)
    apv = db.get(ApprovedPlanVersion, m.source_plan_version_id) if m else None
    return m, (apv.vectors if apv else None), (apv.scale_m_per_px if apv else 0.02)


@router.get("/projects/{pid}/tour")
def get_tour(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _project(db, user, pid)
    t = db.query(Tour).filter(Tour.project_id == pid).first()
    if not t:
        raise HTTPException(404, "No tour yet")
    m, vectors, scale = _tour_plan(db, t)
    return {"id": t.id, "scenes": t.scenes, "camera_path": t.camera_path,
            "branding": t.branding, "share_token": t.share_token,
            "vectors": vectors, "scale": scale,
            "asset_url": f"/files/{m.asset_path}" if m else None,
            "scene_url": _scene_url(m.asset_path) if m else None}


@router.get("/tour/shared/{share_token}")
def shared_tour(share_token: str, db: Session = Depends(get_db)):
    """Public shared tour data — no auth (BRD TOUR-007). Respects access level."""
    t = db.query(Tour).filter(Tour.share_token == share_token).first()
    if not t or t.access_level == "private":
        raise HTTPException(404, "Tour not available")
    m, vectors, scale = _tour_plan(db, t)
    return {"scenes": t.scenes, "camera_path": t.camera_path, "branding": t.branding,
            "vectors": vectors, "scale": scale,
            "asset_url": f"/files/{m.asset_path}" if m else None,
            "scene_url": _scene_url(m.asset_path) if m else None}


# ---------- render (BRD 10.2 — cinematic tour video) ----------
@router.post("/projects/{pid}/render", response_model=Msg)
def render_video(pid: int, body: RenderIn, db: Session = Depends(get_db),
                 user: User = Depends(current_user)):
    _ensure_editor(user)
    p = _project(db, user, pid)
    t = db.query(Tour).filter(Tour.project_id == pid).first()
    if not t:
        raise HTTPException(400, "Set up the tour first")
    set_status(db, p, "rendering")
    rj = RenderJob(project_id=pid, tour_id=t.id, ratio=body.ratio,
                   resolution=body.resolution, status="running")
    db.add(rj)
    db.commit()
    _m, vectors, _scale = _tour_plan(db, t)
    res = render_svc.render(rj.id, body.ratio, body.resolution, title=p.name,
                            scenes=t.scenes, vectors=vectors, branding=t.branding)
    rj.status = res["status"]
    rj.output_path = res["output_path"]
    rj.progress = 100 if res["status"] == "completed" else 0
    set_status(db, p, "completed" if res["status"] == "completed" else "3d_ready")
    db.commit()
    notify(db, user.id, "job_done", f"Render {res['status']}.", pid)
    return Msg(detail=res["note"], data={
        "render_id": rj.id, "status": rj.status,
        "output_url": f"/files/{rj.output_path}" if rj.output_path else None})


@router.get("/projects/{pid}/renders")
def list_renders(pid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _project(db, user, pid)
    rows = db.query(RenderJob).filter(RenderJob.project_id == pid).order_by(RenderJob.id.desc()).all()
    return [{"id": r.id, "status": r.status, "ratio": r.ratio, "resolution": r.resolution,
             "output_url": f"/files/{r.output_path}" if r.output_path else None} for r in rows]


# ---------- notifications (BRD 7.10) ----------
@router.get("/notifications")
def notifications(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = (db.query(Notification).filter(Notification.user_id == user.id)
            .order_by(Notification.id.desc()).limit(50).all())
    return [{"id": n.id, "type": n.ntype, "message": n.message, "read": n.read,
             "project_id": n.project_id, "created_at": n.created_at.isoformat()} for n in rows]


@router.post("/notifications/{nid}/read", response_model=Msg)
def read_notification(nid: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = db.get(Notification, nid)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Not found")
    n.read = True
    db.commit()
    return Msg(detail="ok")
