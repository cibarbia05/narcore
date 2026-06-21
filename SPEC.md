# Narcore — System Specification

> AI-powered monitoring of digital illicit-drug advertising. Built for a hackathon;
> competing for the **Redis** (live vector search + a self-updating corpus) and
> **Browserbase** (live agentic scraping) tracks.

---

## 0. TL;DR

Drug advertising has moved from the dark web to social media, where sellers evade
static keyword filters with coded, misspelled slang, acronyms, and emojis — and
rotate terms the moment a filter catches on. **Narcore** embeds known drug slang into
a **Redis vector corpus**, scrapes social posts with **Browserbase**, scores each post
by **semantic similarity + explainable heuristics**, and lets a human approve true
positives — which **adds the approved caption's vector back into the corpus**, so the
system learns new coded terms as they drift. Flagged posts generate a **Lead Summary**
for law enforcement / platform Trust & Safety. The headline demo: approve a novel
coded term and watch near-duplicate posts light up live — a vector corpus that
*teaches itself*, which keyword filters cannot do.

---

## 1. Problem & Motivation

1.1 **The problem.** A majority of illicit drug advertising/sales now happens over
mainstream social media. Platform auto-detection is static keyword matching, easily
bypassed with coded language (e.g. `"restockd PRODUCT. hmu for PUFF 🍃"`).

1.2 **Why it's hard.** Sellers use misspellings, abbreviations, emojis, and innocent
"decoy" words. The moment a term is caught, they switch — **semantic drift** outpaces
static filters.

1.3 **Who it's for.** A law-enforcement / platform-safety analyst who needs a ranked,
explainable queue of likely drug-advertising accounts, with a one-click report to
accelerate takedown/investigation.

---

## 2. Goals & Non-Goals

**2.1 Goals**
- Seed a baseline corpus of known slang (DEA/SAMHSA-style) as embeddings in Redis.
- Scrape social posts (via Browserbase) and ingest them through a scoring pipeline.
- Score each post by semantic similarity to the corpus + explainable heuristics.
- Human-in-the-loop approval that **grows the corpus** (semantic-drift learning loop).
- Generate a Lead Summary + a drafted (simulated) outreach message for flagged posts.

**2.2 Non-Goals**
- No auth/RBAC/multi-tenant. No real takedowns or real outreach emails.
- No production-scale scraping of live platforms (we scrape a synthetic feed).
- No background workers/queues; ingest is synchronous at demo volume.

**2.3 Success criteria (demo)**
- Redis: show KNN over 768-dim vectors + a corpus that grows on approval and re-flags
  paraphrased posts.
- Browserbase: a live agentic session extracts posts from the synthetic feed into the
  pipeline in real time, with a fixture fallback.
- End on a Lead Summary for a flagged account.

---

## 3. System Architecture

**3.1 Components**
1. **Next.js app** — UI (dashboard + landing + synthetic feed) **and** the backend
   (Route Handlers under `src/app/api/**`). One deployable.
2. **Redis Stack** (container) — Query Engine vector search (`idx:corpus`) + the post
   feed index (`idx:posts`).
3. **Embedding sidecar** (container, WT-C) — llama.cpp serving `nomic-embed-text-v2-moe`
   on an OpenAI-compatible `POST /v1/embeddings`. Swappable; app falls back to a hosted
   endpoint, then to deterministic mock vectors.
4. **Browserbase scraper** (WT-D) — scrapes the synthetic `/feed` and POSTs each post
   to `/api/ingest`.

**3.2 Data flow**

```
 data/seed-terms.json ─► seed loader (WT-B) ─embed(search_document:)─┐
                                                                     ▼
 Browserbase (WT-D) ─scrape /feed─► POST /api/ingest (WT-B) ─embed(search_query:)─► FT.SEARCH KNN
        ▲ scrapes                          │                                            │ COSINE
   /feed mock page (WT-D)                  │ computeRisk(semantic + heuristics)         ▼
                                           ▼                                   Redis Stack (WT-C)
 Dashboard (WT-A) ◄─GET /api/posts─── post:{id} HASH                          idx:corpus (vectors)
   table · Approve toggle · Outreach · Lead Summary                          idx:posts (feed)
        │ approve                                                                   ▲
        └─POST /api/posts/[id]/decision ─► re-embed(search_document:) ─► add vector to corpus
                                            (semantic-drift learning loop) ────────┘
 Embedding sidecar (WT-C, llama.cpp) ◄── src/lib/embeddings.ts (selfhost → hosted → mock)
```

**3.3 Deployment view.** `pnpm dev` (Next) + `docker compose up` (Redis + embedding
sidecar). Browserbase is remote (API key). Cloud deploy is an optional stretch.

**3.4 The semantic-drift learning loop (the Redis-track story).** When an analyst
approves a post as real drug advertising, its caption is re-embedded with the
`search_document:` prefix and written as a new `corpus:approved:{postId}` vector with a
sliding-window TTL. Future posts that paraphrase that coded term now score higher.
Approved vectors that stop matching for `CORPUS_TTL_DAYS` are auto-evicted by Redis.

---

## 4. Tech Stack & Conventions

**4.1 Runtime.** Next.js 16.2.9 (App Router) · React 19 · TypeScript 5 (strict) ·
node-redis v6 · zod v4 · pnpm · tsx (scripts). Route Handlers are the backend.
Per-package deps locked in Phase 0: **SWR** (dashboard data layer), **@browserbasehq/stagehand**
(scraper), **@anthropic-ai/sdk** (outreach drafting).

**4.2 Frontend conventions** (inherit `brand.md`): dark-first, **single** warm-orange
accent, **monospace (Geist Mono) for metadata/counts/status**, design **tokens only**
(never hardcode colors — see `src/app/globals.css` OKLCH tokens), shadcn/ui (Base UI,
`base-nova` style), `cn()` from `@/lib/utils`, WCAG AA. Link-styled buttons use the
Base UI `render`/`nativeButton={false}` pattern. Path alias `@/* → src/*`. Dashboard data
fetching uses **SWR** (3s polling for live updates + optimistic mutations).

**4.3 Env vars.** See `.env.example` (canonical list). Everything runs in **mock mode**
with no values set. Key vars: `REDIS_URL`, `EMBEDDING_MODE` (auto|mock|live),
`EMBEDDING_API_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIM=768`, `NOMIC_API_URL/KEY`,
`RISK_THRESHOLD=0.7`, `CORPUS_TTL_DAYS=14`, `INGEST_API_KEY`, `BROWSERBASE_API_KEY`,
`BROWSERBASE_PROJECT_ID`, `MOCK_FEED_URL`, `ANTHROPIC_API_KEY`, `OUTREACH_MODEL`.

**4.4 Folder layout**

```
src/
  app/
    page.tsx                      # landing (exists)
    (dashboard)/dashboard/page.tsx# WT-A — dashboard (Phase-0 placeholder present)
    feed/                         # WT-D — synthetic social feed (scrape target)
    api/**/route.ts               # WT-B (+ scrape: WT-D) — Phase-0 mock skeletons present
  components/
    ui/                           # shadcn primitives (shared, added in Phase 0)
    dashboard/                    # WT-A — composite components
  lib/
    types.ts model.ts redis.ts embeddings.ts scoring.ts
    lead-summary.ts validation.ts ids.ts mock.ts   # shared contracts (Phase 0)
data/seed-terms.json              # seed corpus dataset
scripts/seed.ts scripts/post-mock.ts
infra/                            # WT-C — sidecar Docker + README
scraper/                          # WT-D — Browserbase flows + fixtures
docker-compose.yml  .env.example
```

---

## 5. Shared Contracts (the freeze — already on `main`)

All of §5 is implemented in Phase 0. Worktrees import these; do not change shapes
without coordinating (they are the integration seams).

**5.1 Domain types** — `src/lib/types.ts` (zero runtime imports). `Post`, `ScrapedPost`,
`RiskBreakdown`, `HeuristicHit`, `CorpusEntry`, `SuspiciousTerm`, `SeedDataset`,
`LeadSummary`, `DraftedOutreach`, `CorpusStats`, `Paginated<T>`, `IngestResponse`,
`HealthResponse`, `ApiError`, and the `Platform`/`ApprovalStatus`/`CorpusSource`/
`RiskBand` unions. `Post.id = sha1(post_link)` (idempotency/dedup). `riskScore`/`flagged`
are denormalized out of `risk` for indexing. **Vectors never appear in any client type.**

**5.2 REST API** (Route Handlers; JSON; zod-validated; `ApiError` envelope). Mock
skeletons live at the paths below — WT-B/WT-D replace the bodies (same shapes).

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/ingest` | `ScrapedPost` | `{ post:Post; deduped:boolean }` (201) |
| GET | `/api/posts` | — | `Paginated<Post>` (filters: `status,flagged,platform,q,minScore,maxScore`; `sort,order,limit≤200,offset`) |
| GET | `/api/posts/[id]` | — | `{ post:Post }` / 404 |
| POST | `/api/posts/[id]/decision` | `{ decision:"approved"\|"rejected" }` | `{ post:Post }` |
| GET | `/api/posts/[id]/lead-summary` | — | `{ leadSummary:LeadSummary }` |
| POST | `/api/posts/[id]/outreach` | `{ channel?:"email"\|"platform_report" }` | `{ leadSummary; draft:DraftedOutreach; dispatched:false }` |
| POST | `/api/rescore` | `{ scope?:"pending"\|"all"; ids?:string[] }` | `{ rescored:number }` |
| GET | `/api/corpus` | — | `CorpusStats` (`{ size, seed, approved }`) |
| POST | `/api/seed` | — | `{ loaded, skipped }` |
| GET | `/api/health` | — | `HealthResponse` (200/503) |
| POST | `/api/scrape` | `{ live?:boolean }` | `{ ingested:number }` (WT-D) |

Status codes: 400 `validation_error` (zod issues in `details`), 401, 404, 422
`unprocessable` (bad embedding), 503 `dependency_unavailable` (Redis/embeddings down).
Idempotency: ingest dedups by `sha1(post_link)`; decision guards on `corpusEntryId`; seed
upserts by deterministic id.

**5.3 Redis keyspace** — `src/lib/redis.ts`.

| Key | Type | Contents |
|---|---|---|
| `post:{id}` | HASH | flattened `Post` (+ `riskJson`, `postDateTs`/`ingestedAtTs` epoch-ms, optional binary `queryVector`) |
| `corpus:seed:{slug}` | HASH | seed `CorpusEntry` + binary `vector`; **no TTL** |
| `corpus:approved:{postId}` | HASH | learned `CorpusEntry` + binary `vector`; **TTL=CORPUS_TTL_DAYS**, refreshed on match |
| `lock:decision:{postId}` | STRING | optional `SET NX PX 5000` concurrency guard |

Indexes (created idempotently by `ensureIndexes()`):
- **`idx:corpus`** (`ON HASH PREFIX corpus:`) — TAG `source`,`category`; TEXT `text`;
  **VECTOR `vector` FLAT / FLOAT32 / DIM 768 / COSINE**. KNN:
  `"*=>[KNN 3 @vector $BLOB AS score]"`, `PARAMS:{BLOB: float32ToBuffer(v)}`,
  `SORTBY:"score"`, `DIALECT:2`. Redis returns COSINE **distance** → `rawCosine = 1 - distance`.
- **`idx:posts`** (`ON HASH PREFIX post:`) — NUMERIC `riskScore`,`postDateTs`,
  `ingestedAtTs` (SORTABLE); TAG `flagged`,`approvalStatus`,`platform`; TEXT `username`,`caption`.

Encode vectors with `float32ToBuffer()` (provided). **Eviction:** seeds never expire;
on each KNN match of an approved entry, `EXPIRE corpus:approved:{id} {ttl}` + update
`lastUsed` — sliding-window LRU, **no cron**.

**5.4 Embedding client** — `src/lib/embeddings.ts`. `embed(text,kind)`,
`embedBatch(texts,kind)`, `pingEmbeddings()`. `kind` is `"document"` (corpus/seed/
approved) or `"query"` (caption being scored); prefixes (`search_document:` /
`search_query:`) are applied **internally** — never pre-prefix. Asserts 768-dim
(`EmbeddingDimError`→422); 10s timeout (`EmbeddingUnavailableError`→503). Resolution:
self-host `EMBEDDING_API_URL` → hosted `NOMIC_API_URL` → deterministic normalized mock.

**5.5 Scoring** — `src/lib/scoring.ts` (pure; UI-importable). Replaces the brief's
inconsistent `distance*0.6-0.5`:

```
rawCosine = 1 - cosineDistance
s = clamp01((rawCosine - 0.30) / (1 - 0.30))           # SIM_FLOOR
h = min(0.25, Σ weightᵢ)                               # HEURISTIC_CAP
score = clamp01(0.80*s + 0.20*(h/0.25))                # W_SEM
flagged = score >= 0.70                                 # THRESHOLD
```

`detectHeuristics(caption)` scans coded-keyword/emoji/handoff/payment lexicons (each hit
carries a human `label`). `computeRisk(...)` returns the full `RiskBreakdown`
(incl. `detectedCodeWords`). `riskBand(score)`: `<0.70` low · `<0.85` elevated · `≥0.85`
high. Tune via the exported `SCORING` object / `RISK_THRESHOLD`.

**5.6 Seed corpus** — `data/seed-terms.json` (`SeedDataset`: `{version, source, terms:
SuspiciousTerm[]}`, ~45 entries). Loader embeds `` `${term}. ${aliases} ${note}` `` as a
**document** and writes `corpus:seed:{slug(term)}` (no TTL), idempotent.

**5.7 Mock conventions.** Every Phase-0 route returns typed mock data with the real
shapes (`src/lib/mock.ts`). `embed()` returns deterministic mock vectors when no provider
is configured, so the full pipeline runs on real Redis before the sidecar exists. WT-D
develops against the mock ingest first.

---

## 6. Work Packages (Worktrees)

**6.0 Rules.** Branch from the **`phase0` tag** (`git worktree add ../narcore-a -b wt-a phase0`).
Edit only files your package owns. All per-package deps (SWR, Stagehand, Anthropic SDK) and
shared `src/components/ui/*` landed in Phase 0 — add **no** others; if you truly need one, route
it through a fast `main` patch everyone rebases onto. Keep `main` green: every merge must pass
`pnpm install --frozen-lockfile && pnpm typecheck && pnpm build`.

**Each worktree has a detailed, self-contained build sheet — read it alongside this spec:**
- WT-A → `docs/worktrees/WT-A-dashboard.md` (components, SWR data layer, props, API calls)
- WT-B → `docs/worktrees/WT-B-core-api.md` (repo.ts signatures, hash layout, KNN parsing, outreach LLM, per-endpoint flows, edge cases)
- WT-C → `docs/worktrees/WT-C-embeddings.md` (llama.cpp compose recipe, GGUF pin, verify curl)
- WT-D → `docs/worktrees/WT-D-scraper.md` (feed DOM contract, mock-feed.json, Stagehand flow, fixture mode)

**6.1 WT-A · Dashboard UI** — owns `src/app/(dashboard)/**`, `src/components/dashboard/**`.
Depends on `types.ts`, `scoring.ts` (band labels), and the posts/decision/lead-summary/
outreach/corpus endpoints (mock or real — same shapes). Build the table (all states:
loading/empty/scored/approved), **row-darkening below threshold**, optimistic Approve
toggle, Outreach preview + export, Lead Summary dialog, and a corpus "learned" counter +
a **"Re-evaluate against learned terms"** button (calls `/api/rescore`). DoD: renders
real scored posts, matches `brand.md`, `typecheck`+`build` green.

**6.2 WT-B · Core API + Redis + Scoring + Seed + Outreach** — owns all `src/app/api/**`
(fills the mock skeletons), the real bodies of `src/lib/{redis,embeddings,scoring,
lead-summary,validation}.ts` plus a `src/lib/repo.ts` (post/corpus CRUD, `corpusKnn`,
TTL refresh, hash (de)serialization), and `scripts/{seed,post-mock}.ts`. Implements the
ingest→KNN→score→store pipeline, the decision learning loop, rescore, corpus stats, and
the LLM-drafted outreach (template fallback). Stays unblocked via mock vectors. DoD:
`pnpm seed` builds the corpus; the full pipeline runs on real Redis; `typecheck`+`build`
green.

**6.3 WT-C · Infra + Embedding sidecar** — owns `docker-compose.yml` (sole editor),
`infra/**`, `scripts/health-check.*`. Stand up llama.cpp serving `nomic-embed-text-v2-moe`
on OpenAI-compatible `/v1/embeddings` (768-dim). DoD: `docker compose up` brings up Redis
**and** the sidecar; `curl $EMBEDDING_API_URL` returns a 768-float vector; one-command
Windows bring-up documented. Integration = WT-B sets `EMBEDDING_API_URL`.

**6.4 WT-D · Scraper + Synthetic Feed (Browserbase)** — owns `src/app/feed/**` (the
synthetic feed page + `data/mock-feed.json` of coded + benign decoy posts),
`scraper/**` (Stagehand/`browse` flows + normalizer → `ScrapedPost`),
`src/app/api/scrape/route.ts`, `scripts/scrape-demo.ts`. Develops against the mock ingest;
ships a **fixture mode** (no network) for an offline demo fallback. DoD: `/feed` renders
realistic posts; a live Browserbase session extracts → normalizes → POSTs to `/api/ingest`
→ rows appear; fixture fallback works.

**Collision control:** deps + shared UI primitives + route skeletons all landed in
Phase 0; WT-D never edits `/api/ingest` (HTTP client only); WT-C is the only
`docker-compose.yml` editor; script filenames are pre-reserved; defer README/SPEC edits
to a single post-merge pass.

---

## 7. Milestones & Sequencing

- **Phase 0 (on `main`, tag `phase0`):** shared contracts, 11 route skeletons, `.env.example`,
  `docker-compose.yml` (redis), seed JSON, folder tree, shadcn primitives, script skeletons,
  placeholder dashboard, per-package deps (SWR, Stagehand, Anthropic SDK), and the four
  `docs/worktrees/WT-*.md` build sheets. Invariant: `install/typecheck/build/dev` pass;
  dashboard renders mock rows; `/api/ingest` returns a typed mock.
- **Phase 1 (parallel):** all four worktrees build against mocks (nobody blocks anybody).
- **Phase 2 (integration, merge order keeps `main` green):** **WT-B** (fills mock bodies,
  same shapes) → **WT-C** (set `EMBEDDING_API_URL`; embeddings become real — env-only) →
  **WT-A** (additive UI) → **WT-D** (point scraper at real ingest).
- **Phase 3 (polish):** seed a compelling corpus; rehearse the drift demo; record a
  fixture-mode scrape fallback.

---

## 8. Verification & Testing

**8.1 Local bring-up (Windows + Docker Desktop/WSL2)**
```bash
pnpm install
docker compose up -d          # Redis 6379 + RedisInsight 8001 (+ sidecar once WT-C lands)
pnpm seed                     # embeds slang -> idx:corpus
pnpm dev                      # http://localhost:3000/dashboard
pnpm post-mock                # POST a sample post to /api/ingest
# observe it scored -> toggle Approve -> GET /api/corpus shows approved count +1
```

**8.2 Per-worktree smoke** — WT-A: `/dashboard` renders all states from mock. WT-B:
`pnpm seed` + `pnpm post-mock` returns a real `ScoredPost`; verify KNN in RedisInsight.
WT-C: `curl $EMBEDDING_API_URL -d '{"model":"nomic-embed-text-v2-moe","input":"test"}'`
→ 768 floats. WT-D: `pnpm scrape-demo` (fixture) → rows appear via `/api/ingest`.

**8.3 E2E happy path** — seed → ingest → embedded+KNN+scored+stored → `/api/posts` shows
it → Approve adds its vector → ingest a paraphrase → its score is now higher (drift
proven) → open Lead Summary + Outreach draft.

**8.4 Green-bar gate (every merge):** `pnpm typecheck && pnpm build`. One unit test for
`scoring.ts` (pure) is the only test worth its weight.

---

## 9. Demo Script

**9.1 Redis track.** RedisInsight (8001) beside the dashboard. Show `idx:corpus` KNN over
768-dim nomic vectors. Ingest a post using **novel slang not in the seed** — it still
scores high via vector similarity (keyword filters would miss it). Click **Approve** →
a new vector appears in the corpus live. Ingest a **paraphrase** → its risk jumps and the
"corpus learned" counter ticks. *A self-updating vector corpus.*

**9.2 Browserbase track.** Trigger a live session (`/api/scrape` or `pnpm scrape-demo --live`)
against `/feed`. Show Stagehand extracting posts; they flow into `/api/ingest` and light up
the dashboard with risk scores in real time — a real browser handling a JS-heavy page.

**9.3 Fallback.** If live scraping flakes, switch to **fixture mode** so the pipeline demo
still runs. End on the Lead Summary + simulated outreach send for a flagged account.

---

## 10. Risks & Mitigations

- **llama.cpp v2-MoE pooling assert bug** (ggml-org/llama.cpp #13534/#13689): prefer the
  `ggml-org/Nomic-Embed-Text-V2-GGUF` build + `--pooling mean`; the hosted/mock fallback
  in `embeddings.ts` keeps the demo alive regardless.
- **Windows:** Docker Desktop (WSL2) must be running; `package.json` scripts are
  node-based (`tsx`) — shell-agnostic; all `shadcn add` done in Phase 0.
- **Consistency invariants:** 768-dim and COSINE everywhere; corpus embedded as
  `document`, queries as `query` — a mismatch silently corrupts similarity.
- **Cold start:** empty corpus → `semantic=0`; ingest must never 500. Seed before ingest;
  tolerate the reverse and re-`/api/rescore`.

---

## 11. Out of Scope

Auth/RBAC/multi-tenant · real outreach sending · real-platform scraping at scale ·
job queues/Redis Streams for ingest · HNSW tuning · Matryoshka 256-d truncation ·
embedding cache · background eviction worker · multi-platform scraping · cloud deploy.

---

## 12. Open Questions

- Cloud deploy (Vercel + Redis Cloud + Fly) as a stretch — only if Phase 2 finishes early.
- Native Nomic Atlas API support (vs. the current OpenAI-compatible hosted fallback) — add
  in WT-C only if a non-OpenAI-compatible hosted endpoint is required.
- Real outbound (e.g. Resend to a demo inbox) — currently simulated; revisit if judges
  want a live send.
