"""Populate the database with realistic dummy data for testing/demo.

Run:  python -m backend.dummy_data     (or ./run.sh restarts already seed the demo user)

Creates, under the demo workspace:
  * extra users (designer + viewer) for role testing
  * several projects spread across the status lifecycle
  * fully-built projects with generated .glb models + tours you can open now
Idempotent: running again does nothing if the data already exists."""
import math

from .database import SessionLocal, init_db
from .models import (Organisation, User, Project, Building, Floor, Room, PlanFile,
                     AnalysisJob, ApprovedPlanVersion, Model3D, Tour, RenderJob,
                     Notification, AuditEvent)
from .security import hash_password
from .services import generation3d, tour as tour_svc, render as render_svc
from .utils import token_hex
from . import config

MARKER = "Sunrise Residency"      # if this project exists, we've already seeded
SCALE = 0.02


# ---------- helpers ----------
def layout_from_rooms(names, W=1000, H=750):
    """Arrange rooms in a 2-column grid and return a vector plan
    (walls + room boxes + a few doors/windows) like the AI would output."""
    cols = 2
    rows = math.ceil(len(names) / cols)
    m = 40
    cw = (W - 2 * m) / cols
    ch = (H - 2 * m) / rows
    walls = [
        {"x1": m, "y1": m, "x2": W - m, "y2": m, "confidence": 0.9},
        {"x1": W - m, "y1": m, "x2": W - m, "y2": H - m, "confidence": 0.9},
        {"x1": W - m, "y1": H - m, "x2": m, "y2": H - m, "confidence": 0.9},
        {"x1": m, "y1": H - m, "x2": m, "y2": m, "confidence": 0.9},
        {"x1": m + cw, "y1": m, "x2": m + cw, "y2": H - m, "confidence": 0.8},  # column divider
    ]
    for r in range(1, rows):
        y = m + r * ch
        walls.append({"x1": m, "y1": y, "x2": W - m, "y2": y, "confidence": 0.8})

    rooms, doors, windows = [], [], []
    type_map = {"living": "living_room", "bed": "bedroom", "kitchen": "kitchen",
                "bath": "bathroom", "dining": "dining_room"}
    for i, name in enumerate(names):
        r, c = divmod(i, cols)
        x, y = m + c * cw, m + r * ch
        rtype = next((v for k, v in type_map.items() if k in name.lower()), "room")
        rooms.append({"x": round(x + 8), "y": round(y + 8), "w": round(cw - 16),
                      "h": round(ch - 16), "name": name, "type": rtype, "confidence": 0.7})
        doors.append({"x": round(x + cw / 2), "y": round(y + 8), "confidence": 0.6})
        windows.append({"x": round(x + 8), "y": round(y + ch / 2), "confidence": 0.6})
    return {"image_size": [W, H], "walls": walls, "rooms": rooms,
            "doors": doors, "windows": windows, "source": "dummy-data"}


def build_project(db, org, owner, spec):
    p = Project(organisation_id=org.id, owner_id=owner.id, name=spec["name"],
                building_type=spec["type"], location=spec["location"],
                property_name=spec.get("property"), builder=spec.get("builder"),
                status=spec["stage"])
    db.add(p)
    db.flush()

    b = Building(project_id=p.id, floor_count=spec["floors"], floor_to_floor_m=3.0,
                 width_m=spec.get("w", 18.0), length_m=spec.get("l", 14.0),
                 features=spec.get("features", {}))
    db.add(b)
    db.flush()

    floor_ids = []
    for lvl in range(spec["floors"]):
        f = Floor(building_id=b.id, level=lvl, name=f"Floor {lvl}", height_m=3.0)
        db.add(f)
        db.flush()
        floor_ids.append(f.id)
        for name in spec["rooms"]:
            db.add(Room(floor_id=f.id, name=name, room_type="room",
                        length_m=4.0, width_m=3.5, height_m=2.7, area_m2=14.0))
    db.flush()

    vectors = layout_from_rooms(spec["rooms"])
    reached = spec["stage"]

    # needs_review and beyond -> a plan file + a completed analysis
    if reached in ("needs_review", "approved_for_3d", "3d_ready", "completed"):
        sample = config.STORAGE_DIR.parent / "sample-floorplan.png"
        db.add(PlanFile(project_id=p.id, floor_id=floor_ids[0], filename="floorplan.png",
                        stored_path=str(sample), filetype=".png",
                        plan_category="floor_plan", checksum=token_hex()))
        db.add(AnalysisJob(project_id=p.id, plan_file_id=None, status="done",
                           result=vectors, warnings=[], model_version=config.AI_MODEL_VERSION))
        db.flush()

    # approved and beyond -> an approved plan version
    apv = None
    if reached in ("approved_for_3d", "3d_ready", "completed"):
        apv = ApprovedPlanVersion(project_id=p.id, floor_id=floor_ids[0], version=1,
                                  vectors=vectors, scale_m_per_px=SCALE, approver_id=owner.id)
        db.add(apv)
        db.flush()

    # 3d_ready and beyond -> a generated .glb model
    model = None
    if reached in ("3d_ready", "completed"):
        model = Model3D(project_id=p.id, source_plan_version_id=apv.id,
                        engine_version=config.GEN3D_ENGINE_VERSION, status="running")
        db.add(model)
        db.flush()
        rel = generation3d.generate(model.id, vectors, SCALE, spec["floors"], 3.0)
        model.asset_path = rel
        model.status = "done"
        db.flush()

    # completed -> a tour + a finished render
    if reached == "completed":
        route = tour_svc.auto_route(vectors, SCALE, {})
        t = Tour(project_id=p.id, model_id=model.id, scenes=route["scenes"],
                 camera_path=route["camera_path"], settings=route["settings"],
                 branding={"title": p.name}, access_level="public", share_token=token_hex())
        db.add(t)
        db.flush()
        rj = RenderJob(project_id=p.id, tour_id=t.id, ratio="16:9", resolution="1080p",
                       status="queued")
        db.add(rj)
        db.flush()
        res = render_svc.render(rj.id, "16:9", "1080p", title=p.name)
        rj.status = res["status"]
        rj.output_path = res["output_path"]
        rj.progress = 100 if res["status"] == "completed" else 0

    # a couple of notifications + audit rows so those screens have content
    db.add(Notification(user_id=owner.id, project_id=p.id, ntype="job_done",
                        message=f"{p.name}: {reached.replace('_', ' ')}."))
    db.add(AuditEvent(actor_id=owner.id, action="create_project",
                      object_type="project", object_id=p.id))
    db.commit()
    return p


PROJECTS = [
    {"name": "Sunrise Residency", "type": "apartment", "location": "Ahmedabad",
     "builder": "Sunrise Group", "floors": 3, "stage": "completed",
     "rooms": ["Living Room", "Kitchen", "Master Bedroom", "Bedroom 2", "Bathroom", "Balcony"]},
    {"name": "Green Meadows Villa", "type": "villa", "location": "Gandhinagar",
     "builder": "Meadow Homes", "floors": 2, "stage": "3d_ready",
     "features": {"garden": True, "pool": True, "compound_wall": True},
     "rooms": ["Living Room", "Dining Room", "Kitchen", "Master Bedroom", "Guest Room", "Bathroom"]},
    {"name": "Metro Heights", "type": "apartment", "location": "Surat",
     "builder": "Metro Builders", "floors": 5, "stage": "needs_review",
     "rooms": ["Living Room", "Kitchen", "Bedroom", "Bathroom"]},
    {"name": "Lakeview Bungalow", "type": "villa", "location": "Vadodara",
     "builder": "Lakeview Estates", "floors": 2, "stage": "draft",
     "features": {"garden": True, "backyard": True},
     "rooms": ["Living Room", "Kitchen", "Master Bedroom", "Study Room", "Bathroom"]},
    {"name": "City Center Flats", "type": "apartment", "location": "Rajkot",
     "builder": "Center Realty", "floors": 4, "stage": "files_uploaded",
     "rooms": ["Living Room", "Kitchen", "Bedroom", "Bathroom"]},
]


def run():
    init_db()
    db = SessionLocal()
    try:
        org = db.query(Organisation).filter(Organisation.name == "Demo Studio").first()
        if not org:
            org = Organisation(name="Demo Studio")
            db.add(org)
            db.flush()
        owner = db.query(User).filter(User.email == "demo@vbt.local").first()
        if not owner:
            owner = User(organisation_id=org.id, full_name="Demo Designer", company="Demo Studio",
                         email="demo@vbt.local", password_hash=hash_password("demo1234"),
                         role="company_admin", email_verified=True)
            db.add(owner)
            db.commit()

        # extra users for role testing
        for email, name, role in [("designer@vbt.local", "Priya Designer", "designer"),
                                  ("viewer@vbt.local", "Ravi Viewer", "viewer")]:
            if not db.query(User).filter(User.email == email).first():
                db.add(User(organisation_id=org.id, full_name=name, company="Demo Studio",
                            email=email, password_hash=hash_password("demo1234"),
                            role=role, email_verified=True))
        db.commit()

        if db.query(Project).filter(Project.name == MARKER).first():
            print("Dummy data already present — nothing to do.")
            return

        for spec in PROJECTS:
            p = build_project(db, org, owner, spec)
            print(f"  + {p.name:22} [{p.status}]")

        print("\nDone. Log in as demo@vbt.local / demo1234 and refresh the dashboard.")
        print("Extra logins (all demo1234): designer@vbt.local, viewer@vbt.local")
    finally:
        db.close()


if __name__ == "__main__":
    run()
