// GET /api/posts/:id — HGETALL post:{id} -> Post, 404 if missing.
import { errorResponse, getPost, jsonError } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const post = await getPost(id);
    if (!post) return jsonError("not_found", "post not found", 404);
    return Response.json({ post });
  } catch (err) {
    return errorResponse(err);
  }
}
