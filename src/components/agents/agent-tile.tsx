import { ExternalLinkIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentRecord, AgentStatus } from "@/lib/types";

// Status → label + token styling + whether it's a "live/working" state (drives the
// pulsing dot). Color is never the only signal: a text label and the dot shape are
// always present, and the badge has a title for hover.
const STATUS_META: Record<
  AgentStatus,
  { label: string; className: string; live: boolean }
> = {
  starting: { label: "Starting", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  loading: { label: "Loading", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  browsing: { label: "Browsing", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  extracting: { label: "Extracting", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  ingesting: { label: "Scoring", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  captcha: { label: "Checkpoint", className: "border-chart-2/30 bg-chart-2/15 text-chart-2", live: false },
  blocked: { label: "Blocked", className: "border-destructive/30 bg-destructive/15 text-destructive", live: false },
  error: { label: "Error", className: "border-destructive/30 bg-destructive/15 text-destructive", live: false },
  done: { label: "Done", className: "border-transparent bg-muted text-muted-foreground", live: false },
  stopped: { label: "Stopped", className: "border-transparent bg-muted text-muted-foreground", live: false },
};

function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5", meta.className)} title={meta.label}>
      <span
        className={cn("size-1.5 rounded-full bg-current", meta.live && "motion-safe:animate-pulse")}
        aria-hidden="true"
      />
      {meta.label}
    </Badge>
  );
}

export function AgentTile({ agent }: { agent: AgentRecord }) {
  const needsTakeover = agent.status === "captcha" || agent.status === "blocked";
  // Always render the frame when we have a URL — even a terminal agent shows its
  // last paint, which reads better than an empty tile.
  const hasView = Boolean(agent.liveViewUrl);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card ring-1 ring-foreground/5">
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-xs font-medium">{agent.name}</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            #{agent.target}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {agent.postsFound} {agent.postsFound === 1 ? "lead" : "leads"}
          </span>
          <AgentStatusBadge status={agent.status} />
        </div>
      </header>

      <div className="relative aspect-[16/10] w-full bg-muted/40">
        {hasView ? (
          <iframe
            src={agent.liveViewUrl}
            title={`${agent.name} live browser — #${agent.target}`}
            sandbox="allow-same-origin allow-scripts"
            loading="lazy"
            className="absolute inset-0 size-full"
            style={{ pointerEvents: "none" }} // read-only embed (Browserbase guidance)
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted-foreground">
            Waiting for browser…
          </div>
        )}

        {needsTakeover ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-background/85 px-3 py-2 backdrop-blur">
            <span className="min-w-0 truncate text-xs text-foreground">
              {agent.status === "captcha" ? "Checkpoint hit" : "Blocked by login wall"}
            </span>
            <Button
              variant="outline"
              size="xs"
              nativeButton={false}
              render={
                <a href={agent.liveViewUrl} target="_blank" rel="noreferrer noopener" />
              }
            >
              Take over
              <ExternalLinkIcon aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>

      <footer className="min-w-0 px-3 py-2">
        <p className="truncate text-xs text-muted-foreground" title={agent.currentAction}>
          {agent.currentAction || "—"}
        </p>
        {agent.error ? (
          <p className="mt-0.5 truncate text-xs text-destructive" title={agent.error}>
            {agent.error}
          </p>
        ) : null}
      </footer>
    </article>
  );
}
