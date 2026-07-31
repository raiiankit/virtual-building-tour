"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { SceneManifest } from "@/types";
import type { BuildingInfo } from "@/features/viewer3d/building";
import { makeFurnitureMaterial } from "./furniture-materials";
import { makeMaterial } from "@/features/viewer3d/materials";

/* Tiny local box/cylinder/sphere helpers — same construction style as
 * furniture-scene.tsx's box()/cyl()/sph(), kept local since those aren't exported. */
function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 0.01), Math.max(sy, 0.01), Math.max(sz, 0.01)), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg = 8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(rt, 0.005), Math.max(rb, 0.005), Math.max(h, 0.01), seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function sph(r: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(r, 0.01), 12, 10), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Small deterministic pseudo-random so trees/fence don't jitter between re-renders. */
function rand(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** A single procedural tree — tapered trunk + a couple of foliage clusters,
 *  matching the "plant" furniture piece's construction in furniture-scene.tsx
 *  (cylinder trunk + sphere foliage) at a much larger, tree-like scale. */
function buildTree(x: number, y: number, z: number, scale: number, seed: number, trunkMat: THREE.Material, foliageMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const trunkH = 1.7 * scale;
  g.add(cyl(0.08 * scale, 0.14 * scale, trunkH, 0, trunkH / 2, 0, trunkMat, 8));
  g.add(sph(0.85 * scale, 0, trunkH + 0.55 * scale, 0, foliageMat));
  g.add(sph(0.55 * scale, 0.38 * scale * (rand(seed + 1) - 0.5), trunkH + 0.95 * scale, 0.38 * scale * (rand(seed + 2) - 0.5), foliageMat));
  g.add(sph(0.5 * scale, -0.36 * scale * (rand(seed + 3) - 0.5), trunkH + 0.8 * scale, -0.32 * scale * (rand(seed + 4) - 0.5), foliageMat));
  g.position.set(x, y, z);
  return g;
}

/** Low perimeter fence — posts + two rails per edge, looping the plot boundary
 *  (assumed axis-aligned, like the rectangular footprints this portal generates). */
function buildFence(halfX: number, halfZ: number, y: number, postMat: THREE.Material, railMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const postH = 0.85, postR = 0.035, spacing = 1.7;
  const edges: { horiz: boolean; from: [number, number]; to: [number, number] }[] = [
    { horiz: true, from: [-halfX, -halfZ], to: [halfX, -halfZ] },
    { horiz: false, from: [halfX, -halfZ], to: [halfX, halfZ] },
    { horiz: true, from: [halfX, halfZ], to: [-halfX, halfZ] },
    { horiz: false, from: [-halfX, halfZ], to: [-halfX, -halfZ] },
  ];
  edges.forEach(({ horiz, from, to }) => {
    const len = horiz ? Math.abs(to[0] - from[0]) : Math.abs(to[1] - from[1]);
    const n = Math.max(2, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = from[0] + (to[0] - from[0]) * t;
      const z = from[1] + (to[1] - from[1]) * t;
      g.add(cyl(postR, postR, postH, x, y + postH / 2, z, postMat, 6));
    }
    const midX = (from[0] + to[0]) / 2, midZ = (from[1] + to[1]) / 2;
    for (const railY of [postH * 0.42, postH * 0.88]) {
      g.add(horiz ? box(len, 0.05, 0.045, midX, y + railY, midZ, railMat) : box(0.045, 0.05, len, midX, y + railY, midZ, railMat));
    }
  });
  return g;
}

/** A single simple lamp post — thin pole + small lantern head, same construction
 *  spirit as buildFence()'s posts but taller and lit. Rendered as plain declarative
 *  JSX (rather than folded into the imperative `built` group below) so its
 *  emissive/point-light intensity can react to `nightFactor` on every slider
 *  drag without rebuilding the whole site-dressing group. */
function StreetLamp({ x, z, y, nightFactor }: { x: number; z: number; y: number; nightFactor: number }) {
  const poleH = 3.2;
  const emissive = 0.08 + nightFactor * 1.25;
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, poleH / 2, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, poleH, 8]} />
        <meshStandardMaterial color="#3a3a3a" roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[0, poleH + 0.09, 0]}>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color="#fff3d6" emissive="#ffd98a" emissiveIntensity={emissive} roughness={0.4} />
      </mesh>
      <pointLight color="#ffdca8" intensity={nightFactor * 1.6} distance={7.5} decay={2} position={[0, poleH + 0.09, 0]} />
    </group>
  );
}

/** Distance (metres) the fence sits beyond the building's half-size, on each
 *  axis — i.e. fence half-extent = info.size/2 + FENCE_MARGIN_M. Exported so
 *  json-model-viewer.tsx's ground planes (lawn + paved apron) can size/fade
 *  themselves consistently with where the fence actually is, instead of a
 *  second, drifting copy of this constant. */
export const FENCE_MARGIN_M = 10.5;

/** Exterior site dressing around a generated building: a low perimeter fence,
 *  a handful of procedural trees, and a short driveway strip from the entrance
 *  (or nearest exterior edge, if none) out to the plot boundary. Purely
 *  decorative and optional — toggled off leaves the existing ground planes as-is.
 *  `nightFactor` (0..1, derived from the day/night slider — see json-model-viewer.tsx)
 *  drives 2-4 streetlamps flanking the driveway; they're part of site context, so
 *  they follow the same on/off toggle as everything else here, no separate switch. */
export function SiteContext({ info, manifest, enabled, nightFactor = 0 }: { info: BuildingInfo | null; manifest: SceneManifest | null; enabled: boolean; nightFactor?: number }) {
  const built = useMemo(() => {
    if (!info) return null;
    const cx = info.center.x, cz = info.center.z, y = info.bounds.min.y + 0.021;
    const maxSize = Math.max(info.size.x, info.size.z);
    // fence sits FENCE_MARGIN_M beyond the building's half-size, well clear of
    // the (much smaller) paved apron right around the building — see Scene's
    // ground group in json-model-viewer.tsx, which sizes the lawn plane off
    // this same constant so the fence never floats past the visible lawn edge.
    const halfX = info.size.x / 2 + FENCE_MARGIN_M, halfZ = info.size.z / 2 + FENCE_MARGIN_M;
    const g = new THREE.Group();

    const postMat = makeFurnitureMaterial("wood");
    const railMat = makeFurnitureMaterial("wood");
    g.add(buildFence(halfX, halfZ, y, postMat, railMat));

    const trunkMat = makeFurnitureMaterial("wood");
    const foliageMat = makeFurnitureMaterial("plant");
    // 4 trees scattered near the plot corners (diagonals), clear of the axis-aligned
    // driveway/door/window faces which sit at 0/90/180/270°.
    for (let i = 0; i < 4; i++) {
      const seed = i * 17.3 + 1;
      const baseAngle = Math.PI / 4 + i * (Math.PI / 2);
      const angle = baseAngle + (rand(seed) - 0.5) * 0.5;
      const radius = Math.max(halfX, halfZ) * 0.62 + 1.5 + rand(seed + 3) * 2;
      const tx = cx + Math.cos(angle) * radius;
      const tz = cz + Math.sin(angle) * radius;
      const scale = (0.8 + rand(seed + 5) * 0.6) * Math.max(0.7, Math.min(2.2, maxSize / 11));
      g.add(buildTree(tx, y, tz, scale, seed, trunkMat, foliageMat));
    }

    // driveway/path: from the entrance (or nearest exterior edge) straight out to the fence line
    const entrance = manifest?.doors?.find((d) => d.entrance)?.pos;
    const ex = entrance ? entrance[0] : cx;
    const ez = entrance ? entrance[1] : info.bounds.min.z;
    const relX = ex - cx, relZ = ez - cz;
    const alongZ = Math.abs(relZ) >= Math.abs(relX);
    const concrete = makeMaterial("concrete");
    const w = 1.8;
    let path: THREE.Mesh;
    if (alongZ) {
      const sign = relZ >= 0 ? 1 : -1;
      const length = Math.max(2, Math.abs(sign * halfZ - relZ));
      const midZ = cz + relZ + (sign * length) / 2;
      path = new THREE.Mesh(new THREE.PlaneGeometry(w, length), concrete);
      path.rotation.x = -Math.PI / 2;
      path.position.set(ex, y + 0.005, midZ);
    } else {
      const sign = relX >= 0 ? 1 : -1;
      const length = Math.max(2, Math.abs(sign * halfX - relX));
      const midX = cx + relX + (sign * length) / 2;
      path = new THREE.Mesh(new THREE.PlaneGeometry(length, w), concrete);
      path.rotation.x = -Math.PI / 2;
      path.position.set(midX, y + 0.005, ez);
    }
    path.receiveShadow = true;
    g.add(path);

    return g;
  }, [info, manifest]);

  useEffect(() => () => {
    built?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }, [built]);

  // 4 lamp posts flanking the driveway (2 near the building end, 2 near the
  // street/fence end) — reuses the same entrance→fence path calc as the
  // driveway strip above so the lamps actually line up with it.
  const lampPositions = useMemo(() => {
    if (!info) return [];
    const cx = info.center.x, cz = info.center.z, y = info.bounds.min.y + 0.021;
    const halfX = info.size.x / 2 + FENCE_MARGIN_M, halfZ = info.size.z / 2 + FENCE_MARGIN_M;
    const entrance = manifest?.doors?.find((d) => d.entrance)?.pos;
    const ex = entrance ? entrance[0] : cx;
    const ez = entrance ? entrance[1] : info.bounds.min.z;
    const relX = ex - cx, relZ = ez - cz;
    const alongZ = Math.abs(relZ) >= Math.abs(relX);
    const perp = 1.3;
    const pts: { x: number; z: number }[] = [];
    if (alongZ) {
      const sign = relZ >= 0 ? 1 : -1;
      const length = Math.max(2, Math.abs(sign * halfZ - relZ));
      for (const t of [0.2, 0.85]) {
        const zz = cz + relZ + sign * length * t;
        pts.push({ x: ex - perp, z: zz }, { x: ex + perp, z: zz });
      }
    } else {
      const sign = relX >= 0 ? 1 : -1;
      const length = Math.max(2, Math.abs(sign * halfX - relX));
      for (const t of [0.2, 0.85]) {
        const xx = cx + relX + sign * length * t;
        pts.push({ x: xx, z: ez - perp }, { x: xx, z: ez + perp });
      }
    }
    return pts.map((p) => ({ ...p, y }));
  }, [info, manifest]);

  if (!built || !enabled) return null;
  return (
    <>
      <primitive object={built} />
      {lampPositions.map((p, i) => <StreetLamp key={i} x={p.x} z={p.z} y={p.y} nightFactor={nightFactor} />)}
    </>
  );
}
