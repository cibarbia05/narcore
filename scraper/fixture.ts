// Offline fixture mode — reads data/mock-feed.json and POSTs to /api/ingest with
// NO browser. Guarantees the pipeline demo runs even if Browserbase/Wi-Fi flakes.
import { feedToScraped, loadFeed } from "./feed";
import { ingestAll } from "./ingest";

export async function runFixture(): Promise<number> {
  const posts = loadFeed().map(feedToScraped);
  console.log(`[fixture] loaded ${posts.length} synthetic posts from data/mock-feed.json`);
  return (await ingestAll(posts)).ingested;
}
