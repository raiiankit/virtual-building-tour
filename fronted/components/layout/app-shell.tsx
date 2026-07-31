"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuthStore } from "@/store";
import { AppSidebar } from "./app-sidebar";
import { AppTopbar } from "./app-topbar";
import { NewProjectWizard } from "@/features/projects/new-project-wizard";
import { CommandPalette } from "@/components/command-palette";

export function AppShell({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  const [mounted, setMounted] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const router = useRouter();

  useEffect(() => setMounted(true), []);
  useEffect(() => { if (mounted && !token) router.replace("/login"); }, [mounted, token, router]);
  // Mirror the JWT into the key the embedded Three.js viewer (viewer.html) reads,
  // so the iframed 3D viewer authenticates against the same backend.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (token) localStorage.setItem("vbt_token", token);
    else localStorage.removeItem("vbt_token");
  }, [token]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!mounted || !token) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background">
        <AppSidebar onNewProject={() => setWizardOpen(true)} onOpenCommand={() => setCmdOpen(true)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar onOpenCommand={() => setCmdOpen(true)} />
          <main className="flex-1 px-6 py-8 lg:px-10">
            <div className="mx-auto w-full max-w-[1400px]">{children}</div>
          </main>
        </div>
      </div>
      <NewProjectWizard open={wizardOpen} onOpenChange={setWizardOpen} />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} onNewProject={() => setWizardOpen(true)} />
    </TooltipProvider>
  );
}
