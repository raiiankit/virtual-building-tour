import * as THREE from "three";
import { makeMaterial } from "@/features/viewer3d/materials";

/* Cached simple PBR materials for furnish.py's material palette:
 * ceramic, glass, metal, antiskid, wood, marble, steel, dark, screen, fabric,
 * light, plant, car, concrete — reusing makeMaterial() where the kind already
 * exists there (glass, antiskid, concrete). */
const cache = new Map<string, THREE.Material>();

// small deterministic hash so fabric pieces vary slightly instead of being identical
function hash(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

const FABRIC_TONES = [0x8a7360, 0x6b7a8f, 0x9c8468, 0x7d6a6a, 0xa08f6e];

/* --------------------------- procedural canvas textures -------------------
 * Same technique as features/viewer3d/materials.ts (private there, so small
 * standalone versions live here): draw on a 2D canvas, wrap as a
 * THREE.CanvasTexture, cache the texture objects themselves (not per-mesh). */
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
function mkBump(key: string, draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 256): THREE.Texture {
  const cached = texCache.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  texCache.set(key, t);
  return t;
}

/** Fine plank/grain texture for wood-kind furniture. */
function furnitureWoodTex(): THREE.Texture {
  const t = mkTex("furn_wood", (x, s) => {
    const tones = ["#a9764a", "#9c6a3f", "#b28150", "#8f6238"];
    const planks = 5, pw = s / planks;
    for (let i = 0; i < planks; i++) {
      x.fillStyle = tones[i % tones.length]; x.fillRect(i * pw, 0, pw, s);
      x.strokeStyle = "rgba(60,38,16,0.16)"; x.lineWidth = 1;
      for (let g = 0; g < 18; g++) {
        const gx = i * pw + Math.random() * pw;
        x.beginPath(); x.moveTo(gx, 0); x.bezierCurveTo(gx + 4, s * 0.33, gx - 4, s * 0.66, gx + 2, s); x.stroke();
      }
      x.strokeStyle = "rgba(45,28,12,0.4)"; x.lineWidth = 1.5; x.strokeRect(i * pw, 0, pw, s);
    }
  });
  t.repeat.set(2, 2);
  return t;
}
function furnitureWoodBump(): THREE.Texture {
  const t = mkBump("furn_wood_b", (x, s) => {
    const im = x.createImageData(s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 18; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    x.putImageData(im, 0, 0);
  });
  t.repeat.set(2, 2);
  return t;
}

/** Soft marble veining over a light noise base — for counters/basins. */
function marbleTex(): THREE.Texture {
  return mkTex("furn_marble", (x, s) => {
    x.fillStyle = "#e9e5db"; x.fillRect(0, 0, s, s);
    const im = x.getImageData(0, 0, s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 6; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(im, 0, 0);
    x.strokeStyle = "rgba(150,145,135,0.35)";
    for (let v = 0; v < 6; v++) {
      x.lineWidth = 0.6 + Math.random() * 1.2;
      const x0 = Math.random() * s;
      x.beginPath(); x.moveTo(x0, 0);
      x.bezierCurveTo(x0 + (Math.random() - 0.5) * s * 0.6, s * 0.33, x0 + (Math.random() - 0.5) * s * 0.6, s * 0.66, x0 + (Math.random() - 0.5) * s * 0.3, s);
      x.stroke();
    }
  });
}

/** Subtle woven-fabric noise, tinted per-instance via .color — the texture
 *  itself carries no color, only a muted weave pattern (kept to a single
 *  cached variant, reused across all fabric pieces). */
function fabricTex(): THREE.Texture {
  const t = mkTex("furn_fabric", (x, s) => {
    x.fillStyle = "#ffffff"; x.fillRect(0, 0, s, s);
    const im = x.getImageData(0, 0, s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const px = (i / 4) % s, py = Math.floor(i / 4 / s);
      const weave = ((px % 4 < 2) !== (py % 4 < 2)) ? 10 : -10;
      const n = weave + (Math.random() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(im, 0, 0);
  }, 128);
  t.repeat.set(6, 6);
  return t;
}
function fabricBump(): THREE.Texture {
  const t = mkBump("furn_fabric_b", (x, s) => {
    const im = x.createImageData(s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const px = (i / 4) % s, py = Math.floor(i / 4 / s);
      const weave = ((px % 4 < 2) !== (py % 4 < 2)) ? 14 : -14;
      const v = 128 + weave + (Math.random() - 0.5) * 10;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  }, 128);
  t.repeat.set(6, 6);
  return t;
}

/** Fine brushed-metal streaks — many thin horizontal lines with slight per-line grey variation. */
function brushedMetalTex(): THREE.Texture {
  return mkTex("furn_metal", (x, s) => {
    x.fillStyle = "#b7bbbf"; x.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y++) {
      const g = 170 + Math.floor((Math.random() - 0.5) * 40);
      x.strokeStyle = `rgb(${g},${g + 2},${g + 4})`;
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, y + 0.5); x.lineTo(s, y + 0.5); x.stroke();
    }
  }, 128);
}
function brushedMetalBump(): THREE.Texture {
  return mkBump("furn_metal_b", (x, s) => {
    const im = x.createImageData(s, s), d = im.data;
    for (let y = 0; y < s; y++) {
      const v = 128 + Math.floor((Math.random() - 0.5) * 30);
      for (let px = 0; px < s; px++) { const i = (y * s + px) * 4; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    }
    x.putImageData(im, 0, 0);
  }, 128);
}

/** Barely-there glossy imperfections — ceramic sanitaryware stays close to smooth. */
function ceramicTex(): THREE.Texture {
  return mkTex("furn_ceramic", (x, s) => {
    x.fillStyle = "#f6f5f1"; x.fillRect(0, 0, s, s);
    const im = x.getImageData(0, 0, s, s), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 3; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    x.putImageData(im, 0, 0);
  }, 128);
}

export function makeFurnitureMaterial(kind: string, pos?: [number, number]): THREE.Material {
  const key = pos && kind === "fabric" ? `fabric:${Math.round(pos[0] * 3)}:${Math.round(pos[1] * 3)}` : kind;
  const cached = cache.get(key);
  if (cached) return cached;

  let mat: THREE.Material;
  switch (kind) {
    case "glass":
      mat = makeMaterial("glass");
      break;
    case "antiskid":
      mat = makeMaterial("antiskid");
      break;
    case "concrete":
      mat = makeMaterial("concrete");
      break;
    case "ceramic":
      mat = new THREE.MeshStandardMaterial({
        color: 0xf5f4f0, map: ceramicTex(), bumpMap: ceramicTex(), bumpScale: 0.003, roughness: 0.18, metalness: 0.02,
      });
      break;
    case "metal":
      mat = new THREE.MeshStandardMaterial({
        color: 0xb8bcc0, map: brushedMetalTex(), bumpMap: brushedMetalBump(), bumpScale: 0.006, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.3,
      });
      break;
    case "wood":
      mat = new THREE.MeshStandardMaterial({
        color: 0x8a5f3a, map: furnitureWoodTex(), bumpMap: furnitureWoodBump(), bumpScale: 0.006, roughness: 0.5, metalness: 0.05,
      });
      break;
    case "marble":
      mat = new THREE.MeshStandardMaterial({
        color: 0xe8e4dc, map: marbleTex(), bumpMap: marbleTex(), bumpScale: 0.003, roughness: 0.15, metalness: 0.05,
      });
      break;
    case "steel":
      mat = new THREE.MeshStandardMaterial({
        color: 0xc9cdd1, map: brushedMetalTex(), bumpMap: brushedMetalBump(), bumpScale: 0.008, roughness: 0.25, metalness: 0.95, envMapIntensity: 1.35,
      });
      break;
    case "dark":
      mat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.4, metalness: 0.3, envMapIntensity: 1.2 });
      break;
    case "screen":
      mat = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.2, metalness: 0.1, emissive: 0x1a2233, emissiveIntensity: 0.4 });
      break;
    case "fabric": {
      const idx = pos ? Math.floor(hash(pos[0], pos[1]) * FABRIC_TONES.length) : 0;
      mat = new THREE.MeshStandardMaterial({
        color: FABRIC_TONES[idx % FABRIC_TONES.length], map: fabricTex(), bumpMap: fabricBump(), bumpScale: 0.004, roughness: 0.85, metalness: 0,
      });
      break;
    }
    case "light":
      // tuned down from an earlier 1.6 — without the optional bloom pass (POST flag,
      // off by default) plain ACES tonemapping reads this as clearly overexposed.
      mat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffd98a, emissiveIntensity: 1.15, roughness: 0.4, metalness: 0 });
      break;
    case "plant":
      mat = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.9, metalness: 0 });
      break;
    case "car":
      mat = new THREE.MeshStandardMaterial({ color: 0x9a1f2b, roughness: 0.25, metalness: 0.6, envMapIntensity: 1.2 });
      break;
    default:
      mat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.7, metalness: 0.05 });
  }
  cache.set(key, mat);
  return mat;
}
