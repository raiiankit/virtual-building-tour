"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Search, LogOut, User2, Settings } from "lucide-react";
import { Fragment } from "react";
import { useAuthStore, useHeader } from "@/store";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { Notifications } from "./notifications";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function AppTopbar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const crumbs = useHeader((s) => s.crumbs);
  const me = useAuthStore((s) => s.me);
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border glass px-5">
      <nav className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        {crumbs.length === 0 && <span className="text-muted-foreground">Dashboard</span>}
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />}
            {c.href ? (
              <Link href={c.href} className="truncate text-muted-foreground transition-colors hover:text-foreground">{c.label}</Link>
            ) : (
              <span className="truncate text-foreground">{c.label}</span>
            )}
          </Fragment>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={onOpenCommand}
          className="hidden h-9 w-64 items-center gap-2.5 rounded-lg border border-border bg-surface-2 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 md:flex">
          <Search className="size-4" />
          <span>Search everything…</span>
          <kbd className="ml-auto rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </button>
        <ThemeToggle />
        <Notifications />

        <DropdownMenu>
          <DropdownMenuTrigger className="ml-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar name={me?.full_name} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <div className="flex items-center gap-3 px-2 py-2">
              <Avatar name={me?.full_name} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{me?.full_name}</div>
                <div className="truncate text-xs text-muted-foreground">{me?.email}</div>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{me?.role?.replace(/_/g, " ")}</DropdownMenuLabel>
            <DropdownMenuItem><User2 /> Profile</DropdownMenuItem>
            <DropdownMenuItem><Settings /> Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => { logout(); router.push("/login"); }}>
              <LogOut /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
