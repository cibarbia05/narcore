import { CheckCircle2Icon, CircleDashedIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Operation } from "@/lib/types";

function Chip({ ok, label, value }: { ok: boolean; label: string; value?: string | null }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 px-2.5 py-1 text-xs",
        ok ? "border-primary/40 bg-primary/15 text-primary" : "text-muted-foreground",
      )}
    >
      {ok ? (
        <CheckCircle2Icon className="size-3.5" aria-hidden="true" />
      ) : (
        <CircleDashedIcon className="size-3.5" aria-hidden="true" />
      )}
      <span className="font-medium">{label}</span>
      {ok && value ? <span className="font-normal opacity-90">· {value}</span> : null}
    </Badge>
  );
}

/** The two headline objectives (plus time, once known) — flip live as the brain
 *  re-reads the conversation after each exchange. */
export function OperationStatusChips({ operation }: { operation: Operation }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Chip ok={operation.dealConfirmed} label="Deal" />
      <Chip ok={operation.locationConfirmed} label="Location" value={operation.meetingLocation} />
      {operation.meetingTime ? <Chip ok label="Time" value={operation.meetingTime} /> : null}
    </div>
  );
}
