"use client";

// R1 — the live "operative → detector" learning ticker. Every confirmed bust that
// teaches the corpus appears here: "@handle taught the detector 'X' → N re-flagged".
// This is the visible proof of the closed loop ("it gets smarter every bust").
import { BrainCircuitIcon } from "lucide-react";

import { useFieldIntel } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { FieldIntelEvent } from "@/lib/types";

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

function TickerRow({ event }: { event: FieldIntelEvent }) {
  const terms = event.terms.slice(0, 4);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm">
      <span className="font-mono text-xs text-muted-foreground">{relativeTime(event.at)}</span>
      <span className="text-muted-foreground">@{event.handle} taught the detector</span>
      {terms.map((term) => (
        <code
          key={term}
          className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary"
        >
          {term}
        </code>
      ))}
      {event.newlyFlagged > 0 ? (
        <span className="font-medium text-foreground">
          → {event.newlyFlagged} post{event.newlyFlagged === 1 ? "" : "s"} re-flagged
        </span>
      ) : (
        <span className="text-muted-foreground">→ corpus updated</span>
      )}
    </li>
  );
}

export function FieldIntelTicker({ className, limit = 5 }: { className?: string; limit?: number }) {
  const { data } = useFieldIntel();
  const events = data?.events?.slice(0, limit) ?? [];
  if (events.length === 0) return null;

  return (
    <section
      className={cn("rounded-lg border bg-card px-4 py-3", className)}
      aria-live="polite"
      aria-label="Field-intelligence learning feed"
    >
      <div className="mb-1.5 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
        <BrainCircuitIcon className="size-3.5 text-primary" aria-hidden="true" />
        Field intel — the detector learns from every bust
      </div>
      <ul className="divide-y divide-border/60">
        {events.map((event) => (
          <TickerRow key={event.id} event={event} />
        ))}
      </ul>
    </section>
  );
}
