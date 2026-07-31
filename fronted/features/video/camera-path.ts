import * as THREE from "three";
import type { BuiltScene, RoomWorld } from "./three-scene";
import type { CameraStyle } from "./video-config";

export type OverlayKind = "intro" | "outro" | "room" | null;
export interface CamState { pos: THREE.Vector3; look: THREE.Vector3 }
export interface Segment { dur: number; sample: (u: number) => CamState; overlay?: OverlayKind; label?: string }

const PRESETS: Record<CameraStyle, { ext: number; room: number; orbit: number; height: number; interiorFirst?: boolean; droneHeavy?: boolean }> = {
  cinematic:  { ext: 4.2, room: 2.4, orbit: 130, height: 0.42 },
  architect:  { ext: 3.0, room: 2.2, orbit: 90,  height: 0.30 },
  drone:      { ext: 5.5, room: 1.6, orbit: 200, height: 0.75, droneHeavy: true },
  interior:   { ext: 2.4, room: 2.8, orbit: 70,  height: 0.28, interiorFirst: true },
  quick:      { ext: 2.2, room: 1.4, orbit: 90,  height: 0.35 },
  luxury:     { ext: 5.0, room: 3.0, orbit: 150, height: 0.45 },
  realestate: { ext: 3.6, room: 2.4, orbit: 120, height: 0.40 },
};

const ease = (u: number) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const lerpV = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);

/** Order rooms with a nearest-neighbour walk starting from the entrance. */
function orderRooms(rooms: RoomWorld[], start: [number, number]): RoomWorld[] {
  const left = [...rooms]; const out: RoomWorld[] = []; let cur = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((r, i) => { const d = Math.hypot(r.cx - cur[0], r.cz - cur[1]); if (d < bd) { bd = d; bi = i; } });
    const r = left.splice(bi, 1)[0]; out.push(r); cur = [r.cx, r.cz];
  }
  return out;
}

export function buildPath(b: BuiltScene, style: CameraStyle, speed: number): { segments: Segment[]; total: number; meta: { project?: string } } {
  const P = PRESETS[style];
  const eye = b.floorTop + 1.55;
  const C = V(b.bounds.cx, b.floorTop + 1.4, b.bounds.cz);
  const maxSize = Math.max(b.bounds.sizeX, b.bounds.sizeZ);
  const orbR = maxSize * 0.95 + 8;
  const orbY = b.floorTop + eye + maxSize * P.height;
  const entrance = b.entrance ?? [b.bounds.cx, b.bounds.maxZ];
  const rooms = orderRooms(b.rooms, entrance);

  const segs: Segment[] = [];
  const sp = 1 / Math.max(0.35, speed); // higher speed → shorter durations
  let last: CamState = { pos: V(0, 0, 0), look: C.clone() };
  const push = (s: Segment) => { segs.push(s); last = s.sample(1); };

  // 1) exterior orbit (intro)
  const a0 = Math.atan2(entrance[1] - b.bounds.cz, entrance[0] - b.bounds.cx);
  const a1 = a0 + (P.orbit * Math.PI) / 180;
  push({ dur: P.ext * sp, overlay: "intro", sample: (u) => { const a = a0 + (a1 - a0) * ease(u); const rr = orbR * (1.16 - 0.16 * ease(u)); return { pos: V(b.bounds.cx + Math.cos(a) * rr, orbY - (orbY - eye - 2) * 0.25 * ease(u), b.bounds.cz + Math.sin(a) * rr), look: C.clone() }; } });

  // 2) approach + move through entrance to interior
  const inDir = V(b.bounds.cx - entrance[0], 0, b.bounds.cz - entrance[1]).normalize();
  const doorOut = V(entrance[0] - inDir.x * 3, eye, entrance[1] - inDir.z * 3);
  const doorIn = V(entrance[0] + inDir.x * (rooms[0] ? 1.5 : 3), eye, entrance[1] + inDir.z * 1.5);
  push({ dur: 1.6 * sp, sample: (u) => ({ pos: lerpV(last.pos, doorOut, ease(u)), look: lerpV(last.look, V(entrance[0], eye, entrance[1]), ease(u)) }) });
  push({ dur: 2.0 * sp, sample: (u) => ({ pos: lerpV(doorOut, doorIn, ease(u)), look: rooms[0] ? V(rooms[0].cx, eye, rooms[0].cz) : C.clone() }) });

  // 3) visit every room
  rooms.forEach((r, i) => {
    const target = V(r.cx, eye, r.cz);
    const from = last.pos.clone();
    // travel to room
    push({ dur: 1.4 * sp, sample: (u) => ({ pos: lerpV(from, V(r.cx, eye, r.cz).addScaledVector(V(r.cx - from.x, 0, r.cz - from.z).normalize(), -Math.min(r.w, r.d) * 0.4 - 1.2), ease(u)), look: lerpV(last.look, target, ease(u)) }) });
    const base = last.pos.clone();
    const mv = i % 3;
    push({
      dur: P.room * sp, overlay: "room", label: r.name,
      sample: (u) => {
        const e = ease(u);
        if (mv === 0) { // pan
          const off = (e - 0.5) * Math.min(r.w, r.d) * 0.9;
          const perp = V(-(r.cz - base.z), 0, r.cx - base.x).normalize();
          return { pos: base.clone(), look: target.clone().addScaledVector(perp, off) };
        }
        if (mv === 1) { // orbit
          const rad = Math.max(1.4, Math.min(r.w, r.d) * 0.36 + 1.2);
          const ang = Math.atan2(base.z - r.cz, base.x - r.cx) + e * 1.1;
          return { pos: V(r.cx + Math.cos(ang) * rad, eye, r.cz + Math.sin(ang) * rad), look: target.clone() };
        }
        // dolly through
        const fwd = V(r.cx - base.x, 0, r.cz - base.z).normalize();
        return { pos: base.clone().addScaledVector(fwd, e * Math.min(r.w, r.d) * 0.6), look: target.clone().addScaledVector(fwd, 2) };
      },
    });
  });

  // 4) crane up to aerial + orbit
  const aerial = V(b.bounds.cx, b.floorTop + maxSize * 1.25 + 8, b.bounds.cz + 2);
  push({ dur: 2.2 * sp, sample: (u) => ({ pos: lerpV(last.pos, aerial, ease(u)), look: lerpV(last.look, V(b.bounds.cx, b.floorTop, b.bounds.cz), ease(u)) }) });
  const aa0 = Math.atan2(aerial.z - b.bounds.cz, aerial.x - b.bounds.cx);
  push({ dur: (P.droneHeavy ? 4.5 : 3.2) * sp, overlay: "outro", sample: (u) => { const a = aa0 + ease(u) * Math.PI * 0.9; const rr = Math.hypot(aerial.x - b.bounds.cx, aerial.z - b.bounds.cz) || 6; return { pos: V(b.bounds.cx + Math.cos(a) * rr, aerial.y, b.bounds.cz + Math.sin(a) * rr), look: V(b.bounds.cx, b.floorTop, b.bounds.cz) }; } });

  const total = segs.reduce((s, x) => s + x.dur, 0);
  return { segments: segs, total, meta: {} };
}

/** Sample the whole path at absolute time t (seconds). */
export function sampleAt(segments: Segment[], t: number): { state: CamState; overlay: OverlayKind; label?: string; segU: number } {
  let acc = 0;
  for (const s of segments) {
    if (t < acc + s.dur || s === segments[segments.length - 1]) {
      const u = Math.max(0, Math.min(1, (t - acc) / s.dur));
      return { state: s.sample(u), overlay: s.overlay ?? null, label: s.label, segU: u };
    }
    acc += s.dur;
  }
  const s = segments[segments.length - 1];
  return { state: s.sample(1), overlay: s.overlay ?? null, label: s.label, segU: 1 };
}
