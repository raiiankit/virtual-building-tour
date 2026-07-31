import { cn } from "@/lib/utils";
import { STATUS_META, type StatusTone } from "@/constants";
import type { ProjectStatus } from "@/types";

const TONES: Record<StatusTone, string> = {
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-500/10 dark:text-blue-300",
  orange: "bg-orange-50 text-orange-700 ring-orange-600/15 dark:bg-orange-500/10 dark:text-orange-300",
  purple: "bg-purple-50 text-purple-700 ring-purple-600/15 dark:bg-purple-500/10 dark:text-purple-300",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-500/10 dark:text-indigo-300",
  green: "bg-green-50 text-green-700 ring-green-600/15 dark:bg-green-500/10 dark:text-green-300",
  pink: "bg-pink-50 text-pink-700 ring-pink-600/15 dark:bg-pink-500/10 dark:text-pink-300",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-500/10 dark:text-slate-300",
};
const DOTS: Record<StatusTone, string> = {
  blue: "bg-blue-500", orange: "bg-orange-500", purple: "bg-purple-500", amber: "bg-amber-500",
  indigo: "bg-indigo-500", green: "bg-green-500", pink: "bg-pink-500", emerald: "bg-emerald-500",
  red: "bg-red-500", slate: "bg-slate-400",
};

export function StatusBadge({ status, className, pulse }: { status: ProjectStatus; className?: string; pulse?: boolean }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const active = ["analysing", "generating_3d", "rendering"].includes(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", TONES[meta.tone], className)}>
      <span className={cn("size-1.5 rounded-full", DOTS[meta.tone], (pulse || active) && "animate-pulse")} />
      {meta.label}
    </span>
  );
}
