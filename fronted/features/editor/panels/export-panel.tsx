"use client";

/**
 * Round-trip export — the Universal Building Model, taken anywhere.
 * DXF (real layered CAD), SVG (clean vector plan) and the UBM JSON itself (portable,
 * standard, re-importable). This is the format moat made tangible: any plan in, a clean
 * editable model out.
 */
import { useState } from "react";
import { FileDown, PenTool, FileJson, Braces } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError } from "@/services/api";

type Fmt = "dxf" | "svg" | "json";

const FORMATS: { id: Fmt; label: string; ext: string; icon: typeof PenTool; hint: string }[] = [
  { id: "dxf", label: "DXF", ext: "dxf", icon: PenTool, hint: "Layered CAD — AutoCAD, BricsCAD, LibreCAD" },
  { id: "svg", label: "SVG", ext: "svg", icon: FileJson, hint: "Clean vector plan for docs & decks" },
  { id: "json", label: "UBM JSON", ext: "ubm.json", icon: Braces, hint: "Portable standard model — re-importable" },
];

export function ExportPanel({ pid, name }: { pid: number; name?: string }) {
  const [busy, setBusy] = useState<Fmt | null>(null);
  const slug = (name || "plan").replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "plan";

  const dl = async (f: Fmt, ext: string) => {
    setBusy(f);
    try {
      await api.download(`/api/projects/${pid}/ubm/export.${f}`, `${slug}.${ext}`);
      toast.success(`Exported ${f.toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <FileDown className="size-4 text-primary" /> Export & round-trip
      </div>
      <div className="space-y-1.5">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            disabled={busy !== null}
            onClick={() => dl(f.id, f.ext)}
            className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-2/40 px-2.5 py-2 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <f.icon className={busy === f.id ? "size-4 animate-pulse text-primary" : "size-4 text-muted-foreground"} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">{f.label}</span>
              <span className="block truncate text-[10px] text-muted-foreground">{f.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Any format in → one clean model → CAD, vector or JSON back out.
      </p>
    </div>
  );
}
