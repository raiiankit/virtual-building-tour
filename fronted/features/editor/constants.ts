import {
  Box,
  DoorOpen,
  Hand,
  Minus,
  MousePointer2,
  RectangleHorizontal,
  Ruler,
  Square,
  type LucideIcon,
} from "lucide-react";
import type { Tool } from "./ubm/types";

export interface ToolDef {
  key: Tool;
  icon: LucideIcon;
  label: string;
  shortcut: string;
  /** true = single-click placement / drag tool; false = view tool. */
  creates?: boolean;
}

/** The left-rail tool palette. Order = display order. */
export const TOOLS: ToolDef[] = [
  { key: "select", icon: MousePointer2, label: "Select / Move", shortcut: "V" },
  { key: "pan", icon: Hand, label: "Pan", shortcut: "H" },
  { key: "room", icon: Square, label: "Room", shortcut: "R", creates: true },
  { key: "wall", icon: Minus, label: "Wall", shortcut: "W", creates: true },
  { key: "door", icon: DoorOpen, label: "Door", shortcut: "D", creates: true },
  { key: "window", icon: RectangleHorizontal, label: "Window", shortcut: "N", creates: true },
  { key: "column", icon: Box, label: "Column", shortcut: "C", creates: true },
  { key: "measure", icon: Ruler, label: "Measure", shortcut: "M" },
];

/** key (lowercase) → tool, for the keyboard handler. */
export const TOOL_SHORTCUTS: Record<string, Tool> = Object.fromEntries(
  TOOLS.map((t) => [t.shortcut.toLowerCase(), t.key]),
);

/** Fine snap increment (metres) when snapping to the grid. */
export const SNAP_STEP_M = 0.1;
