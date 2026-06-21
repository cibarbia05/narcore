// POST /api/agents/run/:id/stop — abort every agent in the run and release its
// Browserbase sessions.
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
    const { stopRun } = await import("@/lib/agents/orchestrator");
    await stopRun(id);
    return Response.json({ stopped: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to stop run";
    console.error("[api/agents/run/:id/stop] error:", err);
    return apiError("run_stop_failed", message, 502);
  }
}
