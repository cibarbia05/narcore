// Thin, typed wrapper around the Browserbase REST SDK (@browserbasehq/sdk).
//
// Why a wrapper: the parallel-agent orchestrator and the one-time `ig:login`
// script must create sessions with EXACTLY the same identity (proxy country,
// region, viewport, captcha solving) so Instagram sees a consistent fingerprint
// across the login and the later automated runs — the single biggest lever for
// avoiding login checkpoints. Centralizing that config here keeps the two call
// sites honest.
//
// API verified against @browserbasehq/sdk@2.14.x (context7 /browserbase/sdk-node):
//   new Browserbase({ apiKey })
//   bb.sessions.create({ projectId, proxies, region, keepAlive, timeout, browserSettings })
//   bb.sessions.debug(id) -> { debuggerFullscreenUrl, ... }
//   bb.sessions.update(id, { projectId, status: "REQUEST_RELEASE" })  // terminate
//   bb.contexts.create({ projectId }) -> { id }
import Browserbase from "@browserbasehq/sdk";

import type { SessionIdentity } from "./types";

// Browserbase's session regions (a closed union in the SDK).
type BbRegion = "us-east-1" | "us-west-2" | "eu-central-1" | "ap-southeast-1";

// Pinned desktop OS (SDK union). Consistent OS across login + every run is the main
// lever against IG checkpoints — but ONLY if the persisted login context was created
// with the SAME os, so pinning is OPT-IN (see browserOs()).
type BbOs = "windows" | "mac" | "linux" | "mobile" | "tablet";
const BB_OS_VALUES: readonly BbOs[] = ["windows", "mac", "linux", "mobile", "tablet"];
const BB_REGIONS: readonly BbRegion[] = ["us-east-1", "us-west-2", "eu-central-1", "ap-southeast-1"];
// Must match the region Stagehand's hosted API serves, otherwise attaching to a
// pre-created session 400s ("Session is in region X but this API instance serves
// Y"). Stagehand defaults to us-west-2 — keep the session there too. If you set
// IG_REGION, point Stagehand at the matching endpoint as well.
const DEFAULT_REGION: BbRegion = "us-west-2";
const DEFAULT_PROXY_COUNTRY = "US";
// Desktop viewport — Instagram's web feed renders captions inline at this size.
const VIEWPORT = { width: 1280, height: 800 } as const;
// Session ceiling (seconds, 60–21600). A hard backstop so a leaked session can
// never bill or hold a concurrency slot forever during a demo. Scraper agents are
// short-lived (default 600s); the operative negotiates over minutes and passes a
// larger value via `createIgSession(ctx, { timeoutSeconds })`.
const SESSION_TIMEOUT_SECONDS = 600;
const SESSION_TIMEOUT_MIN = 60;
const SESSION_TIMEOUT_MAX = 21_600;

function region(): BbRegion {
  const raw = process.env.IG_REGION;
  return raw && (BB_REGIONS as readonly string[]).includes(raw) ? (raw as BbRegion) : DEFAULT_REGION;
}

function proxyCountry(): string {
  return process.env.IG_PROXY_COUNTRY ?? DEFAULT_PROXY_COUNTRY;
}

/** Raw parsed BB_BROWSER_OS (no plan guard). OPT-IN: unset => let Browserbase pick. */
function browserOs(): BbOs | undefined {
  const raw = (process.env.BB_BROWSER_OS ?? "").toLowerCase();
  return (BB_OS_VALUES as readonly string[]).includes(raw) ? (raw as BbOs) : undefined;
}

/** The OS we can ACTUALLY send. Verified-by-experiment (browserbase 400): non-Linux
 *  OS requires `verified:true`, which itself requires a Browserbase Enterprise plan
 *  ("By default, we only support Linux"). So a non-linux pin without BB_VERIFIED is a
 *  demo-killing footgun — we drop it (and warn) so session creation still succeeds.
 *  To genuinely pin mac/windows: set BB_VERIFIED=true on an Enterprise project AND
 *  re-run `pnpm ig:login` so login + runs share the OS. */
function resolvedOs(): BbOs | undefined {
  const os = browserOs();
  if (!os) return undefined;
  if (os !== "linux" && !verifiedEnabled()) {
    console.warn(
      `[browserbase] BB_BROWSER_OS=${os} needs BB_VERIFIED=true (Browserbase Enterprise); ignoring it and using the default OS to avoid a 400.`,
    );
    return undefined;
  }
  return os;
}

/** Verified Browsers (Browserbase Enterprise plan). Off unless BB_VERIFIED=true — a
 *  non-Enterprise project rejects `verified:true` at session create. */
function verifiedEnabled(): boolean {
  return (process.env.BB_VERIFIED ?? "").toLowerCase() === "true";
}

/** Advanced anti-bot stealth (paid feature). Off unless BB_ADVANCED_STEALTH=true. */
function advancedStealthEnabled(): boolean {
  return (process.env.BB_ADVANCED_STEALTH ?? "").toLowerCase() === "true";
}

/** The resolved, env-derived browser identity. Both `pnpm ig:login` and every
 *  automated run create sessions through createIgSession, so they share this
 *  identity by construction — surfaced in the UI as an "identity match" check. */
export function sessionIdentity(): SessionIdentity {
  return {
    os: resolvedOs() ?? null,
    verified: verifiedEnabled(),
    advancedStealth: advancedStealthEnabled(),
    viewport: { ...VIEWPORT },
    proxyCountry: proxyCountry(),
    region: region(),
  };
}

export function browserbaseProjectId(): string {
  const id = process.env.BROWSERBASE_PROJECT_ID;
  if (!id) throw new Error("BROWSERBASE_PROJECT_ID is not set");
  return id;
}

// Cache the client on globalThis so Next dev HMR doesn't construct a new one per
// reload (mirrors the redis client pattern in src/lib/redis.ts).
const globalForBb = globalThis as unknown as { __narcoreBb?: Browserbase };

export function getBrowserbase(): Browserbase {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) throw new Error("BROWSERBASE_API_KEY is not set");
  const bb = globalForBb.__narcoreBb ?? new Browserbase({ apiKey });
  globalForBb.__narcoreBb = bb;
  return bb;
}

/** Create a residential-proxied session bound to a persisted login context.
 *  `persist:false` (the default) keeps the pristine logged-in context unchanged
 *  during automated runs; the `ig:login` script passes `persist:true` so the
 *  hand-typed login is saved. Returns the new session id. */
export async function createIgSession(
  contextId: string,
  opts: { persist?: boolean; timeoutSeconds?: number } = {},
): Promise<string> {
  const bb = getBrowserbase();
  const timeout =
    opts.timeoutSeconds === undefined
      ? SESSION_TIMEOUT_SECONDS
      : Math.min(SESSION_TIMEOUT_MAX, Math.max(SESSION_TIMEOUT_MIN, Math.trunc(opts.timeoutSeconds)));
  const os = resolvedOs();
  const verified = verifiedEnabled();
  const advancedStealth = advancedStealthEnabled();
  const session = await bb.sessions.create({
    projectId: browserbaseProjectId(),
    region: region(),
    // keepAlive so the session survives the gap between create-time (when we
    // fetch the live-view URL for the UI) and Stagehand attaching to it. We
    // explicitly release it in endSession().
    keepAlive: true,
    timeout,
    proxies: [
      {
        type: "browserbase",
        geolocation: { country: proxyCountry() },
      },
    ],
    browserSettings: {
      context: { id: contextId, persist: opts.persist ?? false },
      solveCaptchas: true,
      blockAds: true,
      viewport: { ...VIEWPORT },
      // Identity pinning (opt-in) for a consistent fingerprint across login + runs.
      ...(os ? { os } : {}),
      ...(verified ? { verified: true } : {}),
      ...(advancedStealth ? { advancedStealth: true } : {}),
    },
  });
  console.log(
    `[browserbase] session ${session.id} identity ${JSON.stringify(sessionIdentity())}`,
  );
  return session.id;
}

/** The read-only, embeddable live-view URL for a session (CDP stream). */
export async function getLiveViewUrl(sessionId: string): Promise<string> {
  const bb = getBrowserbase();
  const links = await bb.sessions.debug(sessionId);
  return links.debuggerFullscreenUrl;
}

/** Terminate a keepAlive session. Best-effort — never throws (cleanup paths must
 *  not mask the original error). */
export async function endSession(sessionId: string): Promise<void> {
  try {
    const bb = getBrowserbase();
    await bb.sessions.update(sessionId, {
      projectId: browserbaseProjectId(),
      status: "REQUEST_RELEASE",
    });
  } catch (err) {
    console.warn(`[browserbase] failed to release session ${sessionId}:`, err);
  }
}

/** Create a fresh persistent Context (one per burner account). Used by ig:login. */
export async function createContext(): Promise<string> {
  const bb = getBrowserbase();
  const ctx = await bb.contexts.create({ projectId: browserbaseProjectId() });
  return ctx.id;
}
