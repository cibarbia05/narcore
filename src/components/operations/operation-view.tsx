"use client";

// Full-page operative war room (/operations/[id]): page chrome (back-link) around the
// embeddable <OperationPanel>, which carries the live browser, transcript, status chips,
// and report export. The same panel is reused inline in the Command Center.
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

import type { Operation } from "@/lib/types";
import { OperationPanel } from "./operation-panel";

export function OperationView({
  operationId,
  initial,
}: {
  operationId: string;
  initial: Operation;
}) {
  return (
    <main className="mx-auto max-w-[100rem] space-y-6 px-6 py-10">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Back to detection queue
      </Link>

      <OperationPanel operationId={operationId} initial={initial} />
    </main>
  );
}
