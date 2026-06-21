# WT-B — Core API + Redis + Scoring + Seed + Outreach

> Read `SPEC.md` §5 (shared contracts) first. This sheet is the full build blueprint
> for the backend. You own the heaviest package; everything else mocks against your API.

## Scope & owned files

```
src/app/api/**/route.ts        # fill in the Phase-0 mock skeletons (except api/scrape -> WT-D)
src/lib/redis.ts               # extend (already has client, indexes, float32ToBuffer)
src/lib/embeddings.ts          # already complete (swappable client) — use as-is
src/lib/scoring.ts             # already complete (computeRisk/detectHeuristics) — use as-is
src/lib/repo.ts                # NEW — post + corpus repository (this sheet)
src/lib/outreach.ts            # NEW — LLM-drafted outreach (Anthropic + template fallback)
src/lib/lead-summary.ts        # already has buildLeadSummary/buildOutreachDraft — extend if needed
src/lib/validation.ts          # already has zod schemas — use as-is
scripts/seed.ts                # implement the loader
scripts/post-mock.ts           # already usable — leave or extend
```

Do **not** edit: `src/lib/types.ts` (frozen), `src/app/api/scrape/route.ts` (WT-D),
`docker-compose.yml` (WT-C), `package.json` deps (added in Phase 0: `redis`, `zod`,
`@anthropic-ai/sdk`).

## Delete on first wire-up

`src/lib/mock.ts` and all `import ... from "@/lib/mock"` in the route handlers — replace
with real repo calls.

---

## 1. Post hash layout (`post:{id}`)

Redis hashes are stringly-typed. Numbers → strings; booleans → `"true"`/`"false"`;
nested `risk` → one `riskJson` string field; optional query vector → binary field.

| Field | Source | Notes |
|---|---|---|
| `id agentId postLink username caption platform postDate ingestedAt scoredAt` | `Post` | strings (agentId stringified) |
| `postDateTs` `ingestedAtTs` | `Date.parse(...)` epoch ms | NUMERIC index sort |
| `riskScore` | `post.riskScore` | stringified float; NUMERIC index |
| `flagged` | `"true"`/`"false"` | TAG index |
| `approvalStatus` | union | TAG index |
| `approvedAt` `corpusEntryId` | nullable → `""` when null | |
| `riskJson` | `JSON.stringify(post.risk)` | rehydrate `RiskBreakdown` on read |
| `queryVector` | `float32ToBuffer(vec)` | OPTIONAL, non-indexed; store to enable rescore-without-re-embed |

## 2. `src/lib/repo.ts` — required signatures

```ts
export interface Neighbor {
  id: string;        // redis key, e.g. "corpus:seed:m30" | "corpus:approved:<postId>"
  distance: number;  // COSINE distance; cosine similarity = 1 - distance
  source: CorpusSource;
  text: string; category: string; drug: string | null; note: string | null;
}

// posts
export function postToHash(post: Post): Record<string, string | Buffer>;
export function hashToPost(h: Record<string, string>): Post;          // JSON.parse riskJson
export async function savePost(post: Post, queryVec?: number[]): Promise<void>;  // hSet + EXPIRE n/a
export async function getPost(id: string): Promise<Post | null>;       // hGetAll -> hashToPost
export async function listPosts(f: PostFilters): Promise<Paginated<Post>>;       // FT.SEARCH idx:posts

// corpus
export async function corpusKnn(queryVec: number[], k?: number): Promise<Neighbor[]>;
export async function addApprovedEntry(post: Post, docVec: number[]): Promise<string>; // returns corpus key
export async function removeApprovedEntry(corpusEntryId: string): Promise<void>;
export async function touchApprovedNeighbors(neighbors: Neighbor[]): Promise<void>;     // EXPIRE refresh
export async function upsertSeedEntry(term: SuspiciousTerm, docVec: number[]): Promise<void>;
export async function corpusStats(): Promise<CorpusStats>;             // counts by `source` TAG
```

### corpusKnn (node-redis v6 FT.SEARCH — exact reply shape)

`ft.search` returns `{ total: number, documents: Array<{ id: string, value: Record<string, string|number|null> }> }`.

```ts
export async function corpusKnn(queryVec: number[], k = 3): Promise<Neighbor[]> {
  const client = await connectRedis();
  await ensureIndexes();
  const reply = await client.ft.search(CORPUS_INDEX, `*=>[KNN ${k} @vector $BLOB AS score]`, {
    PARAMS: { BLOB: float32ToBuffer(queryVec) },
    SORTBY: "score",            // distance ASC => most similar first
    DIALECT: 2,
    RETURN: ["score", "source", "text", "category", "drug", "note"],
    LIMIT: { from: 0, size: k },
  });
  return reply.documents.map((d) => ({
    id: d.id,
    distance: Number(d.value.score),
    source: (String(d.value.source) as CorpusSource) || "seed",
    text: String(d.value.text ?? ""),
    category: String(d.value.category ?? ""),
    drug: d.value.drug ? String(d.value.drug) : null,
    note: d.value.note ? String(d.value.note) : null,
  }));
}
// Empty corpus -> documents:[] -> [] (cold start). rawCosine = neighbors[0] ? 1 - distance : 0.
```

### Corpus entry hash + TTL

`addApprovedEntry`: key `corpus:approved:{post.id}`; `hSet` { source:"approved", text:caption,
category:"learned", drug:"", note:"", postDate, sourcePostId:post.id, createdAt, lastUsed,
vector: float32ToBuffer(docVec) }; then `client.expire(key, CORPUS_TTL_DAYS*86400)`.
`upsertSeedEntry`: key `corpus:seed:{slugify(term.term)}`; same fields, source:"seed", **no EXPIRE**.
`touchApprovedNeighbors`: for each neighbor whose id startsWith `corpus:approved:`,
`client.expire(id, ttl)` + `hSet(id, "lastUsed", now)`.
`corpusStats`: `ft.search(CORPUS_INDEX, "@source:{seed}", {LIMIT:{from:0,size:0}})` for the seed
count, same for `{approved}`, `size = seed + approved`.

---

## 3. Scoring orchestration (used by ingest + rescore)

```ts
async function scorePost(caption: string, reuseVec?: number[]) {
  const queryVec = reuseVec ?? await embed(caption, "query");        // EmbeddingDimError -> 422
  const neighbors = await corpusKnn(queryVec, 3);
  await touchApprovedNeighbors(neighbors);                            // sliding-window eviction
  const top = neighbors[0];
  const risk = computeRisk({
    rawCosine: top ? 1 - top.distance : 0,
    hits: detectHeuristics(caption),
    matchedTermId: top?.id ?? null,
    matchedTermText: top?.text ?? null,
  });
  return { risk, queryVec, matchedDrug: top?.drug ?? null };
}
```

---

## 4. Endpoint implementations

Parse bodies with the `src/lib/validation.ts` zod schemas; on failure return
`400 { error: { code:"validation_error", message, details: parsed.error.issues } }`.
Wrap handlers so `EmbeddingUnavailableError` → 503, `EmbeddingDimError` → 422, Redis
connection errors → 503.

- **POST `/api/ingest`** — optional `Authorization: Bearer ${INGEST_API_KEY}` (enforce only if env set, else 401). `id = postIdFromLink(post_link)`. If `getPost(id)` exists → `200 { post, deduped:true }` (no re-embed). Else: infer `platform` from `post_link` if absent → `scorePost` → build `Post` (`approvalStatus:"pending"`) → `savePost(post, queryVec)` → `201 { post, deduped:false }`.
- **GET `/api/posts`** — `listPosts` via `idx:posts`. Build the FT query from `status/flagged/platform` (TAG: `@approvalStatus:{pending}` etc.), `q` (TEXT on caption/username), `minScore/maxScore` (`@riskScore:[min max]`). `SORTBY riskScore|postDateTs|ingestedAtTs` + order, `LIMIT {from:offset,size:limit}`. Map `documents -> hashToPost`. Empty query string → `"*"`.
- **GET `/api/posts/[id]`** — `getPost(id)` or 404.
- **POST `/api/posts/[id]/decision`** — validate `{decision}`. `getPost` or 404. Acquire `SET lock:decision:{id} 1 NX PX 5000` (skip-or-409 if not acquired; the `corpusEntryId` guard is the real safety). **approved**: if `post.corpusEntryId` already set → no-op return. Else `docVec = await embed(post.caption,"document")`; `corpusEntryId = await addApprovedEntry(post, docVec)`; set `approvalStatus:"approved"`, `approvedAt`, `corpusEntryId`; `savePost`. **rejected**: if `post.corpusEntryId` → `removeApprovedEntry`; clear `corpusEntryId`; set `approvalStatus:"rejected"`; `savePost`. Return `{ post }`.
- **GET `/api/posts/[id]/lead-summary`** — `getPost` → `buildLeadSummary(post)` (enrich `matchedKnownTermDrug` from the matched corpus entry's `drug` if you fetch it). `{ leadSummary }`.
- **POST `/api/posts/[id]/outreach`** — validate `{channel?}`. `getPost` → `buildLeadSummary` → `draftOutreach(summary, channel)` (§5). `{ leadSummary, draft, dispatched:false }`.
- **POST `/api/rescore`** — `{scope?:"pending"|"all", ids?}`. Select posts (SCAN `post:*` or `listPosts`), reuse stored `queryVector` (else re-embed), recompute `scorePost`, `savePost`. Return `{ rescored:n }`. Bounded (few hundred) → synchronous OK.
- **GET `/api/corpus`** — `corpusStats()`.
- **POST `/api/seed`** — run the seed loader logic (idempotent). `{ loaded, skipped }`.
- **GET `/api/health`** — `{ ok, redis: <PING ok>, embeddings: await pingEmbeddings(), corpusSize: corpusStats().size, postCount, modelVersion: MODEL_VERSION }`. 200 if ok else 503.

---

## 5. `src/lib/outreach.ts` — LLM-drafted outreach

```ts
import Anthropic from "@anthropic-ai/sdk";
import { buildOutreachDraft } from "./lead-summary";   // template fallback
import type { DraftedOutreach, LeadSummary } from "./types";

export async function draftOutreach(
  summary: LeadSummary,
  channel: DraftedOutreach["channel"] = "platform_report",
): Promise<DraftedOutreach> {
  const key = process.env.ANTHROPIC_API_KEY;
  const template = buildOutreachDraft(summary, channel);     // always have a fallback
  if (!key) return template;
  try {
    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: process.env.OUTREACH_MODEL ?? "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [{
        role: "user",
        content:
          "You are drafting a concise, factual lead-referral email to a platform Trust & Safety " +
          "team about a likely illicit-drug-advertising post. Be professional, non-accusatory, " +
          "and evidence-based. Use ONLY these facts:\n" + JSON.stringify(summary, null, 2) +
          "\nReturn only the email body.",
      }],
    });
    const text = msg.content.find((b) => b.type === "text");
    const body = text && "text" in text ? text.text.trim() : template.body;
    return { ...template, body };
  } catch {
    return template;   // never break the demo
  }
}
```

---

## 6. `scripts/seed.ts`

Read `data/seed-terms.json` (`SeedDataset`). `ensureIndexes()`. For each term build text
`` `${term}. ${aliases?.join(", ") ?? ""} ${note ?? ""}`.trim() ``. `embedBatch(texts,"document")`
in chunks. `upsertSeedEntry(term, vec)` (deterministic key → idempotent). Log `{loaded, skipped}`.
Exit 0. Verify: `pnpm seed` then `corpusStats().size === terms.length`.

---

## 7. Edge cases (must handle)

Empty corpus (semantic=0, never 500) · embedding sidecar down (503, scraper retries) ·
duplicate post (dedup 200) · dim mismatch (422) · index already exists (swallowed in
`ensureIndexes`) · concurrent approval (lock + `corpusEntryId` guard) · rescore reuses stored
vectors · negative/low cosine (SIM_FLOOR clamps) · approval reversal (delete corpus entry) ·
empty caption allowed (heuristics-only, s=0).

## 8. Definition of Done

`pnpm seed` builds `idx:corpus`; `pnpm post-mock` returns a real scored `Post`;
`GET /api/posts` lists from Redis; Approve adds a `corpus:approved:*` vector (visible in
RedisInsight 8001) and `GET /api/corpus` increments; `/api/rescore` re-flags a paraphrase;
`pnpm typecheck && pnpm build` green.

## 9. Verify

`docker compose up -d` → `pnpm seed` → `pnpm dev` → `pnpm post-mock` → inspect in RedisInsight
(`FT.SEARCH idx:corpus "*=>[KNN 3 @vector $b]"`), approve via `curl -XPOST
/api/posts/<id>/decision -d '{"decision":"approved"}'`, confirm corpus grew.
