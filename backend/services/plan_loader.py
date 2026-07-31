"""Load any supported plan format into a grayscale floor-plan image the analyser can
read. Raster (PNG/JPG) is read directly; PDF/SVG are rasterised; DXF is a true CAD
vector so we render its line-work to an image *and* return its text as ready labels
(no OCR needed); DWG is converted to DXF first when a converter is available.

Returns (gray_image: np.ndarray, preset_ocr: dict|None, source_tag: str) or None.
`preset_ocr` is None for raster/PDF/SVG (the analyser runs OCR itself) and a
pre-built {available, labels, dims} for DXF (text comes straight from the drawing).
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Tuple

try:
    import cv2
    import numpy as np
    _CV = True
except Exception:                       # pragma: no cover
    _CV = False

RASTER_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}
VECTOR_EXTS = {".pdf", ".svg", ".dxf", ".dwg"}
SUPPORTED_EXTS = RASTER_EXTS | VECTOR_EXTS


def _pdf_gray(path: str, dpi: int = 200):
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(path)
    pil = pdf[0].render(scale=dpi / 72.0).to_pil().convert("L")
    return np.array(pil)


def _svg_gray(path: str, scale: float = 3.0):
    # SVG → PDF (pure-python reportlab) → raster (pypdfium2); avoids a cairo dependency
    import pypdfium2 as pdfium
    from svglib.svglib import svg2rlg
    from reportlab.graphics import renderPDF
    drawing = svg2rlg(path)
    if drawing is None:
        return None
    buf = io.BytesIO()
    renderPDF.drawToFile(drawing, buf)
    buf.seek(0)
    pil = pdfium.PdfDocument(buf.read())[0].render(scale=scale).to_pil().convert("L")
    return np.array(pil)


def _dwg_to_dxf(path: str) -> Optional[str]:
    """Convert DWG → DXF using LibreDWG's dwg2dxf or the ODA File Converter if present."""
    out = Path(tempfile.mkdtemp()) / (Path(path).stem + ".dxf")
    exe = shutil.which("dwg2dxf")
    if exe:
        try:
            subprocess.run([exe, "-y", "-o", str(out), path], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
            if out.exists() and out.stat().st_size > 0:
                return str(out)
        except Exception:
            return None
    oda = shutil.which("ODAFileConverter") or shutil.which("ODAFileConverter.exe")
    if oda:
        try:
            outdir = str(out.parent)
            subprocess.run([oda, str(Path(path).parent), outdir, "ACAD2018", "DXF", "0", "1", Path(path).name],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
            cand = Path(outdir) / (Path(path).stem + ".dxf")
            if cand.exists():
                return str(cand)
        except Exception:
            return None
    return None


def _clean_mtext(t: str) -> str:
    import re
    return re.sub(r"\\[A-Za-z][^;]*;|[{}]", "", t or "").strip()


def _dxf_entities_ezdxf(path: str):
    """Extract (segments, texts) via ezdxf — the clean path for well-formed DXF."""
    import ezdxf
    try:
        doc = ezdxf.readfile(path)
    except Exception:
        try:
            from ezdxf import recover
            doc, _auditor = recover.readfile(path)
        except Exception:
            return None
    msp = doc.modelspace()
    segs: list = []
    texts: list = []

    def add(a, b):
        segs.append((float(a[0]), float(a[1]), float(b[0]), float(b[1])))

    for e in msp:
        try:
            t = e.dxftype()
            if t == "LINE":
                add(e.dxf.start, e.dxf.end)
            elif t == "LWPOLYLINE":
                pts = [(p[0], p[1]) for p in e.get_points("xy")]
                for i in range(len(pts) - 1):
                    add(pts[i], pts[i + 1])
                if e.closed and len(pts) > 2:
                    add(pts[-1], pts[0])
            elif t == "POLYLINE":
                pts = [(v.dxf.location[0], v.dxf.location[1]) for v in e.vertices]
                for i in range(len(pts) - 1):
                    add(pts[i], pts[i + 1])
                if getattr(e, "is_closed", False) and len(pts) > 2:
                    add(pts[-1], pts[0])
            elif t == "TEXT":
                ip = e.dxf.insert
                texts.append((str(e.dxf.text), ip[0], ip[1]))
            elif t == "MTEXT":
                ip = e.dxf.insert
                texts.append((_clean_mtext(e.plain_text()), ip[0], ip[1]))
        except Exception:
            continue
    return (segs, texts) if segs else None


def _dxf_entities_text(path: str):
    """Lenient ASCII-DXF scanner for foreign / DWG-converted files ezdxf rejects
    (bad handles). Reads LINE / LWPOLYLINE / TEXT / MTEXT straight from group codes."""
    try:
        raw = open(path, encoding="utf-8", errors="ignore").read().splitlines()
    except Exception:
        return None
    it = iter(raw)
    pairs = []
    for code in it:
        try:
            val = next(it)
        except StopIteration:
            break
        pairs.append((code.strip(), val))
    segs: list = []
    texts: list = []
    ent = None
    cur: dict = {}
    verts: list = []
    xtmp = None
    closed = False

    def flush():
        nonlocal ent, cur, verts, xtmp, closed
        try:
            if ent == "LINE" and all(k in cur for k in ("10", "20", "11", "21")):
                segs.append((float(cur["10"]), float(cur["20"]), float(cur["11"]), float(cur["21"])))
            elif ent == "LWPOLYLINE" and len(verts) >= 2:
                for i in range(len(verts) - 1):
                    segs.append((verts[i][0], verts[i][1], verts[i + 1][0], verts[i + 1][1]))
                if closed and len(verts) > 2:
                    segs.append((verts[-1][0], verts[-1][1], verts[0][0], verts[0][1]))
            elif ent in ("TEXT", "MTEXT") and "1" in cur and "10" in cur and "20" in cur:
                texts.append((_clean_mtext(cur["1"]), float(cur["10"]), float(cur["20"])))
        except Exception:
            pass
        ent, cur, verts, xtmp, closed = None, {}, [], None, False

    for code, val in pairs:
        if code == "0":
            flush(); ent = val.strip(); continue
        if ent == "LWPOLYLINE":
            if code == "10":
                xtmp = val.strip()
            elif code == "20":
                try: verts.append((float(xtmp), float(val.strip())))
                except Exception: pass
            elif code == "70":
                try: closed = bool(int(float(val.strip())) & 1)
                except Exception: pass
        elif ent in ("LINE", "TEXT", "MTEXT"):
            if code in ("10", "20", "11", "21", "1"):
                cur[code] = val.strip()
    flush()
    return (segs, texts) if segs else None


def _dxf_render(path: str, target: int = 1320) -> Optional[Tuple["np.ndarray", list]]:
    """Render DXF line-work to a white/black plan image and return (image, text-labels)."""
    ents = _dxf_entities_ezdxf(path) or _dxf_entities_text(path)
    if not ents:
        return None
    segs, texts = ents
    xs = [s[0] for s in segs] + [s[2] for s in segs]
    ys = [s[1] for s in segs] + [s[3] for s in segs]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    w = (maxx - minx) or 1.0
    h = (maxy - miny) or 1.0
    scale = (target - 40) / max(w, h)
    W, H = int(w * scale) + 40, int(h * scale) + 40
    img = np.full((H, W), 255, np.uint8)

    def tx(x, y):                                    # DXF is Y-up, images are Y-down
        return (int((x - minx) * scale) + 20, int((maxy - y) * scale) + 20)

    for (x1, y1, x2, y2) in segs:
        cv2.line(img, tx(x1, y1), tx(x2, y2), 0, 2, cv2.LINE_AA)
    labels = []
    for (txt, x, y) in texts:
        if txt and txt.strip():
            px, py = tx(x, y)
            labels.append({"text": txt.strip(), "cx": float(px), "cy": float(py)})
    return img, labels


def load(path: str):
    """Return (gray_image, preset_ocr|None, source_tag) or None if unreadable."""
    if not _CV:
        return None
    ext = Path(path).suffix.lower()
    try:
        if ext in RASTER_EXTS:
            img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
            return None if img is None else (img, None, "raster")
        if ext == ".pdf":
            return (_pdf_gray(path), None, "pdf")
        if ext == ".svg":
            g = _svg_gray(path)
            return None if g is None else (g, None, "svg")
        if ext in (".dxf", ".dwg"):
            src = path
            if ext == ".dwg":
                src = _dwg_to_dxf(path)
                if not src:
                    return None                      # no converter available
            rendered = _dxf_render(src)
            if not rendered:
                return None
            img, labels = rendered
            return (img, {"available": bool(labels), "labels": labels, "dims": []}, "dxf-vector")
    except Exception:
        return None
    return None
