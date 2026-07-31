"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/hooks";
import { api } from "@/services/api";
import { relativeDate, cn } from "@/lib/utils";

export function Notifications() {
  const { data = [] } = useNotifications();
  const unread = data.filter((n) => !n.read).length;
  const router = useRouter();
  const qc = useQueryClient();

  const markRead = async (id: number, projectId: number | null) => {
    await api.post(`/api/notifications/${id}/read`).catch(() => {});
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (projectId) router.push(`/projects/${projectId}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" aria-label="Notifications">
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && <span className="text-xs text-muted-foreground">{unread} unread</span>}
        </div>
        <div className="max-h-[60vh] overflow-auto p-1.5">
          {data.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
              <CheckCheck className="size-6 text-muted-foreground/60" />
              You&apos;re all caught up
            </div>
          )}
          {data.map((n) => (
            <button
              key={n.id}
              onClick={() => markRead(n.id, n.project_id)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-secondary",
                !n.read && "bg-primary/[0.05]"
              )}
            >
              <span className="text-sm font-medium leading-snug">{n.message}</span>
              <span className="text-xs text-muted-foreground">{relativeDate(n.created_at)} · {n.type.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
