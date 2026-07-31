"""Minimal binary glTF (.glb) writer — pure standard library (struct/json), no
external 3D dependency. Builds boxes/prisms grouped into material primitives
(e.g. matte walls, semi-reflective floor, dark baseboards) so the browser gets a
building that reads as real, not flat-shaded blocks.

For higher fidelity later, swap this for Blender's Python API (BRD 9 / Phase 4)."""
import json
import struct
from typing import List, Tuple

Vec3 = Tuple[float, float, float]

# 6 quad faces of an 8-corner prism (bottom b0..b3, top t0..t3). Each face is
# emitted with its own 4 vertices + a flat face normal so surfaces shade crisply
# (a shared-vertex mesh with no normals renders flat/black in most WebGL viewers).
_FACE_QUADS = [
    (0, 3, 2, 1),           # bottom (-Y)
    (4, 5, 6, 7),           # top (+Y)
    (0, 1, 5, 4),           # side
    (1, 2, 6, 5),           # side
    (2, 3, 7, 6),           # side
    (3, 0, 4, 7),           # side
]


def _face_normal(p0: Vec3, p1: Vec3, p2: Vec3) -> Vec3:
    """Unit normal of the plane through three corners (cross product)."""
    ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
    vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
    nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
    length = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1e-9
    return nx / length, ny / length, nz / length


def aabb(center: Vec3, size: Vec3) -> List[Vec3]:
    """8 corners of an axis-aligned box."""
    cx, cy, cz = center
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    y0, y1 = cy - sy, cy + sy
    quad = [(cx - sx, cz - sz), (cx + sx, cz - sz), (cx + sx, cz + sz), (cx - sx, cz + sz)]
    return [(x, y0, z) for x, z in quad] + [(x, y1, z) for x, z in quad]


def seg_prism(p1, p2, thickness: float, y0: float, y1: float) -> List[Vec3]:
    """8 corners of a wall running from p1=(x,z) to p2=(x,z) with given thickness."""
    x1, z1 = p1
    x2, z2 = p2
    dx, dz = x2 - x1, z2 - z1
    length = (dx * dx + dz * dz) ** 0.5 or 1e-6
    nx, nz = -dz / length, dx / length
    h = thickness / 2
    bottom = [
        (x1 + nx * h, z1 + nz * h), (x2 + nx * h, z2 + nz * h),
        (x2 - nx * h, z2 - nz * h), (x1 - nx * h, z1 - nz * h),
    ]
    return [(x, y0, z) for x, z in bottom] + [(x, y1, z) for x, z in bottom]


def boxes_to_arrays(boxes: List[List[Vec3]]):
    """Flatten a list of 8-corner boxes into (positions, normals, indices) with
    per-face flat normals — each of the 6 faces gets its own 4 vertices."""
    positions: List[float] = []
    normals: List[float] = []
    indices: List[int] = []
    for corners in boxes:
        for quad in _FACE_QUADS:
            c0, c1, c2, c3 = (corners[q] for q in quad)
            nx, ny, nz = _face_normal(c0, c1, c2)
            base = len(positions) // 3
            for (x, y, z) in (c0, c1, c2, c3):
                positions += [x, y, z]
                normals += [nx, ny, nz]
            indices += [base, base + 1, base + 2, base, base + 2, base + 3]
    return positions, normals, indices


def build_glb(primitives: List[dict]) -> bytes:
    """primitives: list of {"positions", "indices", "material": {baseColorFactor,
    roughnessFactor, metallicFactor}}. Returns .glb bytes with one material each."""
    primitives = [p for p in primitives if p.get("positions")]
    if not primitives:
        pos, nor, idx = boxes_to_arrays([aabb((0, 0.5, 0), (1, 1, 1))])
        primitives = [{"positions": pos, "normals": nor, "indices": idx,
                       "material": {"baseColorFactor": [0.8, 0.8, 0.8, 1]}}]

    buffer = bytearray()
    bufferViews, accessors, materials, prim_defs = [], [], [], []

    def add_view(blob: bytes, target: int) -> int:
        while len(buffer) % 4:
            buffer.append(0)
        off = len(buffer)
        buffer.extend(blob)
        bufferViews.append({"buffer": 0, "byteOffset": off, "byteLength": len(blob), "target": target})
        return len(bufferViews) - 1

    for p in primitives:
        pos, idx = p["positions"], p["indices"]
        nor = p.get("normals")
        iv = add_view(struct.pack(f"<{len(idx)}I", *idx), 34963)
        pv = add_view(struct.pack(f"<{len(pos)}f", *pos), 34962)
        xs, ys, zs = pos[0::3], pos[1::3], pos[2::3]
        ia = len(accessors)
        accessors.append({"bufferView": iv, "componentType": 5125, "count": len(idx), "type": "SCALAR"})
        pa = len(accessors)
        accessors.append({"bufferView": pv, "componentType": 5126, "count": len(pos) // 3,
                          "type": "VEC3", "min": [min(xs), min(ys), min(zs)],
                          "max": [max(xs), max(ys), max(zs)]})
        attributes = {"POSITION": pa}
        if nor:                                       # per-face normals → real shading
            nv = add_view(struct.pack(f"<{len(nor)}f", *nor), 34962)
            na = len(accessors)
            accessors.append({"bufferView": nv, "componentType": 5126,
                              "count": len(nor) // 3, "type": "VEC3"})
            attributes["NORMAL"] = na
        m = p["material"]
        mi = len(materials)
        mat = {"pbrMetallicRoughness": {
            "baseColorFactor": m.get("baseColorFactor", [1, 1, 1, 1]),
            "metallicFactor": m.get("metallicFactor", 0.0),
            "roughnessFactor": m.get("roughnessFactor", 0.9)}, "doubleSided": True}
        if m.get("alphaMode"):                       # glass windows / railings
            mat["alphaMode"] = m["alphaMode"]
        if m.get("emissiveFactor"):                  # glowing light fixtures
            mat["emissiveFactor"] = m["emissiveFactor"]
        materials.append(mat)
        prim_defs.append({"attributes": attributes, "indices": ia, "material": mi, "mode": 4})

    gltf = {
        "asset": {"version": "2.0", "generator": "vbt-glb-0.3-normals"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": prim_defs}],
        "materials": materials,
        "buffers": [{"byteLength": len(buffer)}],
        "bufferViews": bufferViews, "accessors": accessors,
    }
    json_blob = json.dumps(gltf).encode()
    json_blob += b" " * ((4 - len(json_blob) % 4) % 4)
    bin_blob = bytes(buffer) + b"\x00" * ((4 - len(buffer) % 4) % 4)
    total = 12 + 8 + len(json_blob) + 8 + len(bin_blob)
    out = struct.pack("<III", 0x46546C67, 2, total)
    out += struct.pack("<II", len(json_blob), 0x4E4F534A) + json_blob
    out += struct.pack("<II", len(bin_blob), 0x004E4942) + bin_blob
    return out
