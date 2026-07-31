"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FurniturePiece } from "./furnish";
import type { FurnitureOverride } from "./furniture-scene";

/**
 * "Realistic models (beta)" — a small, hand-picked set of Poly Haven CC0
 * (public domain, no attribution required — https://polyhaven.com/license)
 * glTF models swapped in for the matching procedural furniture.type when the
 * user opts in. Verified working (HTTP 200, CORS-open) 1k glTF exports as of
 * this batch — kept intentionally small (only where the payoff is highest):
 *   - sofa          -> "Sofa 01"        (dl.polyhaven.org/.../Sofa_01)
 *   - bed           -> "Old Bed Frame"  (dl.polyhaven.org/.../old_bed_frame)
 *   - dining_table  -> "Dining Table"   (dl.polyhaven.org/.../dining_table)
 * A 4th type (wardrobe/armchair) was deliberately left out: Poly Haven has no
 * CC0 tall-wardrobe model, and its armchairs would look repetitive/wrong
 * reused across every dining "chair" instance — better to leave those on the
 * reliable procedural builder than ship a visual mismatch.
 */
export const GLTF_MODEL_URLS: Record<string, string> = {
  sofa: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/Sofa_01/Sofa_01_1k.gltf",
  bed: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/old_bed_frame/old_bed_frame_1k.gltf",
  dining_table: "https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/dining_table/dining_table_1k.gltf",
};

// Poly Haven's glTF exports reference their textures as "textures/<file>.jpg"
// relative to the .gltf file's own URL, but the CDN only actually mirrors
// those jpgs under a sibling ".../Models/jpg/<res>/<name>/" directory — not
// under ".../Models/gltf/<res>/<name>/textures/". Rewrite the resolved image
// URL so GLTFLoader finds the real file instead of 404ing on every texture.
const loadingManager = new THREE.LoadingManager();
loadingManager.setURLModifier((url) => {
  if (url.includes("/Models/gltf/") && url.includes("/textures/")) {
    return url.replace("/Models/gltf/", "/Models/jpg/").replace("/textures/", "/");
  }
  return url;
});
const loader = new GLTFLoader(loadingManager);

// Cache in-flight/resolved loads by URL so switching pieces/toggling the
// beta flag on and off doesn't re-fetch the same model repeatedly.
const modelCache = new Map<string, Promise<THREE.Object3D>>();
function loadModel(url: string): Promise<THREE.Object3D> {
  let p = modelCache.get(url);
  if (!p) {
    p = new Promise<THREE.Object3D>((resolve, reject) => {
      loader.load(url, (gltf) => resolve(gltf.scene), undefined, (err) => reject(err));
    });
    modelCache.set(url, p);
  }
  return p;
}

const highlightMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, wireframe: true, depthTest: false });

/** Loads a Poly Haven glTF model, scales it (uniformly, preserving its own
 *  proportions — most robust against odd stand-in aspect ratios) to roughly
 *  fit the target piece's `size`, and positions/rotates it exactly like the
 *  procedural `positioned()` helper does. Reports success/failure via
 *  `onResult` so the caller (FurniturePieces) can keep the procedural piece
 *  visible as a permanent, automatic fallback whenever the load fails — the
 *  scene is never left with a missing/blank piece. */
export function GltfFurniturePiece({
  url, piece, override, selected, onResult, onRef,
}: {
  url: string;
  piece: FurniturePiece;
  override?: FurnitureOverride;
  selected?: boolean;
  onResult: (ok: boolean) => void;
  onRef?: (o: THREE.Object3D | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [model, setModel] = useState<THREE.Object3D | null>(null);
  const [failed, setFailed] = useState(false);

  // `onResult`/`onRef` are inline callbacks recreated on every render of the
  // parent (FurniturePieces); calling them requires reading whatever is
  // *current*, but they must NOT sit in a dependency array below — an effect
  // that re-fires whenever its own callback identity changes, and which in
  // turn causes the parent to re-render (e.g. a state bump), is a textbook
  // "Maximum update depth exceeded" loop. The ref indirection here reads the
  // latest callback without re-triggering on every parent render.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const onRefRef = useRef(onRef);
  onRefRef.current = onRef;

  useEffect(() => {
    onRefRef.current?.(groupRef.current);
    return () => onRefRef.current?.(null);
  }, [failed]);

  useEffect(() => {
    let cancelled = false;
    setModel(null);
    setFailed(false);
    loadModel(url)
      .then((scene) => {
        if (cancelled) return;
        setModel(scene.clone(true));
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => { onResultRef.current(!!model && !failed); }, [model, failed]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g || !model) return;
    g.clear();
    model.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const [tx, ty, tz] = piece.size;
    const ratios = [tx / Math.max(size.x, 0.01), ty / Math.max(size.y, 0.01), tz / Math.max(size.z, 0.01)];
    const scale = Math.min(...ratios) || 1;
    model.scale.setScalar(scale);
    model.position.y += (size.y * scale) / 2; // sit the model's own base on the floor
    g.add(model);
    if (selected) {
      const b = new THREE.Box3().setFromObject(g);
      const s = b.getSize(new THREE.Vector3());
      const c = b.getCenter(new THREE.Vector3()).sub(g.position);
      const hl = new THREE.Mesh(new THREE.BoxGeometry(s.x * 1.1 + 0.02, s.y * 1.1 + 0.02, s.z * 1.1 + 0.02), highlightMat);
      hl.raycast = () => {};
      hl.renderOrder = 999;
      hl.position.copy(c);
      g.add(hl);
    }
  }, [model, piece, selected]);

  const dx = override?.position?.[0] ?? 0;
  const dz = override?.position?.[1] ?? 0;
  const rotY = override?.rotationY ?? 0;

  if (failed) return null;
  return <group ref={groupRef} position={[piece.pos[0] + dx, piece.base_y ?? 0, piece.pos[1] + dz]} rotation={[0, rotY, 0]} />;
}
