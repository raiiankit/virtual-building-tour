import type { JsonModelInput } from "../schema";
import { inferRoomType } from "./room-type-map";
import { toMeters } from "./units";

export interface ImportResult { data: JsonModelInput; notes: string[]; }

interface BBox { x: number; y: number; width: number; height: number; }
const DEFAULT_BBOX: BBox = { x: 0, y: 0, width: 1, height: 1 };

/** Converts a claude-opus-5 floor-plan-extraction export (project.source +
 *  canvas.pixelsPerFoot, heavily null-boilerplated rooms/doors/windows) into
 *  the native JsonModelInput shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function importClaudeExtraction(raw: any): ImportResult {
  const notes: string[] = [];
  const pixelsPerFoot: number = Number(raw?.canvas?.pixelsPerFoot) || 1;
  const pxToM = (px: number) => toMeters(px / pixelsPerFoot, "ft");
  const bboxCenterM = (bb: BBox): [number, number] => [pxToM(bb.x + bb.width / 2), pxToM(bb.y + bb.height / 2)];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawRooms: any[] = Array.isArray(raw?.rooms) ? raw.rooms : [];
  const unmatchedNames: string[] = [];

  const rooms: JsonModelInput["rooms"] = rawRooms.map((room, idx) => {
    const bb: BBox = room.boundingBox ?? DEFAULT_BBOX;
    const name: string = (room.name && String(room.name).trim()) || `Room ${idx + 1}`;

    let { type, matched } = inferRoomType([room.subtype]);
    if (type === "bedroom" && /master|primary/i.test(name)) {
      type = "master_bedroom";
      matched = true;
    }
    if (!matched) unmatchedNames.push(name);

    // Prefer explicit human-labeled dimensions over the pixel bounding box when present.
    const size: [number, number] =
      typeof room.realWidthFt === "number" && typeof room.realHeightFt === "number"
        ? [toMeters(room.realWidthFt, "ft"), toMeters(room.realHeightFt, "ft")]
        : [pxToM(bb.width), pxToM(bb.height)];

    return { name, type, center: bboxCenterM(bb), size };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawWindows: any[] = Array.isArray(raw?.windows) ? raw.windows : [];
  const windows = rawWindows.map((w) => {
    const bb: BBox = w.boundingBox ?? DEFAULT_BBOX;
    return { pos: bboxCenterM(bb), len: pxToM(Math.max(bb.width, bb.height)) };
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDoors: any[] = Array.isArray(raw?.doors) ? raw.doors : [];
  const entranceDoor = rawDoors.find((d) => d?.subtype === "entry");
  const entrance: JsonModelInput["entrance"] = entranceDoor
    ? bboxCenterM(entranceDoor.boundingBox ?? DEFAULT_BBOX)
    : undefined;

  notes.push(`Imported ${rooms.length} room${rooms.length === 1 ? "" : "s"} from a claude-opus-5 floor-plan extraction.`);
  notes.push(`Converted from feet to metres using canvas scale (${pixelsPerFoot} px/ft).`);
  if (unmatchedNames.length > 0) {
    notes.push(`${unmatchedNames.length} room type${unmatchedNames.length === 1 ? "" : "s"} defaulted to generic "room" (${unmatchedNames.join(", ")}).`);
  }
  notes.push(entrance ? "Entrance detected from the door marked as the main entry." : "Entrance door not found — none set.");

  const data: JsonModelInput = {
    name: typeof raw?.project?.name === "string" ? raw.project.name : undefined,
    rooms,
    windows: windows.length > 0 ? windows : undefined,
    entrance,
    furnish: true,
  };

  return { data, notes };
}
