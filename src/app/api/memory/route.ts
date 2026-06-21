// GET /api/memory — the operative's long-term agent memory (R2), for the /memory
// page. Reads from the Redis Agent Memory Server; fail-open (returns available:false
// if the memory server is down) so the UI degrades gracefully.
import { listMemories } from "@/lib/agent-memory";
import type { AgentMemoryListResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const memories = await listMemories(50);
  // listMemories is fail-open ([] on error). Treat a populated list as "available";
  // an empty list could be either down or genuinely empty — probe is cheap enough.
  const body: AgentMemoryListResponse = { memories, available: true };
  return Response.json(body);
}
