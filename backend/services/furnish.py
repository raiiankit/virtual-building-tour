"""Interior furnishing (BRD 9 — "the building must never be empty").

Given a recognised room (type + world-space rectangle) this lays out the default
architectural elements an architect would draw for that room: a bathroom gets a
toilet, basin, mirror, shower + glass partition; a kitchen gets a platform, sink,
cabinets, chimney, fridge; a bedroom gets a bed, wardrobe, side tables; and so on.

Output is a flat list of *furniture instances* in metres, world axis-aligned
boxes/props the viewer instantiates with real materials. It is emitted into the
scene manifest, so a different furniture pack / interior theme can be swapped in
later without touching the data model (BRD "future ready")."""
from __future__ import annotations

from typing import List, Dict

from .. import config


class _Room:
    """Convenience wrapper: centre, half-extents and wall coordinates (metres)."""
    def __init__(self, cx, cz, w, d):
        self.cx, self.cz, self.w, self.d = cx, cz, w, d
        self.hw, self.hd = w / 2, d / 2
        self.N, self.S = cz - self.hd, cz + self.hd     # -z / +z walls
        self.W, self.E = cx - self.hw, cx + self.hw     # -x / +x walls


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _item(items, t, x, z, sx, sy, sz, material, conf, y=None):
    """Append one instance. `y` (centre height) is set for wall/ceiling props;
    floor props are grounded by the viewer using sy."""
    inst = {"type": t, "pos": [round(x, 3), round(z, 3)],
            "size": [round(sx, 3), round(sy, 3), round(sz, 3)],
            "material": material, "confidence": round(conf, 2)}
    if y is not None:
        inst["y"] = round(y, 3)
    items.append(inst)


def _ceiling_light(items, r: _Room, conf, wall_h):
    _item(items, "ceiling_light", r.cx, r.cz, 0.34, 0.06, 0.34, "light",
          min(0.95, conf + 0.02), y=wall_h - 0.06)


# --- per-room-type packs -------------------------------------------------------
def _bathroom(items, r, c, wh, master=False):
    # plumbing wall = the short wall; fixtures line it
    _item(items, "toilet", r.W + 0.35, r.N + 0.42, 0.4, 0.42, 0.62, "ceramic", c)
    _item(items, "washbasin", r.W + 0.32, r.S - 0.4, 0.5, 0.2, 0.42, "ceramic", c, y=0.82)
    _item(items, "mirror", r.W + 0.08, r.S - 0.4, 0.04, 0.6, 0.5, "glass", c, y=1.5)
    _item(items, "towel_holder", r.W + 0.06, r.cz, 0.03, 0.06, 0.5, "metal", c - 0.08, y=1.1)
    # shower area in the far corner with a glass partition
    sw = _clamp(r.w * 0.42, 0.8, 1.2)
    sx = r.E - sw / 2 - 0.04
    _item(items, "shower", sx, r.S - 0.5, sw, 0.02, 0.9, "antiskid", c)
    _item(items, "shower_head", sx, r.S - 0.85, 0.12, 0.1, 0.12, "metal", c - 0.05, y=2.05)
    _item(items, "glass_partition", r.E - sw, r.S - 0.5, 0.03, 1.9, 0.9, "glass", c - 0.04, y=0.95)
    _item(items, "floor_drain", sx, r.S - 0.5, 0.14, 0.02, 0.14, "metal", c - 0.1)
    _item(items, "exhaust", r.cx, r.N + 0.06, 0.24, 0.24, 0.06, "metal", c - 0.1, y=wh - 0.35)
    _ceiling_light(items, r, c, wh)


def _kitchen(items, r, c, wh):
    # L-shaped platform along the west + north walls
    _item(items, "counter", r.W + 0.3, r.cz, 0.6, 0.9, r.d - 0.2, "marble", c)
    _item(items, "sink", r.W + 0.3, r.cz, 0.4, 0.05, 0.4, "metal", c - 0.04, y=0.92)
    _item(items, "tap", r.W + 0.3, r.cz - 0.18, 0.05, 0.28, 0.05, "metal", c - 0.06, y=0.95)
    _item(items, "cabinets", r.W + 0.3, r.cz, 0.6, 0.82, r.d - 0.2, "wood", c - 0.02)
    _item(items, "wall_cabinet", r.W + 0.22, r.cz, 0.35, 0.7, r.d - 0.4, "wood", c - 0.05, y=1.9)
    _item(items, "counter", r.cx, r.N + 0.3, r.w - 1.0, 0.9, 0.6, "marble", c)
    _item(items, "chimney", r.cx, r.N + 0.25, 0.6, 0.5, 0.4, "metal", c - 0.03, y=1.75)
    _item(items, "fridge", r.E - 0.36, r.N + 0.4, 0.7, 1.8, 0.7, "steel", c - 0.02)
    _item(items, "microwave", r.W + 0.3, r.S - 0.5, 0.5, 0.3, 0.35, "dark", c - 0.08, y=1.35)
    _ceiling_light(items, r, c, wh)


def _bedroom(items, r, c, wh, master=False):
    bw = _clamp(r.w * (0.62 if master else 0.5), 1.4 if master else 1.0, 2.1 if master else 1.6)
    bl = _clamp(r.d * 0.5, 1.9, 2.1)
    _item(items, "bed", r.cx, r.N + bl / 2 + 0.1, bw, 0.55, bl, "fabric", c)
    _item(items, "headboard", r.cx, r.N + 0.12, bw + 0.2, 1.1, 0.12, "wood", c - 0.03, y=0.55)
    _item(items, "side_table", r.cx - bw / 2 - 0.28, r.N + 0.5, 0.4, 0.5, 0.4, "wood", c - 0.05)
    _item(items, "night_lamp", r.cx - bw / 2 - 0.28, r.N + 0.5, 0.18, 0.35, 0.18,
          "light", c - 0.08, y=0.7)
    if master:
        _item(items, "side_table", r.cx + bw / 2 + 0.28, r.N + 0.5, 0.4, 0.5, 0.4, "wood", c - 0.05)
        _item(items, "night_lamp", r.cx + bw / 2 + 0.28, r.N + 0.5, 0.18, 0.35, 0.18,
              "light", c - 0.08, y=0.7)
        _item(items, "tv_unit", r.cx, r.S - 0.22, _clamp(r.w * 0.5, 1.0, 1.8), 0.4, 0.35,
              "wood", c - 0.05)
        _item(items, "tv", r.cx, r.S - 0.12, _clamp(r.w * 0.4, 0.9, 1.5), 0.62, 0.06,
              "screen", c - 0.04, y=1.15)
    _item(items, "wardrobe", r.E - 0.32, r.cz, 0.6, 2.1, _clamp(r.d * 0.55, 1.2, 2.2),
          "wood", c - 0.02)
    _item(items, "curtain", r.cx, r.N + 0.1, bw + 0.6, 1.6, 0.08, "fabric", c - 0.12, y=1.7)
    _ceiling_light(items, r, c, wh)


def _living(items, r, c, wh):
    sofa_w = _clamp(r.w * 0.6, 1.6, 2.8)
    _item(items, "sofa", r.cx, r.S - 0.5, sofa_w, 0.75, 0.9, "fabric", c)
    _item(items, "coffee_table", r.cx, r.cz + 0.1, _clamp(sofa_w * 0.5, 0.8, 1.3), 0.4, 0.6,
          "wood", c - 0.04)
    _item(items, "tv_unit", r.cx, r.N + 0.24, _clamp(r.w * 0.55, 1.2, 2.2), 0.42, 0.4,
          "wood", c - 0.03)
    _item(items, "tv", r.cx, r.N + 0.14, _clamp(r.w * 0.45, 1.0, 1.8), 0.7, 0.06,
          "screen", c - 0.02, y=1.2)
    _item(items, "rug", r.cx, r.cz + 0.1, sofa_w + 0.4, 0.02, 1.6, "fabric", c - 0.1)
    _item(items, "plant", r.E - 0.35, r.N + 0.35, 0.4, 1.3, 0.4, "plant", c - 0.1)
    _ceiling_light(items, r, c, wh)


def _dining(items, r, c, wh):
    tw = _clamp(r.w * 0.4, 0.9, 1.4)
    tl = _clamp(r.d * 0.5, 1.2, 2.0)
    _item(items, "dining_table", r.cx, r.cz, tw, 0.76, tl, "wood", c)
    # six chairs (3 per long side)
    for k in range(3):
        z = r.cz - tl / 2 + tl * (k + 0.5) / 3
        _item(items, "chair", r.cx - tw / 2 - 0.28, z, 0.42, 0.9, 0.42, "wood", c - 0.05)
        _item(items, "chair", r.cx + tw / 2 + 0.28, z, 0.42, 0.9, 0.42, "wood", c - 0.05)
    _ceiling_light(items, r, c, wh)


def _utility(items, r, c, wh):
    _item(items, "washing_machine", r.W + 0.4, r.N + 0.42, 0.62, 0.85, 0.62, "steel", c)
    _item(items, "utility_sink", r.W + 0.4, r.S - 0.4, 0.5, 0.85, 0.5, "ceramic", c - 0.04)
    _item(items, "storage", r.E - 0.3, r.cz, 0.55, 2.0, _clamp(r.d * 0.6, 1.0, 2.0), "wood", c - 0.03)
    _ceiling_light(items, r, c, wh)


def _garage(items, r, c, wh):
    _item(items, "vehicle", r.cx, r.cz + 0.2, _clamp(r.w * 0.55, 1.7, 2.0), 1.45,
          _clamp(r.d * 0.7, 3.8, 4.6), "car", c)
    _item(items, "garage_door", r.cx, r.S - 0.06, r.w - 0.4, 2.3, 0.12, "metal", c - 0.02, y=1.15)
    _item(items, "storage", r.W + 0.28, r.N + 0.8, 0.5, 1.9, 1.4, "wood", c - 0.06)
    _ceiling_light(items, r, c, wh)


def _balcony(items, r, c, wh):
    # glass railing around the open (south/east) edges
    _item(items, "glass_railing", r.cx, r.S - 0.04, r.w - 0.1, 1.05, 0.05, "glass", c, y=0.55)
    _item(items, "glass_railing", r.E - 0.04, r.cz, 0.05, 1.05, r.d - 0.1, "glass", c, y=0.55)
    _item(items, "planter", r.W + 0.25, r.S - 0.3, 0.35, 0.5, 0.9, "plant", c - 0.08)
    _item(items, "outdoor_chair", r.cx, r.cz, 0.5, 0.8, 0.5, "metal", c - 0.1)


def _foyer(items, r, c, wh):
    _item(items, "console", r.W + 0.22, r.cz, 0.35, 0.85, _clamp(r.d * 0.5, 0.8, 1.4), "wood", c)
    _item(items, "mirror", r.W + 0.06, r.cz, 0.04, 1.1, 0.6, "glass", c - 0.05, y=1.4)
    _item(items, "plant", r.E - 0.3, r.N + 0.3, 0.35, 1.2, 0.35, "plant", c - 0.1)
    _ceiling_light(items, r, c, wh)


def _office(items, r, c, wh):
    _item(items, "desk", r.cx, r.N + 0.4, _clamp(r.w * 0.55, 1.2, 1.8), 0.75, 0.6, "wood", c)
    _item(items, "chair", r.cx, r.N + 0.95, 0.5, 0.95, 0.5, "fabric", c - 0.05)
    _item(items, "storage", r.E - 0.3, r.cz, 0.35, 1.9, _clamp(r.d * 0.6, 1.0, 2.0), "wood", c - 0.04)
    _ceiling_light(items, r, c, wh)


def _stair(items, r, c, wh):
    steps = 8
    run = (r.d - 0.4) / steps
    for k in range(steps):
        h = 0.18 * (k + 1)
        _item(items, "stair_step", r.cx, r.N + 0.2 + run * (k + 0.5), r.w - 0.4, h, run,
              "concrete", c, y=h / 2)
    _ceiling_light(items, r, c, wh)


_PACKS = {
    "bathroom": lambda i, r, c, wh: _bathroom(i, r, c, wh),
    "kitchen": _kitchen,
    "bedroom": lambda i, r, c, wh: _bedroom(i, r, c, wh, master=False),
    "master_bedroom": lambda i, r, c, wh: _bedroom(i, r, c, wh, master=True),
    "living_room": _living,
    "dining": _dining,
    "utility": _utility,
    "garage": _garage,
    "balcony": _balcony,
    "foyer": _foyer,
    "corridor": lambda i, r, c, wh: _ceiling_light(i, r, c, wh),
    "office": _office,
    "staircase": _stair,
    "lift": lambda i, r, c, wh: _ceiling_light(i, r, c, wh),
    "room": _living,      # a generic space still reads as a living area, never empty
}


def furnish_room(room_type: str, cx: float, cz: float, w: float, d: float,
                 confidence: float = 0.85, wall_h: float = 2.7) -> List[Dict]:
    """Return the furniture instances (metres, world space) for one room."""
    if w <= 0.6 or d <= 0.6:
        return []
    r = _Room(cx, cz, w, d)
    items: List[Dict] = []
    conf = max(0.55, min(0.97, confidence))
    if getattr(config, "INCLUDE_FURNITURE", False):
        _PACKS.get(room_type, _PACKS["room"])(items, r, conf, wall_h)
    else:
        _ceiling_light(items, r, conf, wall_h)   # empty building: lighting only, no furniture
    for it in items:
        it["room_type"] = room_type
    return items
