"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Boxes, Clock3, Sparkles, Plus, LayoutGrid, FileJson } from "lucide-react";
import { useProjects } from "@/hooks";
import { useHeader } from "@/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ProjectCard } from "./project-card";
import { NewProjectWizard } from "./new-project-wizard";
import type { LucideIcon } from "lucide-react";

function Stat({ icon: Icon, label, value, tint }: { icon: LucideIcon; label: string; value: number; tint: string }) {
  return (
    <Card className="flex items-center gap-4 p-5">
      <div className={`grid size-11 place-items-center rounded-xl ${tint}`}><Icon className="size-5" /></div>
      <div>
        <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

export function ProjectsView() {
  const { data, isLoading } = useProjects();
  const setCrumbs = useHeader((s) => s.setCrumbs);
  const [wizard, setWizard] = useState(false);
  useEffect(() => setCrumbs([{ label: "Projects" }]), [setCrumbs]);

  const list = data ?? [];
  const ready = list.filter((p) => ["3d_ready", "completed"].includes(p.status)).length;
  const review = list.filter((p) => p.status === "needs_review").length;
  const progress = list.filter((p) => ["files_uploaded", "analysing", "approved_for_3d", "generating_3d", "rendering"].includes(p.status)).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="mt-1 text-md text-muted-foreground">Every building you&apos;re turning into an interactive 3D tour.</p>
        </div>
        <div className="flex gap-2">
          <Button size="lg" onClick={() => setWizard(true)}><Plus /> New project</Button>
          <Button size="lg" variant="outline" asChild><Link href="/json-model"><FileJson className="size-4" /> 3D from JSON</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)
          : (
            <>
              <Stat icon={FolderKanban} label="Total projects" value={list.length} tint="bg-primary/10 text-primary" />
              <Stat icon={Boxes} label="3D ready" value={ready} tint="bg-emerald-500/10 text-emerald-600" />
              <Stat icon={Sparkles} label="Awaiting review" value={review} tint="bg-amber-500/10 text-amber-600" />
              <Stat icon={Clock3} label="In progress" value={progress} tint="bg-indigo-500/10 text-indigo-600" />
            </>
          )}
      </div>

      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[280px] rounded-xl" />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="No projects yet" description="Create your first project to turn a floor plan into a walkable 3D tour."
          action={<Button onClick={() => setWizard(true)}><Plus /> New project</Button>} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((p, i) => <ProjectCard key={p.id} p={p} index={i} />)}
        </div>
      )}

      <NewProjectWizard open={wizard} onOpenChange={setWizard} />
    </div>
  );
}
