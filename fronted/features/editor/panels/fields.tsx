"use client";

import { useEffect, useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fmtLen, toMetres, UNITS, type Unit } from "../ubm/units";

/** Read-only stat chip (area, confidence, derived length…). */
export function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-2 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

/** Text input that commits on blur / Enter (so typing doesn't spam the undo history). */
export function TextField({
  label,
  value,
  onCommit,
  id,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  id?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const commit = () => {
    if (local !== value) onCommit(local);
  };
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input
        id={id}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );
}

/**
 * Length input shown in the active display `unit`, committing metres on blur / Enter.
 * Canonical storage stays metric; only the presentation converts.
 */
export function DimField({
  label,
  metres,
  unit,
  onCommit,
  min = 0.01,
}: {
  label: string;
  metres: number;
  unit: Unit;
  onCommit: (metres: number) => void;
  min?: number;
}) {
  const shown = () => (metres / UNITS[unit]).toString();
  const [local, setLocal] = useState(shown);
  useEffect(() => setLocal(shown()), [metres, unit]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = Number(local);
    if (Number.isFinite(n) && n >= min) {
      const m = toMetres(n, unit);
      if (Math.abs(m - metres) > 1e-6) onCommit(m);
    } else {
      setLocal(shown());
    }
  };
  return (
    <div className="space-y-1">
      <Label className="flex items-center justify-between">
        {label} <span className="text-[10px] text-muted-foreground">{unit}</span>
      </Label>
      <Input
        type="number"
        step="any"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 w-full rounded-md border border-input bg-surface px-2 text-sm outline-none focus-visible:border-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-center justify-between rounded-md px-1 py-1.5 text-sm")}>
      {label}
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-4 accent-primary"
      />
    </label>
  );
}

/** Small helper re-export so panels can format a metric length inline. */
export { fmtLen };
