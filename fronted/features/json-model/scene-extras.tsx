"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import type { BuildingInfo } from "@/features/viewer3d/building";

/** Floating name label above each room's centre — small, billboarded via drei's
 *  Html, sized with distanceFactor so it doesn't balloon at close range or
 *  vanish at a distance. Kept out of walk mode by the caller (clutter while
 *  walking) and off entirely when the "Room labels" toggle is unchecked.
 *  `base_y` (optional, defaults to 0) offsets a room's label up by its own
 *  floor's height — the JSON portal passes its own full multi-floor room list
 *  here (not the shared engine's ground-floor-only BuildingInfo.rooms), each
 *  tagged with its storey's base_y, so upper-floor labels sit above the right
 *  ceiling instead of all stacking at ground level. */
export function RoomLabels({ rooms, wallHeight, floorTop }: { rooms: (BuildingInfo["rooms"][number] & { base_y?: number })[]; wallHeight: number; floorTop: number }) {
  return (
    <>
      {rooms.map((r, i) => (
        <Html key={i} position={[r.cx, floorTop + (r.base_y ?? 0) + wallHeight + 0.35, r.cz]} center distanceFactor={14} occlude={false}>
          <div className="pointer-events-none select-none whitespace-nowrap rounded-md bg-slate-900/70 px-2 py-0.5 text-[11px] font-medium text-white shadow backdrop-blur">
            {r.name}
          </div>
        </Html>
      ))}
    </>
  );
}

/** Simple measure-tool overlay: up to two marker spheres + a thin line between
 *  them, with a floating distance label at the midpoint. Not a CAD tool — just
 *  enough to eyeball a distance in the generated model. */
export function MeasureOverlay({ points }: { points: THREE.Vector3[] }) {
  const lineObj = useMemo(() => {
    if (points.length < 2) return null;
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color: "#22c55e", depthTest: false }));
  }, [points]);

  const dist = points.length === 2 ? points[0].distanceTo(points[1]) : 0;
  const mid = points.length === 2 ? points[0].clone().lerp(points[1], 0.5) : null;

  return (
    <>
      {points.map((p, i) => (
        <mesh key={i} position={p} renderOrder={999}>
          <sphereGeometry args={[0.09, 12, 10]} />
          <meshBasicMaterial color="#22c55e" depthTest={false} />
        </mesh>
      ))}
      {lineObj && <primitive object={lineObj} renderOrder={999} />}
      {mid && (
        <Html position={mid} center distanceFactor={10}>
          <div className="pointer-events-none select-none whitespace-nowrap rounded-md bg-emerald-600/90 px-2 py-0.5 text-[11px] font-semibold text-white shadow">
            {dist.toFixed(2)} m
          </div>
        </Html>
      )}
    </>
  );
}
