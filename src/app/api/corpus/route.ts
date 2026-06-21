// GET /api/corpus — suspicious-vector corpus stats (drives the UI "learned" counter).
import { corpusStats, errorResponse } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await corpusStats());
  } catch (err) {
    return errorResponse(err);
  }
}
