// Redis-backed state for parallel-agent runs. Authoritative, pollable progress
// lives here (not in process memory) so the GET /api/agents/run/[id] route reads
// live status regardless of which request — or which agent loop — last wrote it.
//
// Layout (each agent owns its own hash → the 5 loops never race on a shared key):
//   run:{id}              hash  { id, status, startedAt, agentCount }
//   run:{id}:agent:{idx}  hash  AgentRecord (flattened)
//   run:latest            string  most recent runId (lets the UI resume on reload)
import { connectRedis } from "../redis";
import type { AgentRecord, AgentRun, AgentStatus, RunStatus } from "../types";

// Demo state is ephemeral — expire run keys so Redis doesn't accumulate.
const RUN_TTL_SECONDS = 3600;

const runKey = (id: string) => `run:${id}`;
const agentKey = (id: string, idx: number) => `run:${id}:agent:${idx}`;
const LATEST_KEY = "run:latest";

function nowIso(): string {
  return new Date().toISOString();
}

/** Flatten an AgentRecord to a Redis hash (all string values; nulls → ""). */
function agentToHash(a: AgentRecord): Record<string, string> {
  return {
    idx: String(a.idx),
    name: a.name,
    target: a.target,
    sessionId: a.sessionId,
    liveViewUrl: a.liveViewUrl,
    status: a.status,
    currentAction: a.currentAction,
    postsFound: String(a.postsFound),
    flaggedFound: String(a.flaggedFound),
    lastCaption: a.lastCaption ?? "",
    error: a.error ?? "",
    updatedAt: a.updatedAt,
  };
}

function hashToAgent(h: Record<string, string>): AgentRecord {
  return {
    idx: Number.parseInt(h.idx ?? "0", 10),
    name: h.name ?? "",
    target: h.target ?? "",
    sessionId: h.sessionId ?? "",
    liveViewUrl: h.liveViewUrl ?? "",
    status: (h.status as AgentStatus) ?? "starting",
    currentAction: h.currentAction ?? "",
    postsFound: Number.parseInt(h.postsFound ?? "0", 10),
    flaggedFound: Number.parseInt(h.flaggedFound ?? "0", 10),
    lastCaption: h.lastCaption ? h.lastCaption : null,
    error: h.error ? h.error : null,
    updatedAt: h.updatedAt ?? "",
  };
}

/** Create the run record (status "running") and remember it as the latest run. */
export async function createRun(id: string, agentCount: number): Promise<void> {
  const client = await connectRedis();
  await client.hSet(runKey(id), {
    id,
    status: "running",
    startedAt: nowIso(),
    agentCount: String(agentCount),
  });
  await client.expire(runKey(id), RUN_TTL_SECONDS);
  await client.set(LATEST_KEY, id, { EX: RUN_TTL_SECONDS });
}

/** Write a full agent record (used when an agent is first registered). */
export async function saveAgent(runId: string, agent: AgentRecord): Promise<void> {
  const client = await connectRedis();
  const key = agentKey(runId, agent.idx);
  await client.hSet(key, agentToHash({ ...agent, updatedAt: nowIso() }));
  await client.expire(key, RUN_TTL_SECONDS);
}

/** Patch a subset of an agent's fields. Each agent loop only ever patches its own
 *  hash, so concurrent patches from sibling agents never collide. */
export async function patchAgent(
  runId: string,
  idx: number,
  patch: Partial<Omit<AgentRecord, "idx">>,
): Promise<void> {
  const client = await connectRedis();
  const fields: Record<string, string> = { updatedAt: nowIso() };
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.target !== undefined) fields.target = patch.target;
  if (patch.sessionId !== undefined) fields.sessionId = patch.sessionId;
  if (patch.liveViewUrl !== undefined) fields.liveViewUrl = patch.liveViewUrl;
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.currentAction !== undefined) fields.currentAction = patch.currentAction;
  if (patch.postsFound !== undefined) fields.postsFound = String(patch.postsFound);
  if (patch.flaggedFound !== undefined) fields.flaggedFound = String(patch.flaggedFound);
  if (patch.lastCaption !== undefined) fields.lastCaption = patch.lastCaption ?? "";
  if (patch.error !== undefined) fields.error = patch.error ?? "";
  await client.hSet(agentKey(runId, idx), fields);
}

export async function setRunStatus(runId: string, status: RunStatus): Promise<void> {
  const client = await connectRedis();
  await client.hSet(runKey(runId), { status });
}

/** Assemble a run + its agents for the polling route. Returns null if unknown. */
export async function getRun(runId: string): Promise<AgentRun | null> {
  const client = await connectRedis();
  const run = await client.hGetAll(runKey(runId));
  if (!run || !run.id) return null;

  const agentCount = Number.parseInt(run.agentCount ?? "0", 10);
  const idxs = Array.from({ length: agentCount }, (_, i) => i + 1);
  const hashes = await Promise.all(idxs.map((i) => client.hGetAll(agentKey(runId, i))));
  const agents = hashes
    .filter((h) => h && Object.keys(h).length > 0)
    .map(hashToAgent)
    .sort((a, b) => a.idx - b.idx);

  return {
    id: run.id,
    status: (run.status as RunStatus) ?? "running",
    startedAt: run.startedAt ?? "",
    agentCount,
    agents,
  };
}

export async function getLatestRunId(): Promise<string | null> {
  const client = await connectRedis();
  const id = await client.get(LATEST_KEY);
  return id ?? null;
}
