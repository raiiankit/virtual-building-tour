"use client";

import { MousePointer2 } from "lucide-react";
import { fmtLen, UNITS, type Unit } from "../ubm/units";
import type { Point, Selection } from "../ubm/types";

export interface StatusBarProps {
  cursor: Point | null;
  unit: Unit;
  onUnit: (u: Unit) => void;
  pxPerM: number;
  selection: Selection | null;
  counts: { rooms: number; walls: number; doors: number; windows: number };
  blocking: number;
  warnings: number;
}

export function StatusBar({ cursor, unit, onUnit, pxPerM, selection, counts, blocking, warnings }: StatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-2 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <MousePointer2 className="size-3" />
        {cursor ? `${fmtLen(cursor[0], unit)}, ${fmtLen(cursor[1], unit)}` : "—"}
      </span>
      <span>{pxPerM} px/m</span>
      <span>
        {counts.rooms}R · {counts.walls}W · {counts.doors}D · {counts.windows}N
      </span>
      <span className="capitalize">
        {selection ? `${selection.kind} selected` : "no selection"}
      </span>
      <span className={blocking ? "text-danger" : warnings ? "text-amber-600" : "text-success"}>
        {blocking ? `${blocking} blocking` : warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "valid"}
      </span>
      <label className="ml-auto flex items-center gap-1.5 font-sans">
        <span>Units</span>
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value as Unit)}
          className="h-6 rounded border border-input bg-surface px-1.5 text-[11px] font-medium outline-none focus-visible:border-primary"
        >
          {(Object.keys(UNITS) as Unit[]).map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
