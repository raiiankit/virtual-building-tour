"""Automatic walkthrough route (BRD 10.1 / TOUR-001). Builds a bounding-box-aware
route: approach the building from outside, glide through each room at eye level
(looking toward the next room), then a final exterior view. Fully editable after
(BRD TOUR-002). The viewer smooths these points into a continuous camera path."""


def auto_route(vectors: dict, scale: float, settings: dict | None = None) -> dict:
    settings = settings or {}
    eye = settings.get("eye_height_m", 1.6)
    dwell = settings.get("seconds_per_scene", 3)

    xs, zs = [], []
    for w in vectors.get("walls", []):
        xs += [w["x1"] * scale, w["x2"] * scale]
        zs += [w["y1"] * scale, w["y2"] * scale]
    if xs:
        minx, maxx, minz, maxz = min(xs), max(xs), min(zs), max(zs)
    else:
        minx = maxx = minz = maxz = 0.0
    cx, cz = (minx + maxx) / 2, (minz + maxz) / 2

    scenes = [{"name": "Approach", "kind": "exterior",
               "camera": [minx - 4, eye + 2.5, minz - 4], "look": [cx, eye, cz], "seconds": dwell}]

    pts = [((r["x"] + r["w"] / 2) * scale, (r["y"] + r["h"] / 2) * scale, r.get("name"))
           for r in vectors.get("rooms", [])]
    for i, (rx, rz, name) in enumerate(pts):
        nxt = pts[i + 1][:2] if i + 1 < len(pts) else (cx, cz)
        scenes.append({"name": name or f"Room {i + 1}", "kind": "room",
                       "camera": [rx, eye, rz], "look": [nxt[0], eye, nxt[1]], "seconds": dwell})

    scenes.append({"name": "Final View", "kind": "exterior",
                   "camera": [maxx + 4, eye + 3, maxz + 4], "look": [cx, eye, cz], "seconds": dwell})

    return {"scenes": scenes, "camera_path": [s["camera"] for s in scenes],
            "settings": {"eye_height_m": eye, "seconds_per_scene": dwell}}
