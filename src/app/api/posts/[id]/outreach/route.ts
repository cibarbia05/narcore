// POST /api/posts/:id/outreach  { channel?: "email" | "platform_report" }
// Lead summary + an LLM-drafted (simulated) outreach message. dispatched=false.
import { buildLeadSummary } from "@/lib/lead-summary";
import { draftOutreach } from "@/lib/outreach";
import { errorResponse, getCorpusEntryDrug, getPost, jsonError } from "@/lib/repo";
import { outreachSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const json = await req.json().catch(() => ({}));
    const parsed = outreachSchema.safeParse(json);
    if (!parsed.success) {
      return jsonError("validation_error", "invalid outreach request", 400, parsed.error.issues);
    }
    const channel = parsed.data.channel ?? "platform_report";

    const post = await getPost(id);
    if (!post) return jsonError("not_found", "post not found", 404);

    const leadSummary = buildLeadSummary(post);
    leadSummary.matchedKnownTermDrug = await getCorpusEntryDrug(post.risk.matchedTermId);
    const draft = await draftOutreach(leadSummary, channel);

    return Response.json({ leadSummary, draft, dispatched: false });
  } catch (err) {
    return errorResponse(err);
  }
}
