# Narcore — Runbook

How to run the whole system and watch it work: the AI detection pipeline, the
self‑learning Redis corpus, and the live Browserbase scraper. Every step lists the
**result you should expect**, so you can verify as you go.

> Windows note: in **PowerShell**, write `curl.exe` (not `curl`) for the POST commands,
> or run them in Git Bash. GET URLs you can just open in a browser.

---

## The pieces (what runs where)

| Service | Where | Purpose |
|---|---|---|
| Web app (Next.js) | `http://localhost:3000` | Dashboard + API + synthetic feed |
| Redis Stack | `localhost:6379` | Vector index (`idx:corpus`) + post store |
| RedisInsight (GUI) | `http://localhost:8001` | See the vectors/keys live |
| Embedding sidecar (llama.cpp) | `http://localhost:8080` | `nomic-embed-text-v2-moe`, 768‑dim |
| Browserbase | cloud | Runs the scraper's real browser session |

---

## 0. Prerequisites

- **Docker Desktop** running (WSL2 backend).
- **Node + pnpm** installed.
- `pnpm install` run once.

```bash
pnpm install
```
**Expected:** completes with `Done`. No errors.

---

## 1. One‑time setup

### 1a. Download the embedding model (≈490 MB)

The container can't reach Hugging Face on this network, so fetch the model **on the host**
once; it's bind‑mounted into the container.

```bash
mkdir -p infra/embedding/models
curl -L -o infra/embedding/models/nomic-embed-text-v2-moe-q8_0.gguf \
  https://huggingface.co/ggml-org/Nomic-Embed-Text-V2-GGUF/resolve/main/nomic-embed-text-v2-moe-q8_0.gguf
```
**Expected:** a `489M` file at `infra/embedding/models/nomic-embed-text-v2-moe-q8_0.gguf`
(first 4 bytes are `GGUF`). It's git‑ignored — don't commit it.

### 1b. Create `.env.local` in the repo root

```ini
REDIS_URL=redis://localhost:6379
EMBEDDING_MODE=auto
EMBEDDING_API_URL=http://localhost:8080/v1/embeddings
RISK_THRESHOLD=0.7

# Optional — only needed for LIVE Browserbase scraping:
BROWSERBASE_API_KEY=your_key
BROWSERBASE_PROJECT_ID=your_project_id
MOCK_FEED_URL=http://localhost:3000/feed

# Optional — real LLM-drafted outreach (otherwise a template is used):
ANTHROPIC_API_KEY=your_key
```

---

## 2. Start the stack

```bash
docker compose up -d
docker compose ps
```
**Expected:** two containers `Up` and `(healthy)`:
```
narcore-redis       Up ... (healthy)   0.0.0.0:6379->6379, 0.0.0.0:8001->8001
narcore-embedding   Up ... (healthy)   0.0.0.0:8080->8080
```
> The embedding container takes ~20–40 s to load the model on start. If it shows
> `{"error":{"message":"Loading model"...}}`, just wait — it flips to healthy.

Confirm the model serves real vectors:
```bash
curl.exe -s http://localhost:8080/v1/embeddings -H "content-type: application/json" \
  -d "{\"model\":\"nomic-embed-text-v2-moe\",\"input\":[\"search_query: test\"]}"
```
**Expected:** JSON with `data[0].embedding` = an array of **768** floats.

Start the web app (leave it running):
```bash
pnpm dev
```
**Expected:** `Ready` / `Local: http://localhost:3000`.

---

## 3. Seed the corpus

Seed **through the server** (it reads `.env.local`, so the corpus uses the same real
embeddings the API uses):
```bash
curl.exe -X POST http://localhost:3000/api/seed
```
**Expected:** `{"loaded":45,"skipped":0}`

Sanity check:
```bash
curl.exe http://localhost:3000/api/health
```
**Expected:** `{"ok":true,"redis":true,"embeddings":true,"corpusSize":45,"postCount":0,"modelVersion":"nomic-embed-text-v2-moe@768"}`

> Switching from a previous mock run? Clear first so old vectors don't pollute:
> `docker exec narcore-redis redis-cli FLUSHALL`, then re‑seed.

---

## 4. Where to look in the browser

| Open | What you see |
|---|---|
| **`http://localhost:3000`** | Landing page. |
| **`http://localhost:3000/dashboard`** | **The results.** The detection queue: each scraped post with its username, platform, caption, detected code‑words, AI **risk score**, an **Approve** toggle, and an **Outreach** action. Rows below the threshold are dimmed; flagged rows stand out. A **corpus counter** + **"Re‑evaluate"** button sit on top. Table auto‑refreshes every few seconds. |
| **`http://localhost:3000/feed`** | The **synthetic social feed** the scraper targets — ~24 posts (coded drug‑ads + benign decoys), styled like a real feed. Labeled synthetic test data. |
| **`http://localhost:8001`** | **RedisInsight.** Browse keys: `corpus:seed:*` (the 45 known terms as vectors), `corpus:approved:*` (terms the system *learned*), `post:*`. You can literally watch the corpus grow when you approve a post. |
| **`https://www.browserbase.com/sessions`** | **The scraper agent working** — the live browser session (see §6). |

---

## 5. The detection + learning loop (the core demo)

With `/dashboard` open:

1. **Post a coded ad** (or use the feed scrape in §6):
   ```bash
   pnpm post-mock
   ```
   **Expected:** `status: 201` and a `Post` JSON. A new row appears in `/dashboard` within
   a few seconds with a risk score.

2. **Watch it score by meaning.** Ingest a *novel* caption that isn't in the seed list but
   talks like a drug ad — it should still score **elevated** because the vectors are
   semantically close (this is the point: keyword filters miss it, vectors don't).

3. **Approve it.** Flip the **Approve** toggle on a flagged row.
   **Expected:** the **corpus counter ticks up** (e.g. approved `0 → 1`); in RedisInsight a
   new `corpus:approved:*` key appears. Verify:
   ```bash
   curl.exe http://localhost:3000/api/corpus
   ```
   **Expected:** `approved` increased by 1 (e.g. `{"size":46,"seed":45,"approved":1}`).

4. **Prove it learned.** Ingest a **paraphrase** of the approved post (new link).
   **Expected:** its **risk score is now higher** than a fresh post would have been — it
   matches the term you just taught it. Then click **"Re‑evaluate against learned terms"**
   (or `POST /api/rescore`) and pending posts re‑score against the grown corpus.

5. **Open the Lead Summary / Outreach** on a flagged row.
   **Expected:** a report with the handle, platform, detected code‑words, risk metrics, and
   a drafted outreach email (LLM‑written if `ANTHROPIC_API_KEY` is set, else a template),
   with copy/export and a **simulated** Send.

---

## 6. Run the scraper (and watch the Browserbase agent)

### Fixture mode (offline, always works)
```bash
curl.exe -X POST http://localhost:3000/api/scrape -H "content-type: application/json" -d "{\"live\":false}"
```
**Expected:** `{"ingested": <number>}` — those feed posts now appear, scored, in `/dashboard`.

### Live Browserbase mode (the real agent)
Needs `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` in `.env.local` (restart `pnpm dev`
after adding them).
```bash
curl.exe -X POST http://localhost:3000/api/scrape -H "content-type: application/json" -d "{\"live\":true}"
```
**Expected:**
- `{"ingested": <number>}` when it finishes.
- **In your `pnpm dev` terminal**, the scraper logs a **Browserbase session id / URL**.
- **At `https://www.browserbase.com/sessions`**, the session appears — open it to watch the
  **live browser** (or replay) navigating `/feed` and extracting posts in real time.
- New rows stream into `/dashboard` as each post is ingested.

### Live Agents — 5 parallel browsers on real Instagram (`/agents`)

The "War Room": several cloud browsers scan real Instagram hashtags in parallel, each
streamed live into the UI. Leads flow into the same `/dashboard` queue.

**Browserbase — full setup in 6 steps:**
1. Get `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` from <https://www.browserbase.com/settings> → put both in `.env.local`. Confirm your plan's **concurrent‑session limit** ≥ the agents you'll run.
2. `pnpm ig:login` (add a number to do several, e.g. `pnpm ig:login 3`) → opens a cloud browser on IG's login page.
3. In that live‑view URL, log into a **throwaway** IG account **by hand** until you see your **home feed** (solve any phone/email checkpoint there), then press Enter.
4. Paste the printed `BROWSERBASE_CONTEXT_IDS=...` line into `.env.local`, then **restart `pnpm dev`**.
5. `pnpm ig:verify` → confirms each context shows `✅ LOGGED IN` (re‑run step 2 for any that fail).
6. Open `http://localhost:3000/agents` → set the agent count (start with **1** on a fresh account) → **Launch**.

**One‑time setup — log in burner accounts (persisted Browserbase Contexts):**
```bash
pnpm ig:login 5     # provision 5 contexts (one per throwaway IG account)
```
For each, it prints a **live‑view URL** — open it, log into Instagram **by hand** (solve any
2FA / "verify it's you" checkpoint yourself), then press Enter so the cookies persist. At the
end it prints a `BROWSERBASE_CONTEXT_IDS=...` line. Paste it into `.env.local` and restart
`pnpm dev`. The agents reuse these logins (read‑only) so they start **already authenticated** —
the main defense against login checkpoints during the demo.

**Agent env vars** (`.env.local`, all optional except the contexts):
```ini
BROWSERBASE_CONTEXT_IDS=ctx_a,ctx_b,ctx_c,ctx_d,ctx_e   # from `pnpm ig:login` (required)
IG_AGENT_COUNT=5                 # parallel agents; must be <= your plan's concurrent-session limit
IG_TARGET_TAGS=                  # hashtags (no '#'); defaults derive from the seed corpus
IG_PROXY_COUNTRY=US              # residential proxy egress + keep consistent with the accounts
IG_REGION=us-west-2              # must match Stagehand's API region (default us-west-2)
IG_MAX_POSTS_PER_AGENT=8         # per-agent guardrails so nothing hangs a live demo
IG_AGENT_TIMEOUT_MS=120000
SCRAPE_MODEL=anthropic/claude-sonnet-4-6   # Stagehand extraction (needs ANTHROPIC_API_KEY)
```

**Run it:** open `http://localhost:3000/agents` → set the agent count → **Launch**. Each tile
streams that browser; statuses advance independently; `/dashboard` fills with scored leads.
A stuck agent shows **Checkpoint/Blocked** with a **Take over** link (opens the interactive
live view in a new tab) and never blocks the others. **Break‑glass fixture** populates the
queue from the offline fixture if the live demo stalls.

> ⚠️ Automating real Instagram breaks IG's ToS and burner accounts can be banned — use
> throwaway accounts only, never a personal one. Confirm your Browserbase plan allows the
> intended **concurrent** session count before the demo.

---

## 7. Inspect Redis directly (optional)

```bash
docker exec narcore-redis redis-cli FT.INFO idx:corpus
docker exec narcore-redis redis-cli --scan --pattern "corpus:approved:*"   # learned terms
docker exec narcore-redis redis-cli --scan --pattern "post:*" | wc -l       # stored posts
```
**Expected:** `FT.INFO` shows the index with a 768‑dim `VECTOR` field (`FLAT`, `COSINE`);
the approved pattern lists the terms you've taught it.

---

## 8. Stop / reset / troubleshoot

```bash
docker compose stop                 # pause (keeps data + model)
docker compose down                 # stop + remove containers (keeps the model file)
docker exec narcore-redis redis-cli FLUSHALL   # wipe corpus + posts, then re-seed
```

| Symptom | Fix |
|---|---|
| `EADDRINUSE :3000` | A dev server is already running — use it, or stop the other one. |
| Everything scores ~0 | You seeded in mock mode then switched to real (or vice‑versa). `FLUSHALL`, re‑seed via `/api/seed`. |
| `embedding` unhealthy / "Loading model" | Give it ~30 s after `up`. If it exits 1 with a Hugging Face error, the model file is missing — redo §1a. |
| Benign posts over‑flagging (real mode) | Tune `RISK_THRESHOLD` in `.env.local`, restart `pnpm dev`. |
| Live scrape fails | Confirm `BROWSERBASE_*` are set and `pnpm dev` was restarted; fixture mode (`live:false`) always works as a fallback. |

---

## TL;DR (everything's already set up)

```bash
docker compose up -d                                   # redis + embedding
pnpm dev                                               # http://localhost:3000
curl.exe -X POST http://localhost:3000/api/seed        # loaded=45
# open http://localhost:3000/dashboard
curl.exe -X POST http://localhost:3000/api/scrape -d "{\"live\":false}" -H "content-type: application/json"
# watch the dashboard fill with scored posts; approve one; re-ingest a paraphrase; watch it flag.
```

---

## How it all works (the concepts)

This explains each moving part — what it does and *why* — so the whole system makes sense.

### The core idea: match meaning, not keywords
Sellers dodge keyword filters by misspelling, abbreviating, swapping in innocent decoy
words, and using emojis ("restockd PRODUCT, hmu for PUFF 🍃") — then changing the words
the moment a filter catches on. A blocklist is always one step behind. Narcore matches on
**meaning**, so a never-before-seen phrase that *talks like* a drug ad still gets caught.

### 1. Embeddings — turning text into "meaning coordinates"
An **embedding** is a list of numbers (here **768** of them) representing the *meaning* of a
piece of text. A model reads the caption and outputs a point in 768-dimensional space. The
key property: **texts with similar meaning land near each other**, even with no words in
common. "blue M30 pills, dm me" and "got them blues, hit my line" end up close together;
"blueberry muffin recipe" ends up far away.

- We use **nomic-embed-text-v2-moe**, an open model we run ourselves.
- Nomic needs a **task prefix** on every input: `search_document:` for text we store,
  `search_query:` for text we look up (the app adds these automatically). Get it wrong and
  the coordinates are subtly off.
- Comparing two embeddings = **cosine similarity**: 1.0 = same direction (same meaning),
  0 = unrelated. Redis returns cosine *distance* (`1 − similarity`); we convert back.

> Analogy: an embedding is a GPS coordinate for *meaning*. Two captions about selling pills
> are "geographically" close even when written completely differently.

### 2. Redis — the vector database that does the matching
Redis here isn't a cache — it's a **vector search engine**. It holds two things:
- **The "known drug-ad" corpus**: each known slang term, and each caption a human later
  approves, stored as `text + its 768-dim vector`. Keys like `corpus:seed:m30` and
  `corpus:approved:<postId>`.
- **The scored posts**: `post:<id>` records for the dashboard.

We build a **vector index** (`idx:corpus`) over the corpus. When a post arrives we embed its
caption and ask Redis *"find the nearest known vector to this one"* — a **KNN
(k-nearest-neighbor) search**. Redis returns the closest known term and how close it is; that
closeness is the semantic part of the score.

Why Redis: in-memory (microsecond lookups), vector search built in, and the same store holds
the posts — one fast dependency instead of a separate vector DB. We use a **FLAT** index
(exact nearest-neighbor) because the corpus is small (hundreds of terms), so exact is fast and
perfectly accurate. (For millions of vectors you'd switch to an approximate index like HNSW.)

### 3. Risk score — semantics plus corroborating signals
A post is risky if it *means* like a drug ad **and** shows tell-tale signs. The score blends
two parts into a 0–1 number:
- **Semantic** (dominant): how close the caption is to the nearest known drug-ad vector.
- **Heuristics** (corroborating, explainable): coded keywords (m30, perc, plug), drug emojis
  (🍃💊), hand-offs to encrypted apps (telegram, signal), payment cues (cashapp, `$`). Each
  carries a small weight, capped so heuristics can *nudge* a borderline post over the line but
  never flag a semantically-clean one alone.

It's **flagged** when the score crosses the threshold (default 0.7). Every flag is
**explainable** — you can see which terms and which nearest known phrase drove it. That's
exactly what the Lead Summary shows law enforcement.

### 4. The learning loop — keeping up with "semantic drift"
This is the heart of it. When sellers invent a new code word, no static list has it — but a
human can recognize it once:
1. Analyst clicks **Approve** on a real drug-ad post.
2. The app re-embeds that caption and **adds its vector to the corpus** (`corpus:approved:*`).
3. Future posts that paraphrase that new term now land near it in vector space → they match →
   they get flagged automatically.

The system **teaches itself new slang from one human confirmation.** To keep the corpus from
filling with stale terms, each learned vector has a **TTL that's refreshed every time it
matches** — a term that keeps catching posts stays alive; one unused for X days is
auto-evicted by Redis (no cleanup job needed).

### 5. The embedding sidecar (llama.cpp) — running the model ourselves
The model runs in its own container (**llama.cpp**, a fast C++ engine for running models) and
exposes an **OpenAI-compatible** `POST /v1/embeddings` endpoint. The app sends text and gets
vectors back over HTTP. Self-hosting means no per-call cost and full control; the swappable
interface lets the app fall back to a hosted endpoint or deterministic **mock** vectors if the
local one is down — so a flaky model never breaks the app.

### 6. Browserbase + Stagehand — the scraper
To get posts, Narcore drives a **real cloud browser** via **Browserbase** (browser-as-a-service)
using **Stagehand** (AI-assisted automation). Why a real browser instead of plain HTTP: social
sites are JavaScript-heavy and bot-protected; a real, fingerprint-clean browser navigates them
like a person. The scraper opens the feed, extracts each post (`username, caption, date, link`),
normalizes it to the shared `ScrapedPost` shape, and POSTs it to `/api/ingest` — the same front
door any data source uses. You watch the session live in the Browserbase dashboard. (For
dev/demo we point it at our own **synthetic `/feed`** — coded + benign posts — so it's reliable
and ethical; a real site is the same code, different URL.)

### 7. The web app — gluing it together
The dashboard is a **Next.js** app; its **route handlers** (`/api/*`) are the backend (no
separate server). End-to-end:

```
scraper ─► POST /api/ingest ─► embed caption ─► Redis KNN ─► score ─► store post
dashboard (SWR, polls every few seconds) ◄── GET /api/posts ◄── Redis
analyst clicks Approve ─► re-embed ─► add vector to corpus  (the learning loop)
```

The dashboard uses **SWR** to poll, so scraped posts appear live and approvals update
instantly. That's the whole system: **scrape → embed → vector-match in Redis → score →
human-in-the-loop → learn.**
