import type { SceneManifest, SceneRoom, SceneWall } from "@/types";
import type { JsonModelInput } from "./schema";

/** Sensible default floor finish per room type when the JSON doesn't override it. */
const DEFAULT_FLOOR_MATERIAL: Record<string, string> = {
  bedroom: "wood_floor", master_bedroom: "wood_floor", living_room: "wood_floor",
  kitchen: "antiskid", bathroom: "antiskid", utility: "antiskid",
  dining: "tile", foyer: "tile", corridor: "tile", office: "tile", room: "tile",
  garage: "concrete", staircase: "concrete", lift: "concrete",
  balcony: "outdoor",
};

/** Map the hand-authored JSON model input into the SceneManifest the existing
 *  procedural engine (`buildArchitecture`) already knows how to build. Rooms drive
 *  the auto wall/door partitioning; `walls` here is only the bounding perimeter
 *  (used solely to size the roof — see buildArchitecture's roof section). */
export function jsonModelToManifest(input: JsonModelInput): SceneManifest {
  const wallHeight = input.wallHeightM ?? 2.9;
  const floorHeight = input.floorHeightM ?? 3.0;
  // levels = highest declared `floor` + 1. Every existing single-floor JSON has
  // no room.floor at all (=> 0 for all), so levels === 1, matching prior behavior.
  const levels = Math.max(0, ...input.rooms.map((r) => r.floor ?? 0)) + 1;

  const rooms: SceneRoom[] = input.rooms.map((r) => {
    const level = r.floor ?? 0;
    return {
      name: r.name,
      type: r.type,
      confidence: 1,
      center: r.center,
      size: r.size,
      dim_label: null,
      floor_material: r.floorMaterial ?? DEFAULT_FLOOR_MATERIAL[r.type] ?? "tile",
      level,
      base_y: level * floorHeight,
    };
  });

  // Bounding perimeter across ALL floors' rooms — used solely to size the roof
  // (buildArchitecture's roof section takes the max XZ extent of manifest.walls
  // regardless of level/height, see generate.ts's "roof" block), so this stays
  // correct unchanged for a multi-floor footprint: the roof always sits over
  // the widest extent among all floors, not just the top one.
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of input.rooms) {
    const [cx, cz] = r.center, [w, d] = r.size;
    x0 = Math.min(x0, cx - w / 2); z0 = Math.min(z0, cz - d / 2);
    x1 = Math.max(x1, cx + w / 2); z1 = Math.max(z1, cz + d / 2);
  }

  const walls: SceneWall[] = [
    { a: [x0, z0], b: [x1, z0], exterior: true },
    { a: [x1, z0], b: [x1, z1], exterior: true },
    { a: [x1, z1], b: [x0, z1], exterior: true },
    { a: [x0, z1], b: [x0, z0], exterior: true },
  ];

  // Note: SceneManifest's window entries carry no per-window `level` (see
  // types/index.ts), and buildArchitecture() reads `manifest.windows` once,
  // outside its per-level loop, applying the same list to every floor's
  // exterior walls via proximity-snapping (snapTo) — a window only actually
  // appears on a floor whose exterior wall happens to be near its `pos`. The
  // JSON's own per-window `floor` tag (schema.ts) isn't threaded through here
  // because the engine has nowhere to use it; documented as a known limitation
  // rather than guessed at.
  const windows = (input.windows ?? []).map((w) => ({
    pos: w.pos, orient: "h" as const, confidence: 1, len: w.len ?? 1.5,
  }));

  const doors = input.entrance
    ? [{ pos: input.entrance, orient: "h" as const, entrance: true, confidence: 1 }]
    : [];

  return {
    version: "1", units: "m",
    floor_height_m: floorHeight, wall_height_m: wallHeight, levels,
    bounds: { min: [x0, z0], max: [x1, z1] },
    walls, rooms, furniture: [], windows, doors,
  };
}
