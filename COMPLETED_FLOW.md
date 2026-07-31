# AI Virtual Building Tour — Completed Flow

**What it does:** Upload a 2D floor plan → AI reads it → you verify it → the app builds an
empty 3D building → walk through it in the browser (with doorways, floor arrows, and a 2D
minimap) → optionally render an MP4.

Runs **free and locally** on macOS. Apartments & villas. No furniture (by design).
Theme: fixed **soft-studio light**.

- Start: `cd virtual-building-tour && ./run.sh` → open <http://localhost:8000>
- Demo login: `demo@vbt.local` / `demo1234`
- Extra logins (all `demo1234`): `designer@vbt.local` (designer), `viewer@vbt.local` (read-only)

---

## End-to-end flow

```
Register → Login → Create Project → Building/Floors/Rooms → Upload plan
   → AI Analysis → 2D Verify & Approve → Generate 3D → Build Tour
   → 3D Viewer (Walk / Guided / Top-2D) → Render MP4
```

Each step below lists the **screen/action**, the **API call**, the **project status** it moves
to, and what it **produces**.

### 1. Register & verify
- **Screen:** Sign in → Create account (full name, company, email, password).
- **API:** `POST /api/auth/register` → returns a verify token → `POST /api/auth/verify`.
- In local mode the token is shown and auto-verified. Email verification is required before AI
  processing (a real product would email the link).
- **Produces:** a user + an organisation. The first user of a workspace is its `company_admin`.

### 2. Login
- **API:** `POST /api/auth/login` → returns a bearer token (stored in the browser).
- Roles: `super_admin`, `company_admin`, `designer`, `viewer`. Viewers are read-only.

### 3. Create project
- **Screen:** Dashboard → "Create a virtual building" (name, type, location, builder).
- **API:** `POST /api/projects`.
- **Status:** `draft`.

### 4. Building, floors & rooms (dynamic forms)
- **Screen:** Project wizard → Building details → Save building → + Add floor.
- **API:** `PUT /api/projects/{id}/building`, `POST .../floors`, `POST .../rooms`.
- Apartment vs villa show different fields; villa site features (garden, pool, compound wall)
  are stored in a flexible `features` JSON.
- **Produces:** Building + Floor(s) + Room(s). Autosaved.

### 5. Upload floor plan
- **Screen:** Upload floor plan → choose file → Upload.
- **API:** `POST /api/projects/{id}/upload` (multipart).
- Accepts **JPG / PNG / PDF** (MVP). Validates type, size; stores a SHA-256 checksum.
- **Status:** `files_uploaded`.

### 6. AI analysis
- **Screen:** AI analysis → Run AI analysis.
- **API:** `POST /api/projects/{id}/analyse` → `GET .../analysis`.
- Uses **OpenCV**: walls via Canny + Hough line detection, rooms via contours; each element
  gets a **confidence score**. If OpenCV/PDF can't be read, a labelled template layout is used
  so the flow still runs.
- Produces **warnings** (blocking vs non-blocking) for the review screen.
- **Status:** `analysing` → `needs_review`.
- **Produces:** an AnalysisJob with `{walls, rooms, doors, windows}` vectors + the model version.

### 7. 2D verify & approve
- **Screen:** 2D Verify — the plan is drawn on a canvas (walls in blue, rooms shaded);
  confirm the **scale** (metres per pixel) → **Approve 2D plan**.
- **API:** `POST /api/projects/{id}/approve-plan`.
- Blocking warnings prevent approval. Approval creates an **immutable, versioned** plan — the
  single source of truth for 3D (any later change makes a new version).
- **Status:** `approved_for_3d`.

### 8. Generate 3D building
- **Screen:** 3D · Tour · Video → Generate 3D building.
- **API:** `POST /api/projects/{id}/generate-3d`.
- Procedurally builds an **empty building** and exports a `.glb`:
  - white **walls** (with real **doorway gaps** between adjacent rooms),
  - a light-oak **floor** slab, dark **baseboards**,
  - door **frames** + **open door leaves**,
  - multiple floors stacked for apartments.
- Doorways are inferred between adjacent rooms (`infer_doors`).
- **Status:** `generating_3d` → `3d_ready`.
- **Produces:** a Model3D record + `storage/models/model_<id>.glb`.

### 9. Build tour
- **Screen:** Build tour.
- **API:** `POST /api/projects/{id}/tour`.
- Auto-route: **Approach (outside)** → each **room** (eye level, looking toward the next) →
  **Final view**. Fully re-orderable.
- **Produces:** a Tour with scenes + camera path + a shareable link token.

### 10. 3D viewer (the walkthrough)
- **Screen:** Open 3D viewer (`/viewer.html?project=<id>` or a shared `?token=<token>`).
- Loads the `.glb` with **Three.js**. See the **viewer features** below.

### 11. Render video (Phase-6 stub)
- **Screen:** choose ratio (16:9 / 9:16) → Render video.
- **API:** `POST /api/projects/{id}/render` → `GET .../renders`.
- If **FFmpeg** is installed, emits a short placeholder MP4 at the chosen size; otherwise it
  reports the engine is unavailable. Real output = a Blender camera-path render (future).
- **Status:** `rendering` → `completed`.

---

## 3D viewer features

- **Themes:** soft-studio light (neutral grey backdrop, higher contrast, PBR materials,
  soft shadows, wood floor, sky/ground).
- **Views (top-left buttons):**
  - **3D View** — orbit the dollhouse cutaway.
  - **Walk** — first-person: click to enter, **W A S D** move, mouse look, **Shift** run.
  - **Guided tour** — stand at eye level; **click the blue arrows on the floor** to glide
    room-to-room; **◀ ▶** step; **▶ Play** auto-advances.
  - **Top (2D)** — top-down floor-plan-style view (rooms + doorways from above).
  - **Auto-rotate** toggle.
- **Doorways:** real gaps in the walls with frames + open leaves — you move through them.
- **2D minimap** (bottom-right "Floor plan"): draws your actual plan and a **red marker**
  showing where you are and which way you face; **click it to jump** there.
- **Scene list** (left): click any room to go to it.
- **Share:** a public tour link opens without login.

---

## Project status lifecycle

```
draft → files_uploaded → analysing → needs_review → approved_for_3d
      → generating_3d → 3d_ready → rendering → completed
      (failed / archived as needed)
```

---

## What's real vs. a starting stub

| Area | State |
|------|-------|
| Auth, roles, email-verify gate | ✅ working |
| Projects, apartment/villa forms, floors, rooms | ✅ working |
| Upload + validation (JPG/PNG/PDF, checksum) | ✅ working |
| AI detection (OpenCV walls/rooms + confidence) | 🟡 basic but real — upgrade to YOLO/segmentation/OCR |
| 2D verify (canvas overlay, scale, approve, versioning) | 🟡 preview + approve; full drag-editor is next |
| 3D generation (walls, floor, **doorways**, baseboards, multi-floor → .glb) | 🟡 real, procedural — upgrade to Blender for fidelity |
| 3D viewer (walk, guided arrows, top-2D, minimap, share) | ✅ working |
| Video render (MP4) | 🔴 stub — placeholder via FFmpeg; real = Blender camera path |
| Admin (jobs, users, storage, audit), notifications | ✅ working |
| Data model + versioning + status lifecycle | ✅ working |

---

## Tech stack (all free)

- **Frontend:** static HTML/JS + **Three.js** (3D viewer). Soft-studio light theme.
- **Backend:** **FastAPI** (Python) — REST API, background work.
- **AI/CV:** **OpenCV** + NumPy (wall/room detection).
- **3D:** pure-python **glTF (.glb)** writer (no heavy 3D lib to start).
- **Video:** **FFmpeg** (stub); Blender for real renders later.
- **Data:** **SQLite** by default (swap `DATABASE_URL` for Postgres); local disk storage.
- **Auth:** standard-library pbkdf2 + HMAC tokens (no fragile crypto deps).

---

## API quick reference

```
POST /api/auth/register | verify | login      GET /api/auth/me
POST /api/projects        GET /api/projects    GET|DELETE /api/projects/{id}
PUT  /api/projects/{id}/building
POST /api/projects/{id}/floors | rooms | upload | analyse
GET  /api/projects/{id}/analysis
POST /api/projects/{id}/approve-plan | generate-3d
GET  /api/projects/{id}/model | tour            POST /api/projects/{id}/tour
GET  /api/tour/shared/{token}
POST /api/projects/{id}/render                  GET /api/projects/{id}/renders
GET  /api/admin/overview | users | jobs | audit
GET  /api/notifications                         POST /api/notifications/{id}/read
```

Interactive docs while running: <http://localhost:8000/docs>

---

## File map

```
virtual-building-tour/
├── run.sh                     one-command local start
├── README.md · COMPLETED_FLOW.md · BRD_COVERAGE.pdf · TESTING_GUIDE.pdf
├── sample-floorplan.png       clean test plan
├── backend/
│   ├── main.py                app + static mounts (/api, /files, /)
│   ├── config.py database.py models.py schemas.py security.py utils.py
│   ├── seed.py                demo user   ·   dummy_data.py  demo projects
│   ├── routers/               auth.py · core.py (pipeline) · admin.py
│   └── services/              analysis.py (OpenCV) · glb.py + generation3d.py (3D)
│                              tour.py (route) · render.py (FFmpeg stub)
├── frontend/                  index.html · app.js · styles.css · viewer.html
└── storage/                   uploads / models / renders
```

---

## Dummy data (for demo/testing)

`python -m backend.dummy_data` adds 5 projects across the lifecycle, including
**Sunrise Residency** (completed, 3-floor, has a rendered MP4) and **Green Meadows Villa**
(3D ready). Idempotent — safe to re-run.

---

*Disclaimer (from the BRD): generated models and tours are visual representations only —
not certified architectural, structural or legal documents.*
