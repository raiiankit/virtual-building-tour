"use client";

import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { TransformControls } from "@react-three/drei";
import { makeFurnitureMaterial } from "./furniture-materials";
import type { FurniturePiece } from "./furnish";
import { GLTF_MODEL_URLS, GltfFurniturePiece } from "./gltf-furniture";

export interface FurnitureOverride {
  color?: string;
  kind?: string;
  /** World-space [x, z] offset from the piece's original `pos`, set by dragging it in Move mode. */
  position?: [number, number];
  /** Absolute Y-axis rotation in radians, set by dragging it in Rotate mode. */
  rotationY?: number;
  /** Toggleable light state (ceiling_light/night_lamp only) — undefined/true = on. */
  on?: boolean;
  /** Openable-door state (wardrobe/fridge only) — undefined/false = closed. */
  open?: boolean;
}

// How far a hinged door pivot swings open, in radians — negative so a
// left-hinged leaf swings out into the room rather than through the carcass.
const DOOR_OPEN_RAD = -1.55; // ~ -89°, within the requested 80-100° range

function box(sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material, rotY = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sx, 0.01), Math.max(sy, 0.01), Math.max(sz, 0.01)), mat);
  m.position.set(x, y, z); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, mat: THREE.Material, seg = 20): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(rt, 0.005), Math.max(rb, 0.005), Math.max(h, 0.01), seg), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}
function sph(r: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(Math.max(r, 0.01), 16, 12), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Ground-Y for a floor-standing prop of height sy (its base sits on the floor),
 *  or use the manifest's explicit centre height `y` when given (wall/ceiling props). */
function centerY(sy: number, y?: number): number {
  return y !== undefined ? y : sy / 2;
}

/** Build a reasonably-shaped group for one furniture piece — a few primitives
 *  composed into a real silhouette for the visually important types, a plain
 *  box fallback for everything else. All local-space, positioned at (0,0,0);
 *  the caller translates the whole group to piece.pos/y.
 *  `overrideMat`, when given, replaces every use of the piece's *own* default
 *  material (i.e. calls to `mat()` with no explicit kind) — accent parts built
 *  with an explicit kind (e.g. a bed's fabric duvet) are left alone, matching
 *  a per-piece "just that item's material" edit rather than a full re-skin. */
/** `lightOn` (ceiling_light/night_lamp only) dims the fixture's emissive material
 *  and, for ceiling_light, zeroes its attached PointLight — toggled via a button in
 *  the per-piece inspector, not by clicking the fixture (a plain click already opens
 *  the color/material inspector via onSelect). `doorOpen` (wardrobe/fridge only) is
 *  read once here just to seed the pivot's *initial* rotation on first build; the
 *  actual open/close swing is animated smoothly frame-by-frame in FurniturePieces'
 *  useFrame, not snapped here — see DOOR_OPEN_RAD / the doorAngle ref below. */
function buildPiece(p: FurniturePiece, overrideMat?: THREE.Material, lightOn = true, doorOpen = false): THREE.Object3D {
  const [sx, sy, sz] = p.size;
  const mat = (kind = p.material) => (kind === p.material && overrideMat ? overrideMat : makeFurnitureMaterial(kind, p.pos));
  // A dimmed clone of a light-emitting material for the "off" state — never mutates
  // the shared/cached "light" material in place, which is reused by every light
  // piece in the scene (mutating it would turn every light off/on together).
  const litMat = (base: THREE.Material): THREE.Material => {
    if (lightOn) return base;
    const dim = base.clone();
    if (dim instanceof THREE.MeshStandardMaterial) { dim.emissiveIntensity *= 0.02; dim.color.multiplyScalar(0.35); }
    return dim;
  };
  const g = new THREE.Group();
  const cy = centerY(sy, p.y);

  switch (p.type) {
    case "bed": {
      g.add(box(sx, sy * 0.55, sz, 0, sy * 0.275, 0, mat()));               // mattress base
      g.add(box(sx, sy * 0.15, sz * 0.94, 0, sy * 0.55 + sy * 0.075, 0, makeFurnitureMaterial("fabric", p.pos))); // duvet
      g.add(box(sx * 0.3, sy * 0.18, sz * 0.16, -sx * 0.28, sy * 0.62 + sy * 0.09, -sz * 0.38, makeFurnitureMaterial("fabric", p.pos)));
      g.add(box(sx * 0.3, sy * 0.18, sz * 0.16, sx * 0.28, sy * 0.62 + sy * 0.09, -sz * 0.38, makeFurnitureMaterial("fabric", p.pos)));
      g.add(box(sx * 0.9, sy * 0.08, sz * 0.22, 0, sy * 0.55 + sy * 0.04, sz * 0.36, makeFurnitureMaterial("fabric", p.pos))); // folded throw at foot
      g.position.y = 0; return positioned(g, p, 0);
    }
    case "headboard": {
      g.add(box(sx, sy, sz, 0, 0, 0, mat()));
      return positioned(g, p, cy);
    }
    case "sofa": {
      g.add(box(sx, sy * 0.45, sz, 0, sy * 0.225, 0, mat()));               // seat base
      g.add(box(sx, sy * 0.55, sz * 0.2, 0, sy * 0.45 + sy * 0.275, -sz * 0.4, mat())); // backrest
      g.add(box(sx * 0.12, sy * 0.65, sz, -sx * 0.44, sy * 0.325, 0, mat())); // left arm
      g.add(box(sx * 0.12, sy * 0.65, sz, sx * 0.44, sy * 0.325, 0, mat()));  // right arm
      // back cushions — break up the flat backrest slab
      for (const dx of [-0.24, 0.24]) {
        g.add(box(sx * 0.4, sy * 0.32, sz * 0.16, dx * sx, sy * 0.45 + sy * 0.16, -sz * 0.32, mat()));
      }
      return positioned(g, p, 0);
    }
    case "dining_table":
    case "desk":
    case "console": {
      const topH = 0.05;
      g.add(box(sx, topH, sz, 0, sy - topH / 2, 0, makeFurnitureMaterial("wood", p.pos)));
      const legInset = 0.08;
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
        g.add(box(0.06, sy - topH, 0.06, dx * (sx / 2 - legInset), (sy - topH) / 2, dz * (sz / 2 - legInset), makeFurnitureMaterial("wood", p.pos)));
      }
      return positioned(g, p, 0);
    }
    case "chair": {
      const seatH = sy * 0.5;
      g.add(box(sx, 0.05, sz, 0, seatH, 0, mat()));
      g.add(box(sx, sy * 0.5, 0.05, 0, seatH + sy * 0.25, -sz * 0.42, mat()));
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) g.add(box(0.04, seatH, 0.04, dx * (sx / 2 - 0.04), seatH / 2, dz * (sz / 2 - 0.04), mat()));
      return positioned(g, p, 0);
    }
    case "wardrobe": {
      // Carcass a touch shallower than the nominal footprint — the hinged door
      // leaf sits proud of its front face, so this keeps the *outer* silhouette
      // matching p.size instead of growing deeper by the leaf's thickness.
      const doorTh = 0.03;
      g.add(box(sx, sy, sz - doorTh, 0, sy / 2, -doorTh / 2, mat()));
      // Hinge pivot at the carcass's left front edge; a single full-width leaf
      // (real hinged door, not just a painted-on seam) swings open around it.
      const pivot = new THREE.Group();
      pivot.position.set(-sx / 2, sy / 2, sz / 2 - doorTh);
      pivot.rotation.y = doorOpen ? DOOR_OPEN_RAD : 0;
      pivot.userData.doorPivot = true;
      const leaf = box(sx, sy * 0.94, doorTh, sx / 2, 0, doorTh / 2, mat());
      pivot.add(leaf);
      const handle = cyl(0.012, 0.012, 0.16, sx - 0.06, 0, doorTh + 0.03, makeFurnitureMaterial("metal", p.pos));
      handle.rotation.z = Math.PI / 2;
      pivot.add(handle);
      g.add(pivot);
      return positioned(g, p, 0);
    }
    case "tv_unit": {
      g.add(box(sx, sy, sz, 0, sy / 2, 0, mat()));
      return positioned(g, p, 0);
    }
    case "tv": {
      g.add(box(sx, sy, 0.04, 0, 0, 0, makeFurnitureMaterial("screen", p.pos)));
      g.add(box(sx * 0.94, sy * 0.9, 0.01, 0, 0, 0.021, new THREE.MeshStandardMaterial({ color: 0x0c0f14, emissive: 0x27405e, emissiveIntensity: 0.5, roughness: 0.15 })));
      return positioned(g, p, cy);
    }
    case "toilet": {
      g.add(cyl(sx * 0.42, sx * 0.46, sy * 0.55, 0, sy * 0.275, sz * 0.1, makeFurnitureMaterial("ceramic", p.pos)));
      g.add(box(sx * 0.8, sy * 0.5, sz * 0.28, 0, sy * 0.75, -sz * 0.32, makeFurnitureMaterial("ceramic", p.pos))); // tank
      return positioned(g, p, 0);
    }
    case "washbasin": {
      g.add(box(sx, sy * 0.3, sz, 0, 0, 0, makeFurnitureMaterial("marble", p.pos))); // counter
      g.add(cyl(Math.min(sx, sz) * 0.32, Math.min(sx, sz) * 0.36, sy * 0.25, 0, sy * 0.18, 0, makeFurnitureMaterial("ceramic", p.pos)));
      return positioned(g, p, cy);
    }
    case "shower_head":
      g.add(cyl(sx / 2, sx / 2, sy, 0, 0, 0, mat()));
      return positioned(g, p, cy);
    case "counter": {
      g.add(box(sx, sy, sz, 0, sy / 2, 0, mat()));
      return positioned(g, p, 0);
    }
    case "cabinets":
    case "wall_cabinet":
    case "storage": {
      g.add(box(sx, sy, sz, 0, 0, 0, makeFurnitureMaterial("wood", p.pos)));
      return positioned(g, p, cy);
    }
    case "sink": {
      g.add(box(sx, sy + 0.1, sz, 0, 0, 0, makeFurnitureMaterial("metal", p.pos)));
      return positioned(g, p, cy);
    }
    case "tap": {
      g.add(cyl(sx / 3, sx / 3, sy, 0, 0, 0, makeFurnitureMaterial("metal", p.pos)));
      return positioned(g, p, cy);
    }
    case "fridge": {
      const doorTh = 0.03;
      g.add(box(sx, sy, sz - doorTh, 0, sy / 2, -doorTh / 2, makeFurnitureMaterial("steel", p.pos)));
      const pivot = new THREE.Group();
      pivot.position.set(-sx / 2, sy / 2, sz / 2 - doorTh);
      pivot.rotation.y = doorOpen ? DOOR_OPEN_RAD : 0;
      pivot.userData.doorPivot = true;
      const leaf = box(sx, sy * 0.98, doorTh, sx / 2, 0, doorTh / 2, makeFurnitureMaterial("steel", p.pos));
      pivot.add(leaf);
      const handle = box(0.02, sy * 0.4, 0.04, sx - 0.06, 0, doorTh + 0.03, makeFurnitureMaterial("metal", p.pos));
      pivot.add(handle);
      g.add(pivot);
      return positioned(g, p, 0);
    }
    case "chimney": {
      g.add(box(sx, sy, sz, 0, 0, 0, makeFurnitureMaterial("metal", p.pos)));
      return positioned(g, p, cy);
    }
    case "microwave": {
      g.add(box(sx, sy, sz, 0, 0, 0, makeFurnitureMaterial("dark", p.pos)));
      return positioned(g, p, cy);
    }
    case "plant": {
      g.add(cyl(sx * 0.35, sx * 0.45, sy * 0.3, 0, sy * 0.15, 0, makeFurnitureMaterial("wood", p.pos)));
      g.add(sph(sx * 0.5, 0, sy * 0.55, 0, makeFurnitureMaterial("plant", p.pos)));
      g.add(sph(sx * 0.36, sx * 0.25, sy * 0.75, sx * 0.1, makeFurnitureMaterial("plant", p.pos)));
      g.add(sph(sx * 0.32, -sx * 0.22, sy * 0.68, -sx * 0.15, makeFurnitureMaterial("plant", p.pos)));
      return positioned(g, p, 0);
    }
    case "vehicle": {
      g.add(box(sx, sy * 0.55, sz, 0, sy * 0.275, 0, makeFurnitureMaterial("car", p.pos)));
      g.add(box(sx * 0.72, sy * 0.4, sz * 0.5, 0, sy * 0.55 + sy * 0.2, -sz * 0.05, makeFurnitureMaterial("glass", p.pos)));
      const wheelMat = makeFurnitureMaterial("dark", p.pos);
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) g.add(cyl(sy * 0.16, sy * 0.16, 0.18, dx * sx * 0.38, sy * 0.16, dz * sz * 0.36, wheelMat));
      return positioned(g, p, 0);
    }
    case "ceiling_light": {
      g.add(cyl(sx / 2, sx / 2.6, sy, 0, 0, 0, litMat(makeFurnitureMaterial("light", p.pos))));
      const light = new THREE.PointLight(0xffe3ad, lightOn ? 0.9 : 0, 6, 2);
      light.position.set(0, -0.05, 0);
      g.add(light);
      return positioned(g, p, cy);
    }
    case "night_lamp": {
      g.add(cyl(sx * 0.22, sx * 0.28, sy * 0.2, 0, -sy * 0.4, 0, makeFurnitureMaterial("ceramic", p.pos)));
      g.add(cyl(sx * 0.5, sx * 0.3, sy * 0.7, 0, sy * 0.15, 0, litMat(makeFurnitureMaterial("light", p.pos))));
      return positioned(g, p, cy);
    }
    case "curtain": {
      g.add(box(sx, sy, sz, 0, 0, 0, makeFurnitureMaterial("fabric", p.pos)));
      return positioned(g, p, cy);
    }
    case "rug": {
      g.add(box(sx, 0.02, sz, 0, 0, 0, makeFurnitureMaterial("fabric", p.pos)));
      return positioned(g, p, p.y !== undefined ? cy : 0.011);
    }
    case "glass_railing":
    case "glass_partition": {
      g.add(box(sx, sy, sz, 0, 0, 0, makeFurnitureMaterial("glass", p.pos)));
      return positioned(g, p, cy);
    }
    case "stair_step":
      g.add(box(sx, sy, sz, 0, 0, 0, makeFurnitureMaterial("concrete", p.pos)));
      return positioned(g, p, cy);
    default: {
      g.add(box(sx, sy, sz, 0, 0, 0, mat()));
      return positioned(g, p, cy);
    }
  }
}

/** Translate a locally-built group to the piece's world position/height —
 *  offset by the piece's own floor (`base_y`, 0 for a ground-floor/single-floor
 *  piece) so upper-floor furniture sits on its own floor's slab, not ground level. */
function positioned(g: THREE.Group, p: FurniturePiece, yCenter: number): THREE.Object3D {
  g.position.set(p.pos[0], yCenter + (p.base_y ?? 0), p.pos[1]);
  return g;
}

/** Furniture types that always sit directly on the floor (per furnish.ts, these
 *  never carry an explicit `y` — wall/ceiling-mounted props like night_lamp,
 *  ceiling_light, wall_cabinet, curtain, mirror, tv, exhaust always do and are
 *  excluded here too, via the `p.y === undefined` check at the call site). */
const FLOOR_SHADOW_TYPES = new Set([
  "bed", "sofa", "wardrobe", "dining_table", "tv_unit", "fridge", "counter",
  "vehicle", "plant", "chair", "desk", "storage", "console",
]);

// material is shared/cached like makeFurnitureMaterial's palette (never disposed
// by the cleanup effect below, which only disposes geometries); geometry is
// created fresh per piece (cheap, low-poly) so per-piece disposal stays safe.
const shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a0a08, transparent: true, opacity: 0.22, depthWrite: false });

/** Cheap contact-shadow/AO blob under a floor-standing piece — a flat,
 *  semi-transparent oval sized to roughly the piece's footprint. Reads as
 *  much more "grounded" than shadow-mapping alone at this geometry scale. */
function contactShadow(p: FurniturePiece): THREE.Mesh {
  const [sx, , sz] = p.size;
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(Math.max(sx, 0.1) * 0.62, Math.max(sz, 0.1) * 0.58, 1);
  m.position.set(p.pos[0], 0.005 + (p.base_y ?? 0), p.pos[1]);
  m.renderOrder = 1;
  return m;
}

const highlightMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, wireframe: true, depthTest: false });

/** A thin wireframe box slightly larger than the piece's own assembled
 *  silhouette, added as a child so it inherits the piece's transform — a
 *  simple, visible "this is selected" indicator. */
function addHighlight(root: THREE.Object3D) {
  const savedPos = root.position.clone();
  root.position.set(0, 0, 0);
  const box3 = new THREE.Box3().setFromObject(root);
  root.position.copy(savedPos);
  if (box3.isEmpty()) return;
  const size = box3.getSize(new THREE.Vector3());
  const center = box3.getCenter(new THREE.Vector3());
  const box = new THREE.Mesh(new THREE.BoxGeometry(size.x * 1.1 + 0.02, size.y * 1.1 + 0.02, size.z * 1.1 + 0.02), highlightMat);
  box.raycast = () => {}; // never intercepts pointer events itself
  box.renderOrder = 999;
  box.position.copy(center);
  root.add(box);
}

/** Renders a flat list of furnish.ts pieces as reasonably-shaped 3D furniture.
 *  `overrides` lets the caller re-skin an individual piece (by its index in
 *  `pieces`) with a different color and/or material kind, and/or move/rotate
 *  it (`position`/`rotationY`) via the Move/Rotate tool; `onSelect` fires
 *  with the clicked piece's index (or is not called on misses — wire up
 *  `onPointerMissed` on the parent <Canvas> to clear selection there).
 *  `moveMode` ("translate" | "rotate" | null) shows a drei `TransformControls`
 *  gizmo on the selected piece only when explicitly turned on, so a plain
 *  click-to-select (for recoloring) never accidentally starts a drag.
 *  `onTransformEnd` is called once, on pointer-up, with the piece's final
 *  world offset/rotation — not on every drag frame — matching the "commit on
 *  drop" persistence the caller's `overrides` state expects.
 *  `realisticModelsOn` swaps in a Poly Haven glTF model (see gltf-furniture.tsx)
 *  for the handful of covered types (sofa/bed/dining_table); the procedural
 *  piece is always built too and is only hidden once its glTF counterpart has
 *  actually finished loading, so a network failure falls back automatically. */
export function FurniturePieces({
  pieces, overrides, selected, onSelect, moveMode, onTransformEnd, realisticModelsOn, hiddenLevels,
}: {
  pieces: FurniturePiece[]; wallHeight?: number;
  overrides?: Record<number, FurnitureOverride>;
  selected?: number | null;
  onSelect?: (index: number | null) => void;
  moveMode?: "translate" | "rotate" | null;
  onTransformEnd?: (index: number, patch: Partial<FurnitureOverride>) => void;
  realisticModelsOn?: boolean;
  /** Floor-toggle support (JSON portal only, defaults to none — existing
   *  single-floor callers unaffected): pieces whose `level` is in this set are
   *  skipped entirely (not built) rather than filtered out of `pieces` itself,
   *  so every OTHER piece keeps its original array index — the index every
   *  override/selection/drag callback here is keyed on. Filtering the array
   *  instead would silently re-key every piece after a hidden floor's pieces,
   *  corrupting `overrides`/`selected`. */
  hiddenLevels?: Set<number>;
}) {
  // Openable-door pivots (wardrobe/fridge), keyed by piece index, rediscovered
  // every time `group` is rebuilt below. `doorAngle` persists the *current*
  // animated angle across those rebuilds (e.g. when an unrelated override changes)
  // so an in-progress swing resumes from where it was instead of snapping back.
  const doorPivots = useRef(new Map<number, THREE.Group>());
  const doorAngle = useRef(new Map<number, number>());

  const group = useMemo(() => {
    const g = new THREE.Group();
    doorPivots.current.clear();
    pieces.forEach((p, index) => {
      if (hiddenLevels?.has(p.level ?? 0)) return;
      const ov = overrides?.[index];
      let overrideMat: THREE.Material | undefined;
      if (ov?.kind || ov?.color) {
        const kind = ov.kind ?? p.material;
        const base = makeFurnitureMaterial(kind, p.pos);
        overrideMat = ov.color ? (base.clone() as THREE.Material) : base;
        if (ov.color && overrideMat instanceof THREE.MeshStandardMaterial) overrideMat.color.set(ov.color);
      }
      const piece = buildPiece(p, overrideMat, ov?.on ?? true, ov?.open ?? false);
      piece.userData.pieceIndex = index;
      if (ov?.position) { piece.position.x += ov.position[0]; piece.position.z += ov.position[1]; }
      if (ov?.rotationY !== undefined) piece.rotation.y = ov.rotationY;
      if (selected === index) addHighlight(piece);
      piece.traverse((o) => {
        if (o.userData.doorPivot) {
          const remembered = doorAngle.current.get(index);
          if (remembered !== undefined) o.rotation.y = remembered; // resume mid-swing, don't snap back
          doorPivots.current.set(index, o as THREE.Group);
        }
      });
      g.add(piece);
      if (p.y === undefined && FLOOR_SHADOW_TYPES.has(p.type)) g.add(contactShadow(p));
    });
    return g;
  }, [pieces, overrides, selected, hiddenLevels]);

  // Smoothly lerp every door pivot's rotation toward its target (open/closed) each
  // frame — a spring-ish ease rather than instant, matching the rest of this
  // feature's "ultra-realistic" bar. Runs continuously but is a no-op once settled.
  useFrame((_, delta) => {
    if (doorPivots.current.size === 0) return;
    for (const [index, pivot] of doorPivots.current) {
      const target = (overrides?.[index]?.open ?? false) ? DOOR_OPEN_RAD : 0;
      const next = pivot.rotation.y + (target - pivot.rotation.y) * Math.min(1, delta * 6);
      pivot.rotation.y = Math.abs(target - next) < 0.001 ? target : next;
      doorAngle.current.set(index, pivot.rotation.y);
    }
  });

  useEffect(() => () => {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); }
    });
  }, [group]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    let o: THREE.Object3D | null = e.object;
    while (o && o.userData.pieceIndex === undefined) o = o.parent;
    onSelect?.(o ? (o.userData.pieceIndex as number) : null);
  };

  // --- Realistic (glTF) models: rendered as sibling react-three-fiber
  // components, each hiding its procedural counterpart once loaded. ---
  const gltfTargets = useMemo(() => {
    if (!realisticModelsOn) return [];
    return pieces
      .map((p, index) => ({ p, index, url: GLTF_MODEL_URLS[p.type] }))
      .filter((x): x is { p: FurniturePiece; index: number; url: string } => !!x.url && !hiddenLevels?.has(x.p.level ?? 0));
  }, [pieces, realisticModelsOn, hiddenLevels]);

  const gltfRefs = useRef(new Map<number, THREE.Object3D | null>());
  const [, forceTick] = useState(0);
  const handleGltfResult = useCallback((index: number, ok: boolean) => {
    const obj = group.children.find((c) => c.userData.pieceIndex === index);
    if (obj) obj.visible = !ok;
    forceTick((t) => t + 1); // re-evaluate the TransformControls target below
  }, [group]);

  // --- Move/Rotate tool: attach drei's TransformControls to whichever
  // representation of the selected piece is actually visible right now
  // (the glTF model if it loaded, otherwise the procedural fallback). ---
  const targetObject = useMemo(() => {
    if (selected == null || !moveMode) return null;
    const gltfObj = gltfRefs.current.get(selected) ?? null;
    const proceduralObj = group.children.find((c) => c.userData.pieceIndex === selected) ?? null;
    if (gltfObj && proceduralObj && proceduralObj.visible === false) return gltfObj;
    return proceduralObj ?? gltfObj;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, selected, moveMode, pieces]);
  const groundYRef = useRef(0);
  useEffect(() => { if (targetObject) groundYRef.current = targetObject.position.y; }, [targetObject]);

  const handleObjectChange = useCallback(() => {
    // Translate mode is horizontal-only: clamp any stray Y drift back down
    // every frame (belt-and-braces alongside showY={false} on the gizmo).
    if (moveMode === "translate" && targetObject) targetObject.position.y = groundYRef.current;
  }, [moveMode, targetObject]);

  const handleDragEnd = useCallback(() => {
    if (selected == null || !targetObject) return;
    const p = pieces[selected];
    if (!p) return;
    if (moveMode === "rotate") {
      onTransformEnd?.(selected, { rotationY: targetObject.rotation.y });
    } else {
      const dx = Math.round((targetObject.position.x - p.pos[0]) * 1000) / 1000;
      const dz = Math.round((targetObject.position.z - p.pos[1]) * 1000) / 1000;
      onTransformEnd?.(selected, { position: [dx, dz] });
    }
  }, [selected, targetObject, pieces, moveMode, onTransformEnd]);

  return (
    <>
      <primitive object={group} onClick={onSelect ? handleClick : undefined} />
      {gltfTargets.map(({ p, index, url }) => (
        <GltfFurniturePiece
          key={index}
          url={url}
          piece={p}
          override={overrides?.[index]}
          selected={selected === index}
          onResult={(ok) => handleGltfResult(index, ok)}
          onRef={(o) => gltfRefs.current.set(index, o)}
        />
      ))}
      {targetObject && (
        <TransformControls
          object={targetObject}
          mode={moveMode === "rotate" ? "rotate" : "translate"}
          showX={moveMode !== "rotate"}
          showZ={moveMode !== "rotate"}
          showY={moveMode === "rotate"}
          onObjectChange={handleObjectChange}
          onMouseUp={handleDragEnd}
        />
      )}
    </>
  );
}
