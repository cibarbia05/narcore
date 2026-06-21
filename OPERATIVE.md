# Operative Agent — undercover DM negotiation

After a post is flagged in the detection queue, the **operative** opens an Instagram
DM with the seller (from one of our logged-in burner accounts), poses as an
interested buyer, and negotiates toward two objectives — a **confirmed deal** and a
**confirmed meeting location**. After every reply it re-reads the conversation and
updates the Deal/Location confirmations live. When both are confirmed (or the lead
rejects / stalls), the `/operations/[id]` view is the report back to law enforcement
(transcript + location + Export report).

> Authorized law-enforcement use only. Contact is hard-limited to demo-adversary
> accounts you control (the allowlist) — no real third party is ever messaged.

## How it fits the existing stack

Mirrors the parallel-scraper "war room": orchestrator → fire-and-forget loop →
Redis state → SWR polling → live-view iframe. Key files:

- `src/lib/operative-allowlist.ts` — the non-bypassable target allowlist.
- `src/lib/operative-brain.ts` — one structured Claude call per turn (analyze + draft).
- `scraper/operative-agent.ts` — the DM loop (Stagehand `act` to send, `extract` to read).
- `src/lib/agents/operation-store.ts` / `operation-orchestrator.ts` — Redis state + supervisor.
- `src/app/api/operations/*` — start / poll / stop + allowlist config.
- `src/app/(dashboard)/operations/*`, `src/components/operations/*` — the UI.
- Launch point: the **Engage** action on each row of the detection queue.

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `OPERATIVE_TARGET_ALLOWLIST` | _(empty)_ | **Required for the demo.** Comma-separated demo-adversary handles the operative may contact, e.g. `demo_plug_01,demo_plug_02`. With enforcement on and this empty, nothing can be engaged. |
| `OPERATIVE_ALLOWLIST_ENFORCED` | `true` | Allowlist gate. Only `false` disables it (logged loudly) — never set `false` in a demo/shared env. |
| `ANTHROPIC_API_KEY` | _(none)_ | **Required.** The brain is load-bearing; start fails fast without it. |
| `OPERATIVE_MODEL` | `claude-sonnet-4-6` | Model for the negotiator brain. |
| `OPERATIVE_SESSION_TIMEOUT_SECONDS` | `1800` | Browserbase session ceiling for an operation (60–21600). |
| `OPERATIVE_BUDGET_MS` | `1500000` (25m) | Overall wall-clock budget per negotiation (≤ session timeout). |
| `OPERATIVE_REPLY_WAIT_MS` | `240000` (4m) | How long to wait for each seller reply before stalling. |
| `OPERATIVE_POLL_MS` | `15000` | Thread poll cadence while awaiting a reply. |
| `OPERATIVE_MAX_TURNS` | `12` | Max operative messages before stalling. |
| `OPERATION_TTL_SECONDS` | `21600` (6h) | Redis TTL for operation state. |

Reuses the scraper's existing config: `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`,
`BROWSERBASE_CONTEXT_IDS` (the burner the operative DMs *from*).

## Demo setup (self-contained)

1. Create one or more **demo-adversary** Instagram accounts (e.g. `@demo_plug_01`).
   Keep a teammate logged in to each to reply as the seller.
2. Add their handles to `OPERATIVE_TARGET_ALLOWLIST`.
3. Make sure the operative burner is logged in: `pnpm ig:login` then `pnpm ig:verify`.
4. Get a flagged post authored by a demo-adversary into the queue — let the scraper
   find a bait post, or seed one (post a high-risk caption from the demo account, or
   add a mock post whose `username` is the demo handle).
5. Demo: **Dashboard → flagged demo post → Engage → `/operations/[id]`.** Watch the
   live browser open the DM and send; the teammate replies as the seller; the
   **Deal ✓ / Location ✓** chips flip; then **Export report**.

Only allowlisted handles show an enabled **Engage** button; everything else is
disabled with a reason. The server enforces the same allowlist on start.

---

# Redis + Browserbase deepenings (R1/R2/B1/B2/B3)

The thesis: **a self-improving undercover investigator — every bust it closes is
written into Redis agent-memory + a vector corpus that makes the next operation
smarter, all on one Redis.** Each piece below was verified end-to-end against live
infra (Redis, the nomic embedder, Claude, Browserbase). Verification scripts:
`scripts/test-field-intel.ts`, `scripts/test-identity.ts`, `scripts/test-osint.ts`,
`scripts/test-agent-memory.ts`.

## R1 — Field-intel → detection-corpus closed loop (Redis)

On a **confirmed** operation, one forced-tool Claude call extracts the coded slang the
**seller** actually used, provenance-gates it (confidence ≥ 0.7 **and** the evidence is
a verbatim substring of a seller message — stops the agent teaching itself words), dedups
vs. the live corpus, embeds survivors as `corpus:field:*` vectors (same `idx:corpus`,
so they instantly become KNN neighbours for detection), re-scores pending posts, and
`XADD`s a live ticker to `stream:field-intel`. The war room shows a "field intel" ticker;
the corpus stats bar and Vector Space gain a **field** category.
Files: `src/lib/field-intel.ts`, `src/lib/repo.ts` (`addFieldEntry`), `src/lib/redis.ts`,
`src/app/api/field-intel/route.ts`, `src/components/operations/field-intel-ticker.tsx`.

| Var | Default | Purpose |
| --- | --- | --- |
| `FIELD_INTEL_DEDUP_DISTANCE` | `0.05` | Cosine distance below which a learned term is a near-duplicate (skipped). |
| `FIELD_INTEL_RESCORE_LIMIT` | `200` | Max pending posts re-scored after learning. |
| `FIELD_INTEL_MODEL` | `OPERATIVE_MODEL` | Model for slang extraction. |

## R2 — Cross-operation agent memory (Redis Iris)

Runs the official **Redis Agent Memory Server** as a docker-compose sidecar on the same
Redis. The operative **recalls** prior field intel before the first message (turn-0
priming → injected into the brain's system prompt as `PRIOR_INTEL`) and **pins** a durable
episodic memory after a confirmed bust. Memory embeddings use the **same local nomic
embedder** as the corpus. Fail-open: if the memory server is down, recall returns `[]`
and the operative runs exactly as before. `/memory` browses long-term memory; the war
room shows a "Prior intel used" card. Pre-seed demo memory: `pnpm seed:memories`.
Files: `src/lib/agent-memory.ts`, `src/app/api/memory/route.ts`,
`src/components/memory/*`, brain/operative wiring, `docker-compose.yml`.

> **Why the embedding proxy?** The memory server embeds via LiteLLM, which sends
> `encoding_format: null` on the OpenAI embeddings call; the llama.cpp nomic server
> rejects a null where it expects a string. `infra/embedding-proxy/server.js` strips
> null JSON fields so the memory server can reuse our local embedder (one embedding
> family, one box). `REDISVL_VECTOR_DIMENSIONS=768` pins the memory index to nomic's dims.

| Var | Default | Purpose |
| --- | --- | --- |
| `AGENT_MEMORY_URL` | `http://localhost:8000` | Agent Memory Server REST base (app side). |
| `AGENT_MEMORY_TIMEOUT_MS` | `4000` | Fail-open timeout per memory call. |
| `AGENT_MEMORY_RECALL_LIMIT` | `3` | Memories recalled to prime an operation. |

Bring up the memory stack: `docker compose up -d` (adds `embedding-proxy`,
`agent-memory`, `agent-memory-worker`). The **worker MUST run** or memories never index.
`ANTHROPIC_API_KEY` is read from `.env` by compose.

## B2 — Consistent verified identity (Browserbase)

One fingerprint across login + every run is the main lever against IG checkpoints. All
sessions funnel through `createIgSession`; `pnpm ig:login` records the fingerprint per
context, and the war room shows an **identity match** badge. **Verified by live test:**
non-Linux OS requires `verified:true` (Browserbase Enterprise) — pinning it otherwise
returns a `400`, so a misconfigured OS is **guarded** (dropped, with a warning) instead of
breaking session creation.

| Var | Default | Purpose |
| --- | --- | --- |
| `BB_BROWSER_OS` | _(unset → BB default = linux)_ | Pin OS. Non-linux needs `BB_VERIFIED=true` + Enterprise; re-run `pnpm ig:login` after changing. |
| `BB_VERIFIED` | `false` | Verified Browsers (Enterprise plan). |
| `BB_ADVANCED_STEALTH` | `false` | Advanced anti-bot stealth (paid). |

## B3 — Self-healing DM-open via `stagehand.agent` (Browserbase)

The brittle `openDmThread` ladder can be replaced by one DOM-mode `stagehand.agent` call
that finds its own path through popups/DOM churn (reuses the constructor's model + key —
no CUA, no extra key). The post-agent invariant (`/direct/t/…`) + `detectBlock` still gate
success; the auditable `sendMessage` loop is **never** delegated. **Defaulted off** —
flip the flag and run the 30-min spike against your burner before relying on it.

| Var | Default | Purpose |
| --- | --- | --- |
| `OPERATIVE_DM_OPEN_STRATEGY` | `ladder` | `agent` = self-healing DOM agent; `ladder` = the existing observe→act path. |
| `OPERATIVE_DM_AGENT_MAX_STEPS` | `14` | Max agent steps to open the DM (4–40). |
| `OPERATIVE_STAGEHAND_CACHE_DIR` | _(unset)_ | Enable Stagehand action caching (distinct dir per concurrent operative). |
