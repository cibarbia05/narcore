// GET /api/field-intel — the live "operative → detector" learning ticker (R1).
// Returns the most recent field-intel events (newest first) from the
// stream:field-intel Redis Stream.
import { getFieldIntelEvents } from "@/lib/field-intel";
import { errorResponse } from "@/lib/repo";
import type { FieldIntelResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const events = await getFieldIntelEvents(20);
    return Response.json({ events } satisfies FieldIntelResponse);
  } catch (err) {
    return errorResponse(err);
  }
}
