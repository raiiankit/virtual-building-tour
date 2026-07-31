"""Application configuration. Everything defaults to a zero-config local setup
(SQLite + local disk storage) so the app runs with no external services.
Swap DATABASE_URL to Postgres and STORAGE_DIR to S3/MinIO in production."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Core ---
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me-in-production")
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("ACCESS_TOKEN_EXPIRE_HOURS", "72"))

# --- Database (default: local SQLite, zero setup) ---
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'app.db'}")

# --- File storage (default: local folder) ---
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", str(BASE_DIR / "storage")))
UPLOAD_DIR = STORAGE_DIR / "uploads"
MODEL_DIR = STORAGE_DIR / "models"
RENDER_DIR = STORAGE_DIR / "renders"
for _d in (UPLOAD_DIR, MODEL_DIR, RENDER_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- Upload limits (BRD UPL-003) ---
ALLOWED_UPLOAD_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff",
                       ".pdf", ".svg", ".dxf", ".dwg"}  # raster + vector plan formats
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "25"))

# --- Engine versions recorded on outputs (BRD 8.2 / 13.1) ---
AI_MODEL_VERSION = "floorplan-cv-0.2-semantic"
GEN3D_ENGINE_VERSION = "procedural-glb-0.3-furnished"
SCENE_MANIFEST_VERSION = "1.0"     # furnishing/interior manifest (theme-swappable)

# Empty building by design (BRD): generate the architectural shell + fixtures
# (floors, walls, doors, windows, ceilings, lighting) but no loose furniture.
INCLUDE_FURNITURE = False

# --- Default visual theme (BRD 9.2) ---
DEFAULT_THEME = {
    "wall": [0.92, 0.92, 0.90],       # white painted plaster
    "floor": [0.80, 0.77, 0.71],      # light ceramic tile
    "door": [0.40, 0.26, 0.13],       # brown wooden door
    "window": [0.60, 0.80, 0.90],     # transparent-ish glass
    "wall_height_m": 2.7,
    "wall_thickness_m": 0.12,
}

# --- Architectural room catalog ------------------------------------------------
# The semantic core: canonical room types the AI understands like an architect.
# Each entry drives naming, the per-room floor material, and which furniture pack
# is placed in 3D. Keywords are matched (longest-first) against OCR text / the
# room label / user-entered room names. Order matters: earlier = higher priority.
ROOM_CATALOG = {
    "master_bedroom": {
        "display": "Master Bedroom", "floor": "wood",
        "keywords": ["master bedroom", "master bed", "master", "mbr", "primary bedroom"]},
    "bedroom": {
        "display": "Bedroom", "floor": "wood",
        "keywords": ["bedroom", "bed room", "guest room", "kids room", "br", "bed"]},
    "bathroom": {
        "display": "Bathroom", "floor": "antiskid",
        "keywords": ["master bath", "bathroom", "toilet", "washroom",
                     "bath", "wc", "w.c", "restroom", "ensuite", "en-suite"]},
    "powder": {
        "display": "Powder Room", "floor": "antiskid",
        "keywords": ["powder room", "powder", "pwdr", "pwd", "half bath"]},
    "kitchen": {
        "display": "Kitchen", "floor": "marble",
        "keywords": ["kitchen", "kitchenette", "cook"]},
    "pantry": {
        "display": "Pantry", "floor": "marble",
        "keywords": ["pantry"]},
    "dining": {
        "display": "Dining", "floor": "tile",
        "keywords": ["dining", "dinning", "breakfast", "brkfst"]},
    "living_room": {
        "display": "Living Room", "floor": "tile",
        "keywords": ["living room", "living", "family room", "family", "lounge",
                     "drawing", "great room"]},
    "utility": {
        "display": "Utility", "floor": "tile",
        "keywords": ["utility", "laundry", "wash area", "service"]},
    "store": {
        "display": "Store", "floor": "tile",
        "keywords": ["store room", "store", "storage"]},
    "closet": {
        "display": "Closet", "floor": "wood",
        "keywords": ["walk-in closet", "walk in closet", "wic", "closet", "wardrobe", "dressing"]},
    "garage": {
        "display": "Garage", "floor": "concrete",
        "keywords": ["tandem garage", "garage", "parking", "car park", "carport", "tandem"]},
    "balcony": {
        "display": "Balcony", "floor": "outdoor",
        "keywords": ["balcony", "terrace", "deck", "veranda", "verandah", "sit out",
                     "sit-out"]},
    "foyer": {
        "display": "Foyer", "floor": "tile",
        "keywords": ["foyer", "entry", "entrance", "vestibule", "lobby"]},
    "porch": {
        "display": "Porch", "floor": "outdoor",
        "keywords": ["porch", "portico"]},
    "hall": {
        "display": "Hall", "floor": "tile",
        "keywords": ["hallway", "hall way", "hall"]},
    "corridor": {
        "display": "Corridor", "floor": "tile",
        "keywords": ["corridor", "passage", "circulation"]},
    "staircase": {
        "display": "Staircase", "floor": "tile",
        "keywords": ["staircase", "stair", "steps", "stairwell"]},
    "lift": {
        "display": "Lift", "floor": "tile",
        "keywords": ["lift", "elevator"]},
    "office": {
        "display": "Study", "floor": "wood",
        "keywords": ["study", "office", "work room", "home office", "library"]},
    "room": {   # generic fallback — kept last on purpose
        "display": "Room", "floor": "tile", "keywords": []},
}

# Per-room floor materials (BRD 9.2). The viewer resolves these tags to PBR
# materials, so swapping a theme never touches the data model (BRD "future ready").
FLOOR_MATERIALS = {
    "wood":     {"label": "Wood flooring",     "color": [0.66, 0.47, 0.28]},
    "tile":     {"label": "Ceramic tile",      "color": [0.82, 0.80, 0.76]},
    "marble":   {"label": "Marble tile",       "color": [0.90, 0.89, 0.86]},
    "antiskid": {"label": "Anti-skid tile",    "color": [0.70, 0.73, 0.74]},
    "concrete": {"label": "Concrete floor",    "color": [0.55, 0.55, 0.56]},
    "outdoor":  {"label": "Outdoor decking",   "color": [0.52, 0.45, 0.38]},
}


def room_display_name(room_type: str) -> str:
    return ROOM_CATALOG.get(room_type, ROOM_CATALOG["room"])["display"]


def room_floor_material(room_type: str) -> str:
    return ROOM_CATALOG.get(room_type, ROOM_CATALOG["room"])["floor"]
