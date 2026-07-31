/**
 * The Canvas 2D render pass. One pure `drawScene()` paints the whole UBM for the current
 * frame from immutable inputs — no React, no mutation of the model. Called from the
 * editor's render loop on every view/model/selection change.
 *
 * Draw order (bottom → top): sheet, grid, rooms, balconies, stairs, beams, walls, windows,
 * doors, columns, annotations, dimensions, selection handles, live overlays.
 */
import { centroid, polygonArea } from "../ubm/geometry";
import type {
  Column,
  Door,
  LayerVisibility,
  Point,
  Polygon,
  Room,
  Selection,
  UniversalBuildingModel,
  Wall,
  Window as UWindow,
} from "../ubm/types";
import { fmtArea, fmtLen, type Unit } from "../ubm/units";
import { confidenceColor, DANGER, HOVER, palette, roomTint, SELECTED } from "./theme";
import { View, worldToScreen } from "./view";

export const HANDLE_PX = 8;

/** Transient, in-progress interaction geometry drawn above the model. */
export interface Overlay {
  cursor: Point | null;
  pendingWall: Point | null;
  rubberRect: [Point, Point] | null;
  measure: [Point, Point] | null;
  snapMark: Point | null;
}

export interface SceneParams {
  ubm: UniversalBuildingModel;
  view: View;
  layers: LayerVisibility;
  selection: Selection | null;
  hover: Selection | null;
  overlay: Overlay;
  grid: boolean;
  dark: boolean;
  unit: Unit;
  width: number; // css px
  height: number; // css px
  dpr: number;
}

const isSel = (sel: Selection | null, kind: Selection["kind"], id: string) =>
  sel?.kind === kind && sel.id === id;

/** Pick a "nice" grid step (metres) so minor lines sit ~24–48px apart on screen. */
function gridStep(scale: number): number {
  const target = 30; // px between minor lines
  const raw = target / scale; // metres
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (pow * m >= raw) return pow * m;
  return pow * 10;
}

function polyPath(ctx: CanvasRenderingContext2D, v: View, poly: Polygon): void {
  ctx.beginPath();
  poly.forEach((p, i) => {
    const [sx, sy] = worldToScreen(v, p);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

/** Screen-space axis-aligned bounding box of a polygon (for room handles). */
export function polyScreenBBox(v: View, poly: Polygon) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const p of poly) {
    const [sx, sy] = worldToScreen(v, p);
    minx = Math.min(minx, sx);
    miny = Math.min(miny, sy);
    maxx = Math.max(maxx, sx);
    maxy = Math.max(maxy, sy);
  }
  return { minx, miny, maxx, maxy };
}

function handle(ctx: CanvasRenderingContext2D, sx: number, sy: number, color = SELECTED): void {
  const h = HANDLE_PX;
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.fillRect(sx - h / 2, sy - h / 2, h, h);
  ctx.strokeRect(sx - h / 2, sy - h / 2, h, h);
}

export function drawScene(ctx: CanvasRenderingContext2D, p: SceneParams): void {
  const { ubm, view: v, layers, selection, hover, overlay, dark, unit } = p;
  const pal = palette(dark);
  const wallAngle = new Map<string, number>();
  for (const w of ubm.walls)
    wallAngle.set(w.id, Math.atan2(w.endPoint[1] - w.startPoint[1], w.endPoint[0] - w.startPoint[0]));

  ctx.setTransform(p.dpr, 0, 0, p.dpr, 0, 0);
  ctx.clearRect(0, 0, p.width, p.height);

  // --- sheet (the drawing surface behind the model) ---
  const bd = ubm.metadata.bounds;
  if (bd) {
    const pad = 0.5;
    const [x0, y0] = worldToScreen(v, [bd.minx - pad, bd.minz - pad]);
    const [x1, y1] = worldToScreen(v, [bd.maxx + pad, bd.maxz + pad]);
    ctx.fillStyle = pal.pageFill;
    ctx.strokeStyle = pal.pageStroke;
    ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  // --- grid ---
  if (p.grid) {
    const minor = gridStep(v.scale);
    const drawGrid = (step: number, color: string, w: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      const [wx0, wy0] = [(0 - v.ox) / v.scale, (0 - v.oy) / v.scale];
      const [wx1, wy1] = [(p.width - v.ox) / v.scale, (p.height - v.oy) / v.scale];
      const startX = Math.floor(wx0 / step) * step;
      const startY = Math.floor(wy0 / step) * step;
      ctx.beginPath();
      for (let x = startX; x <= wx1; x += step) {
        const sx = x * v.scale + v.ox;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, p.height);
      }
      for (let y = startY; y <= wy1; y += step) {
        const sy = y * v.scale + v.oy;
        ctx.moveTo(0, sy);
        ctx.lineTo(p.width, sy);
      }
      ctx.stroke();
    };
    if (minor * v.scale > 6) drawGrid(minor, pal.gridMinor, 1);
    drawGrid(minor * 5, pal.gridMajor, 1);
  }

  const showLabels = v.scale > 14;

  // --- rooms ---
  if (layers.rooms)
    for (const r of ubm.rooms) drawRoom(ctx, v, r, isSel(selection, "room", r.id), isSel(hover, "room", r.id), showLabels, unit);

  // --- balconies ---
  if (layers.balconies)
    for (const b of ubm.balconies) {
      polyPath(ctx, v, b.polygon);
      ctx.fillStyle = pal.balcony + "22";
      ctx.fill();
      ctx.strokeStyle = pal.balcony;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

  // --- stairs ---
  if (layers.stairs)
    for (const s of ubm.stairs) {
      polyPath(ctx, v, s.polygon);
      ctx.fillStyle = pal.stair + "1e";
      ctx.fill();
      ctx.strokeStyle = pal.stair;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      drawStairTreads(ctx, v, s.polygon, pal.stair);
    }

  // --- beams (dashed centrelines) ---
  if (layers.beams)
    for (const b of ubm.beams) {
      const [ax, ay] = worldToScreen(v, b.startPoint);
      const [bx, by] = worldToScreen(v, b.endPoint);
      ctx.strokeStyle = pal.beam;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
    }

  // --- walls ---
  if (layers.walls)
    for (const w of ubm.walls) drawWall(ctx, v, w, isSel(selection, "wall", w.id), isSel(hover, "wall", w.id), pal.wall, pal.wallExterior);

  // --- windows ---
  if (layers.windows)
    for (const wd of ubm.windows)
      drawWindow(ctx, v, wd, wallAngle.get(wd.wallId ?? "") ?? 0, isSel(selection, "window", wd.id), pal.window);

  // --- doors ---
  if (layers.doors)
    for (const d of ubm.doors) drawDoor(ctx, v, d, isSel(selection, "door", d.id), pal.door, pal.doorEntrance);

  // --- columns ---
  if (layers.columns)
    for (const c of ubm.columns) drawColumn(ctx, v, c, isSel(selection, "column", c.id), pal.column);

  // --- annotations ---
  if (layers.annotations && showLabels)
    for (const a of ubm.annotations) {
      const [sx, sy] = worldToScreen(v, a.at);
      ctx.fillStyle = pal.textMuted;
      ctx.font = "italic 11px Inter, sans-serif";
      ctx.fillText(a.text, sx, sy);
    }

  // --- dimensions ---
  for (const dim of ubm.dimensions) {
    const [ax, ay] = worldToScreen(v, dim.a);
    const [bx, by] = worldToScreen(v, dim.b);
    ctx.strokeStyle = pal.textMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = pal.text;
    ctx.font = "11px Inter";
    ctx.fillText(dim.label ?? fmtLen(dim.length_m, unit), (ax + bx) / 2 + 4, (ay + by) / 2 - 4);
  }

  // --- selection handles ---
  drawSelectionHandles(ctx, v, ubm, selection);

  // --- live overlays ---
  drawOverlays(ctx, p, pal.text);
}

function drawRoom(
  ctx: CanvasRenderingContext2D,
  v: View,
  r: Room,
  selected: boolean,
  hovered: boolean,
  showLabels: boolean,
  unit: Unit,
): void {
  polyPath(ctx, v, r.polygon);
  ctx.fillStyle = roomTint(r.type) + "cc";
  ctx.fill();
  ctx.strokeStyle = selected ? SELECTED : hovered ? HOVER : "#94a3b8";
  ctx.lineWidth = selected ? 2 : 1;
  ctx.stroke();
  if (showLabels) {
    const [cx, cy] = worldToScreen(v, centroid(r.polygon));
    ctx.textAlign = "center";
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 12px Inter, sans-serif";
    ctx.fillText(r.name, cx, cy - 2);
    const area = r.area_m2 || polygonArea(r.polygon);
    ctx.fillStyle = "#334155";
    ctx.font = "10px Inter";
    ctx.fillText(fmtArea(area, unit), cx, cy + 12);
    ctx.fillStyle = confidenceColor(r.confidence);
    ctx.fillText(`${Math.round(r.confidence * 100)}%`, cx, cy + 24);
    ctx.textAlign = "left";
  }
}

function drawWall(
  ctx: CanvasRenderingContext2D,
  v: View,
  w: Wall,
  selected: boolean,
  hovered: boolean,
  color: string,
  exteriorColor: string,
): void {
  const [ax, ay] = worldToScreen(v, w.startPoint);
  const [bx, by] = worldToScreen(v, w.endPoint);
  ctx.strokeStyle = selected ? SELECTED : hovered ? HOVER : w.exterior ? exteriorColor : color;
  ctx.lineWidth = Math.max(1.5, w.thickness_m * v.scale);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function drawWindow(
  ctx: CanvasRenderingContext2D,
  v: View,
  wd: UWindow,
  angle: number,
  selected: boolean,
  color: string,
): void {
  const half = wd.width_m / 2;
  const dx = Math.cos(angle) * half;
  const dz = Math.sin(angle) * half;
  const [ax, ay] = worldToScreen(v, [wd.position[0] - dx, wd.position[1] - dz]);
  const [bx, by] = worldToScreen(v, [wd.position[0] + dx, wd.position[1] + dz]);
  ctx.strokeStyle = selected ? DANGER : color;
  ctx.lineWidth = selected ? 5 : 3;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function drawDoor(
  ctx: CanvasRenderingContext2D,
  v: View,
  d: Door,
  selected: boolean,
  color: string,
  entranceColor: string,
): void {
  // Clean opening marker along the wall — no swing arc, no leaf, just the door gap.
  const half = d.width_m / 2;
  const c = Math.cos(d.rotation);
  const s = Math.sin(d.rotation);
  const [ax, ay] = worldToScreen(v, [d.position[0] - c * half, d.position[1] - s * half]);
  const [bx, by] = worldToScreen(v, [d.position[0] + c * half, d.position[1] + s * half]);
  ctx.strokeStyle = selected ? DANGER : d.entrance ? entranceColor : color;
  ctx.lineWidth = selected ? 6 : 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function drawColumn(ctx: CanvasRenderingContext2D, v: View, c: Column, selected: boolean, color: string): void {
  const [sx, sy] = worldToScreen(v, c.at);
  const w = c.width_m * v.scale;
  const h = c.depth_m * v.scale;
  ctx.fillStyle = selected ? DANGER : color;
  ctx.fillRect(sx - w / 2, sy - h / 2, Math.max(3, w), Math.max(3, h));
}

function drawStairTreads(ctx: CanvasRenderingContext2D, v: View, poly: Polygon, color: string): void {
  if (poly.length < 3) return;
  const [ax, ay] = worldToScreen(v, poly[0]);
  const [bx, by] = worldToScreen(v, poly[1]);
  const [dx, dy] = worldToScreen(v, poly[poly.length - 1]);
  ctx.strokeStyle = color + "88";
  ctx.lineWidth = 1;
  const steps = 6;
  ctx.beginPath();
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    ctx.moveTo(ax + (dx - ax) * t, ay + (dy - ay) * t);
    ctx.lineTo(bx + (dx - ax) * t, by + (dy - ay) * t);
  }
  ctx.stroke();
}

function drawSelectionHandles(
  ctx: CanvasRenderingContext2D,
  v: View,
  ubm: UniversalBuildingModel,
  sel: Selection | null,
): void {
  if (!sel) return;
  if (sel.kind === "room") {
    const r = ubm.rooms.find((x) => x.id === sel.id);
    if (!r) return;
    const bb = polyScreenBBox(v, r.polygon);
    ctx.strokeStyle = SELECTED;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(bb.minx, bb.miny, bb.maxx - bb.minx, bb.maxy - bb.miny);
    ctx.setLineDash([]);
    handle(ctx, bb.minx, bb.miny);
    handle(ctx, bb.maxx, bb.miny);
    handle(ctx, bb.minx, bb.maxy);
    handle(ctx, bb.maxx, bb.maxy);
  } else if (sel.kind === "wall") {
    const w = ubm.walls.find((x) => x.id === sel.id);
    if (!w) return;
    const [ax, ay] = worldToScreen(v, w.startPoint);
    const [bx, by] = worldToScreen(v, w.endPoint);
    handle(ctx, ax, ay);
    handle(ctx, bx, by);
  }
}

function drawOverlays(ctx: CanvasRenderingContext2D, p: SceneParams, textColor: string): void {
  const { overlay: o, view: v, unit } = p;

  if (o.rubberRect) {
    const [ax, ay] = worldToScreen(v, o.rubberRect[0]);
    const [bx, by] = worldToScreen(v, o.rubberRect[1]);
    ctx.strokeStyle = SELECTED;
    ctx.fillStyle = SELECTED + "18";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.fillRect(ax, ay, bx - ax, by - ay);
    ctx.strokeRect(ax, ay, bx - ax, by - ay);
    ctx.setLineDash([]);
  }

  if (o.pendingWall && o.cursor) {
    const [ax, ay] = worldToScreen(v, o.pendingWall);
    const [bx, by] = worldToScreen(v, o.cursor);
    ctx.strokeStyle = SELECTED;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    const len = Math.hypot(o.cursor[0] - o.pendingWall[0], o.cursor[1] - o.pendingWall[1]);
    ctx.fillStyle = textColor;
    ctx.font = "600 12px Inter";
    ctx.fillText(fmtLen(len, unit), (ax + bx) / 2 + 6, (ay + by) / 2 - 6);
  }

  if (o.measure) {
    const [ax, ay] = worldToScreen(v, o.measure[0]);
    const [bx, by] = worldToScreen(v, o.measure[1]);
    ctx.strokeStyle = "#7c3aed";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    const len = Math.hypot(o.measure[1][0] - o.measure[0][0], o.measure[1][1] - o.measure[0][1]);
    ctx.fillStyle = "#7c3aed";
    ctx.font = "600 12px Inter";
    ctx.fillText(fmtLen(len, unit), (ax + bx) / 2 + 6, (ay + by) / 2 - 6);
  }

  if (o.snapMark) {
    const [sx, sy] = worldToScreen(v, o.snapMark);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.stroke();
  }
}
