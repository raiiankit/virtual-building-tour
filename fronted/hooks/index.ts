"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useAuthStore } from "@/store";
import type { ProjectSummary, Project, AnalysisJob, AppNotification, Me, RenderJob } from "@/types";

export function useProjects() {
  const token = useAuthStore((s) => s.token);
  return useQuery({ queryKey: ["projects"], queryFn: () => api.get<ProjectSummary[]>("/api/projects"), enabled: !!token });
}

export function useProject(id: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery({ queryKey: ["project", id], queryFn: () => api.get<Project>(`/api/projects/${id}`), enabled: !!token && !!id });
}

export function useAnalysis(id: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["analysis", id],
    queryFn: () => api.get<AnalysisJob>(`/api/projects/${id}/analysis`),
    enabled: !!token && !!id, retry: false,
  });
}

export function useNotifications() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["notifications"], queryFn: () => api.get<AppNotification[]>("/api/notifications"),
    enabled: !!token, refetchInterval: 30_000,
  });
}

export function useRenders(id: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery({ queryKey: ["renders", id], queryFn: () => api.get<RenderJob[]>(`/api/projects/${id}/renders`), enabled: !!token && !!id });
}

export interface Model3D { id: number; status: string; engine_version: string; asset_url: string; scene_url: string | null; }
export function useModel(id: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery({ queryKey: ["model", id], queryFn: () => api.get<Model3D>(`/api/projects/${id}/model`), enabled: !!token && !!id, retry: false });
}

export interface PlanPreview {
  rooms: { x: number; z: number; w: number; d: number; type: string }[];
  bounds: { min: [number, number]; max: [number, number] } | null;
}
export function useProjectPreview(id: number, enabled: boolean) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["preview", id],
    queryFn: () => api.get<PlanPreview>(`/api/projects/${id}/preview`),
    enabled: !!token && !!id && enabled, retry: false, staleTime: 5 * 60_000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; building_type: string; location?: string; builder?: string }) =>
      api.post<{ id: number }>("/api/projects", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<{ detail: string }>(`/api/projects/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<{ access_token: string; full_name: string; role: string }>("/api/auth/login", body),
    onSuccess: async (d) => {
      setAuth(d.access_token, null);
      const me = await api.get<{ data: Me }>("/api/auth/me");
      useAuthStore.getState().setMe(me.data);
    },
  });
}

export function useInvalidateProject(id: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["project", id] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["analysis", id] });
    qc.invalidateQueries({ queryKey: ["ubm", id] });      // 2D editor rebuilds on approve/analyse
  };
}
