# Narcore — What's New (Redis + Browserbase deepenings)

A plain-language guide to the four upgrades we added to win the **Redis** and
**Browserbase** sponsor tracks. For exact env vars and file lists, see `OPERATIVE.md`.

---

## The one-sentence idea

> **Narcore is a self-improving undercover narcotics investigator: a Browserbase agent
> infiltrates logged-in Instagram and negotiates a real deal in a live war room — and
> every bust it closes is written into Redis memory + a vector corpus that makes the
> *next* operation smarter. All on one Redis.**

The thing a judge remembers: **"It gets better at catching dealers every time it catches one."**

---

## The mental model

```
                    ┌─────────────────────── ONE REDIS ───────────────────────┐
                    │                                                          │
   Instagram  ─────▶│  vector corpus (detection)   ◀── R1 writes field slang  │
   (Browserbase)    │  agent memory (Iris)         ◀── R2 pins each bust      │
        ▲           │  operation state / streams                              │
        │           └──────────────────────────────────────────────────────-─┘
        │                          ▲                         │
        │   B2 consistent identity │                         │ R2 recall primes
        │                          │                         ▼ the next op
        └──────────  the operative (Stagehand, B3 self-healing DM-open) ───────┘

   THE LOOP:  Browserbase produces field intel ──▶ Redis learns ──▶ next Browserbase op is smarter
```

Everything below is **verified end-to-end against live infrastructure** (real Redis,
the local nomic embedder, Claude, and Browserbase) — not just type-checked. The
verification scripts live in `scripts/test-*.ts`.

---

## R1 — The detector learns from every bust  *(Redis)*

**What it is.** When an undercover operation is *confirmed*, Narcore reads the slang the
**seller** actually used and teaches it to the detector.

**Why it matters.** This is the Redis "beyond caching" centerpiece — a visible feedback
loop, not a static vector database. Drug slang mutates constantly; now the system keeps up
on its own.

**How it works.**
1. One Claude call extracts the coded terms from the seller's messages.
2. A **provenance gate** keeps a term only if Claude is confident *and* the quote is
   really in the seller's own words (so the agent can't teach itself made-up words).
3. Survivors are embedded and stored as `corpus:field:*` vectors in the **same** Redis
   vector index the detector already searches — so they instantly raise the risk score of
   matching posts.
4. Pending posts are re-scored; a live ticker (`stream:field-intel`, a Redis Stream)
   announces "operative learned 'X' → N posts re-flagged."

**See it.** The war room shows a "field intel" ticker; the dashboard's corpus bar and the
Vector Space page gain a **field** category.

**Proof.** 15/15 live checks: learning a term raised a pending post **11.9 → 82.5** and
flipped it to flagged.

---

## R2 — The operative remembers across operations  *(Redis Iris / Agent Memory)*

**What it is.** The operative now has long-term memory. Before a new negotiation it
**recalls** what worked against similar sellers; after a confirmed deal it **pins** what it
learned.

**Why it matters.** This is the rubric-verbatim "Redis Iris for Agent memory." Judges see
their own tool doing real work — and it makes the "gets smarter every bust" story literal
and demoable.

**How it works.**
- We run the official **Redis Agent Memory Server** as a container on the same Redis.
- At the start of an op, Narcore semantically searches memory and injects the top hits into
  the negotiator's prompt as `PRIOR_INTEL` ("opener that worked," "this seller responds to
  casual texts," etc.).
- After a confirmed bust, it pins a durable episodic memory (drug, meeting spot, opener,
  turns).
- Memory uses the **same local embedder** as the corpus — one embedding family, one box,
  no external key.
- **Fail-open:** if the memory server is down, recall returns nothing and the operative
  runs exactly as before. Memory is an amplifier, never a dependency.

**See it.** The `/memory` page browses everything the operative has learned; the war room
shows a "Prior intel used" card.

**Proof.** 7/7 live checks: pin → worker indexes → semantic recall returns it for a
*different* seller (cross-seller learning), and fail-open verified with the server down.

> Engineering note: the memory server embeds via LiteLLM, which sends a `null` field that
> the local embedder rejects. We root-caused it and added a tiny null-stripping proxy
> (`infra/embedding-proxy/`) so it can reuse our embedder. Documented in `OPERATIVE.md`.

---

## B2 — One consistent browser identity  *(Browserbase)*

**What it is.** The login and every automated run use the same browser fingerprint, and the
war room shows an **"identity match"** badge.

**Why it matters.** A mismatched fingerprint is the #1 reason Instagram throws a checkpoint
mid-demo. This makes the demo robust and surfaces the risk before it bites.

**How it works.** All sessions go through one function; `pnpm ig:login` records the
fingerprint, and runs verify they still match it.

**Proof.** 14/14 live checks — and it caught a real Browserbase `400` (a non-Linux OS needs
the Enterprise plan), which we now guard against so a misconfig can't break session creation.

---

## B3 — Self-healing DM open  *(Browserbase / Stagehand agent)*

**What it is.** The most fragile step — finding and opening the seller's DM through
Instagram's shifting UI — can be handled by a one-line **Stagehand agent** that figures out
its own path past popups and layout changes.

**Why it matters.** It showcases Stagehand's flagship autonomy while keeping the
auditable "send message" loop deterministic — senior judgment about *when* to use autonomy.

**How it works.** A DOM-mode agent (reusing our existing model + key — no extra cost) opens
the thread; our own check (`/direct/t/…`) still decides success, not the agent's say-so.
**Defaulted off** behind a flag — flip `OPERATIVE_DM_OPEN_STRATEGY=agent` and run a short
live spike against your burner before relying on it.

**Status.** Built, type-checked, and SDK-verified. Its *live* test drives your real
Instagram account, so it's left off by default for you to enable and spike when ready.

---

## The keystone: it all connects

The win isn't four features — it's **one loop**: the Browserbase operative runs a real
negotiation → Redis learns from each confirmed bust (R1 corpus + R2 memory) → the next
Browserbase operation opens already knowing what the last one learned. That single loop is
what makes Narcore the clear #1 on **both** tracks instead of a strong entry on each.

---

## Run it

```bash
docker compose up -d        # Redis + embedder + the R2 agent-memory stack (proxy/api/worker)
pnpm seed                   # seed the detection corpus
pnpm seed:memories          # pre-seed operative memory (so the first op shows "Prior intel")
pnpm dev                    # the app at http://localhost:3000
```

Demo path: **Dashboard → Engage a flagged demo lead → watch the war room → on confirm,
the field-intel ticker fires and the bust is pinned to memory → the next op is primed by
it.**

## Verify it yourself

```bash
npx tsx scripts/test-field-intel.ts     # R1  — 15 checks
npx tsx scripts/test-agent-memory.ts    # R2  —  7 checks
npx tsx scripts/test-identity.ts        # B2  — 14 checks
```
