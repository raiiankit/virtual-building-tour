"use client";

import { useEffect } from "react";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
import { LayoutGrid, Sparkles, Boxes, Clapperboard, ArrowUpRight, PencilRuler } from "lucide-react";
import { useProject } from "@/hooks";
import { useHeader } from "@/store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OverviewPanel } from "@/features/projects/overview-panel";
import { AiWorkspace } from "@/features/analysis/ai-workspace";
import { FloorPlanEditor } from "@/features/editor/floor-plan-editor";
import { ViewerStage } from "@/features/viewer/viewer-stage";
import { VideoStudio } from "@/features/video/video-studio";

export default function ProjectWorkspace() {
  const params = useParams<{ id: string }>();
  const pid = Number(params.id);
  const { data: p, isLoading } = useProject(pid);
  const setCrumbs = useHeader((s) => s.setCrumbs);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = searchParams.get("tab") || "analysis";
  useEffect(() => { if (p) setCrumbs([{ label: "Projects", href: "/" }, { label: p.name }]); }, [p, setCrumbs]);

  if (isLoading || !p) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-11 w-96 rounded-lg" />
        <Skeleton className="h-[540px] rounded-xl" />
      </div>
    );
  }

  const ready = ["3d_ready", "rendering", "completed"].includes(p.status);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{p.name}</h1>
          <StatusBadge status={p.status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm capitalize text-muted-foreground">{p.building_type} · {p.location || "No location"}</span>
          {ready && (
            <Button asChild variant="outline" size="sm">
              <a href={`/viewer/${p.id}`} target="_blank" rel="noreferrer">Open full 3D <ArrowUpRight className="size-3.5" /></a>
            </Button>
          )}
        </div>
      </header>

      <Tabs value={initialTab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })}>
        <TabsList>
          <TabsTrigger value="overview"><LayoutGrid /> Overview</TabsTrigger>
          <TabsTrigger value="analysis"><Sparkles /> AI Analysis</TabsTrigger>
          <TabsTrigger value="editor"><PencilRuler /> 2D Editor</TabsTrigger>
          <TabsTrigger value="model"><Boxes /> 3D Model</TabsTrigger>
          <TabsTrigger value="video"><Clapperboard /> Video</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewPanel project={p} /></TabsContent>
        <TabsContent value="analysis"><AiWorkspace pid={pid} project={p} /></TabsContent>
        <TabsContent value="editor"><FloorPlanEditor pid={pid} /></TabsContent>
        <TabsContent value="model"><ViewerStage pid={pid} status={p.status} /></TabsContent>
        <TabsContent value="video"><VideoStudio pid={pid} ready={ready} project={p} /></TabsContent>
      </Tabs>
    </div>
  );
}
