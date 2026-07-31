"""IfcExtractor — IFC (and RVT after an external RVT→IFC convert) via IfcOpenShell.

IFC already *is* a building model, so this is the highest-fidelity path: real walls,
doors, windows, spaces with true dimensions. We project each element's world-coordinate
geometry to the XY plane to get plan footprints, then normalise into the UBM."""
from __future__ import annotations

import math
from typing import Any, Dict, List

from ..base import Extractor, register
from ..models import (UniversalBuildingModel, UBMMetadata, ProjectMeta, Room, Wall, Door,
                       Window, Slab, Floor, Building, Material, ValidationIssue)
from ...services import rooms as room_svc

_STD_MATS = [
    Material(id="m-plaster", name="Matte plaster", kind="plaster", color="#eceae4"),
    Material(id="m-wood", name="Natural wood", kind="wood", color="#9c6b3f"),
    Material(id="m-glass", name="Clear glass", kind="glass", color="#bcd6e6"),
]


@register
class IfcExtractor(Extractor):
    name = "ifc"
    formats = ("ifc", "rvt")          # rvt is converted to ifc upstream (service)

    def extract(self, path: str) -> Dict[str, Any]:
        import ifcopenshell
        model = ifcopenshell.open(path)
        return {"model": model, "path": path}

    def validate(self, raw: Dict[str, Any]) -> List[ValidationIssue]:
        m = raw["model"]
        issues: List[ValidationIssue] = []
        if not m.by_type("IfcWall"):
            issues.append(ValidationIssue(level="warning", code="ifc_no_walls", message="No IfcWall found in the model."))
        if not (m.by_type("IfcSpace") or m.by_type("IfcZone")):
            issues.append(ValidationIssue(level="warning", code="ifc_no_spaces", message="No IfcSpace found — rooms may be incomplete."))
        return issues

    def convert_to_ubm(self, raw: Dict[str, Any], meta: ProjectMeta) -> UniversalBuildingModel:
        import ifcopenshell
        import ifcopenshell.geom
        import ifcopenshell.util.unit as _unit
        f = raw["model"]
        try:
            uscale = _unit.calculate_unit_scale(f)     # model length unit → metres
        except Exception:
            uscale = 1.0
        settings = ifcopenshell.geom.settings()
        try:
            settings.set(settings.USE_WORLD_COORDS, True)
        except Exception:
            pass

        def footprint(el):
            try:
                sh = ifcopenshell.geom.create_shape(settings, el)
                v = sh.geometry.verts
                if not v:
                    return None
                xs = [v[i] * uscale for i in range(0, len(v), 3)]
                ys = [v[i] * uscale for i in range(1, len(v), 3)]
                return (min(xs), min(ys), max(xs), max(ys))
            except Exception:
                return None

        ubm = UniversalBuildingModel(project=meta, materials=list(_STD_MATS))

        for i, sp in enumerate(f.by_type("IfcSpace")):
            fp = footprint(sp)
            name = (getattr(sp, "LongName", None) or getattr(sp, "Name", None) or "Room")
            if not fp:
                continue
            x0, y0, x1, y1 = fp
            ubm.rooms.append(Room(id=f"room-{i + 1}", name=name, type=room_svc.classify(name)[0],
                                  polygon=[[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
                                  area_m2=round((x1 - x0) * (y1 - y0), 2)))

        for i, wl in enumerate(f.by_type("IfcWall")):
            fp = footprint(wl)
            if not fp:
                continue
            x0, y0, x1, y1 = fp
            if (x1 - x0) >= (y1 - y0):
                a, b = [x0, (y0 + y1) / 2], [x1, (y0 + y1) / 2]
            else:
                a, b = [(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.15:
                continue
            th = max(0.08, min(x1 - x0, y1 - y0))
            ubm.walls.append(Wall(id=f"wall-{i + 1}", startPoint=a, endPoint=b, length_m=round(L, 3),
                                  thickness_m=round(min(th, 0.4), 3), exterior=th >= 0.18))

        def opening_dims(el, dw, dh):
            w = getattr(el, "OverallWidth", None)
            h = getattr(el, "OverallHeight", None)
            return (float(w) * uscale if w else dw, float(h) * uscale if h else dh)

        for i, dr in enumerate(f.by_type("IfcDoor")):
            fp = footprint(dr)
            pos = [(fp[0] + fp[2]) / 2, (fp[1] + fp[3]) / 2] if fp else [0.0, 0.0]
            w, h = opening_dims(dr, 0.9, 2.1)
            ubm.doors.append(Door(id=f"door-{i + 1}", position=pos, width_m=round(w, 3), height_m=round(h, 3)))

        for i, wn in enumerate(f.by_type("IfcWindow")):
            fp = footprint(wn)
            pos = [(fp[0] + fp[2]) / 2, (fp[1] + fp[3]) / 2] if fp else [0.0, 0.0]
            w, h = opening_dims(wn, 1.2, 1.2)
            ubm.windows.append(Window(id=f"win-{i + 1}", position=pos, width_m=round(w, 3), height_m=round(h, 3)))

        for i, sl in enumerate(f.by_type("IfcSlab")):
            fp = footprint(sl)
            if fp:
                x0, y0, x1, y1 = fp
                ubm.slabs.append(Slab(id=f"slab-{i + 1}", polygon=[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]))

        pts = [p for r in ubm.rooms for p in r.polygon] + [w.startPoint for w in ubm.walls]
        if pts:
            xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
            bounds = {"minx": min(xs), "minz": min(zs), "maxx": max(xs), "maxz": max(zs)}
        else:
            bounds = None
        storeys = f.by_type("IfcBuildingStorey")
        fc = max(1, len(storeys))
        ubm.building = Building(type="apartment", floor_count=fc)
        ubm.floors = [Floor(level=i, name=(getattr(s, "Name", None) or f"Floor {i + 1}")) for i, s in enumerate(storeys)] or [Floor(level=0, name="Floor 1")]
        ubm.metadata = UBMMetadata(source_format="ifc", extractor=self.name, scale_m_per_unit=uscale,
                                   confidence=0.95, bounds=bounds,
                                   extra={"walls": len(ubm.walls), "spaces": len(ubm.rooms)})
        return ubm
