// Shared, browser-free feed helpers. Imported by the synthetic /feed page (the
// scrape target), the offline fixture, and the live Stagehand scraper. This file
// MUST NOT import Stagehand — it has to stay safe for the Next.js page bundle.
import { z } from "zod";
import { PLATFORMS, type Platform, type ScrapedPost } from "../src/lib/types";
import rawFeed from "../data/mock-feed.json";

/** One authored post in data/mock-feed.json. `kind` is authoring metadata only
 *  (the post mix) — it is never rendered as a DOM attribute or scraped. */
export const feedPostSchema = z.object({
  username: z.string().min(1),
  platform: z.enum(PLATFORMS),
  postLink: z.string().url(),
  postDate: z.string().min(1),
  caption: z.string(),
  kind: z.enum(["coded", "benign"]),
});
export type FeedPost = z.infer<typeof feedPostSchema>;

const feedFileSchema = z.object({
  _disclaimer: z.string().optional(),
  posts: z.array(feedPostSchema).min(1),
});

let cached: FeedPost[] | null = null;

/** Load + validate the synthetic feed once (memoized). */
export function loadFeed(): FeedPost[] {
  if (cached === null) {
    cached = feedFileSchema.parse(rawFeed).posts;
  }
  return cached;
}

// Stable agent id per platform — mirrors the brief (instagram -> 1, ...).
const AGENT_BY_PLATFORM: Record<Platform, number> = {
  instagram: 1,
  facebook: 2,
  x: 3,
  tiktok: 4,
  telegram: 5,
  snapchat: 6,
  unknown: 0,
};

const PLATFORM_SET = new Set<string>(PLATFORMS);

/** Coerce an arbitrary platform string (e.g. from live extraction) to a known
 *  Platform, falling back to "unknown" so ingest never rejects on this field. */
export function coercePlatform(value: string): Platform {
  const v = value.trim().toLowerCase();
  return PLATFORM_SET.has(v) ? (v as Platform) : "unknown";
}

export function agentFor(platform: string): number {
  return AGENT_BY_PLATFORM[coercePlatform(platform)];
}

/** Map an authored FeedPost to the wire shape POSTed to /api/ingest. */
export function feedToScraped(post: FeedPost): ScrapedPost {
  return {
    agent_id: agentFor(post.platform),
    post_link: post.postLink,
    post_username: post.username,
    post_caption: post.caption,
    post_date: post.postDate,
    platform: post.platform,
  };
}
