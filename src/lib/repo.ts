// Post + corpus repository — the Redis data layer for WT-B.
//
// Builds on the seams in `redis.ts` (client, indexes, float32ToBuffer) and the
// pure modules (`embeddings`, `scoring`, `ids`). Owns: post hash (de)serialization,
// the FT.SEARCH-backed post feed, corpus KNN + the sliding-window TTL learning loop,
// the seed loader, and the small error→Response helpers every route shares.
//
// Binary note (node-redis v6): a default `hGetAll` decodes every field as UTF-8,
// which corrupts stored FLOAT32 vectors. We therefore NEVER read a vector back
// through a hash read — KNN returns only scalar RETURN fields, and rescore re-embeds
// (the deterministic mock/live embedder yields the same vector). Vectors are write-only.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { RESP_TYPES } from "redis";

import {
  EmbeddingDimError,
  EmbeddingUnavailableError,
  embed,
  embedBatch,
  embeddingsConfigured,
} from "./embeddings";
import { slugify } from "./ids";
import { projectVectors } from "./projection";
import { computeRisk, detectHeuristics } from "./scoring";
import {
  CORPUS_APPROVED_PREFIX,
  CORPUS_FIELD_PREFIX,
  CORPUS_INDEX,
  CORPUS_SEED_PREFIX,
  CORPUS_TTL_SECONDS,
  POST_PREFIX,
  POSTS_INDEX,
  connectRedis,
  ensureIndexes,
  float32ToBuffer,
} from "./redis";
import type {
  ApiError,
  ApprovalStatus,
  CorpusSource,
  CorpusStats,
  Paginated,
  Platform,
  Post,
  RiskBreakdown,
  SemanticDriftPoint,
  SemanticDriftResponse,
  SemanticNeighbor,
  SemanticNeighborsResponse,
  SemanticPointKind,
  SeedDataset,
  SuspiciousTerm,
} from "./types";

// ----- types -----

/** A nearest-neighbor corpus hit (the "why" behind a score). Vector excluded. */
export interface Neighbor {
  id: string; // redis key, e.g. "corpus:seed:m30" | "corpus:approved:<postId>"
  distance: number; // COSINE distance; similarity = 1 - distance
  source: CorpusSource;
  text: string;
  category: string;
  drug: string | null;
  note: string | null;
}

export interface PostFilters {
  status?: ApprovalStatus;
  flagged?: boolean;
  platform?: Platform;
  q?: string;
  minScore?: number;
  maxScore?: number;
  sort?: "riskScore" | "postDateTs" | "ingestedAtTs";
  order?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
}

// ----- post hash (de)serialization -----

/** Flatten a Post into Redis hash fields (all strings; nested risk -> riskJson). */
export function postToHash(post: Post): Record<string, string> {
  return {
    id: post.id,
    agentId: String(post.agentId),
    postLink: post.postLink,
    username: post.username,
    caption: post.caption,
    platform: post.platform,
    postDate: post.postDate,
    ingestedAt: post.ingestedAt,
    scoredAt: post.scoredAt,
    postDateTs: String(epochMs(post.postDate)),
    ingestedAtTs: String(epochMs(post.ingestedAt)),
    riskScore: String(post.riskScore),
    flagged: post.flagged ? "true" : "false",
    approvalStatus: post.approvalStatus,
    approvedAt: post.approvedAt ?? "",
    corpusEntryId: post.corpusEntryId ?? "",
    riskJson: JSON.stringify(post.risk),
  };
}

/** Rehydrate a Post from a hash (hGetAll) or an FT.SEARCH document value.
 *  Tolerant of string|number|null field values; ignores the binary `queryVector`. */
export function hashToPost(h: Record<string, unknown>): Post {
  const risk = JSON.parse(field(h, "riskJson")) as RiskBreakdown;
  return {
    id: field(h, "id"),
    agentId: toNumber(field(h, "agentId")),
    postLink: field(h, "postLink"),
    username: field(h, "username"),
    caption: field(h, "caption"),
    platform: (field(h, "platform") || "unknown") as Platform,
    postDate: field(h, "postDate"),
    ingestedAt: field(h, "ingestedAt"),
    scoredAt: field(h, "scoredAt"),
    risk,
    riskScore: toNumber(field(h, "riskScore")),
    flagged: field(h, "flagged") === "true",
    approvalStatus: (field(h, "approvalStatus") || "pending") as ApprovalStatus,
    approvedAt: field(h, "approvedAt") || null,
    corpusEntryId: field(h, "corpusEntryId") || null,
  };
}

// ----- posts -----

/** Upsert a post hash (+ optional non-indexed binary query vector). */
export async function savePost(post: Post, queryVec?: number[]): Promise<void> {
  const client = await connectRedis();
  await ensureIndexes();
  const key = POST_PREFIX + post.id;
  await client.hSet(key, postToHash(post));
  if (queryVec && queryVec.length > 0) {
    await client.hSet(key, "queryVector", float32ToBuffer(queryVec));
  }
}

export async function getPost(id: string): Promise<Post | null> {
  const client = await connectRedis();
  const h = await client.hGetAll(POST_PREFIX + id);
  if (!h || Object.keys(h).length === 0) return null;
  return hashToPost(h as Record<string, unknown>);
}

/** Paginated, filtered, sorted post feed via idx:posts. */
export async function listPosts(f: PostFilters): Promise<Paginated<Post>> {
  const client = await connectRedis();
  await ensureIndexes();

  const limit = f.limit ?? 50;
  const offset = f.offset ?? 0;
  const query = buildPostQuery(f);

  const reply = await client.ft.search(POSTS_INDEX, query, {
    SORTBY: { BY: f.sort ?? "riskScore", DIRECTION: f.order ?? "DESC" },
    LIMIT: { from: offset, size: limit },
    DIALECT: 2,
  });

  return {
    items: reply.documents.map((d) => hashToPost(d.value as Record<string, unknown>)),
    total: reply.total,
    limit,
    offset,
  };
}

function buildPostQuery(f: PostFilters): string {
  const parts: string[] = [];
  if (f.status) parts.push(`@approvalStatus:{${f.status}}`);
  if (f.flagged !== undefined) parts.push(`@flagged:{${f.flagged ? "true" : "false"}}`);
  if (f.platform) parts.push(`@platform:{${escapeTag(f.platform)}}`);
  if (f.minScore !== undefined || f.maxScore !== undefined) {
    const min = f.minScore ?? 0;
    const max = f.maxScore ?? 1;
    parts.push(`@riskScore:[${min} ${max}]`);
  }
  const q = sanitizeText(f.q);
  if (q) parts.push(`(@caption:${q}* | @username:${q}*)`);
  return parts.length > 0 ? parts.join(" ") : "*";
}

// ----- corpus KNN + learning loop -----

/** Top-k nearest corpus vectors (cosine). Empty corpus -> []. (Build sheet §2.) */
export async function corpusKnn(queryVec: number[], k = 3): Promise<Neighbor[]> {
  const client = await connectRedis();
  await ensureIndexes();
  const reply = await client.ft.search(CORPUS_INDEX, `*=>[KNN ${k} @vector $BLOB AS score]`, {
    PARAMS: { BLOB: float32ToBuffer(queryVec) },
    SORTBY: "score", // distance ASC => most similar first
    DIALECT: 2,
    RETURN: ["score", "source", "text", "category", "drug", "note"],
    LIMIT: { from: 0, size: k },
  });
  return reply.documents.map((d) => {
    const v = d.value as Record<string, unknown>;
    return {
      id: d.id,
      distance: Number(v.score),
      source: (String(v.source ?? "") as CorpusSource) || "seed",
      text: v.text != null ? String(v.text) : "",
      category: v.category != null ? String(v.category) : "",
      drug: v.drug ? String(v.drug) : null,
      note: v.note ? String(v.note) : null,
    };
  });
}

/** Write a human-approved caption as a learned vector with a sliding-window TTL.
 *  Returns the corpus key (becomes the post's corpusEntryId). */
export async function addApprovedEntry(post: Post, docVec: number[]): Promise<string> {
  const client = await connectRedis();
  const key = CORPUS_APPROVED_PREFIX + post.id;
  const now = new Date().toISOString();
  await client.hSet(key, {
    source: "approved",
    text: post.caption,
    category: "learned",
    drug: "",
    note: "",
    postDate: post.postDate,
    sourcePostId: post.id,
    createdAt: now,
    lastUsed: now,
  });
  await client.hSet(key, "vector", float32ToBuffer(docVec));
  await client.expire(key, CORPUS_TTL_SECONDS);
  return key;
}

/** Reverse an approval: drop the learned vector. `corpusEntryId` is the full key. */
export async function removeApprovedEntry(corpusEntryId: string): Promise<void> {
  const client = await connectRedis();
  await client.del(corpusEntryId);
}

/** Write a coded term a confirmed operation extracted from the seller's messages
 *  as a learned FIELD vector with a sliding-window TTL. Lands in idx:corpus (same
 *  HASH prefix `corpus:`) so it immediately becomes a KNN neighbor for detection —
 *  no index change. Returns the corpus key. Caller is responsible for provenance
 *  gating + near-duplicate de-dup (see field-intel.ts). */
export async function addFieldEntry(
  opId: string,
  term: string,
  drug: string | null,
  note: string | null,
  docVec: number[],
): Promise<string> {
  const client = await connectRedis();
  const key = `${CORPUS_FIELD_PREFIX}${slugify(term)}-${opId}`;
  const now = new Date().toISOString();
  await client.hSet(key, {
    source: "field",
    text: term,
    category: "field",
    drug: drug ?? "",
    note: note ?? "",
    postDate: "",
    sourcePostId: "",
    sourceOpId: opId,
    createdAt: now,
    lastUsed: now,
  });
  await client.hSet(key, "vector", float32ToBuffer(docVec));
  await client.expire(key, CORPUS_TTL_SECONDS);
  return key;
}

/** Sliding-window LRU: refresh TTL + lastUsed for every approved neighbor matched. */
export async function touchApprovedNeighbors(neighbors: Neighbor[]): Promise<void> {
  const approved = neighbors.filter((n) => n.id.startsWith(CORPUS_APPROVED_PREFIX));
  if (approved.length === 0) return;
  const client = await connectRedis();
  const now = new Date().toISOString();
  await Promise.all(
    approved.flatMap((n) => [
      client.expire(n.id, CORPUS_TTL_SECONDS),
      client.hSet(n.id, "lastUsed", now),
    ]),
  );
}

/** Idempotent seed upsert keyed by slug(term). Seeds never expire (no TTL). */
export async function upsertSeedEntry(term: SuspiciousTerm, docVec: number[]): Promise<void> {
  const client = await connectRedis();
  const key = CORPUS_SEED_PREFIX + slugify(term.term);
  const now = new Date().toISOString();
  await client.hSet(key, {
    source: "seed",
    text: seedDocText(term),
    category: term.category,
    drug: term.drug,
    note: term.note ?? "",
    postDate: "",
    sourcePostId: "",
    createdAt: now,
    lastUsed: now,
  });
  await client.hSet(key, "vector", float32ToBuffer(docVec));
}

/** Corpus counts by `source` TAG. */
export async function corpusStats(): Promise<CorpusStats> {
  const client = await connectRedis();
  await ensureIndexes();
  const [seed, approved, field] = await Promise.all([
    countCorpus("seed"),
    countCorpus("approved"),
    countCorpus("field"),
  ]);
  return { size: seed + approved + field, seed, approved, field };

  async function countCorpus(source: CorpusSource): Promise<number> {
    const reply = await client.ft.search(CORPUS_INDEX, `@source:{${source}}`, {
      LIMIT: { from: 0, size: 0 },
      DIALECT: 2,
    });
    return reply.total;
  }
}

/** Drug label of a matched corpus entry (for lead-summary enrichment). */
export async function getCorpusEntryDrug(corpusKey: string | null): Promise<string | null> {
  if (!corpusKey) return null;
  const client = await connectRedis();
  const drug = await client.hGet(corpusKey, "drug");
  return drug ? String(drug) : null;
}

// ----- semantic drift visualization -----

interface RedisVectorEntry {
  id: string;
  kind: SemanticPointKind;
  label: string;
  text: string;
  category: string;
  drug: string | null;
  riskScore: number | null;
  flagged: boolean | null;
  vector: number[];
}

const SEMANTIC_CORPUS_LIMIT = 120;
const SEMANTIC_POST_LIMIT = 120;

/** Read a bounded vector snapshot and project it server-side for visualization.
 *  Raw 768-dim vectors stay on the server; the client only receives 2D points. */
export async function semanticDriftSnapshot(): Promise<SemanticDriftResponse> {
  const client = await connectRedis();
  await ensureIndexes();

  const [corpusReply, postsReply] = await Promise.all([
    client.ft.search(CORPUS_INDEX, "*", {
      RETURN: ["source", "text", "category", "drug", "note"],
      LIMIT: { from: 0, size: SEMANTIC_CORPUS_LIMIT },
      DIALECT: 2,
    }),
    client.ft.search(POSTS_INDEX, "*", {
      SORTBY: { BY: "riskScore", DIRECTION: "DESC" },
      RETURN: ["id", "username", "caption", "platform", "riskScore", "flagged"],
      LIMIT: { from: 0, size: SEMANTIC_POST_LIMIT },
      DIALECT: 2,
    }),
  ]);

  const binaryClient = client.withTypeMapping({
    [RESP_TYPES.BLOB_STRING]: Buffer,
  });

  const [corpusEntries, postEntries]: [
    Array<RedisVectorEntry | null>,
    Array<RedisVectorEntry | null>,
  ] = await Promise.all([
    Promise.all(
      corpusReply.documents.map(async (doc) => {
        const value = doc.value as Record<string, unknown>;
        const vector = await readVector(binaryClient, doc.id, "vector");
        if (!vector) return null;
        const raw = String(value.source ?? "");
        const source: SemanticPointKind =
          raw === "approved" ? "approved" : raw === "field" ? "field" : "seed";
        const text = String(value.text ?? "");
        return {
          id: doc.id,
          kind: source,
          label:
            source === "approved"
              ? "Learned Caption"
              : source === "field"
                ? "Field Intel"
                : seedLabel(text),
          text,
          category: String(value.category ?? ""),
          drug: value.drug ? String(value.drug) : null,
          riskScore: null,
          flagged: null,
          vector,
        } satisfies RedisVectorEntry;
      }),
    ),
    Promise.all(
      postsReply.documents.map(async (doc) => {
        const value = doc.value as Record<string, unknown>;
        const vector = await readVector(binaryClient, doc.id, "queryVector");
        if (!vector) return null;
        const username = String(value.username ?? "Unknown");
        const platform = String(value.platform ?? "unknown");
        return {
          id: doc.id,
          kind: "post",
          label: username,
          text: String(value.caption ?? ""),
          category: platform,
          drug: null,
          riskScore: toNumber(field(value, "riskScore")),
          flagged: field(value, "flagged") === "true",
          vector,
        } satisfies RedisVectorEntry;
      }),
    ),
  ]);

  const entries = [...corpusEntries, ...postEntries].filter(isVectorEntry);
  const points = projectEntries(entries);
  return {
    points,
    stats: {
      seed: points.filter((point) => point.kind === "seed").length,
      approved: points.filter((point) => point.kind === "approved").length,
      posts: points.filter((point) => point.kind === "post").length,
    },
    embeddingLive: embeddingsConfigured(),
    generatedAt: new Date().toISOString(),
  };
}

/** Real cosine-KNN neighbors for one post + its persisted risk breakdown — the
 *  explainable "why this scored high". The query vector stays on the server; only
 *  the matched corpus ids and cosine scores are returned. */
export async function postNeighbors(
  postId: string,
  k = 5,
): Promise<SemanticNeighborsResponse | null> {
  // Map point ids are full Redis keys ("post:<hash>"); getPost/readVector add the
  // prefix themselves, so strip it to avoid a double prefix.
  const bareId = postId.startsWith(POST_PREFIX)
    ? postId.slice(POST_PREFIX.length)
    : postId;
  const post = await getPost(bareId);
  if (!post) return null;

  const client = await connectRedis();
  const binaryClient = client.withTypeMapping({ [RESP_TYPES.BLOB_STRING]: Buffer });
  const queryVec = await readVector(binaryClient, POST_PREFIX + bareId, "queryVector");
  if (!queryVec) return { neighbors: [], risk: post.risk };

  const neighbors: SemanticNeighbor[] = (await corpusKnn(queryVec, k)).map((n) => ({
    id: n.id,
    text: n.text,
    drug: n.drug,
    source: n.source,
    cosine: Math.round((1 - n.distance) * 1000) / 1000,
  }));
  return { neighbors, risk: post.risk };
}

async function readVector(
  client: { hGet(key: string, field: string): Promise<unknown> },
  key: string,
  fieldName: string,
): Promise<number[] | null> {
  const raw = (await client.hGet(key, fieldName)) as Buffer | null;
  if (!raw || raw.length % 4 !== 0) return null;
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const vector = new Array<number>(raw.length / 4);
  for (let offset = 0; offset < raw.length; offset += 4) {
    vector[offset / 4] = view.getFloat32(offset, true);
  }
  return vector;
}

function isVectorEntry(entry: RedisVectorEntry | null): entry is RedisVectorEntry {
  return entry !== null;
}

function projectEntries(entries: RedisVectorEntry[]): SemanticDriftPoint[] {
  const coords = new Map(
    projectVectors(entries.map((e) => ({ id: e.id, vector: e.vector }))).map((p) => [
      p.id,
      p,
    ]),
  );
  return entries.map((entry) => {
    const point = coords.get(entry.id);
    return {
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      text: entry.text,
      category: entry.category,
      drug: entry.drug,
      x: point?.x ?? 0,
      y: point?.y ?? 0,
      riskScore: entry.riskScore,
      flagged: entry.flagged,
    };
  });
}

function seedLabel(text: string): string {
  const [term] = text.split(".");
  return term?.trim() || "Seed Term";
}

// ----- scoring orchestration (ingest + rescore) -----

export interface ScoreResult {
  risk: RiskBreakdown;
  queryVec: number[];
  matchedDrug: string | null;
}

/** Embed (or reuse) the caption, KNN the corpus, refresh matches, compute risk. */
export async function scorePost(caption: string, reuseVec?: number[]): Promise<ScoreResult> {
  const queryVec = reuseVec ?? (await embed(caption, "query")); // EmbeddingDimError -> 422
  const neighbors = await corpusKnn(queryVec, 3);
  await touchApprovedNeighbors(neighbors); // sliding-window eviction
  const top = neighbors[0];
  const risk = computeRisk({
    rawCosine: top ? 1 - top.distance : 0,
    hits: detectHeuristics(caption),
    matchedTermId: top?.id ?? null,
    matchedTermText: top?.text ?? null,
  });
  return { risk, queryVec, matchedDrug: top?.drug ?? null };
}

// ----- seed loader (shared by scripts/seed.ts and POST /api/seed) -----

/** Embed the seed dataset as documents and upsert each. Idempotent. */
export async function seedCorpus(): Promise<{ loaded: number; skipped: number }> {
  const dataset = readSeedDataset();
  await ensureIndexes();
  const texts = dataset.terms.map(seedDocText);
  const vectors = await embedBatch(texts, "document"); // chunked internally
  for (let i = 0; i < dataset.terms.length; i++) {
    await upsertSeedEntry(dataset.terms[i], vectors[i]);
  }
  return { loaded: dataset.terms.length, skipped: 0 };
}

function readSeedDataset(): SeedDataset {
  const raw = readFileSync(join(process.cwd(), "data", "seed-terms.json"), "utf8");
  return JSON.parse(raw) as SeedDataset;
}

/** The embedded/stored text for a seed term (term + aliases + note). */
function seedDocText(term: SuspiciousTerm): string {
  return `${term.term}. ${term.aliases?.join(", ") ?? ""} ${term.note ?? ""}`.trim();
}

// ----- health helpers -----

export async function pingRedis(): Promise<boolean> {
  try {
    const client = await connectRedis();
    return (await client.ping()) === "PONG";
  } catch {
    return false;
  }
}

export async function postCount(): Promise<number> {
  const client = await connectRedis();
  await ensureIndexes();
  const reply = await client.ft.search(POSTS_INDEX, "*", { LIMIT: { from: 0, size: 0 } });
  return reply.total;
}

// ----- decision concurrency guard -----

export async function acquireDecisionLock(postId: string): Promise<boolean> {
  const client = await connectRedis();
  const res = await client.set(`lock:decision:${postId}`, "1", { NX: true, PX: 5000 });
  return res === "OK";
}

export async function releaseDecisionLock(postId: string): Promise<void> {
  const client = await connectRedis();
  await client.del(`lock:decision:${postId}`);
}

// ----- ingest helpers -----

/** Infer the platform from a post URL when the scraper omits it. */
export function inferPlatformFromLink(link: string): Platform {
  const l = link.toLowerCase();
  if (l.includes("instagram.")) return "instagram";
  if (l.includes("facebook.") || l.includes("fb.")) return "facebook";
  if (l.includes("tiktok.")) return "tiktok";
  if (l.includes("t.me/") || l.includes("telegram.")) return "telegram";
  if (l.includes("snapchat.")) return "snapchat";
  if (l.includes("twitter.") || l.includes("x.com")) return "x";
  return "unknown";
}

// ----- API error mapping (shared by every route) -----

export function jsonError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): Response {
  const body: ApiError = {
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return Response.json(body, { status });
}

/** Map domain/connection errors to the right ApiError envelope + status. */
export function errorResponse(err: unknown): Response {
  if (err instanceof EmbeddingDimError) {
    return jsonError("unprocessable", err.message, 422);
  }
  if (err instanceof EmbeddingUnavailableError) {
    return jsonError("dependency_unavailable", err.message, 503);
  }
  if (isRedisUnavailable(err)) {
    return jsonError("dependency_unavailable", "redis unavailable", 503);
  }
  const message = err instanceof Error ? err.message : "internal error";
  return jsonError("internal_error", message, 500);
}

function isRedisUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /Connection|Socket|ClientClosed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connect/i.test(
    `${err.name} ${err.message}`,
  );
}

// ----- small field helpers -----

function field(h: Record<string, unknown>, key: string): string {
  const v = h[key];
  return v === undefined || v === null ? "" : String(v);
}

function toNumber(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function epochMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** RediSearch TAG values escape `-`, `.`, spaces, etc. Platforms are simple, but be safe. */
function escapeTag(value: string): string {
  return value.replace(/([,.<>{}[\]"':;!@#$%^&*()\-+=~ ])/g, "\\$1");
}

/** Keep only alphanumerics/spaces for the free-text query (prefix match). */
function sanitizeText(q: string | undefined): string {
  if (!q) return "";
  return q.replace(/[^a-zA-Z0-9 ]+/g, " ").trim();
}
