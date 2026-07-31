import * as THREE from "three";
import { buildScene } from "./three-scene";
import { buildPath, sampleAt } from "./camera-path";
import type { CameraStyle } from "./video-config";

export interface RenderOpts {
  assetUrl: string; sceneUrl: string | null;
  width: number; height: number; fps: number; bitrate: number;
  style: CameraStyle; speed: number;
  intro: { project: string; location?: string; builder?: string };
  mount: HTMLElement;
  onProgress: (p: number, elapsed: number, total: number) => void;
  shouldStop: () => boolean;
}
export interface RenderResult { blob: Blob; url: string; mime: string; duration: number }

function pickMime(): string {
  const c = [
    "video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4",
    "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm",
  ];
  return (typeof MediaRecorder !== "undefined" && c.find((m) => MediaRecorder.isTypeSupported(m))) || "";
}
export const mimeExt = (m: string) => (m.includes("mp4") ? "mp4" : "webm");

/* ------------------------------- overlays -------------------------------- */
function card(ctx: CanvasRenderingContext2D, W: number, H: number, alpha: number, lines: { text: string; size: number; color: string; weight: number; gap: number }[]) {
  ctx.save(); ctx.globalAlpha = alpha;
  const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#0b1220"); gr.addColorStop(1, "#020617");
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
  // brand mark
  ctx.globalAlpha = alpha; ctx.fillStyle = "#2563eb"; ctx.beginPath(); ctx.arc(W / 2, H * 0.34, H * 0.06, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = `700 ${H * 0.05}px Inter, sans-serif`; ctx.fillText("VBT", W / 2, H * 0.34 + H * 0.018);
  let y = H * 0.52;
  for (const l of lines) { ctx.fillStyle = l.color; ctx.font = `${l.weight} ${l.size}px Inter, sans-serif`; ctx.fillText(l.text, W / 2, y); y += l.gap; }
  ctx.restore();
}
function lowerThird(ctx: CanvasRenderingContext2D, W: number, H: number, name: string, alpha: number) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = "left";
  const barY = H - H * 0.20, barH = H * 0.11;
  const grd = ctx.createLinearGradient(0, barY, W * 0.5, barY); grd.addColorStop(0, "rgba(15,23,42,0.82)"); grd.addColorStop(1, "rgba(15,23,42,0)");
  ctx.fillStyle = grd; ctx.fillRect(0, barY, W * 0.62, barH);
  ctx.fillStyle = "#2563eb"; ctx.fillRect(W * 0.05, barY + barH * 0.2, H * 0.006, barH * 0.6);
  ctx.fillStyle = "#fff"; ctx.font = `600 ${H * 0.042}px Inter, sans-serif`; ctx.fillText(name, W * 0.05 + H * 0.02, barY + barH * 0.62);
  ctx.restore();
}
function vignetteLetterbox(ctx: CanvasRenderingContext2D, W: number, H: number, project: string) {
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.28)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  const bar = H * 0.055; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
  ctx.save(); ctx.globalAlpha = 0.85; ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.font = `600 ${H * 0.026}px Inter, sans-serif`;
  ctx.fillText(project, W * 0.03, H - bar - H * 0.02); ctx.restore();
}

/* ------------------------------- pipeline -------------------------------- */
export async function recordCinematic(o: RenderOpts): Promise<RenderResult> {
  await (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready.catch(() => {});
  const { width: W, height: H } = o;

  // WebGL canvas (offscreen size = target resolution)
  const gl = document.createElement("canvas"); gl.width = W; gl.height = H;
  const renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // composite canvas (what we record + show)
  const comp = document.createElement("canvas"); comp.width = W; comp.height = H;
  comp.style.width = "100%"; comp.style.height = "100%"; comp.style.objectFit = "contain"; comp.style.display = "block";
  o.mount.innerHTML = ""; o.mount.appendChild(comp);
  const ctx = comp.getContext("2d")!;

  const built = await buildScene(renderer, o.assetUrl, o.sceneUrl);
  const { scene, camera } = built;
  camera.aspect = W / H; camera.updateProjectionMatrix();
  const { segments, total } = buildPath(built, o.style, o.speed);

  const mime = pickMime();
  const stream = comp.captureStream(o.fps);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: o.bitrate } : { videoBitsPerSecond: o.bitrate });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return new Promise<RenderResult>((resolve, reject) => {
    rec.onstop = () => {
      const outMime = mime || "video/webm";
      const blob = new Blob(chunks, { type: outMime });
      built.dispose(); renderer.dispose();
      resolve({ blob, url: URL.createObjectURL(blob), mime: outMime, duration: total });
    };
    rec.onerror = (e) => reject((e as unknown as { error: Error }).error);

    const start = performance.now();
    rec.start();
    const loop = () => {
      if (o.shouldStop()) { try { rec.stop(); } catch {} return; }
      const t = (performance.now() - start) / 1000;
      const { state, overlay, label, segU } = sampleAt(segments, t);
      camera.position.copy(state.pos); camera.lookAt(state.look); camera.updateMatrixWorld();
      renderer.render(scene, camera);

      ctx.drawImage(gl, 0, 0, W, H);
      vignetteLetterbox(ctx, W, H, o.intro.project);
      if (overlay === "room" && label) { const a = segU < 0.25 ? segU / 0.25 : segU > 0.78 ? (1 - segU) / 0.22 : 1; lowerThird(ctx, W, H, label, Math.max(0, a)); }
      if (overlay === "intro") { const a = segU < 0.28 ? segU / 0.28 : segU > 0.72 ? (1 - segU) / 0.28 : 1; card(ctx, W, H, Math.max(0, a), [
        { text: o.intro.project, size: H * 0.06, color: "#fff", weight: 700, gap: H * 0.06 },
        { text: [o.intro.location, o.intro.builder].filter(Boolean).join("  ·  ") || "Virtual Building Tour", size: H * 0.03, color: "#94a3b8", weight: 500, gap: H * 0.05 },
        { text: date, size: H * 0.024, color: "#64748b", weight: 500, gap: 0 },
      ]); }
      if (overlay === "outro") { const a = segU < 0.3 ? segU / 0.3 : 1; card(ctx, W, H, Math.max(0, a), [
        { text: "Thank you", size: H * 0.06, color: "#fff", weight: 700, gap: H * 0.06 },
        { text: o.intro.project, size: H * 0.03, color: "#94a3b8", weight: 500, gap: H * 0.045 },
        { text: "Virtual Building Tour", size: H * 0.024, color: "#2563eb", weight: 600, gap: 0 },
      ]); }

      o.onProgress(Math.min(1, t / total), t, total);
      if (t >= total) { try { rec.stop(); } catch {} return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
