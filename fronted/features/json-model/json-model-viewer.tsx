"use client";

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { ThreeEvent } from "@react-three/fiber";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, SMAA, BrightnessContrast, Vignette } from "@react-three/postprocessing";
import { AlertTriangle, FileUp, Sparkles, Wand2, Boxes, Sofa, Palette, X, RotateCcw, Orbit, Footprints, Info, Grid2x2, Ruler, Sun, Sunrise, Move, RotateCw, Trash2, PlusCircle, Play, Square, Lightbulb, DoorOpen, Layers, Building2 } from "lucide-react";
import type { SceneManifest } from "@/types";
import { Button } from "@/components/ui/button";
import { BuildingLoader } from "@/components/ui/building-loader";
import { cn } from "@/lib/utils";
import { Building, type BuildingInfo, type RoomW } from "@/features/viewer3d/building";
import { WalkControls } from "@/features/viewer3d/walk-controls";
import { partitionFloor } from "@/features/viewer3d/partition";
import type { ValidationIssue } from "./schema";
import { parseAnyBuildingJson } from "./import";
import { jsonModelToManifest } from "./to-manifest";
import { furnishManifest, computeDoorZones, type FurniturePiece, type DoorZone } from "./furnish";
import { FurniturePieces, type FurnitureOverride } from "./furniture-scene";
import { SiteContext, FENCE_MARGIN_M } from "./site-context";
import { RoomLabels, MeasureOverlay } from "./scene-extras";
import { PorchLight, WindowGlow } from "./night-lighting";
import { makeGroundMaterial, makePavingMaterial, PAVING_OPTIONS, type PavingKind } from "./ground-materials";
import { WalkEnhancements } from "./walk-enhancements";

type Mode = "orbit" | "walk" | "top";

/** A room across ANY floor, with its storey (`level`) and that storey's world-Y
 *  offset (`base_y`). The shared engine's `BuildingInfo.rooms` (from
 *  features/viewer3d/building.tsx) only ever contains ground-floor (level 0)
 *  rooms — see buildArchitecture()'s `if (lvl === 0) outRooms.push(...)` — so
 *  this portal derives its OWN full, all-floor room list straight from the
 *  parsed JsonModelInput (which it already has in full) for anything that needs
 *  every floor's rooms: labels, Play Tour, and the "Add furniture" picker.
 *  Structurally a superset of RoomW, so it drops into every RoomW-typed helper
 *  (nearestNeighborRoute, roomFacing, tourCaption, computeFit-adjacent code)
 *  unchanged. */
interface PortalRoom extends RoomW { level: number; base_y: number }

// smoothstep-style ease, same shape as viewer3d.tsx's `Rig` ease helper — kept
// local rather than importing from that shared/production file.
const ease = (u: number) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };

const DEFAULT_WALL_COLOR = "#f8f8f8";
const DEFAULT_FACADE_COLOR = "#e9e2d5";
const DEFAULT_GROUND_COLOR = "#6f8f4f";
// How far (metres) the visible lawn extends past the fence line (itself
// FENCE_MARGIN_M beyond the building, see site-context.tsx) before fog takes
// over — a real yard-sized margin, not the old near-infinite plane.
const LAWN_MARGIN_BEYOND_FENCE_M = 4.5;
// Paved "walkway"/patio margin around the building on each side — was +6m/side
// (way oversized relative to the fence/driveway); a modest apron instead.
const APRON_MARGIN_PER_SIDE_M = 3;
const FLOOR_OPTIONS = [
  { value: "tile", label: "Tile" },
  { value: "wood_floor", label: "Wood" },
  { value: "antiskid", label: "Antiskid" },
  { value: "concrete", label: "Concrete" },
  { value: "outdoor", label: "Outdoor" },
] as const;
const MATERIAL_KIND_OPTIONS = ["wood", "fabric", "metal", "marble", "ceramic", "dark", "plant", "glass"] as const;

// Above this fraction of the footprint's grid cells needing nearest-room fallback
// (i.e. no declared room actually covers them), we tell the user their rooms don't
// fully tile the building — small rounding gaps below this are too common/harmless
// to bother flagging.
const GAP_WARNING_THRESHOLD = 0.03;

// Types the manual "add furniture" picker can synthesize, with reasonable
// default [w,h,d] sizes/material lifted straight from the typical instances
// furnish.ts already places for each type (see e.g. living()'s sofa/coffee_table,
// bedroom()'s bed/wardrobe, dining()'s dining_table/chair) — never invented sizes.
const ADDABLE_FURNITURE_TYPES: { type: string; label: string; size: [number, number, number]; material: string }[] = [
  { type: "sofa", label: "Sofa", size: [2.0, 0.75, 0.9], material: "fabric" },
  { type: "bed", label: "Bed", size: [1.5, 0.55, 2.0], material: "fabric" },
  { type: "wardrobe", label: "Wardrobe", size: [0.6, 2.1, 1.6], material: "wood" },
  { type: "dining_table", label: "Dining table", size: [1.2, 0.76, 1.6], material: "wood" },
  { type: "chair", label: "Chair", size: [0.42, 0.9, 0.42], material: "wood" },
  { type: "desk", label: "Desk", size: [1.4, 0.75, 0.6], material: "wood" },
  { type: "console", label: "Console", size: [0.35, 0.85, 1.0], material: "wood" },
  { type: "tv_unit", label: "TV unit", size: [1.6, 0.42, 0.4], material: "wood" },
  { type: "storage", label: "Storage cabinet", size: [0.5, 1.9, 1.5], material: "wood" },
  { type: "counter", label: "Counter", size: [0.6, 0.9, 1.5], material: "marble" },
  { type: "rug", label: "Rug", size: [1.8, 0.02, 1.6], material: "fabric" },
  { type: "plant", label: "Plant", size: [0.4, 1.3, 0.4], material: "plant" },
];

const POST = typeof process !== "undefined" && process.env.NEXT_PUBLIC_VBT_POST === "1";

/** Never let a WebGL/effect error blank the whole tab — fall back gracefully. */
class GLBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function StudioEnv() {
  const { scene, gl } = useThree();
  useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
  }, [scene, gl]);
  return null;
}

const EXAMPLE_JSON = `{
  // A small realistic 2BHK — rooms tile together into one clean footprint.
  // Coordinates are in metres [x, z]; sizes are [width, depth].
  "name": "Sunrise Apartment 2BHK",
  "wallHeightM": 2.9,
  "rooms": [
    { "name": "Living Room",    "type": "living_room",    "center": [2, 2],   "size": [4, 4] },
    { "name": "Kitchen",        "type": "kitchen",        "center": [6, 2],   "size": [4, 4] },
    { "name": "Bedroom",        "type": "bedroom",        "center": [2, 5.5], "size": [4, 3] },
    { "name": "Master Bedroom", "type": "master_bedroom", "center": [6, 5.5], "size": [4, 3] },
    { "name": "Bathroom 1",     "type": "bathroom",       "center": [1, 8],   "size": [2, 2] },
    { "name": "Bathroom 2",     "type": "bathroom",       "center": [3, 8],   "size": [2, 2] },
    { "name": "Dining",         "type": "dining",         "center": [6, 8],   "size": [4, 2] },
    { "name": "Balcony",        "type": "balcony",        "center": [8.75, 5.5], "size": [1.5, 3] }
  ],
  "windows": [
    { "pos": [2, 0], "len": 1.8 },
    { "pos": [8, 2], "len": 1.5 },
    { "pos": [0, 5.5], "len": 1.5 },
    { "pos": [6, 9], "len": 1.8 }
  ],
  "entrance": [2, 0],
  "furnish": true
}`;

// A 2-storey example: floor 0 has a "staircase" room; floor 1 declares a
// staircase room too, at the SAME [x, z] centre/size — the shared 3D engine
// (buildArchitecture) only builds a climbable stair flight + matching hole in
// the floor above when a staircase room lines up floor-to-floor like this.
const EXAMPLE_JSON_MULTI_FLOOR = `{
  // A small 2-storey home. Every room gets an optional "floor" (0 = ground,
  // default when omitted). The staircase room on floor 0 must sit at the same
  // [x, z] centre/size as the one on floor 1 — that's what lines up the shaft
  // so the engine can build one continuous, climbable flight between floors.
  "name": "Two-Storey Cottage",
  "wallHeightM": 2.9,
  "floorHeightM": 3.0,
  "rooms": [
    { "name": "Living Room", "type": "living_room", "center": [2, 2],   "size": [4, 4], "floor": 0 },
    { "name": "Kitchen",     "type": "kitchen",      "center": [6, 2],   "size": [4, 4], "floor": 0 },
    { "name": "Staircase",   "type": "staircase",    "center": [2, 5.5], "size": [2, 3], "floor": 0 },
    { "name": "Dining",      "type": "dining",       "center": [6, 5.5], "size": [4, 3], "floor": 0 },

    { "name": "Bedroom 1",     "type": "bedroom",        "center": [6, 2],   "size": [4, 4], "floor": 1 },
    { "name": "Master Bedroom","type": "master_bedroom", "center": [6, 5.5], "size": [4, 3], "floor": 1 },
    { "name": "Staircase",     "type": "staircase",      "center": [2, 5.5], "size": [2, 3], "floor": 1 },
    { "name": "Bathroom",      "type": "bathroom",       "center": [2, 2],   "size": [4, 4], "floor": 1 }
  ],
  "windows": [
    { "pos": [2, 0], "len": 1.8 },
    { "pos": [8, 2], "len": 1.5 }
  ],
  "entrance": [2, 0],
  "furnish": true
}`;

// tolerant of // comments so the example stays readable — strip them before JSON.parse
function stripJsonComments(raw: string): string {
  return raw.replace(/^\s*\/\/.*$/gm, "");
}

/** One-shot camera placement when entering walk mode — mirrors viewer3d.tsx's WalkStart. */
function WalkStart({ start, look }: { start: THREE.Vector3; look: THREE.Vector3 }) {
  const { camera } = useThree();
  useEffect(() => { camera.position.copy(start); camera.lookAt(look); }, []); // eslint-disable-line
  return null;
}

/** Computes a sensible orbit camera framing for a building's actual footprint —
 *  same idea as viewer3d.tsx's `focus` calc for its default orbit view: offset
 *  roughly proportional to the building's largest horizontal extent so small
 *  and large generated buildings both frame nicely without manual zoom. */
function computeFit(info: BuildingInfo, mode: Mode = "orbit"): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const maxS = Math.max(info.size.x, info.size.z);
  if (mode === "top") {
    return {
      pos: new THREE.Vector3(info.center.x, info.floorTop + maxS * 1.6 + 8, info.center.z + 0.01),
      target: new THREE.Vector3(info.center.x, info.floorTop, info.center.z),
    };
  }
  const dd = maxS * 1.4 + 6;
  return {
    pos: new THREE.Vector3(info.center.x + dd, info.floorTop + info.size.y + dd * 0.45, info.center.z + dd),
    target: new THREE.Vector3(info.center.x, info.floorTop + 1, info.center.z),
  };
}

/** Snaps the orbit/top camera to a sensible framing whenever (a) a genuinely new
 *  building is generated (gated on `genId`, so re-styling never yanks the camera
 *  around), or (b) the mode changes into orbit/top from anywhere else (walk, or
 *  the other of orbit/top) — e.g. entering Top mode frames a straight-down plan
 *  view instead of keeping whatever angle orbit mode was left at. Mirrors the
 *  intent of viewer3d.tsx's animated Rig, but as a simple snap since this portal
 *  has no fly-to system. */
function ModeFit({ mode, info, genId, controlsRef, touring = false }: { mode: Mode; info: BuildingInfo | null; genId: number; controlsRef: React.RefObject<any>; touring?: boolean }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { camera } = useThree();
  const prevMode = useRef<Mode>(mode);
  const lastFitted = useRef<number | null>(null);
  const prevTouring = useRef(touring);
  useEffect(() => {
    if (!info || mode === "walk") { prevMode.current = mode; prevTouring.current = touring; return; }
    const modeChanged = prevMode.current !== mode;
    const isNewGen = lastFitted.current !== genId;
    // The tour glide leaves the camera wherever the last room's framing put it
    // (often close-up, inside a room) — snap back to a clean overview on stop
    // rather than leaving the user stuck up close to a wall.
    const tourJustEnded = prevTouring.current && !touring;
    if (modeChanged || isNewGen || tourJustEnded) {
      const { pos, target } = computeFit(info, mode);
      camera.position.copy(pos);
      camera.lookAt(target);
      controlsRef.current?.target.copy(target);
      controlsRef.current?.update();
    }
    lastFitted.current = genId;
    prevMode.current = mode;
    prevTouring.current = touring;
  }, [mode, info, genId, camera, controlsRef, touring]);
  return null;
}

/** Compass-ish narrative facing for a room, purely descriptive (not a real solar
 *  calc) — convention: +z = "south", -z = "north", +x = "east", -x = "west",
 *  classified by whichever axis offset from the building's centre is larger,
 *  or a diagonal (e.g. "southeast") when both are large and comparable. Rooms
 *  very close to the centre fall back to "central". */
function roomFacing(room: RoomW, info: BuildingInfo): string {
  const dx = room.cx - info.center.x;
  const dz = room.cz - info.center.z;
  const maxSize = Math.max(info.size.x, info.size.z) || 1;
  if (Math.hypot(dx, dz) < maxSize * 0.08) return "central";
  const ns = dz >= 0 ? "south" : "north";
  const ew = dx >= 0 ? "east" : "west";
  const adx = Math.abs(dx), adz = Math.abs(dz);
  const ratio = Math.min(adx, adz) / Math.max(adx, adz, 1e-6);
  return ratio > 0.5 ? `${ns}${ew}` : (adx > adz ? ew : ns);
}

function tourCaption(room: RoomW, info: BuildingInfo): string {
  return `${room.name} — ${room.w.toFixed(1)}×${room.d.toFixed(1)} m, ${roomFacing(room, info)}`;
}

/** Nearest-neighbour greedy route through `info.rooms`, starting at the first
 *  declared room — same idea as viewer3d.tsx's GuideArrow waypoint route, kept
 *  local/duplicated (not imported) since that file is shared/production. */
function nearestNeighborRoute(rooms: RoomW[]): RoomW[] {
  if (rooms.length <= 2) return rooms;
  const route = [rooms[0]];
  const rest = rooms.slice(1);
  while (rest.length) {
    const last = route[route.length - 1];
    let bi = 0, bd = Infinity;
    rest.forEach((r, i) => { const d = Math.hypot(r.cx - last.cx, r.cz - last.cz); if (d < bd) { bd = d; bi = i; } });
    route.push(rest.splice(bi, 1)[0]);
  }
  return route;
}

const TOUR_GLIDE_S = 1.3;
const TOUR_HOLD_S = 3.3;

/** Drives the "Play tour" camera flythrough: glides (via useFrame lerp, ~1.3s,
 *  smoothstep eased) to a framing centred on each room in `route` in turn, holds
 *  there ~3.3s, then moves on — calling `onIndexChange` as each leg starts (so
 *  the caption overlay updates) and `onDone` once the route is exhausted. Takes
 *  over the camera directly (OrbitControls is disabled by the caller while this
 *  is active, same idea as TransformControls owning the camera while dragging
 *  furniture) and keeps `controlsRef`'s target in sync every frame so re-enabling
 *  OrbitControls afterwards doesn't snap. */
function TourController({ route, floorTop, onIndexChange, onDone, controlsRef }: {
  route: RoomW[]; floorTop: number; onIndexChange: (i: number) => void; onDone: () => void;
  controlsRef: React.RefObject<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}) {
  const { camera } = useThree();
  const idx = useRef(0);
  const phase = useRef<"glide" | "hold">("glide");
  const t = useRef(0);
  const from = useRef({ pos: new THREE.Vector3(), tgt: new THREE.Vector3() });
  const to = useRef({ pos: new THREE.Vector3(), tgt: new THREE.Vector3() });

  // Rooms in this portal tile edge-to-edge with no gaps, so any framing offset
  // "outside" the current room lands inside a neighbour's walls/furniture —
  // stay inside the room's own footprint instead (corner-ish, eye height,
  // looking back at the centre), which is clip-free regardless of how tightly
  // packed the building is.
  const frameFor = useCallback((r: RoomW & { base_y?: number }) => {
    const by = r.base_y ?? 0;
    const target = new THREE.Vector3(r.cx, floorTop + by + 1.4, r.cz);
    const margin = 0.35;
    const offX = Math.max(0, r.w / 2 - margin) * 0.75;
    const offZ = Math.max(0, r.d / 2 - margin) * 0.75;
    const pos = new THREE.Vector3(r.cx + offX, floorTop + by + 1.6, r.cz + offZ);
    return { pos, target };
  }, [floorTop]);

  // (re)start whenever this component mounts (i.e. whenever the tour becomes active)
  useEffect(() => {
    if (route.length === 0) return;
    idx.current = 0;
    phase.current = "glide";
    t.current = 0;
    from.current.pos.copy(camera.position);
    from.current.tgt.copy(controlsRef.current?.target ?? frameFor(route[0]).target);
    const f = frameFor(route[0]);
    to.current.pos.copy(f.pos);
    to.current.tgt.copy(f.target);
    onIndexChange(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  useFrame((_, dt) => {
    if (route.length === 0) return;
    t.current += dt;
    if (phase.current === "glide") {
      const e = ease(Math.min(1, t.current / TOUR_GLIDE_S));
      camera.position.lerpVectors(from.current.pos, to.current.pos, e);
      const tgt = new THREE.Vector3().lerpVectors(from.current.tgt, to.current.tgt, e);
      camera.lookAt(tgt);
      controlsRef.current?.target.copy(tgt);
      if (e >= 1) { phase.current = "hold"; t.current = 0; }
    } else {
      camera.lookAt(to.current.tgt);
      controlsRef.current?.target.copy(to.current.tgt);
      if (t.current >= TOUR_HOLD_S) {
        const next = idx.current + 1;
        if (next >= route.length) { onDone(); return; }
        idx.current = next;
        phase.current = "glide";
        t.current = 0;
        from.current.pos.copy(camera.position);
        from.current.tgt.copy(to.current.tgt);
        const f = frameFor(route[next]);
        to.current.pos.copy(f.pos);
        to.current.tgt.copy(f.target);
        onIndexChange(next);
      }
    }
  });

  return null;
}

function Scene({
  manifest, furniture, mode, onInfo, wallColor, facadeColor, furnitureOn, roofOn, genId, overrides, selected, onSelectFurniture,
  sunT, siteContextOn, roomLabelsOn, allRooms, measureOn, measurePoints, onMeasureClick, moveMode, onTransformEnd, realisticModelsOn,
  touring, tourRoute, onTourIndexChange, onTourDone, groundColor, pavingKind, hiddenFloors,
}: {
  manifest: SceneManifest; furniture: FurniturePiece[]; mode: Mode; onInfo: (i: BuildingInfo) => void;
  wallColor: string; facadeColor: string; furnitureOn: boolean; roofOn: boolean; genId: number;
  overrides: Record<number, FurnitureOverride>; selected: number | null; onSelectFurniture: (i: number | null) => void;
  sunT: number; siteContextOn: boolean; roomLabelsOn: boolean; allRooms: PortalRoom[];
  measureOn: boolean; measurePoints: THREE.Vector3[]; onMeasureClick: (p: THREE.Vector3) => void;
  moveMode: "translate" | "rotate" | null; onTransformEnd: (index: number, patch: Partial<FurnitureOverride>) => void;
  realisticModelsOn: boolean;
  touring: boolean; tourRoute: RoomW[]; onTourIndexChange: (i: number) => void; onTourDone: () => void;
  groundColor: string; pavingKind: PavingKind; hiddenFloors: Set<number>;
}) {
  const visibleRooms = useMemo(() => allRooms.filter((r) => !hiddenFloors.has(r.level)), [allRooms, hiddenFloors]);
  const [info, setInfo] = useState<BuildingInfo | null>(null);
  const handleInfo = useCallback((i: BuildingInfo) => { setInfo(i); onInfo(i); }, [onInfo]);
  const maxSize = info ? Math.max(info.size.x, info.size.z) : 16;
  const controlsRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any

  const handleMeasureClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onMeasureClick(e.point.clone());
  }, [onMeasureClick]);

  // time-of-day sun: 0 = dawn (low, east, warm) · 0.5 = noon (high, white) · 1 = dusk (low, west, warm)
  // — mirrors viewer3d.tsx's `sun` useMemo so both viewers read the same way.
  const sun = useMemo(() => {
    const ang = Math.PI * (0.08 + 0.84 * sunT);
    const elev = Math.sin(ang);
    const warm = Math.pow(1 - elev, 1.5);
    return {
      pos: [Math.cos(ang) * maxSize * 1.3, Math.max(0.12, elev) * maxSize * 1.7, maxSize * 0.45] as [number, number, number],
      color: new THREE.Color("#fff4e2").lerp(new THREE.Color("#ff9a44"), warm * 0.85),
      intensity: 1.1 + elev * 1.9,
      sky: new THREE.Color("#e9edf2").lerp(new THREE.Color("#f6d8b4"), warm * 0.55),
      hemi: 0.55 + elev * 0.5,
      elev,
    };
  }, [sunT, maxSize]);

  // Exterior "lights on" fade — continuous, driven purely by the sun's elevation
  // (so it stays perfectly in sync with the day/night slider, no separate state):
  // negligible at noon (elev≈1), fading up toward the warm/low ends of the slider.
  const nightFactor = useMemo(() => Math.max(0, Math.min(1, 1 - sun.elev / 0.45)), [sun.elev]);

  // Ground plane sizing — proportionate to the actual building/fence, not a
  // near-infinite plane. The paved apron is a modest walkway/patio margin
  // around the building; the lawn extends a real yard's worth past the fence
  // line (see FENCE_MARGIN_M in site-context.tsx, which places the fence
  // itself) and then leans on `fog` (below) to fade into the sky rather than
  // being brute-force sized to never show an edge.
  const ground = useMemo(() => {
    const sizeX = info?.size.x ?? 12, sizeZ = info?.size.z ?? 12;
    const apronX = sizeX + APRON_MARGIN_PER_SIDE_M * 2;
    const apronZ = sizeZ + APRON_MARGIN_PER_SIDE_M * 2;
    const fenceHalfX = sizeX / 2 + FENCE_MARGIN_M, fenceHalfZ = sizeZ / 2 + FENCE_MARGIN_M;
    const lawnRadius = Math.max(fenceHalfX, fenceHalfZ) + LAWN_MARGIN_BEYOND_FENCE_M;
    // Fog must scale with the CAMERA's viewing distance (maxSize-based, same as
    // the original scene-wide fog), not the lawn's own physical extent — the
    // camera routinely sits farther out than a small building's yard, and tying
    // fogFar to lawnRadius fogged the entire building into the sky color,
    // leaving only the un-fogged Html room labels visible. The lawn plane is
    // just sized generously past fogFar so its own edge is hidden by the fog,
    // without fog swallowing the building itself.
    const fogNear = maxSize * 3;
    const fogFar = maxSize * 9;
    const lawnSize = Math.max(lawnRadius * 2.2, fogFar * 2.2);
    return { apronX, apronZ, lawnSize, fogNear, fogFar };
  }, [info?.size.x, info?.size.z, maxSize]);

  const groundMat = useMemo(() => makeGroundMaterial(groundColor), [groundColor]);
  const pavingMat = useMemo(() => makePavingMaterial(pavingKind), [pavingKind]);

  return (
    <>
      <color attach="background" args={[sun.sky.getStyle()]} />
      <fog attach="fog" args={[sun.sky.getStyle(), ground.fogNear, ground.fogFar]} />
      <StudioEnv />
      <hemisphereLight intensity={sun.hemi} color="#f4f1ea" groundColor="#8c887f" />
      <directionalLight
        position={sun.pos} intensity={sun.intensity} color={sun.color} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-maxSize} shadow-camera-right={maxSize} shadow-camera-top={maxSize} shadow-camera-bottom={-maxSize} shadow-camera-near={1} shadow-camera-far={maxSize * 4}
      />
      <group position={[info?.center.x ?? 0, (info?.bounds.min.y ?? 0) - 0.04, info?.center.z ?? 0]}>
        {/* lawn/plot — yard-sized past the fence line, fading into the sky via `fog` above */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={groundMat}>
          <planeGeometry args={[ground.lawnSize, ground.lawnSize]} />
        </mesh>
        {/* paved apron/walkway — a modest margin around the building, not a huge plaza */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow material={pavingMat}>
          <planeGeometry args={[ground.apronX, ground.apronZ]} />
        </mesh>
      </group>
      <SiteContext info={info} manifest={manifest} enabled={siteContextOn} nightFactor={nightFactor} />
      <PorchLight manifest={manifest} info={info} nightFactor={nightFactor} />
      <WindowGlow manifest={manifest} nightFactor={nightFactor} />

      <Suspense fallback={<Html center><BuildingLoader light /></Html>}>
        {/* Shared ancestor for the measure click: with the tool active, furniture
            selection is disabled (see onSelect below) so a click on a wall, floor,
            OR a furniture piece all register as a measure point — matching "raycast
            against everything" rather than only bare architecture. */}
        <group onClick={measureOn ? handleMeasureClick : undefined}>
          <Building manifest={manifest} ceilingsVisible={mode === "walk"} roofVisible={mode === "orbit" ? roofOn : false} wallColor={wallColor} facadeColor={facadeColor} onReady={handleInfo} />
          <FurniturePieces
            pieces={furnitureOn ? furniture : []}
            wallHeight={manifest.wall_height_m}
            overrides={overrides}
            selected={selected}
            onSelect={measureOn ? undefined : onSelectFurniture}
            moveMode={measureOn ? null : moveMode}
            onTransformEnd={onTransformEnd}
            realisticModelsOn={realisticModelsOn}
            hiddenLevels={hiddenFloors}
          />
        </group>
      </Suspense>

      {mode !== "walk" && info && roomLabelsOn && (
        <RoomLabels rooms={visibleRooms} wallHeight={manifest.wall_height_m} floorTop={info.floorTop} />
      )}
      {measurePoints.length > 0 && <MeasureOverlay points={measurePoints} />}

      {info && <ModeFit mode={mode} info={info} genId={genId} controlsRef={controlsRef} touring={touring} />}
      {touring && info && tourRoute.length > 0 && (
        <TourController route={tourRoute} floorTop={info.floorTop} onIndexChange={onTourIndexChange} onDone={onTourDone} controlsRef={controlsRef} />
      )}
      {mode !== "walk" && info && (
        <OrbitControls ref={controlsRef} makeDefault enabled={!touring} enableDamping dampingFactor={0.08} maxPolarAngle={mode === "top" ? 0.2 : Math.PI * 0.495} minDistance={2} maxDistance={maxSize * 4} />
      )}
      {mode === "walk" && info && (
        <>
          <WalkStart start={new THREE.Vector3(info.rooms[0]?.cx ?? info.center.x, info.floorTop + 1.7, info.rooms[0]?.cz ?? info.center.z)} look={new THREE.Vector3(info.center.x, info.floorTop + 1.6, info.center.z)} />
          <WalkControls enabled collidables={info.collidables} walkSurfaces={info.walkSurfaces} floorTop={info.floorTop} />
          {/* Portal-only zoom + head-bob, layered on top of the shared WalkControls above —
              mounted after it so its useFrame reads the post-move camera position each frame. */}
          <WalkEnhancements active />
        </>
      )}

      {POST && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1.0} intensity={0.35} />
          <BrightnessContrast brightness={0.01} contrast={0.05} />
          <Vignette eskil={false} offset={0.25} darkness={0.5} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}

export function JsonModelViewer() {
  const [text, setText] = useState(EXAMPLE_JSON);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [importNotes, setImportNotes] = useState<{ format: "cubicasa" | "claude-extraction"; notes: string[] } | null>(null);
  // Non-blocking advisory: set when the declared rooms leave a real gap in the
  // footprint (partitionFloor had to auto-fill via nearest-room fallback there).
  const [gapWarningPct, setGapWarningPct] = useState<number | null>(null);
  const [manifest, setManifest] = useState<SceneManifest | null>(null);
  const [furniture, setFurniture] = useState<FurniturePiece[]>([]);
  const [info, setInfo] = useState<BuildingInfo | null>(null);
  // Portal-derived, ALL-floor room list (see PortalRoom above) — kept separate
  // from BuildingInfo.rooms (ground-floor-only) so labels/tour/add-furniture
  // work across every storey. Rebuilt once per Generate, not per style tweak.
  const [allRooms, setAllRooms] = useState<PortalRoom[]>([]);
  // Which floors are hidden via the floor-toggle buttons — indices into
  // info.levelGroups, reset whenever a fresh building is generated.
  const [hiddenFloors, setHiddenFloors] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Style controls — separate reactive state from the parse step, so tweaking
  // colors/floor/furniture-visibility applies live without re-parsing the JSON.
  const [wallColor, setWallColor] = useState(DEFAULT_WALL_COLOR);
  const [facadeColor, setFacadeColor] = useState(DEFAULT_FACADE_COLOR);
  const [defaultFloor, setDefaultFloor] = useState<string>("tile");
  const [furnitureOn, setFurnitureOn] = useState(true);
  // Off by default: a roof slab in orbit mode (the view right after Generate)
  // sits on top of the building and hides the interior/furniture almost entirely.
  const [roofOn, setRoofOn] = useState(false);
  // Day/night lighting — 0..1, 0.5 = midday. Applied live, mirrors viewer3d.tsx's sunT slider.
  const [sunT, setSunT] = useState(0.5);
  // Exterior site dressing (fence/trees/driveway) — on by default, toggle for a cleaner/faster view.
  const [siteContextOn, setSiteContextOn] = useState(true);
  // Floating room-name labels — on by default, hidden automatically in walk mode.
  const [roomLabelsOn, setRoomLabelsOn] = useState(true);
  // Exterior ground dressing — lawn tint + paved-apron material, applied live.
  const [groundColor, setGroundColor] = useState(DEFAULT_GROUND_COLOR);
  const [pavingKind, setPavingKind] = useState<PavingKind>("concrete");
  const [mode, setMode] = useState<Mode>("orbit");
  // Narrated auto-tour: glides the camera room-to-room with a caption overlay.
  // `prevModeRef` remembers whichever mode (orbit/walk/top) was active before
  // the tour started, so stopping returns control there instead of always orbit.
  const [touring, setTouring] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const prevModeRef = useRef<Mode>("orbit");
  // bumped once per "Generate 3D Model" click — lets the camera auto-fit trigger
  // exactly once per fresh generation without re-firing on style-only changes
  const [genId, setGenId] = useState(0);
  // rooms (by index) whose JSON explicitly set floorMaterial — never overridden by the global default
  const explicitFloorRooms = useRef<Set<number>>(new Set());

  // Per-piece edits
  const [selected, setSelected] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<Record<number, FurnitureOverride>>({});
  // Move/Rotate drag tool — off by default so plain click-to-select (for
  // recoloring) never accidentally starts dragging a piece around.
  const [moveMode, setMoveMode] = useState<"translate" | "rotate" | null>(null);
  // "Add furniture" picker selections
  const [addType, setAddType] = useState<string>(ADDABLE_FURNITURE_TYPES[0].type);
  const [addRoomIndex, setAddRoomIndex] = useState<number>(0);
  // Realistic (Poly Haven glTF) models for sofa/bed/dining_table — off by
  // default since it depends on network access and isn't guaranteed reliable.
  const [realisticModelsOn, setRealisticModelsOn] = useState(false);

  // Measure tool — up to two clicked points against the building's walls/floor.
  const [measureOn, setMeasureOn] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<THREE.Vector3[]>([]);
  const onMeasureClick = useCallback((p: THREE.Vector3) => {
    setMeasurePoints((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
  }, []);
  const toggleMeasure = useCallback(() => {
    setMeasureOn((v) => { const next = !v; if (!next) setMeasurePoints([]); return next; });
  }, []);

  // Nearest-neighbour route through the current rooms (ALL floors — see
  // PortalRoom/allRooms above), starting at the first declared room —
  // recomputed whenever a fresh building's `info` lands.
  const tourRoute = useMemo(() => (info ? nearestNeighborRoute(allRooms) : []), [info, allRooms]);

  // Switching mode manually (the Orbit/Walk/Top pills) always stops any running
  // tour first — otherwise TourController and the user's own camera intent fight.
  const changeMode = useCallback((m: Mode) => {
    setTouring(false);
    setMode(m);
  }, []);

  const startTour = useCallback(() => {
    if (tourRoute.length === 0) return;
    prevModeRef.current = mode;
    setSelected(null);
    setMoveMode(null);
    setMeasureOn(false);
    setMeasurePoints([]);
    setTourIndex(0);
    setMode("orbit"); // the tour IS an orbit-camera flythrough, regardless of the mode it started from
    setTouring(true);
  }, [tourRoute, mode]);

  const stopTour = useCallback(() => {
    setTouring(false);
    setMode(prevModeRef.current);
  }, []);

  const generate = useCallback(() => {
    const result = parseAnyBuildingJson(stripJsonComments(text));
    setImportNotes(result.format !== "native" && result.notes.length > 0 ? { format: result.format, notes: result.notes } : null);
    if (!result.ok || !result.data) { setIssues(result.issues); setManifest(null); setFurniture([]); setGapWarningPct(null); return; }
    setIssues(result.issues); // non-fatal warnings (e.g. duplicate names) can still show
    explicitFloorRooms.current = new Set(result.data.rooms.map((r, i) => (r.floorMaterial ? i : -1)).filter((i) => i >= 0));
    const m = jsonModelToManifest(result.data);
    setManifest(m);
    const floorHeightM = result.data.floorHeightM ?? 3.0;
    // Portal's own all-floor room list (see PortalRoom) — the shared engine's
    // BuildingInfo.rooms only ever carries ground-floor rooms.
    setAllRooms(result.data.rooms.map((r): PortalRoom => {
      const level = r.floor ?? 0;
      return { name: r.name, type: r.type, cx: r.center[0], cz: r.center[1], w: r.size[0], d: r.size[1], level, base_y: level * floorHeightM };
    }));
    // Re-run the same grid-labeling partitionFloor() already uses to build walls —
    // its gapFraction tells us how much of the footprint wasn't actually covered by
    // any declared room (and so was auto-filled by nearest-room fallback instead).
    // Also gives us the *real* interior doorway positions (plan.doorways), which
    // furnish.ts's room-relative placement math has no visibility into on its own —
    // combined with the JSON's own `entrance`, turned into per-room door keep-out
    // zones so furniture doesn't get placed blocking a doorway or its swing path.
    // Both are computed PER FLOOR and scattered back into full-length,
    // global-room-index-keyed arrays so a floor-1 doorway never gets matched
    // against a floor-0 room (or vice versa) — partitionFloor(m, lvl) already
    // filters manifest.rooms down to that level (see partition.ts), so each
    // call's doorways/gapFraction are inherently single-floor.
    let doorZonesByRoom: DoorZone[][] = result.data.rooms.map(() => []);
    let worstGapPct: number | null = null;
    try {
      const levels = m.levels;
      for (let lvl = 0; lvl < levels; lvl++) {
        const plan = partitionFloor(m, lvl);
        if (plan.gapFraction > GAP_WARNING_THRESHOLD) worstGapPct = Math.max(worstGapPct ?? 0, plan.gapFraction);
        const doorPositions: [number, number][] = plan.doorways.map((d) => d.pos);
        if (lvl === 0 && result.data.entrance) doorPositions.push(result.data.entrance);
        // rooms on this floor, mapped back to their original (global) index
        const floorRoomIdx: number[] = [];
        const floorRooms = result.data.rooms.filter((r, i) => {
          if ((r.floor ?? 0) !== lvl) return false;
          floorRoomIdx.push(i);
          return true;
        });
        const zones = computeDoorZones(floorRooms, doorPositions);
        zones.forEach((z, k) => { doorZonesByRoom[floorRoomIdx[k]] = z; });
      }
      setGapWarningPct(worstGapPct);
    } catch { setGapWarningPct(null); }
    setFurniture(furnishManifest(result.data, doorZonesByRoom));
    setInfo(null);
    setSelected(null);
    setOverrides({});
    setMoveMode(null);
    setMode("orbit");
    setTouring(false);
    setMeasureOn(false);
    setMeasurePoints([]);
    setHiddenFloors(new Set());
    setGenId((g) => g + 1);
  }, [text]);

  // Apply the "Default floor" pick as a second pass over the manifest — only
  // to rooms that didn't set an explicit floorMaterial in the JSON. Doesn't
  // touch to-manifest.ts's per-type defaults; this is purely a display layer.
  const styledManifest = useMemo(() => {
    if (!manifest) return null;
    return {
      ...manifest,
      rooms: manifest.rooms.map((r, i) => (explicitFloorRooms.current.has(i) ? r : { ...r, floor_material: defaultFloor })),
    };
  }, [manifest, defaultFloor]);

  // Keep the "add furniture" room picker pointed at a real room once one exists
  // (uses allRooms — every floor — not the engine's ground-floor-only info.rooms).
  useEffect(() => {
    if (allRooms.length > 0 && addRoomIndex >= allRooms.length) {
      setAddRoomIndex(0);
    }
  }, [allRooms, addRoomIndex]);

  const loadExample = useCallback(() => setText(EXAMPLE_JSON), []);
  const loadMultiFloorExample = useCallback(() => setText(EXAMPLE_JSON_MULTI_FLOOR), []);

  const toggleFloor = useCallback((lvl: number) => {
    const g = info?.levelGroups[lvl]; if (!g) return;
    setHiddenFloors((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) { next.delete(lvl); g.visible = true; } else { next.add(lvl); g.visible = false; }
      return next;
    });
  }, [info]);

  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const setOverride = useCallback((index: number, patch: Partial<FurnitureOverride>) => {
    setOverrides((prev) => ({ ...prev, [index]: { ...prev[index], ...patch } }));
  }, []);
  const resetOverride = useCallback((index: number) => {
    // Deletes the whole override entry — color/material AND any position/rotationY
    // drag offset all reset together, matching "Reset" meaning "back to generated".
    setOverrides((prev) => { const next = { ...prev }; delete next[index]; return next; });
  }, []);
  // Commits a Move/Rotate drag once it ends (pointer-up) — see furniture-scene.tsx's
  // FurniturePieces, which only calls this on drop, never per drag frame.
  const onTransformEnd = useCallback((index: number, patch: Partial<FurnitureOverride>) => {
    setOverride(index, patch);
  }, [setOverride]);

  const addFurniturePiece = useCallback(() => {
    if (!info) return;
    const def = ADDABLE_FURNITURE_TYPES.find((t) => t.type === addType) ?? ADDABLE_FURNITURE_TYPES[0];
    // allRooms (every floor), not info.rooms (ground-floor-only) — so a piece
    // added to an upper-floor room lands on that floor's slab, not the ground one.
    const room = allRooms[addRoomIndex] ?? allRooms[0];
    if (!room) return;
    const newPiece: FurniturePiece = {
      type: def.type, pos: [room.cx, room.cz], size: def.size,
      material: def.material, roomType: room.type, confidence: 0.9,
      level: room.level, base_y: room.base_y,
    };
    const newIndex = furniture.length;
    setFurniture((prev) => [...prev, newPiece]);
    setSelected(newIndex);
    setMoveMode("translate");
  }, [info, addType, addRoomIndex, furniture.length]);

  // Removing from the middle of `furniture` shifts every later index, so
  // `overrides` (keyed by index) has to be re-keyed alongside the splice —
  // otherwise a piece two slots later would suddenly inherit piece N's color.
  const deleteFurniturePiece = useCallback((index: number) => {
    setFurniture((prev) => prev.filter((_, i) => i !== index));
    setOverrides((prev) => {
      const next: Record<number, FurnitureOverride> = {};
      for (const [key, value] of Object.entries(prev)) {
        const k = Number(key);
        if (k === index) continue;
        next[k > index ? k - 1 : k] = value;
      }
      return next;
    });
    setSelected(null);
    setMoveMode(null);
  }, []);

  const roomCount = manifest?.rooms.length ?? 0;
  const furnCount = furniture.length;
  const selectedPiece = selected !== null ? furniture[selected] : null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col md:flex-row">
      {/* left: JSON input */}
      <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-border bg-surface p-4 md:h-full md:w-[420px] md:border-b-0 md:border-r">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="size-4 text-primary" /> Building JSON</h2>
          <p className="mt-1 text-xs text-muted-foreground">Describe rooms with centre + size (metres). Walls, doors, windows and furniture are generated automatically.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">CubiCasa5k and claude-opus-5 floor-plan-extraction exports are also accepted — pasted as-is, they&apos;re auto-converted.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Multi-storey: give any room an optional <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">&quot;floor&quot;</code> (0 = ground, default). A continuous stair needs a <code className="rounded bg-surface-2 px-1 py-0.5 font-mono">&quot;staircase&quot;</code> room at the same [x, z] on every floor except the top one — see the 2-floor example.</p>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="min-h-[280px] flex-1 resize-none rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed outline-none focus:border-primary/50 md:min-h-0"
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadExample}><Sparkles className="size-3.5" /> Load example</Button>
          <Button size="sm" variant="outline" onClick={loadMultiFloorExample}><Building2 className="size-3.5" /> Load 2-floor example</Button>
          <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}><FileUp className="size-3.5" /> Upload .json</Button>
          <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />
          <Button size="sm" className="ml-auto" onClick={generate}><Boxes className="size-3.5" /> Generate 3D Model</Button>
        </div>

        {importNotes && (
          <div className="space-y-1 rounded-lg border border-sky-300/50 bg-sky-50 p-3 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
            <div className="flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-300">
              <Info className="size-3.5" /> Imported from {importNotes.format === "cubicasa" ? "CubiCasa5k" : "claude-opus-5 extraction"}
            </div>
            <ul className="ml-5 list-disc space-y-0.5 text-sky-700/90 dark:text-sky-300/80">
              {importNotes.notes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          </div>
        )}

        {gapWarningPct !== null && (
          <div className="space-y-1 rounded-lg border border-sky-300/50 bg-sky-50 p-3 text-xs dark:border-sky-500/30 dark:bg-sky-500/10">
            <div className="flex items-center gap-1.5 font-semibold text-sky-700 dark:text-sky-300">
              <Info className="size-3.5" /> Rooms don&apos;t fully cover the footprint
            </div>
            <p className="text-sky-700/90 dark:text-sky-300/80">
              About {Math.round(gapWarningPct * 100)}% of the floor area isn&apos;t covered by any declared room. Those gaps were auto-filled so the model still generates, but the wall seam there may look imperfect — consider extending room sizes to remove the gap.
            </p>
          </div>
        )}

        {issues.length > 0 && (
          <div className="space-y-1 rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-300"><AlertTriangle className="size-3.5" /> {manifest ? "Warnings" : "Fix these before generating"}</div>
            <ul className="ml-5 list-disc space-y-0.5 text-amber-700/90 dark:text-amber-300/80">
              {issues.map((iss, i) => <li key={i}><span className="font-mono">{iss.path}</span>: {iss.message}</li>)}
            </ul>
          </div>
        )}

        {manifest && (
          <div className="flex items-center gap-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><Boxes className="size-3.5" /> {roomCount} room{roomCount === 1 ? "" : "s"}</span>
            <span className="flex items-center gap-1.5"><Sofa className="size-3.5" /> {furnCount} furniture piece{furnCount === 1 ? "" : "s"}</span>
            {info && <span>{info.size.x.toFixed(1)} × {info.size.z.toFixed(1)} m</span>}
          </div>
        )}

        {/* Style controls — applied live, no re-parse needed */}
        <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Palette className="size-3.5 text-primary" /> Style</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Wall color</span>
              <input type="color" value={wallColor} onChange={(e) => setWallColor(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Exterior color</span>
              <input type="color" value={facadeColor} onChange={(e) => setFacadeColor(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
            </label>
          </div>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Default floor</span>
            <select value={defaultFloor} onChange={(e) => setDefaultFloor(e.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-primary/50">
              {FLOOR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Furniture</span>
            <input type="checkbox" checked={furnitureOn} onChange={(e) => setFurnitureOn(e.target.checked)} className="size-4 cursor-pointer accent-primary" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Roof</span>
            <input type="checkbox" checked={roofOn} onChange={(e) => setRoofOn(e.target.checked)} className="size-4 cursor-pointer accent-primary" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Site context</span>
            <input type="checkbox" checked={siteContextOn} onChange={(e) => setSiteContextOn(e.target.checked)} className="size-4 cursor-pointer accent-primary" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Room labels</span>
            <input type="checkbox" checked={roomLabelsOn} onChange={(e) => setRoomLabelsOn(e.target.checked)} className="size-4 cursor-pointer accent-primary" />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Sunrise className="size-3.5 shrink-0 text-amber-500/90" />
            <input type="range" min={0} max={1} step={0.01} value={sunT} onChange={(e) => setSunT(Number(e.target.value))} aria-label="Time of day" className="flex-1 accent-amber-500" />
            <Sun className="size-4 shrink-0 text-amber-500" />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Realistic models <span className="text-muted-foreground/70">(beta)</span></span>
            <input type="checkbox" checked={realisticModelsOn} onChange={(e) => setRealisticModelsOn(e.target.checked)} className="size-4 cursor-pointer accent-primary" />
          </label>
        </div>

        {/* Ground — lawn tint + paved-apron material, applied live like every other Style control above */}
        <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold"><Palette className="size-3.5 text-primary" /> Ground</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Lawn color</span>
              <input type="color" value={groundColor} onChange={(e) => setGroundColor(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
            </label>
            <label className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Paving</span>
              <select value={pavingKind} onChange={(e) => setPavingKind(e.target.value as PavingKind)}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-primary/50">
                {PAVING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {/* Manual "add furniture" picker */}
        {manifest && (
          <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-xs">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold"><PlusCircle className="size-3.5 text-primary" /> Add furniture</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select value={addType} onChange={(e) => setAddType(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-primary/50">
                {ADDABLE_FURNITURE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
              <select value={addRoomIndex} onChange={(e) => setAddRoomIndex(Number(e.target.value))}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-primary/50">
                {allRooms.map((r, i) => <option key={i} value={i}>{r.name}{allRooms.filter((x) => x.name === r.name).length > 1 ? ` (${i + 1})` : ""}{allRooms.some((x) => x.level !== 0) ? ` · floor ${r.level}` : ""}</option>)}
              </select>
              <Button size="sm" className="ml-auto" onClick={addFurniturePiece} disabled={!info || allRooms.length === 0}>
                <PlusCircle className="size-3.5" /> Add
              </Button>
            </div>
          </div>
        )}

        {/* Per-piece inspector */}
        {selectedPiece && (
          <div className="space-y-2 rounded-lg border border-primary/40 bg-surface-2 p-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold capitalize">{selectedPiece.type.replace(/_/g, " ")}</div>
                <div className="text-muted-foreground capitalize">{selectedPiece.roomType.replace(/_/g, " ")}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setSelected(null); setMoveMode(null); }}><X className="size-3.5" /></Button>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Color</span>
                <input type="color" value={overrides[selected!]?.color ?? "#aaaaaa"}
                  onChange={(e) => setOverride(selected!, { color: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent" />
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Material</span>
                <select value={overrides[selected!]?.kind ?? ""} onChange={(e) => setOverride(selected!, { kind: e.target.value || undefined })}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-primary/50">
                  <option value="">(original)</option>
                  {MATERIAL_KIND_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
            </div>

            {/* Move/Rotate drag tool */}
            <div className="flex items-center gap-2 border-t border-border pt-2">
              <span className="text-muted-foreground">Position</span>
              <Button size="sm" variant={moveMode === "translate" ? "primary" : "outline"}
                onClick={() => setMoveMode((m) => (m === "translate" ? null : "translate"))}>
                <Move className="size-3.5" /> Move
              </Button>
              <Button size="sm" variant={moveMode === "rotate" ? "primary" : "outline"}
                onClick={() => setMoveMode((m) => (m === "rotate" ? null : "rotate"))}>
                <RotateCw className="size-3.5" /> Rotate
              </Button>
            </div>

            {/* Light toggle — click-to-select already opens this inspector, so
                turning the fixture on/off is a dedicated button rather than an
                ambiguous second click gesture on the piece itself. */}
            {(selectedPiece.type === "ceiling_light" || selectedPiece.type === "night_lamp") && (
              <div className="flex items-center gap-2 border-t border-border pt-2">
                <span className="text-muted-foreground">Light</span>
                <Button size="sm" variant="outline"
                  onClick={() => setOverride(selected!, { on: !(overrides[selected!]?.on ?? true) })}>
                  <Lightbulb className="size-3.5" /> {(overrides[selected!]?.on ?? true) ? "Turn off" : "Turn on"}
                </Button>
              </div>
            )}

            {/* Openable door — animated pivot swing, see furniture-scene.tsx. */}
            {(selectedPiece.type === "wardrobe" || selectedPiece.type === "fridge") && (
              <div className="flex items-center gap-2 border-t border-border pt-2">
                <span className="text-muted-foreground">Door</span>
                <Button size="sm" variant="outline"
                  onClick={() => setOverride(selected!, { open: !(overrides[selected!]?.open ?? false) })}>
                  <DoorOpen className="size-3.5" /> {(overrides[selected!]?.open ?? false) ? "Close" : "Open"}
                </Button>
              </div>
            )}
            <div className="text-muted-foreground">
              {(() => {
                const ov = overrides[selected!];
                const dx = ov?.position?.[0] ?? 0;
                const dz = ov?.position?.[1] ?? 0;
                const rotDeg = ((ov?.rotationY ?? 0) * 180) / Math.PI;
                return `Δx: ${dx.toFixed(2)}m, Δz: ${dz.toFixed(2)}m, rot: ${rotDeg.toFixed(0)}°`;
              })()}
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => deleteFurniturePiece(selected!)}><Trash2 className="size-3.5" /> Delete</Button>
              <Button size="sm" variant="outline" onClick={() => resetOverride(selected!)}><RotateCcw className="size-3.5" /> Reset</Button>
              <Button size="sm" variant="outline" onClick={() => { setSelected(null); setMoveMode(null); }}>Close</Button>
            </div>
          </div>
        )}
      </div>

      {/* right: 3D canvas */}
      <div className="relative min-h-[360px] flex-1 bg-slate-900">
        {!manifest ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div className="max-w-xs space-y-2 rounded-xl border border-white/10 bg-white/5 px-6 py-8">
              <Boxes className="mx-auto size-8 text-white/40" />
              <p className="text-sm text-white/80">Paste JSON and click Generate 3D Model.</p>
              <p className="text-xs text-white/40">Rooms, walls, doors, windows, roof and furniture are all built client-side.</p>
            </div>
          </div>
        ) : (
          <GLBoundary fallback={
            <div className="grid h-full w-full place-items-center bg-slate-800 text-center text-white/70">
              <div className="max-w-xs space-y-2 px-6"><p className="text-sm">The realistic 3D engine couldn&apos;t start on this device.</p>
                <p className="text-xs text-white/50">Try a hardware-accelerated browser (Chrome/Edge) with WebGL enabled, or reload the page.</p></div>
            </div>
          }>
            <Canvas shadows dpr={[1, 2]} gl={{ antialias: !POST, preserveDrawingBuffer: true, powerPreference: "high-performance", logarithmicDepthBuffer: true }}
              camera={{ fov: 55, near: 0.1, far: 2000, position: [16, 12, 16] }}
              onPointerMissed={() => { setSelected(null); setMoveMode(null); }}
              onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
              <Scene
                manifest={styledManifest ?? manifest} furniture={furniture} mode={mode} onInfo={setInfo}
                wallColor={wallColor} facadeColor={facadeColor} furnitureOn={furnitureOn} roofOn={roofOn} genId={genId}
                overrides={overrides} selected={selected} onSelectFurniture={setSelected}
                sunT={sunT} siteContextOn={siteContextOn} roomLabelsOn={roomLabelsOn} allRooms={allRooms}
                measureOn={measureOn} measurePoints={measurePoints} onMeasureClick={onMeasureClick}
                moveMode={moveMode} onTransformEnd={onTransformEnd} realisticModelsOn={realisticModelsOn}
                touring={touring} tourRoute={tourRoute} onTourIndexChange={setTourIndex} onTourDone={stopTour}
                groundColor={groundColor} pavingKind={pavingKind} hiddenFloors={hiddenFloors}
              />
            </Canvas>
          </GLBoundary>
        )}
        <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/20 to-transparent", !manifest && "hidden")} />

        {manifest && (
          <div className="pointer-events-auto absolute left-3 top-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-slate-900/60 p-1 backdrop-blur">
              {([["orbit", Orbit, "Orbit"], ["walk", Footprints, "Walk"], ["top", Grid2x2, "Top"]] as const).map(([m, Icon, label]) => (
                <button key={m} onClick={() => changeMode(m)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", mode === m ? "bg-primary text-white shadow" : "text-white/80 hover:bg-white/10")}>
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
            <button onClick={toggleMeasure} disabled={touring} className={cn("inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur transition-colors", measureOn ? "bg-primary text-white shadow" : "bg-slate-900/60 text-white/80 hover:bg-white/10", touring && "cursor-not-allowed opacity-40")}>
              <Ruler className="size-4" /> Measure
            </button>
            <button onClick={touring ? stopTour : startTour} disabled={!touring && tourRoute.length === 0}
              className={cn("inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur transition-colors", touring ? "bg-red-500/80 text-white" : "bg-slate-900/60 text-white/80 hover:bg-white/10", !touring && tourRoute.length === 0 && "cursor-not-allowed opacity-40")}>
              {touring ? <><Square className="size-4" /> Stop tour</> : <><Play className="size-4" /> Play tour</>}
            </button>
            {/* Floor visibility toggle — same interaction as viewer3d.tsx's
                Layers button row, shown only for a genuinely multi-floor build. */}
            {(info?.levelGroups.length ?? 0) > 1 && (
              <div className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-slate-900/60 p-1 pl-2 backdrop-blur">
                <Layers className="size-3.5 text-white/50" />
                {info!.levelGroups.map((_, i) => (
                  <button key={i} onClick={() => toggleFloor(i)} title={`Toggle floor ${i + 1}`} className={cn("size-7 rounded-md text-xs font-semibold transition-colors", hiddenFloors.has(i) ? "bg-white/5 text-white/40 hover:bg-white/10" : "bg-primary/80 text-white")}>{i + 1}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {manifest && mode === "walk" && !touring && (
          <div className="pointer-events-none absolute inset-x-0 top-16 z-10 grid place-items-center text-sm font-medium text-white/90">
            <span className="rounded-full bg-slate-900/80 px-4 py-2 backdrop-blur">Click to walk · W A S D move · mouse look · Shift run · scroll to zoom · Esc exit</span>
          </div>
        )}

        {/* Narrated auto-tour caption — plain absolutely-positioned overlay (matching
            the walk-mode hint above), instant per-room swap via the `key` remount
            plus a short fade/slide-in from tailwindcss-animate. */}
        {manifest && touring && tourRoute[tourIndex] && info && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
            <div key={tourIndex} className="max-w-md animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-white/15 bg-slate-900/80 px-5 py-3 text-center shadow backdrop-blur duration-500">
              <div className="text-sm font-semibold text-white">{tourCaption(tourRoute[tourIndex], info)}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
