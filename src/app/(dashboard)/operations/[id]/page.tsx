// One operation's live war-room view. Fetches the initial state server-side (so the
// page paints without a flash) and hands off to the polling client view.
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getOperation } from "@/lib/agents/operation-store";
import { OperationView } from "@/components/operations/operation-view";

export const metadata: Metadata = { title: "Operation" };
export const dynamic = "force-dynamic";

export default async function OperationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const operation = await getOperation(id);
  if (!operation) notFound();
  return <OperationView operationId={id} initial={operation} />;
}
