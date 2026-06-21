"use client";

// The Command Center — the demo spine. The detection queue (DETECT) and the live
// operative war room (ENGAGE) live side by side on ONE screen: clicking Engage on a
// flagged lead launches the operative inline, and the operator watches the live
// Browserbase browser, the streaming transcript, and the Deal/Location chips flip —
// no page change. `active` is held HERE (the parent) so the 3s posts revalidation can't
// wipe the selection.
import {
  GripVerticalIcon,
  InboxIcon,
  Maximize2Icon,
  Minimize2Icon,
  TargetIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { CorpusStatsBar } from "@/components/dashboard/corpus-stats-bar";
import { FiltersBar } from "@/components/dashboard/filters-bar";
import { PostsTable, PostsTableSkeleton } from "@/components/dashboard/posts-table";
import { OperationPanel } from "@/components/operations/operation-panel";
import { Button } from "@/components/ui/button";
import { useDetectionQueue } from "@/lib/hooks/use-detection-queue";
import { cn } from "@/lib/utils";

function QueueEmptyState({ onScrape, scraping }: { onScrape: () => void; scraping: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <InboxIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">No posts match the current view</p>
        <p className="text-sm text-muted-foreground">Run a scrape to pull leads into the queue.</p>
      </div>
      <Button variant="outline" size="sm" onClick={onScrape} disabled={scraping}>
        {scraping ? "Running scrape…" : "Run scrape"}
      </Button>
    </div>
  );
}

function QueueErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 py-16 text-center">
      <TriangleAlertIcon className="size-6 text-destructive" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Couldn&apos;t load posts.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** Idle right-pane: tells the operator the war room comes alive on Engage. */
function WarRoomIdle() {
  return (
    <div className="grid h-full place-content-center justify-items-center gap-2 px-6 text-center">
      <TargetIcon className="size-7 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">No active operative</p>
      <p className="max-w-[42ch] text-sm text-muted-foreground">
        Select a flagged lead in the queue and click <span className="font-medium">Engage</span> to
        deploy an undercover operative. The live browser and transcript appear right here.
      </p>
    </div>
  );
}

// The queue carries the full lead table (7 columns), so it gets the majority of the
// width by default — wide enough to fit on a ~15" laptop without horizontal scroll.
// The operator can drag toward the war room, or hit Focus, when watching the browser.
const MIN_LEFT_PCT = 30;
const MAX_LEFT_PCT = 82;
const DEFAULT_LEFT_PCT = 64;

export function CommandCenter() {
  const queue = useDetectionQueue();
  const [active, setActive] = useState<{ operationId: string; postId: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Draggable split between the queue (left) and the war room (right). The width lives
  // in state so the operator can favor the queue or the live browser as needed.
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);
  const [dragging, setDragging] = useState(false);

  function clampToBounds(pct: number) {
    return Math.min(MAX_LEFT_PCT, Math.max(MIN_LEFT_PCT, pct));
  }

  function onSeparatorPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId); // keep events even over the iframe
  }

  function onSeparatorPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setLeftPct(clampToBounds(((e.clientX - rect.left) / rect.width) * 100));
  }

  function onSeparatorPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onSeparatorKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") {
      setLeftPct((p) => clampToBounds(p - 2));
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      setLeftPct((p) => clampToBounds(p + 2));
      e.preventDefault();
    }
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-[calc(100dvh-4rem)] min-h-0",
        dragging && "cursor-col-resize select-none",
      )}
    >
      {/* DETECT — the ranked, explainable queue. */}
      <section
        aria-label="Detection queue"
        style={expanded ? undefined : { width: `${leftPct}%` }}
        className={cn(
          "flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-4 sm:p-6",
          expanded ? "hidden" : "shrink-0",
        )}
      >
        <div className="space-y-1">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Narcore · 1 Detect
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            Illicit-drug advertising leads
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Ranked by Redis vector similarity + heuristics. Approve a true positive to teach the
            corpus; Engage a lead to deploy an operative.
          </p>
        </div>

        <CorpusStatsBar stats={queue.corpus} onRescore={queue.handleRescore} rescoring={queue.rescoring} />
        <FiltersBar value={queue.filter} onChange={queue.setFilter} />

        <div className="min-h-0">
          <p className="sr-only" aria-live="polite">
            {queue.posts.length} {queue.posts.length === 1 ? "post" : "posts"} in view
          </p>
          {queue.error ? (
            <QueueErrorState onRetry={() => void queue.mutatePosts()} />
          ) : queue.isLoading && !queue.data ? (
            <PostsTableSkeleton />
          ) : queue.posts.length === 0 ? (
            <QueueEmptyState onScrape={queue.handleRunScrape} scraping={queue.scraping} />
          ) : (
            <PostsTable
              posts={queue.posts}
              onApprove={queue.handleApprove}
              onEngaged={(operationId, post) => {
                setActive({ operationId, postId: post.id });
                setExpanded(false);
              }}
              activePostId={active?.postId}
            />
          )}
        </div>
      </section>

      {/* Draggable divider — favor the queue or the live browser. */}
      {!expanded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          aria-valuenow={Math.round(leftPct)}
          aria-valuemin={MIN_LEFT_PCT}
          aria-valuemax={MAX_LEFT_PCT}
          tabIndex={0}
          onPointerDown={onSeparatorPointerDown}
          onPointerMove={onSeparatorPointerMove}
          onPointerUp={onSeparatorPointerUp}
          onKeyDown={onSeparatorKeyDown}
          className="group relative flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-border/60 transition-colors hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none"
        >
          <GripVerticalIcon
            className="pointer-events-none size-3.5 text-muted-foreground/70 group-hover:text-primary"
            aria-hidden="true"
          />
        </div>
      ) : null}

      {/* ENGAGE — the live operative war room, inline. */}
      <section aria-label="Operative war room" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5 sm:px-6">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Narcore · 2 Engage <span className="text-muted-foreground/60">· live via Browserbase</span>
          </p>
          {active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-pressed={expanded}
            >
              {expanded ? (
                <Minimize2Icon aria-hidden="true" />
              ) : (
                <Maximize2Icon aria-hidden="true" />
              )}
              {expanded ? "Show queue" : "Focus"}
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {active ? (
            <OperationPanel
              key={active.operationId}
              operationId={active.operationId}
              transcriptMode="dialog"
            />
          ) : (
            <WarRoomIdle />
          )}
        </div>
      </section>
    </div>
  );
}
