// Redis client singleton + index definitions (node-redis v6 / Redis Stack).
//
// WT-B builds repository helpers (post/corpus CRUD, KNN, TTL refresh) on top of
// these seams. The client is cached on globalThis so Next dev HMR doesn't open a
// new connection on every reload.
import {
  createClient,
  SCHEMA_FIELD_TYPE,
  SCHEMA_VECTOR_FIELD_ALGORITHM,
  type RediSearchSchema,
} from "redis";
import { EMBEDDING_DIM } from "./model";

export const CORPUS_INDEX = "idx:corpus";
export const POSTS_INDEX = "idx:posts";

export const POST_PREFIX = "post:";
export const CORPUS_PREFIX = "corpus:";
export const CORPUS_SEED_PREFIX = "corpus:seed:";
export const CORPUS_APPROVED_PREFIX = "corpus:approved:";

/** Sliding-window TTL for learned `corpus:approved:*` vectors (SPEC §3.4 / §5.3).
 *  Seeds never expire; approved entries are refreshed on each KNN match and
 *  auto-evicted by Redis after this many days without a match — no cron. */
export const CORPUS_TTL_DAYS = clampPositiveInt(process.env.CORPUS_TTL_DAYS, 14);
export const CORPUS_TTL_SECONDS = CORPUS_TTL_DAYS * 86_400;

function clampPositiveInt(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Encode a float vector as the little-endian FLOAT32 buffer node-redis expects. */
export function float32ToBuffer(vec: number[] | Float32Array): Buffer {
  const f32 = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function createNarcoreClient() {
  const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
  client.on("error", (err) => console.error("[redis] client error:", err));
  return client;
}

// Infer the exact client type from the factory to avoid node-redis generic-default
// friction (the broad RedisClientType<...> default isn't assignable to the inferred one).
export type NarcoreRedisClient = ReturnType<typeof createNarcoreClient>;

const globalForRedis = globalThis as unknown as { __narcoreRedis?: NarcoreRedisClient };

export function getRedis(): NarcoreRedisClient {
  const client = globalForRedis.__narcoreRedis ?? createNarcoreClient();
  globalForRedis.__narcoreRedis = client;
  return client;
}

/** Lazily connect (idempotent) and return the shared client. */
export async function connectRedis(): Promise<NarcoreRedisClient> {
  const client = getRedis();
  if (!client.isOpen) await client.connect();
  return client;
}

// --- index schemas (FLAT + COSINE + FLOAT32 + 768-dim; corpus is small -> exact NN) ---

const corpusSchema: RediSearchSchema = {
  source: { type: SCHEMA_FIELD_TYPE.TAG },
  category: { type: SCHEMA_FIELD_TYPE.TAG },
  text: { type: SCHEMA_FIELD_TYPE.TEXT, NOSTEM: true },
  vector: {
    type: SCHEMA_FIELD_TYPE.VECTOR,
    ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.FLAT,
    TYPE: "FLOAT32",
    DIM: EMBEDDING_DIM,
    DISTANCE_METRIC: "COSINE",
  },
};

const postsSchema: RediSearchSchema = {
  riskScore: { type: SCHEMA_FIELD_TYPE.NUMERIC, SORTABLE: true },
  postDateTs: { type: SCHEMA_FIELD_TYPE.NUMERIC, SORTABLE: true },
  ingestedAtTs: { type: SCHEMA_FIELD_TYPE.NUMERIC, SORTABLE: true },
  flagged: { type: SCHEMA_FIELD_TYPE.TAG },
  approvalStatus: { type: SCHEMA_FIELD_TYPE.TAG },
  platform: { type: SCHEMA_FIELD_TYPE.TAG },
  username: { type: SCHEMA_FIELD_TYPE.TEXT, NOSTEM: true },
  caption: { type: SCHEMA_FIELD_TYPE.TEXT },
};

interface IndexOptions {
  ON: "HASH" | "JSON";
  PREFIX: string;
}

/** Create both indexes if missing. Idempotent — safe to call on every request. */
export async function ensureIndexes(): Promise<void> {
  const client = await connectRedis();
  await createIndexIfMissing(client, CORPUS_INDEX, corpusSchema, {
    ON: "HASH",
    PREFIX: CORPUS_PREFIX,
  });
  await createIndexIfMissing(client, POSTS_INDEX, postsSchema, {
    ON: "HASH",
    PREFIX: POST_PREFIX,
  });
}

async function createIndexIfMissing(
  client: NarcoreRedisClient,
  index: string,
  schema: RediSearchSchema,
  options: IndexOptions,
): Promise<void> {
  try {
    await client.ft.create(index, schema, options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/index already exists/i.test(message)) throw err;
  }
}
