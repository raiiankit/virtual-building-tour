"""Optional OCR for floor-plan labels & dimensions (BRD 8 — Phase 2).

Reads room names ("KITCHEN", "MASTER BEDROOM") and dimension callouts
("13 x 17", "9.20 m", "9' ceiling") straight off the drawing so rooms are named
and sized from the plan itself. Uses Tesseract via pytesseract *when available*;
if neither is installed it degrades to a no-op and the pipeline falls back to
user-entered room names / a template (so the app still runs free and locally).

Install to enable:  brew install tesseract  &&  pip install pytesseract
"""
from __future__ import annotations

import re
from typing import Dict, List

try:
    import pytesseract  # type: ignore
    from pytesseract import Output  # type: ignore
    _HAS_TESS = True
except Exception:                       # pragma: no cover - optional dep
    _HAS_TESS = False


def available() -> bool:
    if not _HAS_TESS:
        return False
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


# "13 x 17", "11'-6\" x 12'", "3.5 X 4.2 m" ...
_DIM_PAIR = re.compile(r"(\d+(?:\.\d+)?)\s*['’]?\s*[xX×]\s*(\d+(?:\.\d+)?)")
# "9.20 m", "9' ceiling", single leading measurement
_DIM_ONE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:m|meter|metre|ft|feet|['’])", re.I)


def parse_dimension(text: str):
    """Return (a, b, raw) in the drawing's own units, or None."""
    m = _DIM_PAIR.search(text)
    if m:
        return float(m.group(1)), float(m.group(2)), m.group(0)
    m = _DIM_ONE.search(text)
    if m:
        return float(m.group(1)), None, m.group(0)
    return None


def _prep(image):
    """Upscale, then produce two binarisations so Tesseract can read labels both on
    white space (Otsu) *and* inside grey/shaded fills like GARAGE / UTILITY / PANTRY
    (adaptive), where a global Otsu threshold would swallow the text. Returns
    (variants, scale_back) — coords read off a variant must be divided by scale."""
    try:
        import cv2
        import numpy as np
        h, w = image.shape[:2]
        f = min(max(1.0, 1600.0 / max(1, min(h, w))), 3.0)
        up = cv2.resize(image, None, fx=f, fy=f, interpolation=cv2.INTER_CUBIC) if f > 1 else image
        _, otsu = cv2.threshold(up, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        adap = cv2.adaptiveThreshold(up, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 41, 15)
        return [otsu, adap], f
    except Exception:
        return [image], 1.0


def _extract(data, f):
    """Turn one pytesseract data dict into (labels, dims) in input-image space."""
    labels, dims = [], []
    n = len(data.get("text", []))
    lines: dict = {}
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        if not txt or int(data.get("conf", ["-1"])[i] or -1) < 26:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        lines.setdefault(key, []).append((txt, x, y, w, h))
    for words in lines.values():
        phrase = " ".join(w[0] for w in words)
        cx = sum(w[1] + w[3] / 2 for w in words) / len(words) / f
        cy = sum(w[2] + w[4] / 2 for w in words) / len(words) / f
        dim = parse_dimension(phrase)
        if dim:
            dims.append({"a": dim[0], "b": dim[1], "raw": dim[2], "cx": cx, "cy": cy})
        if re.search(r"[A-Za-z]", phrase):
            labels.append({"text": phrase, "cx": cx, "cy": cy})
    return labels, dims


def read(image) -> Dict[str, List[dict]]:
    """OCR a floor-plan image (numpy array). Returns
       {"available": bool, "labels": [{text, cx, cy}], "dims": [{a,b,raw,cx,cy}]}
    with pixel coordinates in the given image's space. Runs multiple binarisations
    and merges the reads so shaded-region labels aren't lost."""
    if not available() or image is None:
        return {"available": False, "labels": [], "dims": []}
    variants, f = _prep(image)
    labels, dims = [], []
    ok = False
    for v in variants:
        try:
            data = pytesseract.image_to_data(v, output_type=Output.DICT, config="--psm 3")
        except Exception:
            continue
        ok = True
        ls, ds = _extract(data, f)
        labels.extend(ls)
        dims.extend(ds)
    if not ok:
        return {"available": False, "labels": [], "dims": []}

    # de-dupe reads of the same label from different variants (same text, ~same spot)
    uniq, seen = [], set()
    for lb in labels:
        key = (re.sub(r"[^a-z0-9]", "", lb["text"].lower())[:10], round(lb["cx"] / 30), round(lb["cy"] / 30))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(lb)
    return {"available": True, "labels": uniq, "dims": dims}
