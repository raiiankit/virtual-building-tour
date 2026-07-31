"use client";

import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import { EffectComposer, Bloom, SMAA, BrightnessContrast, Vignette } from "@react-three/postprocessing";
import { useQuery } from "@tanstack/react-query";
import { Orbit, Footprints, Grid2x2, Maximize2, Camera as CameraIcon, Compass, DoorOpen, Loader2, Play, Square, Layers, Ruler, Sun, Sunrise } from "lucide-react";
import type { SceneManifest } from "@/types";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { BuildingLoader } from "@/components/ui/building-loader";
import { cn } from "@/lib/utils";
import { Building, type BuildingInfo } from "./building";
import { WalkControls } from "./walk-controls";

type Mode = "orbit" | "walk" | "top";
const ease = (u: number) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const sunLabel = (t: number) => { const h = Math.round(6 + t * 12); const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${h < 12 ? "am" : "pm"}`; };
// Post-processing is opt-in (NEXT_PUBLIC_VBT_POST=1). It can throw on some GPU/driver
// combos and blank the canvas; the renderer already does ACES tone mapping + soft
// shadows + IBL, so the default render is clean and sharp without it.
const POST = typeof process !== "undefined" && process.env.NEXT_PUBLIC_VBT_POST === "1";

/** Never let a WebGL/effect error blank the whole tab — fall back gracefully. */
class GLBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/* RoomEnvironment IBL (offline, no CDN) */
function StudioEnv() {
  const { scene, gl } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = env.texture;
    return () => { env.dispose(); pmrem.dispose(); };
  }, [scene, gl]);
  return null;
}

/* Smooth fly-to for orbit/top modes */
function Rig({ focus, controls }: { focus: { pos: THREE.Vector3; target: THREE.Vector3; key: string }; controls: React.RefObject<{ target: THREE.Vector3; update: () => void } | null> }) {
  const { camera } = useThree();
  const prog = useRef(1);
  const from = useRef({ pos: new THREE.Vector3(), tgt: new THREE.Vector3() });
  useEffect(() => { from.current.pos.copy(camera.position); from.current.tgt.copy(controls.current?.target ?? focus.target); prog.current = 0; }, [focus.key]); // eslint-disable-line
  useFrame((_, dt) => {
    if (prog.current >= 1) return;
    prog.current = Math.min(1, prog.current + dt / 1.1);
    const e = ease(prog.current);
    camera.position.lerpVectors(from.current.pos, focus.pos, e);
    if (controls.current) { controls.current.target.lerpVectors(from.current.tgt, focus.target, e); controls.current.update(); }
  });
  return null;
}

function WalkStart({ start, look }: { start: THREE.Vector3; look: THREE.Vector3 }) {
  const { camera } = useThree();
  useEffect(() => { camera.position.copy(start); camera.lookAt(look); }, []); // eslint-disable-line
  return null;
}

/** A single guided-navigation arrow on the floor (Matterport/Street-View style): it
 *  always sits just ahead of the walker and points to the next room along a
 *  nearest-neighbour route, advancing as you arrive. One arrow, never a swarm. */
function GuideArrow({ rooms, floorTop }: { rooms: { cx: number; cz: number }[]; floorTop: number }) {
  const { camera } = useThree();
  const idx = useRef(0);
  const grp = useRef<THREE.Group>(null);
  const y = floorTop + 0.04;

  const waypoints = useMemo(() => {
    const pts = rooms.map((r) => new THREE.Vector3(r.cx, y, r.cz));
    if (pts.length <= 2) return pts;
    const route = [pts[0]]; const rest = pts.slice(1);   // greedy nearest-neighbour path
    while (rest.length) {
      const last = route[route.length - 1];
      let bi = 0, bd = Infinity;
      rest.forEach((p, i) => { const d = last.distanceTo(p); if (d < bd) { bd = d; bi = i; } });
      route.push(rest.splice(bi, 1)[0]);
    }
    return route;
  }, [rooms, y]);

  const geom = useMemo(() => {
    const s = new THREE.Shape();   // solid arrow pointing -Y, laid flat to point +Z
    s.moveTo(-0.1, 0.32); s.lineTo(0.1, 0.32); s.lineTo(0.1, -0.02);
    s.lineTo(0.24, -0.02); s.lineTo(0, -0.4); s.lineTo(-0.24, -0.02);
    s.lineTo(-0.1, -0.02); s.closePath();
    const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return g;
  }, []);
  // draw on top (depthTest off) so the guide never hides behind a wall
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide }), []);
  useEffect(() => () => { geom.dispose(); mat.dispose(); }, [geom, mat]);

  useFrame((state) => {
    const g = grp.current; if (!g || !waypoints.length) return;
    const cam = new THREE.Vector3(camera.position.x, y, camera.position.z);
    let tgt = waypoints[idx.current];
    if (cam.distanceTo(tgt) < 1.7) { idx.current = (idx.current + 1) % waypoints.length; tgt = waypoints[idx.current]; }  // arrived → next room
    // sit the arrow on the floor a little ahead of the gaze so it's always in view…
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    g.position.copy(cam).addScaledVector(fwd, 3.8);   // far enough ahead to sit in the lower view
    // …and rotate it to point toward the next room
    const dir = new THREE.Vector3().subVectors(tgt, g.position); dir.y = 0;
    if (dir.lengthSq() > 1e-4) { dir.normalize(); g.rotation.y = Math.atan2(dir.x, dir.z); }
    const t = state.clock.elapsedTime * 3;
    mat.opacity = 0.72 + 0.22 * Math.sin(t);          // gentle pulse
    g.scale.setScalar(1.9 + 0.14 * Math.sin(t));
  });

  return <group ref={grp} renderOrder={999}><mesh geometry={geom} material={mat} /></group>;
}

function Scene({ assetUrl, manifest, mode, focus, onInfo, controlsRef, onHeading, sunT }: {
  assetUrl: string; manifest: SceneManifest | null; mode: Mode;
  focus: { pos: THREE.Vector3; target: THREE.Vector3; key: string };
  onInfo: (i: BuildingInfo) => void; controlsRef: React.RefObject<any>; onHeading: (deg: number) => void; sunT: number; // eslint-disable-line
}) {
  const [info, setInfo] = useState<BuildingInfo | null>(null);
  const handleInfo = useCallback((i: BuildingInfo) => { setInfo(i); onInfo(i); }, [onInfo]);
  const lastH = useRef(0); const lastDeg = useRef(0);
  useFrame(({ camera }) => {
    const now = performance.now();
    if (now - lastH.current < 200) return;
    lastH.current = now;
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    const deg = (Math.atan2(d.x, -d.z) * 180) / Math.PI;
    if (Math.abs(deg - lastDeg.current) > 1.5) { lastDeg.current = deg; onHeading(deg); }
  });

  const maxSize = info ? Math.max(info.size.x, info.size.z) : 20;

  // time-of-day sun: 0 = dawn (low, east, warm) · 0.5 = noon (high, white) · 1 = dusk (low, west, warm)
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
    };
  }, [sunT, maxSize]);

  return (
    <>
      <color attach="background" args={[sun.sky.getStyle()]} />
      <fog attach="fog" args={[sun.sky.getStyle(), maxSize * 3, maxSize * 9]} />
      <StudioEnv />
      <hemisphereLight intensity={sun.hemi} color="#f4f1ea" groundColor="#8c887f" />
      <directionalLight
        position={sun.pos} intensity={sun.intensity} color={sun.color} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-maxSize} shadow-camera-right={maxSize} shadow-camera-top={maxSize} shadow-camera-bottom={-maxSize} shadow-camera-near={1} shadow-camera-far={maxSize * 4}
      />
      {/* site: green plot + a paved apron around the building (like a real render) */}
      <group position={[info?.center.x ?? 0, (info?.bounds.min.y ?? 0) - 0.04, info?.center.z ?? 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[maxSize * 10 + 140, maxSize * 10 + 140]} />
          <meshStandardMaterial color="#6f8f4f" roughness={1} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
          <planeGeometry args={[(info?.size.x ?? 20) + 16, (info?.size.z ?? 20) + 16]} />
          <meshStandardMaterial color="#bcc0c7" roughness={0.95} />
        </mesh>
      </group>

      <Suspense fallback={<Html center><BuildingLoader light /></Html>}>
        <Building manifest={manifest} ceilingsVisible={mode === "walk"} roofVisible={mode === "orbit"} onReady={handleInfo} />
      </Suspense>

      {mode !== "walk" && info && (
        <>
          <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={mode === "top" ? 0.2 : Math.PI * 0.495} minDistance={2} maxDistance={maxSize * 4} />
          <Rig focus={focus} controls={controlsRef} />
        </>
      )}
      {mode === "walk" && info && (
        <>
          <WalkStart start={new THREE.Vector3(info.rooms[0]?.cx ?? info.center.x, info.floorTop + 1.7, info.rooms[0]?.cz ?? info.center.z)} look={new THREE.Vector3(info.center.x, info.floorTop + 1.6, info.center.z)} />
          <WalkControls enabled collidables={info.collidables} walkSurfaces={info.walkSurfaces} floorTop={info.floorTop} />
          <GuideArrow rooms={info.rooms} floorTop={info.floorTop} />
        </>
      )}

      {POST && (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1.05} intensity={0.2} />
          <BrightnessContrast brightness={0.01} contrast={0.05} />
          <Vignette eskil={false} offset={0.25} darkness={0.5} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}

export default function Viewer3D({ assetUrl, sceneUrl, heightClass = "h-[640px]" }: { assetUrl: string; sceneUrl: string | null; heightClass?: string }) {
  const { data: manifest } = useQuery<SceneManifest>({ queryKey: ["manifest", sceneUrl], queryFn: () => fetch(sceneUrl!).then((r) => r.json()), enabled: !!sceneUrl });
  const [mode, setModeRaw] = useState<Mode>("orbit");
  const [info, setInfo] = useState<BuildingInfo | null>(null);
  const [room, setRoom] = useState<string>("");
  const [heading, setHeading] = useState(0);
  const [sunT, setSunT] = useState(0.5);
  const [touring, setTouring] = useState(false);
  const [hiddenFloors, setHiddenFloors] = useState<Set<number>>(new Set());
  const controlsRef = useRef<any>(null); // eslint-disable-line
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const tourRef = useRef<number | null>(null);

  const stopTour = useCallback(() => { if (tourRef.current) { clearTimeout(tourRef.current); tourRef.current = null; } setTouring(false); }, []);
  const setMode = useCallback((m: Mode) => { stopTour(); setModeRaw(m); }, [stopTour]);

  // auto-walkthrough: fly the camera from room to room, then release to overview
  const startTour = useCallback(() => {
    const rs = info?.rooms ?? [];
    if (!rs.length) return;
    setModeRaw("orbit"); setTouring(true);
    let i = 0; setRoom(rs[0].name);
    const step = () => {
      i += 1;
      if (i >= rs.length) { setTouring(false); setRoom(""); tourRef.current = null; return; }
      setRoom(rs[i].name);
      tourRef.current = window.setTimeout(step, 3400);
    };
    tourRef.current = window.setTimeout(step, 3400);
  }, [info]);
  useEffect(() => () => { if (tourRef.current) clearTimeout(tourRef.current); }, []);
  useEffect(() => { setHiddenFloors(new Set()); }, [info]);   // fresh building → all floors shown

  const toggleFloor = (lvl: number) => {
    const g = info?.levelGroups[lvl]; if (!g) return;
    setHiddenFloors((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) { next.delete(lvl); g.visible = true; } else { next.add(lvl); g.visible = false; }
      return next;
    });
  };
  const levels = info?.levelGroups.length ?? 0;

  const focus = useMemo(() => {
    const c = info?.center ?? new THREE.Vector3();
    const s = info?.size ?? new THREE.Vector3(20, 3, 20);
    const maxS = Math.max(s.x, s.z);
    const ft = info?.floorTop ?? 0;
    const rdy = info ? "1" : "0";
    const r = info?.rooms.find((x) => x.name === room);
    if (mode === "top") return { pos: new THREE.Vector3(c.x, ft + maxS * 1.6 + 8, c.z + 0.01), target: c.clone(), key: `top-${room}-${rdy}` };
    if (r) return { pos: new THREE.Vector3(r.cx + 3.5, ft + 3, r.cz + 3.5), target: new THREE.Vector3(r.cx, ft + 1.4, r.cz), key: `room-${room}-${mode}-${rdy}` };
    const dd = maxS * 1.5 + 6;
    return { pos: new THREE.Vector3(c.x + dd, ft + s.y + dd * 0.45, c.z + dd), target: c.clone(), key: `orbit-${mode}-${rdy}` };
  }, [mode, room, info]);

  const screenshot = () => {
    const gl = glRef.current; if (!gl) return;
    const a = document.createElement("a"); a.href = gl.domElement.toDataURL("image/png"); a.download = "building-view.png"; a.click();
  };
  const fullscreen = () => wrapRef.current?.requestFullscreen?.();
  const rooms = info?.rooms ?? [];

  // real-world building dimensions (metres) derived from the approved plan's scale
  const dims = useMemo(() => {
    if (!info) return null;
    const floors = info.levelGroups.length || 1;
    const height = floors * (manifest?.floor_height_m ?? 3);
    const area = info.rooms.reduce((s, r) => s + r.w * r.d, 0);   // built-up area per floor
    return { w: info.size.x, l: info.size.z, height, floors, area };
  }, [info, manifest]);
  const selRoom = rooms.find((r) => r.name === room);

  return (
    <div ref={wrapRef} className={cn("relative w-full overflow-hidden rounded-xl border border-border bg-slate-900", heightClass)}>
      {mode === "walk" && <div className="pointer-events-none absolute inset-x-0 top-16 z-10 grid place-items-center text-sm font-medium text-white/90"><span className="rounded-full bg-slate-900/80 px-4 py-2 backdrop-blur">Click to walk · W A S D move · mouse look · Shift run · Esc exit</span></div>}

      <GLBoundary fallback={
        <div className="grid h-full w-full place-items-center bg-slate-800 text-center text-white/70">
          <div className="max-w-xs space-y-2 px-6"><p className="text-sm">The realistic 3D engine couldn&apos;t start on this device.</p>
            <p className="text-xs text-white/50">Try a hardware-accelerated browser (Chrome/Edge) with WebGL enabled, or reload the page.</p></div>
        </div>
      }>
        <Canvas shadows dpr={[1, 2]} gl={{ antialias: !POST, preserveDrawingBuffer: true, powerPreference: "high-performance", logarithmicDepthBuffer: true }}
          camera={{ fov: 55, near: 0.1, far: 2000, position: [24, 18, 24] }}
          onCreated={({ gl }) => { glRef.current = gl; gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>
          <Scene assetUrl={assetUrl} manifest={manifest ?? null} mode={mode} focus={focus} onInfo={setInfo} controlsRef={controlsRef} onHeading={setHeading} sunT={sunT} />
        </Canvas>
      </GLBoundary>

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0 p-3">
        {/* modes + tour + floors */}
        <div className="pointer-events-auto flex flex-col gap-2">
          <div className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-slate-900/60 p-1 backdrop-blur">
            {([["orbit", Orbit, "Orbit"], ["walk", Footprints, "Walk"], ["top", Grid2x2, "Top"]] as const).map(([m, Icon, label]) => (
              <button key={m} onClick={() => setMode(m)} className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", mode === m ? "bg-primary text-white shadow" : "text-white/80 hover:bg-white/10")}><Icon className="size-4" /> {label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rooms.length > 0 && (
              <button onClick={touring ? stopTour : startTour} className={cn("inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-sm font-medium backdrop-blur transition-colors", touring ? "bg-red-500/80 text-white" : "bg-slate-900/60 text-white/90 hover:bg-white/10")}>
                {touring ? <><Square className="size-3.5" /> Stop tour</> : <><Play className="size-3.5" /> Play tour</>}
              </button>
            )}
            {levels > 1 && (
              <div className="inline-flex items-center gap-1 rounded-xl border border-white/15 bg-slate-900/60 p-1 pl-2 backdrop-blur">
                <Layers className="size-3.5 text-white/50" />
                {Array.from({ length: levels }, (_, i) => (
                  <button key={i} onClick={() => toggleFloor(i)} title={`Toggle floor ${i + 1}`} className={cn("size-7 rounded-md text-xs font-semibold transition-colors", hiddenFloors.has(i) ? "bg-white/5 text-white/40 hover:bg-white/10" : "bg-primary/80 text-white")}>{i + 1}</button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* right tools */}
        <div className="pointer-events-auto absolute right-3 top-3 flex items-center gap-1.5">
          {rooms.length > 0 && (
            <select value={room} onChange={(e) => setRoom(e.target.value)} className="h-9 rounded-lg border border-white/15 bg-slate-900/60 px-3 text-sm text-white backdrop-blur outline-none">
              <option value="">Jump to room…</option>
              {rooms.map((r, i) => <option key={i} value={r.name} className="text-black">{r.name}</option>)}
            </select>
          )}
          <Hint label="Screenshot"><Button size="icon-sm" variant="ghost" className="border border-white/15 bg-slate-900/60 text-white hover:bg-white/10" onClick={screenshot}><CameraIcon className="size-4" /></Button></Hint>
          <Hint label="Fullscreen"><Button size="icon-sm" variant="ghost" className="border border-white/15 bg-slate-900/60 text-white hover:bg-white/10" onClick={fullscreen}><Maximize2 className="size-4" /></Button></Hint>
        </div>

        {/* compass */}
        <div className="absolute bottom-3 right-3 grid size-14 place-items-center rounded-full border border-white/15 bg-slate-900/60 backdrop-blur">
          <Compass className="size-8 text-white/70" style={{ transform: `rotate(${-heading}deg)` }} />
          <span className="absolute top-1 text-[9px] font-bold text-red-400">N</span>
        </div>

        {/* time-of-day / daylight */}
        <div className="pointer-events-auto absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-slate-900/60 px-3 py-1.5 backdrop-blur">
          <Sunrise className="size-3.5 text-amber-300/90" />
          <input type="range" min={0} max={1} step={0.01} value={sunT} onChange={(e) => setSunT(Number(e.target.value))} aria-label="Time of day" className="w-24 accent-amber-400 sm:w-36" />
          <Sun className="size-4 text-amber-200" />
          <span className="w-9 text-center text-[11px] font-medium tabular-nums text-white/85">{sunLabel(sunT)}</span>
        </div>

        {/* dimensions */}
        {dims && (
          <div className="absolute bottom-3 left-3 space-y-1 rounded-lg border border-white/15 bg-slate-900/60 px-3 py-2 text-xs text-white/80 backdrop-blur">
            <div className="flex items-center gap-1.5 font-semibold text-white"><Ruler className="size-3.5" /> Building dimensions</div>
            <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
              <span>Footprint</span><span className="text-white">{dims.w.toFixed(1)} × {dims.l.toFixed(1)} m</span>
              <span>Height</span><span className="text-white">{dims.height.toFixed(1)} m · {dims.floors} {dims.floors > 1 ? "floors" : "floor"}</span>
              <span>Floor-to-floor</span><span className="text-white">{(manifest?.floor_height_m ?? 3).toFixed(2)} m</span>
              <span>Built-up / floor</span><span className="text-white">≈ {dims.area.toFixed(0)} m²</span>
              <span className="flex items-center gap-1"><DoorOpen className="size-3" /> Rooms</span><span className="text-white">{rooms.length}</span>
            </div>
            {selRoom && <div className="mt-1 border-t border-white/10 pt-1">{selRoom.name}: <span className="text-white">{selRoom.w.toFixed(1)} × {selRoom.d.toFixed(1)} m · {(selRoom.w * selRoom.d).toFixed(1)} m²</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}
