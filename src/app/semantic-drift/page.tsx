import type { Metadata } from "next";

import { SemanticDriftClient } from "@/components/semantic-drift/semantic-drift-client";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Semantic Drift",
  description: "Redis vector-space visualization for Narcore.",
};

export default function SemanticDriftPage() {
  return (
    <>
      <TopNav />
      <SemanticDriftClient />
    </>
  );
}
