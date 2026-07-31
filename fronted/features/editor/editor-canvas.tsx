"use client";

/**
 * The interactive drawing surface. Owns the view transform, the pointer gestures for every
 * tool, and the render loop — all built on the pure engines in ./canvas. It never stores
 * geometry itself: edits flow up through `edit()` (which mutates the UBM held by the
 * orchestrator) and history is bracketed by `snapshot()` at the start of each gesture.
 */
import { useCallback, useEffect, useRef } from "react";
import { drawScene, type Overlay } from "./canvas/render";
import { eventWorld, hitHandle, pickAt, snapPoint, type HandleHit } from "./canvas/interaction";
import { fitView, zoomAt, type View } from "./canvas/view";
import { SNAP_STEP_M } from "./constants";
import {
  makeColumn,
  makeDoor,
  makeRoom,
  makeWall,
  makeWindow,
  withRoomArea,
  withWallLength,
} from "./ubm/factory";
import { boundsOf, modelBounds, nearestWall, rectPolygon, roundP } from "./ubm/geometry";
import type {
  LayerVisibility,
  Point,
  Polygon,
  Selection,
  Tool,
  UniversalBuildingModel,
} from "./ubm/types";
import type { Unit } from "./ubm/units";

export interface EditorCanvasProps {
  ubm: UniversalBuildingModel;
  tool: Tool;
  setTool: (t: Tool) => void;
  selection: Selection | null;
  setSelection: (s: Selection | null) => void;
  layers: LayerVisibility;
  grid: boolean;
  snap: boolean;
  unit: Unit;
  snapshot: () => void;
  mutate: (fn: (d: UniversalBuildingModel) => UniversalBuildingModel) => void;
  onCursor: (p: Point | null) => void;
  onZoom: (pct: number) => void;
  /** Increment to trigger a "fit to screen". */
  fitSignal: number;
}

type Drag =
  | { mode: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { mode: "move"; start: Point; sel: Selection; orig: unknown }
  | { mode: "resize-room"; roomId: string; fixed: Point; origPoly: Polygon }
  | { mode: "wall-end"; wallId: string; end: "start" | "end" }
  | { mode: "new-room"; start: Point }
  | { mode: "measure" };

const emptyOverlay = (): Overlay => ({
  cursor: null,
  pendingWall: null,
  rubberRect: null,
  measure: null,
  snapMark: null,
});

export function EditorCanvas(props: EditorCanvasProps) {
  const { ubm, mutate, snapshot } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const docRef = useRef<UniversalBuildingModel>(ubm);
  const dragRef = useRef<Drag | null>(null);
  const overlayRef = useRef<Overlay>(emptyOverlay());
  const spaceRef = useRef(false);
  const pendingWallRef = useRef<Point | null>(null);

  // Keep refs pointing at the latest props so the stable draw() closure never goes stale.
  const stateRef = useRef(props);
  stateRef.current = props;
  docRef.current = ubm;

  /* --------------------------------- render --------------------------------- */
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    const view = viewRef.current;
    if (!cv || !wrap || !view) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (cv.width !== cw * dpr || cv.height !== ch * dpr) {
      cv.width = cw * dpr;
      cv.height = ch * dpr;
      cv.style.width = `${cw}px`;
      cv.style.height = `${ch}px`;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const s = stateRef.current;
    drawScene(ctx, {
      ubm: docRef.current,
      view,
      layers: s.layers,
      selection: s.selection,
      hover: null,
      overlay: { ...overlayRef.current, pendingWall: pendingWallRef.current },
      grid: s.grid,
      dark: document.documentElement.classList.contains("dark"),
      unit: s.unit,
      width: cw,
      height: ch,
      dpr,
    });
  }, []);

  const edit = useCallback(
    (fn: (d: UniversalBuildingModel) => UniversalBuildingModel) => {
      const next = fn(docRef.current);
      docRef.current = next;
      mutate(() => next);
      draw();
    },
    [mutate, draw],
  );

  const doFit = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || wrap.clientWidth === 0) return; // wait for a real layout before locking the view
    const bounds = docRef.current.metadata.bounds ?? modelBounds(docRef.current);
    viewRef.current = fitView(bounds, wrap.clientWidth, wrap.clientHeight);
    stateRef.current.onZoom(Math.round(viewRef.current.scale));
    draw();
  }, [draw]);

  /* ---- initialise + keep in sync ---- */
  useEffect(() => {
    if (!viewRef.current) doFit();
    else draw();
  }, [ubm, props.tool, props.selection, props.layers, props.grid, props.unit, draw, doFit]);

  useEffect(() => {
    if (props.fitSignal > 0) doFit();
  }, [props.fitSignal, doFit]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (!viewRef.current) doFit();
      else draw();
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw, doFit]);

  // Space = temporary pan.
  useEffect(() => {
    const tag = (e: KeyboardEvent) => (e.target as HTMLElement)?.tagName;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && tag(e) !== "INPUT") spaceRef.current = true;
      if (e.key === "Escape") {
        pendingWallRef.current = null;
        overlayRef.current.measure = null;
        overlayRef.current.rubberRect = null;
        dragRef.current = null;
        draw();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [draw]);

  /* --------------------------- placement helpers --------------------------- */

  /** World point under the event, snapped for create/precise tools. */
  const placePoint = useCallback((world: Point, excludeWallId?: string): { point: Point; onFeature: boolean } => {
    const s = stateRef.current;
    return snapPoint(world, docRef.current, viewRef.current!, {
      grid: s.grid,
      gridStepM: SNAP_STEP_M,
      features: s.snap,
      tolPx: 12,
      excludeWallId,
    });
  }, []);

  /* ------------------------------- pointer -------------------------------- */
  const onPointerDown = (e: React.PointerEvent) => {
    const cv = canvasRef.current;
    const view = viewRef.current;
    if (!cv || !view) return;
    cv.setPointerCapture(e.pointerId);
    const s = stateRef.current;
    const world = eventWorld(view, cv, e.clientX, e.clientY);

    // pan: middle / right button, space held, or the pan tool
    if (e.button === 1 || e.button === 2 || spaceRef.current || s.tool === "pan") {
      dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
      return;
    }

    if (s.tool === "select") return onSelectDown(e, world);
    if (s.tool === "room") {
      dragRef.current = { mode: "new-room", start: placePoint(world).point };
      return;
    }
    if (s.tool === "wall") return onWallDown(world);
    if (s.tool === "door" || s.tool === "window") return onOpeningDown(world, s.tool);
    if (s.tool === "column") return onColumnDown(world);
    if (s.tool === "measure") {
      const p = placePoint(world).point;
      overlayRef.current.measure = [p, p];
      dragRef.current = { mode: "measure" };
      draw();
    }
  };

  const onSelectDown = (e: React.PointerEvent, world: Point) => {
    const view = viewRef.current!;
    const cv = canvasRef.current!;
    const s = stateRef.current;
    const rect = cv.getBoundingClientRect();
    const handle: HandleHit | null = hitHandle(view, docRef.current, s.selection, e.clientX - rect.left, e.clientY - rect.top);

    if (handle?.type === "room-corner" && s.selection?.kind === "room") {
      const r = docRef.current.rooms.find((x) => x.id === s.selection!.id);
      if (r) {
        snapshot();
        const bb = boundsOf(r.polygon)!;
        // fixed = the corner diagonally opposite the grabbed one
        const corners: Point[] = [
          [bb.maxx, bb.maxz],
          [bb.minx, bb.maxz],
          [bb.maxx, bb.minz],
          [bb.minx, bb.minz],
        ];
        dragRef.current = { mode: "resize-room", roomId: r.id, fixed: corners[handle.corner], origPoly: r.polygon };
        return;
      }
    }
    if (handle?.type === "wall-end" && s.selection?.kind === "wall") {
      snapshot();
      dragRef.current = { mode: "wall-end", wallId: s.selection.id, end: handle.end };
      return;
    }

    const hit = pickAt(docRef.current, world, view, s.layers);
    props.setSelection(hit);
    if (hit) {
      snapshot();
      const orig = cloneOf(docRef.current, hit);
      dragRef.current = { mode: "move", start: world, sel: hit, orig };
    }
  };

  const onWallDown = (world: Point) => {
    const p = placePoint(world).point;
    if (!pendingWallRef.current) {
      pendingWallRef.current = p;
      overlayRef.current.cursor = p;
      draw();
    } else {
      const a = pendingWallRef.current;
      snapshot();
      edit((d) => ({ ...d, walls: [...d.walls, makeWall(roundP(a), roundP(p))] }));
      pendingWallRef.current = null;
    }
  };

  const onOpeningDown = (world: Point, tool: "door" | "window") => {
    const near = nearestWall(world, docRef.current.walls, 0.8);
    const pos = near ? roundP(near.at) : roundP(placePoint(world).point);
    snapshot();
    if (tool === "door") {
      const door = makeDoor(pos, near?.wall.id ?? null, near?.angle ?? 0);
      edit((d) => ({ ...d, doors: [...d.doors, door] }));
      props.setSelection({ kind: "door", id: door.id });
    } else {
      const win = makeWindow(pos, near?.wall.id ?? null);
      edit((d) => ({ ...d, windows: [...d.windows, win] }));
      props.setSelection({ kind: "window", id: win.id });
    }
  };

  const onColumnDown = (world: Point) => {
    const col = makeColumn(roundP(placePoint(world).point));
    snapshot();
    edit((d) => ({ ...d, columns: [...d.columns, col] }));
    props.setSelection({ kind: "column", id: col.id });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cv = canvasRef.current;
    const view = viewRef.current;
    if (!cv || !view) return;
    const world = eventWorld(view, cv, e.clientX, e.clientY);
    const drag = dragRef.current;

    // cursor read-out + create-tool snap indicator + wall rubber preview
    if (!drag || drag.mode === "measure") {
      const s = stateRef.current;
      const isCreate = s.tool === "wall" || s.tool === "room" || s.tool === "door" || s.tool === "window" || s.tool === "column";
      const snapped = isCreate ? placePoint(world) : { point: world, onFeature: false };
      overlayRef.current.cursor = snapped.point;
      overlayRef.current.snapMark = snapped.onFeature ? snapped.point : null;
      props.onCursor(snapped.point);
    }

    if (!drag) {
      if (pendingWallRef.current || overlayRef.current.snapMark) draw();
      return;
    }

    switch (drag.mode) {
      case "pan": {
        view.ox = drag.ox + (e.clientX - drag.sx);
        view.oy = drag.oy + (e.clientY - drag.sy);
        draw();
        break;
      }
      case "new-room": {
        overlayRef.current.rubberRect = [drag.start, placePoint(world).point];
        draw();
        break;
      }
      case "measure": {
        const start = overlayRef.current.measure?.[0] ?? placePoint(world).point;
        overlayRef.current.measure = [start, placePoint(world).point];
        draw();
        break;
      }
      case "resize-room": {
        const corner = placePoint(world).point;
        const np = remapPolygon(drag.origPoly, drag.fixed, corner);
        edit((d) => ({
          ...d,
          rooms: d.rooms.map((r) => (r.id === drag.roomId ? withRoomArea({ ...r, polygon: np }) : r)),
        }));
        break;
      }
      case "wall-end": {
        const p = roundP(placePoint(world, drag.wallId).point);
        edit((d) => ({
          ...d,
          walls: d.walls.map((w) =>
            w.id === drag.wallId
              ? withWallLength(drag.end === "start" ? { ...w, startPoint: p } : { ...w, endPoint: p })
              : w,
          ),
        }));
        break;
      }
      case "move": {
        applyMove(drag, world);
        break;
      }
    }
  };

  const applyMove = (drag: Extract<Drag, { mode: "move" }>, world: Point) => {
    const step = stateRef.current.snap ? SNAP_STEP_M : 0;
    const q = (v: number) => (step ? Math.round(v / step) * step : v);
    const dx = q(world[0] - drag.start[0]);
    const dz = q(world[1] - drag.start[1]);
    const { sel, orig } = drag;

    if (sel.kind === "room") {
      const o = orig as Polygon;
      const np = o.map(([x, z]) => [x + dx, z + dz] as Point);
      edit((d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === sel.id ? { ...r, polygon: np } : r)) }));
    } else if (sel.kind === "wall") {
      const o = orig as { startPoint: Point; endPoint: Point };
      edit((d) => ({
        ...d,
        walls: d.walls.map((w) =>
          w.id === sel.id
            ? { ...w, startPoint: [o.startPoint[0] + dx, o.startPoint[1] + dz], endPoint: [o.endPoint[0] + dx, o.endPoint[1] + dz] }
            : w,
        ),
      }));
    } else if (sel.kind === "column") {
      const o = orig as Point;
      edit((d) => ({ ...d, columns: d.columns.map((c) => (c.id === sel.id ? { ...c, at: [o[0] + dx, o[1] + dz] } : c)) }));
    } else {
      // door / window — move, then re-snap onto the nearest wall so it stays attached
      const o = orig as Point;
      const moved: Point = [o[0] + dx, o[1] + dz];
      const near = nearestWall(moved, docRef.current.walls, 0.8);
      const pos = near ? near.at : moved;
      if (sel.kind === "door") {
        edit((d) => ({
          ...d,
          doors: d.doors.map((dr) =>
            dr.id === sel.id ? { ...dr, position: roundP(pos), wallId: near?.wall.id ?? dr.wallId, rotation: near?.angle ?? dr.rotation } : dr,
          ),
        }));
      } else {
        edit((d) => ({
          ...d,
          windows: d.windows.map((wn) => (wn.id === sel.id ? { ...wn, position: roundP(pos), wallId: near?.wall.id ?? wn.wallId } : wn)),
        }));
      }
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag?.mode === "new-room" && overlayRef.current.rubberRect) {
      const [a, b] = overlayRef.current.rubberRect;
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      if (w > 0.4 && h > 0.4) {
        snapshot();
        const room = makeRoom(rectPolygon(roundP(a), roundP(b)));
        edit((d) => ({ ...d, rooms: [...d.rooms, room] }));
        props.setSelection({ kind: "room", id: room.id });
        props.setTool("select");
      }
      overlayRef.current.rubberRect = null;
    }
    if (drag?.mode === "measure") {
      // keep the measure line on screen until the tool changes / next measure
    }
    dragRef.current = null;
    draw();
  };

  const onWheel = (e: React.WheelEvent) => {
    const cv = canvasRef.current;
    const view = viewRef.current;
    if (!cv || !view) return;
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    const next = zoomAt(view, e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    viewRef.current = next;
    props.onZoom(Math.round(next.scale));
    draw();
  };

  const cursorClass =
    props.tool === "pan" ? "cursor-grab" : props.tool === "select" ? "cursor-default" : "cursor-crosshair";

  return (
    <div ref={wrapRef} className="relative h-full w-full touch-none bg-slate-100 dark:bg-slate-900">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 ${cursorClass}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={() => {
          if (stateRef.current.selection?.kind === "room") document.getElementById("prop-room-name")?.focus();
        }}
      />
      {props.tool === "wall" && pendingWallRef.current && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-white">
          Click to set the wall end · Esc to cancel
        </div>
      )}
    </div>
  );
}

/* ------------------------------- pure helpers ------------------------------ */

function cloneOf(ubm: UniversalBuildingModel, sel: Selection): unknown {
  switch (sel.kind) {
    case "room":
      return structuredClone(ubm.rooms.find((r) => r.id === sel.id)!.polygon);
    case "wall": {
      const w = ubm.walls.find((x) => x.id === sel.id)!;
      return { startPoint: [...w.startPoint], endPoint: [...w.endPoint] };
    }
    case "column":
      return [...ubm.columns.find((c) => c.id === sel.id)!.at];
    case "door":
      return [...ubm.doors.find((d) => d.id === sel.id)!.position];
    case "window":
      return [...ubm.windows.find((w) => w.id === sel.id)!.position];
  }
}

/** Rescale a polygon so its bbox spans between a fixed corner and a moved corner. */
function remapPolygon(poly: Polygon, fixed: Point, moved: Point): Polygon {
  const bb = boundsOf(poly)!;
  const oldW = bb.maxx - bb.minx || 1e-6;
  const oldH = bb.maxz - bb.minz || 1e-6;
  const newMinX = Math.min(fixed[0], moved[0]);
  const newMaxX = Math.max(fixed[0], moved[0]);
  const newMinZ = Math.min(fixed[1], moved[1]);
  const newMaxZ = Math.max(fixed[1], moved[1]);
  const newW = Math.max(newMaxX - newMinX, 0.1);
  const newH = Math.max(newMaxZ - newMinZ, 0.1);
  return poly.map(([x, z]) => [
    newMinX + ((x - bb.minx) / oldW) * newW,
    newMinZ + ((z - bb.minz) / oldH) * newH,
  ] as Point);
}
