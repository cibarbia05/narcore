// POST /api/rescore  { scope?: "pending" | "all"; ids?: string[] }
// Re-runs KNN + scoring against the current (grown) corpus — the demo lever for the
// semantic-drift learning loop. Re-embeds each caption (deterministic), so a post
// that paraphrases a newly-approved term now scores higher. Bounded -> synchronous.
import {
  errorResponse,
  getPost,
  jsonError,
  listPosts,
  savePost,
  scorePost,
} from "@/lib/repo";
import type { Post } from "@/lib/types";
import { rescoreSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESCORE_MAX = 1000;

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const parsed = rescoreSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError("validation_error", "invalid rescore request", 400, parsed.error.issues);
    }

    const targets = await selectPosts(parsed.data.ids, parsed.data.scope);

    let rescored = 0;
    for (const post of targets) {
      const { risk, queryVec } = await scorePost(post.caption);
      const updated: Post = {
        ...post,
        risk,
        riskScore: risk.score,
        flagged: risk.flagged,
        scoredAt: risk.scoredAt,
      };
      await savePost(updated, queryVec);
      rescored++;
    }

    return Response.json({ rescored });
  } catch (err) {
    return errorResponse(err);
  }
}

async function selectPosts(
  ids: string[] | undefined,
  scope: "pending" | "all" | undefined,
): Promise<Post[]> {
  if (ids && ids.length > 0) {
    const found = await Promise.all(ids.map((id) => getPost(id)));
    return found.filter((p): p is Post => p !== null);
  }
  const page = await listPosts({
    status: scope === "all" ? undefined : "pending",
    limit: RESCORE_MAX,
  });
  return page.items;
}
