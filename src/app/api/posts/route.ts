// GET /api/posts — paginated, sorted, filtered feed for the dashboard (idx:posts).
// Filters: status, flagged, platform, q, minScore, maxScore; sort/order; limit<=200, offset.
import { errorResponse, listPosts, type PostFilters } from "@/lib/repo";
import {
  APPROVAL_STATUSES,
  PLATFORMS,
  type ApprovalStatus,
  type Platform,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORT_FIELDS = ["riskScore", "postDateTs", "ingestedAtTs"] as const;
type SortField = (typeof SORT_FIELDS)[number];

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;

    const filters: PostFilters = {
      status: oneOf(params.get("status"), APPROVAL_STATUSES) as ApprovalStatus | undefined,
      platform: oneOf(params.get("platform"), PLATFORMS) as Platform | undefined,
      flagged: boolOrUndefined(params.get("flagged")),
      q: params.get("q") ?? undefined,
      minScore: floatOrUndefined(params.get("minScore")),
      maxScore: floatOrUndefined(params.get("maxScore")),
      sort: (oneOf(params.get("sort"), SORT_FIELDS) as SortField | undefined) ?? "riskScore",
      order: params.get("order")?.toLowerCase() === "asc" ? "ASC" : "DESC",
      limit: clampInt(params.get("limit"), 50, 1, 200),
      offset: clampInt(params.get("offset"), 0, 0, 100_000),
    };

    return Response.json(await listPosts(filters));
  } catch (err) {
    return errorResponse(err);
  }
}

function oneOf(raw: string | null, allowed: readonly string[]): string | undefined {
  return raw !== null && allowed.includes(raw) ? raw : undefined;
}

function boolOrUndefined(raw: string | null): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

function floatOrUndefined(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? fallback : Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
