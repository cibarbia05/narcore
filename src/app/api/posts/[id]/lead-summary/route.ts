// GET /api/posts/:id/lead-summary — deterministic LE/T&S report from the stored
// RiskBreakdown, enriched with the matched corpus entry's drug label.
import { buildLeadSummary } from "@/lib/lead-summary";
import { errorResponse, getCorpusEntryDrug, getPost, jsonError } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const post = await getPost(id);
    if (!post) return jsonError("not_found", "post not found", 404);

    const leadSummary = buildLeadSummary(post);
    leadSummary.matchedKnownTermDrug = await getCorpusEntryDrug(post.risk.matchedTermId);
    return Response.json({ leadSummary });
  } catch (err) {
    return errorResponse(err);
  }
}
