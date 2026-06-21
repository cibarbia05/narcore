// POST /api/operations  { postId, targetHandle? }
//   Launches ONE undercover operative against a flagged lead. Returns immediately
//   with the operation's live-view URL so the view can render the iframe before the
//   negotiation progresses. Progress is polled from GET /api/operations/[id].
//
// GET /api/operations
//   Returns the operative target allowlist + whether it's enforced, so the
//   dashboard can disable "Engage" for non-allowlisted handles. The server still
//   enforces the allowlist on POST (defense in depth).
//
// Browserbase SDK + Stagehand are heavy Node-only libs; the orchestrator is
// dynamically imported so the route bundle stays light.
import { startOperationSchema } from "@/lib/validation";
import { allowlist, allowlistEnforced } from "@/lib/operative-allowlist";
import type { ApiError, OperativeConfigResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(code: string, message: string, status: number, details?: unknown) {
  const body: ApiError = {
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return Response.json(body, { status });
}

export async function GET() {
  const body: OperativeConfigResponse = {
    allowlist: allowlist(),
    enforced: allowlistEnforced(),
  };
  return Response.json(body);
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = startOperationSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return apiError("validation_error", "Invalid request body", 400, parsed.error.issues);
  }

  try {
    const { startOperation } = await import("@/lib/agents/operation-orchestrator");
    const result = await startOperation(parsed.data);
    return Response.json(result);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message : "failed to start operation";
    console.error("[api/operations] error:", err);
    if (code === "allowlist_denied") return apiError("allowlist_denied", message, 403);
    if (/not found/i.test(message)) return apiError("not_found", message, 404);
    // Missing keys / contexts are configuration problems (400); anything else is an
    // upstream Browserbase/Anthropic failure (502).
    const config = /CONTEXT_IDS|API_KEY|PROJECT_ID|not set/i.test(message);
    return config
      ? apiError("configuration_error", message, 400)
      : apiError("operation_start_failed", message, 502);
  }
}
