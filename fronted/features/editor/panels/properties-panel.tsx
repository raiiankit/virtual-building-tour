"use client";

import type { ReactNode } from "react";
import { Boxes, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { classifyRoom } from "../ubm/factory";
import { polygonPerimeter } from "../ubm/geometry";
import type {
  Column,
  Door,
  EditableKind,
  Room,
  Selection,
  UniversalBuildingModel,
  Wall,
  Window,
} from "../ubm/types";
import { fmtArea, fmtLen, type Unit } from "../ubm/units";
import { DimField, ReadField, SelectField, TextField, ToggleField } from "./fields";

const ROOM_TYPES = [
  "room", "living_room", "master_bedroom", "bedroom", "kitchen", "dining", "bathroom",
  "foyer", "balcony", "utility", "garage", "office", "staircase", "corridor",
].map((v) => ({ value: v, label: v.replace(/_/g, " ") }));
const WALL_MATERIALS = ["plaster", "brick", "concrete", "wood", "glass", "stone"].map((v) => ({ value: v, label: v }));
const DOOR_DIRS = [
  { value: "in", label: "Swing in" },
  { value: "out", label: "Swing out" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "slide", label: "Sliding" },
] as const;
const DOOR_MATERIALS = ["wood", "glass", "metal", "upvc"].map((v) => ({ value: v, label: v }));
const GLASS_TYPES = ["clear", "frosted", "tinted"].map((v) => ({ value: v, label: v }));
const FRAME_TYPES = ["aluminium", "upvc", "wood"].map((v) => ({ value: v, label: v }));

const round2 = (m: number) => Number(m.toFixed(2));
const round3 = (m: number) => Number(m.toFixed(3));

export type PatchFn = (kind: EditableKind, id: string, patch: Record<string, unknown>) => void;

export interface PropertiesPanelProps {
  ubm: UniversalBuildingModel;
  selection: Selection | null;
  unit: Unit;
  onPatch: PatchFn;
  onDelete: () => void;
}

export function PropertiesPanel({ ubm, selection, unit, onPatch, onDelete }: PropertiesPanelProps) {
  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Boxes className="size-4 text-primary" /> Properties
      </div>
      {!selection ? (
        <p className="text-xs text-muted-foreground">Select an element on the canvas to edit its properties.</p>
      ) : (
        <Fields ubm={ubm} selection={selection} unit={unit} onPatch={onPatch} onDelete={onDelete} />
      )}
    </Card>
  );
}

function Fields({
  ubm,
  selection,
  unit,
  onPatch,
  onDelete,
}: {
  ubm: UniversalBuildingModel;
  selection: Selection;
  unit: Unit;
  onPatch: PatchFn;
  onDelete: () => void;
}) {
  const { kind, id } = selection;
  const patch = (p: Record<string, unknown>) => onPatch(kind, id, p);
  const deleteBtn: ReactNode = (
    <Button variant="destructive" size="sm" className="mt-1 w-full" onClick={onDelete}>
      <Trash2 className="size-4" /> Delete {kind}
    </Button>
  );

  switch (kind) {
    case "room": {
      const r = ubm.rooms.find((x) => x.id === id);
      return r ? <RoomFields r={r} unit={unit} patch={patch} deleteBtn={deleteBtn} /> : null;
    }
    case "wall": {
      const w = ubm.walls.find((x) => x.id === id);
      return w ? <WallFields w={w} unit={unit} patch={patch} deleteBtn={deleteBtn} /> : null;
    }
    case "door": {
      const d = ubm.doors.find((x) => x.id === id);
      return d ? <DoorFields d={d} unit={unit} patch={patch} deleteBtn={deleteBtn} /> : null;
    }
    case "window": {
      const w = ubm.windows.find((x) => x.id === id);
      return w ? <WindowFields w={w} unit={unit} patch={patch} deleteBtn={deleteBtn} /> : null;
    }
    case "column": {
      const c = ubm.columns.find((x) => x.id === id);
      return c ? <ColumnFields c={c} unit={unit} patch={patch} deleteBtn={deleteBtn} /> : null;
    }
  }
}

type FieldsProps<T> = { unit: Unit; patch: (p: Record<string, unknown>) => void; deleteBtn: ReactNode } & T;

function RoomFields({ r, unit, patch, deleteBtn }: FieldsProps<{ r: Room }>) {
  return (
    <div className="space-y-3">
      <TextField id="prop-room-name" label="Room name" value={r.name} onCommit={(name) => patch({ name, type: classifyRoom(name) })} />
      <SelectField label="Type" value={r.type} options={ROOM_TYPES} onChange={(type) => patch({ type })} />
      <DimField label="Ceiling height" metres={r.height_m} unit={unit} onCommit={(m) => patch({ height_m: round2(m) })} />
      <div className="grid grid-cols-2 gap-2 text-sm">
        <ReadField label="Area" value={fmtArea(r.area_m2, unit)} />
        <ReadField label="Perimeter" value={fmtLen(polygonPerimeter(r.polygon), unit)} />
        <ReadField label="Confidence" value={`${Math.round(r.confidence * 100)}%`} />
        <ReadField label="Floor" value={`Level ${r.floor}`} />
      </div>
      {deleteBtn}
    </div>
  );
}

function WallFields({ w, unit, patch, deleteBtn }: FieldsProps<{ w: Wall }>) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <ReadField label="Length" value={fmtLen(w.length_m, unit)} />
        <DimField label="Height" metres={w.height_m} unit={unit} onCommit={(m) => patch({ height_m: round2(m) })} />
        <DimField label="Thickness" metres={w.thickness_m} unit={unit} min={0.02} onCommit={(m) => patch({ thickness_m: round3(m) })} />
      </div>
      <SelectField label="Material" value={w.material} options={WALL_MATERIALS} onChange={(material) => patch({ material })} />
      <ToggleField label="Exterior wall" checked={w.exterior} onChange={(exterior) => patch({ exterior })} />
      {deleteBtn}
    </div>
  );
}

function DoorFields({ d, unit, patch, deleteBtn }: FieldsProps<{ d: Door }>) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <DimField label="Width" metres={d.width_m} unit={unit} onCommit={(m) => patch({ width_m: round2(m) })} />
        <DimField label="Height" metres={d.height_m} unit={unit} onCommit={(m) => patch({ height_m: round2(m) })} />
      </div>
      <SelectField label="Opening" value={d.openingDirection} options={DOOR_DIRS} onChange={(openingDirection) => patch({ openingDirection })} />
      <SelectField label="Material" value={d.material} options={DOOR_MATERIALS} onChange={(material) => patch({ material })} />
      <ToggleField label="Main entrance" checked={d.entrance} onChange={(entrance) => patch({ entrance })} />
      {deleteBtn}
    </div>
  );
}

function WindowFields({ w, unit, patch, deleteBtn }: FieldsProps<{ w: Window }>) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <DimField label="Width" metres={w.width_m} unit={unit} onCommit={(m) => patch({ width_m: round2(m) })} />
        <DimField label="Height" metres={w.height_m} unit={unit} onCommit={(m) => patch({ height_m: round2(m) })} />
        <DimField label="Sill height" metres={w.sill_m} unit={unit} min={0} onCommit={(m) => patch({ sill_m: round2(m) })} />
      </div>
      <SelectField label="Glass" value={w.glassType} options={GLASS_TYPES} onChange={(glassType) => patch({ glassType })} />
      <SelectField label="Frame" value={w.frameType} options={FRAME_TYPES} onChange={(frameType) => patch({ frameType })} />
      {deleteBtn}
    </div>
  );
}

function ColumnFields({ c, unit, patch, deleteBtn }: FieldsProps<{ c: Column }>) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <DimField label="Width" metres={c.width_m} unit={unit} onCommit={(m) => patch({ width_m: round2(m) })} />
        <DimField label="Depth" metres={c.depth_m} unit={unit} onCommit={(m) => patch({ depth_m: round2(m) })} />
      </div>
      <ReadField label="Floor" value={`Level ${c.floor}`} />
      {deleteBtn}
    </div>
  );
}
