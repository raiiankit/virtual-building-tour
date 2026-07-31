# AI Virtual Building Tour

Turn a **2D floor plan → verified plan → empty 3D building → interactive tour + video**.
For apartments and villas. **No furniture** (by design). Runs **free and locally** on your Mac.

This repository is a **runnable scaffold that covers every area of the BRD**. The full
pipeline works end-to-end today; the AI accuracy and video render are basic starting
points meant to be upgraded (see *Status* below).

---

## Quick start (one command)

```bash
cd virtual-building-tour
./run.sh
```

Then open **http://localhost:8000** and log in with the demo account:

```
email:    demo@vbt.local
password: demo1234
```

> `run.sh` creates a virtualenv, installs requirements, seeds the demo user, and starts the server.
> To do it manually: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && python -m backend.seed && uvicorn backend.main:app --reload`

### Try the full flow
1. **Create project** (apartment or villa).
2. **Building details** → save, add a floor.
3. **Upload** a floor-plan image (JPG/PNG). No image handy? Just run analysis — it falls back to a template layout.
4. **Run AI analysis** → walls/rooms are detected with confidence scores.
5. **2D Verify** → confirm the scale, then **Approve** (locks the plan).
6. **Generate 3D building** → produces a `.glb`.
7. **Build tour** → auto walkthrough route.
8. **Open 3D viewer** → walk the empty building in the browser; press *Play walkthrough*.
9. **Render video** → MP4 if FFmpeg is installed (otherwise skipped with a message).

---

## Architecture

```
frontend/            static SPA (vanilla JS) + Three.js viewer
  index.html app.js styles.css      dashboard + wizard
  viewer.html                       WebGL 3D tour (Three.js via CDN)
backend/             FastAPI + SQLAlchemy (SQLite by default)
  main.py            app, serves /api, /files, and the frontend
  models.py          all BRD entities + status lifecycle
  security.py        stdlib auth (pbkdf2 + HMAC tokens), roles
  routers/           auth.py · core.py (pipeline) · admin.py
  services/          analysis.py (OpenCV) · glb.py + generation3d.py (3D)
                     tour.py (route) · render.py (FFmpeg stub)
storage/             uploads / models / renders  (local disk)
```

No external services required to start: **SQLite + local disk + stdlib crypto**.
`docker-compose.yml` (Postgres + Redis) is optional, for later phases.

---

## Status — what's real vs. a starting stub

| Area | State |
|------|-------|
| Auth, roles, email-verify gate | ✅ working (stdlib tokens) |
| Projects, dynamic apartment/villa forms, floors, rooms | ✅ working |
| Upload + validation (JPG/PNG/PDF, size, checksum) | ✅ working |
| AI detection (walls via Hough, rooms via contours, confidence) | 🟡 **basic but real** — upgrade to YOLO/segmentation/OCR |
| 2D verify (canvas overlay, scale, approve, versioning, warnings) | 🟡 preview + approve; **full drag-editor is Phase 3** |
| 3D generation (empty walls/floor/openings → `.glb`, multi-floor) | 🟡 **real, procedural** — upgrade to Blender for fidelity |
| Interactive web tour (Three.js, orbit/walk, auto route, share link) | ✅ working |
| Video render (MP4) | 🔴 **stub** — placeholder clip via FFmpeg; real render = Blender camera path (Phase 6) |
| Admin (jobs, users, storage, audit) | ✅ working (JSON endpoints) |
| Notifications, audit trail, status lifecycle | ✅ working |

See `BRD_COVERAGE.pdf` for a point-by-point map of the BRD to this code.

---

## Upgrade path (matches the build plan)
- **Phase 2 – smarter AI:** replace `services/analysis.py` internals with a trained
  YOLO door/window detector + wall segmentation + Tesseract OCR for labels/dimensions.
- **Phase 3 – full 2D editor:** add drag/add/delete of walls, doors, windows on the canvas.
- **Phase 4 – Blender 3D:** swap `services/glb.py` for the Blender Python API for clean
  boolean openings, stairs, railings and better materials.
- **Phase 6 – real video:** render the camera path in Blender, compose with FFmpeg,
  move rendering to a background worker (Celery + Redis).
- **Ops:** move to Postgres (`DATABASE_URL`), object storage (MinIO/S3), and add tests.

---

## API (quick reference)
`POST /api/auth/register|verify|login` · `GET /api/auth/me`
`POST /api/projects` · `GET /api/projects` · `GET/DELETE /api/projects/{id}`
`PUT /api/projects/{id}/building` · `POST .../floors` · `POST .../rooms`
`POST .../upload` · `POST .../analyse` · `GET .../analysis`
`POST .../approve-plan` · `POST .../generate-3d` · `GET .../model`
`POST .../tour` · `GET .../tour` · `GET /api/tour/shared/{token}`
`POST .../render` · `GET .../renders`
`GET /api/admin/overview|users|jobs|audit`
Interactive API docs while running: **http://localhost:8000/docs**

---

*Disclaimer (from the BRD): the generated model and tour are visual representations only —
not certified architectural, structural or legal documents.*
