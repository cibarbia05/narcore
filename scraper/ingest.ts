// HTTP client for POST /api/ingest. WT-D is a client of this route (owned by
// WT-B) — it never imports it. Sequential posting keeps the demo watchable
// (rows light up one by one) at the ~24-post scale; retries absorb the 503 the
// pipeline returns while the embedding sidecar warms up.
import type { ScrapedPost } from "../src/lib/types";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const INGEST_API_KEY = process.env.INGEST_API_KEY;

const MAX_ATTEMPTS = 4; // 1 try + 3 retries
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ingestUrl(): string {
  return `${APP_URL.replace(/\/$/, "")}/api/ingest`;
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (INGEST_API_KEY) h.authorization = `Bearer ${INGEST_API_KEY}`;
  return h;
}

/** POST one post, retrying with exponential backoff on 503 / network errors.
 *  Returns true on any 2xx (201 new + 200 dedup both count as ingested). */
async function postOne(post: ScrapedPost): Promise<boolean> {
  const url = ingestUrl();
  let delay = BASE_DELAY_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(post),
      });
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        console.error(`[ingest] network error for ${post.post_link}:`, err);
        return false;
      }
      await sleep(delay);
      delay *= 2;
      continue;
    }

    if (res.ok) return true; // 200 (dedup) or 201 (new)

    if (res.status === 503 && attempt < MAX_ATTEMPTS) {
      console.warn(
        `[ingest] 503 (dependency warming) for ${post.post_link} — retry ${attempt}/${MAX_ATTEMPTS - 1}`,
      );
      await sleep(delay);
      delay *= 2;
      continue;
    }

    const body = await res.text().catch(() => "");
    console.error(`[ingest] ${res.status} for ${post.post_link}: ${body.slice(0, 200)}`);
    return false;
  }
  return false;
}

/** POST every post sequentially. Returns the count successfully ingested. */
export async function ingestAll(posts: ScrapedPost[]): Promise<number> {
  let ingested = 0;
  for (const post of posts) {
    if (await postOne(post)) {
      ingested++;
      console.log(`[ingest] ✓ ${post.post_username} (${post.platform ?? "unknown"})`);
    }
  }
  console.log(`[ingest] ${ingested}/${posts.length} posts ingested → ${ingestUrl()}`);
  return ingested;
}
