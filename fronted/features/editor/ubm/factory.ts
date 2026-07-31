/**
 * Element factories + derived-field maintenance.
 *
 * New elements always get a unique id and physically sensible defaults that match the
 * backend pydantic defaults. Derived fields (room area, wall length) are recomputed here
 * so the UBM stays internally consistent after every edit — the JSON is the source of
 * truth, so it must never drift from its own geometry.
 */
import { dist, polygonArea } from "./geometry";
import type { Column, Door, Point, Polygon, Room, Wall, Window } from "./types";

let counter = 0;
/** Session-unique id. Prefixed by kind so ids stay human-readable in the JSON. */
export const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Room type inferred from its name — keeps the tint + 3D material meaningful. */
const ROOM_KEYWORDS: [string, string[]][] = [
  ["master_bedroom", ["master bedroom", "master", "primary bedroom"]],
  ["bathroom", ["bathroom", "toilet", "powder", "bath", "wc", "washroom"]],
  ["kitchen", ["kitchen", "pantry", "brkfst", "breakfast"]],
  ["dining", ["dining"]],
  ["living_room", ["living", "family", "hall", "lounge"]],
  ["bedroom", ["bedroom", "bed"]],
  ["utility", ["utility", "laundry", "store"]],
  ["garage", ["garage", "parking"]],
  ["balcony", ["balcony", "terrace", "deck"]],
  ["foyer", ["foyer", "entry", "porch", "lobby"]],
  ["office", ["study", "office", "library"]],
  ["staircase", ["stair", "staircase"]],
];

export function classifyRoom(name: string): string {
  const t = (name || "").toLowerCase();
  for (const [type, kws] of ROOM_KEYWORDS) for (const kw of kws) if (t.includes(kw)) return type;
  return "room";
}

export function makeRoom(polygon: Polygon, floor = 0, name = "Room"): Room {
  return {
    id: uid("r"),
    name,
    type: classifyRoom(name),
    polygon,
    height_m: 2.9,
    area_m2: Number(polygonArea(polygon).toFixed(2)),
    floor,
    confidence: 1,
    status: "detected",
    ocrText: null,
    connectedRooms: [],
    doors: [],
    windows: [],
  };
}

export function makeWall(startPoint: Point, endPoint: Point, floor = 0, exterior = false): Wall {
  return {
    id: uid("w"),
    startPoint,
    endPoint,
    length_m: Number(dist(startPoint, endPoint).toFixed(3)),
    height_m: 2.9,
    thickness_m: exterior ? 0.2 : 0.12,
    exterior,
    material: "plaster",
    floor,
    connectedRooms: [],
  };
}

export function makeDoor(position: Point, wallId: string | null, rotation = 0, floor = 0): Door {
  return {
    id: uid("d"),
    position,
    rotation,
    wallId,
    width_m: 0.9,
    height_m: 2.1,
    openingDirection: "in",
    entrance: false,
    material: "wood",
    floor,
  };
}

export function makeWindow(position: Point, wallId: string | null, floor = 0): Window {
  return {
    id: uid("n"),
    position,
    wallId,
    width_m: 1.2,
    height_m: 1.2,
    sill_m: 0.9,
    glassType: "clear",
    frameType: "aluminium",
    floor,
  };
}

export function makeColumn(at: Point, floor = 0): Column {
  return { id: uid("c"), at, width_m: 0.3, depth_m: 0.3, floor };
}

/** Recompute a room's area after its polygon changed. */
export const withRoomArea = (room: Room): Room => ({
  ...room,
  area_m2: Number(polygonArea(room.polygon).toFixed(2)),
});

/** Recompute a wall's length after an endpoint moved. */
export const withWallLength = (wall: Wall): Wall => ({
  ...wall,
  length_m: Number(dist(wall.startPoint, wall.endPoint).toFixed(3)),
});
