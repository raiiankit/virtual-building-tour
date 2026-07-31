"use client";

/**
 * React Query bindings for the UBM lifecycle. The UBM JSON is the single source of truth:
 * we load it, the editor mutates an in-memory copy, then bulk-save it back.
 *
 *   GET    /api/projects/{pid}/ubm            → load
 *   POST   /api/projects/{pid}/ubm/extract    → build one from the uploaded plan
 *   PUT    /api/projects/{pid}/ubm            → bulk save (add / delete / move)
 *   POST   /api/projects/{pid}/ubm/approve    → lock as approved geometry
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/services/api";
import { useAuthStore } from "@/store";
import type { UniversalBuildingModel, ValidationReport } from "../ubm/types";

export interface ExtractResult {
  detail: string;
  source_format: string;
  counts: { rooms: number; walls: number; doors: number; windows: number; floors: number };
  validation: ValidationReport;
  unit: string;
  scale_m_per_unit: number;
}

const ubmKey = (pid: number) => ["ubm", pid] as const;

/** Load the stored UBM. A 404 (`retry: false`) means "not extracted yet". */
export function useUBM(pid: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery<UniversalBuildingModel, ApiError>({
    queryKey: ubmKey(pid),
    queryFn: () => api.get<UniversalBuildingModel>(`/api/projects/${pid}/ubm`),
    enabled: !!token && !!pid,
    retry: false,
    staleTime: 60_000,
  });
}

export function useExtractUBM(pid: number) {
  const qc = useQueryClient();
  return useMutation<ExtractResult, ApiError, void>({
    mutationFn: () => api.post<ExtractResult>(`/api/projects/${pid}/ubm/extract`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ubmKey(pid) });
      qc.invalidateQueries({ queryKey: ["project", pid] });
    },
  });
}

export interface SaveResult {
  detail: string;
  validation: ValidationReport;
}

/** Bulk-save the whole edited UBM. Keeps the query cache in sync with what we persisted. */
export function useSaveUBM(pid: number) {
  const qc = useQueryClient();
  return useMutation<SaveResult, ApiError, UniversalBuildingModel>({
    mutationFn: (ubm) => api.put<SaveResult>(`/api/projects/${pid}/ubm`, ubm),
    onSuccess: (_res, ubm) => {
      qc.setQueryData(ubmKey(pid), ubm);
    },
  });
}

export interface ApproveResult {
  detail: string;
  counts: { rooms: number; walls: number };
}

export function useApproveUBM(pid: number) {
  const qc = useQueryClient();
  return useMutation<ApproveResult, ApiError, void>({
    mutationFn: () => api.post<ApproveResult>(`/api/projects/${pid}/ubm/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", pid] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
