import type { JsonModelInput } from "../schema";
import { inferRoomType } from "./room-type-map";
import { toMeters } from "./units";
import { dedupeOverlappingRooms } from "./dedupe-rooms";

export interface ImportResult { data: JsonModelInput; notes: string[]; }

/** Converts a CubiCasa5k plan-analysis export (schemaVersion + coordinateSystem,
 *  pixel-space rooms/openings) into the native JsonModelInput shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importCubicasa(raw: any): ImportResult {
  const notes: string[] = [];
  const unit: string = raw?.coordinateSystem?.units ?? "m";
  const pxPerUnit: number = Number(raw?.coordinateSystem?.scale?.pxPerUnit) || 1;
  const pxToM = (px: number) => toMeters(px / pxPerUnit, unit);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRooms: any[] = Array.isArray(raw?.rooms) ? raw.rooms : [];

  const roomsRaw = rawRooms.map((room, idx) => {
    const bbox: number[] = Array.isArray(room.bbox) && room.bbox.length === 4 ? room.bbox : [0, 0, 1, 1];
    const centroid: number[] = Array.isArray(room.centroid) && room.centroid.length === 2
      ? room.centroid
      : [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    const hasRealName = !!(room.name && String(room.name).trim());
    const name: string = hasRealName ? String(room.name).trim() : `Room ${idx + 1}`;
    const { type } = inferRoomType([room.name]);

    return {
      name,
      type,
      center: [pxToM(centroid[0]), pxToM(centroid[1])] as [number, number],
      size: [pxToM(bbox[2] - bbox[0]), pxToM(bbox[3] - bbox[1])] as [number, number],
      confidence: typeof room.confidence === "number" ? room.confidence : 0.5,
      hasRealName,
    };
  });

  // CubiCasa's raw segmentation sometimes reports multiple heavily-overlapping
  // regions for one physical room (a named room plus one or more unnamed
  // "Room N" sub-detections covering almost the same bbox) — merge those before
  // they become crossed walls and doubled furniture in the 3D model.
  const rooms: JsonModelInput["rooms"] = dedupeOverlappingRooms(roomsRaw, notes);
  // Recomputed AFTER dedupe, against the rooms that actually survive — a room
  // merged away shouldn't be reported as "defaulted to generic type" if the
  // identity it merged into was already recognized.
  const unmatchedNames = rooms.filter((r) => r.type === "room").map((r) => r.name);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawOpenings: any[] = Array.isArray(raw?.openings) ? raw.openings : [];

  const windows = rawOpenings
    .filter((o) => o?.type === "Window" && Array.isArray(o.center))
    .map((o) => ({
      pos: [pxToM(o.center[0]), pxToM(o.center[1])] as [number, number],
      len: typeof o.widthPx === "number" ? pxToM(o.widthPx) : undefined,
    }));

  // A Door opening touching at most one recognized room sits on the exterior wall —
  // a reasonable "front door" candidate.
  const entranceDoor = rawOpenings.find(
    (o) => o?.type === "Door" && Array.isArray(o.center) && Array.isArray(o.roomIds) && o.roomIds.length <= 1,
  );
  const entrance: JsonModelInput["entrance"] = entranceDoor
    ? ([pxToM(entranceDoor.center[0]), pxToM(entranceDoor.center[1])] as [number, number])
    : undefined;

  notes.push(`Imported ${rooms.length} room${rooms.length === 1 ? "" : "s"} from a CubiCasa5k plan-analysis export.`);
  notes.push(`Converted pixel coordinates to metres (scale ${pxPerUnit} px/${unit}).`);
  if (unmatchedNames.length > 0) {
    notes.push(`${unmatchedNames.length} room type${unmatchedNames.length === 1 ? "" : "s"} defaulted to generic "room" (${unmatchedNames.join(", ")}).`);
  }
  notes.push(entrance ? "Entrance detected from an exterior door opening." : "Entrance door not found — none set.");

  const data: JsonModelInput = {
    rooms,
    windows: windows.length > 0 ? windows : undefined,
    entrance,
    furnish: true,
  };

  return { data, notes };
}
