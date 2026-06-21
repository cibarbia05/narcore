// POST /api/agents/run  { agentCount?, tags?: string[] }
// Launches a run of N parallel Instagram agents. Returns immediately with the
// agents' live-view URLs so the UI can render the video grid before any agent
// finishes. Progress is then polled from GET /api/agents/run/[id].
//
// Browserbase SDK + Stagehand are heavy Node-only libs kept external
// (next.config.ts) and the orchestrator is dynamically imported so the bundle
// stays light.
import { startRunSchema } from "@/lib/validation";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(code: string, message: string, status: number, details?: unknown) {
  const body: ApiError = {
    error: { code, message, ...(details !== undefined ? { details } : {}) },
  };
  return Response.json(body, { status });
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => ({}));
  const parsed = startRunSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return apiError("validation_error", "Invalid request body", 400, parsed.error.issues);
  }

  try {
    const { startRun } = await import("@/lib/agents/orchestrator");
    const result = await startRun(parsed.data);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to start run";
    console.error("[api/agents/run] error:", err);
    // Missing contexts / missing keys are configuration problems (400); anything
    // else is an upstream Browserbase failure (502).
    const config = /CONTEXT_IDS|API_KEY|PROJECT_ID|not set/i.test(message);
    return config
      ? apiError("configuration_error", message, 400)
      : apiError("run_start_failed", message, 502);
  }
}
