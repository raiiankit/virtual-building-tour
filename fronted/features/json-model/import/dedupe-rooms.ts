import type { JsonModelInput } from "../schema";

type Room = JsonModelInput["rooms"][number];

/** Raw floor-plan segmentation (CubiCasa5k especially) sometimes emits multiple
 *  overlapping candidate regions for one messy real room — e.g. a "M. BED ROOM"
 *  region plus one or two unnamed sub-regions ("Room 8", "Room 14") whose bounding
 *  boxes cover almost the same physical area. Importing all of them as separate
 *  rooms causes crossed/overlapping walls and doubled furniture (each "room" gets
 *  furnished independently). This merges rooms whose bounding boxes overlap by more
 *  than `threshold` of the smaller one's area into a single room (union bbox),
 *  preferring whichever had a real name / higher confidence for the merged identity. */
export function dedupeOverlappingRooms(
  rooms: Array<Room & { confidence?: number; hasRealName?: boolean }>,
  notes: string[],
  threshold = 0.5,
): Room[] {
  let list = rooms.map((r) => ({ ...r }));
  let mergedCount = 0;

  const bounds = (r: Room) => ({
    x0: r.center[0] - r.size[0] / 2, x1: r.center[0] + r.size[0] / 2,
    z0: r.center[1] - r.size[1] / 2, z1: r.center[1] + r.size[1] / 2,
  });
  const overlapRatio = (a: Room, b: Room) => {
    const A = bounds(a), B = bounds(b);
    const ox = Math.max(0, Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0));
    const oz = Math.max(0, Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0));
    const overlap = ox * oz;
    const areaA = a.size[0] * a.size[1], areaB = b.size[0] * b.size[1];
    return overlap / Math.max(1e-9, Math.min(areaA, areaB));
  };

  // Greedy: repeatedly merge the first over-threshold pair found, until none remain.
  // Bounded by list.length so a pathological input can't loop forever.
  for (let guard = 0; guard < rooms.length * rooms.length + 1; guard++) {
    let mergedThisPass = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (overlapRatio(a, b) < threshold) continue;
        // Prefer the identity (name/type) of whichever room is the better signal:
        // a real (non-generic) name beats a placeholder, higher confidence breaks ties.
        const aScore = (a.hasRealName ? 2 : 0) + (a.confidence ?? 0.5);
        const bScore = (b.hasRealName ? 2 : 0) + (b.confidence ?? 0.5);
        const keep = aScore >= bScore ? a : b;
        const A = bounds(a), B = bounds(b);
        const x0 = Math.min(A.x0, B.x0), x1 = Math.max(A.x1, B.x1);
        const z0 = Math.min(A.z0, B.z0), z1 = Math.max(A.z1, B.z1);
        const merged = {
          ...keep,
          center: [(x0 + x1) / 2, (z0 + z1) / 2] as [number, number],
          size: [x1 - x0, z1 - z0] as [number, number],
        };
        list = list.filter((_, k) => k !== i && k !== j);
        list.push(merged);
        mergedCount++;
        mergedThisPass = true;
        break outer;
      }
    }
    if (!mergedThisPass) break;
  }

  if (mergedCount > 0) {
    notes.push(`Merged ${mergedCount} overlapping room detection${mergedCount === 1 ? "" : "s"} — the source segmentation reported more than one overlapping region for the same physical room.`);
  }
  return list.map(({ confidence: _c, hasRealName: _h, ...r }) => r);
}
