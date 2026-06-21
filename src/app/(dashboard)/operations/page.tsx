// Operations index — jumps to the most recent operation if one exists, otherwise
// explains how to launch one from the detection queue.
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TargetIcon } from "lucide-react";

import { getLatestOperationId } from "@/lib/agents/operation-store";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const latest = await getLatestOperationId().catch(() => null);
  if (latest) redirect(`/operations/${latest}`);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-20 text-center">
        <TargetIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">No operations yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Launch an undercover operative from a flagged lead in the{" "}
            <Link href="/dashboard" className="underline underline-offset-2 hover:text-foreground">
              detection queue
            </Link>{" "}
            — use the <span className="font-medium">Engage</span> action. Contact is limited to the
            demo accounts on the operative allowlist.
          </p>
        </div>
      </div>
    </main>
  );
}
