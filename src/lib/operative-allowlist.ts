// Operative target allowlist — the non-bypassable guardrail for an undercover
// contact tool.
//
// The operative may ONLY ever DM accounts WE control (the demo-adversary accounts
// we created for the demonstration). This is enforced server-side at operation
// start (`startOperation`) AND mirrored in the UI (the "Engage" action is disabled
// for any post whose handle isn't allowlisted). Enforcement is ON by default; the
// only way to disable it is an explicit `OPERATIVE_ALLOWLIST_ENFORCED=false`, which
// callers log loudly. No real third party is ever messaged.
//
// `normalizeHandle` is a pure function safe to import into client components; the
// env-reading helpers are only ever called on the server.

/** Normalize an Instagram handle for comparison: drop a leading '@', lowercase,
 *  and trim surrounding whitespace. */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").toLowerCase();
}

/** Whether the allowlist is enforced. Default ON — only an explicit
 *  `OPERATIVE_ALLOWLIST_ENFORCED=false` turns it off. */
export function allowlistEnforced(): boolean {
  return process.env.OPERATIVE_ALLOWLIST_ENFORCED !== "false";
}

/** The set of demo-adversary handles the operative is allowed to contact, parsed
 *  from `OPERATIVE_TARGET_ALLOWLIST` (comma-separated). */
export function allowlist(): string[] {
  return (process.env.OPERATIVE_TARGET_ALLOWLIST ?? "")
    .split(",")
    .map(normalizeHandle)
    .filter(Boolean);
}

/** Is `handle` an allowed target? When enforcement is off everything is allowed
 *  (the caller logs that loudly). When on, the handle must be on the allowlist. */
export function isTargetAllowed(handle: string): boolean {
  if (!allowlistEnforced()) return true;
  const target = normalizeHandle(handle);
  if (!target) return false;
  return allowlist().includes(target);
}
