"use client";

import { useMemo } from "react";
import type { SceneManifest } from "@/types";
import type { BuildingInfo } from "@/features/viewer3d/building";

/** Warm porch/entry sconce beside the building's declared entrance door — a small
 *  emissive fixture (matching the "light" material look furniture-scene.tsx uses
 *  for ceiling_light/night_lamp) plus a real PointLight, both faded in purely by
 *  `nightFactor` (0 at noon, warm/visible toward dawn/dusk — see json-model-viewer.tsx's
 *  `nightFactor` calc, derived from the same sunT the day/night slider drives). */
export function PorchLight({ manifest, info, nightFactor }: { manifest: SceneManifest; info: BuildingInfo | null; nightFactor: number }) {
  const mount = useMemo(() => {
    if (!info) return null;
    const door = manifest.doors?.find((d) => d.entrance) ?? manifest.doors?.[0];
    if (!door) return null;
    const [dx, dz] = door.pos;
    const cx = info.center.x, cz = info.center.z;
    const outX = dx - cx, outZ = dz - cz;
    const len = Math.hypot(outX, outZ) || 1;
    const nx = outX / len, nz = outZ / len; // unit vector pointing outward, away from the building
    const sideX = -nz, sideZ = nx;          // perpendicular — "beside the doorway" offset
    return {
      x: dx + nx * 0.3 + sideX * 0.55,
      z: dz + nz * 0.3 + sideZ * 0.55,
      y: info.floorTop + 2.0, // roughly wall-sconce height
    };
  }, [manifest, info]);

  if (!mount) return null;
  // negligible at midday (nightFactor≈0), warm and visible as the slider nears either end
  const emissive = 0.08 + nightFactor * 1.3;
  const lightIntensity = nightFactor * 1.5;

  return (
    <group position={[mount.x, mount.y, mount.z]}>
      <mesh castShadow>
        <boxGeometry args={[0.1, 0.16, 0.09]} />
        <meshStandardMaterial color="#3a352c" roughness={0.7} metalness={0.25} />
      </mesh>
      <mesh position={[0, -0.11, 0]}>
        <sphereGeometry args={[0.065, 12, 10]} />
        <meshStandardMaterial color="#fff3d6" emissive="#ffd98a" emissiveIntensity={emissive} roughness={0.4} />
      </mesh>
      <pointLight color="#ffdca8" intensity={lightIntensity} distance={5.5} decay={2} position={[0, -0.11, 0]} />
    </group>
  );
}

/** Soft warm glow near each declared window, suggesting an interior light left on
 *  as it gets dark — approximate placement only (no attempt to match the actual
 *  wall-snapped window geometry the Building shell builds). Kept cheap: a small
 *  emissive quad per window always, and a real PointLight only added when the
 *  building doesn't have "a dozen+" windows, so this never tanks frame rate on
 *  large generated floor plans. */
export function WindowGlow({ manifest, nightFactor }: { manifest: SceneManifest; nightFactor: number }) {
  const windows = manifest.windows ?? [];
  if (windows.length === 0 || nightFactor <= 0.001) return null;
  const emissive = 0.05 + nightFactor * 1.1;
  const opacity = 0.12 + nightFactor * 0.5;
  const withLights = windows.length <= 8;

  return (
    <>
      {windows.map((w, i) => {
        const [x, z] = w.pos;
        const len = Math.min(Math.max(w.len ?? 1.2, 0.6), 2.2);
        return (
          <group key={i} position={[x, 1.35, z]}>
            <mesh>
              <boxGeometry args={[len * 0.8, 0.65, 0.03]} />
              <meshStandardMaterial
                color="#fff2d2" emissive="#ffcf7d" emissiveIntensity={emissive}
                roughness={0.6} transparent opacity={opacity}
              />
            </mesh>
            {withLights && <pointLight color="#ffdca8" intensity={nightFactor * 0.45} distance={3} decay={2} />}
          </group>
        );
      })}
    </>
  );
}
