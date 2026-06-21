/**
 * POST a sample scraped post to the local ingest endpoint to exercise the pipeline.
 * Works in Phase 0 against the mock ingest route. Run with: pnpm post-mock
 * (requires `pnpm dev` to be running).
 */
import type { ScrapedPost } from "../src/lib/types";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

const sample: ScrapedPost = {
  agent_id: 1,
  post_link: `https://instagram.com/p/demo-${Date.now()}`,
  post_username: "@demo.plug",
  post_caption: "restockd 🍃 blue M30 blues back 💊 hmu on telegram, cashapp ready",
  post_date: new Date().toISOString(),
  platform: "instagram",
};

async function main(): Promise<void> {
  const res = await fetch(`${APP_URL}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sample),
  });
  console.log("status:", res.status);
  console.log(JSON.stringify(await res.json(), null, 2));
}

main().catch((err) => {
  console.error("[post-mock] failed:", err);
  process.exitCode = 1;
});
