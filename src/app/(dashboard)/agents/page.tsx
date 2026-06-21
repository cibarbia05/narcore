// Live agents ("War Room") route — thin server component. All interactivity
// (launch/stop, polling, live-view tiles) lives in <AgentsClient />.
import type { Metadata } from "next";
import { AgentsClient } from "@/components/agents/agents-client";

export const metadata: Metadata = { title: "Live Agents" };

export default function AgentsPage() {
  return <AgentsClient />;
}
