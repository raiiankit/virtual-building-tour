/**
 * Metric geometry helpers. Everything operates on UBM `[x, z]` points in **metres**.
 * Pure, side-effect-free functions — no React, no canvas, no pixels.
 */
import type { Bounds, Point, Polygon, UniversalBuildingModel, Wall } from "./types";

export const EPS = 1e-6;

export const dist = (a: Point, b: Point): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Signed polygon area via the shoelace formula; sign depends on winding. */
export function signedArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

/** Absolute polygon area in m². */
export const polygonArea = (poly: Polygon): number => Math.abs(signedArea(poly));

/** Perimeter length of a closed polygon in metres. */
export function polygonPerimeter(poly: Polygon): number {
  let p = 0;
  for (let i = 0; i < poly.length; i++) p += dist(poly[i], poly[(i + 1) % poly.length]);
  return p;
}

export function centroid(poly: Polygon): Point {
  if (poly.length === 0) return [0, 0];
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}

/** Bounding box of a set of points. */
export function boundsOf(points: Point[]): Bounds | null {
  if (points.length === 0) return null;
  let minx = Infinity;
  let minz = Infinity;
  let maxx = -Infinity;
  let maxz = -Infinity;
  for (const [x, z] of points) {
    if (x < minx) minx = x;
    if (z < minz) minz = z;
    if (x > maxx) maxx = x;
    if (z > maxz) maxz = z;
  }
  return { minx, minz, maxx, maxz };
}

/** Footprint bounds of the whole model (rooms + wall endpoints), matching the backend. */
export function modelBounds(ubm: UniversalBuildingModel): Bounds | null {
  const pts: Point[] = [
    ...ubm.rooms.flatMap((r) => r.polygon),
    ...ubm.walls.flatMap((w) => [w.startPoint, w.endPoint]),
  ];
  return boundsOf(pts);
}

export function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > p[1] !== zj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi + EPS) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Parameter t in [0,1] of the closest point on segment a→b to p. */
export function projectParam(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  return Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
}

export function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const t = projectParam(p, a, b);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

export const distToSegment = (p: Point, a: Point, b: Point): number =>
  dist(p, closestOnSegment(p, a, b));

/** Nearest wall to a point within `tol` metres, with the projected point and its angle. */
export function nearestWall(
  p: Point,
  walls: Wall[],
  tol: number,
): { wall: Wall; at: Point; angle: number; d: number } | null {
  let best: { wall: Wall; at: Point; angle: number; d: number } | null = null;
  for (const w of walls) {
    const at = closestOnSegment(p, w.startPoint, w.endPoint);
    const d = dist(p, at);
    if (d <= tol && (!best || d < best.d)) {
      const angle = Math.atan2(
        w.endPoint[1] - w.startPoint[1],
        w.endPoint[0] - w.startPoint[0],
      );
      best = { wall: w, at, angle, d };
    }
  }
  return best;
}

/** Translate every vertex of a polygon by (dx, dz). */
export const translatePolygon = (poly: Polygon, dx: number, dz: number): Polygon =>
  poly.map(([x, z]) => [x + dx, z + dz] as Point);

/** Axis-aligned rectangle (4 CCW vertices) from two opposite corners. */
export function rectPolygon(a: Point, b: Point): Polygon {
  const x0 = Math.min(a[0], b[0]);
  const z0 = Math.min(a[1], b[1]);
  const x1 = Math.max(a[0], b[0]);
  const z1 = Math.max(a[1], b[1]);
  return [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
}

export const roundP = (p: Point, dp = 3): Point => [
  Number(p[0].toFixed(dp)),
  Number(p[1].toFixed(dp)),
];
