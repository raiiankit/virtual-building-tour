import { cn } from "@/lib/utils";
import { initials } from "@/lib/utils";

export function Avatar({ name, className, size = "md" }: { name?: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const s = size === "sm" ? "size-7 text-xs" : size === "lg" ? "size-11 text-base" : "size-9 text-sm";
  return (
    <span className={cn("inline-grid place-items-center rounded-full bg-gradient-to-br from-primary to-blue-400 font-semibold text-white shadow-sm", s, className)}>
      {initials(name)}
    </span>
  );
}
