"use client";

import { useMemo } from "react";
import type { PlanPreview } from "@/hooks";

// soft fills per room type — reads as a real colour-coded floor plan at thumbnail size
const COLORS: Record<string, string> = {
  living_room: "#dbeafe", bedroom: "#e0e7ff", master_bedroom: "#c7d2fe",
  kitchen: "#fef3c7", dining: "#fde68a", bathroom: "#cffafe", garage: "#e5e7eb",
  foyer: "#eef2ff", balcony: "#dcfce7", utility: "#f1f5f9", office: "#ede9fe",
  corridor: "#f8fafc", staircase: "#fee2e2", room: "#eef2f7",
};

/** Top-down floor-plan thumbnail drawn from the generated ground-floor rooms — no
 *  WebGL, so it scales to a whole dashboard of cards cheaply. */
export function PlanThumbnail({ preview }: { preview: PlanPreview }) {
  const rooms = useMemo(() => [...preview.rooms].sort((a, b) => b.w * b.d - a.w * a.d), [preview.rooms]); // big first, small on top
  const box = useMemo(() => {
    if (!rooms.length) return null;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of rooms) { x0 = Math.min(x0, r.x - r.w / 2); z0 = Math.min(z0, r.z - r.d / 2); x1 = Math.max(x1, r.x + r.w / 2); z1 = Math.max(z1, r.z + r.d / 2); }
    return { x0, z0, w: x1 - x0, h: z1 - z0 };
  }, [rooms]);
  if (!box || box.w <= 0 || box.h <= 0) return null;

  const W = 220, H = 132, pad = 10;
  const s = Math.min((W - 2 * pad) / box.w, (H - 2 * pad) / box.h);
  const ox = (W - box.w * s) / 2, oy = (H - box.h * s) / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Floor plan preview">
      {rooms.map((r, i) => (
        <rect key={i}
          x={ox + (r.x - r.w / 2 - box.x0) * s} y={oy + (r.z - r.d / 2 - box.z0) * s}
          width={r.w * s} height={r.d * s} rx={1.5}
          fill={COLORS[r.type] ?? COLORS.room} stroke="#94a3b8" strokeWidth={1.1} />
      ))}
    </svg>
  );
}
