"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { OperationMessage } from "@/lib/types";

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** A read-only RECORD of the negotiation (not a chat you type into): each entry is
 *  attributed to the operative or the seller, with a timestamp. Auto-scrolls to the
 *  newest entry. */
export function OperationTranscript({
  handle,
  messages,
}: {
  handle: string;
  messages: OperationMessage[];
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <p className="grid h-full place-content-center text-sm text-muted-foreground">
        No messages recorded yet…
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m, i) => {
        const operative = m.role === "operative";
        return (
          <li key={i} className="flex flex-col gap-0.5">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className={cn(
                  "font-mono text-[11px] font-medium tracking-wide uppercase",
                  operative ? "text-primary" : "text-foreground",
                )}
              >
                {operative ? "Operative" : `@${handle}`}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                {timeOf(m.at)}
              </span>
            </div>
            <p
              className={cn(
                "rounded-md border-l-2 px-2.5 py-1.5 text-sm break-words whitespace-pre-wrap",
                operative ? "border-primary/50 bg-primary/5" : "border-border bg-muted/40",
              )}
            >
              {m.text}
            </p>
          </li>
        );
      })}
      <div ref={endRef} />
    </ol>
  );
}
