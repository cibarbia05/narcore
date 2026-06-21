"use client";

import { InboxIcon, TriangleAlertIcon } from "lucide-react";
import { useDetectionQueue } from "@/lib/hooks/use-detection-queue";
import { Button } from "@/components/ui/button";
import { CorpusStatsBar } from "./corpus-stats-bar";
import { FiltersBar } from "./filters-bar";
import { PostsTable, PostsTableSkeleton } from "./posts-table";

function EmptyState({ onScrape, scraping }: { onScrape: () => void; scraping: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <InboxIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">No posts match the current view</p>
        <p className="text-sm text-muted-foreground">
          Run a scrape to pull posts into the detection queue.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onScrape} disabled={scraping}>
        {scraping ? "Running scrape…" : "Run scrape"}
      </Button>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
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

export function DashboardClient() {
  const {
    posts,
    data,
    error,
    isLoading,
    filter,
    setFilter,
    corpus,
    rescoring,
    scraping,
    mutatePosts,
    handleApprove,
    handleRescore,
    handleRunScrape,
  } = useDetectionQueue();

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <header className="space-y-4">
        <div className="space-y-1">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Narcore · Detection Queue
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Illicit-drug advertising leads
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            A ranked, explainable queue. Approve a true positive to teach the corpus a new coded
            term; cleared posts are dimmed.
          </p>
        </div>
        <CorpusStatsBar stats={corpus} onRescore={handleRescore} rescoring={rescoring} />
      </header>

      <FiltersBar value={filter} onChange={setFilter} />

      <section>
        <p className="sr-only" aria-live="polite">
          {posts.length} {posts.length === 1 ? "post" : "posts"} in view
        </p>
        {error ? (
          <ErrorState onRetry={() => void mutatePosts()} />
        ) : isLoading && !data ? (
          <PostsTableSkeleton />
        ) : posts.length === 0 ? (
          <EmptyState onScrape={handleRunScrape} scraping={scraping} />
        ) : (
          <PostsTable posts={posts} onApprove={handleApprove} />
        )}
      </section>
    </main>
  );
}
