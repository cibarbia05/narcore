// Live agentic scraping via Browserbase + Stagehand v3. Loads the synthetic /feed
// in a real cloud browser, extracts each post, normalizes to ScrapedPost, and
// POSTs to /api/ingest.
//
// Two extraction strategies:
//   - deterministic (default): read the data-* DOM contract via page.evaluate.
//     Reliable, no LLM, no model key.
//   - AI showcase (SCRAPE_EXTRACT_MODE=ai + ANTHROPIC_API_KEY): ask the model to
//     extract posts from the rendered page; falls back to deterministic on failure.
//
// API confirmed against @browserbasehq/stagehand@3.6.0 type defs (context7
// /browserbase/stagehand): top-level apiKey + projectId, context.pages(),
// page.goto({ waitUntil }), page.evaluate(), extract(instruction, schema).
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { ScrapedPost } from "../src/lib/types";
import { coercePlatform, agentFor } from "./feed";
import { ingestAll } from "./ingest";

const FEED_URL = process.env.MOCK_FEED_URL ?? "http://localhost:3000/feed";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

// Wire shape produced by both extraction strategies, before normalization.
const rawItemSchema = z.object({
  post_link: z.string().describe("the permalink URL of the post"),
  post_username: z.string().describe("the author's handle, including the leading @"),
  platform: z.string().describe("the social platform name, e.g. instagram, x, telegram"),
  post_date: z.string().describe("the ISO 8601 timestamp the post was published"),
  post_caption: z.string().describe("the full caption text of the post"),
});
type RawItem = z.infer<typeof rawItemSchema>;

// Runs in the browser. References no outer scope so it serializes cleanly.
function domExtract(): RawItem[] {
  return Array.from(document.querySelectorAll("[data-post]")).map((el) => ({
    post_link: el.getAttribute("data-post-link") ?? "",
    post_username: el.getAttribute("data-username") ?? "",
    platform: el.getAttribute("data-platform") ?? "unknown",
    post_date: el.getAttribute("data-date") ?? "",
    post_caption: el.querySelector("[data-caption]")?.textContent?.trim() ?? "",
  }));
}

function normalize(raw: RawItem[]): ScrapedPost[] {
  return raw
    .filter((r) => r.post_link.length > 0)
    .map((r) => ({
      agent_id: agentFor(r.platform),
      post_link: r.post_link,
      post_username: r.post_username,
      post_caption: r.post_caption,
      post_date: r.post_date,
      platform: coercePlatform(r.platform),
    }));
}

export async function scrapeFeed(): Promise<number> {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    throw new Error(
      "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set for live scraping",
    );
  }

  const useAi =
    process.env.SCRAPE_EXTRACT_MODE === "ai" && Boolean(process.env.ANTHROPIC_API_KEY);

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    verbose: 1,
    ...(useAi
      ? {
          model: {
            modelName: process.env.SCRAPE_MODEL ?? DEFAULT_MODEL,
            apiKey: process.env.ANTHROPIC_API_KEY,
          },
        }
      : {}),
  });

  await stagehand.init();
  console.log(
    `[scrape] Browserbase session: ${stagehand.browserbaseSessionURL ?? stagehand.browserbaseSessionID ?? "(unknown)"}`,
  );

  try {
    const page = stagehand.context.pages()[0] ?? (await stagehand.context.awaitActivePage());
    await page.goto(FEED_URL, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-post]", { timeout: 15_000 });

    let raw: RawItem[];
    if (useAi) {
      try {
        const result = await stagehand.extract(
          "Extract every social-media post visible on this page. For each post return its permalink URL, the author's handle (including @), the platform name, the ISO 8601 post date, and the full caption text.",
          z.object({ posts: z.array(rawItemSchema) }),
        );
        raw = result.posts;
        if (raw.length === 0) throw new Error("AI extraction returned no posts");
        console.log(`[scrape] AI extracted ${raw.length} posts`);
      } catch (err) {
        console.warn("[scrape] AI extraction failed — falling back to DOM:", err);
        raw = await page.evaluate(domExtract);
      }
    } else {
      raw = await page.evaluate(domExtract);
    }

    const posts = normalize(raw);
    console.log(
      `[scrape] extracted ${posts.length} posts via ${useAi ? "AI" : "DOM"} from ${FEED_URL}`,
    );
    return (await ingestAll(posts)).ingested;
  } finally {
    await stagehand.close();
  }
}
