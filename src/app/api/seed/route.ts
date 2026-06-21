// POST /api/seed — load/refresh the seed corpus (idempotent upsert).
// Mirrors scripts/seed.ts; both call seedCorpus().
import { errorResponse, seedCorpus } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    return Response.json(await seedCorpus());
  } catch (err) {
    return errorResponse(err);
  }
}
