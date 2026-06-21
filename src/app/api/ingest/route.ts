// POST /api/ingest — the scraper submits a scraped post.
// Validate -> dedup by sha1(post_link) -> embed(caption,"query") -> corpus KNN ->
// computeRisk -> store -> 201. Idempotent: a known post returns 200 deduped.
import { postIdFromLink } from "@/lib/ids";
import {
  errorResponse,
  getPost,
  inferPlatformFromLink,
  jsonError,
  savePost,
  scorePost,
} from "@/lib/repo";
import { PLATFORMS, type IngestResponse, type Platform, type Post } from "@/lib/types";
import { scrapedPostSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const required = process.env.INGEST_API_KEY;
    if (required && req.headers.get("authorization") !== `Bearer ${required}`) {
      return jsonError("unauthorized", "invalid or missing api key", 401);
    }

    const json = await req.json().catch(() => null);
    const parsed = scrapedPostSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError("validation_error", "invalid scraped post", 400, parsed.error.issues);
    }
    const body = parsed.data;
    const id = postIdFromLink(body.post_link);

    const existing = await getPost(id);
    if (existing) {
      const dup: IngestResponse = { post: existing, deduped: true };
      return Response.json(dup, { status: 200 });
    }

    const platform = isPlatform(body.platform)
      ? body.platform
      : inferPlatformFromLink(body.post_link);

    const { risk, queryVec } = await scorePost(body.post_caption);
    const now = new Date().toISOString();
    const post: Post = {
      id,
      agentId: body.agent_id,
      postLink: body.post_link,
      username: body.post_username,
      caption: body.post_caption,
      platform,
      postDate: body.post_date,
      ingestedAt: now,
      scoredAt: risk.scoredAt,
      risk,
      riskScore: risk.score,
      flagged: risk.flagged,
      approvalStatus: "pending",
      approvedAt: null,
      corpusEntryId: null,
    };
    await savePost(post, queryVec);

    const res: IngestResponse = { post, deduped: false };
    return Response.json(res, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function isPlatform(p: string | undefined): p is Platform {
  return p !== undefined && (PLATFORMS as readonly string[]).includes(p);
}
