import { LayoutGrid, FolderKanban, Shield, Sparkles, Boxes, Clapperboard, FileJson, type LucideIcon } from "lucide-react";
import type { ProjectStatus } from "@/types";

export const APP_NAME = "Virtual Building Tour";

export interface NavItem { key: string; label: string; href: string; icon: LucideIcon; adminOnly?: boolean; }
export const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Home", href: "/", icon: LayoutGrid },
  { key: "projects", label: "Projects", href: "/projects", icon: FolderKanban },
  { key: "json3d", label: "JSON → 3D", href: "/json-model", icon: FileJson },
  { key: "admin", label: "Admin", href: "/admin", icon: Shield, adminOnly: true },
];

/** Status design tokens — one definition consumed everywhere (StatusBadge). */
export const STATUS_META: Record<ProjectStatus, { label: string; tone: StatusTone; progress: number }> = {
  draft:           { label: "Draft",         tone: "blue",    progress: 8 },
  files_uploaded:  { label: "Uploading",     tone: "orange",  progress: 22 },
  analysing:       { label: "Analysing",     tone: "purple",  progress: 38 },
  needs_review:    { label: "Needs Review",  tone: "amber",   progress: 52 },
  approved_for_3d: { label: "Approved",      tone: "indigo",  progress: 62 },
  generating_3d:   { label: "Generating",    tone: "indigo",  progress: 74 },
  "3d_ready":      { label: "3D Ready",      tone: "green",   progress: 88 },
  rendering:       { label: "Rendering",     tone: "pink",    progress: 94 },
  completed:       { label: "Completed",     tone: "emerald", progress: 100 },
  failed:          { label: "Failed",        tone: "red",     progress: 0 },
  archived:        { label: "Archived",      tone: "slate",   progress: 100 },
};
export type StatusTone = "blue" | "orange" | "purple" | "amber" | "indigo" | "green" | "pink" | "emerald" | "red" | "slate";

export interface WizardStep { key: string; label: string; icon: LucideIcon; }
export const PROJECT_TABS: WizardStep[] = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "analysis", label: "AI Analysis", icon: Sparkles },
  { key: "model", label: "3D Model", icon: Boxes },
  { key: "video", label: "Video", icon: Clapperboard },
];
