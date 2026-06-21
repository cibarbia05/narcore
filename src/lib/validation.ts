// Request validation schemas (zod v4). Route handlers parse with these and
// return 400 { error: { code: "validation_error", details } } on failure.
import { z } from "zod";

export const scrapedPostSchema = z.object({
  agent_id: z.number().int(),
  post_link: z.string().min(1),
  post_username: z.string().min(1),
  // Allow empty captions (image-only posts exist); such posts score heuristics-only.
  post_caption: z.string(),
  post_date: z.string().min(1),
  platform: z.string().optional(),
});

export const decisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export const outreachSchema = z.object({
  channel: z.enum(["email", "platform_report"]).optional(),
});

export const rescoreSchema = z.object({
  scope: z.enum(["pending", "all"]).optional(),
  ids: z.array(z.string()).optional(),
});

export const scrapeSchema = z.object({
  live: z.boolean().optional(),
});

export const startRunSchema = z.object({
  agentCount: z.number().int().min(1).max(20).optional(),
  // Instagram hashtags (no leading '#'); defaults derive from the seed corpus.
  tags: z.array(z.string().min(1)).max(20).optional(),
});

export const startOperationSchema = z.object({
  // The flagged post (lead) to engage. The seller handle is derived from it.
  postId: z.string().min(1),
  // Optional explicit target handle override; still allowlist-checked server-side.
  targetHandle: z.string().min(1).optional(),
});

export type ScrapedPostInput = z.infer<typeof scrapedPostSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type OutreachInput = z.infer<typeof outreachSchema>;
export type RescoreInput = z.infer<typeof rescoreSchema>;
export type ScrapeInput = z.infer<typeof scrapeSchema>;
export type StartRunInput = z.infer<typeof startRunSchema>;
export type StartOperationInput = z.infer<typeof startOperationSchema>;
