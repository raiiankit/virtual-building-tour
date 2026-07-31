"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Film, Clapperboard, Play, Download, Share2, X, Sparkles, Clock, HardDrive, Gauge, Boxes, Video, Camera, CircleDot } from "lucide-react";
import type { Project } from "@/types";
import { useModel } from "@/hooks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RESOLUTIONS, QUALITY, CAMERA_STYLES, type ResolutionKey, type QualityKey, type CameraStyle } from "./video-config";
import { mimeExt } from "./recorder";

type Clip = { url: string; mime: string; duration: number; size: number; at: number; style: string; res: string };

export function VideoStudio({ pid, ready, project }: { pid: number; ready: boolean; project: Project }) {
  const model = useModel(pid);
  const stageRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef(false);

  const [resKey, setResKey] = useState<ResolutionKey>("1080p-landscape");
  const [fps, setFps] = useState<30 | 60>(30);
  const [style, setStyle] = useState<CameraStyle>("cinematic");
  const [quality, setQuality] = useState<QualityKey>("high");
  const [speed, setSpeed] = useState(1);

  const [phase, setPhase] = useState<"idle" | "rendering" | "done">("idle");
  const [progress, setProgress] = useState(0);
  const [eta, setEta] = useState(0);
  const [result, setResult] = useState<Clip | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);

  const canRender = ready && !!model.data?.asset_url;

  const generate = async () => {
    if (!canRender) return;
    stopRef.current = false; setPhase("rendering"); setProgress(0); setResult(null);
    const res = RESOLUTIONS[resKey];
    try {
      const { recordCinematic } = await import("./recorder"); // lazy-load three.js
      const out = await recordCinematic({
        assetUrl: model.data!.asset_url, sceneUrl: model.data!.scene_url,
        width: res.w, height: res.h, fps, bitrate: Math.round(QUALITY[quality] * (fps === 60 ? 1.4 : 1) * (res.w >= 3840 ? 2.2 : 1)),
        style, speed,
        intro: { project: project.name, location: project.location || undefined, builder: project.builder || undefined },
        mount: stageRef.current!,
        onProgress: (p, el, tot) => { setProgress(p); setEta(Math.max(0, tot - el)); },
        shouldStop: () => stopRef.current,
      });
      const clip: Clip = { ...out, size: out.blob.size, at: Date.now(), style: CAMERA_STYLES.find((s) => s.key === style)!.label, res: res.label };
      setResult(clip); setClips((c) => [clip, ...c]); setPhase("done");
      toast.success("Cinematic walkthrough ready", { description: `${res.label} · ${out.duration.toFixed(0)}s` });
    } catch (e) {
      if (!stopRef.current) toast.error("Render failed", { description: (e as Error).message });
      setPhase("idle");
    }
  };
  const cancel = () => { stopRef.current = true; setPhase("idle"); };
  const download = (c: Clip) => { const a = document.createElement("a"); a.href = c.url; a.download = `${project.name.replace(/\s+/g, "-")}-walkthrough.${mimeExt(c.mime)}`; a.click(); };
  const share = async (c: Clip) => {
    try { const file = new File([await fetch(c.url).then((r) => r.blob())], `walkthrough.${mimeExt(c.mime)}`, { type: c.mime });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: project.name }); else { navigator.clipboard?.writeText(c.url); toast.success("Video link copied"); } }
    catch { toast.message("Sharing not available"); }
  };

  if (model.isLoading) return <Skeleton className="h-[560px] rounded-xl" />;
  if (!canRender) return <EmptyState icon={Boxes} title="Generate the 3D building first" description="The cinematic video is rendered from the actual 3D model. Head to the 3D Model tab and generate the building, then come back." />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      {/* preview + timeline */}
      <Card className="flex min-h-[560px] flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-2 text-sm font-semibold"><Film className="size-4 text-primary" /> Cinematic preview</span>
          {phase === "rendering" && <span className="flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-600"><CircleDot className="size-3 animate-pulse" /> Rendering live</span>}
          {phase === "done" && result && <span className="text-xs text-muted-foreground">{result.res} · {result.duration.toFixed(0)}s · {(result.size / 1e6).toFixed(1)} MB</span>}
        </div>
        <div className="relative flex flex-1 items-center justify-center bg-slate-950 p-3">
          <div ref={stageRef} className={cn("h-full w-full", phase === "done" && "hidden")} />
          {phase === "idle" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <EmptyState icon={Play} title="Cinematic walkthrough" description="Renders a real fly-through of the 3D building — exterior orbit, entrance, every room, then an aerial finish." className="border-0 bg-transparent [&_h3]:text-white [&_p]:text-white/60" />
            </div>
          )}
          {phase === "rendering" && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
              <div className="rounded-lg bg-slate-900/70 p-3 backdrop-blur">
                <div className="mb-1.5 flex items-center justify-between text-xs text-white/80"><span>Recording walkthrough…</span><span>{Math.round(progress * 100)}% · ~{eta.toFixed(0)}s left</span></div>
                <Progress value={progress * 100} />
              </div>
            </div>
          )}
          {phase === "done" && result && <video key={result.url} controls autoPlay playsInline className="max-h-[520px] w-full rounded-lg" src={result.url} />}
        </div>
      </Card>

      {/* settings + actions */}
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clapperboard className="size-4 text-primary" /> Render settings</div>
          <div className="space-y-4">
            <Selectish label="Camera style" icon={Camera} value={style} onChange={(v) => setStyle(v as CameraStyle)} options={CAMERA_STYLES.map((s) => ({ value: s.key, label: s.label }))} />
            <Selectish label="Resolution" icon={Video} value={resKey} onChange={(v) => setResKey(v as ResolutionKey)} options={Object.entries(RESOLUTIONS).map(([k, r]) => ({ value: k, label: r.label }))} />
            <div className="grid grid-cols-2 gap-3">
              <Seg label="Frame rate" value={String(fps)} onChange={(v) => setFps(Number(v) as 30 | 60)} options={[["30", "30 fps"], ["60", "60 fps"]]} />
              <Seg label="Quality" value={quality} onChange={(v) => setQuality(v as QualityKey)} options={[["standard", "Standard"], ["high", "High"]]} />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between"><Label className="flex items-center gap-1.5"><Gauge className="size-3.5" /> Camera speed</Label><span className="text-xs font-medium text-muted-foreground">{speed.toFixed(1)}×</span></div>
              <input type="range" min={0.5} max={2} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-full accent-primary" />
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Info icon={HardDrive} label="Output" value={result ? `${(result.size / 1e6).toFixed(1)} MB` : "—"} />
            <Info icon={Clock} label={phase === "rendering" ? "ETA" : "Duration"} value={phase === "rendering" ? `${eta.toFixed(0)}s` : result ? `${result.duration.toFixed(0)}s` : "—"} />
          </div>
          {phase === "rendering" && <Progress value={progress * 100} className="mt-3" />}
          <div className="mt-3 space-y-2">
            {phase !== "rendering"
              ? <Button className="w-full" size="lg" onClick={generate}><Sparkles className="size-4" /> Generate video</Button>
              : <Button variant="destructive" className="w-full" size="lg" onClick={cancel}><X className="size-4" /> Cancel render</Button>}
            {phase === "done" && result && (
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => download(result)}><Download className="size-4" /> Download</Button>
                <Button variant="outline" onClick={() => share(result)}><Share2 className="size-4" /> Share</Button>
              </div>
            )}
          </div>
        </Card>

        {clips.length > 0 && (
          <Card className="p-4">
            <div className="mb-2 text-sm font-semibold">Render history</div>
            <div className="space-y-2">
              {clips.map((c, i) => (
                <button key={i} onClick={() => { setResult(c); setPhase("done"); }} className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-secondary">
                  <Film className="size-4 text-muted-foreground" />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.style}</div><div className="text-xs text-muted-foreground">{c.res} · {c.duration.toFixed(0)}s · {(c.size / 1e6).toFixed(1)} MB</div></div>
                  <Download className="size-4 text-muted-foreground" onClick={(e) => { e.stopPropagation(); download(c); }} />
                </button>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Selectish({ label, icon: Icon, value, onChange, options }: { label: string; icon: typeof Camera; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5"><Icon className="size-3.5" /> {label}</Label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-md border border-input bg-surface px-3 text-sm outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
function Seg({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1.5">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={cn("flex-1 rounded-md border py-2 text-xs font-semibold transition-all", value === v ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20" : "border-border text-muted-foreground hover:border-primary/40")}>{l}</button>
        ))}
      </div>
    </div>
  );
}
function Info({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2"><Icon className="size-4 text-muted-foreground" /><div><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="font-semibold">{value}</div></div></div>;
}
