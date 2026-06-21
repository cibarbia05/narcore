// GET /api/semantic-drift — bounded Redis vector snapshot projected to 2D.
// Raw FLOAT32 vectors never leave the server.
import { errorResponse, semanticDriftSnapshot } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await semanticDriftSnapshot());
  } catch (err) {
    return errorResponse(err);
  }
}
