// PHASE-0 MOCK fixtures. Lets the dashboard (WT-A) and scraper (WT-D) build
// against live-but-fake endpoints with the real response shapes. WT-B deletes
// this file when it wires the route handlers to Redis + embeddings.
import { postIdFromLink } from "./ids";
import { computeRisk, detectHeuristics } from "./scoring";
import type { CorpusStats, Paginated, Post } from "./types";

function makeMockPost(args: {
  agentId: number;
  link: string;
  user: string;
  caption: string;
  date: string;
  platform: Post["platform"];
  rawCosine: number;
  status?: Post["approvalStatus"];
}): Post {
  const hits = detectHeuristics(args.caption);
  const matched = args.rawCosine >= 0.5;
  const risk = computeRisk({
    rawCosine: args.rawCosine,
    hits,
    matchedTermId: matched ? "corpus:seed:m30" : null,
    matchedTermText: matched ? "M30. blues, blue M30, dirty thirty" : null,
  });
  const now = new Date().toISOString();
  return {
    id: postIdFromLink(args.link),
    agentId: args.agentId,
    postLink: args.link,
    username: args.user,
    caption: args.caption,
    platform: args.platform,
    postDate: args.date,
    ingestedAt: now,
    scoredAt: risk.scoredAt,
    risk,
    riskScore: risk.score,
    flagged: risk.flagged,
    approvalStatus: args.status ?? "pending",
    approvedAt: args.status === "approved" ? now : null,
    corpusEntryId: null,
  };
}

export const MOCK_POSTS: Post[] = [
  makeMockPost({
    agentId: 1,
    link: "https://instagram.com/p/mock-aaa",
    user: "@trapstar.plug",
    caption: "restockd 🍃 loud + zaza, blue M30 blues back 💊 hmu on telegram to order, cashapp ready",
    date: "2026-06-19T18:22:00Z",
    platform: "instagram",
    rawCosine: 0.87,
  }),
  makeMockPost({
    agentId: 1,
    link: "https://instagram.com/p/mock-bbb",
    user: "@scriptpharma_",
    caption: "got percs and addy, pressed clean 💊 dm me on signal, $40 each",
    date: "2026-06-19T15:04:00Z",
    platform: "instagram",
    rawCosine: 0.82,
  }),
  makeMockPost({
    agentId: 2,
    link: "https://facebook.com/p/mock-ccc",
    user: "@nightowl.menu",
    caption: "plug back open, menu dropping tonight 🔌 tap in",
    date: "2026-06-18T23:41:00Z",
    platform: "facebook",
    rawCosine: 0.74,
  }),
  makeMockPost({
    agentId: 2,
    link: "https://instagram.com/p/mock-ddd",
    user: "@granolabakes",
    caption: "blueberry muffins fresh out the oven 🫐 hmu if you want the recipe",
    date: "2026-06-18T12:10:00Z",
    platform: "instagram",
    rawCosine: 0.34,
  }),
  makeMockPost({
    agentId: 1,
    link: "https://instagram.com/p/mock-eee",
    user: "@studioprints",
    caption: "new art drop this weekend, dm for prints 🎨",
    date: "2026-06-17T09:30:00Z",
    platform: "instagram",
    rawCosine: 0.21,
  }),
  makeMockPost({
    agentId: 2,
    link: "https://facebook.com/p/mock-fff",
    user: "@coach.daniela",
    caption: "leg day done 💪 grabbing a smoothie, who's training tmrw",
    date: "2026-06-17T07:55:00Z",
    platform: "facebook",
    rawCosine: 0.16,
  }),
];

export function mockPostsPage(limit = 50, offset = 0): Paginated<Post> {
  const sorted = [...MOCK_POSTS].sort((a, b) => b.riskScore - a.riskScore);
  return {
    items: sorted.slice(offset, offset + limit),
    total: MOCK_POSTS.length,
    limit,
    offset,
  };
}

export function findMockPost(id: string): Post | undefined {
  return MOCK_POSTS.find((p) => p.id === id) ?? MOCK_POSTS[0];
}

export const MOCK_CORPUS_STATS: CorpusStats = { size: 47, seed: 45, approved: 2 };
