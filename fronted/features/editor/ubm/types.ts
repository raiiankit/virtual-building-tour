/**
 * Universal Building Model (UBM) — the single source of truth for the 2D editor.
 *
 * This mirrors the backend pydantic schema (`backend/ubm/models.py`) 1:1 so the JSON
 * returned by `GET /api/projects/{pid}/ubm` deserialises straight into these types and
 * the edited object serialises straight back via `PUT /api/projects/{pid}/ubm`.
 *
 * Geometry convention (matches the backend): every coordinate is in **canonical metres**
 * and every point is `[x, z]` — `z` is the in-plan vertical axis, so on screen it maps to
 * the y direction. Never introduce pixel geometry here; pixels live only in the view layer.
 */

export const UBM_VERSION = "ubm-1.0";

/** `[x, z]` in metres. */
export type Point = [number, number];
/** A closed ring; the first and last vertices are implicitly joined (first !== last). */
export type Polygon = Point[];

export type OpeningDirection = "in" | "out" | "left" | "right" | "slide";
export type ValidationLevel = "blocking" | "warning" | "info";

export interface Material {
  id: string;
  name: string;
  kind: string; // plaster | wood | aluminium | glass | tile | marble | concrete | stone
  color?: string | null;
}

export interface Dimension {
  id: string;
  a: Point;
  b: Point;
  length_m: number;
  label?: string | null;
}

export interface Annotation {
  id: string;
  text: string;
  at: Point;
  kind: string; // label | note | room-name | dimension-text
}

export interface Room {
  id: string;
  name: string;
  type: string; // bedroom | kitchen | bathroom | living_room | ...
  polygon: Polygon;
  height_m: number;
  area_m2: number;
  floor: number;
  confidence: number; // 0..1 — rooms < 0.9 are flagged for review
  status: string; // detected | estimated | unknown | missing
  ocrText?: string | null;
  connectedRooms: string[];
  doors: string[];
  windows: string[];
}

export interface Wall {
  id: string;
  startPoint: Point;
  endPoint: Point;
  length_m: number;
  height_m: number;
  thickness_m: number; // 0.20 exterior / 0.12 interior
  exterior: boolean;
  material: string;
  floor: number;
  connectedRooms: string[];
}

export interface Door {
  id: string;
  position: Point;
  rotation: number; // radians, along-wall orientation
  wallId?: string | null;
  width_m: number;
  height_m: number;
  openingDirection: OpeningDirection;
  entrance: boolean;
  material: string;
  floor: number;
}

export interface Window {
  id: string;
  position: Point;
  wallId?: string | null;
  width_m: number;
  height_m: number;
  sill_m: number;
  glassType: string;
  frameType: string;
  floor: number;
}

export interface Stair {
  id: string;
  polygon: Polygon;
  floor: number;
  direction?: string | null;
  connectsTo: number[];
}

export interface Balcony {
  id: string;
  polygon: Polygon;
  floor: number;
  railing: boolean;
  connectedRooms: string[];
}

export interface Column {
  id: string;
  at: Point;
  width_m: number;
  depth_m: number;
  floor: number;
}

export interface Beam {
  id: string;
  startPoint: Point;
  endPoint: Point;
  floor: number;
}

export interface Slab {
  id: string;
  polygon: Polygon;
  floor: number;
  thickness_m: number;
  kind: string; // floor | roof
}

export interface FloorLevel {
  level: number;
  name: string;
  height_m: number;
  rooms: string[];
}

export interface BuildingMeta {
  id: string;
  name: string;
  type: string; // apartment | villa
  floor_count: number;
  entrances: Point[];
}

export interface ProjectMeta {
  id?: number | null;
  name: string;
  location?: string | null;
  builder?: string | null;
}

export interface UBMMetadata {
  version: string;
  source_format: string;
  source_file?: string | null;
  extractor?: string | null;
  unit: string;
  scale_m_per_unit: number;
  orientation_deg: number;
  bounds?: Bounds | null;
  confidence: number;
  extra: Record<string, unknown>;
}

export interface Bounds {
  minx: number;
  minz: number;
  maxx: number;
  maxz: number;
}

export interface UniversalBuildingModel {
  project: ProjectMeta;
  building: BuildingMeta;
  floors: FloorLevel[];
  rooms: Room[];
  walls: Wall[];
  doors: Door[];
  windows: Window[];
  stairs: Stair[];
  balconies: Balcony[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  roof?: Slab | null;
  materials: Material[];
  dimensions: Dimension[];
  annotations: Annotation[];
  metadata: UBMMetadata;
}

export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  element_id?: string | null;
}

export interface ValidationReport {
  ok: boolean;
  blocking: number;
  warnings: number;
  issues: ValidationIssue[];
}

/* --------------------------------------------------------------------------------------
 * Editor-only view types — NOT part of the UBM. These describe selection and tool state,
 * never geometry, so the UBM stays the single, portable source of truth.
 * ------------------------------------------------------------------------------------ */

/** The element collections the 2D editor can currently select and mutate. */
export type EditableKind = "room" | "wall" | "door" | "window" | "column";

export type Tool =
  | "select"
  | "pan"
  | "room"
  | "wall"
  | "door"
  | "window"
  | "column"
  | "measure";

export interface Selection {
  kind: EditableKind;
  id: string;
}

/** Which element layers are visible / interactive on the canvas. */
export interface LayerVisibility {
  rooms: boolean;
  walls: boolean;
  doors: boolean;
  windows: boolean;
  columns: boolean;
  beams: boolean;
  stairs: boolean;
  balconies: boolean;
  annotations: boolean;
}

export const DEFAULT_LAYERS: LayerVisibility = {
  rooms: true,
  walls: true,
  doors: true,
  windows: true,
  columns: true,
  beams: true,
  stairs: true,
  balconies: true,
  annotations: true,
};
