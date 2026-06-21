import type { Metadata } from "next";

import { MemoryClient } from "@/components/memory/memory-client";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Operative Memory",
  description: "Redis Iris agent memory — what the operative has learned across operations.",
};

export default function MemoryPage() {
  return (
    <>
      <TopNav />
      <MemoryClient />
    </>
  );
}
