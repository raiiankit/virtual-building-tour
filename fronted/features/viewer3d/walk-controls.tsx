"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const isVisible = (o: THREE.Object3D | null) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

/** First-person / walk controls: pointer-lock look, WASD move with raycast wall
 *  collision (per-axis sliding, doorways pass through), inertia, and gravity that
 *  follows the floor/stair surface below so staircases are actually climbable. */
export function WalkControls({ enabled, collidables, walkSurfaces, floorTop, eye = 1.7 }: {
  enabled: boolean; collidables: THREE.Mesh[]; walkSurfaces: THREE.Mesh[]; floorTop: number; eye?: number;
}) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const vel = useRef(new THREE.Vector3());
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const groundRay = useMemo(() => new THREE.Raycaster(), []);
  const locked = useRef(false);
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));

  useEffect(() => {
    if (!enabled) { keys.current = {}; return; }
    // Arrow keys (and Space) scroll the page by default — swallow that while walking
    // so they drive the camera instead of jumping the viewport around.
    const nav = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
    const kd = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
      if (nav.has(e.code)) e.preventDefault();
    };
    const ku = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", kd, { passive: false });
    window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [enabled]);

  // Custom pointer-lock look — requestPointerLock() can reject (double-click, focus,
  // sandbox); drei's control logs that as an uncaught error, so we own it and swallow it.
  useEffect(() => {
    if (!enabled) return;
    const el = gl.domElement as HTMLCanvasElement;
    const onClick = () => {
      if (document.pointerLockElement === el) return;
      try { const p = el.requestPointerLock() as unknown as Promise<void> | undefined; p?.catch?.(() => {}); }
      catch { /* pointer lock unavailable — orbit-free look just won't engage */ }
    };
    const onLockChange = () => { locked.current = document.pointerLockElement === el; };
    const onMove = (e: MouseEvent) => {
      if (!locked.current) return;
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y -= e.movementX * 0.0022;
      euler.current.x -= e.movementY * 0.0022;
      const lim = Math.PI / 2 - 0.05;
      euler.current.x = Math.max(-lim, Math.min(lim, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };
    el.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [enabled, camera, gl]);

  const blocked = (from: THREE.Vector3, dir: THREE.Vector3, dist: number) => {
    if (!collidables.length) return false;
    ray.set(from, dir); ray.far = dist; ray.near = 0;
    return ray.intersectObjects(collidables, false).length > 0;
  };

  useFrame((_, delta) => {
    if (!enabled) return;
    const dt = Math.min(delta, 0.05);
    const k = keys.current;
    const run = k.ShiftLeft || k.ShiftRight;
    const speed = run ? 4.4 : 2.4;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1); dir.normalize();
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize();

    const target = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) target.add(dir);
    if (k.KeyS || k.ArrowDown) target.sub(dir);
    if (k.KeyD) target.add(right);           // A/D strafe
    if (k.KeyA) target.sub(right);
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed);

    // ← / → turn the view so keyboard-only users can look around without the mouse
    // (WASD still strafes). Yaw only — pitch is left to the pointer-lock look.
    const turn = (k.ArrowLeft ? 1 : 0) - (k.ArrowRight ? 1 : 0);
    if (turn) {
      euler.current.setFromQuaternion(camera.quaternion);
      euler.current.y += turn * 1.8 * dt;
      camera.quaternion.setFromEuler(euler.current);
    }

    vel.current.lerp(target, Math.min(1, dt * 7)); // acceleration + inertia
    const pos = camera.position;
    const sx = vel.current.x * dt, sz = vel.current.z * dt;
    if (Math.abs(sx) > 1e-4) { const d = new THREE.Vector3(Math.sign(sx), 0, 0); if (!blocked(pos, d, Math.abs(sx) + 0.35)) pos.x += sx; else vel.current.x = 0; }
    if (Math.abs(sz) > 1e-4) { const d = new THREE.Vector3(0, 0, Math.sign(sz)); if (!blocked(pos, d, Math.abs(sz) + 0.35)) pos.z += sz; else vel.current.z = 0; }

    // gravity / floor-follow: stand on the nearest walk surface (floor slab or stair
    // tread) directly below the head, so stairs are climbed smoothly. Over a void
    // (e.g. the stairwell hole) keep the current height instead of falling through.
    let groundY = floorTop;
    if (walkSurfaces.length) {
      groundRay.set(new THREE.Vector3(pos.x, pos.y + 0.2, pos.z), DOWN);
      groundRay.near = 0; groundRay.far = eye + 2.2;
      const hit = groundRay.intersectObjects(walkSurfaces, false).find((h) => isVisible(h.object));
      groundY = hit ? hit.point.y : pos.y - eye;
    }
    pos.y += (groundY + eye - pos.y) * Math.min(1, dt * 10);   // smooth step-to-step glide
  });

  return null;
}
