// GET /api/semantic-drift/neighbors?id=<postId>
// Real cosine-KNN corpus neighbors for one post + its persisted risk breakdown — the
// explainable edges behind a score. The query vector stays on the server; only matched
// corpus ids and cosine scores leave it.
import { errorResponse, jsonError, postNeighbors } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return jsonError("bad_request", "missing post id", 400);
    const result = await postNeighbors(id);
    if (!result) return jsonError("not_found", "post not found", 404);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
