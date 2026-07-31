/** API types — mirror the FastAPI backend contracts (unchanged). */
export type ProjectStatus =
  | "draft" | "files_uploaded" | "analysing" | "needs_review" | "approved_for_3d"
  | "generating_3d" | "3d_ready" | "rendering" | "completed" | "failed" | "archived";

export type BuildingType = "apartment" | "villa";
export type Role = "super_admin" | "company_admin" | "designer" | "viewer";

export interface ProjectSummary {
  id: number;
  name: string;
  building_type: BuildingType | null;
  location: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string | null;
}

export interface Floor { id: number; level: number; name: string; rooms: { id: number; name: string; room_type: string }[]; }
export interface Building {
  id: number; floor_count: number; floor_to_floor_m: number;
  width_m: number | null; length_m: number | null; features: Record<string, unknown>; floors: Floor[];
}
export interface PlanFile { id: number; filename: string; category: string; obsolete: boolean; }
export interface Project extends Omit<ProjectSummary, "created_at" | "updated_at"> {
  property_name?: string | null; builder?: string | null; unit?: string;
  building: Building | null; plan_files: PlanFile[];
}

export interface DetectedRoom {
  x: number; y: number; w: number; h: number;
  name: string; type: string; confidence: number; dim_label?: string | null; floor_material?: string;
}
export interface Wall { x1: number; y1: number; x2: number; y2: number; confidence: number; }
export interface Detection { label: string; kind: string; confidence: number; }
export interface AnalysisVectors {
  image_size: [number, number]; walls: Wall[]; rooms: DetectedRoom[];
  doors: { x: number; y: number; orient?: string; entrance?: boolean; confidence: number }[];
  windows: { x: number; y: number; orient?: string; len?: number; confidence: number }[];
  detections?: Detection[]; ocr_available?: boolean; source: string;
}
export interface AnalysisJob { id: number; status: string; result: AnalysisVectors; warnings: { level: string; code: string; message: string }[]; model_version: string; }

export interface Me { id: number; full_name: string; email: string; role: Role; email_verified: boolean; }
export interface AppNotification { id: number; type: string; message: string; read: boolean; project_id: number | null; created_at: string; }
export interface RenderJob { id: number; status: string; ratio: string; resolution: string; output_url: string | null; }

/** Furnishing/scene manifest that rides alongside a generated .glb. */
export interface SceneRoom {
  name: string; type: string; confidence: number;
  center: [number, number]; size: [number, number];
  dim_label?: string | null; floor_material?: string; level: number; base_y: number;
}
export interface SceneFurniture {
  type: string; pos: [number, number]; size: [number, number, number];
  y?: number; material?: string; base_y: number; level: number;
}
export interface SceneWall { a: [number, number]; b: [number, number]; exterior: boolean; }
export interface SceneManifest {
  version: string; units: string; floor_height_m: number; wall_height_m: number; levels: number;
  bounds: { min: [number, number]; max: [number, number] };
  theme?: string;
  scale?: number;
  win_sill?: number; win_head?: number;
  walls?: SceneWall[];
  rooms: SceneRoom[];
  furniture: SceneFurniture[];
  windows: { pos: [number, number]; orient: string; confidence: number; len?: number }[];
  doors: { pos: [number, number]; orient: string; entrance: boolean; confidence: number; width?: number; glass?: boolean }[];
}
