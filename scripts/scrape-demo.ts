/**
 * Scrape demo CLI.
 *   tsx scripts/scrape-demo.ts          -> offline fixture mode (no browser, no keys)
 *   tsx scripts/scrape-demo.ts --live   -> live Browserbase/Stagehand scrape
 *
 * Requires `pnpm dev` running so /api/ingest is reachable. Live mode also needs
 * BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID in the environment (and, for the
 * AI-extraction showcase, SCRAPE_EXTRACT_MODE=ai + ANTHROPIC_API_KEY).
 *
 * scrape.ts is imported dynamically only for --live, so fixture mode never loads
 * Stagehand — the offline fallback stays dependency-light.
 */
export {}; // mark as a module so top-level `main` doesn't collide with sibling scripts

const live = process.argv.includes("--live");

async function main(): Promise<void> {
  const ingested = live
    ? await (await import("../scraper/scrape")).scrapeFeed()
    : await (await import("../scraper/fixture")).runFixture();
  console.log(`[scrape-demo] ${live ? "live" : "fixture"}: ingested ${ingested} posts`);
}

main().catch((err) => {
  console.error("[scrape-demo] failed:", err);
  process.exitCode = 1;
});
