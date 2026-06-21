// Embedding client — swappable behind one HTTP interface (Q2).
//
// Resolution order (env EMBEDDING_MODE):
//   - "live": require a configured provider; throw if all fail.
//   - "mock": always return deterministic local vectors (no network).
//   - "auto" (default): try each configured OpenAI-compatible provider in order;
//     if none are configured or all fail, fall back to mock so the demo never
//     dies on a flaky local server.
//
// A "provider" is any OpenAI-compatible POST /v1/embeddings endpoint:
//   - self-host: EMBEDDING_API_URL (llama.cpp `--embeddings`), optional EMBEDDING_API_KEY
//   - hosted fallback: NOMIC_API_URL (a hosted nomic-compatible endpoint) + NOMIC_API_KEY
import { EMBEDDING_DIM, EMBEDDING_MODEL, EMBED_PREFIX } from "./model";

export { EMBEDDING_DIM, MODEL_VERSION } from "./model";

export type EmbedKind = "document" | "query";

export class EmbeddingDimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingDimError";
  }
}

export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

const TIMEOUT_MS = 10_000;
const BATCH_SIZE = 64;

interface Provider {
  url: string;
  key?: string;
}

function providers(): Provider[] {
  const list: Provider[] = [];
  if (process.env.EMBEDDING_API_URL) {
    list.push({ url: process.env.EMBEDDING_API_URL, key: process.env.EMBEDDING_API_KEY });
  }
  if (process.env.NOMIC_API_URL) {
    list.push({ url: process.env.NOMIC_API_URL, key: process.env.NOMIC_API_KEY });
  }
  return list;
}

function mode(): "auto" | "mock" | "live" {
  const m = (process.env.EMBEDDING_MODE ?? "auto").toLowerCase();
  return m === "mock" || m === "live" ? m : "auto";
}

/** Embed one text. Adds the required Nomic task prefix internally. */
export async function embed(text: string, kind: EmbedKind): Promise<number[]> {
  const [vector] = await embedBatch([text], kind);
  return vector;
}

/** Batch embed. Preserves input order. Chunks large inputs into BATCH_SIZE calls. */
export async function embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]> {
  if (texts.length === 0) return [];

  const m = mode();
  if (m !== "mock") {
    const provs = providers();
    for (const provider of provs) {
      try {
        return await embedViaProvider(provider, texts, kind);
      } catch (err) {
        const isLast = provider === provs[provs.length - 1];
        if (m === "live" && isLast) {
          if (err instanceof EmbeddingDimError) throw err;
          throw new EmbeddingUnavailableError(String(err));
        }
        // auto mode: fall through to the next provider, then to mock.
      }
    }
    if (m === "live") throw new EmbeddingUnavailableError("no embedding provider configured");
  }

  // Deterministic, L2-normalized mock vectors keyed on the RAW text (prefix-
  // independent) so a query embedding matches a stored document embedding of the
  // same text — the full pipeline works end-to-end with no sidecar.
  return texts.map((t) => mockVector(t));
}

/** Liveness check used by /api/health. Mock mode is always "available". */
export async function pingEmbeddings(): Promise<boolean> {
  if (mode() === "mock" || providers().length === 0) return true;
  try {
    const [vector] = await callOpenAIEmbeddings(providers()[0], [EMBED_PREFIX.query + "ping"]);
    return vector.length === EMBEDDING_DIM;
  } catch {
    return false;
  }
}

export interface EmbeddingHealth {
  mode: "auto" | "mock" | "live";
  providersConfigured: number;
  /** A real provider responded with a correctly-dimensioned vector. */
  live: boolean;
  /** Scoring is effectively running on deterministic mock vectors, so semantic
   *  similarity is meaningless and the detector cannot legitimately flag. True
   *  whenever mode is "mock", no provider is configured, or every provider fails. */
  usingMock: boolean;
}

/** Report whether semantic scoring is backed by a real embedding provider or has
 *  silently fallen back to mock vectors — surfaced in the UI so "0 flagged" is
 *  read as a real result, not a dead detector. */
export async function embeddingHealth(): Promise<EmbeddingHealth> {
  const m = mode();
  const provs = providers();

  if (m === "mock" || provs.length === 0) {
    return { mode: m, providersConfigured: provs.length, live: false, usingMock: true };
  }

  let live = false;
  try {
    const [vector] = await callOpenAIEmbeddings(provs[0], [EMBED_PREFIX.query + "ping"]);
    live = vector.length === EMBEDDING_DIM;
  } catch {
    live = false;
  }
  // auto: a dead provider falls back to mock vectors. live: a dead provider makes
  // ingest throw — either way, real semantic scoring is not happening.
  return { mode: m, providersConfigured: provs.length, live, usingMock: !live };
}

async function embedViaProvider(
  provider: Provider,
  texts: string[],
  kind: EmbedKind,
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE).map((t) => EMBED_PREFIX[kind] + t);
    out.push(...(await callOpenAIEmbeddings(provider, chunk)));
  }
  return out;
}

async function callOpenAIEmbeddings(provider: Provider, inputs: string[]): Promise<number[][]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(provider.url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}),
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
    });
    if (!res.ok) throw new EmbeddingUnavailableError(`embeddings HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
    const rows = Array.isArray(json.data) ? json.data : [];
    return rows.map((row) => validateDim(row?.embedding));
  } finally {
    clearTimeout(timer);
  }
}

function validateDim(embedding: unknown): number[] {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    const got = Array.isArray(embedding) ? `${embedding.length}` : typeof embedding;
    throw new EmbeddingDimError(`expected ${EMBEDDING_DIM}-dim vector, got ${got}`);
  }
  return embedding as number[];
}

// --- deterministic mock vector (FNV-1a seed -> mulberry32 PRNG -> L2 normalize) ---

function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockVector(text: string): number[] {
  const rnd = mulberry32(hashSeed(text));
  const v = new Array<number>(EMBEDDING_DIM);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    const x = rnd() * 2 - 1;
    v[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBEDDING_DIM; i++) v[i] /= norm;
  return v;
}
