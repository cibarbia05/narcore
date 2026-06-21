// One parallel Instagram agent. Attaches Stagehand to a PRE-CREATED Browserbase
// session (so the orchestrator already has the live-view URL for the UI), opens a
// hashtag feed the burner account is logged into, walks the top posts, extracts
// each one, and POSTs it through the existing /api/ingest pipeline.
//
// Design choices that matter for a live demo:
//   - Permalinks are read deterministically from the grid (cheap, robust to IG's
//     obfuscated class names); only the rich caption/handle/date is pulled with
//     the LLM `extract` (robust to IG's changing post-page DOM).
//   - Posts are ingested one-by-one so the dashboard rows light up live and the
//     tile's postsFound counter ticks in real time.
//   - Everything is wrapped: a login wall / checkpoint / CAPTCHA / abort sets a
//     clear status and exits cleanly. One agent failing never touches the others.
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { ScrapedPost } from "../src/lib/types";
import { ingestAll } from "./ingest";
import { patchAgent } from "../src/lib/agents/run-store";
import { endSession } from "../src/lib/browserbase";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

const MAX_POSTS = clampInt(process.env.IG_MAX_POSTS_PER_AGENT, 8, 1, 50);
const AGENT_BUDGET_MS = clampInt(process.env.IG_AGENT_TIMEOUT_MS, 120_000, 30_000, 900_000);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Per-post fields pulled by the LLM from an open Instagram post page.
const postExtractSchema = z.object({
  username: z.string().describe("the author's handle, including the leading @"),
  caption: z.string().describe("the full caption text of the post, or empty string if none"),
  date: z.string().describe("the ISO 8601 timestamp the post was published, if visible"),
});

export interface IgAgentOptions {
  runId: string;
  idx: number;
  target: string; // hashtag without leading '#'
  sessionId: string;
  signal: AbortSignal;
}

/** A page is a login wall / checkpoint if IG bounced us off the content. */
function detectBlock(url: string): "captcha" | "blocked" | null {
  if (/\/challenge\//i.test(url) || /\/checkpoint\//i.test(url)) return "captcha";
  if (/\/accounts\/login/i.test(url) || /\/accounts\/suspended/i.test(url)) return "blocked";
  return null;
}

/** Read post permalinks from the rendered grid. Runs in the browser; references
 *  no outer scope so it serializes cleanly. */
function gridLinks(): string[] {
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]'),
  );
  const seen = new Set<string>();
  for (const a of anchors) {
    const href = a.href.split("?")[0];
    if (/\/(p|reel)\/[^/]+\/?$/.test(href)) seen.add(href);
  }
  return Array.from(seen);
}

export async function runIgAgent(opts: IgAgentOptions): Promise<void> {
  const { runId, idx, target, sessionId, signal } = opts;
  const deadline = Date.now() + AGENT_BUDGET_MS;
  const aborted = () => signal.aborted || Date.now() > deadline;

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    await patchAgent(runId, idx, {
      status: "error",
      error: "BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not set",
    });
    return;
  }

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: sessionId, // attach to the session the orchestrator made
    verbose: 1,
    model: {
      modelName: process.env.SCRAPE_MODEL ?? DEFAULT_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
  });

  let postsFound = 0;
  const ingestedLinks = new Set<string>();

  try {
    await patchAgent(runId, idx, { status: "starting", currentAction: "connecting to browser" });
    await stagehand.init();

    const page =
      stagehand.context.pages()[0] ?? (await stagehand.context.awaitActivePage());

    // 1. Open the hashtag feed (the burner account is already logged in via context).
    await patchAgent(runId, idx, {
      status: "loading",
      currentAction: `opening #${target}`,
    });
    await page.goto(`https://www.instagram.com/explore/tags/${encodeURIComponent(target)}/`, {
      waitUntil: "domcontentloaded",
    });
    await sleep(2500); // let the grid hydrate

    const block = detectBlock(page.url());
    if (block) {
      await patchAgent(runId, idx, {
        status: block,
        currentAction:
          block === "captcha" ? "checkpoint — take over the live view" : "blocked by login wall",
        error: `navigation landed on ${page.url()}`,
      });
      return;
    }

    // 2. Scroll a little to load more tiles, then read permalinks deterministically.
    await patchAgent(runId, idx, { status: "browsing", currentAction: "scanning the feed" });
    for (let s = 0; s < 3 && !aborted(); s++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await sleep(1200);
    }
    const links = (await page.evaluate(gridLinks)).slice(0, MAX_POSTS);

    if (links.length === 0) {
      await patchAgent(runId, idx, {
        status: "done",
        currentAction: "no posts found for this tag",
        postsFound: 0,
      });
      return;
    }

    // 3. Visit each permalink, extract the rich fields, ingest one-by-one.
    for (const link of links) {
      if (aborted()) break;
      if (ingestedLinks.has(link)) continue;

      await patchAgent(runId, idx, {
        status: "extracting",
        currentAction: `reading post ${postsFound + 1}/${links.length}`,
      });
      await page.goto(link, { waitUntil: "domcontentloaded" });
      await sleep(1200);

      const midBlock = detectBlock(page.url());
      if (midBlock) {
        await patchAgent(runId, idx, {
          status: midBlock,
          currentAction:
            midBlock === "captcha" ? "checkpoint — take over the live view" : "blocked by login wall",
        });
        break;
      }

      let extracted: z.infer<typeof postExtractSchema>;
      try {
        extracted = await stagehand.extract(
          "Extract the author's handle (including @), the full caption text, and the post's publish date from this Instagram post.",
          postExtractSchema,
        );
      } catch (err) {
        console.warn(`[ig-agent ${idx}] extract failed for ${link}:`, err);
        continue; // skip this post, keep going — resilience over completeness
      }

      const post: ScrapedPost = {
        agent_id: idx,
        post_link: link,
        post_username: extracted.username || "(unknown)",
        post_caption: extracted.caption ?? "",
        post_date: extracted.date || new Date().toISOString(),
        platform: "instagram",
      };

      await patchAgent(runId, idx, {
        status: "ingesting",
        currentAction: `scoring ${post.post_username}`,
        lastCaption: post.post_caption.slice(0, 160),
      });
      const n = await ingestAll([post]);
      if (n > 0) {
        ingestedLinks.add(link);
        postsFound += 1;
        await patchAgent(runId, idx, { postsFound });
      }

      await sleep(900); // gentle pacing — look human, avoid rate limits
    }

    await patchAgent(runId, idx, {
      status: signal.aborted ? "stopped" : "done",
      currentAction: signal.aborted ? "stopped by operator" : `done — ${postsFound} posts`,
      postsFound,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ig-agent ${idx}] error:`, err);
    await patchAgent(runId, idx, {
      status: "error",
      currentAction: "agent error",
      error: message.slice(0, 300),
    });
  } finally {
    // Disconnect Stagehand and release the keepAlive session so it stops billing
    // and frees a concurrency slot.
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    await endSession(sessionId);
  }
}
