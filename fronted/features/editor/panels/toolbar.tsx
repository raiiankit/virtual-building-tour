"use client";

import { AlertTriangle, Check, Grid3x3, Magnet, Maximize2, Redo2, Save, ShieldCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { TOOLS } from "../constants";
import type { Tool } from "../ubm/types";

export interface ToolbarProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  grid: boolean;
  onGrid: () => void;
  snap: boolean;
  onSnap: () => void;
  onFit: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  approving: boolean;
  onApprove: () => void;
  blocking: number;
  warnings: number;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
      {/* tools */}
      <div className="flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
        {TOOLS.map((t) => (
          <Hint key={t.key} label={`${t.label} (${t.shortcut})`}>
            <button
              onClick={() => props.onTool(t.key)}
              aria-pressed={props.tool === t.key}
              className={cn(
                "grid size-9 place-items-center rounded-md transition-colors",
                props.tool === t.key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-surface",
              )}
            >
              <t.icon className="size-[18px]" />
            </button>
          </Hint>
        ))}
      </div>

      <div className="mx-1 h-6 w-px bg-border" />

      {/* history + view */}
      <Hint label="Undo (⌘Z)">
        <Button variant="ghost" size="icon-sm" disabled={!props.canUndo} onClick={props.onUndo}>
          <Undo2 className="size-[18px]" />
        </Button>
      </Hint>
      <Hint label="Redo (⌘⇧Z)">
        <Button variant="ghost" size="icon-sm" disabled={!props.canRedo} onClick={props.onRedo}>
          <Redo2 className="size-[18px]" />
        </Button>
      </Hint>
      <Hint label="Toggle grid (G)">
        <Button variant={props.grid ? "secondary" : "ghost"} size="icon-sm" onClick={props.onGrid}>
          <Grid3x3 className="size-[18px]" />
        </Button>
      </Hint>
      <Hint label="Snap to grid / features">
        <Button variant={props.snap ? "secondary" : "ghost"} size="icon-sm" onClick={props.onSnap}>
          <Magnet className="size-[18px]" />
        </Button>
      </Hint>
      <Hint label="Fit to screen (F)">
        <Button variant="ghost" size="icon-sm" onClick={props.onFit}>
          <Maximize2 className="size-[18px]" />
        </Button>
      </Hint>

      {/* right-aligned status + actions */}
      <div className="ml-auto flex items-center gap-2">
        {props.blocking > 0 ? (
          <span className="flex items-center gap-1 rounded-md bg-danger/10 px-2 py-1 text-xs font-medium text-danger">
            <AlertTriangle className="size-3.5" /> {props.blocking} blocking
          </span>
        ) : props.warnings > 0 ? (
          <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600">
            <AlertTriangle className="size-3.5" /> {props.warnings} warning{props.warnings > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-xs font-medium text-success">
            <ShieldCheck className="size-3.5" /> Valid
          </span>
        )}

        <Button variant="outline" size="sm" loading={props.saving} disabled={!props.dirty && !props.saving} onClick={props.onSave}>
          <Save className="size-4" /> Save{props.dirty ? " *" : ""}
        </Button>
        <Button
          variant="success"
          size="sm"
          loading={props.approving}
          disabled={props.blocking > 0}
          onClick={props.onApprove}
        >
          <Check className="size-4" /> Approve for 3D
        </Button>
      </div>
    </div>
  );
}
