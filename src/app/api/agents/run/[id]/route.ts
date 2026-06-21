// GET /api/agents/run/:id — current run + per-agent status, polled by the UI.
import { getRun } from "@/lib/agents/run-store";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const run = await getRun(id);
    if (!run) return apiError("not_found", "run not found", 404);
    return Response.json({ run });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read run";
    console.error("[api/agents/run/:id] error:", err);
    return apiError("dependency_unavailable", message, 503);
  }
}
