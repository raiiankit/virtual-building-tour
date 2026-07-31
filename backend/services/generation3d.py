"""Procedural 3D generation (BRD 9). Converts an approved 2D vector plan into a
real building shell and a furnishing *scene manifest*, exported as .glb + .json.

The .glb is the architectural shell built by the pure-python writer in glb.py:
  floor slabs · white walls (punched for openings) · dark baseboards ·
  door frames + leaves + handles · aluminium window frames + transparent glass ·
  a staircase between floors.

The .scene.json is the interior: every recognised room, typed and dimensioned,
with the default furniture/fixtures an architect would place (services/furnish.py)
plus per-room floor materials and ceiling lights. The viewer instantiates it, so a
different furniture pack / interior theme swaps in without changing the data model
(BRD "future ready"). No furniture is baked into the .glb.

For higher fidelity later, swap glb.py for Blender's Python API (BRD 9 / Phase 4)."""
import json
from pathlib import Path

from .. import config
from . import glb
from . import furnish

DOOR_W = 1.05        # doorway width (m)
DOOR_H = 2.05        # doorway height (m)
ENTRANCE_W = 1.55    # main entrance is wider (double leaf)
WIN_SILL = 0.9       # window sill height (m)
WIN_HEAD = 2.1       # window head height (m)
STAIR_STEPS = 12
STAIR_RUN = 0.28     # tread depth (m)
STAIR_W = 1.1        # stair width (m)
STAIR_Z0 = -1.6      # run start offset from building centre (m)


def _orient_dir(orient):
    return (1.0, 0.0) if orient == "h" else (0.0, 1.0)


def _stair_footprint(cx, cz):
    """World rectangle (x0,z0,x1,z1) the staircase occupies (+margin) — used to
    punch a matching stairwell hole in the slab / ceiling above it."""
    m = 0.2
    return (cx - STAIR_W / 2 - m, cz + STAIR_Z0 - m,
            cx + STAIR_W / 2 + m, cz + STAIR_Z0 + STAIR_RUN * STAIR_STEPS + m)


def _slab_boxes(cx, cz, sx, sz, y_center, thick, hole=None):
    """Horizontal slab centred at (cx,cz). With hole=(x0,z0,x1,z1) it is built as a
    picture-frame of up to four strips so a stairwell passes cleanly through."""
    x0, x1 = cx - sx / 2, cx + sx / 2
    z0, z1 = cz - sz / 2, cz + sz / 2
    if hole is None:
        return [glb.aabb((cx, y_center, cz), (sx, thick, sz))]
    hx0, hz0, hx1, hz1 = hole
    hx0, hx1 = max(x0, hx0), min(x1, hx1)
    hz0, hz1 = max(z0, hz0), min(z1, hz1)
    if hx0 >= hx1 or hz0 >= hz1:                       # hole misses the slab → solid
        return [glb.aabb((cx, y_center, cz), (sx, thick, sz))]
    boxes = []

    def strip(a0, b0, a1, b1):
        if a1 - a0 > 1e-3 and b1 - b0 > 1e-3:
            boxes.append(glb.aabb(((a0 + a1) / 2, y_center, (b0 + b1) / 2),
                                  (a1 - a0, thick, b1 - b0)))
    strip(x0, z0, x1, hz0)          # south strip (full width)
    strip(x0, hz1, x1, z1)          # north strip (full width)
    strip(x0, hz0, hx0, hz1)        # west strip
    strip(hx1, hz0, x1, hz1)        # east strip
    return boxes


def _project_to_walls(px, pz, walls_m):
    """Nearest point on any wall segment to (px,pz). Returns
    (dist, cx, cz, ux, uz) with the wall's unit direction, or None."""
    best = None
    for (ax, az), (bx, bz) in walls_m:
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz or 1e-9
        t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / L2))
        cx, cz = ax + t * dx, az + t * dz
        d = ((px - cx) ** 2 + (pz - cz) ** 2) ** 0.5
        if best is None or d < best[0]:
            L = L2 ** 0.5
            best = (d, cx, cz, dx / L, dz / L)
    return best


def infer_doors(rooms):
    """Fallback door placement on the shared wall between adjacent rooms (px)."""
    doors, tol = [], 45
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            a, b = rooms[i], rooms[j]
            ar, al, at, ab = a["x"] + a["w"], a["x"], a["y"] + a["h"], a["y"]
            br, bl, bt, bb = b["x"] + b["w"], b["x"], b["y"] + b["h"], b["y"]
            if abs(ar - bl) < tol or abs(br - al) < tol:
                y0, y1 = max(a["y"], b["y"]), min(at, bt)
                if y1 - y0 > 55:
                    x = (ar + bl) / 2 if abs(ar - bl) < tol else (br + al) / 2
                    doors.append({"x": round(x), "y": round((y0 + y1) / 2)})
            if abs(at - bb) < tol or abs(bt - ab) < tol:
                x0, x1 = max(a["x"], b["x"]), min(ar, br)
                if x1 - x0 > 55:
                    y = (at + bb) / 2 if abs(at - bb) < tol else (bt + ab) / 2
                    doors.append({"x": round((x0 + x1) / 2), "y": round(y)})
    return doors


def _split_wall(a, b, openings, tol=0.6):
    """Split wall a->b (metres) leaving a gap at each nearby opening. Returns the
    kept sub-segments and the openings that landed on this wall (with their
    world centre + the wall's unit direction)."""
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    L = (dx * dx + dz * dz) ** 0.5 or 1e-9
    ux, uz = dx / L, dz / L
    hits = []
    for op in openings:
        px, pz = op["p"]
        t = ((px - ax) * dx + (pz - az) * dz) / (L * L)
        if t <= 0.05 or t >= 0.95:
            continue
        cx, cz = ax + t * dx, az + t * dz
        if ((px - cx) ** 2 + (pz - cz) ** 2) ** 0.5 < tol:
            hits.append((t, cx, cz, op))
    hits.sort(key=lambda h: h[0])
    kept, cursor, matched = [], 0.0, []
    for (t, cx, cz, op) in hits:
        op["_hit"] = True                      # this opening landed on a real wall
        g = op["half"] / L
        lo, hi = max(0.0, t - g), min(1.0, t + g)
        if lo > cursor + 1e-3:
            kept.append((cursor, lo))
        cursor = max(cursor, hi)
        matched.append({"center": (cx, cz), "along": (ux, uz), "op": op})
    if cursor < 1.0 - 1e-3:
        kept.append((cursor, 1.0))
    segs = [((ax + k0 * dx, az + k0 * dz), (ax + k1 * dx, az + k1 * dz))
            for (k0, k1) in kept if k1 - k0 > 0.01]
    return segs, matched


def _build_door(cx, cz, ux, uz, base_y, th, wh, frame_b, leaf_b, handle_b,
                width=DOOR_W, double=False, glass=False, glass_b=None):
    half = width / 2
    along_x = abs(ux) > abs(uz)
    for s in (-1, 1):                                     # frame posts
        px, pz = cx + ux * half * s, cz + uz * half * s
        sz = (0.12, DOOR_H, th * 1.7) if along_x else (th * 1.7, DOOR_H, 0.12)
        frame_b.append(glb.aabb((px, base_y + DOOR_H / 2, pz), sz))
    lintel = (width + 0.26, wh - DOOR_H, th * 1.7) if along_x else \
             (th * 1.7, wh - DOOR_H, width + 0.26)
    frame_b.append(glb.aabb((cx, base_y + (DOOR_H + wh) / 2, cz), lintel))
    if glass and glass_b is not None:                     # balcony sliding glass door
        left = (cx - ux * half, cz - uz * half)
        right = (cx + ux * half, cz + uz * half)
        glass_b.append(glb.seg_prism(left, right, 0.04, base_y + 0.05, base_y + DOOR_H))
        mull = (0.08, DOOR_H, th * 1.6) if along_x else (th * 1.6, DOOR_H, 0.08)
        frame_b.append(glb.aabb((cx, base_y + DOOR_H / 2, cz), mull))   # central mullion
        return
    nx, nz = -uz, ux                                      # leaves swing into the room
    if double:                                            # double-leaf main entrance
        for s in (-1, 1):
            hinge = (cx + ux * half * s, cz + uz * half * s)
            ll = half * 0.9
            tip = (hinge[0] + nx * ll, hinge[1] + nz * ll)
            leaf_b.append(glb.seg_prism(hinge, tip, 0.06, base_y, base_y + DOOR_H))
            hp = (hinge[0] + nx * ll * 0.85 - ux * 0.02 * s, hinge[1] + nz * ll * 0.85)
            handle_b.append(glb.aabb((hp[0], base_y + 1.02, hp[1]), (0.06, 0.5, 0.06)))
    else:
        hinge = (cx + ux * half, cz + uz * half)
        tip = (hinge[0] + nx * width * 0.9, hinge[1] + nz * width * 0.9)
        leaf_b.append(glb.seg_prism(hinge, tip, 0.05, base_y, base_y + DOOR_H))
        hp = (hinge[0] + nx * width * 0.78, hinge[1] + nz * width * 0.78)
        handle_b.append(glb.aabb((hp[0], base_y + 1.02, hp[1]), (0.08, 0.14, 0.08)))


def _build_window(cx, cz, ux, uz, half, base_y, base_h, th, wh,
                  walls_b, base_b, winframe_b, glass_b):
    left = (cx - ux * half, cz - uz * half)
    right = (cx + ux * half, cz + uz * half)
    # wall infill below the sill and above the head (keeps the enclosure solid)
    walls_b.append(glb.seg_prism(left, right, th, base_y + base_h, base_y + WIN_SILL))
    base_b.append(glb.seg_prism(left, right, th * 1.5, base_y, base_y + base_h))
    walls_b.append(glb.seg_prism(left, right, th, base_y + WIN_HEAD, base_y + wh))
    # aluminium frame: sill bar, head bar, two posts
    winframe_b.append(glb.seg_prism(left, right, th, base_y + WIN_SILL - 0.05, base_y + WIN_SILL))
    winframe_b.append(glb.seg_prism(left, right, th, base_y + WIN_HEAD, base_y + WIN_HEAD + 0.05))
    lp2 = (left[0] + ux * 0.06, left[1] + uz * 0.06)
    rp1 = (right[0] - ux * 0.06, right[1] - uz * 0.06)
    winframe_b.append(glb.seg_prism(left, lp2, th, base_y + WIN_SILL, base_y + WIN_HEAD))
    winframe_b.append(glb.seg_prism(rp1, right, th, base_y + WIN_SILL, base_y + WIN_HEAD))
    # transparent glass pane (see-through into the room)
    glass_b.append(glb.seg_prism(left, right, 0.03, base_y + WIN_SILL, base_y + WIN_HEAD))


def _prim(boxes, color, rough, metal=0.0, alpha=None, emissive=None):
    p, n, i = glb.boxes_to_arrays(boxes)
    mat = {"baseColorFactor": color, "roughnessFactor": rough, "metallicFactor": metal}
    if alpha:
        mat["alphaMode"] = "BLEND"
    if emissive:
        mat["emissiveFactor"] = emissive
    return {"positions": p, "normals": n, "indices": i, "material": mat}


def generate(model_id: int, vectors: dict, scale: float, floor_count: int = 1,
             floor_height: float = 3.0) -> str:
    theme = config.DEFAULT_THEME
    th = theme["wall_thickness_m"]
    wh = theme["wall_height_m"]
    base_h = 0.11
    floors = max(1, int(floor_count or 1))

    rooms_px = vectors.get("rooms", [])
    # doors: prefer detected ones, else infer from adjacency
    doors_src = vectors.get("doors", []) or infer_doors(rooms_px)
    door_ops = []
    for d in doors_src:
        ent = bool(d.get("entrance"))
        glass = bool(d.get("glass"))
        w = 1.75 if glass else (ENTRANCE_W if ent else DOOR_W)
        door_ops.append({"p": (d["x"] * scale, d["y"] * scale), "half": w / 2, "kind": "door",
                         "orient": d.get("orient", "h"), "entrance": ent, "width": w, "glass": glass})
    win_ops = [{"p": (wd["x"] * scale, wd["y"] * scale),
                "half": max(0.4, wd.get("len", 90) * scale / 2), "kind": "window",
                "orient": wd.get("orient", "h")}
               for wd in vectors.get("windows", [])]

    walls_b, base_b, floor_b = [], [], []
    frame_b, leaf_b, handle_b = [], [], []
    winframe_b, glass_b, stair_b = [], [], []
    ceil_b = []
    bounds = None

    for level in range(floors):
        base_y = level * floor_height
        openings = door_ops + win_ops
        xs, zs, walls_m = [], [], []
        for w in vectors.get("walls", []):
            a = (w["x1"] * scale, w["y1"] * scale)
            b = (w["x2"] * scale, w["y2"] * scale)
            xs += [a[0], b[0]]
            zs += [a[1], b[1]]
            walls_m.append((a, b))
            segs, matched = _split_wall(a, b, openings)
            for s1, s2 in segs:
                walls_b.append(glb.seg_prism(s1, s2, th, base_y + base_h, base_y + wh))
                base_b.append(glb.seg_prism(s1, s2, th * 1.5, base_y, base_y + base_h))
            for mo in matched:
                (cx, cz), (ux, uz), op = mo["center"], mo["along"], mo["op"]
                if op["kind"] == "door":
                    _build_door(cx, cz, ux, uz, base_y, th, wh, frame_b, leaf_b, handle_b,
                                width=op.get("width", DOOR_W), double=op.get("entrance", False),
                                glass=op.get("glass", False), glass_b=glass_b)
                else:
                    _build_window(cx, cz, ux, uz, op["half"], base_y, base_h, th, wh,
                                  walls_b, base_b, winframe_b, glass_b)
        # doors that never landed on a detected wall (e.g. the main entrance on a
        # perimeter the CV missed): snap them onto the nearest wall so they read as
        # real doorways instead of floating with a guessed orientation.
        for op in door_ops:
            if op.get("_hit"):
                continue
            proj = _project_to_walls(op["p"][0], op["p"][1], walls_m)
            if proj and proj[0] < 1.5:
                _, cx, cz, ux, uz = proj
            else:
                cx, cz = op["p"]
                ux, uz = _orient_dir(op["orient"])
            _build_door(cx, cz, ux, uz, base_y, th, wh,
                        frame_b, leaf_b, handle_b, width=op["width"], double=op["entrance"],
                        glass=op.get("glass", False), glass_b=glass_b)

        if xs and zs:
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            sx, sz = (max(xs) - min(xs)) + th, (max(zs) - min(zs)) + th
            stair_up = floors > 1 and level < floors - 1        # stair leaves this floor
            stair_below = floors > 1 and level >= 1             # stair arrives from below
            # floor slab recessed ~5 mm so it never z-fights wall/baseboard/door
            # bottoms; upper floors get a stairwell hole for the stair coming up.
            hole = _stair_footprint(cx, cz) if stair_below else None
            floor_b.extend(_slab_boxes(cx, cz, sx, sz, base_y - 0.065, 0.12, hole))
            # ceiling closes the top of every floor; punched where a stair goes up.
            ceil_hole = _stair_footprint(cx, cz) if stair_up else None
            ceil_b.extend(_slab_boxes(cx, cz, sx, sz, base_y + wh + 0.045, 0.08, ceil_hole))
            if bounds is None:
                bounds = {"min": [min(xs), min(zs)], "max": [max(xs), max(zs)]}
            if stair_up:
                _build_stair(cx, cz, base_y, floor_height, stair_b)

    primitives = [
        _prim(floor_b, theme["floor"] + [1.0], 0.35, 0.05),
        _prim(ceil_b, [0.96, 0.96, 0.95, 1.0], 0.9),                       # matte white ceiling
        _prim(walls_b, theme["wall"] + [1.0], 0.9),
        _prim(base_b, [0.24, 0.21, 0.19, 1.0], 0.6),
        _prim(frame_b, [0.22, 0.14, 0.08, 1.0], 0.55),
        _prim(leaf_b, theme["door"] + [1.0], 0.5),
        _prim(handle_b, [0.75, 0.72, 0.62, 1.0], 0.25, 0.9),               # brass handle
        _prim(winframe_b, [0.78, 0.80, 0.83, 1.0], 0.3, 0.85),             # aluminium frame
        _prim(glass_b, [0.62, 0.80, 0.90, 0.28], 0.05, 0.0, alpha=True),   # transparent glass
        _prim(stair_b, [0.55, 0.55, 0.56, 1.0], 0.8),                      # concrete stair
    ]
    data = glb.build_glb(primitives)
    out = config.MODEL_DIR / f"model_{model_id}.glb"
    Path(out).write_bytes(data)

    _write_manifest(model_id, vectors, scale, floors, floor_height, wh, bounds)
    return str(out.relative_to(config.STORAGE_DIR))


def _build_stair(cx, cz, base_y, floor_height, stair_b):
    for k in range(STAIR_STEPS):
        h = floor_height * (k + 1) / STAIR_STEPS
        stair_b.append(glb.aabb((cx, base_y + h / 2, cz + STAIR_Z0 + STAIR_RUN * k),
                                (STAIR_W, h, STAIR_RUN)))


def _write_manifest(model_id, vectors, scale, floors, floor_height, wh, bounds):
    """Interior furnishing manifest consumed by the viewer / future render engines."""
    rooms_out, furniture_out = [], []
    for level in range(floors):
        base_y = level * floor_height
        for r in vectors.get("rooms", []):
            cx = (r["x"] + r["w"] / 2) * scale
            cz = (r["y"] + r["h"] / 2) * scale
            w_m, d_m = r["w"] * scale, r["h"] * scale
            rtype = r.get("type", "room")
            conf = float(r.get("confidence", 0.7) or 0.7)
            rooms_out.append({
                "name": r.get("name") or config.room_display_name(rtype),
                "type": rtype, "confidence": conf,
                "center": [round(cx, 3), round(cz, 3)], "size": [round(w_m, 3), round(d_m, 3)],
                "dim_label": r.get("dim_label"),
                "floor_material": r.get("floor_material") or config.room_floor_material(rtype),
                "level": level, "base_y": round(base_y, 3),
            })
            for it in furnish.furnish_room(rtype, cx, cz, w_m, d_m, conf, wh):
                it["room"] = r.get("name")
                it["base_y"] = round(base_y, 3)
                it["level"] = level
                furniture_out.append(it)

    windows_out = [{"pos": [round(wd["x"] * scale, 3), round(wd["y"] * scale, 3)],
                    "orient": wd.get("orient", "h"), "len": round(wd.get("len", 90) * scale, 3),
                    "sill": WIN_SILL, "head": WIN_HEAD, "confidence": wd.get("confidence", 0.8)}
                   for wd in vectors.get("windows", [])]
    doors_out = [{"pos": [round(d["x"] * scale, 3), round(d["y"] * scale, 3)],
                  "orient": d.get("orient", "h"), "entrance": d.get("entrance", False),
                  "glass": d.get("glass", False),
                  "width": round((ENTRANCE_W if d.get("entrance") else DOOR_W), 3),
                  "confidence": d.get("confidence", 0.7)}
                 for d in vectors.get("doors", [])]

    # --- walls in world metres + exterior/interior classification (for the native
    #     R3F architecture generator) ---
    b = bounds or {"min": [0, 0], "max": [0, 0]}
    minx, minz = b["min"]
    maxx, maxz = b["max"]
    peri_tol = max(0.35, (maxx - minx) * 0.03)

    def _exterior(ax, az, bx, bz):
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        return (abs(mx - minx) < peri_tol or abs(mx - maxx) < peri_tol
                or abs(mz - minz) < peri_tol or abs(mz - maxz) < peri_tol)

    walls_out = []
    for w in vectors.get("walls", []):
        ax, az = w["x1"] * scale, w["y1"] * scale
        bx, bz = w["x2"] * scale, w["y2"] * scale
        walls_out.append({"a": [round(ax, 3), round(az, 3)], "b": [round(bx, 3), round(bz, 3)],
                          "exterior": _exterior(ax, az, bx, bz)})

    manifest = {
        "version": config.SCENE_MANIFEST_VERSION, "units": "m",
        "floor_height_m": floor_height, "wall_height_m": wh, "levels": floors,
        "bounds": b, "scale": round(scale, 5), "theme": "modern",
        "win_sill": WIN_SILL, "win_head": WIN_HEAD,
        "rooms": rooms_out, "furniture": furniture_out, "walls": walls_out,
        "windows": windows_out, "doors": doors_out,
        "floor_materials": config.FLOOR_MATERIALS,
    }
    out = config.MODEL_DIR / f"model_{model_id}.scene.json"
    Path(out).write_text(json.dumps(manifest))
    return str(out.relative_to(config.STORAGE_DIR))


def validate(vectors: dict) -> list:
    issues = []
    if len(vectors.get("walls", [])) < 4:
        issues.append("Fewer than 4 walls — enclosure may be incomplete.")
    return issues
