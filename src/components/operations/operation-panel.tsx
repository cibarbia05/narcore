"use client";

// The operative "war room" body: the LE operator watches the live browser drive the
// DM, the transcript stream, and the Deal/Location confirmations flip in real time.
// This is rendered both full-page (/operations/[id]) and inline in the Command Center,
// so it carries NO page chrome (no <main>, no back-link) — only the war-room itself.
import {
  BrainCircuitIcon,
  CheckCircle2Icon,
  DownloadIcon,
  Loader2Icon,
  LockIcon,
  MessageSquareIcon,
  SquareIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { stopOperation, useOperation } from "@/lib/api-client";
import { OPERATION_TERMINAL_STATUSES, type Operation, type OperationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { OperationStatusChips } from "./operation-status-chips";
import { OperationTranscript } from "./operation-transcript";

const STATUS_META: Record<OperationStatus, { label: string; className: string; live: boolean }> = {
  opening: { label: "Opening", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  awaiting_reply: { label: "Awaiting reply", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  analyzing: { label: "Analyzing", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  negotiating: { label: "Negotiating", className: "border-primary/30 bg-primary/15 text-primary", live: true },
  confirmed: { label: "Confirmed", className: "border-primary/40 bg-primary/15 text-primary", live: false },
  rejected: { label: "Rejected", className: "border-transparent bg-muted text-muted-foreground", live: false },
  stalled: { label: "Stalled", className: "border-chart-2/30 bg-chart-2/15 text-chart-2", live: false },
  blocked: { label: "Blocked", className: "border-destructive/30 bg-destructive/15 text-destructive", live: false },
  error: { label: "Error", className: "border-destructive/30 bg-destructive/15 text-destructive", live: false },
  stopped: { label: "Stopped", className: "border-transparent bg-muted text-muted-foreground", live: false },
};

const TERMINAL_PANEL: Partial<
  Record<OperationStatus, { icon: LucideIcon; tone: string; title: (o: Operation) => string; hint: string }>
> = {
  confirmed: {
    icon: CheckCircle2Icon,
    tone: "text-primary",
    title: (o) => (o.meetingLocation ? `Confirmed — ${o.meetingLocation}` : "Deal & location confirmed"),
    hint: "Full transcript and details are below. Export the report for the case file.",
  },
  rejected: {
    icon: SquareIcon,
    tone: "text-muted-foreground",
    title: () => "Target declined",
    hint: "The lead did not commit to a deal.",
  },
  stalled: {
    icon: TriangleAlertIcon,
    tone: "text-chart-2",
    title: () => "Negotiation stalled",
    hint: "No reply in time, or the message/time budget was reached.",
  },
  blocked: {
    icon: LockIcon,
    tone: "text-destructive",
    title: () => "Blocked by Instagram",
    hint: "Login wall or checkpoint — re-run `pnpm ig:login` and `pnpm ig:verify`.",
  },
  error: {
    icon: TriangleAlertIcon,
    tone: "text-destructive",
    title: () => "Operative error",
    hint: "See the dev-server logs for details.",
  },
  stopped: {
    icon: SquareIcon,
    tone: "text-muted-foreground",
    title: () => "Stopped",
    hint: "The operation was stopped by the operator.",
  },
};

function StatusBadge({ status }: { status: OperationStatus }) {
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

function triggerDownload(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Markdown report — the deliverable handed back to law enforcement. */
function toReport(op: Operation): string {
  return [
    `# Operation report — @${op.handle}`,
    "",
    `- **Status:** ${op.status}`,
    `- **Deal confirmed:** ${op.dealConfirmed ? "yes" : "no"}`,
    `- **Location confirmed:** ${op.locationConfirmed ? "yes" : "no"}`,
    op.meetingLocation ? `- **Meeting location:** ${op.meetingLocation}` : "",
    op.meetingTime ? `- **Meeting time:** ${op.meetingTime}` : "",
    `- **Platform:** ${op.platform}`,
    `- **Source post id:** ${op.postId}`,
    `- **Started:** ${op.startedAt}`,
    `- **Messages exchanged:** ${op.messages.length}`,
    "",
    "## Transcript",
    "",
    ...op.messages.map(
      (m) => `**${m.role === "operative" ? "Operative" : "Seller"}** (${m.at}): ${m.text}`,
    ),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function OperationPanel({
  operationId,
  initial,
  className,
  transcriptMode = "panel",
}: {
  operationId: string;
  initial?: Operation;
  className?: string;
  // "panel": transcript sits beside the live browser (full-page war room, lots of width).
  // "dialog": the live browser already shows the chat, so the transcript moves behind a
  // button (Command Center, where the browser should own the pane).
  transcriptMode?: "panel" | "dialog";
}) {
  const { data } = useOperation(operationId);
  const operation = data?.operation ?? initial;
  const [stopping, setStopping] = useState(false);

  async function handleStop() {
    setStopping(true);
    try {
      await stopOperation(operationId);
      toast.success("Stopping the operative…");
    } catch {
      toast.error("Couldn't stop the operation. Try again.");
    } finally {
      setStopping(false);
    }
  }

  // Inline launch hands us an operationId before the first poll returns — keep a calm
  // placeholder instead of a flash/crash until the operation hydrates.
  if (!operation) {
    return (
      <div className={cn("grid min-h-[24rem] place-items-center rounded-xl border border-border/60 bg-card", className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Connecting to operative…
          </p>
        </div>
      </div>
    );
  }

  const isTerminal = OPERATION_TERMINAL_STATUSES.includes(operation.status);
  const showFrame = !isTerminal && Boolean(operation.liveViewUrl);
  const panel = TERMINAL_PANEL[operation.status];

  return (
    <div className={cn("space-y-6", className)}>
      <header className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Narcore · Operative
            </p>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">@{operation.handle}</h1>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {operation.currentAction || "—"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={operation.status} />
            {transcriptMode === "dialog" ? (
              <Dialog>
                <DialogTrigger render={<Button variant="outline" size="sm" />}>
                  <MessageSquareIcon aria-hidden="true" />
                  Transcript
                  {operation.messages.length > 0 ? (
                    <span className="ml-0.5 rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                      {operation.messages.length}
                    </span>
                  ) : null}
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Transcript — @{operation.handle}</DialogTitle>
                    <DialogDescription>
                      Durable record · included in the export.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border/60 bg-card p-3">
                    <OperationTranscript handle={operation.handle} messages={operation.messages} />
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
            {!isTerminal ? (
              <Button onClick={handleStop} disabled={stopping} variant="outline" size="sm">
                <SquareIcon aria-hidden="true" />
                {stopping ? "Stopping…" : "Stop"}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                triggerDownload(`operation-${operation.id}.md`, toReport(operation), "text/markdown")
              }
            >
              <DownloadIcon aria-hidden="true" />
              Export report
            </Button>
          </div>
        </div>

        <OperationStatusChips operation={operation} />
      </header>

      {operation.priorIntel.length > 0 ? (
        <section
          aria-label="Prior intel"
          className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
        >
          <div className="mb-1.5 flex items-center gap-2 font-mono text-xs tracking-widest text-primary uppercase">
            <BrainCircuitIcon className="size-3.5" aria-hidden="true" />
            Prior intel used — memory from earlier busts primed this op
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {operation.priorIntel.slice(0, 5).map((memo, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary" aria-hidden="true">
                  ›
                </span>
                <span>{memo}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className={cn(transcriptMode === "panel" && "grid gap-6 lg:grid-cols-[3fr_2fr]")}>
        {/* Live browser (or terminal panel once the session is released). */}
        <section aria-label="Live browser" className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
              Live browser
            </h2>
            <span className="text-[11px] text-muted-foreground">
              read-only · ends when the operation finishes
            </span>
          </div>
          <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-border/60 bg-muted/40 ring-1 ring-foreground/5">
            {showFrame ? (
              <iframe
                src={operation.liveViewUrl}
                title={`Operative live browser — @${operation.handle}`}
                sandbox="allow-same-origin allow-scripts"
                loading="lazy"
                className="absolute inset-0 size-full"
                style={{ pointerEvents: "none" }}
              />
            ) : panel ? (
              <div className="absolute inset-0 grid place-content-center justify-items-center gap-1.5 px-5 text-center">
                <panel.icon className={cn("size-7", panel.tone)} aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">{panel.title(operation)}</p>
                <p className="max-w-[40ch] text-xs text-muted-foreground">
                  {operation.status === "error" && operation.error ? operation.error : panel.hint}
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-muted-foreground">
                Waiting for browser…
              </div>
            )}
          </div>
        </section>

        {/* Transcript beside the browser only on the full-page war room (lots of width);
            in the Command Center it lives behind the header's Transcript button. */}
        {transcriptMode === "panel" ? (
          <section aria-label="Transcript" className="flex min-h-0 flex-col">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
                Transcript
              </h2>
              <span className="text-[11px] text-muted-foreground">
                durable record · included in the export
              </span>
            </div>
            <div className="min-h-[24rem] flex-1 overflow-y-auto rounded-xl border border-border/60 bg-card p-3">
              <OperationTranscript handle={operation.handle} messages={operation.messages} />
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
