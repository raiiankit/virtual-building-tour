"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";

const DEFAULT_FOV = 55;
const MIN_FOV = 25;
const MAX_FOV = 55;

/** Portal-local walk-mode add-ons layered ON TOP of the shared, production `WalkControls`
 *  (features/viewer3d/walk-controls.tsx) — kept out of that file since it's shared with the
 *  main viewer3d.tsx and this portal shouldn't change that component's behavior for other
 *  callers. This component does nothing but read/nudge the camera each frame; it never touches
 *  WalkControls' internals.
 *
 *  1. Scroll-wheel "binoculars" zoom — narrows the camera's FOV while scrolling in walk mode.
 *     A first-person camera shouldn't dolly forward/back on scroll the way OrbitControls does;
 *     that would physically move the camera through walls/furniture and fight WalkControls'
 *     collision raycasts. Narrowing FOV instead gives a natural "zoom in to look at something"
 *     feel without moving the camera. Lerped smoothly (not snapped) and reset to the Canvas's
 *     default FOV the moment walk mode is left, so Orbit/Top never inherit a zoomed FOV.
 *
 *  2. A very subtle head-bob — small sinusoidal vertical + lateral camera offset driven by the
 *     camera's OWN actual horizontal displacement each frame. Rather than reaching into
 *     WalkControls' private velocity/key state, this measures how far the camera actually moved
 *     (post wall-collision, post inertia) and derives a "how fast am I walking" signal directly
 *     from that — simpler and always consistent with what WalkControls actually did this frame.
 *     Runs in its own useFrame that mounts strictly AFTER WalkControls in the component tree, so
 *     it always reads the post-move position and layers its offset on top rather than racing it.
 *     Each frame, last frame's bob offset is subtracted back out before measuring displacement
 *     and computing the new offset, so the bob never contaminates its own speed measurement or
 *     accumulates drift. amplitude is capped in the few-centimetre range specifically to avoid
 *     motion sickness — this is meant to be felt, not seen.
 */
export function WalkEnhancements({ active }: { active: boolean }) {
  const { camera, gl } = useThree();
  const targetFov = useRef(DEFAULT_FOV);
  const lastTrue = useRef<THREE.Vector3 | null>(null);
  const bob = useRef({ phase: 0, y: 0, lateral: 0 });

  // Scroll-to-zoom listener — only wired up while walk mode is active.
  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      targetFov.current = THREE.MathUtils.clamp(targetFov.current + Math.sign(e.deltaY) * 2.5, MIN_FOV, MAX_FOV);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [active, gl]);

  // Reset state on enter, and restore the default FOV on exit (position needs no explicit
  // cleanup — ModeFit already re-frames the camera whenever mode changes away from "walk").
  useEffect(() => {
    if (!active) return;
    targetFov.current = (camera as THREE.PerspectiveCamera).fov || DEFAULT_FOV;
    lastTrue.current = null;
    bob.current = { phase: 0, y: 0, lateral: 0 };
    return () => {
      const cam = camera as THREE.PerspectiveCamera;
      cam.fov = DEFAULT_FOV;
      cam.updateProjectionMatrix();
    };
  }, [active, camera]);

  useFrame((_, delta) => {
    if (!active) return;
    const dt = Math.min(delta, 0.05);
    const cam = camera as THREE.PerspectiveCamera;

    if (Math.abs(cam.fov - targetFov.current) > 0.01) {
      cam.fov += (targetFov.current - cam.fov) * Math.min(1, dt * 8);
      cam.updateProjectionMatrix();
    }

    const pos = camera.position;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    if (right.lengthSq() > 1e-6) right.normalize(); else right.set(1, 0, 0);

    // undo last frame's bob to recover the "true" WalkControls-driven position
    pos.y -= bob.current.y;
    pos.addScaledVector(right, -bob.current.lateral);

    if (lastTrue.current) {
      const dx = pos.x - lastTrue.current.x, dz = pos.z - lastTrue.current.z;
      const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;          // m/s, from actual movement
      const moving = THREE.MathUtils.clamp(speed / 2.4, 0, 1.6);   // ~1 at normal walk speed
      bob.current.phase += dt * (7 + moving * 5);
      const fade = Math.min(1, moving / 0.15);                    // fades out at a stand-still
      const ampY = 0.018 * fade;      // ~1.8cm vertical bob at full pace — subtle, not floaty
      const ampX = 0.01 * fade;       // slight lateral sway, smaller than vertical
      bob.current.y = Math.sin(bob.current.phase * 2) * ampY;      // double-frequency (footfall) bounce
      bob.current.lateral = Math.sin(bob.current.phase) * ampX;
    } else {
      bob.current.y = 0; bob.current.lateral = 0;
    }
    lastTrue.current = pos.clone();

    // (re)apply this frame's bob
    pos.y += bob.current.y;
    pos.addScaledVector(right, bob.current.lateral);
  });

  return null;
}
