// POST /api/scrape  { live?: boolean }
// WT-D owns this route. live === true → Browserbase/Stagehand scrape of the
// synthetic /feed; otherwise the offline fixture. Both extract → normalize →
// POST /api/ingest and return { ingested: number }.
//
// Stagehand is a heavy Node-only lib kept out of the bundle via
// serverExternalPackages (next.config.ts) and dynamically imported so the
// fixture path never loads a browser.
import { scrapeSchema } from "@/lib/validation";
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
  const parsed = scrapeSchema.safeParse(json ?? {});
  if (!parsed.success) {
    return apiError("validation_error", "Invalid request body", 400, parsed.error.issues);
  }

  const live = parsed.data.live === true;

  try {
    const ingested = live
      ? await (await import("../../../../scraper/scrape")).scrapeFeed()
      : await (await import("../../../../scraper/fixture")).runFixture();
    return Response.json({ ingested });
  } catch (err) {
    const message = err instanceof Error ? err.message : "scrape failed";
    console.error("[api/scrape] error:", err);
    // Ingest target unreachable → dependency issue (503); otherwise the
    // browser/extraction step failed (502).
    const unreachable = /ECONNREFUSED|fetch failed|ENOTFOUND|ingest/i.test(message);
    return unreachable
      ? apiError("dependency_unavailable", message, 503)
      : apiError("scrape_failed", message, 502);
  }
}
