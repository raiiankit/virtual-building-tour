"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-surface px-3.5 py-2 text-base text-foreground shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

/** Floating-label field — reusable form control. */
export function FloatingField({
  label, id, className, ...props
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn("relative", className)}>
      <input
        id={id}
        placeholder=" "
        className="peer flex h-12 w-full rounded-md border border-input bg-surface px-3.5 pt-4 pb-1 text-base shadow-xs transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25"
        {...props}
      />
      <label
        htmlFor={id}
        className="pointer-events-none absolute left-3.5 top-1.5 text-xs font-medium text-muted-foreground transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-base peer-placeholder-shown:font-normal peer-focus:top-1.5 peer-focus:text-xs peer-focus:font-medium peer-focus:text-primary"
      >
        {label}
      </label>
    </div>
  );
}
