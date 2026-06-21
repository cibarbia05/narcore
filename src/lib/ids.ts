// Small pure id/slug helpers (Node runtime). Kept out of types.ts so that file
// stays import-free.
import { createHash } from "node:crypto";

/** Deterministic, dedup-friendly post id derived from the canonical post link. */
export function postIdFromLink(postLink: string): string {
  return createHash("sha1").update(postLink).digest("hex");
}

/** Stable slug for deterministic corpus seed keys (`corpus:seed:{slug}`). */
export function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return s || "term";
}
