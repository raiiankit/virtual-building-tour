"""Data model — covers BRD section 13 (Core Entities) and the project status
lifecycle (BRD 6.1). Versioning of plans and models is explicit: a change never
overwrites an approved version, it creates a new one (BRD BR-006, 13.2)."""
from datetime import datetime
from sqlalchemy import (Column, Integer, String, Float, Boolean, DateTime,
                        ForeignKey, JSON, Text)
from sqlalchemy.orm import relationship

from .database import Base


# ---- Project status lifecycle (BRD 6.1) ----
PROJECT_STATUSES = [
    "draft", "files_uploaded", "analysing", "needs_review", "approved_for_3d",
    "generating_3d", "3d_ready", "rendering", "completed", "failed", "archived",
]
ROLES = ["super_admin", "company_admin", "designer", "viewer"]


class Organisation(Base):
    __tablename__ = "organisations"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    plan = Column(String, default="free")
    status = Column(String, default="active")
    storage_limit_mb = Column(Integer, default=5000)
    created_at = Column(DateTime, default=datetime.utcnow)
    users = relationship("User", back_populates="organisation")
    projects = relationship("Project", back_populates="organisation")


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, ForeignKey("organisations.id"))
    full_name = Column(String, nullable=False)
    company = Column(String)
    email = Column(String, unique=True, index=True, nullable=False)
    mobile = Column(String)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="designer")           # BRD 4.1
    status = Column(String, default="active")
    email_verified = Column(Boolean, default=False)     # BRD AUTH-002
    verify_token = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    organisation = relationship("Organisation", back_populates="users")


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    organisation_id = Column(Integer, ForeignKey("organisations.id"))
    owner_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String, nullable=False)
    building_type = Column(String)                      # apartment | villa (BRD BLD-001)
    location = Column(String)
    property_name = Column(String)
    builder = Column(String)
    description = Column(Text)
    status = Column(String, default="draft")            # BRD 6.1
    unit = Column(String, default="m")                  # display unit m|mm|cm|ft|in (BRD BLD-002)
    preview_image = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    organisation = relationship("Organisation", back_populates="projects")
    building = relationship("Building", uselist=False, back_populates="project",
                            cascade="all, delete-orphan")
    plan_files = relationship("PlanFile", back_populates="project", cascade="all, delete-orphan")


class Building(Base):
    """One building per project (MVP scope). Holds apartment/villa config;
    type-specific extras live in `features` JSON (BRD 5, 6)."""
    __tablename__ = "buildings"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    width_m = Column(Float)
    length_m = Column(Float)
    total_height_m = Column(Float)
    floor_to_floor_m = Column(Float, default=3.0)
    floor_count = Column(Integer, default=1)
    basement = Column(Boolean, default=False)
    terrace = Column(Boolean, default=False)
    entrances = Column(Integer, default=1)
    wings = Column(Integer, default=1)
    parking_type = Column(String)
    parking_spaces = Column(Integer, default=0)
    features = Column(JSON, default=dict)   # villa: garden, pool, compound_wall, etc.
    project = relationship("Project", back_populates="building")
    floors = relationship("Floor", back_populates="building", cascade="all, delete-orphan")


class Floor(Base):
    __tablename__ = "floors"
    id = Column(Integer, primary_key=True)
    building_id = Column(Integer, ForeignKey("buildings.id"))
    level = Column(Integer, nullable=False)   # unique level per building (BRD 13.2)
    name = Column(String)
    height_m = Column(Float, default=3.0)
    layout_type = Column(String, default="unique")   # same_all | copy_prev | unique
    units = relationship("Unit", back_populates="floor", cascade="all, delete-orphan")
    rooms = relationship("Room", back_populates="floor", cascade="all, delete-orphan")
    building = relationship("Building", back_populates="floors")


class Unit(Base):
    """Flat / apartment unit on a floor (BRD APT-002)."""
    __tablename__ = "units"
    id = Column(Integer, primary_key=True)
    floor_id = Column(Integer, ForeignKey("floors.id"))
    identifier = Column(String)     # e.g. "A-101"
    floor = relationship("Floor", back_populates="units")


class Room(Base):
    __tablename__ = "rooms"
    id = Column(Integer, primary_key=True)
    floor_id = Column(Integer, ForeignKey("floors.id"))
    unit_id = Column(Integer, ForeignKey("units.id"), nullable=True)
    name = Column(String)
    room_type = Column(String)      # BRD supported room types
    number = Column(String)
    length_m = Column(Float)
    width_m = Column(Float)
    height_m = Column(Float, default=2.7)
    area_m2 = Column(Float)
    door_count = Column(Integer, default=1)
    window_count = Column(Integer, default=1)
    connected_rooms = Column(JSON, default=list)
    floor = relationship("Floor", back_populates="rooms")


class PlanFile(Base):
    """An uploaded drawing linked to a floor/unit/category (BRD BR-002, UPL-002)."""
    __tablename__ = "plan_files"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    floor_id = Column(Integer, ForeignKey("floors.id"), nullable=True)
    filename = Column(String)
    stored_path = Column(String)
    filetype = Column(String)
    plan_category = Column(String, default="floor_plan")  # floor_plan|elevation|section|...
    checksum = Column(String)       # dedupe + integrity (BRD 13.2)
    version = Column(Integer, default=1)
    obsolete = Column(Boolean, default=False)   # marked when replaced (BRD UPL-004)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    project = relationship("Project", back_populates="plan_files")


class AnalysisJob(Base):
    """AI floor-plan interpretation run (BRD 8). Result holds detected vectors +
    per-element confidence; warnings drive the review screen (BRD 8.2, 8.3)."""
    __tablename__ = "analysis_jobs"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    plan_file_id = Column(Integer, ForeignKey("plan_files.id"))
    status = Column(String, default="queued")   # queued|running|done|failed
    result = Column(JSON, default=dict)          # {walls, rooms, doors, windows}
    warnings = Column(JSON, default=list)
    model_version = Column(String)               # recorded per BRD 8.2
    created_at = Column(DateTime, default=datetime.utcnow)


class ApprovedPlanVersion(Base):
    """User-verified vector plan — the immutable source of truth for 3D (BRD EDT-007)."""
    __tablename__ = "approved_plan_versions"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    floor_id = Column(Integer, ForeignKey("floors.id"), nullable=True)
    version = Column(Integer, default=1)
    vectors = Column(JSON, default=dict)     # walls/rooms/doors/windows (edited)
    scale_m_per_px = Column(Float, default=0.02)   # confirmed scale (BRD EDT-004)
    approver_id = Column(Integer, ForeignKey("users.id"))
    approved_at = Column(DateTime, default=datetime.utcnow)


class Model3D(Base):
    __tablename__ = "models_3d"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    source_plan_version_id = Column(Integer, ForeignKey("approved_plan_versions.id"))
    engine_version = Column(String)
    asset_path = Column(String)         # .glb for browser preview
    status = Column(String, default="queued")
    created_at = Column(DateTime, default=datetime.utcnow)


class Tour(Base):
    __tablename__ = "tours"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    model_id = Column(Integer, ForeignKey("models_3d.id"))
    scenes = Column(JSON, default=list)      # ordered scene list (BRD TOUR-002)
    camera_path = Column(JSON, default=list)
    branding = Column(JSON, default=dict)    # logo, title, watermark, contact
    settings = Column(JSON, default=dict)    # speed, eye height, durations
    version = Column(Integer, default=1)
    share_token = Column(String)             # shareable link (BRD TOUR-007)
    access_level = Column(String, default="private")   # private|password|public (BR-013)


class RenderJob(Base):
    __tablename__ = "render_jobs"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    tour_id = Column(Integer, ForeignKey("tours.id"))
    status = Column(String, default="queued")
    progress = Column(Integer, default=0)
    ratio = Column(String, default="16:9")   # 16:9 | 9:16 (BRD TOUR-005)
    resolution = Column(String, default="1080p")
    output_path = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    ntype = Column(String)            # job_done | job_failed | review_required
    message = Column(String)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class AuditEvent(Base):
    """Login, approval, deletion, download, admin actions (BRD 16)."""
    __tablename__ = "audit_events"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String)
    object_type = Column(String)
    object_id = Column(Integer)
    result = Column(String, default="ok")
    created_at = Column(DateTime, default=datetime.utcnow)
