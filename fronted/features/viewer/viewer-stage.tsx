"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Boxes, Sparkles, Share2, Copy, RefreshCw, Code2, ExternalLink, Download, SplitSquareHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { ProjectStatus } from "@/types";
import { api } from "@/services/api";
import { useInvalidateProject, useModel } from "@/hooks";
import { Button } from "@/components/ui/button";
import { BuildingLoader } from "@/components/ui/building-loader";
import { EmptyState } from "@/components/ui/empty-state";
import { PlanScrubber } from "@/features/scrubber/plan-scrubber";

const Viewer3D = dynamic(() => import("@/features/viewer3d/viewer3d"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[640px] w-full place-items-center rounded-xl border border-border bg-slate-900 text-white/70">
      <BuildingLoader light />
    </div>
  ),
});

export function ViewerStage({ pid, status }: { pid: number; status: ProjectStatus }) {
  const ready = ["3d_ready", "rendering", "completed"].includes(status);
  const model = useModel(pid);
  const [busy, setBusy] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const invalidate = useInvalidateProject(pid);

  // Render a QR to the public tour so it can jump off a brochure, site hoarding or slide.
  useEffect(() => {
    if (!share) { setQr(null); return; }
    let alive = true;
    import("qrcode")
      .then((m) => m.toDataURL(share, { width: 320, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } }))
      .then((url) => { if (alive) setQr(url); })
      .catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [share]);

  const generate = async () => {
    setBusy("gen");
    try { await api.post(`/api/projects/${pid}/generate-3d`); toast.success("3D building generated"); invalidate(); model.refetch(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const buildTour = async () => {
    setBusy("tour");
    try {
      const d = await api.post<{ data: { share_url: string; scenes: unknown[] } }>(`/api/projects/${pid}/tour`, { access_level: "public" });
      setShare(location.origin + d.data.share_url); toast.success("Tour published");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  if (!ready) {
    return (
      <EmptyState icon={Boxes} title="No 3D model yet" description="Generate the realistic building — walls, floor slabs, ceilings, doors, windows, a textured facade and skirting — from your approved plan."
        action={<Button size="lg" loading={busy === "gen"} onClick={generate}><Sparkles /> Generate 3D building</Button>} />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">Realistic architectural walkthrough · textured shell</div>
        <div className="flex items-center gap-2">
          <Button variant={compare ? "primary" : "outline"} size="sm" onClick={() => setCompare((c) => !c)}><SplitSquareHorizontal className="size-4" /> {compare ? "Exit compare" : "Plan ↔ 3D"}</Button>
          <Button variant="outline" size="sm" loading={busy === "tour"} onClick={buildTour}><Share2 className="size-4" /> Publish tour</Button>
          <Button variant="outline" size="sm" loading={busy === "gen"} onClick={generate}><RefreshCw className="size-4" /> Regenerate</Button>
        </div>
      </div>

      {share && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-50 p-3 dark:bg-emerald-500/10">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><Share2 className="size-4" /> Tour published — anyone with the link can walk it, no login</div>
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <input readOnly value={share} onClick={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-emerald-500/20 bg-white/70 px-2 py-1.5 text-xs text-emerald-800 outline-none dark:bg-slate-900/40 dark:text-emerald-300" />
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(share); toast.success("Link copied"); }}><Copy className="size-3.5" /> Link</Button>
              </div>
              <div className="flex items-center gap-2">
                <input readOnly value={`<iframe src="${share}" width="100%" height="560" style="border:0;border-radius:12px" allow="fullscreen" loading="lazy"></iframe>`} onClick={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-emerald-500/20 bg-white/70 px-2 py-1.5 font-mono text-[11px] text-emerald-800 outline-none dark:bg-slate-900/40 dark:text-emerald-300" />
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(`<iframe src="${share}" width="100%" height="560" style="border:0;border-radius:12px" allow="fullscreen" loading="lazy"></iframe>`); toast.success("Embed code copied"); }}><Code2 className="size-3.5" /> Embed</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <a href={share} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700"><ExternalLink className="size-3.5" /> Open public tour</a>
                <span className="text-[11px] text-emerald-700/80 dark:text-emerald-300/70">Embed it on a portal, or scan the code on-site →</span>
              </div>
            </div>
            {qr && (
              <div className="flex shrink-0 flex-col items-center gap-1">
                <img src={qr} alt="Tour QR code" width={92} height={92} className="rounded-md border border-emerald-500/20 bg-white p-1" />
                <a href={qr} download="tour-qr.png" className="inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:underline dark:text-emerald-300"><Download className="size-3" /> QR</a>
              </div>
            )}
          </div>
        </div>
      )}

      {model.isLoading ? (
        <div className="grid h-[640px] w-full place-items-center rounded-xl border border-border bg-slate-900"><BuildingLoader light /></div>
      ) : model.data?.asset_url ? (
        compare ? (
          <PlanScrubber sceneUrl={model.data.scene_url} />
        ) : (
          <Viewer3D assetUrl={model.data.asset_url} sceneUrl={model.data.scene_url} />
        )
      ) : (
        <EmptyState icon={Boxes} title="Model not found" description="Regenerate the 3D building to view it here." action={<Button loading={busy === "gen"} onClick={generate}><RefreshCw className="size-4" /> Regenerate</Button>} />
      )}
    </div>
  );
}
