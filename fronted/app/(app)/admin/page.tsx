"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Users, Sparkles, Film, FileImage } from "lucide-react";
import { api } from "@/services/api";
import { useAuthStore, useHeader } from "@/store";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectStatus } from "@/types";
import type { LucideIcon } from "lucide-react";

interface Overview { projects_total: number; users: number; analysis_jobs: number; render_jobs: number; uploaded_files: number; }
interface Job { kind?: string; id: number; project_id: number; status: string; model_version?: string; ratio?: string; }
interface UserRow { id: number; name: string; email: string; role: string; verified: boolean; status: string; }
interface AuditRow { id: number; action: string; object: string; actor_id: number | null; result: string; at: string; }

function Stat({ icon: Icon, label, value, tint }: { icon: LucideIcon; label: string; value: number; tint: string }) {
  return (
    <Card><CardContent className="flex items-center gap-4 p-5">
      <div className={`grid size-11 place-items-center rounded-xl ${tint}`}><Icon className="size-5" /></div>
      <div><div className="text-2xl font-bold tabular-nums">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
    </CardContent></Card>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => <th className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</th>;
const Td = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => <td className={`whitespace-nowrap px-4 py-3 text-sm ${className}`}>{children}</td>;

export default function AdminPage() {
  const setCrumbs = useHeader((s) => s.setCrumbs);
  const token = useAuthStore((s) => s.token);
  useEffect(() => setCrumbs([{ label: "Admin" }]), [setCrumbs]);

  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api.get<Overview>("/api/admin/overview"), enabled: !!token });
  const jobs = useQuery({ queryKey: ["admin", "jobs"], queryFn: () => api.get<{ analysis: Job[]; render: Job[] }>("/api/admin/jobs"), enabled: !!token });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => api.get<UserRow[]>("/api/admin/users"), enabled: !!token });
  const audit = useQuery({ queryKey: ["admin", "audit"], queryFn: () => api.get<AuditRow[]>("/api/admin/audit"), enabled: !!token });
  const o = overview.data;
  const jobRows = jobs.data ? [...jobs.data.analysis.map((j) => ({ ...j, kind: "AI analysis" })), ...jobs.data.render.map((j) => ({ ...j, kind: "Render" }))] : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-md text-muted-foreground">Operations, jobs, users and audit trail.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {overview.isLoading ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />) : o && (
          <>
            <Stat icon={FolderKanban} label="Projects" value={o.projects_total} tint="bg-primary/10 text-primary" />
            <Stat icon={Users} label="Users" value={o.users} tint="bg-indigo-500/10 text-indigo-600" />
            <Stat icon={Sparkles} label="AI analyses" value={o.analysis_jobs} tint="bg-purple-500/10 text-purple-600" />
            <Stat icon={Film} label="Renders" value={o.render_jobs} tint="bg-pink-500/10 text-pink-600" />
            <Stat icon={FileImage} label="Files" value={o.uploaded_files} tint="bg-emerald-500/10 text-emerald-600" />
          </>
        )}
      </div>

      <Tabs defaultValue="jobs">
        <TabsList>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs">
          <Card className="overflow-hidden p-0">
            <div className="overflow-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-surface-2/50"><tr><Th>Type</Th><Th>ID</Th><Th>Project</Th><Th>Status</Th><Th>Detail</Th></tr></thead>
                <tbody className="divide-y divide-border">
                  {jobRows.map((r, i) => (
                    <tr key={i} className="transition-colors hover:bg-secondary/50">
                      <Td className="font-medium">{r.kind}</Td><Td className="font-mono text-muted-foreground">#{r.id}</Td><Td className="font-mono text-muted-foreground">#{r.project_id}</Td>
                      <Td><StatusBadge status={(r.status === "done" ? "completed" : r.status === "failed" ? "failed" : "generating_3d") as ProjectStatus} /></Td>
                      <Td className="text-muted-foreground">{r.model_version || r.ratio || "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="users">
          <Card className="overflow-hidden p-0"><div className="overflow-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-surface-2/50"><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Verified</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {(users.data ?? []).map((u) => (
                  <tr key={u.id} className="transition-colors hover:bg-secondary/50">
                    <Td className="font-medium">{u.name}</Td><Td className="text-muted-foreground">{u.email}</Td>
                    <Td className="capitalize">{u.role.replace(/_/g, " ")}</Td><Td>{u.verified ? "✅" : "—"}</Td><Td className="capitalize text-muted-foreground">{u.status}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card className="overflow-hidden p-0"><div className="overflow-auto">
            <table className="w-full">
              <thead className="border-b border-border bg-surface-2/50"><tr><Th>When</Th><Th>Action</Th><Th>Object</Th><Th>Actor</Th><Th>Result</Th></tr></thead>
              <tbody className="divide-y divide-border">
                {(audit.data ?? []).map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-secondary/50">
                    <Td className="text-muted-foreground">{new Date(e.at).toLocaleString()}</Td><Td className="font-medium">{e.action}</Td>
                    <Td className="font-mono text-muted-foreground">{e.object}</Td><Td className="text-muted-foreground">#{e.actor_id ?? "—"}</Td><Td className="text-muted-foreground">{e.result}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
