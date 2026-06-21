# WT-A — Dashboard UI

> Read `SPEC.md` §4.2 (brand conventions) and §5.1–5.2 (types + REST) first. You build the
> analyst-facing dashboard against the API contract — same shapes whether mock or real.

## Scope & owned files

```
src/app/(dashboard)/layout.tsx          # NEW — route-group layout (mounts <Toaster />)
src/app/(dashboard)/dashboard/page.tsx  # REPLACE the Phase-0 placeholder
src/components/dashboard/**             # NEW — all composite components
src/lib/api-client.ts                   # NEW — typed fetchers + SWR hooks (WT-A owns)
```

Use only the shared shadcn primitives already in `src/components/ui/*` (table, badge, switch,
card, dialog, sonner, tooltip, skeleton, input, select). Do **not** add new `ui/*` primitives
or new deps (SWR added in Phase 0). Do **not** edit the root `src/app/layout.tsx`,
`src/lib/*` (except creating `api-client.ts`), or any `api/**` route.

## Data layer: SWR

Add `<Toaster />` (sonner) in `src/app/(dashboard)/layout.tsx` so it's scoped to the dashboard
(keeps you out of the shared root layout). All data flows through `src/lib/api-client.ts`:

```ts
"use client";
import useSWR, { mutate } from "swr";
import type { Paginated, Post, CorpusStats, LeadSummary, DraftedOutreach } from "./types";

const fetcher = (url: string) => fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });

export function usePosts(query: string) {                 // query = built querystring
  return useSWR<Paginated<Post>>(`/api/posts?${query}`, fetcher, { refreshInterval: 3000 });
}
export function useCorpusStats() {
  return useSWR<CorpusStats>("/api/corpus", fetcher, { refreshInterval: 3000 });
}
async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export const decide = (id: string, decision: "approved" | "rejected") => post<{ post: Post }>(`/api/posts/${id}/decision`, { decision });
export const outreach = (id: string, channel?: string) => post<{ leadSummary: LeadSummary; draft: DraftedOutreach; dispatched: boolean }>(`/api/posts/${id}/outreach`, { channel });
export const leadSummary = (id: string) => fetch(`/api/posts/${id}/lead-summary`).then((r) => r.json() as Promise<{ leadSummary: LeadSummary }>);
export const rescore = (scope: "pending" | "all" = "pending") => post<{ rescored: number }>("/api/rescore", { scope });
export const runScrape = (live = false) => post<{ ingested: number }>("/api/scrape", { live });
export { mutate };
```

After a mutation, call `mutate(key)` to revalidate the posts/corpus SWR keys (optimistic:
update local data first, then revalidate). Surface success/failure via `toast` (sonner).

## Page structure

`page.tsx` is a thin server component rendering `<DashboardClient />` (client). Layout:
header (title + `CorpusStatsBar`), `FiltersBar`, `PostsTable`. All interactive pieces are
client components.

## Components (`src/components/dashboard/`)

| Component | Props | API it calls | Behavior |
|---|---|---|---|
| `DashboardClient` | — | `usePosts`, `useCorpusStats` | owns filter state → builds querystring → feeds table; loading/empty/error states |
| `CorpusStatsBar` | `stats` | `rescore()` | shows `size / seed / approved` (mono); **"Re-evaluate against learned terms"** button → `rescore("pending")` → toast + revalidate; an approved-count that visibly ticks up |
| `FiltersBar` | `value,onChange` | — | status/flagged/platform `Select`s + search `Input` (debounced) + sort toggle |
| `PostsTable` | `posts` | — | columns below; **row dimmed (`opacity-45`) when `!flagged`**; click row → `PostDetailDialog` |
| `RiskBadge` | `score` | — | `riskBand(score)` → color (high=primary, elevated=amber-ish via chart token, low=muted); mono score |
| `CodeWordChips` | `terms` | — | small `Badge`s from `risk.detectedCodeWords` |
| `ApproveSwitch` | `post` | `decide()` | shadcn `Switch`; **optimistic** (flip immediately, revalidate; rollback + toast on error) |
| `OutreachButton`/`OutreachDialog` | `post` | `outreach()` | `Dialog`: renders `LeadSummary` (handle, platform, code words, risk metrics, rationale) + the drafted email (`draft.subject`/`draft.body`); **Copy** + **Download .md/.txt** export; **Send** = simulated → `toast.success("Outreach queued (simulated)")` |
| `PostDetailDialog` | `post` | `leadSummary()` (optional) | risk breakdown: `semantic`, `rawCosine`, threshold, each `HeuristicHit` with its `label`, matched term |

**PostsTable columns:** Account (`username`, mono) · Platform (`Badge`) · Caption (truncate +
`CodeWordChips`) · Risk (`RiskBadge`) · Approval (`ApproveSwitch`) · Outreach (`OutreachButton`).

## States & a11y

- Loading → `Skeleton` rows. Empty → "No posts yet — run a scrape" CTA. Error → inline retry.
- Keyboard: switch + buttons focusable, dialogs trap focus (shadcn handles), visible focus ring.
- Brand: dark-first, **single orange accent**, **mono for metadata/counts/scores**, tokens only
  (no hardcoded colors), WCAG AA. Reuse the `Button` `render`/`nativeButton={false}` pattern for
  any link-styled action.

## Definition of Done

All table states render; row-darkening for cleared posts; Approve toggle optimistic + revalidates;
corpus counter ticks on approve; Re-evaluate button works; Outreach dialog shows summary + drafted
email with working export + simulated send; live updates via 3s polling; matches `brand.md`;
`pnpm typecheck && pnpm build` green.

## Verify

`pnpm dev` → `/dashboard`. Against Phase-0 mock first (renders fixtures), then unchanged once
WT-B is real. Toggle Approve → corpus counter increments; open Outreach → draft renders + export
works; trigger a scrape (or `pnpm post-mock`) → new rows appear within 3s.
