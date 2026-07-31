"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const dark = resolvedTheme === "dark";
  return (
    <Hint label={dark ? "Light mode" : "Dark mode"}>
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onClick={() => setTheme(dark ? "light" : "dark")}>
        {mounted && dark ? <Moon className="size-[18px]" /> : <Sun className="size-[18px]" />}
      </Button>
    </Hint>
  );
}
