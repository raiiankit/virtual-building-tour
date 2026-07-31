"use client";

/**
 * AI Floor Plan 2D Editor — the orchestrator.
 *
 * The Universal Building Model (UBM) JSON is the single source of truth. This component
 * loads it, holds the working copy in an undo/redo history, and wires the pure canvas
 * engine + panels together. Every edit mutates the in-memory UBM; Save bulk-persists it and
 * Approve locks it as the geometry the 3D generator will consume.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, PencilRuler, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useProject } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/services/api";
import { EditorCanvas } from "./editor-canvas";
import { PlanView } from "./plan-view";
import { TOOL_SHORTCUTS } from "./constants";
import { useUbmHistory } from "./hooks/use-history";
import { useApproveUBM, useExtractUBM, useSaveUBM, useUBM } from "./hooks/use-ubm";
import { ExportPanel } from "./panels/export-panel";
import { LayersPanel } from "./panels/layers-panel";
import { PropertiesPanel } from "./panels/properties-panel";
import { StatusBar } from "./panels/status-bar";
import { Toolbar } from "./panels/toolbar";
import { ValidationPanel } from "./panels/validation-panel";
import {
  DEFAULT_LAYERS,
  type EditableKind,
  type LayerVisibility,
  type Point,
  type Selection,
  type Tool,
  type UniversalBuildingModel,
  type ValidationReport,
} from "./ubm/types";
import { isUnit, type Unit } from "./ubm/units";
import { validateUBM } from "./ubm/validation";

const OK_REPORT: ValidationReport = { ok: true, blocking: 0, warnings: 0, issues: [] };

export function FloorPlanEditor({ pid }: { pid: number }) {
  const { data, isLoading, isError, error } = useUBM(pid);
  const project = useProject(pid);
  const extract = useExtractUBM(pid);
  const saveMut = useSaveUBM(pid);
  const approveMut = useApproveUBM(pid);
  const { present, setPresent, snapshot, undo, redo, reset, canUndo, canRedo } = useUbmHistory(null);

  const [tool, setTool] = useState<Tool>("select");
  const [mode, setMode] = useState<"edit" | "plan">("edit");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>(DEFAULT_LAYERS);
  const [grid, setGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [unit, setUnit] = useState<Unit>("m");
  const [cursor, setCursor] = useState<Point | null>(null);
  const [pxPerM, setPxPerM] = useState(40);
  const [fitSignal, setFitSignal] = useState(0);
  const [dirty, setDirty] = useState(false);
  const loadedRef = useRef<UniversalBuildingModel | null>(null);

  /* ---- adopt the project's display unit ---- */
  useEffect(() => {
    const u = project.data?.unit;
    if (isUnit(u)) setUnit(u);
  }, [project.data?.unit]);

  /* ---- load a freshly-fetched UBM into history (ignore our own save echoes) ---- */
  useEffect(() => {
    if (data && loadedRef.current !== data) {
      loadedRef.current = data;
      reset(structuredClone(data));
      setSelection(null);
      setDirty(false);
    }
  }, [data, reset]);

  const mutate = useCallback(
    (fn: (d: UniversalBuildingModel) => UniversalBuildingModel) => {
      setPresent((d) => (d ? fn(d) : d));
      setDirty(true);
    },
    [setPresent],
  );

  const validation = useMemo(() => (present ? validateUBM(present) : OK_REPORT), [present]);

  // multi-storey plans stack floors in one footprint — show one floor at a time
  const [floor, setFloor] = useState(0);
  const floors = useMemo(
    () => [...new Set((present?.rooms ?? []).map((r) => r.floor ?? 0))].sort((a, b) => a - b),
    [present],
  );
  const viewUbm = useMemo(() => {
    if (!present || floors.length <= 1) return present;
    return {
      ...present,
      rooms: present.rooms.filter((r) => (r.floor ?? 0) === floor),
      walls: present.walls.filter((w) => (w.floor ?? 0) === floor),
      doors: present.doors.filter((d) => (d.floor ?? 0) === floor),
      windows: present.windows.filter((w) => (w.floor ?? 0) === floor),
    };
  }, [present, floor, floors]);

  const patchElement = useCallback(
    (kind: EditableKind, id: string, patch: Record<string, unknown>) => {
      snapshot();
      mutate((d) => applyPatch(d, kind, id, patch));
    },
    [snapshot, mutate],
  );

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    snapshot();
    mutate((d) => removeElement(d, selection));
    setSelection(null);
  }, [selection, snapshot, mutate]);

  const focusElement = useCallback(
    (id: string) => {
      if (!present) return;
      const sel = resolveSelection(present, id);
      if (sel) {
        setSelection(sel);
        setTool("select");
      }
    },
    [present],
  );

  const doExtract = useCallback(async () => {
    try {
      const res = await extract.mutateAsync();
      toast.success(`UBM built — ${res.counts.rooms} rooms · ${res.counts.walls} walls`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [extract]);

  const doSave = useCallback(async () => {
    if (!present) return;
    loadedRef.current = present; // mark so the load effect won't reset our history
    try {
      await saveMut.mutateAsync(present);
      setDirty(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [present, saveMut]);

  const doApprove = useCallback(async () => {
    if (!present) return;
    if (validation.blocking > 0) {
      toast.error("Resolve blocking issues before approval.");
      return;
    }
    loadedRef.current = present;
    try {
      await saveMut.mutateAsync(present);
      setDirty(false);
      await approveMut.mutateAsync();
      toast.success("Approved — locked as the source of truth for 3D generation.");
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [present, validation.blocking, saveMut, approveMut]);

  /* ---- global shortcuts ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement)?.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (meta && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        setDirty(true);
        return;
      }
      if (meta && k === "y") {
        e.preventDefault();
        redo();
        setDirty(true);
        return;
      }
      if (meta && k === "s") {
        e.preventDefault();
        void doSave();
        return;
      }
      if (meta) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelected();
        return;
      }
      if (e.key === "Escape") {
        setSelection(null);
        return;
      }
      if (k === "f") {
        setFitSignal((n) => n + 1);
        return;
      }
      if (k === "g") {
        setGrid((g) => !g);
        return;
      }
      if (TOOL_SHORTCUTS[k]) setTool(TOOL_SHORTCUTS[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelected, doSave]);

  /* ------------------------------- states -------------------------------- */
  if (isLoading) return <Skeleton className="h-[680px] rounded-xl" />;

  if (isError) {
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 404) {
      return (
        <EmptyState
          icon={PencilRuler}
          title="No editable model yet"
          description="Build the Universal Building Model from the uploaded floor plan, then refine walls, rooms, doors and windows here. It becomes the single source of truth for 3D."
          action={
            <Button onClick={doExtract} loading={extract.isPending}>
              <Sparkles className="size-4" /> Build UBM from plan
            </Button>
          }
        />
      );
    }
    return <EmptyState icon={Building2} title="Couldn't load the model" description={errMsg(error)} />;
  }

  if (!present) return <Skeleton className="h-[680px] rounded-xl" />;

  const counts: Record<keyof LayerVisibility, number> = {
    rooms: present.rooms.length,
    walls: present.walls.length,
    doors: present.doors.length,
    windows: present.windows.length,
    columns: present.columns.length,
    beams: present.beams.length,
    stairs: present.stairs.length,
    balconies: present.balconies.length,
    annotations: present.annotations.length,
  };

  return (
    <Card className="flex h-[680px] flex-col overflow-hidden p-0">
      <Toolbar
        tool={tool}
        onTool={(t) => setTool(t)}
        grid={grid}
        onGrid={() => setGrid((g) => !g)}
        snap={snap}
        onSnap={() => setSnap((s) => !s)}
        onFit={() => setFitSignal((n) => n + 1)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => {
          undo();
          setDirty(true);
        }}
        onRedo={() => {
          redo();
          setDirty(true);
        }}
        dirty={dirty}
        saving={saveMut.isPending}
        onSave={doSave}
        approving={approveMut.isPending || saveMut.isPending}
        onApprove={doApprove}
        blocking={validation.blocking}
        warnings={validation.warnings}
      />

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-surface-1/90 p-0.5 shadow-sm backdrop-blur">
              {(["edit", "plan"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "plan" ? "Plan view" : "Edit"}
                </button>
              ))}
            </div>
            {floors.length > 1 && mode === "edit" && (
              <div className="inline-flex rounded-lg border border-border bg-surface-1/90 p-0.5 shadow-sm backdrop-blur">
                {floors.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFloor(f)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      floor === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {f === 0 ? "Ground" : `Floor ${f + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
          {mode === "plan" ? (
            <PlanView pid={pid} dirty={dirty} />
          ) : (
            <EditorCanvas
              ubm={viewUbm ?? present}
              tool={tool}
              setTool={setTool}
              selection={selection}
              setSelection={setSelection}
              layers={layers}
              grid={grid}
              snap={snap}
              unit={unit}
              snapshot={snapshot}
              mutate={mutate}
              onCursor={setCursor}
              onZoom={setPxPerM}
              fitSignal={fitSignal}
            />
          )}
        </div>

        {mode === "edit" && (
          <aside className="w-[300px] shrink-0 space-y-3 overflow-y-auto border-l border-border bg-surface-2/40 p-3">
            <PropertiesPanel ubm={present} selection={selection} unit={unit} onPatch={patchElement} onDelete={deleteSelected} />
            <ValidationPanel report={validation} onFocus={focusElement} />
            <LayersPanel layers={layers} counts={counts} onToggle={(k) => setLayers((s) => ({ ...s, [k]: !s[k] }))} />
            <ExportPanel pid={pid} name={project.data?.name} />
          </aside>
        )}
      </div>

      <StatusBar
        cursor={cursor}
        unit={unit}
        onUnit={setUnit}
        pxPerM={pxPerM}
        selection={selection}
        counts={{ rooms: counts.rooms, walls: counts.walls, doors: counts.doors, windows: counts.windows }}
        blocking={validation.blocking}
        warnings={validation.warnings}
      />
    </Card>
  );
}

/* ------------------------------- pure helpers ------------------------------ */

const COLL: Record<EditableKind, "rooms" | "walls" | "doors" | "windows" | "columns"> = {
  room: "rooms",
  wall: "walls",
  door: "doors",
  window: "windows",
  column: "columns",
};

function applyPatch(
  d: UniversalBuildingModel,
  kind: EditableKind,
  id: string,
  patch: Record<string, unknown>,
): UniversalBuildingModel {
  const key = COLL[kind];
  const arr = d[key] as { id: string }[];
  return { ...d, [key]: arr.map((el) => (el.id === id ? { ...el, ...patch } : el)) } as UniversalBuildingModel;
}

function removeElement(d: UniversalBuildingModel, sel: Selection): UniversalBuildingModel {
  const key = COLL[sel.kind];
  const arr = d[key] as { id: string }[];
  return { ...d, [key]: arr.filter((el) => el.id !== sel.id) } as UniversalBuildingModel;
}

function resolveSelection(d: UniversalBuildingModel, id: string): Selection | null {
  if (d.rooms.some((r) => r.id === id)) return { kind: "room", id };
  if (d.walls.some((w) => w.id === id)) return { kind: "wall", id };
  if (d.doors.some((x) => x.id === id)) return { kind: "door", id };
  if (d.windows.some((x) => x.id === id)) return { kind: "window", id };
  if (d.columns.some((c) => c.id === id)) return { kind: "column", id };
  return null;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
