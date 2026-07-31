"use client";

/**
 * Plan ↔ 3D scrubber — the signature "we're different" view.
 * A single draggable seam wipes between the clean 2D architectural plan (left) and the
 * live 3D dollhouse built from the very same model (right). One model, two representations,
 * side by side — the thing no other plan-to-3D tool puts in front of a buyer.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { Canvas, useThree } from "@react-three/fiber";
import { Bounds } from "@react-three/drei";
import { useQuery } from "@tanstack/react-query";
import { MoveHorizontal } from "lucide-react";
import type { SceneManifest } from "@/types";
import { BuildingLoader } from "@/components/ui/building-loader";
import { Building } from "@/features/viewer3d/building";

/* ------------------------------ 3D dollhouse ------------------------------ */

function IBL() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => { env.dispose(); pmrem.dispose(); };
  }, [gl, scene]);
  return null;
}

function Dollhouse({ manifest }: { manifest: SceneManifest }) {
  const cx = (manifest.bounds.min[0] + manifest.bounds.max[0]) / 2;
  const cz = (manifest.bounds.min[1] + manifest.bounds.max[1]) / 2;
  return (
    <Canvas
      orthographic
      shadows={false}
      dpr={[1, 2]}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      camera={{ position: [cx - 9, 13, cz + 11], zoom: 26, near: 0.1, far: 5000 }}
    >
      <color attach="background" args={["#0b1220"]} />
      <IBL />
      <hemisphereLight args={[0xffffff, 0x33405a, 1.0]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[cx + 12, 22, cz - 8]} intensity={1.7} />
      <Bounds fit clip observe margin={1.15}>
        <Building manifest={manifest} ceilingsVisible={false} roofVisible={false} onReady={() => {}} />
      </Bounds>
    </Canvas>
  );
}

/* -------------------------------- 2D plan --------------------------------- */

const TINT: Record<string, string> = {
  bedroom: "#dbeafe", master: "#c7d2fe", living: "#dcfce7", hall: "#dcfce7",
  kitchen: "#fef3c7", bathroom: "#cffafe", powder: "#cffafe", toilet: "#cffafe",
  dining: "#fae8ff", foyer: "#f1f5f9", balcony: "#ecfccb", garage: "#e2e8f0",
  utility: "#f1f5f9", store: "#f1f5f9", stair: "#e2e8f0",
};
const tintOf = (t: string) => {
  const k = Object.keys(TINT).find((k) => t?.toLowerCase().includes(k));
  return k ? TINT[k] : "#f8fafc";
};

function PlanSVG({ manifest }: { manifest: SceneManifest }) {
  const { min, max } = manifest.bounds;
  const w = max[0] - min[0], d = max[1] - min[1];
  const ground = manifest.rooms.filter((r) => (r.level ?? 0) === 0);
  const label = Math.max(0.26, Math.min(0.5, Math.min(w, d) * 0.035));
  return (
    <svg viewBox={`${min[0]} ${min[1]} ${w} ${d}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full">
      <rect x={min[0]} y={min[1]} width={w} height={d} fill="#ffffff" />
      {/* room fills */}
      {ground.map((r, i) => (
        <rect key={`f${i}`} x={r.center[0] - r.size[0] / 2} y={r.center[1] - r.size[1] / 2}
          width={r.size[0]} height={r.size[1]} fill={tintOf(r.type)} stroke="#cbd5e1" strokeWidth={0.02} />
      ))}
      {/* walls */}
      {(manifest.walls ?? []).map((wl, i) => (
        <line key={`w${i}`} x1={wl.a[0]} y1={wl.a[1]} x2={wl.b[0]} y2={wl.b[1]}
          stroke="#0f172a" strokeWidth={wl.exterior ? 0.2 : 0.11} strokeLinecap="round" />
      ))}
      {/* windows */}
      {manifest.windows.map((wn, i) => {
        const L = wn.len ?? 1.2, h = wn.orient === "v";
        return <line key={`wn${i}`} x1={wn.pos[0] - (h ? 0 : L / 2)} y1={wn.pos[1] - (h ? L / 2 : 0)}
          x2={wn.pos[0] + (h ? 0 : L / 2)} y2={wn.pos[1] + (h ? L / 2 : 0)} stroke="#0ea5e9" strokeWidth={0.16} strokeLinecap="round" />;
      })}
      {/* doors */}
      {manifest.doors.map((dr, i) => {
        const L = dr.width ?? 0.9, h = dr.orient === "v";
        return <line key={`dr${i}`} x1={dr.pos[0] - (h ? 0 : L / 2)} y1={dr.pos[1] - (h ? L / 2 : 0)}
          x2={dr.pos[0] + (h ? 0 : L / 2)} y2={dr.pos[1] + (h ? L / 2 : 0)}
          stroke={dr.entrance ? "#16a34a" : "#f59e0b"} strokeWidth={0.18} strokeLinecap="round" />;
      })}
      {/* labels */}
      {ground.map((r, i) => (
        <text key={`t${i}`} x={r.center[0]} y={r.center[1]} fontSize={label} textAnchor="middle"
          dominantBaseline="middle" fill="#334155" style={{ fontWeight: 600 }}>
          {r.name}
        </text>
      ))}
    </svg>
  );
}

/* ------------------------------- scrubber --------------------------------- */

export function PlanScrubber({ sceneUrl }: { sceneUrl: string | null }) {
  const { data: manifest, isLoading } = useQuery<SceneManifest>({
    queryKey: ["scrubber-manifest", sceneUrl],
    queryFn: () => fetch(sceneUrl!).then((r) => r.json()),
    enabled: !!sceneUrl,
  });
  const [pos, setPos] = useState(50);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  useEffect(() => {
    const move = (clientX: number) => {
      const el = wrap.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos(Math.max(2, Math.min(98, ((clientX - r.left) / r.width) * 100)));
    };
    const onMove = (e: PointerEvent) => { if (drag.current) { e.preventDefault(); move(e.clientX); } };
    const onUp = () => { drag.current = false; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, []);

  const hasModel = useMemo(() => !!manifest?.walls?.length, [manifest]);

  return (
    <div ref={wrap} className="relative h-[440px] w-full select-none overflow-hidden rounded-xl border border-border bg-slate-900">
      {/* 3D dollhouse (base, right side) */}
      {isLoading || !manifest ? (
        <div className="grid h-full w-full place-items-center text-white/70"><BuildingLoader light /></div>
      ) : hasModel ? (
        <Dollhouse manifest={manifest} />
      ) : (
        <div className="grid h-full w-full place-items-center text-sm text-white/60">Generate the 3D model to compare.</div>
      )}

      {/* 2D plan (overlay, clipped to the left of the seam) */}
      {manifest && hasModel && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-white" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <PlanSVG manifest={manifest} />
          </div>

          {/* labels */}
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-slate-900/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur">2D Plan</div>
          <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-slate-900/70 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur">3D Building</div>

          {/* seam + handle */}
          <div className="absolute inset-y-0 z-10 w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.2)]" style={{ left: `${pos}%` }} />
          <button
            aria-label="Drag to compare plan and 3D"
            onPointerDown={(e) => { e.preventDefault(); drag.current = true; }}
            className="absolute top-1/2 z-20 grid size-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize place-items-center rounded-full border border-white bg-white text-slate-700 shadow-lg transition-transform hover:scale-105"
            style={{ left: `${pos}%` }}
          >
            <MoveHorizontal className="size-4" />
          </button>
          <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/70 px-3 py-1 text-[11px] text-white/85 backdrop-blur">
            Drag the handle — your flat plan becomes a building
          </div>
        </>
      )}
    </div>
  );
}
