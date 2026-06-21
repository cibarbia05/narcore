"use client";

// Shared detection-queue state + mutations, consumed by both the standalone Dashboard
// (/dashboard) and the Command Center (/command). Lifting this into one hook keeps the
// two surfaces in lockstep — a fix to approve/rescore/scrape behavior lands in both.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

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

export const DEFAULT_FILTER: PostsFilter = {
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

export function useDetectionQueue() {
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

  return {
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
  };
}
