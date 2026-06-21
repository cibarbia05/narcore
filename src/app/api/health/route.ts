// GET /api/health — real Redis PING + embedding ping + corpus/post counts.
// Each probe is isolated so the endpoint never throws; 200 when healthy else 503.
import { embeddingHealth, pingEmbeddings } from "@/lib/embeddings";
import { MODEL_VERSION } from "@/lib/model";
import { corpusStats, postCount, pingRedis } from "@/lib/repo";
import type { HealthResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const redis = await safe(pingRedis, false);
  const embeddings = await safe(pingEmbeddings, false);
  const embHealth = await safe(embeddingHealth, {
    mode: "auto" as const,
    providersConfigured: 0,
    live: false,
    usingMock: true,
  });
  const corpusSize = redis ? await safe(async () => (await corpusStats()).size, 0) : 0;
  const postTotal = redis ? await safe(postCount, 0) : 0;

  const ok = redis && embeddings;
  const body: HealthResponse = {
    ok,
    redis,
    embeddings,
    embeddingMode: embHealth.mode,
    embeddingLive: embHealth.live,
    corpusSize,
    postCount: postTotal,
    modelVersion: MODEL_VERSION,
  };
  return Response.json(body, { status: ok ? 200 : 503 });
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
