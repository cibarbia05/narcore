// GET /api/operations/:id — current operation + transcript, polled by the view.
import { getOperation } from "@/lib/agents/operation-store";
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
    const operation = await getOperation(id);
    if (!operation) return apiError("not_found", "operation not found", 404);
    return Response.json({ operation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to read operation";
    console.error("[api/operations/:id] error:", err);
    return apiError("dependency_unavailable", message, 503);
  }
}
