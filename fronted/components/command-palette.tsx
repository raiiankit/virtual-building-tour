"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Search, LayoutGrid, Plus, Shield, Sun, Moon, Box, CornerDownLeft, Building2, Home } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useProjects } from "@/hooks";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/constants";

type Item = { id: string; label: string; hint?: string; icon: typeof Search; run: () => void; group: string };

export function CommandPalette({ open, onOpenChange, onNewProject }: { open: boolean; onOpenChange: (v: boolean) => void; onNewProject: () => void }) {
  const router = useRouter();
  const { setTheme, resolvedTheme } = useTheme();
  const { data: projects = [] } = useProjects();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  const items: Item[] = useMemo(() => {
    const go = (href: string) => () => { onOpenChange(false); router.push(href); };
    const nav: Item[] = [
      { id: "home", label: "Go to Home", icon: Home, run: go("/"), group: "Navigation" },
      { id: "projects", label: "All projects", icon: LayoutGrid, run: go("/projects"), group: "Navigation" },
      { id: "admin", label: "Open Admin", icon: Shield, run: go("/admin"), group: "Navigation" },
      { id: "new", label: "Create new project", hint: "N", icon: Plus, run: () => { onOpenChange(false); onNewProject(); }, group: "Actions" },
      { id: "theme", label: `Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`, icon: resolvedTheme === "dark" ? Sun : Moon, run: () => { setTheme(resolvedTheme === "dark" ? "light" : "dark"); }, group: "Actions" },
    ];
    const proj: Item[] = projects.map((p) => ({
      id: `p${p.id}`, label: p.name, hint: STATUS_META[p.status]?.label, icon: p.building_type === "villa" ? Home : Building2,
      run: go(`/projects/${p.id}`), group: "Projects",
    }));
    return [...nav, ...proj];
  }, [projects, resolvedTheme, router, setTheme, onOpenChange, onNewProject]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((it) => it.label.toLowerCase().includes(s));
  }, [items, q]);

  useEffect(() => { setActive(0); }, [q, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search projects, actions, navigation…"
            className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground" />
          <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">ESC</kbd>
        </div>
        <div className="max-h-[52vh] overflow-auto p-2">
          {filtered.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{q}”.</div>}
          {filtered.map((it, i) => {
            const header = it.group !== lastGroup ? ((lastGroup = it.group)) : null;
            return (
              <div key={it.id}>
                {header && <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{header}</div>}
                <button
                  onMouseEnter={() => setActive(i)} onClick={it.run}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors", i === active ? "bg-primary/10 text-primary" : "hover:bg-secondary")}
                >
                  <it.icon className={cn("size-4", i === active ? "text-primary" : "text-muted-foreground")} />
                  <span className="flex-1 truncate font-medium">{it.label}</span>
                  {it.hint && <span className="text-xs text-muted-foreground">{it.hint}</span>}
                  {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Box className="size-3" /> Command menu</span>
          <span className="ml-auto flex items-center gap-2"><kbd className="rounded border border-border px-1">↑↓</kbd> navigate <kbd className="rounded border border-border px-1">↵</kbd> select</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
