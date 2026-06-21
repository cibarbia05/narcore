import {
  CheckCircle2Icon,
  LockIcon,
  ShieldAlertIcon,
  TriangleAlertIcon,
  SquareIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AGENT_TERMINAL_STATUSES, type AgentRecord, type AgentStatus } from "@/lib/types";

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

// What the clean panel shows once the live browser disconnects (terminal states).
// Keeps the ugly Browserbase "Reconnect DevTools" dialog from ever showing.
const TERMINAL_PANEL: Partial<
  Record<AgentStatus, { icon: LucideIcon; tone: string; title: (a: AgentRecord) => string; hint: string }>
> = {
  done: {
    icon: CheckCircle2Icon,
    tone: "text-muted-foreground",
    title: (a) => `Finished — ${a.postsFound} ${a.postsFound === 1 ? "lead" : "leads"}`,
    hint: "Scored leads are in the detection queue.",
  },
  blocked: {
    icon: LockIcon,
    tone: "text-destructive",
    title: () => "Blocked by login wall",
    hint: "This account isn't logged in — run `pnpm ig:login`, then `pnpm ig:verify`.",
  },
  captcha: {
    icon: ShieldAlertIcon,
    tone: "text-chart-2",
    title: () => "Checkpoint hit",
    hint: "Instagram asked to verify — log this account in again via `pnpm ig:login`.",
  },
  error: {
    icon: TriangleAlertIcon,
    tone: "text-destructive",
    title: () => "Agent error",
    hint: "See the dev-server logs for details.",
  },
  stopped: {
    icon: SquareIcon,
    tone: "text-muted-foreground",
    title: () => "Stopped",
    hint: "Run was stopped by the operator.",
  },
};

function AgentStatusBadge({ status, dense = false }: { status: AgentStatus; dense?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5", dense && "px-1.5", meta.className)}
      title={meta.label}
    >
      <span
        className={cn("size-1.5 rounded-full bg-current", meta.live && "motion-safe:animate-pulse")}
        aria-hidden="true"
      />
      {/* In dense mode the label collapses to the dot to save room, but stays
          available to screen readers (color is never the only signal). */}
      <span className={dense ? "sr-only" : undefined}>{meta.label}</span>
    </Badge>
  );
}

function TerminalPanel({ agent, status }: { agent: AgentRecord; status: AgentStatus }) {
  const panel = TERMINAL_PANEL[status];
  if (!panel) return null;
  const { icon: Icon, tone, title, hint } = panel;
  // Show the real error only for the error state; blocked/captcha get the
  // actionable hint instead of a raw redirect URL.
  const subtitle = status === "error" && agent.error ? agent.error : hint;
  return (
    <div className="absolute inset-0 grid place-content-center justify-items-center gap-1.5 px-5 text-center">
      <Icon className={cn("size-6", tone)} aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{title(agent)}</p>
      <p className="max-w-[34ch] text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function AgentTile({
  agent,
  frozen = false,
  dense = false,
}: {
  agent: AgentRecord;
  frozen?: boolean;
  dense?: boolean;
}) {
  // The Browserbase live view is only valid while the session is connected. Once
  // the agent reaches a terminal state — or the whole run is stopped/done
  // (`frozen`) — its session is released, so we swap the iframe for a clean status
  // panel instead of the dead "Reconnect DevTools" UI. `frozen` closes the race
  // where Stop kills sessions while an agent is still mid-extract.
  const isTerminal = AGENT_TERMINAL_STATUSES.includes(agent.status);
  const status: AgentStatus = !isTerminal && frozen ? "stopped" : agent.status;
  const isLive = !AGENT_TERMINAL_STATUSES.includes(status);
  const showFrame = isLive && Boolean(agent.liveViewUrl);

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card ring-1 ring-foreground/5">
      <header
        className={cn(
          "flex min-w-0 items-center justify-between gap-2 border-b border-border/60",
          dense ? "px-2 py-1" : "px-3 py-2",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 font-mono text-xs font-medium">{agent.name}</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            #{agent.target}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* lead count: a chip when dense (saves room), spelled out otherwise */}
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {dense ? agent.postsFound : `${agent.postsFound} ${agent.postsFound === 1 ? "lead" : "leads"}`}
          </span>
          <AgentStatusBadge status={status} dense={dense} />
        </div>
      </header>

      <div className={cn("relative w-full bg-muted/40", dense ? "aspect-video" : "aspect-[16/10]")}>
        {showFrame ? (
          <iframe
            src={agent.liveViewUrl}
            title={`${agent.name} live browser — #${agent.target}`}
            sandbox="allow-same-origin allow-scripts"
            loading="lazy"
            className="absolute inset-0 size-full"
            style={{ pointerEvents: "none" }} // read-only embed (Browserbase guidance)
          />
        ) : isLive ? (
          <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted-foreground">
            Waiting for browser…
          </div>
        ) : (
          <TerminalPanel agent={agent} status={status} />
        )}
      </div>

      {/* Footer (the live "what it's doing now" line) is dropped in dense mode to
          fit more rows on screen — the status badge still conveys state. */}
      {dense ? null : (
        <footer className="min-w-0 px-3 py-2">
          <p className="truncate text-xs text-muted-foreground" title={agent.currentAction}>
            {agent.currentAction || "—"}
          </p>
        </footer>
      )}
    </article>
  );
}
