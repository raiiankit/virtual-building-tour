import * as THREE from "three";
import { makeMaterial } from "@/features/viewer3d/materials";

/* Procedural canvas textures for the two outer ground planes (lawn + paved
 * apron) — same technique as furniture-materials.ts/viewer3d/materials.ts:
 * draw on a 2D canvas, wrap as a THREE.CanvasTexture, cache the *texture*
 * objects (cheap to reuse, expensive to redraw) but always hand back a fresh
 * THREE.Material instance per call so callers never mutate a shared/cached
 * material — no clone-before-mutate bookkeeping needed here. */
const texCache = new Map<string, THREE.Texture>();
function mkTex(key: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.Texture {
  const cached = texCache.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  texCache.set(key, t);
  return t;
}

/** Mottled grass texture — white/grey base with soft noise + a scattering of
 *  darker/lighter blotches (patchy lawn look), carrying no color of its own
 *  (like furniture-materials.ts's fabricTex) so it multiplies cleanly against
 *  whichever lawn color the Style panel picks. */
function grassTex(): THREE.Texture {
  const t = mkTex("ground_grass", (x, s) => {
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, s, s);
    const im = x.getImageData(0, 0, s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 46;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(im, 0, 0);
    for (let p = 0; p < 90; p++) {
      const px = Math.random() * s, py = Math.random() * s, r = 5 + Math.random() * 16;
      x.fillStyle = Math.random() < 0.5 ? "rgba(20,35,10,0.07)" : "rgba(215,225,150,0.07)";
      x.beginPath(); x.ellipse(px, py, r, r * 0.55, Math.random() * Math.PI, 0, Math.PI * 2); x.fill();
    }
  }, 256);
  t.repeat.set(26, 26);
  return t;
}

/** Concrete paver slabs — light grey cells with darker joint lines. Kept local
 *  (not in viewer3d/materials.ts's `outdoor` SurfaceKind, which is a warm
 *  brownish tile meant for interior-ish outdoor flooring, not a paving slab look). */
function paverTex(): THREE.Texture {
  const t = mkTex("ground_pavers", (x, s) => {
    const cells = 6, g = s / cells;
    x.fillStyle = "#8d8d8d"; x.fillRect(0, 0, s, s);
    for (let i = 0; i < cells; i++) {
      for (let j = 0; j < cells; j++) {
        const shade = 148 + Math.floor(Math.random() * 42);
        x.fillStyle = `rgb(${shade},${shade - 2},${shade - 6})`;
        x.fillRect(i * g + 3, j * g + 3, g - 6, g - 6);
      }
    }
  }, 256);
  t.repeat.set(5, 5);
  return t;
}

/** Speckled gravel — dense multi-tone noise, rougher/less regular than pavers. */
function gravelTex(): THREE.Texture {
  const t = mkTex("ground_gravel", (x, s) => {
    x.fillStyle = "#9c948a"; x.fillRect(0, 0, s, s);
    const im = x.getImageData(0, 0, s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 78;
      d[i] += n; d[i + 1] += n * 0.9; d[i + 2] += n * 0.8;
    }
    x.putImageData(im, 0, 0);
  }, 256);
  t.repeat.set(7, 7);
  return t;
}

/** Fresh (non-shared) lawn material tinted by the Style panel's ground-color
 *  swatch — grass texture carries only pattern/shading, `color` does the tint. */
export function makeGroundMaterial(color: string): THREE.Material {
  return new THREE.MeshStandardMaterial({ color, map: grassTex(), roughness: 1, metalness: 0 });
}

export type PavingKind = "concrete" | "pavers" | "gravel";
export const PAVING_OPTIONS: { value: PavingKind; label: string }[] = [
  { value: "concrete", label: "Concrete" },
  { value: "pavers", label: "Pavers" },
  { value: "gravel", label: "Gravel" },
];

/** Paved-apron material for the chosen paving kind. "concrete" reuses
 *  viewer3d/materials.ts's shared/cached `makeMaterial("concrete")` as-is
 *  (same texture already used for the driveway strip in site-context.tsx) —
 *  safe to share since nothing here mutates its color/repeat; "pavers" and
 *  "gravel" are fresh local materials built from the textures above. */
export function makePavingMaterial(kind: PavingKind): THREE.Material {
  switch (kind) {
    case "concrete":
      return makeMaterial("concrete");
    case "pavers":
      return new THREE.MeshStandardMaterial({ map: paverTex(), roughness: 0.85, metalness: 0 });
    case "gravel":
      return new THREE.MeshStandardMaterial({ map: gravelTex(), roughness: 1, metalness: 0 });
  }
}
