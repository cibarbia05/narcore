// Launches and supervises ONE operative negotiation.
//
// Flow:
//   1. Preconditions: brain configured (ANTHROPIC_API_KEY), at least one login
//      context, the post exists, and the target handle passes the allowlist gate.
//   2. Provision a Browserbase session + live-view URL and persist the operation
//      (status "opening") — awaited so the POST response carries the live URL and
//      the view renders the iframe at once.
//   3. Fire the operative loop un-awaited. Progress is written to Redis; the GET
//      route polls it. The AbortController is kept in a globalThis registry so
//      stopOperation() can cancel + release the session.
//
// MUST run on a persistent Node process (local `pnpm dev` / `next start`), never
// serverless — the loop outlives the request that started it.
import { createIgSession, getLiveViewUrl, endSession } from "../browserbase";
import { getCorpusEntryDrug, getPost } from "../repo";
import { buildLeadSummary } from "../lead-summary";
import { allowlistEnforced, isTargetAllowed, normalizeHandle } from "../operative-allowlist";
import {
  createOperation,
  getOperation,
  getOperationByPost,
  patchOperation,
} from "./operation-store";
import { OPERATION_TERMINAL_STATUSES, type LeadSummary, type Operation, type StartOperationResponse } from "../types";

// Operative sessions are long-lived relative to scraper sessions.
const SESSION_TIMEOUT_SECONDS = clampInt(
  process.env.OPERATIVE_SESSION_TIMEOUT_SECONDS,
  1800,
  60,
  21_600,
);

interface OpHandle {
  controller: AbortController;
  sessionId: string;
}

const globalForOps = globalThis as unknown as {
  __narcoreOps?: Map<string, OpHandle>;
};

function opRegistry(): Map<string, OpHandle> {
  if (!globalForOps.__narcoreOps) globalForOps.__narcoreOps = new Map();
  return globalForOps.__narcoreOps;
}

/** Login contexts (one per burner account). Required — the operative DMs from one. */
function contextIds(): string[] {
  const raw = process.env.BROWSERBASE_CONTEXT_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function newOperationId(): string {
  return `op_${globalThis.crypto.randomUUID().slice(0, 8)}`;
}

/** Raised when a target handle isn't on the operative allowlist — mapped to 403. */
export class OperativeAllowlistError extends Error {
  readonly code = "allowlist_denied";
  constructor(message: string) {
    super(message);
    this.name = "OperativeAllowlistError";
  }
}

export interface StartOperationConfig {
  postId: string;
  targetHandle?: string;
}

export async function startOperation(
  config: StartOperationConfig,
): Promise<StartOperationResponse> {
  // 1. Preconditions.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — the operative brain requires it");
  }
  const contexts = contextIds();
  if (contexts.length === 0) {
    throw new Error(
      "BROWSERBASE_CONTEXT_IDS is empty — run `pnpm ig:login` once per burner account and paste the context ids in your env.",
    );
  }

  const post = await getPost(config.postId);
  if (!post) throw new Error(`post ${config.postId} not found`);

  const handle = normalizeHandle(config.targetHandle ?? post.username);
  if (!handle) throw new Error("no target handle to engage");

  // 2. ALLOWLIST GATE (defense in depth — the UI also gates this).
  if (!isTargetAllowed(handle)) {
    throw new OperativeAllowlistError(
      `@${handle} is not on the operative allowlist — only demo accounts you control can be engaged.`,
    );
  }
  if (!allowlistEnforced()) {
    console.warn(
      "[operative] ⚠ OPERATIVE_ALLOWLIST_ENFORCED=false — the operative can DM arbitrary accounts. This must never be set in a demo or shared environment.",
    );
  }

  // 3. Reuse an in-flight operation for this post rather than double-launching.
  const existingId = await getOperationByPost(post.id);
  if (existingId) {
    const existing = await getOperation(existingId);
    if (existing && !OPERATION_TERMINAL_STATUSES.includes(existing.status)) {
      return { operationId: existing.id, operation: existing };
    }
  }

  // Build the briefing (enrich the matched-term drug like the outreach route does).
  const lead: LeadSummary = buildLeadSummary(post);
  lead.matchedKnownTermDrug = await getCorpusEntryDrug(post.risk.matchedTermId).catch(() => null);

  const operationId = newOperationId();
  const contextId = contexts[0]; // single burner is enough; round-robin if many ops

  // Provision the session up front so the POST response carries the live-view URL.
  const sessionId = await createIgSession(contextId, {
    timeoutSeconds: SESSION_TIMEOUT_SECONDS,
  });
  const liveViewUrl = await getLiveViewUrl(sessionId);

  const now = new Date().toISOString();
  const operation: Operation = {
    id: operationId,
    postId: post.id,
    handle,
    platform: post.platform,
    sessionId,
    liveViewUrl,
    status: "opening",
    currentAction: "provisioning browser",
    dealConfirmed: false,
    locationConfirmed: false,
    meetingLocation: null,
    meetingTime: null,
    turnCount: 0,
    messages: [],
    priorIntel: [],
    error: null,
    startedAt: now,
    updatedAt: now,
  };
  await createOperation(operation);

  // Fire the loop un-awaited; register the abort handle for stopOperation().
  const controller = new AbortController();
  opRegistry().set(operationId, { controller, sessionId });
  void runOperationLoop(operation, lead, controller.signal);

  return { operationId, operation };
}

async function runOperationLoop(
  operation: Operation,
  lead: LeadSummary,
  signal: AbortSignal,
): Promise<void> {
  try {
    // Dynamic import keeps Stagehand out of the route bundle (matches ig-agent).
    const { runOperativeAgent } = await import("../../../scraper/operative-agent");
    await runOperativeAgent({
      operationId: operation.id,
      handle: operation.handle,
      lead,
      sessionId: operation.sessionId,
      signal,
    });
  } catch (err) {
    console.error(`[operative] operation ${operation.id} loop crashed:`, err);
    const message = err instanceof Error ? err.message : String(err);
    await patchOperation(operation.id, {
      status: "error",
      currentAction: "operative error",
      error: message.slice(0, 300),
    });
  } finally {
    opRegistry().delete(operation.id);
  }
}

/** Abort an operation and release its Browserbase session. Marks it "stopped" first
 *  (so the UI flips to a clean terminal panel) unless it already finished. */
export async function stopOperation(id: string): Promise<void> {
  const op = await getOperation(id);
  if (op && !OPERATION_TERMINAL_STATUSES.includes(op.status)) {
    await patchOperation(id, { status: "stopped", currentAction: "stopped by operator" });
  }
  const handle = opRegistry().get(id);
  if (handle) {
    handle.controller.abort();
    await endSession(handle.sessionId);
    opRegistry().delete(id);
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
