/** Pure config (no three.js) — safe to import in UI without pulling the 3D bundle. */
export const RESOLUTIONS = {
  "1080p-landscape": { w: 1920, h: 1080, label: "Landscape · 1080p", ar: "16:9" },
  "1080p-portrait": { w: 1080, h: 1920, label: "Portrait · 1080p", ar: "9:16" },
  "1080p-square": { w: 1080, h: 1080, label: "Square · 1080p", ar: "1:1" },
  "720p-landscape": { w: 1280, h: 720, label: "Landscape · 720p", ar: "16:9" },
  "4k-landscape": { w: 3840, h: 2160, label: "Landscape · 4K", ar: "16:9" },
} as const;
export type ResolutionKey = keyof typeof RESOLUTIONS;

export const QUALITY = { draft: 5_000_000, standard: 10_000_000, high: 18_000_000, ultra: 28_000_000 } as const;
export type QualityKey = keyof typeof QUALITY;

export const CAMERA_STYLES = [
  { key: "cinematic", label: "Cinematic" },
  { key: "architect", label: "Architect Walkthrough" },
  { key: "drone", label: "Drone Orbit" },
  { key: "interior", label: "Interior Tour" },
  { key: "quick", label: "Quick Tour" },
  { key: "luxury", label: "Luxury Tour" },
  { key: "realestate", label: "Real Estate Tour" },
] as const;
export type CameraStyle = (typeof CAMERA_STYLES)[number]["key"];
