import { z } from "zod";

/** Room types the furnishing engine knows how to lay out (mirrors backend/services/furnish.py). */
export const ROOM_TYPES = [
  "bedroom", "master_bedroom", "kitchen", "bathroom", "living_room", "dining",
  "utility", "garage", "balcony", "foyer", "corridor", "office", "staircase", "lift", "room",
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export const FLOOR_MATERIALS = ["tile", "wood_floor", "antiskid", "concrete", "outdoor"] as const;
export type FloorMaterialOverride = (typeof FLOOR_MATERIALS)[number];

const vec2 = z.tuple([z.number(), z.number()]);

const roomSchema = z.object({
  name: z.string().min(1, "room name is required"),
  type: z.enum(ROOM_TYPES, { errorMap: () => ({ message: `type must be one of: ${ROOM_TYPES.join(", ")}` }) }),
  center: vec2,
  size: vec2.refine(([w, d]) => w > 0.6 && d > 0.6, {
    message: "size [width, depth] must both be greater than 0.6 m",
  }),
  floorMaterial: z.enum(FLOOR_MATERIALS).optional(),
  // Which storey this room belongs to (0 = ground floor). Omitted entirely for
  // every pre-existing single-floor JSON, including the portal's own built-in
  // EXAMPLE_JSON — defaults to 0 downstream (jsonModelToManifest / furnish.ts),
  // so nothing changes for a single-floor input. Opt-in multi-floor only.
  floor: z.number().int().min(0).optional(),
});

const windowSchema = z.object({
  pos: vec2,
  len: z.number().positive().optional(),
  // Same opt-in per-floor tag as rooms (defaults to 0). Note: buildArchitecture()
  // in the shared 3D engine currently applies the whole `windows` list to every
  // level via proximity-snapping onto that level's own exterior walls (see
  // generate.ts) rather than an explicit per-window level field, so this is
  // primarily documentation/validation input for now — see to-manifest.ts.
  floor: z.number().int().min(0).optional(),
});

export const jsonModelSchema = z.object({
  name: z.string().optional(),
  wallHeightM: z.number().positive().optional(),
  // Vertical distance between one floor's slab and the next (metres). Defaults
  // to 3.0, matching SceneManifest.floor_height_m's existing engine default.
  // Only matters once rooms declare `floor > 0`.
  floorHeightM: z.number().positive().optional(),
  rooms: z.array(roomSchema).min(1, "at least one room is required"),
  windows: z.array(windowSchema).optional(),
  entrance: vec2.optional(),
  furnish: z.boolean().optional(),
});

export type JsonModelInput = z.infer<typeof jsonModelSchema>;

export interface ValidationIssue { path: string; message: string; }

export interface ParseResult {
  ok: boolean;
  data?: JsonModelInput;
  issues: ValidationIssue[];
}

/** For a genuinely multi-floor input (any room with `floor > 0`), every floor
 *  from 0 up to `levels - 2` needs its own "staircase"-typed room — the shared
 *  3D engine (buildArchitecture in features/viewer3d/generate.ts) only punches
 *  a climbable stair flight + floor-slab hole on a level that has one, at the
 *  same lvl. Missing one still generates (the two floors just render
 *  disconnected, not a hard error), so this is a non-blocking warning. Single-
 *  floor inputs (no room with floor > 0) never trigger this — zero-migration
 *  guarantee stays intact. */
export function staircaseContinuityIssues(rooms: { floor?: number; type: string }[]): ValidationIssue[] {
  const levels = Math.max(0, ...rooms.map((r) => r.floor ?? 0)) + 1;
  if (levels <= 1) return [];
  const issues: ValidationIssue[] = [];
  for (let lvl = 0; lvl < levels - 1; lvl++) {
    const hasStair = rooms.some((r) => (r.floor ?? 0) === lvl && r.type === "staircase");
    if (!hasStair) {
      issues.push({
        path: "rooms[].floor",
        message: `Floor ${lvl} has no staircase room — floors won't connect with a climbable stair (add a "staircase"-typed room at the same [x, z] position on floors ${lvl} through ${levels - 2}).`,
      });
    }
  }
  return issues;
}

/** For every pair of adjoining floors that both declare a "staircase" room, checks the two
 *  rooms' center/size roughly line up (the shared 3D engine renders the flight from the
 *  lower floor's declared footprint and punches the hole from the upper floor's — see
 *  generate.ts's stairFootUp/stairFootDown — so a big enough mismatch means the hole and
 *  the flight only partially overlap, and the stair reads as floating or clipped through
 *  the floor above rather than a clean connection). Non-blocking: the engine still falls
 *  back to whichever footprint exists, so this is feedback, not a hard error. */
export function staircaseAlignmentIssues(rooms: { floor?: number; type: string; name: string; center: [number, number]; size: [number, number] }[]): ValidationIssue[] {
  const levels = Math.max(0, ...rooms.map((r) => r.floor ?? 0)) + 1;
  const issues: ValidationIssue[] = [];
  const CENTER_TOL = 0.5, SIZE_TOL = 0.5;
  for (let lvl = 0; lvl < levels - 1; lvl++) {
    const lower = rooms.find((r) => (r.floor ?? 0) === lvl && r.type === "staircase");
    const upper = rooms.find((r) => (r.floor ?? 0) === lvl + 1 && r.type === "staircase");
    if (!lower || !upper) continue;
    const centerDrift = Math.hypot(lower.center[0] - upper.center[0], lower.center[1] - upper.center[1]);
    const sizeDrift = Math.max(Math.abs(lower.size[0] - upper.size[0]), Math.abs(lower.size[1] - upper.size[1]));
    if (centerDrift > CENTER_TOL || sizeDrift > SIZE_TOL) {
      issues.push({
        path: "rooms[].floor",
        message: `Staircase on floor ${lvl} ("${lower.name}") and floor ${lvl + 1} ("${upper.name}") don't line up closely enough (center drift ${centerDrift.toFixed(2)} m, size drift ${sizeDrift.toFixed(2)} m) — the flight and the opening above it may not fully overlap. Use the same [x, z] center and size for both.`,
      });
    }
  }
  return issues;
}

/** Parse + validate raw JSON text against the schema, returning human-readable issues. */
export function parseJsonModel(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, issues: [{ path: "(document)", message: `Invalid JSON: ${(e as Error).message}` }] };
  }
  const result = jsonModelSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((iss) => ({
      path: iss.path.length ? iss.path.join(".") : "(root)",
      message: iss.message,
    }));
    return { ok: false, issues };
  }
  // duplicate-name warning (not fatal, but useful feedback)
  const names = result.data.rooms.map((r) => r.name.trim().toLowerCase());
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  const issues: ValidationIssue[] = [...new Set(dupes)].map((n) => ({
    path: "rooms[].name",
    message: `duplicate room name "${n}" — recommended to keep names unique (not fatal)`,
  }));
  issues.push(...staircaseContinuityIssues(result.data.rooms));
  issues.push(...staircaseAlignmentIssues(result.data.rooms));
  return { ok: true, data: result.data, issues };
}
