"""Validation engine. AI/vector output is never trusted directly — the UBM is checked
for geometric and semantic sanity, emitting blocking / warning / info issues that gate
approval (BRD BR-004)."""
from __future__ import annotations

import math

from .models import UniversalBuildingModel, ValidationReport, ValidationIssue


def _dist_seg(p, a, b) -> float:
    dx, dz = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dz * dz or 1.0
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz))


def _centroid(poly):
    xs = [p[0] for p in poly]; zs = [p[1] for p in poly]
    return [sum(xs) / len(xs), sum(zs) / len(zs)]


def validate_ubm(ubm: UniversalBuildingModel) -> ValidationReport:
    issues: list[ValidationIssue] = []
    add = lambda lvl, code, msg, eid=None: issues.append(ValidationIssue(level=lvl, code=code, message=msg, element_id=eid))

    # --- rooms: closed polygon, plausible area ---
    if not ubm.rooms:
        add("blocking", "no_rooms", "No rooms in the model.")
    for r in ubm.rooms:
        if len(r.polygon) < 3:
            add("blocking", "room_open", f"Room '{r.name}' polygon is not closed.", r.id)
        if r.area_m2 and r.area_m2 < 1.0:
            add("warning", "room_tiny", f"Room '{r.name}' area < 1 m² — check scale.", r.id)
        if r.area_m2 > 500:
            add("warning", "room_huge", f"Room '{r.name}' area > 500 m² — check scale.", r.id)

    # --- walls: count, thickness, duplicates/overlap ---
    if len(ubm.walls) < 4:
        add("warning", "few_walls", "Fewer than 4 walls — the shell may not be enclosed.")
    seen = set()
    for w in ubm.walls:
        if not (0.05 <= w.thickness_m <= 0.4):
            add("warning", "wall_thickness", f"Wall {w.id} thickness {w.thickness_m} m out of range.", w.id)
        if w.length_m < 0.15:
            add("info", "wall_short", f"Very short wall {w.id}.", w.id)
        k = (round(w.startPoint[0], 1), round(w.startPoint[1], 1), round(w.endPoint[0], 1), round(w.endPoint[1], 1))
        if k in seen or (k[2], k[3], k[0], k[1]) in seen:
            add("info", "wall_dup", f"Duplicate/overlapping wall {w.id}.", w.id)
        seen.add(k)

    # --- doors/windows must sit on a wall ---
    def on_wall(p):
        return any(_dist_seg(p, w.startPoint, w.endPoint) < max(0.6, w.thickness_m * 3) for w in ubm.walls)
    if ubm.walls:
        for d in ubm.doors:
            if not on_wall(d.position):
                add("warning", "door_off_wall", f"Door {d.id} is not on a wall.", d.id)
        for wd in ubm.windows:
            if not on_wall(wd.position):
                add("warning", "window_off_wall", f"Window {wd.id} is not on a wall.", wd.id)

    # --- connectivity: every room should be reachable (has a door) ---
    for r in ubm.rooms:
        if r.type in ("balcony", "corridor", "foyer"):
            continue
        if not r.doors:
            add("info", "room_no_door", f"Room '{r.name}' has no door linked.", r.id)

    # --- balcony / lift connectivity ---
    for b in ubm.balconies:
        if not b.connectedRooms:
            add("info", "balcony_unlinked", f"Balcony {b.id} is not linked to a room.", b.id)

    # --- rooms needing review (BRD/Step 9): low confidence or estimated shape ---
    for r in ubm.rooms:
        if r.confidence < 0.9 or r.status in ("estimated", "unknown"):
            add("info", "room_review",
                f"Room '{r.name}' is {int(r.confidence * 100)}% confident ({r.status}) — verify its name and shape.", r.id)

    # --- scale sanity from footprint ---
    bd = ubm.metadata.bounds
    if bd:
        span = max(bd["maxx"] - bd["minx"], bd["maxz"] - bd["minz"])
        if span < 2:
            add("warning", "scale_small", f"Building spans only {span:.1f} m — the scale is likely wrong.")
        elif span > 200:
            add("warning", "scale_large", f"Building spans {span:.0f} m — the scale is likely wrong.")

    blocking = sum(1 for i in issues if i.level == "blocking")
    warnings = sum(1 for i in issues if i.level == "warning")
    return ValidationReport(ok=blocking == 0, blocking=blocking, warnings=warnings, issues=issues)
