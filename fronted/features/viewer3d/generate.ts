import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeMaterial, FLOOR_KIND, type SurfaceKind } from "./materials";
import { partitionFloor, mergeColinear, type PSeg, type FloorPlan } from "./partition";
import type { SceneManifest } from "@/types";

/* --------------------------- construction constants ---------------------- */
// BRD "STANDARD DIMENSIONS" (all metres) — architectural defaults, not visual guesses
const EXT_TH = 0.2;      // exterior wall 200 mm
const INT_TH = 0.12;     // interior wall 120 mm
const SLAB_TH = 0.15;    // floor slab 150 mm
const SKIRT_H = 0.1;     // skirting 100 mm
const DOOR_H = 2.1;      // door height 2100 mm
const LEAF_TH = 0.045;
const RAIL_H = 1.1;      // balcony railing 1100 mm

type V2 = [number, number];
const dist = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Box geometry aligned to a wall segment a→b (world XZ), height y0..y1. */
function segBox(a: V2, b: V2, th: number, y0: number, y1: number): THREE.BufferGeometry {
  const len = dist(a, b); if (len < 1e-3) return new THREE.BoxGeometry(0.001, 0.001, 0.001);
  const g = new THREE.BoxGeometry(len, y1 - y0, th);
  // repeat UV along length so textures never stretch on long walls
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * Math.max(1, len));
  uv.needsUpdate = true;
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const rotY = Math.atan2(-dz, dx);
  const m = new THREE.Matrix4().makeRotationY(rotY);
  m.setPosition((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2);
  g.applyMatrix4(m);
  return g;
}

interface Opening { p: V2; half: number; kind: "door" | "window" }

/** Split a wall around openings → kept sub-segments (gaps at each opening). */
function splitWall(a: V2, b: V2, openings: Opening[]): V2[][] {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1e-9;
  const hits: { t: number; g: number }[] = [];
  for (const op of openings) {
    const t = ((op.p[0] - a[0]) * dx + (op.p[1] - a[1]) * dz) / (L * L);
    if (t <= 0.04 || t >= 0.96) continue;
    const cx = a[0] + t * dx, cz = a[1] + t * dz;
    if (Math.hypot(op.p[0] - cx, op.p[1] - cz) < 0.6) hits.push({ t, g: op.half / L });
  }
  hits.sort((p, q) => p.t - q.t);
  const kept: [number, number][] = []; let cursor = 0;
  for (const h of hits) {
    const lo = Math.max(0, h.t - h.g), hi = Math.min(1, h.t + h.g);
    if (lo > cursor + 1e-3) kept.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < 1 - 1e-3) kept.push([cursor, 1]);
  return kept
    .map(([k0, k1]): V2[] => [[a[0] + k0 * dx, a[1] + k0 * dz], [a[0] + k1 * dx, a[1] + k1 * dz]])
    .filter((s) => dist(s[0], s[1]) > 0.06);
}

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material, rotY = 0, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z); m.rotation.y = rotY; m.castShadow = cast; m.receiveShadow = true;
  return m;
}

type Rect = [number, number, number, number];   // [x0,z0,x1,z1]

/** Split a slab rectangle into up to 4 strips around an optional stairwell hole. */
function slabRects(x0: number, z0: number, x1: number, z1: number, hole: Rect | null): Rect[] {
  if (!hole) return [[x0, z0, x1, z1]];
  const hx0 = Math.max(x0, hole[0]), hz0 = Math.max(z0, hole[1]), hx1 = Math.min(x1, hole[2]), hz1 = Math.min(z1, hole[3]);
  if (hx0 >= hx1 || hz0 >= hz1) return [[x0, z0, x1, z1]];   // hole misses slab → solid
  const out: Rect[] = [];
  if (hz0 > z0) out.push([x0, z0, x1, hz0]);                 // south strip
  if (hz1 < z1) out.push([x0, hz1, x1, z1]);                 // north strip
  if (hx0 > x0) out.push([x0, hz0, hx0, hz1]);               // west strip
  if (hx1 < x1) out.push([hx1, hz0, x1, hz1]);               // east strip
  return out;
}

/** Bounding rect of a set of room rects, or null if empty. */
function footprintOf(rects: Rect[]): Rect | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [a, b, c, d] of rects) { x0 = Math.min(x0, a); z0 = Math.min(z0, b); x1 = Math.max(x1, c); z1 = Math.max(z1, d); }
  return x0 < x1 && z0 < z1 ? [x0, z0, x1, z1] : null;
}

/** Build a thin bar mesh spanning two arbitrary points (used for the raked stair handrail —
 *  a straight box rotated to point from p0 to p1, so a sloped rail is just as easy as a level one). */
function bar(p0: THREE.Vector3, p1: THREE.Vector3, thick: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length() || 1e-4;
  const m = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), mat);
  m.position.copy(p0).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
  m.castShadow = true;
  return m;
}

// Realistic single-flight residential stair width (BRD-style constant, metres) — building-code
// minimums run ~0.9-1.1 m, a comfortable/nice flight ~1.2-1.5 m. Declared "staircase" rooms in
// user JSON are often sized like any other room (3-4 m), which would otherwise render as an
// oversized, blocky slab — so the flight's width is always clamped to this regardless of the
// room's declared footprint, and centered within it rather than stretched to fill it.
const MAX_STAIR_WIDTH = 1.4;

/** A straight stair flight rising baseY → baseY+floorH, its width clamped to a realistic
 *  size and centered within `foot` (an oversized declared staircase room just gives the
 *  flight more headroom around it, instead of making the flight itself absurdly wide).
 *  Each step is added to walkSurfaces so the walker's gravity raycast climbs it. A simple
 *  sloped handrail (posts + raked top rail) is added along both open edges for realism —
 *  it's visual only (not pushed into collidables/walkSurfaces), so it can't affect movement. */
function buildStairFlight(foot: Rect, baseY: number, floorH: number, mat: THREE.Material, group: THREE.Group, walkSurfaces: THREE.Mesh[], railMat?: THREE.Material) {
  const [fx0, fz0, fx1, fz1] = foot;
  const fw = fx1 - fx0, fd = fz1 - fz0;
  const alongZ = fd >= fw;                 // run along the longer axis
  const margin = 0.12;
  const runLen = (alongZ ? fd : fw) - 2 * margin;
  const width = Math.min((alongZ ? fw : fd) - 2 * margin, MAX_STAIR_WIDTH);
  if (runLen < 0.8 || width < 0.5) return;
  // Step count is derived from the actual floor-to-floor height rather than fixed, so the
  // riser stays close to a comfortable ~0.18 m regardless of how tall the JSON declares the
  // floor to be (a hardcoded step count would make short floors have oddly deep risers, and
  // tall floors have unrealistically tall ones) — rounded to a whole number of steps so the
  // flight's total rise still exactly reaches floorH.
  const TARGET_RISE = 0.18;
  const steps = Math.max(3, Math.round(floorH / TARGET_RISE));
  const rise = floorH / steps, tread = runLen / steps;
  const perp = alongZ ? (fx0 + fx1) / 2 : (fz0 + fz1) / 2;   // centre of the full footprint's cross-axis —
                                                              // the clamped-width flight is built symmetric
                                                              // around this, so it centers in an oversized room
  const start = (alongZ ? fz0 : fx0) + margin;
  for (let k = 0; k < steps; k++) {
    const h = rise * (k + 1);              // solid stringer: each step spans the floor up to its tread
    const cAlong = start + tread * (k + 0.5);
    const m = box(alongZ ? width : tread, h, alongZ ? tread : width,
                  alongZ ? perp : cAlong, baseY + h / 2, alongZ ? cAlong : perp, mat);
    group.add(m); walkSurfaces.push(m);
  }

  if (railMat) {
    const railH = 0.95;
    for (const side of [-1, 1]) {
      const off = perp + side * (width / 2 - 0.03);
      let prevTop: THREE.Vector3 | null = null;
      for (let k = 0; k <= steps; k++) {
        const h = rise * k;
        const cAlong = start + tread * k;
        const px = alongZ ? off : cAlong, pz = alongZ ? cAlong : off;
        const top = new THREE.Vector3(px, baseY + h + railH, pz);
        group.add(box(0.04, railH, 0.04, px, baseY + h + railH / 2, pz, railMat));
        if (prevTop) group.add(bar(prevTop, top, 0.035, railMat));
        prevTop = top;
      }
    }
  }
}

/* ------------------------------ door / window ---------------------------- */
function buildDoor(pos: V2, orient: string, width: number, wallH: number, glass: boolean,
                   mats: Record<string, THREE.Material>): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos[0], 0, pos[1]);
  g.rotation.y = orient === "h" ? 0 : Math.PI / 2;   // local +X runs along the wall
  const w = width;
  // frame: two posts + lintel (oak)
  g.add(box(0.07, DOOR_H, 0.16, -w / 2, DOOR_H / 2, 0, mats.frame));
  g.add(box(0.07, DOOR_H, 0.16, w / 2, DOOR_H / 2, 0, mats.frame));
  g.add(box(w + 0.14, wallH - DOOR_H, 0.16, 0, (DOOR_H + wallH) / 2, 0, mats.frame));
  // leaf hinged on the left post, only slightly ajar so it stays in the opening
  const pivot = new THREE.Group(); pivot.position.set(-w / 2 + 0.03, DOOR_H / 2, 0); pivot.rotation.y = glass ? 0 : -0.32;
  const leaf = box(w - 0.08, DOOR_H - 0.06, LEAF_TH, (w - 0.08) / 2, 0, 0, glass ? mats.glass : mats.door);
  pivot.add(leaf);
  if (!glass) pivot.add(box(0.035, 0.16, 0.05, w - 0.2, 0.02, 0.05, mats.handle)); // handle
  g.add(pivot);
  return g;
}

function buildWindow(pos: V2, orient: string, len: number, sill: number, head: number,
                     mats: Record<string, THREE.Material>): THREE.Group {
  const g = new THREE.Group();
  g.position.set(pos[0], 0, pos[1]);
  g.rotation.y = orient === "h" ? 0 : Math.PI / 2;
  const h = head - sill;
  g.add(box(len, 0.05, 0.14, 0, sill, 0, mats.alu));           // sill bar
  g.add(box(len, 0.05, 0.14, 0, head, 0, mats.alu));           // head bar
  g.add(box(0.05, h, 0.14, -len / 2, sill + h / 2, 0, mats.alu));
  g.add(box(0.05, h, 0.14, len / 2, sill + h / 2, 0, mats.alu));
  g.add(box(0.04, h, 0.14, 0, sill + h / 2, 0, mats.alu));     // mullion
  g.add(box(len - 0.1, h - 0.1, 0.02, 0, sill + h / 2, 0, mats.glass, 0, false)); // glass
  g.add(box(len + 0.12, 0.06, 0.28, 0, sill - 0.03, 0.06, mats.sill));            // sill ledge
  return g;
}

/* ------------------------------ main builder ----------------------------- */
export interface Built {
  group: THREE.Group; collidables: THREE.Mesh[]; levelGroups: THREE.Group[]; roof: THREE.Group;
  rooms: { name: string; type: string; cx: number; cz: number; w: number; d: number }[];
  bounds: THREE.Box3; center: THREE.Vector3; size: THREE.Vector3; floorTop: number; wallHeight: number;
  ceilings: THREE.Object3D[]; walkSurfaces: THREE.Mesh[];
}

export function buildArchitecture(manifest: SceneManifest, opts: { ceilings: boolean; wallColor?: string; facadeColor?: string }): Built {
  const wallH = manifest.wall_height_m || 2.9;
  const floorH = manifest.floor_height_m || 3.0;
  const levels = manifest.levels || 1;

  // Optional style overrides (used by the JSON→3D portal's "Style" panel). The
  // shared makeMaterial() cache is app-wide, so any recolor MUST clone first —
  // mutating the cached instance would silently recolor the main viewer too.
  const plasterMat = opts.wallColor
    ? (makeMaterial("plaster").clone() as THREE.MeshStandardMaterial)
    : (makeMaterial("plaster") as THREE.MeshStandardMaterial);
  if (opts.wallColor) plasterMat.color.set(opts.wallColor);
  const facadeMat = opts.facadeColor
    ? (makeMaterial("facade").clone() as THREE.MeshStandardMaterial)
    : (makeMaterial("facade") as THREE.MeshStandardMaterial);
  if (opts.facadeColor) facadeMat.color.set(opts.facadeColor);

  const mats = {
    plaster: plasterMat, facade: facadeMat, skirting: makeMaterial("skirting"),
    frame: makeMaterial("door_frame"), door: makeMaterial("wood_door"),
    handle: makeMaterial("brass"), alu: makeMaterial("aluminium"),
    glass: makeMaterial("glass"), sill: makeMaterial("skirting"),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xf3f2ee, roughness: 0.96, side: THREE.DoubleSide }),
    railTop: makeMaterial("aluminium"),
  };
  (mats.plaster as THREE.MeshStandardMaterial).side = THREE.DoubleSide;

  const group = new THREE.Group();
  const levelGroups: THREE.Group[] = [];   // one group per floor → toggle floor visibility
  const collidables: THREE.Mesh[] = [];
  const ceilings: THREE.Object3D[] = [];
  const walkSurfaces: THREE.Mesh[] = [];   // floors + stair treads the walker stands on (gravity raycast)
  const stairMat = makeMaterial("concrete");
  const isStair = (t: string) => t === "staircase" || t === "lift";

  // Precompute every level's plan + its staircase room's nominal (unclipped) footprint up
  // front. This lets a stair flight built on floor `lvl` and the hole punched in floor
  // `lvl+1`'s slab be reconciled to the SAME rect (see intersectFoot below) even when the
  // JSON declares slightly different center/size for the "staircase" room on consecutive
  // floors — without this, the flight and the hole it needs to rise through could be sized
  // from two different declarations and end up misaligned (a flight that floats short of, or
  // pokes past, the opening above it).
  const plans: FloorPlan[] = [];
  const stairFeet: (Rect | null)[] = [];
  for (let lvl = 0; lvl < levels; lvl++) {
    const plan = partitionFloor(manifest, lvl, 0.3);
    plans.push(plan);
    const stairRoomPlan = plan.rooms.find((r) => isStair(r.type));
    stairFeet.push(
      stairRoomPlan
        ? (() => {
            const raw = (manifest.rooms ?? []).filter((r) => r.level === lvl)[stairRoomPlan.index];
            if (raw) {
              const [cx, cz] = stairRoomPlan.center, [w, d] = raw.size;
              return [cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2] as Rect;
            }
            return footprintOf(stairRoomPlan.rects);
          })()
        : null,
    );
  }
  /** Overlap of two adjoining floors' declared stair footprints — used for both the flight
   *  (built on the lower floor) and the hole (punched in the upper floor's slab) so they
   *  always match exactly. Falls back to whichever footprint exists if they don't overlap
   *  (e.g. one floor's staircase room drifted away from the other's) rather than dropping
   *  the stair entirely. */
  const intersectFoot = (a: Rect | null, b: Rect | null): Rect | null => {
    if (!a || !b) return a ?? b;
    const x0 = Math.max(a[0], b[0]), z0 = Math.max(a[1], b[1]), x1 = Math.min(a[2], b[2]), z1 = Math.min(a[3], b[3]);
    return x0 < x1 && z0 < z1 ? [x0, z0, x1, z1] : a;
  };

  const manifestWindows = manifest.windows ?? [];
  const entrance = (manifest.doors ?? []).find((d) => (d as { entrance?: boolean }).entrance);
  const sill = manifest.win_sill ?? 0.9, head = manifest.win_head ?? 2.1;

  // snap a point onto the nearest of a given wall set (used for windows + entrance)
  const distToSeg = (p: V2, a: V2, b: V2) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
  };
  const snapTo = (p: V2, segs: PSeg[], tol: number): { pos: V2; orient: string } | null => {
    let best: PSeg | null = null, bd = Infinity;
    for (const w of segs) { const d = distToSeg(p, w.a, w.b); if (d < bd) { bd = d; best = w; } }
    if (!best || bd > tol) return null;
    const dx = best.b[0] - best.a[0], dz = best.b[1] - best.a[1], l2 = dx * dx + dz * dz || 1;
    let t = ((p[0] - best.a[0]) * dx + (p[1] - best.a[1]) * dz) / l2; t = Math.max(0.08, Math.min(0.92, t));
    return { pos: [best.a[0] + t * dx, best.a[1] + t * dz], orient: Math.abs(dx) >= Math.abs(dz) ? "h" : "v" };
  };
  const dedupe = <T extends { pos: V2 }>(items: T[], r: number): T[] => {
    const kept: T[] = [];
    for (const it of items) if (!kept.some((k) => Math.hypot(k.pos[0] - it.pos[0], k.pos[1] - it.pos[1]) < r)) kept.push(it);
    return kept;
  };

  const outRooms: Built["rooms"] = [];

  for (let lvl = 0; lvl < levels; lvl++) {
    const baseY = lvl * floorH;
    const plan = plans[lvl];
    if (!plan.rooms.length) continue;
    const levelGroup = new THREE.Group();
    levelGroup.userData.level = lvl;
    const { x0, z0, x1, z1 } = plan.bounds;
    const walls = mergeColinear(plan.walls);          // clean long wall runs
    const extWalls = walls.filter((w) => w.exterior);
    // Footprint for the flight rising FROM this floor TO the one above, and the hole
    // punched in THIS floor's own slab for the flight rising from the floor below —
    // each is the overlap of the two adjoining floors' declared stair footprints (see
    // intersectFoot above), so a flight and the hole it passes through always match.
    const stairFootUp = lvl < levels - 1 ? intersectFoot(stairFeet[lvl], stairFeet[lvl + 1]) : null;
    const stairFootDown = lvl >= 1 ? intersectFoot(stairFeet[lvl - 1], stairFeet[lvl]) : null;

    // entrance door on the exterior — ground floor only. A multi-storey building's
    // upper floors share roughly the same footprint as the ground floor, so without
    // this the same entrance position would re-snap onto every floor's exterior wall,
    // stamping a "front door" several metres up with no way to reach it from outside.
    // Windows snapped onto the exterior shell but never on top of a door (the entrance
    // often snaps to the same wall spot as a window).
    const ent = (entrance && lvl === 0) ? snapTo(entrance.pos as V2, extWalls, 3.0) : null;
    // an interior doorway can land right next to the entrance (imprecise/overlapping room
    // boxes in real extraction data put a doorway and the entrance within a metre of each
    // other) — drop those interior doorways so we don't draw two overlapping door assemblies
    // stacked at slightly different angles in the same corner.
    const doorwaysUse = plan.doorways.filter(
      (d) => !ent || Math.hypot(d.pos[0] - ent.pos[0], d.pos[1] - ent.pos[1]) > 1.6,
    );
    const doorFoot: { p: V2; half: number }[] = [
      ...doorwaysUse.map((d) => ({ p: d.pos, half: 0.55 })),
      ...(ent ? [{ p: ent.pos, half: 0.65 }] : []),
    ];
    const winUse = dedupe(
      manifestWindows
        .map((w) => { const s = snapTo(w.pos as V2, extWalls, 2.2); return s ? { pos: s.pos, orient: s.orient, len: Math.min((w as { len?: number }).len ?? 1.5, 2.6) } : null; })
        .filter((w): w is { pos: V2; orient: string; len: number } => !!w),
      1.4,
    ).filter((w) => !doorFoot.some((d) => Math.hypot(d.p[0] - w.pos[0], d.p[1] - w.pos[1]) < d.half + w.len / 2 + 0.1));

    const openings: Opening[] = [
      ...doorwaysUse.map((d): Opening => ({ p: d.pos, half: 0.52, kind: "door" })),
      ...(ent ? [{ p: ent.pos, half: 0.62, kind: "door" } as Opening] : []),
      ...winUse.map((w): Opening => ({ p: w.pos, half: w.len / 2 + 0.04, kind: "window" })),
    ];

    // ---- walls (merged) + skirting (merged); exterior gets the textured facade ----
    const intGeoms: THREE.BufferGeometry[] = [];
    const extGeoms: THREE.BufferGeometry[] = [];
    const skirtGeoms: THREE.BufferGeometry[] = [];
    for (const w of walls) {
      const th = w.exterior ? EXT_TH : INT_TH;
      const bucket = w.exterior ? extGeoms : intGeoms;
      for (const s of splitWall(w.a, w.b, openings)) {
        bucket.push(segBox(s[0], s[1], th, baseY, baseY + wallH));
        skirtGeoms.push(segBox(s[0], s[1], th + 0.02, baseY, baseY + SKIRT_H));
      }
      // window openings: fill wall below the sill and above the head
      for (const o of openings) {
        if (o.kind !== "window") continue;
        const t = ((o.p[0] - w.a[0]) * (w.b[0] - w.a[0]) + (o.p[1] - w.a[1]) * (w.b[1] - w.a[1])) / (dist(w.a, w.b) ** 2 || 1);
        if (t <= 0.04 || t >= 0.96) continue;
        const cx = w.a[0] + t * (w.b[0] - w.a[0]), cz = w.a[1] + t * (w.b[1] - w.a[1]);
        if (Math.hypot(o.p[0] - cx, o.p[1] - cz) > 0.6) continue;
        const dir: V2 = [w.b[0] - w.a[0], w.b[1] - w.a[1]];
        const L = Math.hypot(dir[0], dir[1]) || 1; dir[0] /= L; dir[1] /= L;
        const a: V2 = [cx - dir[0] * o.half, cz - dir[1] * o.half];
        const b: V2 = [cx + dir[0] * o.half, cz + dir[1] * o.half];
        bucket.push(segBox(a, b, th, baseY, baseY + sill));
        bucket.push(segBox(a, b, th, baseY + head, baseY + wallH));
      }
    }
    for (const [geoms, mat] of [[intGeoms, mats.plaster], [extGeoms, mats.facade]] as const) {
      if (!geoms.length) continue;
      const wallMesh = new THREE.Mesh(mergeGeometries(geoms, false)!, mat);
      wallMesh.castShadow = true; wallMesh.receiveShadow = true; wallMesh.userData.collidable = true;
      levelGroup.add(wallMesh); collidables.push(wallMesh);
    }
    if (skirtGeoms.length) { const sm = new THREE.Mesh(mergeGeometries(skirtGeoms, false)!, mats.skirting); sm.receiveShadow = true; levelGroup.add(sm); }

    // ---- base slab across the footprint (walls sit on it); punched at the stairwell on
    //      upper floors so the flight below emerges through it. Each piece is walkable. ----
    for (const [bx0, bz0, bx1, bz1] of slabRects(x0, z0, x1, z1, stairFootDown)) {
      const bw = bx1 - bx0, bd = bz1 - bz0; if (bw < 0.02 || bd < 0.02) continue;
      const base = box(bw, SLAB_TH, bd, (bx0 + bx1) / 2, baseY - SLAB_TH / 2, (bz0 + bz1) / 2, stairMat, 0, false);
      levelGroup.add(base); walkSurfaces.push(base);
    }

    // ---- per-room floor finishes (clean, non-overlapping) + one merged ceiling ----
    const ceilGeoms: THREE.BufferGeometry[] = [];
    plan.rooms.forEach((pr, i) => {
      if (lvl >= 1 && isStair(pr.type)) return;   // open stairwell shaft — no floor sealing the hole
      const kind = (FLOOR_KIND[pr.mat || "tile"] ?? "tile") as SurfaceKind;
      const fmat = makeMaterial(kind) as THREE.MeshStandardMaterial;
      if (fmat.map) { const mm = fmat.map.clone(); mm.wrapS = mm.wrapT = THREE.RepeatWrapping; mm.repeat.set(1, 1); mm.needsUpdate = true; fmat.map = mm; }
      fmat.polygonOffset = true; fmat.polygonOffsetFactor = -1; fmat.polygonOffsetUnits = -1;

      const floorGeoms: THREE.BufferGeometry[] = [];
      let ax0 = Infinity, az0 = Infinity, ax1 = -Infinity, az1 = -Infinity;
      for (const [rx0, rz0, rx1, rz1] of pr.rects) {
        const w = rx1 - rx0, d = rz1 - rz0; if (w < 0.05 || d < 0.05) continue;
        ax0 = Math.min(ax0, rx0); az0 = Math.min(az0, rz0); ax1 = Math.max(ax1, rx1); az1 = Math.max(az1, rz1);
        const fg = new THREE.PlaneGeometry(w, d); fg.rotateX(-Math.PI / 2); fg.translate((rx0 + rx1) / 2, 0, (rz0 + rz1) / 2);
        const pos = fg.attributes.position as THREE.BufferAttribute, uv = fg.attributes.uv as THREE.BufferAttribute;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, pos.getX(k) / 1.4, pos.getZ(k) / 1.4);  // world-aligned tiling
        uv.needsUpdate = true; floorGeoms.push(fg);
        const cg = new THREE.PlaneGeometry(w, d); cg.rotateX(Math.PI / 2); cg.translate((rx0 + rx1) / 2, 0, (rz0 + rz1) / 2); ceilGeoms.push(cg);
      }
      if (!floorGeoms.length) return;
      const slab = new THREE.Mesh(mergeGeometries(floorGeoms, false)!, fmat);
      slab.position.y = baseY + 0.004 + i * 0.0008; slab.receiveShadow = true; levelGroup.add(slab);

      if (lvl === 0) outRooms.push({ name: pr.name, type: pr.type, cx: (ax0 + ax1) / 2, cz: (az0 + az1) / 2, w: ax1 - ax0, d: az1 - az0 });

      if (pr.type === "balcony") {
        const edges: [V2, V2][] = [[[ax0, az0], [ax1, az0]], [[ax1, az0], [ax1, az1]], [[ax1, az1], [ax0, az1]]];
        for (const [a, b] of edges) {
          const gp = new THREE.Mesh(segBox(a, b, 0.03, baseY + 0.05, baseY + RAIL_H), mats.glass); levelGroup.add(gp);
          const rl = new THREE.Mesh(segBox(a, b, 0.06, baseY + RAIL_H, baseY + RAIL_H + 0.06), mats.railTop); rl.castShadow = true; levelGroup.add(rl); collidables.push(rl);
        }
      }
    });
    if (ceilGeoms.length) {
      const cm = new THREE.Mesh(mergeGeometries(ceilGeoms, false)!, mats.ceiling);
      cm.position.y = baseY + wallH - 0.02; cm.receiveShadow = true; cm.visible = opts.ceilings;
      levelGroup.add(cm); ceilings.push(cm);
    }

    // ---- doors (interior doorways + a wider entrance) — not collidable so doorways stay walkable ----
    // Stairwell/lift-adjacent doorways stay as plain open archways (no swinging leaf) — the
    // opening itself is still cut into the wall via `openings` above, so the passage is walkable,
    // but a normal hinged leaf here would swing straight into the open stairwell void or the
    // stair treads themselves rather than into an ordinary room.
    for (const d of doorwaysUse) {
      if (d.stair) continue;
      const g = buildDoor(d.pos, d.orient, 0.9, wallH, false, mats); g.position.y = baseY; levelGroup.add(g);
    }
    if (ent) { const g = buildDoor(ent.pos, ent.orient, 1.1, wallH, false, mats); g.position.y = baseY; levelGroup.add(g); }
    for (const wd of winUse) { const g = buildWindow(wd.pos, wd.orient, wd.len, sill, head, mats); g.position.y = baseY; levelGroup.add(g); }

    // ---- a real, climbable staircase up to the next floor (through the stairwell hole) ----
    if (stairFootUp) buildStairFlight(stairFootUp, baseY, floorH, stairMat, levelGroup, walkSurfaces, mats.alu);

    group.add(levelGroup); levelGroups.push(levelGroup);
  }

  // ---- roof: slab + parapet + a stair/lift overrun (gives a finished exterior) ----
  const roof = new THREE.Group();
  const fpts: V2[] = [];
  for (const w of manifest.walls ?? []) fpts.push(w.a as V2, w.b as V2);
  if (fpts.length) {
    const fx0 = Math.min(...fpts.map((p) => p[0])), fx1 = Math.max(...fpts.map((p) => p[0]));
    const fz0 = Math.min(...fpts.map((p) => p[1])), fz1 = Math.max(...fpts.map((p) => p[1]));
    const fw = fx1 - fx0, fd = fz1 - fz0, cx = (fx0 + fx1) / 2, cz = (fz0 + fz1) / 2;
    const roofTop = (levels - 1) * floorH + wallH;
    roof.add(box(fw + EXT_TH, SLAB_TH, fd + EXT_TH, cx, roofTop + SLAB_TH / 2, cz, mats.plaster));  // slab
    const py0 = roofTop + SLAB_TH, py1 = py0 + 0.9;                                                 // 0.9 m parapet
    const edges: [V2, V2][] = [[[fx0, fz0], [fx1, fz0]], [[fx1, fz0], [fx1, fz1]], [[fx1, fz1], [fx0, fz1]], [[fx0, fz1], [fx0, fz0]]];
    for (const [a, b] of edges) { const m = new THREE.Mesh(segBox(a, b, EXT_TH, py0, py1), mats.facade); m.castShadow = m.receiveShadow = true; roof.add(m); }
    // Stair/lift roof overrun (the little housing real buildings have where the top stair
    // flight pokes through the roof) — only added when a staircase/lift actually reaches the
    // top floor, and sized + positioned from ITS real footprint. Previously this was added
    // unconditionally at the building's overall centre sized to ~30% of the whole footprint,
    // regardless of where (or whether) a staircase existed — so a building with its stairs
    // off to one side, or with no multi-floor staircase at all, still got a boxy structure
    // dropped in the middle of the roof with no relation to the actual stair, reading as a
    // stray/duplicate structure.
    const topStairFoot = stairFeet[levels - 1];
    if (topStairFoot) {
      const [sx0, sz0, sx1, sz1] = topStairFoot;
      const ov = sx1 - sx0, od = sz1 - sz0, scx = (sx0 + sx1) / 2, scz = (sz0 + sz1) / 2;
      roof.add(box(ov, 2.7, od, scx, py0 + 1.35, scz, mats.facade));
      roof.add(box(ov + 0.3, 0.15, od + 0.3, scx, py0 + 2.7, scz, mats.plaster));   // its little cap
    }
    group.add(roof);
  }

  const bounds = new THREE.Box3().setFromObject(group);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  return { group, collidables, levelGroups, roof, rooms: outRooms, bounds, center, size, floorTop: 0, wallHeight: wallH, ceilings, walkSurfaces };
}
