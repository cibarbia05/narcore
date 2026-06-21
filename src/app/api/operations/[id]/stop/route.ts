// POST /api/operations/:id/stop — abort the operative and release its session.
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { stopOperation } = await import("@/lib/agents/operation-orchestrator");
    await stopOperation(id);
    return Response.json({ stopped: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to stop operation";
    console.error("[api/operations/:id/stop] error:", err);
    return apiError("operation_stop_failed", message, 502);
  }
}
