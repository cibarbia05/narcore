# narcore

A dark, focused web foundation for high-stakes government tooling.

## Stack

- **[Next.js](https://nextjs.org) (App Router)** + **React 19** + **TypeScript**
- **[Tailwind CSS v4](https://tailwindcss.com)** — CSS-first config via `@theme`
  (no `tailwind.config.js`)
- **[shadcn/ui](https://ui.shadcn.com)** (Base UI primitives, Lucide icons)
- **[next-themes](https://github.com/pacocoursey/next-themes)** — dark-first theming

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Other scripts:

```bash
pnpm build        # production build (type-check + lint + compile)
pnpm start        # serve the production build
pnpm lint         # ESLint
```

> Uses **pnpm**. Install it with `npm i -g pnpm` (or via Corepack) if needed.

## Project layout

```
src/
  app/
    layout.tsx        # fonts, dark-default ThemeProvider, metadata
    globals.css       # design tokens — single source of truth (dark + azure)
    page.tsx          # starter page
  components/
    ui/               # shadcn/ui primitives (e.g. button)
    theme-provider.tsx
    logo.tsx          # brand mark
  lib/
    utils.ts          # cn() class merge helper
components.json       # shadcn/ui config
brand.md              # brand & UI guidelines
```

# NARCORE — Technical Architecture

A field guide to how the system actually works. Focused on the core engine: the
parallel scraper fleets, the undercover outreach operative, and the
infrastructure underneath them (Browserbase, Redis, embeddings, and the LLMs).

---

## 1. The Big Picture

NARCORE is a closed-loop system that does three things and feeds each one back
into the next:

1. **Detect** — parallel browser agents scrape Instagram hashtags, and every
   post is risk-scored using semantic (vector) similarity against a corpus of
   known drug-dealing language.
2. **Engage** — a human operator launches an undercover "operative" against a
   flagged seller. An LLM-driven agent negotiates over Instagram DMs toward two
   objectives: confirm the deal and confirm a meeting location.
3. **Learn** — every confirmed engagement teaches the system. New coded slang is
   extracted from the seller's own words and added to the detection corpus (R1),
   and the successful tactics are stored as long-term memory to prime the next
   operative (R2).

```
   ┌─────────────┐     flagged      ┌──────────────┐    confirmed     ┌────────────┐
   │  DETECT     │  ───────────────▶│   ENGAGE     │ ───────────────▶ │   LEARN    │
   │ scraper     │      lead        │  operative   │   deal+location  │  R1 corpus │
   │ fleet (×N)  │                  │  (LLM + DM)  │                  │  R2 memory │
   └─────────────┘                  └──────────────┘                  └────────────┘
         ▲                                                                   │
         └───────────────── grown corpus re-flags more posts ◀──────────────┘
```

Everything is coordinated through a single **Redis** instance, which acts as the
vector database, the state store, the job registry, and the event bus all at
once.

---

## 2. Parallel Scraper Fleets

**What it is:** N independent browser agents (default 5, configurable 1–20) that
each drive a real Instagram session in parallel, scrape a hashtag feed, and push
every post into the scoring pipeline.

**Key files:** `src/lib/agents/orchestrator.ts`, `src/lib/agents/ig-agent.ts`,
`src/lib/agents/run-store.ts`

### How a fleet launches

1. `POST /api/agents/run` → `startRun()` resolves the agent count and assigns
   each agent a distinct Instagram hashtag target.
2. All N Browserbase sessions are provisioned **up front and in parallel**
   (`Promise.all` over `provisionAgent()`), so the live-view URLs exist before
   any scraping begins — the UI can render the video grid immediately.
3. Each agent's loop (`runAgentLoop`) is fired **un-awaited** (`void`). The HTTP
   request returns instantly; the agents keep running in the background.
4. The UI **polls** Redis for progress rather than holding an open connection.

### Why there are no race conditions

Every agent owns its own Redis hash: `run:{id}:agent:{idx}`. An agent only ever
patches its own key, so five siblings writing concurrently never collide — no
locks needed. The run is marked `done` only when *all* agents reach a terminal
state (`done`, `blocked`, `error`, or `stopped`).

### Budgets (per agent)

| Setting | Default | Meaning |
|---|---|---|
| `IG_AGENT_TIMEOUT_MS` | 120s | Wall-clock budget per agent |
| `IG_MAX_POSTS_PER_AGENT` | 8 | Posts captured before stopping |

### Cancellation

`stopRun()` immediately marks the run stopped, aborts every agent's
`AbortController`, and releases all Browserbase sessions in parallel. The UI sees
a clean terminal state right away.

---

## 3. The Undercover Operative (Outreach)

**What it is:** A single LLM-driven agent that opens an Instagram DM with a
flagged seller and negotiates, turn by turn, toward two confirmations. Unlike the
fleet, operations run **one at a time per post** (deduped) and have a much longer
budget because real conversations take time.

**Key files:** `src/lib/agents/operation-orchestrator.ts`,
`scraper/operative-agent.ts`, `src/lib/operative-brain.ts`,
`src/lib/agents/operation-store.ts`

### Launch flow (`startOperation`)

1. **Preconditions:** `ANTHROPIC_API_KEY` must be set, at least one logged-in
   Browserbase context must exist, and the target handle must pass the
   **allowlist gate** (`OPERATIVE_ALLOWLIST_ENFORCED=true` — this must never be
   off in a live demo; it restricts targets to consented demo accounts).
2. **Dedup:** `op:by-post:{postId}` ensures the same post can't launch two
   operations at once.
3. A Browserbase session is created, an `Operation` record is written to Redis
   with status `opening`, and the operative loop fires un-awaited (same
   fire-and-forget + poll pattern as the fleet).

### The negotiation loop

The operative tracks two objectives independently so the UI can show live state
like **"Deal ✓ · Location ✗"** even mid-conversation.

```
open DM thread  →  brain composes opener  →  ┌─────────────────────────────┐
                                             │  send message (verify it     │
                                             │  landed, up to 3 retries)    │
                                             │  wait for seller reply       │
                                             │  brain analyzes transcript   │
                                             │  patch deal/location state   │
                                             └──────────────┬──────────────┘
                                                            │
            both confirmed? ── yes ──▶ send closer, mark "confirmed", trigger R1+R2
                  │ no
            rejected / stalled / max turns? ── yes ──▶ terminal
                  │ no
                  └──▶ loop
```

Opening a DM thread uses one of two strategies (`OPERATIVE_DM_OPEN_STRATEGY`):
- **`ladder`** (default): a hand-rolled `observe → act` sequence (try the profile
  "Message" button, fall back to DM-inbox search).
- **`agent`**: a self-healing DOM-mode Stagehand agent that figures out the steps
  itself (more robust, more expensive).

### Budgets (per operation)

| Setting | Default | Meaning |
|---|---|---|
| `OPERATIVE_BUDGET_MS` | 25 min | Total wall-clock per negotiation |
| `OPERATIVE_REPLY_WAIT_MS` | 4 min | Max wait for each seller reply |
| `OPERATIVE_POLL_MS` | 15s | How often the thread is checked for new replies |
| `OPERATIVE_MAX_TURNS` | 12 | Max back-and-forth exchanges |

### Operation states

`opening → awaiting_reply → analyzing → negotiating` and then a terminal state:
`confirmed` (both objectives met), `rejected`, `stalled` (ran out of budget/turns),
`blocked` (login wall), `error`, or `stopped` (operator aborted).

### The Operative Brain (the LLM call)

`negotiate()` in `src/lib/operative-brain.ts` makes **one Claude call per turn**.
It is given the lead context, the full transcript so far, and any recalled prior
intel, and it is **forced** to call a `submit_negotiation_step` tool so the output
is always structured:

```ts
NegotiationStep {
  analysis: {
    dealConfirmed, locationConfirmed,   // the two objectives
    meetingLocation, meetingTime,       // verbatim, if agreed
    rejection, confidence, reasoning
  },
  nextMessage: string | null,           // the operative's next DM (null = done)
  done: boolean
}
```

- **Model:** `OPERATIVE_MODEL` (default `claude-sonnet-4-6`)
- **Load-bearing:** yes — operations fail fast if the API key is missing.

---

## 4. Browserbase — The Browser Layer

**What it is:** Browserbase provides the actual cloud browser sessions, residential
proxies, and persistent logged-in "contexts" that both fleets and operatives
attach to. Stagehand (an AI browser-automation library) drives those sessions.

**Key files:** `src/lib/browserbase.ts`, `scripts/ig-login.ts`,
`src/lib/session-identity.ts`

### Sessions vs. Contexts

- A **context** is a persistent, logged-in Instagram profile (cookies + storage).
  Created once via `pnpm ig:login`, then reused.
- A **session** is a single live browser instance bound to a context. Both fleets
  and operatives create fresh sessions on top of an existing context, all through
  one chokepoint — `createIgSession()` — which guarantees consistent settings.
- `getLiveViewUrl()` returns a read-only CDP stream so the UI can show the agent's
  browser live.

### Identity consistency (the #1 anti-detection concern)

Instagram triggers login checkpoints when the browser fingerprint at scrape-time
differs from the fingerprint at login-time. To prevent this, the system snapshots
the fingerprint (OS, region, proxy country, viewport, verified/stealth flags) into
Redis (`identity:context:{id}`) during `ig:login`, and later compares the current
environment against it. The UI's **session-identity badge** surfaces this as
`OK` / `mismatch — re-run ig:login` / `not yet recorded`.

### One-time login provisioning (`pnpm ig:login`)

Creates a context + session, opens the live-view URL for a **human to log in by
hand** (solving 2FA/checkpoints), records the fingerprint, then releases the
session so cookies persist into the context. Outputs the
`BROWSERBASE_CONTEXT_IDS` to paste into `.env`. Run `pnpm ig:login 3` to provision
three burner accounts.

### Key environment variables

| Variable | Purpose |
|---|---|
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | Auth + project |
| `BROWSERBASE_CONTEXT_IDS` | CSV of logged-in contexts, round-robined across agents |
| `IG_REGION` (default `us-west-2`) | Session region (must match Stagehand endpoint) |
| `IG_PROXY_COUNTRY` (default `US`) | Proxy geolocation |
| `BB_VERIFIED`, `BB_ADVANCED_STEALTH`, `BB_BROWSER_OS` | Enterprise anti-bot / OS pinning |

---

## 5. Redis — The Backbone

A single Redis instance does everything: vector search, state, locks, and events.

### Vector search (the heart of detection)

Two RediSearch indexes:

- **`idx:corpus`** (prefix `corpus:`) — the searchable language corpus. A `VECTOR`
  field (`FLAT`, `FLOAT32`, **768-dim**, `COSINE`). KNN queries
  (`*=>[KNN k @vector $BLOB AS score]`) return cosine *distance*; similarity is
  `1 - distance`.
- **`idx:posts`** (prefix `post:`) — scraped posts, with `NUMERIC` (risk score,
  timestamps), `TAG` (flagged, approval status, platform), and `TEXT` fields for
  feed filtering and sorting.

Corpus entries come in three flavors, all sharing one index:

| Key pattern | Source | TTL |
|---|---|---|
| `corpus:seed:{slug}` | Hand-curated seed terms | permanent |
| `corpus:approved:{postId}` | Human-approved captions | 14d, refreshed on every match |
| `corpus:field:{slug}-{opId}` | Slang learned from operations (R1) | 14d, refreshed on match |

> **Critical detail:** vectors are stored as raw little-endian FLOAT32 buffers and
> are **write-only** — never read back via `hGetAll` (that would corrupt the
> binary). KNN returns only the scalar fields.

### Other Redis usage

| Key / structure | Type | Purpose |
|---|---|---|
| `post:{id}` | hash | Full post record + risk JSON |
| `run:{id}`, `run:{id}:agent:{idx}` | hash | Fleet run + per-agent state (1h TTL) |
| `op:{id}` + `op:{id}:messages` | hash + list | Operation state + append-only transcript (6h TTL) |
| `op:by-post:{postId}` | string | Dedup guard (one live op per post) |
| `stream:field-intel` | stream | Live "learning" ticker (trimmed ~200 events) |
| `lock:decision:{postId}` | string | 5s TTL lock guarding approval races |

Append-only transcripts use `RPUSH` + `LRANGE` to guarantee message ordering under
concurrent reads.

---

## 6. Embeddings

**What it is:** Every piece of text (corpus terms and post captions) is turned into
a 768-dimensional vector so similarity can be measured semantically rather than by
keyword.

**Key files:** `src/lib/embeddings.ts`, `src/lib/model.ts`,
`infra/embedding-proxy/`

- **Model:** `nomic-embed-text-v2-moe` @ 768 dims (self-hosted via llama.cpp).
- **Task prefixes (required by Nomic):** corpus entries are embedded with
  `search_document:`; post captions being scored use `search_query:`.
- **Provider fallback chain:** `live` (must succeed) → `auto` (try providers, fall
  back to a deterministic mock) → `mock` (offline-safe, for full-pipeline tests).
  Configured via `EMBEDDING_MODE`, `EMBEDDING_API_URL`, and a hosted `NOMIC_API_URL`
  fallback.
- **Batching:** 64 texts per request, input order preserved.
- **Model version** (`nomic-embed-text-v2-moe@768`) is persisted into each risk
  score so cached scores can be invalidated if the model changes.

### The embedding proxy (`infra/embedding-proxy/`)

A tiny Node service (port 8090) that strips `null`-valued fields (e.g.
`"encoding_format": null`) out of OpenAI-compatible embedding requests. The Redis
Agent Memory Server sends those nulls via LiteLLM, but llama.cpp rejects them. The
proxy lets the memory server reuse the **same local embedder** — one embedding
family, one box, one shared 768-dim vector space across detection *and* memory.

---

## 7. How the LLMs Are Used

All language generation is **Anthropic Claude**. There are four distinct uses:

| Use | Where | Model (default) | Load-bearing? | Job |
|---|---|---|---|---|
| **Operative brain** | `operative-brain.ts` | `claude-sonnet-4-6` | **Yes** | Negotiate, one forced-tool call per DM turn |
| **Field-intel extractor (R1)** | `field-intel.ts` | `claude-sonnet-4-6` | No (fails open) | Extract coded slang from seller messages |
| **Outreach drafting** | `outreach.ts` | `claude-haiku-4-5` | No (template fallback) | Draft a referral email to platform Trust & Safety |
| **Agent memory server (R2)** | docker sidecar | sonnet-4-6 / haiku-4-5 | No (fails open) | Index + retrieve memories (via LiteLLM) |

"Fails open" means: if the call errors or the key is missing, that feature
degrades gracefully (returns `[]`, a template, or skips) without breaking the run.
Only the operative brain is allowed to fail fast.

Stagehand also uses an LLM (`SCRAPE_MODEL`, default `claude-sonnet-4-6`) internally
to interpret `observe`/`act` browser instructions.

---

## 8. The Learning Loops

This is what makes the system self-improving. Both loops fire the moment an
operation is **confirmed** (deal + location both true).

### R1 — Field Intelligence (operative → detector)

**File:** `src/lib/field-intel.ts`

1. A forced Claude tool extracts coded slang **only from the seller's own
   messages**.
2. **Provenance gate:** each term's evidence quote must be a real substring of an
   actual seller message — the model can't invent words the seller never said.
   Confidence must be ≥ 0.7.
3. **Dedup gate:** terms already in the corpus (cosine distance < 0.05) are skipped.
4. Survivors are embedded and written as `corpus:field:*` entries.
5. Up to 200 pending posts are **re-scored** against the now-larger corpus, and the
   count of newly flagged posts is recorded.
6. A `FieldIntelEvent` is appended to `stream:field-intel`, which drives the live
   ticker: *"@handle taught the detector 'zaza', 'tap in' → 4 posts re-flagged."*

### R2 — Cross-Operation Memory (operation → next operative)

**File:** `src/lib/agent-memory.ts` (backed by the `redislabs/agent-memory-server`
sidecar — note its worker must be running, or memories never index)

- **Recall (turn 0):** before composing the opener, the operative queries the
  memory server with a semantic question ("what opener/tone/tactics have worked
  against this seller / this drug / these code words?"). Up to 3 hints are injected
  into the brain's system prompt as `PRIOR INTEL`. **Fail-open:** 4s timeout,
  returns `[]` if the server is down.
- **Pin (on confirm):** the operation is saved as an episodic memory — the working
  opener, tone, meeting location, and turn count — tagged with the drug and seller
  handle/code words for future semantic recall.

Net effect: each confirmed bust both **widens detection** (more slang in the
corpus → more posts flagged on the next scrape) and **sharpens engagement** (the
next operative starts already knowing what worked).

---

## 9. End-to-End Flow (one full cycle)

1. **Scrape** — operator launches a fleet of N agents; each drives a Browserbase
   session over a hashtag and ingests posts via `/api/ingest`.
2. **Score** — each post is embedded (`search_query:` prefix) and KNN-matched
   against `idx:corpus`. Final risk = 65% semantic similarity + 35% heuristics
   (keywords, emojis, handoff apps, payment cues). `flagged` if score ≥ 70.
3. **Triage** — flagged posts surface in the feed; a human can approve novel
   captions into the corpus, immediately improving detection.
4. **Engage** — operator launches an operative against a flagged (allowlisted)
   seller. The LLM negotiates over DMs toward deal + location, state visible live.
5. **Confirm** — when both objectives are met, R1 grows the corpus and re-scores
   pending posts; R2 pins the winning tactics to memory.
6. **Compound** — the next scrape flags more posts (bigger corpus), and the next
   operative is primed with memory. The loop tightens with every cycle.

---

## 10. Quick Reference — Key Environment Variables

```bash
# Redis
REDIS_URL=redis://localhost:6379

# Embeddings
EMBEDDING_MODE=auto                 # auto | mock | live
EMBEDDING_API_URL=http://localhost:8080/v1/embeddings
NOMIC_API_URL=                      # hosted fallback
EMBEDDING_DIM=768

# Scoring
RISK_THRESHOLD=70

# Browserbase
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...
BROWSERBASE_CONTEXT_IDS=ctx1,ctx2   # from `pnpm ig:login`
IG_REGION=us-west-2
IG_PROXY_COUNTRY=US

# Fleet
IG_AGENT_TIMEOUT_MS=120000
IG_MAX_POSTS_PER_AGENT=8

# Operative
ANTHROPIC_API_KEY=...               # required for operative brain
OPERATIVE_MODEL=claude-sonnet-4-6
OPERATIVE_BUDGET_MS=1500000         # 25 min
OPERATIVE_MAX_TURNS=12
OPERATIVE_ALLOWLIST_ENFORCED=true   # never disable in a live demo

# Learning loops
FIELD_INTEL_DEDUP_DISTANCE=0.05
FIELD_INTEL_RESCORE_LIMIT=200
AGENT_MEMORY_URL=http://localhost:8000
AGENT_MEMORY_RECALL_LIMIT=3
OUTREACH_MODEL=claude-haiku-4-5-20251001
```
