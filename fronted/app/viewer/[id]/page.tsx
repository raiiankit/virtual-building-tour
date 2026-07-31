"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Loader2, ArrowLeft } from "lucide-react";
import { useModel } from "@/hooks";
import { useAuthStore } from "@/store";
import { TooltipProvider } from "@/components/ui/tooltip";

// full-screen, chrome-less 3D viewer (opened in a new tab from "Open full 3D" / "3D Tour")
const Viewer3D = dynamic(() => import("@/features/viewer3d/viewer3d"), { ssr: false });

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-screen w-screen place-items-center bg-slate-900 text-center text-white/80">
      <div className="space-y-2 px-6">{children}</div>
    </div>
  );
}

export default function FullscreenViewer() {
  const params = useParams<{ id: string }>();
  const pid = Number(params.id);
  const token = useAuthStore((s) => s.token);
  const model = useModel(pid);

  if (!token) return <Centered><p className="text-sm">Please sign in to view this 3D tour.</p><Link href="/login" className="text-sm text-primary underline">Sign in</Link></Centered>;
  if (model.isLoading) return <Centered><Loader2 className="size-8 animate-spin" /></Centered>;
  if (model.isError || !model.data?.asset_url) return <Centered><p className="text-sm">No 3D model is available for this project yet.</p><Link href={`/projects/${pid}?tab=model`} className="text-sm text-primary underline">Open the project</Link></Centered>;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative h-screen w-screen overflow-hidden bg-slate-900">
        <Link href={`/projects/${pid}?tab=model`} className="absolute left-1/2 top-4 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-lg bg-slate-900/70 px-3 py-1.5 text-sm text-white backdrop-blur transition-colors hover:bg-slate-800">
          <ArrowLeft className="size-4" /> Back to project
        </Link>
        <Viewer3D assetUrl={model.data.asset_url} sceneUrl={model.data.scene_url} heightClass="h-screen" />
      </div>
    </TooltipProvider>
  );
}
