"""Administration & operations — BRD 12. Job visibility, users, storage, audit."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import (User, Project, PlanFile, AnalysisJob, RenderJob, AuditEvent)
from ..security import require_roles

router = APIRouter(prefix="/api/admin", tags=["admin"])
_admin = require_roles("company_admin", "super_admin")


@router.get("/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(_admin)):
    scope = None if user.role == "super_admin" else user.organisation_id

    def q(model):
        query = db.query(model)
        if scope and hasattr(model, "organisation_id"):
            query = query.filter(model.organisation_id == scope)
        return query

    projects = q(Project)
    by_status = {}
    for p in projects.all():
        by_status[p.status] = by_status.get(p.status, 0) + 1
    return {
        "projects_total": projects.count(),
        "projects_by_status": by_status,
        "analysis_jobs": db.query(AnalysisJob).count(),
        "render_jobs": db.query(RenderJob).count(),
        "uploaded_files": db.query(PlanFile).count(),
        "users": q(User).count() if scope else db.query(User).count(),
    }


@router.get("/users")
def users(db: Session = Depends(get_db), user: User = Depends(_admin)):
    q = db.query(User)
    if user.role != "super_admin":
        q = q.filter(User.organisation_id == user.organisation_id)
    return [{"id": u.id, "name": u.full_name, "email": u.email, "role": u.role,
             "verified": u.email_verified, "status": u.status} for u in q.all()]


@router.get("/jobs")
def jobs(db: Session = Depends(get_db), user: User = Depends(_admin)):
    a = [{"kind": "analysis", "id": j.id, "project_id": j.project_id, "status": j.status,
          "model_version": j.model_version} for j in
         db.query(AnalysisJob).order_by(AnalysisJob.id.desc()).limit(50).all()]
    r = [{"kind": "render", "id": j.id, "project_id": j.project_id, "status": j.status,
          "ratio": j.ratio} for j in
         db.query(RenderJob).order_by(RenderJob.id.desc()).limit(50).all()]
    return {"analysis": a, "render": r}


@router.get("/audit")
def audit_log(db: Session = Depends(get_db), user: User = Depends(_admin)):
    rows = db.query(AuditEvent).order_by(AuditEvent.id.desc()).limit(100).all()
    return [{"id": e.id, "actor_id": e.actor_id, "action": e.action,
             "object": f"{e.object_type}#{e.object_id}", "result": e.result,
             "at": e.created_at.isoformat()} for e in rows]
