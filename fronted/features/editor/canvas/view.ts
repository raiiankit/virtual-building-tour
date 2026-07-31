/**
 * The view transform between **world metres** and **screen pixels**.
 *
 *   screenX = worldX * scale + ox
 *   screenY = worldZ * scale + oy      (UBM `z` is the in-plan vertical axis)
 *
 * `scale` is pixels-per-metre. The transform is intentionally a plain value object so it
 * can live in a ref and be mutated cheaply inside the render loop without re-rendering React.
 */
import type { Bounds, Point } from "../ubm/types";

export interface View {
  scale: number; // pixels per metre
  ox: number; // screen-space origin x
  oy: number; // screen-space origin y
}

export const MIN_SCALE = 4; // 4 px/m — zoomed way out
export const MAX_SCALE = 600; // 600 px/m — zoomed way in

export const worldToScreen = (v: View, [x, z]: Point): Point => [x * v.scale + v.ox, z * v.scale + v.oy];

export const screenToWorld = (v: View, sx: number, sy: number): Point => [
  (sx - v.ox) / v.scale,
  (sy - v.oy) / v.scale,
];

export const clampScale = (s: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

/** Fit the given world bounds inside a `cw × ch` viewport with a fractional margin. */
export function fitView(bounds: Bounds | null, cw: number, ch: number, margin = 0.88): View {
  if (!bounds || cw <= 0 || ch <= 0) return { scale: 40, ox: cw / 2, oy: ch / 2 };
  const spanX = Math.max(bounds.maxx - bounds.minx, 0.5);
  const spanZ = Math.max(bounds.maxz - bounds.minz, 0.5);
  const scale = clampScale(Math.min(cw / spanX, ch / spanZ) * margin);
  const cx = (bounds.minx + bounds.maxx) / 2;
  const cz = (bounds.minz + bounds.maxz) / 2;
  return { scale, ox: cw / 2 - cx * scale, oy: ch / 2 - cz * scale };
}

/** Zoom around a fixed screen anchor (so the point under the cursor stays put). */
export function zoomAt(v: View, anchorX: number, anchorY: number, factor: number): View {
  const scale = clampScale(v.scale * factor);
  const [wx, wz] = screenToWorld(v, anchorX, anchorY);
  return { scale, ox: anchorX - wx * scale, oy: anchorY - wz * scale };
}
