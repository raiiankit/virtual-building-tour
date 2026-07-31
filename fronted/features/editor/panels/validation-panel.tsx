"use client";

import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ValidationIssue, ValidationReport } from "../ubm/types";

const LEVEL_META = {
  blocking: { icon: ShieldAlert, cls: "text-danger", bg: "hover:bg-danger/10", label: "Blocking" },
  warning: { icon: AlertTriangle, cls: "text-amber-600", bg: "hover:bg-amber-500/10", label: "Warning" },
  info: { icon: Info, cls: "text-sky-600", bg: "hover:bg-sky-500/10", label: "Info" },
} as const;

const ORDER: ValidationIssue["level"][] = ["blocking", "warning", "info"];

export interface ValidationPanelProps {
  report: ValidationReport;
  onFocus: (elementId: string) => void;
}

export function ValidationPanel({ report, onFocus }: ValidationPanelProps) {
  const sorted = [...report.issues].sort((a, b) => ORDER.indexOf(a.level) - ORDER.indexOf(b.level));
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between text-sm font-semibold">
        <span className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-primary" /> Validation
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {report.blocking} blocking · {report.warnings} warn
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
          <CheckCircle2 className="size-4" /> No issues — ready to approve.
        </div>
      ) : (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
          {sorted.map((issue, i) => {
            const meta = LEVEL_META[issue.level];
            const Icon = meta.icon;
            const clickable = !!issue.element_id;
            return (
              <li key={`${issue.code}-${i}`}>
                <button
                  disabled={!clickable}
                  onClick={() => issue.element_id && onFocus(issue.element_id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    clickable ? meta.bg : "cursor-default",
                  )}
                >
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0", meta.cls)} />
                  <span className="text-foreground/90">{issue.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
