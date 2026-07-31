"""File-type detection → processing-pipeline selection. Output is independent of the
original format (that's the whole point of the UBM)."""
from __future__ import annotations

from pathlib import Path

RASTER = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}


def detect_format(path: str) -> str:
    """Return a pipeline tag: raster | vector-pdf | svg | dxf | dwg | ifc | rvt | unknown."""
    ext = Path(path).suffix.lower()
    if ext in RASTER:
        return "raster"
    if ext == ".svg":
        return "svg"
    if ext == ".dxf":
        return "dxf"
    if ext == ".dwg":
        return "dwg"
    if ext in (".ifc", ".ifczip"):
        return "ifc"
    if ext in (".rvt",):
        return "rvt"
    if ext == ".pdf":
        return "vector-pdf" if _pdf_has_vector(path) else "raster"
    return "unknown"


def _pdf_has_vector(path: str) -> bool:
    """A PDF is 'vector' if page 1 carries real line-work/text; otherwise it's a scan
    and we route it through the raster (AI/CV) pipeline instead."""
    try:
        import fitz
        doc = fitz.open(path)
        if doc.page_count == 0:
            return False
        page = doc[0]
        drawings = page.get_drawings()
        text = page.get_text("text").strip()
        # meaningful vector line-work OR a decent amount of extractable text
        return len(drawings) >= 8 or len(text) >= 40
    except Exception:
        return False
