/**
 * Client-side validation — a faithful mirror of the backend `validate_ubm`
 * (`backend/ubm/validate.py`) so the editor shows the SAME blocking / warning / info
 * issues live, before the user hits Save or Approve. The backend re-validates on save and
 * remains authoritative; this exists only for instant, network-free feedback.
 */
import { distToSegment, modelBounds } from "./geometry";
import type {
  Point,
  UniversalBuildingModel,
  ValidationIssue,
  ValidationReport,
  Wall,
} from "./types";

export function validateUBM(ubm: UniversalBuildingModel): ValidationReport {
  const issues: ValidationIssue[] = [];
  const add = (level: ValidationIssue["level"], code: string, message: string, id?: string) =>
    issues.push({ level, code, message, element_id: id ?? null });

  // --- rooms: closed polygon, plausible area ---
  if (ubm.rooms.length === 0) add("blocking", "no_rooms", "No rooms in the model.");
  for (const r of ubm.rooms) {
    if (r.polygon.length < 3)
      add("blocking", "room_open", `Room '${r.name}' polygon is not closed.`, r.id);
    if (r.area_m2 && r.area_m2 < 1) add("warning", "room_tiny", `Room '${r.name}' area < 1 m² — check scale.`, r.id);
    if (r.area_m2 > 500) add("warning", "room_huge", `Room '${r.name}' area > 500 m² — check scale.`, r.id);
  }

  // --- walls: count, thickness, duplicates ---
  if (ubm.walls.length < 4) add("warning", "few_walls", "Fewer than 4 walls — the shell may not be enclosed.");
  const seen = new Set<string>();
  for (const w of ubm.walls) {
    if (!(w.thickness_m >= 0.05 && w.thickness_m <= 0.4))
      add("warning", "wall_thickness", `Wall ${w.id} thickness ${w.thickness_m} m out of range.`, w.id);
    if (w.length_m < 0.15) add("info", "wall_short", `Very short wall ${w.id}.`, w.id);
    const k = `${w.startPoint[0].toFixed(1)},${w.startPoint[1].toFixed(1)},${w.endPoint[0].toFixed(1)},${w.endPoint[1].toFixed(1)}`;
    const kr = `${w.endPoint[0].toFixed(1)},${w.endPoint[1].toFixed(1)},${w.startPoint[0].toFixed(1)},${w.startPoint[1].toFixed(1)}`;
    if (seen.has(k) || seen.has(kr)) add("info", "wall_dup", `Duplicate/overlapping wall ${w.id}.`, w.id);
    seen.add(k);
  }

  // --- doors / windows must sit on a wall ---
  const onWall = (p: Point, walls: Wall[]) =>
    walls.some((w) => distToSegment(p, w.startPoint, w.endPoint) < Math.max(0.6, w.thickness_m * 3));
  if (ubm.walls.length) {
    for (const d of ubm.doors)
      if (!onWall(d.position, ubm.walls)) add("warning", "door_off_wall", `Door ${d.id} is not on a wall.`, d.id);
    for (const wd of ubm.windows)
      if (!onWall(wd.position, ubm.walls)) add("warning", "window_off_wall", `Window ${wd.id} is not on a wall.`, wd.id);
  }

  // --- connectivity: reachable rooms + low-confidence review flags ---
  for (const r of ubm.rooms) {
    if (!["balcony", "corridor", "foyer"].includes(r.type) && r.doors.length === 0)
      add("info", "room_no_door", `Room '${r.name}' has no door linked.`, r.id);
    if (r.confidence < 0.9 || ["estimated", "unknown"].includes(r.status))
      add(
        "info",
        "room_review",
        `Room '${r.name}' is ${Math.round(r.confidence * 100)}% confident (${r.status}) — verify its name and shape.`,
        r.id,
      );
  }
  for (const b of ubm.balconies)
    if (b.connectedRooms.length === 0) add("info", "balcony_unlinked", `Balcony ${b.id} is not linked to a room.`, b.id);

  // --- scale sanity from footprint ---
  const bd = ubm.metadata.bounds ?? modelBounds(ubm);
  if (bd) {
    const span = Math.max(bd.maxx - bd.minx, bd.maxz - bd.minz);
    if (span < 2) add("warning", "scale_small", `Building spans only ${span.toFixed(1)} m — the scale is likely wrong.`);
    else if (span > 200) add("warning", "scale_large", `Building spans ${span.toFixed(0)} m — the scale is likely wrong.`);
  }

  const blocking = issues.filter((i) => i.level === "blocking").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { ok: blocking === 0, blocking, warnings, issues };
}
