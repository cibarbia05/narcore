// B2 — browser-identity persistence + drift detection.
//
// `pnpm ig:login` records the fingerprint each context was logged in under
// (identity:context:{id}). At run time we compare it to the current env-derived
// identity: a mismatch means the persisted login and the automated runs would look
// like DIFFERENT browsers to Instagram — the #1 cause of mid-demo checkpoints. The
// war room surfaces this as an "identity match" badge so it's caught before the demo.
import { sessionIdentity } from "./browserbase";
import { connectRedis } from "./redis";
import type { ContextIdentityStatus, IdentityMatch, SessionIdentity } from "./types";

const key = (contextId: string) => `identity:context:${contextId}`;

/** Record the identity a context was (re-)logged-in under. Best-effort. */
export async function persistContextIdentity(
  contextId: string,
  identity: SessionIdentity = sessionIdentity(),
): Promise<void> {
  const client = await connectRedis();
  await client.set(key(contextId), JSON.stringify(identity));
}

export async function getContextIdentity(contextId: string): Promise<SessionIdentity | null> {
  const client = await connectRedis();
  const raw = await client.get(key(contextId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionIdentity;
  } catch {
    return null;
  }
}

/** Field names that differ between two identities ([] = identical). */
export function diffIdentity(a: SessionIdentity, b: SessionIdentity): string[] {
  const diffs: string[] = [];
  if (a.os !== b.os) diffs.push("os");
  if (a.verified !== b.verified) diffs.push("verified");
  if (a.advancedStealth !== b.advancedStealth) diffs.push("advancedStealth");
  if (a.proxyCountry !== b.proxyCountry) diffs.push("proxyCountry");
  if (a.region !== b.region) diffs.push("region");
  if (a.viewport.width !== b.viewport.width || a.viewport.height !== b.viewport.height) {
    diffs.push("viewport");
  }
  return diffs;
}

function maskId(id: string): string {
  return id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** Compare every configured login context's recorded identity to the current env. */
export async function describeContexts(contextIds: string[]): Promise<ContextIdentityStatus[]> {
  const current = sessionIdentity();
  return Promise.all(
    contextIds.map(async (id) => {
      const persisted = await getContextIdentity(id);
      let match: IdentityMatch = "unknown";
      let diffs: string[] = [];
      if (persisted) {
        diffs = diffIdentity(current, persisted);
        match = diffs.length === 0 ? "ok" : "mismatch";
      }
      return { id: maskId(id), persisted, match, diffs };
    }),
  );
}
