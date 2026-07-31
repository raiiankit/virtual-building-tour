/**
 * Faithful TypeScript port of backend/services/furnish.py — same room-relative
 * math, item types/sizes/positions/materials/confidence tweaks. Do not invent a
 * different layout algorithm; this one is already tuned to the rest of the app.
 */
import type { JsonModelInput } from "./schema";

export interface FurniturePiece {
  type: string;
  pos: [number, number];
  size: [number, number, number];
  y?: number;
  material: string;
  roomType: string;
  confidence: number;
  /** Which storey this piece belongs to (0 = ground floor) and that floor's
   *  world-Y offset, mirroring SceneFurniture's `level`/`base_y` (types/index.ts).
   *  Default 0/0 here in item() — furnishManifest() overwrites both from the
   *  owning room's `floor` once a piece is placed, so single-floor callers
   *  (level always 0) are completely unaffected. */
  level: number;
  base_y: number;
}

class Room {
  cx: number; cz: number; w: number; d: number;
  hw: number; hd: number;
  N: number; S: number; W: number; E: number;
  constructor(cx: number, cz: number, w: number, d: number) {
    this.cx = cx; this.cz = cz; this.w = w; this.d = d;
    this.hw = w / 2; this.hd = d / 2;
    this.N = cz - this.hd; this.S = cz + this.hd;
    this.W = cx - this.hw; this.E = cx + this.hw;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A circular door/entrance keep-out zone (world XZ + clearance radius) that floor
 *  furniture should be nudged clear of. Built from partitionFloor()'s real doorway
 *  positions (plus the JSON's own `entrance`) — see computeDoorZones() below. */
export interface DoorZone { pos: [number, number]; r: number }

// Matches generate.ts's door half-widths (~0.45-0.55m) plus swing clearance —
// wide enough that a piece nudged clear of this radius won't foul the door leaf
// swinging open or someone walking through.
const DOOR_CLEARANCE_R = 0.95;

/** Assigns each doorway/entrance point to whichever declared room(s) it borders, by
 *  proximity to each room's nominal center±half-size box — the same room-bounds
 *  reasoning this module already uses everywhere else. A doorway sits on the shared
 *  wall between two rooms, so it's typically assigned to both (each within ~0.6m of
 *  the point); falls back to the single nearest room if none are that close. */
export function computeDoorZones(
  rooms: { center: [number, number]; size: [number, number] }[],
  doorPositions: [number, number][],
  radius = DOOR_CLEARANCE_R,
): DoorZone[][] {
  const out: DoorZone[][] = rooms.map(() => []);
  for (const pos of doorPositions) {
    const scored = rooms.map((rm, i) => {
      const hw = rm.size[0] / 2, hd = rm.size[1] / 2;
      const dx = Math.max(Math.abs(pos[0] - rm.center[0]) - hw, 0);
      const dz = Math.max(Math.abs(pos[1] - rm.center[1]) - hd, 0);
      return { i, d: Math.hypot(dx, dz) };
    }).sort((a, b) => a.d - b.d);
    const close = scored.filter((s) => s.d < 0.6).map((s) => s.i);
    const targets = close.length ? close : scored.slice(0, 1).map((s) => s.i);
    for (const i of targets) out[i].push({ pos, r: radius });
  }
  return out;
}

// Keep floor-standing furniture at least this far inside a room's *nominal* wall
// face. Real extraction data (CubiCasa5k / claude-opus-5) gives rooms as
// overlapping/imprecise boxes; partitionFloor() then clips them into clean,
// non-overlapping rectangles for the actual walls, so the true wall can end up
// a few centimetres tighter than the nominal box this module places furniture
// against. Several per-room packs below hug their nominal edge (wardrobe,
// corner plants, wall units) with only a centimetre or two of slack — enough to
// clip a partitioned wall even without any clipping, and reliably enough with
// it. Rather than making this module partition-aware (it only ever sees the
// nominal room, never the partitioned plan), every placement is nudged inward
// by this margin so it tolerates the wall moving in a bit without escaping it.
const WALL_CLR = 0.22;
function clampAxis(v: number, lo: number, hi: number, mid: number): number {
  return lo <= hi ? clamp(v, lo, hi) : mid;   // room smaller than the item + margin: just centre it
}

function item(
  items: FurniturePiece[], r: Room, t: string, x: number, z: number,
  sx: number, sy: number, sz: number, material: string, conf: number, y?: number,
) {
  const hw = sx / 2, hd = sz / 2;
  const cx = clampAxis(x, r.W + hw + WALL_CLR, r.E - hw - WALL_CLR, r.cx);
  const cz = clampAxis(z, r.N + hd + WALL_CLR, r.S - hd - WALL_CLR, r.cz);
  const inst: FurniturePiece = {
    type: t, pos: [round3(cx), round3(cz)], size: [round3(sx), round3(sy), round3(sz)],
    material, confidence: round2(conf), roomType: "", level: 0, base_y: 0,
  };
  if (y !== undefined) inst.y = round3(y);
  items.push(inst);
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Nudge any floor-standing piece that landed inside a door/entrance keep-out zone
 *  clear of it, along the direction that most increases its distance from the door
 *  centre — deliberately not a full constraint solver, just enough to stop furniture
 *  blocking a doorway or its swing path. Wall/ceiling-mounted props (anything with an
 *  explicit `y`, e.g. ceiling lights, wall cabinets, mirrors, curtains) never sit in a
 *  door's floor-level path, so they're left untouched. Re-clamps through the same
 *  WALL_CLR wall margin item() already applies, so a door-clearance nudge can never
 *  push a piece back out through the wall it was clamped inside of. */
function applyDoorClearance(items: FurniturePiece[], r: Room, zones: DoorZone[]) {
  if (!zones.length) return;
  for (const it of items) {
    if (it.y !== undefined) continue; // wall/ceiling-mounted — not a floor obstruction
    const hw = it.size[0] / 2, hd = it.size[2] / 2;
    for (const z of zones) {
      const dx = it.pos[0] - z.pos[0], dz = it.pos[1] - z.pos[1];
      const dist = Math.hypot(dx, dz);
      const clearance = z.r + Math.max(hw, hd) * 0.5; // conservative: half the piece's larger footprint dimension
      if (dist >= clearance || dist < 1e-6) continue;
      const push = clearance - dist + 0.05;
      // A noticeably elongated piece (e.g. a kitchen counter/cabinet run spanning
      // most of a wall) is mounted flush against its *short*-dimension wall — a
      // radial push could pull it clean off that wall into the room, which looks
      // far worse than the door conflict it's fixing. Restrict those to sliding
      // along their own long axis instead. Roughly square-footprint pieces (bed,
      // wardrobe, table) aren't wall-flush the same way, so stay free to move on
      // whichever axis most increases their distance from the door.
      const elongatedX = it.size[0] > it.size[2] * 1.3;
      const elongatedZ = it.size[2] > it.size[0] * 1.3;
      let ux = dx / dist, uz = dz / dist;
      if (elongatedX) uz = 0;
      else if (elongatedZ) ux = 0;
      const mag = Math.hypot(ux, uz);
      if (mag < 1e-6) { ux = elongatedZ ? 0 : Math.sign(dx) || 1; uz = elongatedZ ? (Math.sign(dz) || 1) : 0; }
      else { ux /= mag; uz /= mag; }
      const nx = clampAxis(it.pos[0] + ux * push, r.W + hw + WALL_CLR, r.E - hw - WALL_CLR, r.cx);
      const nz = clampAxis(it.pos[1] + uz * push, r.N + hd + WALL_CLR, r.S - hd - WALL_CLR, r.cz);
      it.pos = [round3(nx), round3(nz)];
    }
  }
}

function ceilingLight(items: FurniturePiece[], r: Room, conf: number, wallH: number) {
  item(items, r, "ceiling_light", r.cx, r.cz, 0.34, 0.06, 0.34, "light", Math.min(0.95, conf + 0.02), wallH - 0.06);
}

/* --------------------------- per-room-type packs -------------------------- */
function bathroom(items: FurniturePiece[], r: Room, c: number, wh: number) {
  item(items, r, "toilet", r.W + 0.35, r.N + 0.42, 0.4, 0.42, 0.62, "ceramic", c);
  item(items, r, "washbasin", r.W + 0.32, r.S - 0.4, 0.5, 0.2, 0.42, "ceramic", c, 0.82);
  item(items, r, "mirror", r.W + 0.08, r.S - 0.4, 0.04, 0.6, 0.5, "glass", c, 1.5);
  item(items, r, "towel_holder", r.W + 0.06, r.cz, 0.03, 0.06, 0.5, "metal", c - 0.08, 1.1);
  const sw = clamp(r.w * 0.42, 0.8, 1.2);
  const sx = r.E - sw / 2 - 0.04;
  item(items, r, "shower", sx, r.S - 0.5, sw, 0.02, 0.9, "antiskid", c);
  item(items, r, "shower_head", sx, r.S - 0.85, 0.12, 0.1, 0.12, "metal", c - 0.05, 2.05);
  item(items, r, "glass_partition", r.E - sw, r.S - 0.5, 0.03, 1.9, 0.9, "glass", c - 0.04, 0.95);
  item(items, r, "floor_drain", sx, r.S - 0.5, 0.14, 0.02, 0.14, "metal", c - 0.1);
  item(items, r, "exhaust", r.cx, r.N + 0.06, 0.24, 0.24, 0.06, "metal", c - 0.1, wh - 0.35);
  ceilingLight(items, r, c, wh);
}

function kitchen(items: FurniturePiece[], r: Room, c: number, wh: number) {
  // West-wall run: base cabinets (floor to cabH) topped by a slim, slightly
  // overhanging countertop slab — previously "counter" was a full 0-0.9m solid
  // block placed at the exact same footprint as "cabinets" (0-0.82m), so the two
  // meshes overlapped/z-fought almost their whole volume. Now the counter is just
  // the ~5cm slab actually sitting on top of the cabinet carcass, like a real run.
  const cabH = 0.85, topTh = 0.05, topY = cabH + topTh / 2;
  item(items, r, "cabinets", r.W + 0.3, r.cz, 0.6, cabH, r.d - 0.2, "wood", c - 0.02);
  item(items, r, "counter", r.W + 0.3, r.cz, 0.64, topTh, r.d - 0.16, "marble", c, topY);
  item(items, r, "sink", r.W + 0.3, r.cz, 0.4, 0.05, 0.4, "metal", c - 0.04, cabH + 0.02);
  item(items, r, "tap", r.W + 0.3, r.cz - 0.18, 0.05, 0.28, 0.05, "metal", c - 0.06, cabH + 0.19);
  item(items, r, "wall_cabinet", r.W + 0.22, r.cz, 0.35, 0.7, r.d - 0.4, "wood", c - 0.05, 1.9);
  // North-wall hob run — a single combined counter+cabinet block (no separate
  // cabinets piece here, so no overlap) meeting the west run flush in the corner.
  item(items, r, "counter", r.cx, r.N + 0.3, r.w - 1.0, 0.9, 0.6, "marble", c);
  item(items, r, "chimney", r.cx, r.N + 0.25, 0.6, 0.5, 0.4, "metal", c - 0.03, 1.75);
  // Fridge in the east corner — previously at r.N + 0.4 it overlapped the hob
  // run above. Pushed south clear of it: the hob counter's own WALL_CLR clamp
  // (item()'s wall-margin clamp, applied whenever a room is small enough that
  // the counter's nominal r.N + 0.3 position doesn't already clear r.N + hd +
  // WALL_CLR) can push its far edge as deep as r.N + 0.82 in a tight kitchen, so
  // this leaves a margin past that worst case rather than the hob's nominal edge.
  item(items, r, "fridge", r.E - 0.36, r.N + 1.35, 0.7, 1.8, 0.7, "steel", c - 0.02);
  // Microwave now rests on the west countertop (topY + slab + half its own
  // height) instead of floating ~0.3m above it with nothing visibly supporting it.
  item(items, r, "microwave", r.W + 0.3, r.S - 0.5, 0.5, 0.3, 0.35, "dark", c - 0.08, cabH + topTh + 0.15);
  ceilingLight(items, r, c, wh);
}

function bedroom(items: FurniturePiece[], r: Room, c: number, wh: number, master: boolean) {
  const bw = clamp(r.w * (master ? 0.62 : 0.5), master ? 1.4 : 1.0, master ? 2.1 : 1.6);
  const bl = clamp(r.d * 0.5, 1.9, 2.1);
  item(items, r, "bed", r.cx, r.N + bl / 2 + 0.1, bw, 0.55, bl, "fabric", c);
  item(items, r, "headboard", r.cx, r.N + 0.12, bw + 0.2, 1.1, 0.12, "wood", c - 0.03, 0.55);
  item(items, r, "side_table", r.cx - bw / 2 - 0.28, r.N + 0.5, 0.4, 0.5, 0.4, "wood", c - 0.05);
  item(items, r, "night_lamp", r.cx - bw / 2 - 0.28, r.N + 0.5, 0.18, 0.35, 0.18, "light", c - 0.08, 0.7);
  if (master) {
    item(items, r, "side_table", r.cx + bw / 2 + 0.28, r.N + 0.5, 0.4, 0.5, 0.4, "wood", c - 0.05);
    item(items, r, "night_lamp", r.cx + bw / 2 + 0.28, r.N + 0.5, 0.18, 0.35, 0.18, "light", c - 0.08, 0.7);
    item(items, r, "tv_unit", r.cx, r.S - 0.22, clamp(r.w * 0.5, 1.0, 1.8), 0.4, 0.35, "wood", c - 0.05);
    item(items, r, "tv", r.cx, r.S - 0.12, clamp(r.w * 0.4, 0.9, 1.5), 0.62, 0.06, "screen", c - 0.04, 1.15);
  }
  item(items, r, "wardrobe", r.E - 0.32, r.cz, 0.6, 2.1, clamp(r.d * 0.55, 1.2, 2.2), "wood", c - 0.02);
  item(items, r, "curtain", r.cx, r.N + 0.1, bw + 0.6, 1.6, 0.08, "fabric", c - 0.12, 1.7);
  ceilingLight(items, r, c, wh);
}

function living(items: FurniturePiece[], r: Room, c: number, wh: number) {
  const sofaW = clamp(r.w * 0.6, 1.6, 2.8);
  item(items, r, "sofa", r.cx, r.S - 0.5, sofaW, 0.75, 0.9, "fabric", c);
  item(items, r, "coffee_table", r.cx, r.cz + 0.1, clamp(sofaW * 0.5, 0.8, 1.3), 0.4, 0.6, "wood", c - 0.04);
  item(items, r, "tv_unit", r.cx, r.N + 0.24, clamp(r.w * 0.55, 1.2, 2.2), 0.42, 0.4, "wood", c - 0.03);
  item(items, r, "tv", r.cx, r.N + 0.14, clamp(r.w * 0.45, 1.0, 1.8), 0.7, 0.06, "screen", c - 0.02, 1.2);
  item(items, r, "rug", r.cx, r.cz + 0.1, sofaW + 0.4, 0.02, 1.6, "fabric", c - 0.1);
  item(items, r, "plant", r.E - 0.35, r.N + 0.35, 0.4, 1.3, 0.4, "plant", c - 0.1);
  ceilingLight(items, r, c, wh);
}

function dining(items: FurniturePiece[], r: Room, c: number, wh: number) {
  const tw = clamp(r.w * 0.4, 0.9, 1.4);
  const tl = clamp(r.d * 0.5, 1.2, 2.0);
  item(items, r, "dining_table", r.cx, r.cz, tw, 0.76, tl, "wood", c);
  for (let k = 0; k < 3; k++) {
    const z = r.cz - tl / 2 + (tl * (k + 0.5)) / 3;
    item(items, r, "chair", r.cx - tw / 2 - 0.28, z, 0.42, 0.9, 0.42, "wood", c - 0.05);
    item(items, r, "chair", r.cx + tw / 2 + 0.28, z, 0.42, 0.9, 0.42, "wood", c - 0.05);
  }
  ceilingLight(items, r, c, wh);
}

function utility(items: FurniturePiece[], r: Room, c: number, wh: number) {
  item(items, r, "washing_machine", r.W + 0.4, r.N + 0.42, 0.62, 0.85, 0.62, "steel", c);
  item(items, r, "utility_sink", r.W + 0.4, r.S - 0.4, 0.5, 0.85, 0.5, "ceramic", c - 0.04);
  item(items, r, "storage", r.E - 0.3, r.cz, 0.55, 2.0, clamp(r.d * 0.6, 1.0, 2.0), "wood", c - 0.03);
  ceilingLight(items, r, c, wh);
}

function garage(items: FurniturePiece[], r: Room, c: number, wh: number) {
  item(items, r, "vehicle", r.cx, r.cz + 0.2, clamp(r.w * 0.55, 1.7, 2.0), 1.45, clamp(r.d * 0.7, 3.8, 4.6), "car", c);
  item(items, r, "garage_door", r.cx, r.S - 0.06, r.w - 0.4, 2.3, 0.12, "metal", c - 0.02, 1.15);
  item(items, r, "storage", r.W + 0.28, r.N + 0.8, 0.5, 1.9, 1.4, "wood", c - 0.06);
  ceilingLight(items, r, c, wh);
}

function balcony(items: FurniturePiece[], r: Room, c: number) {
  item(items, r, "glass_railing", r.cx, r.S - 0.04, r.w - 0.1, 1.05, 0.05, "glass", c, 0.55);
  item(items, r, "glass_railing", r.E - 0.04, r.cz, 0.05, 1.05, r.d - 0.1, "glass", c, 0.55);
  item(items, r, "planter", r.W + 0.25, r.S - 0.3, 0.35, 0.5, 0.9, "plant", c - 0.08);
  item(items, r, "outdoor_chair", r.cx, r.cz, 0.5, 0.8, 0.5, "metal", c - 0.1);
}

function foyer(items: FurniturePiece[], r: Room, c: number, wh: number) {
  item(items, r, "console", r.W + 0.22, r.cz, 0.35, 0.85, clamp(r.d * 0.5, 0.8, 1.4), "wood", c);
  item(items, r, "mirror", r.W + 0.06, r.cz, 0.04, 1.1, 0.6, "glass", c - 0.05, 1.4);
  item(items, r, "plant", r.E - 0.3, r.N + 0.3, 0.35, 1.2, 0.35, "plant", c - 0.1);
  ceilingLight(items, r, c, wh);
}

function office(items: FurniturePiece[], r: Room, c: number, wh: number) {
  item(items, r, "desk", r.cx, r.N + 0.4, clamp(r.w * 0.55, 1.2, 1.8), 0.75, 0.6, "wood", c);
  item(items, r, "chair", r.cx, r.N + 0.95, 0.5, 0.95, 0.5, "fabric", c - 0.05);
  item(items, r, "storage", r.E - 0.3, r.cz, 0.35, 1.9, clamp(r.d * 0.6, 1.0, 2.0), "wood", c - 0.04);
  ceilingLight(items, r, c, wh);
}

type Pack = (items: FurniturePiece[], r: Room, c: number, wh: number) => void;
const PACKS: Record<string, Pack> = {
  bathroom: (i, r, c, wh) => bathroom(i, r, c, wh),
  kitchen,
  bedroom: (i, r, c, wh) => bedroom(i, r, c, wh, false),
  master_bedroom: (i, r, c, wh) => bedroom(i, r, c, wh, true),
  living_room: living,
  dining,
  utility,
  garage,
  balcony: (i, r, c, wh) => balcony(i, r, c),
  foyer,
  corridor: (i, r, c, wh) => ceilingLight(i, r, c, wh),
  office,
  // The real, climbable stair flight is built directly by the 3D engine
  // (buildStairFlight in features/viewer3d/generate.ts), sized from the actual gap
  // between floors — a second, independently-sized set of decorative "stair_step"
  // furniture here just overlapped/duplicated it. Lighting only, same as "lift".
  staircase: (i, r, c, wh) => ceilingLight(i, r, c, wh),
  lift: (i, r, c, wh) => ceilingLight(i, r, c, wh),
  room: living, // a generic space still reads as a living area, never empty
};

/** Furniture for a single room. Mirrors furnish_room() in furnish.py.
 *  `doorZones` (optional, defaults to none — existing callers/behavior unaffected)
 *  are door/entrance keep-out circles this room borders; any floor piece placed
 *  inside one is nudged clear of it after the pack's normal placement runs. */
export function furnishRoom(
  roomType: string, cx: number, cz: number, w: number, d: number,
  confidence = 0.85, wallH = 2.7, includeFurniture = true, doorZones: DoorZone[] = [],
): FurniturePiece[] {
  if (w <= 0.6 || d <= 0.6) return [];
  const r = new Room(cx, cz, w, d);
  const items: FurniturePiece[] = [];
  const conf = Math.max(0.55, Math.min(0.97, confidence));
  if (includeFurniture) {
    (PACKS[roomType] ?? PACKS.room)(items, r, conf, wallH);
    applyDoorClearance(items, r, doorZones);
  } else {
    ceilingLight(items, r, conf, wallH); // empty building: lighting only, no furniture
  }
  for (const it of items) it.roomType = roomType;
  return items;
}

/** Furnish every room declared in the JSON model input. `doorZonesByRoom`, when
 *  given, is indexed the same as `input.rooms` (see computeDoorZones()) — omit it
 *  (defaults to none) to get the exact prior door-unaware placement. */
export function furnishManifest(input: JsonModelInput, doorZonesByRoom: DoorZone[][] = []): FurniturePiece[] {
  const wallH = input.wallHeightM ?? 2.9;
  const floorH = input.floorHeightM ?? 3.0;
  const includeFurniture = input.furnish !== false;
  const out: FurniturePiece[] = [];
  input.rooms.forEach((room, i) => {
    const level = room.floor ?? 0;
    const base_y = level * floorH;
    const pieces = furnishRoom(
      room.type, room.center[0], room.center[1], room.size[0], room.size[1],
      0.9, wallH, includeFurniture, doorZonesByRoom[i] ?? [],
    );
    for (const p of pieces) { p.level = level; p.base_y = base_y; }
    out.push(...pieces);
  });
  return out;
}
