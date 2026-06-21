// Launches and supervises a run of N parallel Instagram agents.
//
// Flow per run:
//   1. Resolve config (agent count, target hashtags, login contexts).
//   2. For each agent — IN PARALLEL — create a Browserbase session and fetch its
//      live-view URL, then persist the agent record. This is awaited so the POST
//      response carries the live URLs and the UI can render the video grid at once.
//   3. Fire each agent's loop un-awaited (fire-and-forget). Progress is written to
//      Redis by the loop; the GET route polls it. AbortControllers are kept in a
//      globalThis registry so stopRun() can cancel + release everything.
//
// MUST run on a persistent Node process (local `pnpm dev` / `next start`), never
// serverless — the loops outlive the request that started them.
import { createIgSession, getLiveViewUrl, endSession } from "../browserbase";
import { createRun, saveAgent, setRunStatus, getRun } from "./run-store";
import type { AgentRecord, StartRunResponse } from "../types";
import { AGENT_TERMINAL_STATUSES } from "../types";
import seed from "../../../data/seed-terms.json";

const DEFAULT_AGENT_COUNT = 5;

interface RunHandle {
  controllers: AbortController[];
  sessionIds: string[];
}

const globalForRuns = globalThis as unknown as {
  __narcoreRuns?: Map<string, RunHandle>;
};

function runRegistry(): Map<string, RunHandle> {
  if (!globalForRuns.__narcoreRuns) globalForRuns.__narcoreRuns = new Map();
  return globalForRuns.__narcoreRuns;
}

/** Login contexts (one per burner account). Required. */
function contextIds(): string[] {
  const raw = process.env.BROWSERBASE_CONTEXT_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Default hashtags = the strongest single-token coded terms from the corpus, so
 *  the agents hunt the same slang the detector already knows. Overridable via
 *  IG_TARGET_TAGS or the request body. */
function defaultTags(): string[] {
  const terms = (seed.terms as Array<{ term: string }>).map((t) => t.term.toLowerCase());
  const slugs = terms.filter((t) => /^[a-z0-9]{2,20}$/.test(t));
  return Array.from(new Set(slugs));
}

function resolveTags(requested?: string[]): string[] {
  const fromEnv = (process.env.IG_TARGET_TAGS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^#/, ""))
    .filter(Boolean);
  const picked = (requested && requested.length > 0 ? requested : fromEnv);
  return picked.length > 0 ? picked : defaultTags();
}

function newRunId(): string {
  return `run_${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

export interface StartRunConfig {
  agentCount?: number;
  tags?: string[];
}

export async function startRun(config: StartRunConfig = {}): Promise<StartRunResponse> {
  const contexts = contextIds();
  if (contexts.length === 0) {
    throw new Error(
      "BROWSERBASE_CONTEXT_IDS is empty — run `pnpm ig:login` once per burner account and paste the context ids in your env.",
    );
  }

  const requested =
    config.agentCount ?? clampInt(process.env.IG_AGENT_COUNT, DEFAULT_AGENT_COUNT, 1, 10);
  const tags = resolveTags(config.tags);
  const agentCount = Math.min(requested, tags.length || requested);

  if (contexts.length < agentCount) {
    console.warn(
      `[orchestrator] ${agentCount} agents but only ${contexts.length} login context(s) — reusing contexts round-robin. Provision more burner accounts for full isolation.`,
    );
  }

  const runId = newRunId();
  await createRun(runId, agentCount);

  // Create the N sessions in parallel; collect agent records (with live URLs).
  const records = await Promise.all(
    Array.from({ length: agentCount }, (_, i) => i + 1).map((idx) =>
      provisionAgent(runId, idx, tags[(idx - 1) % tags.length], contexts[(idx - 1) % contexts.length]),
    ),
  );

  // Register abort handles, then fire each agent loop (un-awaited).
  const handle: RunHandle = { controllers: [], sessionIds: [] };
  for (const rec of records) {
    if (!rec.sessionId) continue; // provisioning failed — already marked "error"
    const controller = new AbortController();
    handle.controllers.push(controller);
    handle.sessionIds.push(rec.sessionId);
    void runAgentLoop(runId, rec, controller.signal);
  }
  runRegistry().set(runId, handle);

  return { runId, agents: records };
}

/** Create a session + live-view URL for one agent and persist its record. On
 *  failure the record is still returned (status "error") so the tile renders. */
async function provisionAgent(
  runId: string,
  idx: number,
  target: string,
  contextId: string,
): Promise<AgentRecord> {
  const base: AgentRecord = {
    idx,
    name: `Agent ${idx}`,
    target,
    sessionId: "",
    liveViewUrl: "",
    status: "starting",
    currentAction: "provisioning browser",
    postsFound: 0,
    lastCaption: null,
    error: null,
    updatedAt: "",
  };
  try {
    const sessionId = await createIgSession(contextId);
    const liveViewUrl = await getLiveViewUrl(sessionId);
    const rec: AgentRecord = { ...base, sessionId, liveViewUrl };
    await saveAgent(runId, rec);
    return rec;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[orchestrator] failed to provision agent ${idx}:`, err);
    const rec: AgentRecord = {
      ...base,
      status: "error",
      currentAction: "could not start browser",
      error: message.slice(0, 300),
    };
    await saveAgent(runId, rec);
    return rec;
  }
}

async function runAgentLoop(
  runId: string,
  rec: AgentRecord,
  signal: AbortSignal,
): Promise<void> {
  try {
    // Dynamic import keeps Stagehand out of the route bundle (matches /api/scrape).
    const { runIgAgent } = await import("../../../scraper/ig-agent");
    await runIgAgent({ runId, idx: rec.idx, target: rec.target, sessionId: rec.sessionId, signal });
  } catch (err) {
    console.error(`[orchestrator] agent ${rec.idx} loop crashed:`, err);
  } finally {
    await maybeFinishRun(runId);
  }
}

/** Mark the run done once every agent has reached a terminal state. */
async function maybeFinishRun(runId: string): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  const allDone =
    run.agents.length > 0 &&
    run.agents.every((a) => AGENT_TERMINAL_STATUSES.includes(a.status));
  if (allDone && run.status === "running") {
    await setRunStatus(runId, "done");
    runRegistry().delete(runId);
  }
}

/** Abort every agent in a run and release its sessions. */
export async function stopRun(runId: string): Promise<void> {
  const handle = runRegistry().get(runId);
  if (handle) {
    for (const c of handle.controllers) c.abort();
    await Promise.all(handle.sessionIds.map((sid) => endSession(sid)));
    runRegistry().delete(runId);
  }
  await setRunStatus(runId, "stopped");
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
