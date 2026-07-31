"""Small shared helpers: audit trail, notifications, project status changes."""
import secrets
from sqlalchemy.orm import Session

from .models import AuditEvent, Notification, Project


def audit(db: Session, actor_id, action: str, object_type: str, object_id, result="ok"):
    db.add(AuditEvent(actor_id=actor_id, action=action, object_type=object_type,
                      object_id=object_id, result=result))
    db.commit()


def notify(db: Session, user_id, ntype: str, message: str, project_id=None):
    db.add(Notification(user_id=user_id, ntype=ntype, message=message, project_id=project_id))
    db.commit()


def set_status(db: Session, project: Project, status: str):
    project.status = status
    db.commit()


def token_hex(n=16) -> str:
    return secrets.token_hex(n)
