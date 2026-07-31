"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { MoreHorizontal, MapPin, Building2, Home, ArrowUpRight, Box, Eye, Trash2, Clock } from "lucide-react";
import type { ProjectSummary } from "@/types";
import { STATUS_META } from "@/constants";
import { useDeleteProject, useProjectPreview } from "@/hooks";
import { PlanThumbnail } from "./plan-thumbnail";
import { StatusBadge } from "@/components/ui/status-badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { relativeDate } from "@/lib/utils";

export function ProjectCard({ p, index = 0 }: { p: ProjectSummary; index?: number }) {
  const router = useRouter();
  const del = useDeleteProject();
  const meta = STATUS_META[p.status] ?? STATUS_META.draft;
  const onDelete = () => {
    if (!window.confirm(`Delete "${p.name}"? This removes its plans, 3D model and videos. This cannot be undone.`)) return;
    del.mutate(p.id, {
      onSuccess: () => toast.success("Project deleted"),
      onError: (e) => toast.error("Could not delete", { description: (e as Error).message }),
    });
  };
  const ready = p.status === "3d_ready" || p.status === "completed";
  const isVilla = p.building_type === "villa";
  const preview = useProjectPreview(p.id, ready);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.3), ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -4 }}
      className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-lg"
    >
      <Link href={`/projects/${p.id}`} className="block">
        {/* thumbnail — real top-down plan preview when the 3D is ready, else an icon */}
        <div className="relative h-32 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-900">
          <div className="absolute inset-0 grid-dots opacity-60" />
          {preview.data?.rooms.length ? (
            <div className="absolute inset-0 p-2"><PlanThumbnail preview={preview.data} /></div>
          ) : (
            <div className="absolute inset-0 grid place-items-center text-primary/80">
              {isVilla ? <Home className="size-10" /> : <Building2 className="size-10" />}
            </div>
          )}
          <div className="absolute left-3 top-3"><StatusBadge status={p.status} /></div>
          <span className="absolute right-3 top-3 rounded-md bg-surface/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground backdrop-blur">v1</span>
        </div>

        <div className="p-4">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{p.name}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 capitalize">{isVilla ? <Home className="size-3.5" /> : <Building2 className="size-3.5" />}{p.building_type ?? "—"}</span>
            <span className="text-border">•</span>
            <span className="inline-flex items-center gap-1 truncate"><MapPin className="size-3.5" />{p.location || "No location"}</span>
          </div>

          <div className="mt-3.5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Completion</span>
              <span className="font-semibold tabular-nums">{meta.progress}%</span>
            </div>
            <Progress value={meta.progress} tone={p.status === "completed" ? "success" : "primary"} />
          </div>

          <div className="mt-3.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" /> Updated {relativeDate(p.updated_at || p.created_at)}
          </div>
        </div>
      </Link>

      {/* actions */}
      <div className="flex items-center gap-2 border-t border-border p-3">
        <Button asChild size="sm" variant="outline" className="flex-1">
          <Link href={`/projects/${p.id}`}>Open <ArrowUpRight className="size-3.5" /></Link>
        </Button>
        {ready && (
          <Button asChild size="sm" className="flex-1">
            <a href={`/viewer/${p.id}`} target="_blank" rel="noreferrer"><Box className="size-3.5" /> 3D Tour</a>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions" onClick={(e) => e.stopPropagation()}><MoreHorizontal className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => router.push(`/projects/${p.id}`)}><Eye /> Open project</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => window.open(`/viewer/${p.id}`, "_blank")}><Box /> View 3D tour</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={onDelete}><Trash2 /> Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </motion.div>
  );
}
