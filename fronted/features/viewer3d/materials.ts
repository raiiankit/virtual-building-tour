import * as THREE from "three";

/* Procedural seamless PBR textures — no external files, cached per key. */
const cache = new Map<string, THREE.Texture>();
function mk(key: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 512): THREE.Texture {
  if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  cache.set(key, t); return t;
}
function noiseTex(key: string, base: string, amt: number, size = 256): THREE.Texture {
  return mk(key, (x, s) => { x.fillStyle = base; x.fillRect(0, 0, s, s);
    const im = x.getImageData(0, 0, s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(im, 0, 0); }, size);
}
function bumpFrom(key: string, amt: number, size = 256): THREE.Texture {
  const t = mk(key, (x, s) => { const im = x.createImageData(s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const v = 128 + (Math.random() - 0.5) * amt; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(im, 0, 0); }, size);
  t.colorSpace = THREE.NoColorSpace; return t;
}

function woodTex(key: string, tones: string[]): THREE.Texture {
  return mk(key, (x, s) => {
    const planks = 4, pw = s / planks;
    for (let i = 0; i < planks; i++) {
      x.fillStyle = tones[i % tones.length]; x.fillRect(i * pw, 0, pw, s);
      x.strokeStyle = "rgba(70,45,20,0.14)"; x.lineWidth = 1;
      for (let g = 0; g < 26; g++) { const gx = i * pw + Math.random() * pw; x.beginPath(); x.moveTo(gx, 0); x.bezierCurveTo(gx + 5, s * 0.33, gx - 5, s * 0.66, gx + 2, s); x.stroke(); }
      x.strokeStyle = "rgba(40,25,10,0.5)"; x.lineWidth = 2; x.strokeRect(i * pw, 0, pw, s);
    }
  });
}
function tileTex(key: string, base: string, grout: string, cells: number): THREE.Texture {
  return mk(key, (x, s) => { const n = cells, g = s / n; x.fillStyle = grout; x.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { x.fillStyle = base; x.fillRect(i * g + 2, j * g + 2, g - 4, g - 4); } });
}

export type SurfaceKind =
  | "plaster" | "facade" | "skirting" | "wood_floor" | "tile" | "antiskid" | "concrete" | "outdoor"
  | "wood_door" | "door_frame" | "aluminium" | "glass" | "brass";

/** Build a premium PBR material for a given architectural surface. */
export function makeMaterial(kind: SurfaceKind): THREE.Material {
  switch (kind) {
    case "plaster": {
      const t = noiseTex("plaster", "#f7f7f5", 8); t.repeat.set(3, 3);
      const b = bumpFrom("plaster_b", 26); b.repeat.set(3, 3);
      return new THREE.MeshStandardMaterial({ color: 0xf8f8f8, map: t, bumpMap: b, bumpScale: 0.004, roughness: 0.94, metalness: 0 });
    }
    case "facade": {                              // warm painted exterior stucco
      const t = noiseTex("facade", "#e7e0d3", 10); t.repeat.set(2.5, 2.5);
      const b = bumpFrom("facade_b", 34); b.repeat.set(2.5, 2.5);
      return new THREE.MeshStandardMaterial({ color: 0xe9e2d5, map: t, bumpMap: b, bumpScale: 0.006, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    }
    case "skirting":
      return new THREE.MeshStandardMaterial({ color: 0xeceae4, roughness: 0.55, metalness: 0 });
    case "wood_floor": {
      const t = woodTex("woodfloor", ["#c8a06a", "#b78c53", "#cea975", "#b28647"]);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.05 });
    }
    case "tile": {
      const t = tileTex("tile", "#dad7d0", "#c2beb6", 4);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.28, metalness: 0.04 });
    }
    case "antiskid": {
      const t = tileTex("antiskid", "#b7bec1", "#9aa1a4", 8);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0 });
    }
    case "concrete": {
      const t = noiseTex("concrete", "#8f8f92", 30); t.repeat.set(4, 4);
      const b = bumpFrom("concrete_b", 40); b.repeat.set(4, 4);
      return new THREE.MeshStandardMaterial({ map: t, bumpMap: b, bumpScale: 0.006, roughness: 0.95, metalness: 0 });
    }
    case "outdoor": {
      const t = tileTex("outdoor", "#8a7a63", "#6f6250", 5);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0 });
    }
    case "wood_door": {
      const t = woodTex("wooddoor", ["#6e4626", "#5e3b20", "#734b29", "#5a3a1f"]);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.42, metalness: 0.05 });
    }
    case "door_frame":
      return new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.5, metalness: 0.05 });
    case "aluminium":
      return new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.32, metalness: 0.9 });
    case "brass":
      return new THREE.MeshStandardMaterial({ color: 0xc7ad76, roughness: 0.28, metalness: 0.95 });
    case "glass":
      // `transmission` already makes this see-through by physically letting light pass
      // through — layering classic alpha `transparent`/`opacity` blending on top of it
      // is a known bad combo in three.js: the two transparency models fight over the
      // same render pass, and depending on what's directly behind the pane (a room's
      // wood furniture sitting close to a window, say) the alpha blend can win out and
      // paint the glass as a flat, undertinted view of whatever's behind it instead of
      // a reflective/tinted pane. Keep the object opaque and let transmission alone
      // carry the see-through look, with enough reflectivity that the pane still reads
      // as glass (not as "invisible") even when something is right behind it.
      return new THREE.MeshPhysicalMaterial({ color: 0xcfe4ef, roughness: 0.05, metalness: 0, transmission: 0.82, ior: 1.5, thickness: 0.03, envMapIntensity: 1.3, reflectivity: 0.55 });
  }
}

export const FLOOR_KIND: Record<string, SurfaceKind> = {
  wood: "wood_floor", tile: "tile", marble: "tile", antiskid: "antiskid", concrete: "concrete", outdoor: "outdoor",
};

/** Classify a GLB primitive to a surface kind by its material colour (fixed palette). */
export function classifyByColor(c: THREE.Color, metal: number, opacity: number): SurfaceKind {
  if (opacity < 0.9) return "glass";
  const near = (r: number, g: number, b: number) => Math.abs(c.r - r) + Math.abs(c.g - g) + Math.abs(c.b - b) < 0.12;
  if (metal > 0.7) return near(0.75, 0.72, 0.62) ? "brass" : "aluminium";
  if (near(0.92, 0.92, 0.90)) return "plaster";
  if (near(0.24, 0.21, 0.19)) return "skirting";
  if (near(0.22, 0.14, 0.08)) return "door_frame";
  if (near(0.40, 0.26, 0.13)) return "wood_door";
  if (near(0.55, 0.55, 0.56)) return "concrete";
  if (near(0.80, 0.77, 0.71)) return "tile";
  return "plaster";
}
