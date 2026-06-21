"use client";

// B2 — war-room "identity match" badge. Shows the browser fingerprint the operative
// runs under and whether it still matches what each login context was logged in
// under. A mismatch (or unpinned default) is the #1 cause of a mid-demo checkpoint,
// so it's surfaced where the operator will see it.
import { ShieldCheckIcon, ShieldAlertIcon, ShieldQuestionIcon } from "lucide-react";

import { useSessionIdentity } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { IdentityMatch } from "@/lib/types";

function aggregate(matches: IdentityMatch[]): IdentityMatch {
  if (matches.length === 0) return "unknown";
  if (matches.some((m) => m === "mismatch")) return "mismatch";
  if (matches.every((m) => m === "ok")) return "ok";
  return "unknown";
}

const TONE: Record<IdentityMatch, { icon: typeof ShieldCheckIcon; label: string; cls: string }> = {
  ok: { icon: ShieldCheckIcon, label: "identity match: OK", cls: "text-primary" },
  mismatch: {
    icon: ShieldAlertIcon,
    label: "identity mismatch — re-run ig:login",
    cls: "text-destructive",
  },
  unknown: {
    icon: ShieldQuestionIcon,
    label: "identity not yet recorded",
    cls: "text-muted-foreground",
  },
};

export function SessionIdentityBadge({ className }: { className?: string }) {
  const { data } = useSessionIdentity();
  if (!data) return null;

  const status = aggregate(data.contexts.map((c) => c.match));
  const { icon: Icon, label, cls } = TONE[status];
  const id = data.current;
  const chips = [
    id.os ?? "os: default",
    id.region,
    `proxy ${id.proxyCountry}`,
    `${id.viewport.width}×${id.viewport.height}`,
    id.verified ? "verified" : null,
    id.advancedStealth ? "stealth+" : null,
  ].filter(Boolean) as string[];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-card px-3 py-2 text-sm",
        className,
      )}
      aria-live="polite"
    >
      <span className={cn("inline-flex items-center gap-1.5 font-medium", cls)}>
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </span>
      <span className="text-border" aria-hidden="true">
        |
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <code
            key={chip}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
          >
            {chip}
          </code>
        ))}
      </div>
    </div>
  );
}
