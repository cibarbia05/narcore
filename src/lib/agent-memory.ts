// R2 — Redis Iris agent memory client (cross-operation operative memory).
//
// Talks to the Redis Agent Memory Server (docker-compose service `agent-memory`)
// over REST. The operative RECALLS prior field intelligence before opening a new
// negotiation (turn-0 priming) and PINS what it learned after a confirmed bust, so
// it gets sharper every operation. Long-term memories live in Redis (the server's
// own RedisVL index) using the SAME local nomic embedding family as the corpus.
//
// FAIL-OPEN BY DESIGN: every call has a short timeout and swallows errors. If the
// memory server is down, recall returns [] and pin returns false — the operative
// runs exactly as it does today. Memory is an amplifier, never a dependency.
//
// REST contract verified against redislabs/agent-memory-server (live OpenAPI):
//   POST /v1/long-term-memory/        { memories: [{ id, text, memory_type, topics, entities, user_id, namespace }] }
//   POST /v1/long-term-memory/search  { text, namespace: {eq}, limit }  -> { memories: [{ ..., dist, score }] }
//   (tag filters MUST be objects, e.g. namespace: { eq: "operative" })

function baseUrl(): string {
  return (process.env.AGENT_MEMORY_URL ?? "http://localhost:8000").replace(/\/$/, "");
}
const NAMESPACE = "operative";
const TIMEOUT_MS = clampInt(process.env.AGENT_MEMORY_TIMEOUT_MS, 4000, 500, 30_000);
const RECALL_LIMIT = clampInt(process.env.AGENT_MEMORY_RECALL_LIMIT, 3, 1, 10);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface RecalledMemory {
  id: string;
  text: string;
  similarity: number | null; // 0..1 (1 - cosine distance), or null if unavailable
  topics: string[];
  entities: string[];
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`agent-memory ${path} -> HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export interface RecallInput {
  handle: string;
  drug: string | null;
  codeWords: string[];
}

/** Recall prior field intel relevant to this lead (turn-0 priming). Fail-open: []. */
export async function recallMemories(input: RecallInput): Promise<RecalledMemory[]> {
  const { handle, drug, codeWords } = input;
  const query =
    `Operating undercover against @${handle}` +
    (drug ? `, a seller of ${drug}` : "") +
    (codeWords.length ? `. Coded terms seen: ${codeWords.join(", ")}` : "") +
    `. What opener, tone, and tactics have worked with sellers like this before?`;
  try {
    const data = (await postJson("/v1/long-term-memory/search", {
      text: query,
      namespace: { eq: NAMESPACE },
      limit: RECALL_LIMIT,
    })) as { memories?: Array<Record<string, unknown>> };
    const memories = Array.isArray(data?.memories) ? data.memories : [];
    return memories.map((m) => {
      const dist = typeof m.dist === "number" ? m.dist : null;
      const score = typeof m.score === "number" ? m.score : null;
      const similarity = score ?? (dist !== null ? Math.max(0, 1 - dist) : null);
      return {
        id: String(m.id ?? ""),
        text: String(m.text ?? ""),
        similarity,
        topics: strArray(m.topics),
        entities: strArray(m.entities),
      };
    });
  } catch (err) {
    console.warn("[agent-memory] recall failed (fail-open):", err instanceof Error ? err.message : err);
    return [];
  }
}

export interface PinInput {
  operationId: string;
  handle: string;
  drug: string | null;
  codeWords: string[];
  opener: string | null; // the operative's opening line
  meetingLocation: string | null;
  meetingTime: string | null;
  turnCount: number;
}

/** Build a durable, human-readable episodic memory from a confirmed operation. */
function buildMemoryText(input: PinInput): string {
  const parts = [
    `Confirmed a deal with @${input.handle}${input.drug ? ` (${input.drug})` : ""}.`,
  ];
  if (input.meetingLocation) parts.push(`Agreed meeting location: ${input.meetingLocation}.`);
  if (input.meetingTime) parts.push(`Time: ${input.meetingTime}.`);
  if (input.codeWords.length) parts.push(`Coded terms used: ${input.codeWords.join(", ")}.`);
  if (input.opener) parts.push(`Opening line that worked: "${input.opener}".`);
  parts.push(`Closed in ${input.turnCount} operative message${input.turnCount === 1 ? "" : "s"}.`);
  return parts.join(" ");
}

/** Pin a confirmed operation as long-term episodic memory. Fail-open: returns false. */
export async function pinOperationMemory(input: PinInput): Promise<boolean> {
  try {
    const entities = Array.from(new Set([input.handle, ...input.codeWords])).filter(Boolean);
    const topics = input.drug ? [input.drug] : [];
    await postJson("/v1/long-term-memory/", {
      memories: [
        {
          id: `op-${input.operationId}`,
          text: buildMemoryText(input),
          memory_type: "episodic",
          topics,
          entities,
          user_id: input.handle,
          namespace: NAMESPACE,
        },
      ],
    });
    return true;
  } catch (err) {
    console.warn("[agent-memory] pin failed (fail-open):", err instanceof Error ? err.message : err);
    return false;
  }
}

/** List recent long-term memories for the /memory page. Fail-open: []. */
export async function listMemories(limit = 50): Promise<RecalledMemory[]> {
  try {
    const data = (await postJson("/v1/long-term-memory/search", {
      text: "operative field intelligence",
      namespace: { eq: NAMESPACE },
      limit,
    })) as { memories?: Array<Record<string, unknown>> };
    const memories = Array.isArray(data?.memories) ? data.memories : [];
    return memories.map((m) => ({
      id: String(m.id ?? ""),
      text: String(m.text ?? ""),
      similarity: typeof m.score === "number" ? m.score : null,
      topics: strArray(m.topics),
      entities: strArray(m.entities),
    }));
  } catch (err) {
    console.warn("[agent-memory] list failed (fail-open):", err instanceof Error ? err.message : err);
    return [];
  }
}
