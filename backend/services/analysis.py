"""AI floor-plan interpretation (BRD 8).

Reads a floor plan the way an architect skims it:
  • walls        — strong straight edges (Hough)
  • rooms        — enclosed regions (contours), each classified into a real type
                   (Kitchen / Master Bedroom / Garage …) via OCR labels, the
                   user's entered rooms, or a geometry heuristic — never "Room N".
  • labels+dims  — OCR when Tesseract is available (services/ocr.py)
  • windows      — openings on the building's exterior walls
  • doors        — openings on shared interior walls + an entrance
Every element carries a confidence score for the 2D review screen.

If OpenCV / the file type isn't usable it returns a labelled demo layout so the
end-to-end pipeline still runs. Swap the CV internals for a trained
YOLO+segmentation+OCR model without changing this interface."""
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import rooms as room_svc
from . import ocr as ocr_svc
from . import plan_loader
from . import svg_vector
from . import pdf_vector

# words that mark a text block as a TITLE / metadata / paragraph — never a room tag
_NON_ROOM_WORDS = {
    "villa", "plan", "scale", "north", "legend", "drawing", "design", "creative",
    "openplan", "extend", "extended", "layout", "concept", "project", "client",
    "date", "rev", "note", "notes", "title", "total", "area", "ground", "first",
    "second", "third", "level", "elevation", "section", "detail", "sheet", "copyright",
}


def _room_label(text: str) -> Optional[str]:
    """Clean OCR text → a room TYPE only when it reads like a short room tag.
    Rejects titles, paragraphs and metadata (the #1 source of wrong room names — e.g. the
    plan title 'Creative Open-Plan Villa' being read as a room)."""
    t = (text or "").strip()
    words = [w for w in re.split(r"[^A-Za-z]+", t) if len(w) > 1]
    if not words or len(words) > 3 or len(t) > 22:
        return None                       # a paragraph / title / label block, not a room tag
    low = t.lower()
    if any(m in low for m in _NON_ROOM_WORDS):
        return None
    typ, _ = room_svc.classify(t)
    return typ if typ != "room" else None

try:
    import cv2
    import numpy as np
    _CV = True
except Exception:                       # pragma: no cover - optional dep
    _CV = False


# ------------------------------------------------------------------ fallback ---
def _demo_layout(reason: str) -> Dict[str, Any]:
    """A simple 2-bed flat so downstream 3D/tour steps have real, typed data."""
    W, H = 1000, 750
    walls = [
        (40, 40, 960, 40), (960, 40, 960, 710), (960, 710, 40, 710), (40, 710, 40, 40),
        (40, 300, 520, 300), (520, 40, 520, 710), (520, 430, 960, 430),
    ]
    rooms = [
        {"x": 60, "y": 60, "w": 440, "h": 220, "label": "Living Room"},
        {"x": 60, "y": 320, "w": 440, "h": 370, "label": "Master Bedroom"},
        {"x": 540, "y": 60, "w": 400, "h": 350, "label": "Kitchen"},
        {"x": 540, "y": 450, "w": 400, "h": 240, "label": "Bathroom"},
    ]
    out = _assemble(W, H, [{"x1": a, "y1": b, "x2": c, "y2": d, "confidence": 0.5}
                           for a, b, c, d in walls], rooms, None, f"demo ({reason})")
    return out


# ------------------------------------------------------------------ segment ----
def _segment_rooms(img) -> List[dict]:
    """Split the interior into rooms via watershed on the distance transform of
    free space. Distance-transform basins separate rooms even across the partial
    (open-plan) walls that defeat plain contour/flood-fill detection."""
    h, w = img.shape[:2]
    area_img = h * w
    wall = (img < 128).astype(np.uint8)
    k = max(3, int(max(h, w) * 0.012) | 1)
    wall = cv2.dilate(wall, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    free = (1 - wall).astype(np.uint8)

    dist = cv2.distanceTransform(free, cv2.DIST_L2, 5)
    if dist.max() <= 0:
        return []
    _, sure = cv2.threshold(dist, 0.32 * dist.max(), 255, 0)
    nseeds, seeds = cv2.connectedComponents(np.uint8(sure))
    markers = seeds + 1
    markers[wall > 0] = 0
    ws = cv2.watershed(cv2.cvtColor(img, cv2.COLOR_GRAY2BGR), markers.copy())

    rooms = []
    for lab in range(2, nseeds + 1):
        mask = (ws == lab).astype(np.uint8)
        a = int(mask.sum())
        if not (0.008 * area_img < a < 0.45 * area_img):
            continue
        x, y, ww, hh = cv2.boundingRect(mask)
        if ww < 40 or hh < 40:
            continue
        # grow back the wall dilation so rooms meet near wall centrelines
        g = k
        x, y = max(0, x - g), max(0, y - g)
        ww, hh = min(w - x, ww + 2 * g), min(h - y, hh + 2 * g)
        rooms.append({"x": int(x), "y": int(y), "w": int(ww), "h": int(hh)})
    return sorted(rooms, key=lambda r: r["w"] * r["h"], reverse=True)[:12]


def _merge_axis(items, tol, gap):
    """Merge near-collinear axis segments. items=[(perp, a0, a1)] → merged list."""
    clusters = []
    for perp, a0, a1 in sorted(items):
        for cl in clusters:
            if abs(cl["c"] - perp) < tol:
                cl["m"].append((perp, a0, a1))
                break
        else:
            clusters.append({"c": perp, "m": [(perp, a0, a1)]})
    out = []
    for cl in clusters:
        mem = sorted(cl["m"], key=lambda m: m[1])
        cmean = sum(m[0] for m in mem) / len(mem)
        c0, c1 = mem[0][1], mem[0][2]
        for _p, a0, a1 in mem[1:]:
            if a0 <= c1 + gap:
                c1 = max(c1, a1)
            else:
                out.append((cmean, c0, c1))
                c0, c1 = a0, a1
        out.append((cmean, c0, c1))
    return out


def _detect_walls(img) -> List[dict]:
    """Clean, axis-aligned walls: Hough on the wall mask, keep horizontal/vertical
    runs, snap to axis and merge collinear pieces — avoids the tangle of hundreds
    of Canny fragments from fills, hatching, dimension lines and text."""
    h, w = img.shape[:2]
    mask = (_clean_walls(img) * 255).astype(np.uint8)
    lines = cv2.HoughLinesP(mask, 1, np.pi / 180, threshold=50,
                            minLineLength=max(h, w) * 0.05, maxLineGap=16)
    H, V = [], []
    if lines is not None:
        for l in lines:
            x1, y1, x2, y2 = (int(v) for v in np.asarray(l).reshape(-1)[:4])
            dx, dy = abs(x2 - x1), abs(y2 - y1)
            if dy <= 0.18 * dx:                          # horizontal
                H.append(((y1 + y2) / 2, min(x1, x2), max(x1, x2)))
            elif dx <= 0.18 * dy:                        # vertical
                V.append(((x1 + x2) / 2, min(y1, y2), max(y1, y2)))
    minlen = max(h, w) * 0.045
    walls = []
    for y, x0, x1 in _merge_axis(H, tol=11, gap=28):
        if x1 - x0 > minlen:
            walls.append({"x1": int(x0), "y1": int(y), "x2": int(x1), "y2": int(y), "confidence": 0.85})
    for x, y0, y1 in _merge_axis(V, tol=11, gap=28):
        if y1 - y0 > minlen:
            walls.append({"x1": int(x), "y1": int(y0), "x2": int(x), "y2": int(y1), "confidence": 0.85})
    return walls


def _clean_walls(img, wall_thr=110):
    """Binary wall mask: dark structural lines with text specks removed."""
    h, w = img.shape[:2]
    area_img = h * w
    wall = (img < wall_thr).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(wall, connectivity=8)
    clean = np.zeros_like(wall)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > 0.0003 * area_img:   # keep walls, drop labels
            clean[lab == i] = 1
    k = max(3, int(max(h, w) * 0.008) | 1)
    return cv2.dilate(clean, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))


def _cluster_seeds(seeds, min_dist):
    """Merge label seeds that belong to one room (a multi-line label produces
    several OCR lines) and JOIN their text so "MASTER" + "BATH" classifies as one
    "MASTER BATH" (bathroom) rather than being read as a bedroom."""
    used = [False] * len(seeds)
    out = []
    for i, s in enumerate(seeds):
        if used[i]:
            continue
        grp = [s]
        used[i] = True
        for j in range(i + 1, len(seeds)):
            if not used[j] and abs(s[0] - seeds[j][0]) < min_dist and abs(s[1] - seeds[j][1]) < min_dist:
                grp.append(seeds[j])
                used[j] = True
        grp.sort(key=lambda g: (g[1], g[0]))                 # top-to-bottom, left-to-right
        phrase = " ".join(g[2] for g in grp)
        if _room_label(phrase) is None:
            # a joined legend / notes block ("Staircase Guest Bath …") — reduce to the first
            # genuine room word, or drop the cluster entirely if it holds no room name
            words = [g[2] for g in grp if _room_label(g[2])]
            if not words:
                continue
            phrase = words[0]
        cx = sum(g[0] for g in grp) / len(grp)
        cy = sum(g[1] for g in grp) / len(grp)
        out.append((cx, cy, phrase))
    return out


def _peak_seeds(img, existing, min_dist_frac=0.032, dist_frac=0.20, gap_frac=0.004):
    """Extra UNLABELED room seeds from distance-transform local maxima — so enclosed
    rooms the OCR never named (utility, pantry, powder, closet, hall…) are never
    missed. Filtered to real room-sized inscribed circles and kept clear of existing
    seeds so corridors / hatching noise don't spawn phantom rooms."""
    try:
        from skimage.feature import peak_local_max
        from scipy import ndimage as ndi
    except Exception:
        return []
    h, w = img.shape[:2]
    wall = _clean_walls(img) > 0
    kd = max(1, int(min(h, w) * gap_frac))
    wd = cv2.dilate(wall.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kd * 2 + 1, kd * 2 + 1))) > 0
    dist = ndi.gaussian_filter(ndi.distance_transform_edt(~wd), sigma=2.0)
    if dist.max() <= 0:
        return []
    md = max(6, int(min(h, w) * min_dist_frac))
    peaks = peak_local_max(dist, min_distance=md, threshold_abs=max(5.0, dist.max() * dist_frac), exclude_border=True)
    far2 = (min(h, w) * 0.05) ** 2
    out = []
    for py, px in peaks:
        if all((px - sx) ** 2 + (py - sy) ** 2 > far2 for sx, sy, _ in existing):
            out.append((float(px), float(py), ""))            # unlabeled → heuristic-named later
    return out


def _basin_polygon(mask):
    cnts = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)[-2]
    if not cnts:
        return None
    c = max(cnts, key=cv2.contourArea)
    p = cv2.approxPolyDP(c, 0.012 * cv2.arcLength(c, True), True).reshape(-1, 2)
    return [[int(a), int(b)] for a, b in p] if len(p) >= 3 else None


def _segment_rooms_seeded(img, seeds) -> List[dict]:
    """Watershed seeded by OCR room-label positions PLUS distance-peak seeds for
    unlabelled rooms — every enclosed cell (large or small) grows to its walls and
    becomes a room. No room is dropped for being small."""
    h, w = img.shape[:2]
    area_img = h * w
    seeds = list(seeds) + _peak_seeds(img, seeds)             # OCR (named) + peaks (unnamed)
    wall = _clean_walls(img)
    # feed watershed a clean barrier image (walls black, space white) so flooding
    # stops firmly at walls and only leaks through real openings — far more stable
    # than the busy original where fills/labels create spurious ridges.
    synth = np.where(wall > 0, 0, 255).astype(np.uint8)
    synth = cv2.cvtColor(synth, cv2.COLOR_GRAY2BGR)
    markers = np.zeros((h, w), np.int32)
    rad = max(3, int(min(h, w) * 0.008))
    for idx, (cx, cy, _label) in enumerate(seeds, start=1):
        cv2.circle(markers, (int(cx), int(cy)), rad, idx, -1)
    bg = len(seeds) + 1                          # exterior background seed (corners)
    for (cx, cy) in [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3)]:
        cv2.circle(markers, (cx, cy), 3, bg, -1)
    ws = cv2.watershed(synth, markers.copy())
    # building footprint (bbox of wall ink) → clip fallback boxes so a small room
    # whose basin failed still appears, centred on its label, instead of vanishing.
    ys, xs = np.nonzero(wall)
    fx0, fy0, fx1, fy1 = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if len(xs) else (0, 0, w, h)
    fb = max(40, int(min(fx1 - fx0, fy1 - fy0) * 0.16))
    rooms = []
    for idx, (cx, cy, label) in enumerate(seeds, start=1):
        m = (ws == idx).astype(np.uint8)
        a = int(m.sum())
        box, poly, status = None, None, "detected"
        if 0.0012 * area_img < a < 0.62 * area_img:
            x, y, ww, hh = cv2.boundingRect(m)
            if ww >= 20 and hh >= 20:
                box = (int(x), int(y), int(ww), int(hh))
                poly = _basin_polygon(m)
        if box is None:                                     # basin failed → labelled fallback box
            x0, y0 = max(fx0, int(cx) - fb), max(fy0, int(cy) - fb)
            x1, y1 = min(fx1, int(cx) + fb), min(fy1, int(cy) + fb)
            if x1 - x0 < 24 or y1 - y0 < 24:
                continue
            box = (x0, y0, x1 - x0, y1 - y0)
            status = "estimated"
        if poly is None:
            bx, by, bw, bh = box
            poly = [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]]
        rooms.append({"x": box[0], "y": box[1], "w": box[2], "h": box[3],
                      "label": label, "polygon": poly, "status": status})
    return rooms


# ------------------------------------------------------------------ helpers ----
def _derive_scale(rooms: List[dict], dims: List[dict]) -> Optional[float]:
    """Recover real metres-per-pixel from the OCR dimension labels ("11' x 13'4"", "3.5 m").
    Median across rooms is robust to the odd over-grown basin. Returns None if too few dims."""
    from statistics import median
    ests: List[float] = []
    for r in rooms:
        cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
        cand = [d for d in dims if d.get("a")]
        d = min(cand, key=lambda d: math.hypot(d["cx"] - cx, d["cy"] - cy), default=None)
        if not d or math.hypot(d["cx"] - cx, d["cy"] - cy) > max(r["w"], r["h"]):
            continue                                      # dim isn't inside this room
        unit = 0.3048 if ("'" in d["raw"] or "’" in d["raw"] or "ft" in d["raw"].lower()) else 1.0
        reals = sorted(v * unit for v in (d["a"], d["b"]) if v)
        px = sorted([r["w"], r["h"]])
        if len(reals) == 2 and px[0] > 0:
            ests += [reals[0] / px[0], reals[1] / px[1]]
        elif reals and px[1] > 0:
            ests.append(reals[0] / px[1])
    return median(ests) if len(ests) >= 3 else None


def _rescale_result(result: Dict[str, Any], f: float) -> None:
    """Scale every pixel coordinate by f in place (used to normalise a raster read to the app's
    default 0.02 m/px so its real-world dimensions come out right)."""
    def s(v):
        return int(round(v * f))
    for r in result.get("rooms", []):
        r["x"], r["y"], r["w"], r["h"] = s(r["x"]), s(r["y"]), s(r["w"]), s(r["h"])
        if r.get("polygon"):
            r["polygon"] = [[s(p[0]), s(p[1])] for p in r["polygon"]]
    for w in result.get("walls", []):
        w["x1"], w["y1"], w["x2"], w["y2"] = s(w["x1"]), s(w["y1"]), s(w["x2"]), s(w["y2"])
    for d in result.get("doors", []) + result.get("windows", []):
        d["x"], d["y"] = s(d["x"]), s(d["y"])
        if "len" in d:
            d["len"] = s(d["len"])
    if result.get("image_size"):
        result["image_size"] = [s(result["image_size"][0]), s(result["image_size"][1])]


def _building_bbox(rooms: List[dict]):
    xs = [r["x"] for r in rooms] + [r["x"] + r["w"] for r in rooms]
    ys = [r["y"] for r in rooms] + [r["y"] + r["h"] for r in rooms]
    return (min(xs), min(ys), max(xs), max(ys)) if rooms else (0, 0, 0, 0)


def _detect_windows(rooms: List[dict]) -> List[dict]:
    """One window per room edge that sits on the building's exterior outline."""
    if not rooms:
        return []
    minx, miny, maxx, maxy = _building_bbox(rooms)
    tol = max(12, (maxx - minx) * 0.02)
    windows = []
    for r in rooms:
        x, y, w, h = r["x"], r["y"], r["w"], r["h"]
        edges = [
            ("h", x + w / 2, y, w, abs(y - miny)),               # north
            ("h", x + w / 2, y + h, w, abs(y + h - maxy)),       # south
            ("v", x, y + h / 2, h, abs(x - minx)),               # west
            ("v", x + w, y + h / 2, h, abs(x + w - maxx)),       # east
        ]
        for orient, cx, cy, span, dist in edges:
            if dist < tol and span > 60 and r.get("type") not in ("bathroom", "utility"):
                windows.append({"x": round(cx), "y": round(cy), "orient": orient,
                                "len": round(span * 0.45), "confidence": 0.82})
    # de-dupe windows that landed on the same shared exterior corner
    uniq, seen = [], set()
    for wd in windows:
        key = (wd["orient"], wd["x"] // 25, wd["y"] // 25)
        if key not in seen:
            seen.add(key)
            uniq.append(wd)
    return uniq[:16]


def _detect_doors(rooms: List[dict]) -> List[dict]:
    """ONE door per enclosed room (bedroom, bath, kitchen, utility, balcony…) to the neighbour
    it opens onto, plus a main entrance. Open-plan / circulation spaces (living, dining, corridor,
    hall, foyer) don't get a door between them — that's why counting every adjacency over-doored
    the plan. This matches how a real plan is doored: a private room has one doorway."""
    ENCLOSED = {"bedroom", "master_bedroom", "guest", "bathroom", "toilet", "wc", "powder",
                "kitchen", "pantry", "utility", "store", "study", "office", "staircase",
                "lift", "balcony", "garage"}
    doors = []
    for i, a in enumerate(rooms):
        if (a.get("type") or "room") not in ENCLOSED:
            continue
        ax0, ay0, ax1, ay1 = a["x"], a["y"], a["x"] + a["w"], a["y"] + a["h"]
        best = None                                        # (gap, door-dict, neighbour)
        for j, b in enumerate(rooms):
            if i == j:
                continue
            bx0, by0, bx1, by1 = b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]
            ox0, ox1 = max(ax0, bx0), min(ax1, bx1)
            oy0, oy1 = max(ay0, by0), min(ay1, by1)
            if ox1 - ox0 > 60:                             # share a horizontal wall
                gap = min(abs(ay1 - by0), abs(by1 - ay0))
                if gap < 140 and (best is None or gap < best[0]):
                    y = (ay1 + by0) / 2 if abs(ay1 - by0) <= abs(by1 - ay0) else (by1 + ay0) / 2
                    best = (gap, {"x": round((ox0 + ox1) / 2), "y": round(y), "orient": "h"}, b)
            if oy1 - oy0 > 60:                             # share a vertical wall
                gap = min(abs(ax1 - bx0), abs(bx1 - ax0))
                if gap < 140 and (best is None or gap < best[0]):
                    x = (ax1 + bx0) / 2 if abs(ax1 - bx0) <= abs(bx1 - ax0) else (bx1 + ax0) / 2
                    best = (gap, {"x": round(x), "y": round((oy0 + oy1) / 2), "orient": "v"}, b)
        if best:
            d = best[1]
            d["confidence"] = 0.7
            d["glass"] = a.get("type") == "balcony" or best[2].get("type") == "balcony"
            doors.append(d)
    # de-dupe doors that resolved to the same spot (a shared wall found from both rooms)
    uniq, seen = [], set()
    for d in doors:
        key = (d["x"] // 40, d["y"] // 40)
        if key not in seen:
            seen.add(key)
            uniq.append(d)
    doors = uniq
    # main entrance: outer edge of the room nearest the building's front-centre
    if rooms:
        minx, miny, maxx, maxy = _building_bbox(rooms)
        cx = (minx + maxx) / 2
        entry = min(rooms, key=lambda r: abs((r["x"] + r["w"] / 2) - cx) + (maxy - (r["y"] + r["h"])) * 2)
        doors.append({"x": round(entry["x"] + entry["w"] / 2), "y": round(maxy),
                      "orient": "h", "confidence": 0.8, "entrance": True})
    return doors


def _apply_ocr(rooms: List[dict], ocr: Optional[dict]):
    """Attach OCR labels and dimensions to the room whose box contains them.
    Only genuine room-name text seeds a label (notes/dimensions are skipped) and an
    existing label (e.g. from seeded segmentation) is never overwritten."""
    if not ocr or not ocr.get("available"):
        return
    for lb in ocr.get("labels", []):
        if not _room_label(lb["text"]):                    # skip notes / dims / titles / paragraphs
            continue
        for r in rooms:
            if not r.get("label") and r["x"] <= lb["cx"] <= r["x"] + r["w"] \
                    and r["y"] <= lb["cy"] <= r["y"] + r["h"]:
                r["label"] = lb["text"]
                break
    for dm in ocr.get("dims", []):
        for r in rooms:
            if r["x"] <= dm["cx"] <= r["x"] + r["w"] and r["y"] <= dm["cy"] <= r["y"] + r["h"]:
                r["dim_label"] = dm["raw"]
                r["dim_values"] = [dm["a"], dm["b"]]
                break


def _dedup_rooms(rooms: List[dict]) -> List[dict]:
    """Drop only TRUE duplicates — a room read twice at essentially the same spot (e.g. a
    multi-line label). Two rooms whose CENTRES are far apart are distinct spaces and are both
    kept even when an over-grown watershed basin overlaps its neighbours: the UBM's
    rectilinearise pass then resolves the overlap into clean, non-overlapping rooms. Evicting a
    neighbour here (the old behaviour) silently deleted real rooms when one basin over-flooded."""
    boxes = sorted(rooms, key=lambda r: (0 if r.get("label") else 1, -(r["w"] * r["h"])))
    kept = []
    for r in boxes:
        rcx, rcy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
        ra = r["w"] * r["h"]
        dup = False
        for k in kept:
            kcx, kcy = k["x"] + k["w"] / 2, k["y"] + k["h"] / 2
            ox = max(0, min(r["x"] + r["w"], k["x"] + k["w"]) - max(r["x"], k["x"]))
            oy = max(0, min(r["y"] + r["h"], k["y"] + k["h"]) - max(r["y"], k["y"]))
            inter = ox * oy
            small = min(min(r["w"], r["h"]), min(k["w"], k["h"]))
            same_spot = math.hypot(rcx - kcx, rcy - kcy) < 0.5 * small
            if inter and inter / min(ra, k["w"] * k["h"]) > 0.82 and same_spot:
                dup = True
                break
        if not dup:
            kept.append(r)
    return kept


def _detections_summary(rooms, windows, doors, stairs) -> List[dict]:
    """Flat, per-object confidence list for the review UI (Kitchen 98%, Window 82%…)."""
    out = [{"label": r["name"], "kind": "room", "confidence": r.get("confidence", 0.5)}
           for r in rooms]
    if windows:
        out.append({"label": f"Windows ×{len(windows)}", "kind": "window",
                    "confidence": round(sum(w["confidence"] for w in windows) / len(windows), 2)})
    if doors:
        out.append({"label": f"Doors ×{len(doors)}", "kind": "door",
                    "confidence": round(sum(d["confidence"] for d in doors) / len(doors), 2)})
    for s in stairs:
        out.append({"label": "Staircase", "kind": "staircase", "confidence": s["confidence"]})
    return out


def _assemble(W, H, walls, rooms, ocr, source, hints=None) -> Dict[str, Any]:
    """Common tail: dedup → OCR → classify/name rooms → windows/doors → summary."""
    rooms = _dedup_rooms(rooms)
    _apply_ocr(rooms, ocr)
    room_svc.annotate_rooms(rooms, hints)
    stairs = [{"x": r["x"] + r["w"] // 2, "y": r["y"] + r["h"] // 2, "confidence": r["confidence"]}
              for r in rooms if r.get("type") == "staircase"]
    windows = _detect_windows(rooms)
    doors = _detect_doors(rooms)
    return {
        "image_size": [W, H],
        "walls": walls,
        "rooms": rooms,
        "doors": doors,
        "windows": windows,
        "stairs": stairs,
        "detections": _detections_summary(rooms, windows, doors, stairs),
        "ocr_available": bool(ocr and ocr.get("available")),
        "source": source,
    }


# ------------------------------------------------------------------ main -------
def analyse(image_path: str, label_hints: Optional[List[dict]] = None) -> Dict[str, Any]:
    """Interpret a floor plan. `label_hints` is the project's user-entered rooms
    [{name, room_type}], used to name detected rooms when OCR isn't available."""
    # EXACT path: a structured vector SVG carries real geometry — read it directly (rooms,
    # walls, doors, windows, names and true scale) instead of rasterising and guessing.
    if Path(image_path).suffix.lower() == ".svg":
        try:
            vec = svg_vector.extract(Path(image_path).read_text(errors="ignore"))
        except Exception:
            vec = None
        if vec and len(vec.get("rooms", [])) >= 2:
            vec["stairs"] = [{"x": r["x"] + r["w"] // 2, "y": r["y"] + r["h"] // 2, "confidence": r["confidence"]}
                             for r in vec["rooms"] if r.get("type") in ("staircase", "lift")]
            vec["detections"] = _detections_summary(vec["rooms"], vec["windows"], vec["doors"], vec["stairs"])
            return vec

    # EXACT path for a VECTOR PDF (wall lines + metre-labelled rooms) — read it directly per floor
    if Path(image_path).suffix.lower() == ".pdf":
        try:
            vec = pdf_vector.extract(image_path)
        except Exception:
            vec = None
        if vec and len(vec.get("rooms", [])) >= 2:
            vec["stairs"] = [{"x": r["x"] + r["w"] // 2, "y": r["y"] + r["h"] // 2, "confidence": r["confidence"]}
                             for r in vec["rooms"] if r.get("type") in ("staircase", "lift")]
            vec["detections"] = _detections_summary(vec["rooms"], vec["windows"], vec["doors"], vec["stairs"])
            return vec

    if not _CV:
        return _demo_layout("opencv unavailable — using template")

    # load any supported format → grayscale plan image (+ preset labels for DXF vectors)
    loaded = plan_loader.load(image_path)
    if loaded is None:
        ext = Path(image_path).suffix.lower()
        reason = "DWG needs conversion to DXF/PDF" if ext == ".dwg" else f"could not read {ext or 'file'}"
        return _demo_layout(f"{reason} — using template")
    img, preset_ocr, _src = loaded

    h, w = img.shape[:2]
    # downscale big raster reads; a rendered vector (DXF) already carries matching label coords
    if preset_ocr is None:
        scale = 1400 / max(h, w) if max(h, w) > 1400 else 1.0
        if scale != 1.0:
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
            h, w = img.shape[:2]

    # --- walls: clean axis-aligned, collinear-merged ---
    walls = _detect_walls(img)

    # --- rooms: OCR-label-seeded and blind watershed; keep the richer result
    #     (seeded wins ties — it carries real names; OCR still names blind rooms) ---
    ocr = preset_ocr if preset_ocr is not None else ocr_svc.read(img)
    seeded, seeds = [], []
    if ocr.get("available") and ocr.get("labels"):
        # only clean, short room tags seed rooms — titles/paragraphs/metadata are rejected
        raw = [(lb["cx"], lb["cy"], lb["text"]) for lb in ocr["labels"] if _room_label(lb["text"])]
        seeds = _cluster_seeds(raw, min(h, w) * 0.06)
        if len(seeds) >= 2:
            seeded = _segment_rooms_seeded(img, seeds)
    blind = _segment_rooms(img)
    # a labelled result carries real names (Kitchen, Bath, Foyer…) — prefer it once
    # there are a few labels, even if blind negative-space finds a couple more boxes.
    if len(seeds) >= 3 and len(seeded) >= 3:
        rooms, detector = seeded, "opencv-ocr-seeded-watershed"
        # fill spaces OCR couldn't read (e.g. a KITCHEN label hidden behind counter
        # graphics): add blind regions that don't already overlap a labelled room,
        # named later by the geometry heuristic.
        def _ov(a, b):
            ox = max(0, min(a["x"] + a["w"], b["x"] + b["w"]) - max(a["x"], b["x"]))
            oy = max(0, min(a["y"] + a["h"], b["y"] + b["h"]) - max(a["y"], b["y"]))
            return ox * oy
        labelled = list(rooms)
        for bl in blind:
            ba = max(1, bl["w"] * bl["h"])
            if ba > 0.33 * (h * w):                       # skip whole-building blobs
                continue
            # containment test both ways (min area) — only add genuinely new spaces
            if any(_ov(bl, r) / min(ba, r["w"] * r["h"]) > 0.35 for r in labelled):
                continue
            rooms.append(bl)
    elif len(seeded) >= len(blind) and len(seeded) >= 2:
        rooms, detector = seeded, "opencv-ocr-seeded-watershed"
    elif len(blind) >= 2:
        rooms, detector = blind, "opencv-watershed"
    else:
        rooms, detector = (seeded or blind), "opencv-watershed"
    if len(rooms) < 2:
        thr = cv2.adaptiveThreshold(img, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                                    cv2.THRESH_BINARY_INV, 35, 10)
        contours = cv2.findContours(thr, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)[-2]
        rooms, area_img = [], h * w
        for c in contours:
            x, y, cw, ch = cv2.boundingRect(c)
            a = cw * ch
            if 0.01 * area_img < a < 0.5 * area_img and cw > 40 and ch > 40:
                rooms.append({"x": int(x), "y": int(y), "w": int(cw), "h": int(ch)})
        rooms = sorted(rooms, key=lambda r: r["w"] * r["h"], reverse=True)[:12]
        detector = "opencv-contours"

    if not walls or not rooms:
        return _demo_layout("low detection confidence — using template")

    result = _assemble(w, h, walls, rooms, ocr, detector, label_hints)
    # recover the true scale from OCR dimension labels and normalise so the app's default
    # 0.02 m/px yields real metres — a raster read otherwise defaults to a guessed size.
    sc = _derive_scale(result["rooms"], ocr.get("dims", []))
    if sc and 0.002 < sc < 0.06:
        _rescale_result(result, sc / 0.02)
        result["scale_m_per_px"] = 0.02
    return result


# ------------------------------------------------------------------ warnings ---
def quality_warnings(result: Dict[str, Any]) -> list:
    """Blocking / non-blocking warnings for the 2D review screen (BRD 8.3, EDT-005)."""
    warnings = []
    if result.get("source", "").startswith("demo"):
        warnings.append({"level": "warning", "code": "template_used",
                         "message": "AI could not confidently read the plan; a template layout is shown. Please verify every element."})
    if len(result.get("walls", [])) < 4:
        warnings.append({"level": "blocking", "code": "too_few_walls",
                         "message": "Not enough walls detected to form an enclosed space."})
    if not result.get("rooms"):
        warnings.append({"level": "blocking", "code": "no_rooms",
                         "message": "No rooms detected. Add rooms in the editor before approval."})
    if "ocr_available" in result and not result["ocr_available"]:
        warnings.append({"level": "info", "code": "ocr_off",
                         "message": "OCR (Tesseract) is not installed — room names came from your entries / a template. Install Tesseract to read names straight off the drawing."})
    if all(w.get("confidence", 0) < 0.5 for w in result.get("walls", []) or [{}]):
        warnings.append({"level": "warning", "code": "low_confidence",
                         "message": "Many detections are low-confidence — review carefully."})
    return warnings
