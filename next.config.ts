import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stagehand + the Browserbase SDK are heavy Node-only libraries (CDP/browser
  // tooling) used by the /api/scrape and /api/agents routes. Keep them external
  // so Next never bundles them for the server.
  serverExternalPackages: ["@browserbasehq/stagehand", "@browserbasehq/sdk"],
};

export default nextConfig;
