import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Boxes } from "lucide-react";
import { JsonModelViewer } from "@/features/json-model/json-model-viewer";

export const metadata: Metadata = {
  title: "JSON → 3D Model — Virtual Building Tour",
  description: "Paste a JSON room layout and render an ultra-realistic, fully furnished 3D building — entirely client-side.",
};

export default function JsonModelPage() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> Dashboard
        </Link>
        <div className="h-5 w-px bg-border" />
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <Boxes className="size-4 text-primary" /> JSON → 3D Model
        </div>
      </header>
      <div className="min-h-0 flex-1">
        <JsonModelViewer />
      </div>
    </div>
  );
}
