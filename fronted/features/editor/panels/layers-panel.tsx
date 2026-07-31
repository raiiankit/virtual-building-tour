"use client";

import { Eye, EyeOff, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LayerVisibility } from "../ubm/types";

type LayerKey = keyof LayerVisibility;

const LAYER_ORDER: { key: LayerKey; label: string; color: string }[] = [
  { key: "rooms", label: "Rooms", color: "#94a3b8" },
  { key: "walls", label: "Walls", color: "#1e293b" },
  { key: "doors", label: "Doors", color: "#b45309" },
  { key: "windows", label: "Windows", color: "#0284c7" },
  { key: "columns", label: "Columns", color: "#475569" },
  { key: "beams", label: "Beams", color: "#64748b" },
  { key: "stairs", label: "Stairs", color: "#7c3aed" },
  { key: "balconies", label: "Balconies", color: "#059669" },
  { key: "annotations", label: "Annotations", color: "#64748b" },
];

export interface LayersPanelProps {
  layers: LayerVisibility;
  counts: Record<LayerKey, number>;
  onToggle: (key: LayerKey) => void;
}

export function LayersPanel({ layers, counts, onToggle }: LayersPanelProps) {
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Layers className="size-4 text-primary" /> Layers
      </div>
      <div className="space-y-0.5">
        {LAYER_ORDER.map(({ key, label, color }) => {
          const on = layers[key];
          return (
            <button
              key={key}
              onClick={() => onToggle(key)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-secondary",
                !on && "opacity-45",
              )}
            >
              <span className="size-2.5 rounded-sm" style={{ background: color }} />
              <span className="flex-1 text-left">{label}</span>
              <span className="tabular-nums text-xs text-muted-foreground">{counts[key] ?? 0}</span>
              {on ? <Eye className="size-4 text-muted-foreground" /> : <EyeOff className="size-4 text-muted-foreground" />}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
