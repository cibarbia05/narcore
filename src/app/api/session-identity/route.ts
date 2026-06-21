// GET /api/session-identity — the browser fingerprint sessions are created with
// (B2), plus a per-context check that the persisted login identity still matches
// the current env. Powers the war-room "identity match" badge.
import { sessionIdentity } from "@/lib/browserbase";
import { errorResponse } from "@/lib/repo";
import { describeContexts } from "@/lib/session-identity";
import type { SessionIdentityResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contextIds(): string[] {
  return (process.env.BROWSERBASE_CONTEXT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function GET() {
  try {
    const current = sessionIdentity();
    const contexts = await describeContexts(contextIds());
    return Response.json({ current, contexts } satisfies SessionIdentityResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
