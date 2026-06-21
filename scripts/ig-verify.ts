/**
 * Verify that each saved Browserbase Context is actually logged into Instagram.
 *
 *   pnpm ig:verify
 *
 * For every id in BROWSERBASE_CONTEXT_IDS it opens a session with that context
 * (read-only, exactly like the agents do), navigates to instagram.com, and
 * reports whether it lands on the home feed (LOGGED IN) or gets bounced to the
 * login wall (NOT logged in → re-run `pnpm ig:login`).
 *
 * Prints each live-view URL so you can watch. Requires BROWSERBASE_API_KEY +
 * BROWSERBASE_PROJECT_ID (auto-loaded from .env / .env.local).
 */
function loadEnv(file: string): void {
  try {
    (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(file);
  } catch {
    /* ignore */
  }
}
loadEnv(".env");
loadEnv(".env.local");

function isLoginWall(url: string): boolean {
  return /\/accounts\/login/i.test(url) || /\/challenge\//i.test(url);
}

async function verifyOne(contextId: string, n: number, total: number): Promise<boolean> {
  const { createIgSession, getLiveViewUrl, endSession } = await import("../src/lib/browserbase");
  const { Stagehand } = await import("@browserbasehq/stagehand");

  console.log(`\n=== Context ${n}/${total}: ${contextId} ===`);
  const sessionId = await createIgSession(contextId); // persist:false, same as agents
  const liveViewUrl = await getLiveViewUrl(sessionId);
  console.log(`  live view: ${liveViewUrl}`);

  const sh = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY,
    projectId: process.env.BROWSERBASE_PROJECT_ID,
    browserbaseSessionID: sessionId,
    verbose: 1,
  });

  try {
    await sh.init();
    const page = sh.context.pages()[0] ?? (await sh.context.awaitActivePage());
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    // Give IG a moment to run its client-side redirect to /accounts/login if logged out.
    await new Promise((r) => setTimeout(r, 4000));
    const finalUrl = page.url();
    const loggedIn = !isLoginWall(finalUrl);
    console.log(
      `  → ${loggedIn ? "✅ LOGGED IN" : "❌ NOT logged in"}  (landed on ${finalUrl})`,
    );
    return loggedIn;
  } catch (err) {
    console.error("  → error:", err instanceof Error ? err.message : err);
    return false;
  } finally {
    try {
      await sh.close();
    } catch {
      /* ignore */
    }
    await endSession(sessionId);
  }
}

async function main(): Promise<void> {
  const ids = (process.env.BROWSERBASE_CONTEXT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    console.error(
      "BROWSERBASE_CONTEXT_IDS is empty. Run `pnpm ig:login` first, then paste the printed id(s) into .env.local.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Verifying ${ids.length} context(s)…`);
  const results: boolean[] = [];
  for (let i = 0; i < ids.length; i++) {
    results.push(await verifyOne(ids[i], i + 1, ids.length));
  }

  const ok = results.filter(Boolean).length;
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`${ok}/${ids.length} context(s) logged in.`);
  if (ok < ids.length) {
    console.log("Re-run `pnpm ig:login` for the ones that failed, and be sure you see");
    console.log("your Instagram HOME FEED in the live view before pressing Enter.");
  }
  console.log(`──────────────────────────────────────────────\n`);
}

main().catch((err) => {
  console.error("[ig-verify] failed:", err);
  process.exitCode = 1;
});
