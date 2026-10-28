import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // site/ has its own lockfile; keep Turbopack from treating the repo root as the workspace.
  turbopack: { root: __dirname },
  output: "export",
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
