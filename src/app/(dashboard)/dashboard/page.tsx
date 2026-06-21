// WT-A dashboard route — thin server component. All interactivity (data fetching,
// filters, mutations) lives in <DashboardClient />, a client component.
import type { Metadata } from "next";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <DashboardClient />;
}
