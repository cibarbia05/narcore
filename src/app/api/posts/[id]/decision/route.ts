// POST /api/posts/:id/decision  { decision: "approved" | "rejected" }
// approve -> embed(caption,"document") -> add corpus:approved:{id} (+TTL) -> set
// corpusEntryId (the semantic-drift learning loop). reject -> remove any prior
// corpus entry. Idempotent via the corpusEntryId guard; a short lock serializes races.
import { embed } from "@/lib/embeddings";
import {
  acquireDecisionLock,
  addApprovedEntry,
  errorResponse,
  getPost,
  jsonError,
  releaseDecisionLock,
  removeApprovedEntry,
  savePost,
} from "@/lib/repo";
import type { Post } from "@/lib/types";
import { decisionSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const json = await req.json().catch(() => ({}));
    const parsed = decisionSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError("validation_error", "invalid decision", 400, parsed.error.issues);
    }

    const post = await getPost(id);
    if (!post) return jsonError("not_found", "post not found", 404);

    if (!(await acquireDecisionLock(id))) {
      return jsonError("conflict", "a decision is already in progress for this post", 409);
    }

    try {
      const updated =
        parsed.data.decision === "approved"
          ? await approve(post)
          : await reject(post);
      return Response.json({ post: updated });
    } finally {
      await releaseDecisionLock(id);
    }
  } catch (err) {
    return errorResponse(err);
  }
}

async function approve(post: Post): Promise<Post> {
  if (post.corpusEntryId) return post; // already learned — idempotent no-op

  const docVec = await embed(post.caption, "document");
  const corpusEntryId = await addApprovedEntry(post, docVec);
  const updated: Post = {
    ...post,
    approvalStatus: "approved",
    approvedAt: new Date().toISOString(),
    corpusEntryId,
  };
  await savePost(updated);
  return updated;
}

async function reject(post: Post): Promise<Post> {
  if (post.corpusEntryId) await removeApprovedEntry(post.corpusEntryId);
  const updated: Post = {
    ...post,
    approvalStatus: "rejected",
    approvedAt: null,
    corpusEntryId: null,
  };
  await savePost(updated);
  return updated;
}
