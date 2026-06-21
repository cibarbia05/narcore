"use client";

// WT-A data layer. Every dashboard fetch/mutation flows through here so the UI
// has one typed seam against the REST contract (SPEC §5.2) — identical whether the
// routes return Phase-0 mocks or the real WT-B backend. Reads poll every 3s for
// live updates; mutations are awaited and the caller revalidates the SWR cache.
import useSWR, { mutate } from "swr";
import {
  OPERATION_TERMINAL_STATUSES,
  type AgentRun,
  type CorpusStats,
  type DraftedOutreach,
  type HealthResponse,
  type LeadSummary,
  type Operation,
  type OperativeConfigResponse,
  type Paginated,
  type Post,
  type StartOperationResponse,
  type StartRunResponse,
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
  if (!res.ok) {
    // Surface the server's error envelope ({ error: { message } }) so callers can
    // show the real reason (missing key, no login contexts, allowlist denial, …).
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      if (data?.error?.message) message = data.error.message;
    } catch {
      /* non-JSON body — keep the status message */
    }
    throw new Error(message);
  }
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

// ----- Parallel agents ("War Room") -----

/** Poll one run's live state. Null runId disables the request (no active run).
 *  Polls fast (1.5s) while running, then stops once the run reaches a terminal
 *  state so we don't hammer the server after everyone's done. */
export function useRun(runId: string | null) {
  return useSWR<{ run: AgentRun }>(
    runId ? `/api/agents/run/${runId}` : null,
    fetcher,
    {
      refreshInterval: (latest) => (latest?.run.status === "running" ? 1500 : 0),
      keepPreviousData: true,
    },
  );
}

export const startRun = (body: { agentCount?: number; tags?: string[] } = {}) =>
  postJson<StartRunResponse>("/api/agents/run", body);

export const stopRun = (runId: string) =>
  postJson<{ stopped: boolean }>(`/api/agents/run/${runId}/stop`);

// ----- Operative ("Operations") -----

/** Poll one operation's live state. Null id disables the request. Polls every 2s
 *  until the operation reaches a terminal state, then stops. */
export function useOperation(operationId: string | null) {
  return useSWR<{ operation: Operation }>(
    operationId ? `/api/operations/${operationId}` : null,
    fetcher,
    {
      refreshInterval: (latest) =>
        latest && OPERATION_TERMINAL_STATUSES.includes(latest.operation.status) ? 0 : 2000,
      keepPreviousData: true,
    },
  );
}

/** The operative target allowlist (for gating the "Engage" action). Rarely changes,
 *  so no polling — fetched once and cached. */
export function useOperativeConfig() {
  return useSWR<OperativeConfigResponse>("/api/operations", fetcher);
}

/** System health, incl. whether semantic scoring is on a real embedding provider
 *  or has fallen back to mock vectors. Polled slowly — it rarely changes. */
export function useHealth() {
  return useSWR<HealthResponse>("/api/health", fetcher, { refreshInterval: 15000 });
}

export const startOperation = (postId: string, targetHandle?: string) =>
  postJson<StartOperationResponse>("/api/operations", { postId, targetHandle });

export const stopOperation = (operationId: string) =>
  postJson<{ stopped: boolean }>(`/api/operations/${operationId}/stop`);

export { mutate };
