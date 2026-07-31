"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SceneManifest } from "@/types";
import { buildArchitecture } from "./generate";

export interface RoomW { name: string; type: string; cx: number; cz: number; w: number; d: number; }
export interface BuildingInfo { rooms: RoomW[]; bounds: THREE.Box3; center: THREE.Vector3; size: THREE.Vector3; floorTop: number; collidables: THREE.Mesh[]; levelGroups: THREE.Group[]; walkSurfaces: THREE.Mesh[]; }

/** Procedurally-generated architectural shell (walls, floors, ceilings, doors,
 *  windows, skirting, balcony, textured facade) built from the approved plan — no GLB. */
export function Building({ manifest, ceilingsVisible, roofVisible = true, wallColor, facadeColor, onReady }: {
  manifest: SceneManifest | null; ceilingsVisible: boolean; roofVisible?: boolean;
  wallColor?: string; facadeColor?: string; onReady: (info: BuildingInfo) => void;
}) {
  const built = useMemo(
    () => (manifest?.walls?.length ? buildArchitecture(manifest, { ceilings: true, wallColor, facadeColor }) : null),
    [manifest, wallColor, facadeColor],
  );

  useEffect(() => { built?.ceilings.forEach((c) => (c.visible = ceilingsVisible)); }, [ceilingsVisible, built]);
  useEffect(() => { if (built) built.roof.visible = roofVisible; }, [roofVisible, built]);
  useEffect(() => {
    if (built) onReady({ rooms: built.rooms, bounds: built.bounds, center: built.center, size: built.size, floorTop: built.floorTop, collidables: built.collidables, levelGroups: built.levelGroups, walkSurfaces: built.walkSurfaces });
  }, [built, onReady]);

  if (!built) return null;
  return <primitive object={built.group} />;
}
