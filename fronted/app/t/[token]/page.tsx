"use client";

/**
 * Public, no-auth shared tour — /t/{token}.
 * Anyone with the link (or the QR code) walks the building. Data comes from the public
 * `GET /api/tour/shared/{token}` endpoint; nothing here requires a session. This is what
 * makes "Publish tour", the embed snippet and the QR code actually reach the outside world.
 */
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BuildingLoader } from "@/components/ui/building-loader";

const Viewer3D = dynamic(() => import("@/features/viewer3d/viewer3d"), { ssr: false });

type SharedTour = {
  branding?: { title?: string } | null;
  asset_url: string | null;
  scene_url: string | null;
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-screen w-screen place-items-center bg-slate-900 text-center text-white/80">
      <div className="space-y-3 px-6">{children}</div>
    </div>
  );
}

export default function PublicTour() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useQuery<SharedTour>({
    queryKey: ["shared-tour", token],
    queryFn: async () => {
      const res = await fetch(`/api/tour/shared/${token}`);
      if (!res.ok) throw new Error("unavailable");
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  if (isLoading) return <Centered><BuildingLoader light /></Centered>;

  if (isError || !data?.asset_url) {
    return (
      <Centered>
        <Building2 className="mx-auto size-10 text-white/40" />
        <p className="text-sm">This tour isn’t available.</p>
        <p className="text-xs text-white/50">The link may be private or expired.</p>
      </Centered>
    );
  }

  const title = data.branding?.title || "Virtual Building Tour";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative h-screen w-screen overflow-hidden bg-slate-900">
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-lg bg-slate-900/70 px-4 py-1.5 text-center backdrop-blur">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-[10px] uppercase tracking-wide text-white/50">Interactive 3D tour</div>
        </div>
        <Viewer3D assetUrl={data.asset_url} sceneUrl={data.scene_url} heightClass="h-screen" />
        <a
          href="/"
          className="absolute bottom-3 right-3 z-20 rounded-md bg-slate-900/60 px-2.5 py-1 text-[10px] text-white/60 backdrop-blur transition-colors hover:text-white/90"
        >
          Powered by Virtual Building Tour
        </a>
      </div>
    </TooltipProvider>
  );
}
