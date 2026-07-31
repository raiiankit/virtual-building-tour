"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { PanelLeftClose, PanelLeft, Plus, Boxes, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, APP_NAME } from "@/constants";
import { useUIStore, useAuthStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

export function AppSidebar({ onNewProject, onOpenCommand }: { onNewProject: () => void; onOpenCommand: () => void }) {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const me = useAuthStore((s) => s.me);
  const pathname = usePathname();
  const isAdmin = me?.role === "company_admin" || me?.role === "super_admin";

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 76 : 248 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-border bg-surface"
    >
      <div className={cn("flex h-16 items-center gap-2.5 px-4", collapsed && "justify-center px-0")}>
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-blue-400 text-white shadow-glow">
          <Boxes className="size-5" />
        </div>
        {!collapsed && <span className="truncate text-[15px] font-bold tracking-tight">{APP_NAME}</span>}
      </div>

      <div className={cn("px-3", collapsed && "px-2")}>
        {collapsed ? (
          <Hint label="New project">
            <Button size="icon" className="w-full" onClick={onNewProject} aria-label="New project"><Plus /></Button>
          </Hint>
        ) : (
          <Button className="w-full" onClick={onNewProject}><Plus /> New project</Button>
        )}
      </div>

      {!collapsed && (
        <button onClick={onOpenCommand} className="mx-3 mt-2 flex items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40">
          <Search className="size-4" /> Search
          <kbd className="ml-auto rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
      )}

      <nav className="mt-4 flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin).map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const link = (
            <Link
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                collapsed && "justify-center px-0",
                active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              <item.icon className={cn("size-[18px] shrink-0", active && "text-primary")} />
              {!collapsed && item.label}
            </Link>
          );
          return collapsed ? <Hint key={item.key} label={item.label}>{link}</Hint> : <div key={item.key}>{link}</div>;
        })}
      </nav>

      <div className="border-t border-border p-3">
        <Button variant="ghost" size={collapsed ? "icon" : "sm"} className={cn("w-full text-muted-foreground", !collapsed && "justify-start")} onClick={toggle} aria-label="Collapse sidebar">
          {collapsed ? <PanelLeft className="size-[18px]" /> : <><PanelLeftClose className="size-[18px]" /> Collapse</>}
        </Button>
      </div>
    </motion.aside>
  );
}
