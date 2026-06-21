/**
 * Seed loader — embeds data/seed-terms.json into the Redis `idx:corpus` vector
 * index (search_document: prefix, 768-dim, COSINE). Idempotent upsert by slug.
 *
 * Run with: pnpm seed   (requires Redis up: `docker compose up -d redis`)
 */
import { getRedis } from "../src/lib/redis";
import { seedCorpus } from "../src/lib/repo";

async function main(): Promise<void> {
  try {
    const { loaded, skipped } = await seedCorpus();
    console.log(`[seed] corpus updated — loaded=${loaded} skipped=${skipped}`);
  } finally {
    // Close the shared client so the process exits (node-redis keeps the socket open).
    const client = getRedis();
    if (client.isOpen) await client.quit();
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exitCode = 1;
});
