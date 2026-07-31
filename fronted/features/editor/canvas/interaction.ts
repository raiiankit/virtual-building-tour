/**
 * Pointer-space queries: hit-testing (what did the user click?), resize-handle detection,
 * and the snap engine. All pure functions over the UBM + view; no state, no drawing.
 */
import { distToSegment, pointInPolygon } from "../ubm/geometry";
import type { LayerVisibility, Point, Selection, UniversalBuildingModel } from "../ubm/types";
import { HANDLE_PX, polyScreenBBox } from "./render";
import { screenToWorld, View, worldToScreen } from "./view";

/** A grabbed transform handle. Room corners are ordered TL, TR, BL, BR of the screen bbox. */
export type HandleHit =
  | { type: "room-corner"; corner: 0 | 1 | 2 | 3 }
  | { type: "wall-end"; end: "start" | "end" };

/** Did the pointer (screen px) land on a transform handle of the current selection? */
export function hitHandle(
  v: View,
  ubm: UniversalBuildingModel,
  sel: Selection | null,
  sx: number,
  sy: number,
): HandleHit | null {
  if (!sel) return null;
  const near = (hx: number, hy: number) => Math.abs(sx - hx) <= HANDLE_PX && Math.abs(sy - hy) <= HANDLE_PX;

  if (sel.kind === "room") {
    const r = ubm.rooms.find((x) => x.id === sel.id);
    if (!r) return null;
    const bb = polyScreenBBox(v, r.polygon);
    const corners: [number, number][] = [
      [bb.minx, bb.miny],
      [bb.maxx, bb.miny],
      [bb.minx, bb.maxy],
      [bb.maxx, bb.maxy],
    ];
    for (let i = 0; i < 4; i++) if (near(corners[i][0], corners[i][1])) return { type: "room-corner", corner: i as 0 | 1 | 2 | 3 };
  } else if (sel.kind === "wall") {
    const w = ubm.walls.find((x) => x.id === sel.id);
    if (!w) return null;
    const [ax, ay] = worldToScreen(v, w.startPoint);
    const [bx, by] = worldToScreen(v, w.endPoint);
    if (near(ax, ay)) return { type: "wall-end", end: "start" };
    if (near(bx, by)) return { type: "wall-end", end: "end" };
  }
  return null;
}

/**
 * Top-most selectable element under a world point. Small point-like elements (columns,
 * doors, windows) win over rooms, which win over walls, so nothing hides behind a room fill.
 */
export function pickAt(
  ubm: UniversalBuildingModel,
  world: Point,
  v: View,
  layers: LayerVisibility,
  tolPx = 8,
): Selection | null {
  const tol = tolPx / v.scale; // metres

  if (layers.columns)
    for (let i = ubm.columns.length - 1; i >= 0; i--) {
      const c = ubm.columns[i];
      if (Math.abs(world[0] - c.at[0]) <= c.width_m / 2 + tol && Math.abs(world[1] - c.at[1]) <= c.depth_m / 2 + tol)
        return { kind: "column", id: c.id };
    }
  if (layers.doors)
    for (let i = ubm.doors.length - 1; i >= 0; i--) {
      const d = ubm.doors[i];
      if (Math.hypot(world[0] - d.position[0], world[1] - d.position[1]) <= d.width_m / 2 + tol)
        return { kind: "door", id: d.id };
    }
  if (layers.windows)
    for (let i = ubm.windows.length - 1; i >= 0; i--) {
      const w = ubm.windows[i];
      if (Math.hypot(world[0] - w.position[0], world[1] - w.position[1]) <= w.width_m / 2 + tol)
        return { kind: "window", id: w.id };
    }
  if (layers.rooms)
    for (let i = ubm.rooms.length - 1; i >= 0; i--)
      if (pointInPolygon(world, ubm.rooms[i].polygon)) return { kind: "room", id: ubm.rooms[i].id };
  if (layers.walls) {
    let best: { id: string; d: number } | null = null;
    for (const w of ubm.walls) {
      const d = distToSegment(world, w.startPoint, w.endPoint);
      if (d <= w.thickness_m / 2 + tol && (!best || d < best.d)) best = { id: w.id, d };
    }
    if (best) return { kind: "wall", id: best.id };
  }
  return null;
}

export interface SnapOptions {
  grid: boolean;
  gridStepM: number; // snap increment when snapping to grid
  features: boolean; // snap to wall endpoints/midpoints + room vertices
  tolPx: number; // feature-snap radius in screen px
  excludeWallId?: string;
}

export interface SnapResult {
  point: Point;
  onFeature: boolean; // true if we snapped to a real vertex/midpoint (draw an indicator)
}

/** Snap a world point to the nearest feature (endpoint/midpoint/vertex) or the grid. */
export function snapPoint(world: Point, ubm: UniversalBuildingModel, v: View, opts: SnapOptions): SnapResult {
  if (opts.features) {
    const tol = opts.tolPx / v.scale;
    let best: { p: Point; d: number } | null = null;
    const consider = (p: Point) => {
      const d = Math.hypot(world[0] - p[0], world[1] - p[1]);
      if (d <= tol && (!best || d < best.d)) best = { p, d };
    };
    for (const w of ubm.walls) {
      if (w.id === opts.excludeWallId) continue;
      consider(w.startPoint);
      consider(w.endPoint);
      consider([(w.startPoint[0] + w.endPoint[0]) / 2, (w.startPoint[1] + w.endPoint[1]) / 2]);
    }
    for (const r of ubm.rooms) for (const vtx of r.polygon) consider(vtx);
    if (best) return { point: (best as { p: Point }).p, onFeature: true };
  }
  if (opts.grid) {
    const s = opts.gridStepM;
    return { point: [Math.round(world[0] / s) * s, Math.round(world[1] / s) * s], onFeature: false };
  }
  return { point: world, onFeature: false };
}

/** Convenience: event client coords → world metres. */
export function eventWorld(v: View, canvas: HTMLCanvasElement, clientX: number, clientY: number): Point {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(v, clientX - rect.left, clientY - rect.top);
}
