"use client";

import { useState } from "react";
import { Building2, Layers, Save, Plus, Ruler } from "lucide-react";
import { toast } from "sonner";
import type { Project } from "@/types";
import { api } from "@/services/api";
import { useInvalidateProject } from "@/hooks";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OverviewPanel({ project }: { project: Project }) {
  const b = project.building;
  const invalidate = useInvalidateProject(project.id);
  const [floors, setFloors] = useState(b?.floor_count ?? 1);
  const [height, setHeight] = useState(b?.floor_to_floor_m ?? 3);
  const [width, setWidth] = useState(b?.width_m ?? "");
  const [length, setLength] = useState(b?.length_m ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/projects/${project.id}/building`, {
        floor_count: Number(floors), floor_to_floor_m: Number(height),
        width_m: width ? Number(width) : null, length_m: length ? Number(length) : null,
      });
      toast.success("Building saved"); invalidate();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };
  const addFloor = async () => {
    try { await api.post(`/api/projects/${project.id}/floors`, { level: (b?.floors?.length ?? 0), name: `Floor ${b?.floors?.length ?? 0}` }); toast.success("Floor added"); invalidate(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const rooms = (b?.floors ?? []).reduce((n, f) => n + (f.rooms?.length ?? 0), 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-primary" /> Building details</CardTitle>
          <CardDescription>Floors, heights and footprint drive how the 3D model is generated.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Number of floors</Label><Input type="number" min={1} value={floors} onChange={(e) => setFloors(Number(e.target.value))} /></div>
            <div className="space-y-1.5"><Label>Floor-to-floor height (m)</Label><Input type="number" step="0.1" value={height} onChange={(e) => setHeight(Number(e.target.value))} /></div>
            <div className="space-y-1.5"><Label>Width (m)</Label><Input type="number" step="0.1" value={width} onChange={(e) => setWidth(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Length (m)</Label><Input type="number" step="0.1" value={length} onChange={(e) => setLength(e.target.value)} /></div>
          </div>
          <div className="flex gap-2.5">
            <Button onClick={save} loading={saving}><Save className="size-4" /> Save building</Button>
            <Button variant="outline" onClick={addFloor}><Plus className="size-4" /> Add floor</Button>
          </div>
          <p className="text-xs text-muted-foreground">Tip: a single-storey plan should use 1 floor. Multi-storey buildings are stacked automatically.</p>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card><CardContent className="flex items-center gap-4 p-5">
          <div className="grid size-11 place-items-center rounded-xl bg-indigo-500/10 text-indigo-600"><Layers className="size-5" /></div>
          <div><div className="text-2xl font-bold">{b?.floors?.length ?? 0}</div><div className="text-xs text-muted-foreground">Floors defined</div></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 p-5">
          <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Ruler className="size-5" /></div>
          <div><div className="text-2xl font-bold">{rooms}</div><div className="text-xs text-muted-foreground">Rooms detected</div></div>
        </CardContent></Card>
      </div>
    </div>
  );
}
