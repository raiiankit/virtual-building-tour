"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Turns wait time into a little delight — narrates the build like a site foreman.
const MESSAGES = [
  "Reading your walls…", "Detecting rooms…", "Measuring dimensions…",
  "Cutting door openings…", "Hanging the doors…", "Glazing the windows…",
  "Pouring the floor slab…", "Raising the walls…", "Fitting the balcony railing…",
  "Casting soft shadows…", "Finishing the floors…", "Almost handover-ready…",
];

export function BuildingLoader({ className, light = false }: { className?: string; light?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % MESSAGES.length), 1500);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <Loader2 className={cn("size-8 animate-spin", light ? "text-white" : "text-primary")} />
      <span className={cn("text-sm font-medium transition-all duration-300", light ? "text-white/85" : "text-muted-foreground")}>
        {MESSAGES[i]}
      </span>
    </div>
  );
}
