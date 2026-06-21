# WT-D — Scraper + Synthetic Feed (Browserbase)

> Read `SPEC.md` §5.1 (`ScrapedPost`) and §5.7 (mock conventions). You build BOTH the scrape
> target (a synthetic feed page) and the scraper that reads it live via Browserbase/Stagehand,
> then POSTs each post to `/api/ingest`. The brief: develop against the mock ingest first.

## Scope & owned files

```
src/app/feed/page.tsx           # NEW — synthetic social feed (the scrape target)
data/mock-feed.json             # NEW — feed content (coded + benign decoy posts)
scraper/scrape.ts               # NEW — Stagehand live extraction -> normalize -> POST /api/ingest
scraper/fixture.ts              # NEW — offline mode: read data/mock-feed.json -> POST (no browser)
src/app/api/scrape/route.ts     # REPLACE the Phase-0 mock skeleton (you own this route)
scripts/scrape-demo.ts          # NEW — CLI entry: `tsx scripts/scrape-demo.ts [--live]`
```

Deps (added in Phase 0): `@browserbasehq/stagehand`, `zod`. Env: `BROWSERBASE_API_KEY`,
`BROWSERBASE_PROJECT_ID`, `MOCK_FEED_URL` (default `http://localhost:3000/feed`). Do **not** edit
`/api/ingest` — you are an HTTP client of it.

## 1. Synthetic feed page — DOM contract (critical for reliable scraping)

`src/app/feed/page.tsx` reads `data/mock-feed.json` and renders each post with **stable,
machine-readable attributes** so extraction is deterministic. Style it like a simple social feed
(cards), on-brand. Label the page clearly as synthetic test data (ethics).

```tsx
<article
  data-post
  data-post-link={p.postLink}
  data-username={p.username}
  data-platform={p.platform}
  data-date={p.postDate}
>
  <header>{p.username} · <span>{p.platform}</span> · <time>{p.postDate}</time></header>
  <p data-caption>{p.caption}</p>
</article>
```

`data/mock-feed.json` shape (author ~24 posts; ~60% coded, ~40% benign decoys so the system
doesn't flag everything):

```json
{ "posts": [
  { "username": "@trapstar.plug", "platform": "instagram",
    "postLink": "https://instagram.com/p/feed-001",
    "postDate": "2026-06-19T18:22:00Z",
    "caption": "restockd 🍃 blue M30 blues back 💊 hmu on telegram, cashapp ready",
    "kind": "coded" },
  { "username": "@granolabakes", "platform": "instagram",
    "postLink": "https://instagram.com/p/feed-014",
    "postDate": "2026-06-18T12:10:00Z",
    "caption": "blueberry muffins fresh out the oven 🫐 dm for the recipe",
    "kind": "benign" }
] }
```

## 2. Scraper — Stagehand live extraction (`scraper/scrape.ts`)

> Confirm the exact Stagehand API against context7 `/browserbase/stagehand` (the `extract`
> signature + zod usage) before finalizing — it evolves. Canonical pattern:

```ts
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { ScrapedPost } from "../src/lib/types";

const FEED_URL = process.env.MOCK_FEED_URL ?? "http://localhost:3000/feed";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export async function scrapeFeed(): Promise<number> {
  const sh = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
  });
  await sh.init();
  try {
    await sh.page.goto(FEED_URL, { waitUntil: "networkidle" });
    // Deterministic extraction off the data-attributes (more reliable than free-form):
    const raw = await sh.page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-post]")).map((el) => ({
        post_link: el.getAttribute("data-post-link") ?? "",
        post_username: el.getAttribute("data-username") ?? "",
        platform: el.getAttribute("data-platform") ?? "unknown",
        post_date: el.getAttribute("data-date") ?? "",
        post_caption: el.querySelector("[data-caption]")?.textContent?.trim() ?? "",
      })),
    );
    // (Showcase alt: sh.page.extract({ instruction, schema }) for the AI-extraction demo.)
    const posts: ScrapedPost[] = raw.map((r) => ({ agent_id: agentFor(r.platform), ...r }));
    return await ingestAll(posts);
  } finally {
    await sh.close();
  }
}
```

`agentFor(platform)`: stable int per platform (e.g. instagram→1, facebook→2). `ingestAll`:
POST each to `${APP_URL}/api/ingest` (sequential or small concurrency) with retry/backoff on 503
(embedding sidecar warming up); count successes (201) + dedups (200). Include
`Authorization: Bearer ${INGEST_API_KEY}` if set.

## 3. Fixture mode (`scraper/fixture.ts`) — offline demo fallback

Read `data/mock-feed.json` directly, map → `ScrapedPost[]` (same shape), POST to `/api/ingest`.
No browser. This guarantees the pipeline demo runs even if Wi-Fi/Browserbase flakes.

## 4. `POST /api/scrape` (`src/app/api/scrape/route.ts`)

Body `{ live?: boolean }`. `live === true` → `scrapeFeed()` (Browserbase); else `runFixture()`.
Returns `{ ingested: n }`. Errors → 502/503 with `ApiError`. This is the "Run scrape" button the
dashboard calls.

## 5. `scripts/scrape-demo.ts`

`tsx scripts/scrape-demo.ts` → fixture mode; `--live` → real Browserbase. Logs ingested count.

## Definition of Done

`/feed` renders ~24 realistic coded+benign posts with the `data-*` contract; a live Browserbase
session extracts → normalizes → POSTs to `/api/ingest` → rows appear in the dashboard; fixture
mode works offline; `pnpm typecheck && pnpm build` green.

## Verify

`pnpm dev`, open `/feed` (looks like a feed). Fixture: `tsx scripts/scrape-demo.ts` → posts
appear in `/dashboard`. Live: set `BROWSERBASE_*`, `tsx scripts/scrape-demo.ts --live` → watch the
Browserbase session extract and the dashboard light up. Ethics: synthetic data only, labeled.
