"""FastAPI entrypoint. Serves the JSON API under /api, uploaded/generated assets
under /files, and the static frontend at /. Run: uvicorn backend.main:app --reload"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import config
from .database import init_db
from .routers import auth, core, admin, ubm


import logging
import os

log = logging.getLogger("vbt")
_ENV = os.getenv("ENV", "development")
_DEFAULT_SECRET = "dev-only-change-me-in-production"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # fail-fast in production on an unset JWT secret; warn loudly in development
    if config.SECRET_KEY == _DEFAULT_SECRET:
        if _ENV == "production":
            raise RuntimeError("SECRET_KEY is the insecure default — set a strong SECRET_KEY env var for production.")
        log.warning("SECRET_KEY is the insecure default — set SECRET_KEY before deploying to production.")
    init_db()          # create tables on startup (idempotent)
    yield


app = FastAPI(title="AI Virtual Building Tour", version="0.1",
              description="2D floor plan -> verified plan -> empty 3D building -> tour + video",
              lifespan=lifespan)

# CORS: same-origin in practice (the Next app proxies /api), so default to the frontend
# origin(s) from env; wide-open only in development.
_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "*" if _ENV != "production" else "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins or ["*"], allow_methods=["*"],
                   allow_headers=["*"])


@app.middleware("http")
async def no_cache_frontend(request: Request, call_next):
    """Always serve fresh frontend (index/app.js/viewer.html/styles.css) so UI
    updates reach the browser immediately; assets under /files keep normal caching."""
    resp = await call_next(request)
    p = request.url.path
    if not p.startswith("/files") and not p.startswith("/api"):
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
    return resp


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "virtual-building-tour",
            "ai_model": config.AI_MODEL_VERSION, "gen3d": config.GEN3D_ENGINE_VERSION}


app.include_router(auth.router)
app.include_router(core.router)
app.include_router(admin.router)
app.include_router(ubm.router)

# generated/uploaded assets (glb, mp4, images)
app.mount("/files", StaticFiles(directory=str(config.STORAGE_DIR)), name="files")
# optional legacy static frontend (dashboard + classic viewer) — the primary UI is
# the Next.js app; mount only if the folder exists so the API still boots without it
_frontend = config.BASE_DIR / "frontend"
if _frontend.is_dir():
    app.mount("/", StaticFiles(directory=str(_frontend), html=True), name="frontend")
