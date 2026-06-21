"use client";

// WT-A data layer. Every dashboard fetch/mutation flows through here so the UI
// has one typed seam against the REST contract (SPEC §5.2) — identical whether the
// routes return Phase-0 mocks or the real WT-B backend. Reads poll every 3s for
// live updates; mutations are awaited and the caller revalidates the SWR cache.
import useSWR, { mutate } from "swr";
import type {
  CorpusStats,
  DraftedOutreach,
  LeadSummary,
  Paginated,
  Post,
} from "./types";

/** Typed GET fetcher. Throws on non-2xx so SWR/await surfaces the error. */
async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

// ----- Filters -> querystring -----

export type SortKey = "riskScore" | "postDate";
export type SortOrder = "asc" | "desc";

/** Dashboard filter state. `"all"`/empty values are omitted from the querystring. */
export interface PostsFilter {
  status: string; // "all" | ApprovalStatus
  flagged: string; // "all" | "true" | "false"
  platform: string; // "all" | Platform
  q: string;
  sort: SortKey;
  order: SortOrder;
}

const POSTS_PAGE_LIMIT = "200"; // SPEC caps limit at 200; demo volume fits one page.

/**
 * Build the `/api/posts` querystring. The Phase-0 mock only reads limit/offset,
 * but the real backend reads status/flagged/platform/q/sort/order — sending them
 * now keeps the UI forward-compatible with zero changes at integration.
 */
export function buildPostsQuery(f: PostsFilter): string {
  const p = new URLSearchParams();
  if (f.status !== "all") p.set("status", f.status);
  if (f.flagged !== "all") p.set("flagged", f.flagged);
  if (f.platform !== "all") p.set("platform", f.platform);
  const q = f.q.trim();
  if (q) p.set("q", q);
  p.set("sort", f.sort);
  p.set("order", f.order);
  p.set("limit", POSTS_PAGE_LIMIT);
  return p.toString();
}

// ----- Read hooks (3s polling) -----

export function usePosts(query: string) {
  return useSWR<Paginated<Post>>(`/api/posts?${query}`, fetcher, {
    refreshInterval: 3000,
    keepPreviousData: true, // avoid skeleton flashes when filters change
  });
}

export function useCorpusStats() {
  return useSWR<CorpusStats>("/api/corpus", fetcher, { refreshInterval: 3000 });
}

// ----- Mutations -----

export const decide = (id: string, decision: "approved" | "rejected") =>
  postJson<{ post: Post }>(`/api/posts/${id}/decision`, { decision });

export const outreach = (id: string, channel?: "email" | "platform_report") =>
  postJson<{ leadSummary: LeadSummary; draft: DraftedOutreach; dispatched: boolean }>(
    `/api/posts/${id}/outreach`,
    { channel },
  );

export const leadSummary = (id: string) =>
  fetcher<{ leadSummary: LeadSummary }>(`/api/posts/${id}/lead-summary`);

export const rescore = (scope: "pending" | "all" = "pending") =>
  postJson<{ rescored: number }>("/api/rescore", { scope });

export const runScrape = (live = false) =>
  postJson<{ ingested: number }>("/api/scrape", { live });

export { mutate };
