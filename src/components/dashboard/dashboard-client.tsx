"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { InboxIcon, TriangleAlertIcon } from "lucide-react";
import {
  buildPostsQuery,
  decide,
  rescore,
  runScrape,
  useCorpusStats,
  usePosts,
  type PostsFilter,
} from "@/lib/api-client";
import type { Paginated, Post } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CorpusStatsBar } from "./corpus-stats-bar";
import { FiltersBar } from "./filters-bar";
import { PostsTable, PostsTableSkeleton } from "./posts-table";

const DEFAULT_FILTER: PostsFilter = {
  status: "all",
  flagged: "all",
  platform: "all",
  q: "",
  sort: "riskScore",
  order: "desc",
};

/** Debounce a rapidly-changing value so the search box doesn't refetch per keystroke. */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

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
  const [filter, setFilter] = useState<PostsFilter>(DEFAULT_FILTER);
  const [rescoring, setRescoring] = useState(false);
  const [scraping, setScraping] = useState(false);

  const debouncedQ = useDebouncedValue(filter.q, 300);
  const query = useMemo(
    () => buildPostsQuery({ ...filter, q: debouncedQ }),
    [filter, debouncedQ],
  );

  const { data, error, isLoading, mutate: mutatePosts } = usePosts(query);
  const { data: corpus, mutate: mutateCorpus } = useCorpusStats();

  const posts = data?.items ?? [];

  async function handleApprove(post: Post, nextApproved: boolean) {
    const decision = nextApproved ? "approved" : "rejected";
    const approvedAt = nextApproved ? new Date().toISOString() : null;

    try {
      await mutatePosts(
        async () => {
          await decide(post.id, decision);
          return undefined; // revalidate fetches the authoritative page
        },
        {
          optimisticData: (current?: Paginated<Post>) => {
            const base = current ?? { items: posts, total: posts.length, limit: 200, offset: 0 };
            return {
              ...base,
              items: base.items.map((p) =>
                p.id === post.id ? { ...p, approvalStatus: decision, approvedAt } : p,
              ),
            };
          },
          populateCache: false,
          revalidate: true,
          rollbackOnError: true,
        },
      );

      // Approving grows the corpus — optimistically tick the learned counter,
      // then revalidate against the source of truth.
      if (nextApproved) {
        void mutateCorpus(
          (current) =>
            current ? { ...current, approved: current.approved + 1, size: current.size + 1 } : current,
          { revalidate: true },
        );
      } else {
        void mutateCorpus();
      }

      toast.success(
        nextApproved
          ? `Approved ${post.username} — caption added to the corpus`
          : `Marked ${post.username} as cleared`,
      );
    } catch {
      toast.error("Couldn't save the decision. Try again.");
    }
  }

  async function handleRescore() {
    setRescoring(true);
    try {
      const { rescored } = await rescore("pending");
      await Promise.all([mutatePosts(), mutateCorpus()]);
      toast.success(
        `Re-scored ${rescored} ${rescored === 1 ? "post" : "posts"} against learned terms`,
      );
    } catch {
      toast.error("Re-evaluation failed. Try again.");
    } finally {
      setRescoring(false);
    }
  }

  async function handleRunScrape() {
    setScraping(true);
    try {
      const { ingested } = await runScrape(false);
      await mutatePosts();
      toast.success(`Ingested ${ingested} ${ingested === 1 ? "post" : "posts"}`);
    } catch {
      toast.error("Scrape failed. Try again.");
    } finally {
      setScraping(false);
    }
  }

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
