"use client";

import { RotateCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CorpusStats } from "@/lib/types";

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {accent ? <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" /> : null}
      <span className="font-mono text-sm tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// Corpus size / seed / learned counters + the learning-loop lever. The "learned"
// (approved) count is the live signal — it ticks up as analysts approve posts.
export function CorpusStatsBar({
  stats,
  onRescore,
  rescoring,
}: {
  stats: CorpusStats | undefined;
  onRescore: () => void;
  rescoring?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2"
        aria-live="polite"
      >
        <Stat label="vectors" value={stats?.size ?? "—"} />
        <span className="text-border" aria-hidden="true">
          |
        </span>
        <Stat label="seed" value={stats?.seed ?? "—"} />
        <span className="text-border" aria-hidden="true">
          |
        </span>
        <Stat label="learned" value={stats?.approved ?? "—"} accent />
      </div>

      <Button onClick={onRescore} disabled={rescoring} size="sm">
        <RotateCwIcon className={cn(rescoring && "animate-spin")} aria-hidden="true" />
        {rescoring ? "Re-evaluating…" : "Re-evaluate against learned terms"}
      </Button>
    </div>
  );
}
