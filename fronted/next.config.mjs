/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,                 // don't advertise the framework
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  async rewrites() {
    // Proxy the existing FastAPI backend so the frontend talks to it with no
    // CORS and no API-contract changes; the Three.js viewer + assets proxy too.
    return [
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/files/:path*", destination: `${BACKEND}/files/:path*` },
    ];
  },
  async headers() {
    // Baseline production security headers (no strict CSP — it would need careful
    // tuning for WebGL/blob workers and could silently break the 3D viewer).
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-DNS-Prefetch-Control", value: "on" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }];
  },
};

export default nextConfig;
