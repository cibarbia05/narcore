// Redis-backed state for operative negotiations. Authoritative, pollable progress
// lives here (not in process memory) so GET /api/operations/[id] reads live status
// regardless of which request — or the operative loop — last wrote it.
//
// Layout:
//   op:{id}             hash    Operation (flattened; the transcript lives separately)
//   op:{id}:messages    list    JSON OperationMessage[] (append-only, oldest first)
//   op:latest           string  most recent operation id (lets the UI resume)
//   op:by-post:{postId} string  active operation id for a post (prevents double-launch)
import { connectRedis } from "../redis";
import type { Operation, OperationMessage, OperationStatus } from "../types";

// Negotiations run longer than scraper runs — keep their keys for a few hours.
const OP_TTL_SECONDS = clampPositiveInt(process.env.OPERATION_TTL_SECONDS, 6 * 3600);

const opKey = (id: string) => `op:${id}`;
const msgsKey = (id: string) => `op:${id}:messages`;
const LATEST_KEY = "op:latest";
const byPostKey = (postId: string) => `op:by-post:${postId}`;

function nowIso(): string {
  return new Date().toISOString();
}

function clampPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Flatten an Operation (minus its transcript) to a Redis hash. */
function opToHash(o: Omit<Operation, "messages">): Record<string, string> {
  return {
    id: o.id,
    postId: o.postId,
    handle: o.handle,
    platform: o.platform,
    sessionId: o.sessionId,
    liveViewUrl: o.liveViewUrl,
    status: o.status,
    currentAction: o.currentAction,
    dealConfirmed: String(o.dealConfirmed),
    locationConfirmed: String(o.locationConfirmed),
    meetingLocation: o.meetingLocation ?? "",
    meetingTime: o.meetingTime ?? "",
    turnCount: String(o.turnCount),
    priorIntelJson: JSON.stringify(o.priorIntel ?? []),
    error: o.error ?? "",
    startedAt: o.startedAt,
    updatedAt: o.updatedAt,
  };
}

function parseStringArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function hashToOp(h: Record<string, string>, messages: OperationMessage[]): Operation {
  return {
    id: h.id ?? "",
    postId: h.postId ?? "",
    handle: h.handle ?? "",
    platform: (h.platform as Operation["platform"]) ?? "instagram",
    sessionId: h.sessionId ?? "",
    liveViewUrl: h.liveViewUrl ?? "",
    status: (h.status as OperationStatus) ?? "opening",
    currentAction: h.currentAction ?? "",
    dealConfirmed: h.dealConfirmed === "true",
    locationConfirmed: h.locationConfirmed === "true",
    meetingLocation: h.meetingLocation ? h.meetingLocation : null,
    meetingTime: h.meetingTime ? h.meetingTime : null,
    turnCount: Number.parseInt(h.turnCount ?? "0", 10),
    messages,
    priorIntel: parseStringArray(h.priorIntelJson),
    error: h.error ? h.error : null,
    startedAt: h.startedAt ?? "",
    updatedAt: h.updatedAt ?? "",
  };
}

/** Create the operation record and remember it as latest + active-for-post. */
export async function createOperation(operation: Operation): Promise<void> {
  const client = await connectRedis();
  await client.hSet(opKey(operation.id), opToHash({ ...operation, updatedAt: nowIso() }));
  await client.expire(opKey(operation.id), OP_TTL_SECONDS);
  await client.set(LATEST_KEY, operation.id, { EX: OP_TTL_SECONDS });
  await client.set(byPostKey(operation.postId), operation.id, { EX: OP_TTL_SECONDS });
}

/** Patch a subset of an operation's scalar fields (never the transcript). */
export async function patchOperation(
  id: string,
  patch: Partial<Omit<Operation, "id" | "messages">>,
): Promise<void> {
  const client = await connectRedis();
  const fields: Record<string, string> = { updatedAt: nowIso() };
  if (patch.postId !== undefined) fields.postId = patch.postId;
  if (patch.handle !== undefined) fields.handle = patch.handle;
  if (patch.platform !== undefined) fields.platform = patch.platform;
  if (patch.sessionId !== undefined) fields.sessionId = patch.sessionId;
  if (patch.liveViewUrl !== undefined) fields.liveViewUrl = patch.liveViewUrl;
  if (patch.status !== undefined) fields.status = patch.status;
  if (patch.currentAction !== undefined) fields.currentAction = patch.currentAction;
  if (patch.dealConfirmed !== undefined) fields.dealConfirmed = String(patch.dealConfirmed);
  if (patch.locationConfirmed !== undefined)
    fields.locationConfirmed = String(patch.locationConfirmed);
  if (patch.meetingLocation !== undefined) fields.meetingLocation = patch.meetingLocation ?? "";
  if (patch.meetingTime !== undefined) fields.meetingTime = patch.meetingTime ?? "";
  if (patch.turnCount !== undefined) fields.turnCount = String(patch.turnCount);
  if (patch.priorIntel !== undefined) fields.priorIntelJson = JSON.stringify(patch.priorIntel);
  if (patch.error !== undefined) fields.error = patch.error ?? "";
  await client.hSet(opKey(id), fields);
}

/** Append one message to the transcript (oldest first). */
export async function appendMessage(id: string, message: OperationMessage): Promise<void> {
  const client = await connectRedis();
  await client.rPush(msgsKey(id), JSON.stringify(message));
  await client.expire(msgsKey(id), OP_TTL_SECONDS);
}

export async function getOperationMessages(id: string): Promise<OperationMessage[]> {
  const client = await connectRedis();
  const raw = await client.lRange(msgsKey(id), 0, -1);
  const out: OperationMessage[] = [];
  for (const r of raw) {
    try {
      out.push(JSON.parse(r) as OperationMessage);
    } catch {
      /* skip a corrupt line rather than break the whole transcript */
    }
  }
  return out;
}

export async function setOperationStatus(id: string, status: OperationStatus): Promise<void> {
  const client = await connectRedis();
  await client.hSet(opKey(id), { status, updatedAt: nowIso() });
}

/** Assemble an operation + its transcript. Returns null if unknown. */
export async function getOperation(id: string): Promise<Operation | null> {
  const client = await connectRedis();
  const h = await client.hGetAll(opKey(id));
  if (!h || !h.id) return null;
  const messages = await getOperationMessages(id);
  return hashToOp(h, messages);
}

export async function getLatestOperationId(): Promise<string | null> {
  const client = await connectRedis();
  return (await client.get(LATEST_KEY)) ?? null;
}

export async function getOperationByPost(postId: string): Promise<string | null> {
  const client = await connectRedis();
  return (await client.get(byPostKey(postId))) ?? null;
}
