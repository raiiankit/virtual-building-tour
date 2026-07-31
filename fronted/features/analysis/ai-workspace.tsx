"use client";

import { useRef, useState } from "react";
import { Sparkles, Upload, Check, Gauge, TriangleAlert, DoorOpen, RectangleHorizontal, Ruler, Layers, ScanLine } from "lucide-react";
import { toast } from "sonner";
import type { Project, AnalysisVectors } from "@/types";
import { api } from "@/services/api";
import { useAnalysis, useInvalidateProject } from "@/hooks";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const TINT: Record<string, string> = {
  kitchen: "#f0d9a7", bathroom: "#a7d4e0", master_bedroom: "#c8b6e0", bedroom: "#c3d3ea",
  living_room: "#bfe0c4", dining: "#e6c9b0", garage: "#c9ccce", balcony: "#bfe6d8",
  utility: "#d8d2c2", foyer: "#e2d6ea", office: "#d5c9ec", room: "#d7dbe0",
};
const conf = (c: number) => (c >= 0.9 ? "text-emerald-600" : c >= 0.7 ? "text-amber-600" : "text-red-600");
const confBar = (c: number) => (c >= 0.9 ? "bg-emerald-500" : c >= 0.7 ? "bg-amber-500" : "bg-red-500");

export function AiWorkspace({ pid, project }: { pid: number; project: Project }) {
  const { data, isLoading, isError } = useAnalysis(pid);
  const invalidate = useInvalidateProject(pid);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scale, setScale] = useState(0.02);

  const files = project.plan_files.filter((f) => !f.obsolete);
  const r: AnalysisVectors | undefined = data?.result;
  const [layers, setLayers] = useState({ rooms: true, walls: true, openings: true });

  const upload = async (f: File) => {
    setBusy("upload");
    try { const fd = new FormData(); fd.append("file", f); fd.append("category", "floor_plan"); await api.upload(`/api/projects/${pid}/upload`, fd); toast.success("Plan uploaded"); invalidate(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const runAI = async () => {
    setBusy("ai");
    try { const d = await api.post<{ data: { counts: { rooms: number; walls: number } } }>(`/api/projects/${pid}/analyse`); toast.success(`Detected ${d.data.counts.rooms} rooms, ${d.data.counts.walls} walls`); invalidate(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const approve = async () => {
    if (!r) return;
    setBusy("approve");
    try { await api.post(`/api/projects/${pid}/approve-plan`, { vectors: r, scale_m_per_px: scale }); toast.success("Plan approved — ready to generate 3D"); invalidate(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  const rooms = r?.rooms ?? [];
  const avg = rooms.length ? rooms.reduce((s, x) => s + (x.confidence || 0), 0) / rooms.length : 0;
  const [W, H] = r?.image_size ?? [1000, 750];

  // Plan Health Score — a single trust signal from confidence, review-flags and warnings.
  const warns = data?.warnings ?? [];
  const blocking = warns.filter((w) => w.level === "blocking").length;
  const warnCount = warns.filter((w) => w.level === "warning").length;
  const lowConf = rooms.filter((x) => (x.confidence || 0) < 0.9).length;
  const health = !rooms.length ? 0 : Math.max(0, Math.min(100, Math.round(
    (0.55 * avg + 0.25 * (1 - lowConf / Math.max(1, rooms.length))) * 100 + 20 - blocking * 18 - warnCount * 4,
  )));
  const hTone = health >= 85 ? "text-emerald-600" : health >= 65 ? "text-blue-600" : health >= 40 ? "text-amber-600" : "text-red-600";
  const hBar = health >= 85 ? "bg-emerald-500" : health >= 65 ? "bg-blue-500" : health >= 40 ? "bg-amber-500" : "bg-red-500";
  const hLabel = health >= 85 ? "Excellent" : health >= 65 ? "Good" : health >= 40 ? "Needs review" : "Poor";

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr_300px]">
      {/* LEFT — confidence + rooms + warnings */}
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Gauge className="size-4 text-primary" /> Plan Health Score</div>
          {isLoading ? <Skeleton className="h-24" /> : (
            <>
              <div className="flex items-end gap-2">
                <span className={cn("text-3xl font-bold tabular-nums", hTone)}>{health}<span className="text-lg text-muted-foreground">/100</span></span>
                <span className={cn("mb-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold", hTone)}>{hLabel}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full transition-all", hBar)} style={{ width: `${health}%` }} /></div>
              <div className="mt-2.5 grid grid-cols-3 gap-1 text-center text-[11px] text-muted-foreground">
                <div><div className="font-semibold text-foreground">{rooms.length}</div>rooms</div>
                <div><div className="font-semibold text-foreground">{Math.round(avg * 100)}%</div>avg conf</div>
                <div><div className={cn("font-semibold", lowConf ? "text-amber-600" : "text-foreground")}>{lowConf}</div>to verify</div>
              </div>
            </>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Layers className="size-4 text-primary" /> Detected rooms</div>
          <div className="space-y-2.5">
            {isLoading && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            {rooms.map((rm, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-sm"><span className="truncate font-medium">{rm.name}</span><span className={cn("text-xs font-semibold tabular-nums", conf(rm.confidence))}>{Math.round(rm.confidence * 100)}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full", confBar(rm.confidence))} style={{ width: `${rm.confidence * 100}%` }} /></div>
              </div>
            ))}
            {!isLoading && rooms.length === 0 && <p className="text-xs text-muted-foreground">No rooms yet — run AI analysis.</p>}
          </div>
        </Card>

        {(data?.warnings?.filter((w) => w.level !== "info").length ?? 0) > 0 && (
          <Card className="p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><TriangleAlert className="size-4 text-amber-500" /> Warnings</div>
            <div className="space-y-2">
              {data!.warnings.filter((w) => w.level !== "info").map((w, i) => (
                <div key={i} className={cn("rounded-lg border-l-2 px-3 py-2 text-xs", w.level === "blocking" ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-500/10" : "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-500/10")}>{w.message}</div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* CENTER — canvas */}
      <Card className="flex min-h-[560px] flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-sm font-semibold">Floor plan analysis</span>
          <div className="flex items-center gap-1">
            {(["rooms", "walls", "openings"] as const).map((k) => (
              <button key={k} onClick={() => setLayers((s) => ({ ...s, [k]: !s[k] }))}
                className={cn("rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors", layers[k] ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary")}>{k}</button>
            ))}
          </div>
        </div>
        <div className="relative flex flex-1 items-center justify-center bg-[radial-gradient(circle_at_center,theme(colors.slate.100),theme(colors.slate.200))] p-6 dark:bg-[radial-gradient(circle_at_center,theme(colors.slate.800),theme(colors.slate.900))]">
          {isLoading ? <Skeleton className="h-full w-full" /> : !r || isError ? (
            <EmptyState icon={ScanLine} title="No analysis yet" description="Upload a floor plan and run AI analysis to detect rooms, walls, doors, windows and dimensions." className="border-0 bg-transparent" />
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="h-full max-h-[520px] w-full">
              <rect x={0} y={0} width={W} height={H} fill="white" className="dark:fill-slate-100" rx={6} />
              {layers.rooms && rooms.map((rm, i) => (
                <g key={i}>
                  <rect x={rm.x} y={rm.y} width={rm.w} height={rm.h} fill={(TINT[rm.type] || TINT.room)} fillOpacity={0.85} stroke="#94a3b8" strokeWidth={1.2} />
                  <text x={rm.x + 8} y={rm.y + 22} fontSize={13} fontWeight={600} fill="#1e293b">{rm.name}</text>
                  <text x={rm.x + 8} y={rm.y + 40} fontSize={11} fill="#64748b">{Math.round(rm.confidence * 100)}%{rm.dim_label ? ` · ${rm.dim_label}` : ""}</text>
                </g>
              ))}
              {layers.walls && (r.walls ?? []).map((w, i) => (
                <line key={i} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="#1e293b" strokeWidth={3} strokeLinecap="round" />
              ))}
              {layers.openings && (r.windows ?? []).map((wd, i) => (
                <rect key={`win${i}`} x={wd.x - 6} y={wd.y - 6} width={12} height={12} fill="#38bdf8" stroke="#0369a1" strokeWidth={1.5} />
              ))}
              {layers.openings && (r.doors ?? []).map((d, i) => (
                <circle key={`door${i}`} cx={d.x} cy={d.y} r={7} fill={d.entrance ? "#7a4a1e" : "#b06a2c"} />
              ))}
            </svg>
          )}
        </div>
      </Card>

      {/* RIGHT — actions + summary */}
      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" /> AI actions</div>
          <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.pdf,.svg,.dxf,.dwg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <div className="space-y-2.5">
            <Button variant="outline" className="w-full" loading={busy === "upload"} onClick={() => fileRef.current?.click()}><Upload className="size-4" /> Upload plan</Button>
            <Button className="w-full" loading={busy === "ai"} onClick={runAI}><Sparkles className="size-4" /> Run AI analysis</Button>
            <Button variant="success" className="w-full" disabled={!r} loading={busy === "approve"} onClick={approve}><Check className="size-4" /> Approve for 3D</Button>
          </div>
          <p className="mt-2.5 text-[11px] text-muted-foreground">{files.length ? `Current: ${files[files.length - 1].filename}` : "No plan uploaded yet"}</p>
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Upload anything — we read them all:</p>
            <div className="flex flex-wrap gap-1">
              {["PDF", "JPG", "PNG", "SVG", "DXF", "DWG", "IFC"].map((f) => (
                <span key={f} className="rounded-md border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">{f}</span>
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">Scans, CAD &amp; BIM — normalized to one editable model.</p>
          </div>
        </Card>

        {r && (
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold">AI summary</div>
            <dl className="space-y-2.5 text-sm">
              <Row icon={Layers} label="Rooms" value={String(rooms.length)} />
              <Row icon={RectangleHorizontal} label="Walls" value={String(r.walls?.length ?? 0)} />
              <Row icon={RectangleHorizontal} label="Windows" value={String(r.windows?.length ?? 0)} />
              <Row icon={DoorOpen} label="Doors" value={String(r.doors?.length ?? 0)} />
              <Row icon={Sparkles} label="OCR" value={r.ocr_available ? "On" : "Off"} />
            </dl>
            <div className="mt-4 space-y-1.5">
              <Label className="flex items-center gap-1.5"><Ruler className="size-3.5" /> Scale (m / pixel)</Label>
              <Input type="number" step="0.001" value={scale} onChange={(e) => setScale(Number(e.target.value))} />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Layers; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="size-4" /> {label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
