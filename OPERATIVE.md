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
