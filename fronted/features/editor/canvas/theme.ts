/** Shared visual tokens for the canvas + panels. Kept out of render.ts so the properties
 *  and layers panels can show the exact same swatches the canvas draws. */

/** Fill tint per room type (light theme). Alpha is applied at draw time. */
export const ROOM_TINT: Record<string, string> = {
  kitchen: "#f0d9a7",
  bathroom: "#a7d4e0",
  master_bedroom: "#c8b6e0",
  bedroom: "#c3d3ea",
  living_room: "#bfe0c4",
  dining: "#e6c9b0",
  garage: "#c9ccce",
  balcony: "#bfe6d8",
  utility: "#d8d2c2",
  foyer: "#e2d6ea",
  office: "#d5c9ec",
  staircase: "#f0c4c4",
  corridor: "#dfe4ea",
  room: "#d7dbe0",
};

export const roomTint = (type: string): string => ROOM_TINT[type] ?? ROOM_TINT.room;

/** Confidence → traffic-light colour. Green = trusted, amber = worth a quick verify,
 *  red reserved for genuinely unreliable (<50%) so a normal review flag never looks like an error. */
export const confidenceColor = (c: number): string =>
  c >= 0.9 ? "#059669" : c >= 0.5 ? "#d97706" : "#dc2626";

export const SELECTED = "#2563eb";
export const HOVER = "#60a5fa";
export const DANGER = "#dc2626";

export interface CanvasPalette {
  pageFill: string;
  pageStroke: string;
  gridMinor: string;
  gridMajor: string;
  wall: string;
  wallExterior: string;
  window: string;
  door: string;
  doorEntrance: string;
  column: string;
  beam: string;
  stair: string;
  balcony: string;
  text: string;
  textMuted: string;
}

export const palette = (dark: boolean): CanvasPalette =>
  dark
    ? {
        pageFill: "#0b1220",
        pageStroke: "#1e293b",
        gridMinor: "rgba(148,163,184,0.08)",
        gridMajor: "rgba(148,163,184,0.16)",
        wall: "#cbd5e1",
        wallExterior: "#f8fafc",
        window: "#38bdf8",
        door: "#d0a45c",
        doorEntrance: "#f0b45a",
        column: "#94a3b8",
        beam: "#64748b",
        stair: "#a78bfa",
        balcony: "#34d399",
        text: "#e2e8f0",
        textMuted: "#94a3b8",
      }
    : {
        pageFill: "#ffffff",
        pageStroke: "#e2e8f0",
        gridMinor: "rgba(100,116,139,0.10)",
        gridMajor: "rgba(100,116,139,0.20)",
        wall: "#1e293b",
        wallExterior: "#0f172a",
        window: "#0284c7",
        door: "#b45309",
        doorEntrance: "#7a4a1e",
        column: "#475569",
        beam: "#94a3b8",
        stair: "#7c3aed",
        balcony: "#059669",
        text: "#0f172a",
        textMuted: "#64748b",
      };
