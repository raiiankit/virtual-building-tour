import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SceneManifest } from "@/types";
import { makeMaterial, classifyByColor, FLOOR_KIND } from "@/features/viewer3d/materials";
import { buildArchitecture } from "@/features/viewer3d/generate";

export interface RoomWorld { name: string; type: string; cx: number; cz: number; w: number; d: number; }
export interface BuiltScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rooms: RoomWorld[];
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number; cx: number; cz: number; sizeX: number; sizeZ: number };
  entrance: [number, number] | null;
  floorTop: number;
  wallHeight: number;
  dispose: () => void;
}

const FLOOR_COLORS: Record<string, number> = {
  wood: 0xa9713f, tile: 0xd6d3cc, marble: 0xe6e4de, antiskid: 0xb4bcbe,
  concrete: 0x8c8c90, outdoor: 0x86765c, room: 0xd6d9de,
};

/** Load the generated .glb + scene manifest into a cinematic-ready Three.js scene. */
export async function buildScene(renderer: THREE.WebGLRenderer, assetUrl: string, sceneUrl: string | null): Promise<BuiltScene> {
  const scene = new THREE.Scene();

  // soft studio sky
  const skyC = document.createElement("canvas"); skyC.width = 2; skyC.height = 256;
  const g = skyC.getContext("2d")!; const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#eef2f7"); grd.addColorStop(0.6, "#dfe5ec"); grd.addColorStop(1, "#c6ccd4");
  g.fillStyle = grd; g.fillRect(0, 0, 2, 256);
  const skyTex = new THREE.CanvasTexture(skyC); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x8c887f, 1.0));
  const sun = new THREE.DirectionalLight(0xfff1db, 2.8);
  sun.position.set(24, 40, 18); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // load manifest (rooms, doors, walls) — optional
  let manifest: SceneManifest | null = null;
  if (sceneUrl) { try { manifest = await fetch(sceneUrl).then((r) => r.json()); } catch { manifest = null; } }

  let size: THREE.Vector3, center: THREE.Vector3, minY: number, floorTop: number, wallHeight: number;
  const rooms: RoomWorld[] = [];

  if (manifest && manifest.walls && manifest.walls.length) {
    // proper procedural building — identical to the interactive viewer (open roof for
    // cinematic exterior→interior reveals)
    const built = buildArchitecture(manifest, { ceilings: false });
    built.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(built.group);
    size = built.size; center = built.center; minY = built.bounds.min.y;
    floorTop = built.floorTop; wallHeight = built.wallHeight;
    rooms.push(...built.rooms);
  } else {
    // legacy fallback: re-materialed GLB (older models with no wall data)
    const gltf = await new GLTFLoader().loadAsync(assetUrl);
    const model = gltf.scene;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      if (!m.geometry.getAttribute("normal")) m.geometry.computeVertexNormals();
      const src = m.material as THREE.MeshStandardMaterial;
      const kind = classifyByColor(src.color ?? new THREE.Color(0.9, 0.9, 0.9), src.metalness ?? 0, src.opacity ?? 1);
      const mat = makeMaterial(kind) as THREE.MeshStandardMaterial;
      mat.side = THREE.DoubleSide; mat.flatShading = true; mat.envMapIntensity = 0.9; mat.needsUpdate = true;
      m.material = mat;
    });
    scene.add(model);
    const bbox = new THREE.Box3().setFromObject(model);
    size = bbox.getSize(new THREE.Vector3()); center = bbox.getCenter(new THREE.Vector3());
    minY = bbox.min.y; floorTop = minY + 0.12; wallHeight = manifest?.wall_height_m ?? 2.7;
    if (manifest) for (const rm of manifest.rooms.filter((r) => r.level === 0)) {
      rooms.push({ name: rm.name, type: rm.type, cx: rm.center[0], cz: rm.center[1], w: rm.size[0], d: rm.size[1] });
      const fmat = makeMaterial(FLOOR_KIND[rm.floor_material || "tile"] ?? "tile") as THREE.MeshStandardMaterial;
      if (fmat.map) { const mm = fmat.map.clone(); mm.repeat.set(Math.max(1, rm.size[0] / 1.5), Math.max(1, rm.size[1] / 1.5)); mm.needsUpdate = true; fmat.map = mm; }
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(rm.size[0], rm.size[1]), fmat);
      fl.rotation.x = -Math.PI / 2; fl.position.set(rm.center[0], floorTop + 0.02, rm.center[1]); fl.receiveShadow = true; scene.add(fl);
    }
  }

  sun.target.position.copy(center);
  const r = Math.max(size.x, size.z) * 0.9 + 6;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 200 });
  sun.shadow.camera.updateProjectionMatrix();

  // site: grass + a paved plot around the building
  const gsize = Math.max(size.x, size.z) * 10 + 140;
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(gsize, gsize), new THREE.MeshStandardMaterial({ color: 0x6f8f4f, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.position.set(center.x, minY - 0.04, center.z); grass.receiveShadow = true; scene.add(grass);
  const plot = new THREE.Mesh(new THREE.PlaneGeometry(size.x + 16, size.z + 16), new THREE.MeshStandardMaterial({ color: 0xbcc0c7, roughness: 0.95 }));
  plot.rotation.x = -Math.PI / 2; plot.position.set(center.x, minY - 0.02, center.z); plot.receiveShadow = true; scene.add(plot);

  // interior lights from ceiling_light fixtures (furniture is otherwise empty)
  if (manifest) for (const f of manifest.furniture.filter((x) => x.type === "ceiling_light" && x.level === 0)) {
    const p = new THREE.PointLight(0xffe9c4, 5, Math.max(size.x, size.z) * 0.6, 2);
    p.position.set(f.pos[0], floorTop + (manifest.wall_height_m || 2.7) - 0.3, f.pos[1]); scene.add(p);
  }

  const bounds = { minX: center.x - size.x / 2, minZ: center.z - size.z / 2, maxX: center.x + size.x / 2, maxZ: center.z + size.z / 2, cx: center.x, cz: center.z, sizeX: size.x, sizeZ: size.z };
  const entranceDoor = manifest?.doors.find((d) => d.entrance);
  const entrance: [number, number] | null = entranceDoor ? [entranceDoor.pos[0], entranceDoor.pos[1]] : null;

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.05, 2000);

  const dispose = () => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    pmrem.dispose();
  };

  return { scene, camera, rooms, bounds, entrance, floorTop, wallHeight, dispose };
}
