import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stagehand is a heavy Node-only library (CDP/browser tooling) used by the
  // /api/scrape route. Keep it external so Next never bundles it for the server.
  serverExternalPackages: ["@browserbasehq/stagehand"],
};

export default nextConfig;
