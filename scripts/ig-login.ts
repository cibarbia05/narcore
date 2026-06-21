/**
 * One-time Instagram login → persisted Browserbase Context.
 *
 *   pnpm ig:login            # provision 1 context
 *   pnpm ig:login 3          # provision 3 contexts (one per burner account)
 *
 * For each context this script:
 *   1. creates a fresh Browserbase Context,
 *   2. opens a residential-proxied session bound to it (persist: true),
 *   3. prints the live-view URL — you open it and LOG INTO INSTAGRAM BY HAND
 *      (solving any 2FA / "verify it's you" checkpoint yourself),
 *   4. on Enter, releases the session so the cookies persist into the context.
 *
 * At the end it prints the `BROWSERBASE_CONTEXT_IDS=` line to paste into your env.
 * The agents later reuse these contexts (read-only) so they start already logged
 * in — the single biggest defense against login checkpoints during the demo.
 *
 * Requires BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID (auto-loaded from .env /
 * .env.local below).
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Auto-load env from .env / .env.local (Node >= 20.12). Best-effort; if the file
// is absent or the API is unavailable, fall back to ambient shell env.
function loadEnv(file: string): void {
  try {
    (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile?.(file);
  } catch {
    /* file missing or older node — ignore */
  }
}
loadEnv(".env");
loadEnv(".env.local");

async function provisionOne(n: number, total: number): Promise<string> {
  // Imported after env load so module-level key checks see the values.
  const { createContext, createIgSession, getLiveViewUrl, endSession } = await import(
    "../src/lib/browserbase"
  );

  console.log(`\n=== Context ${n}/${total} ===`);
  const contextId = await createContext();
  console.log(`[ig-login] created context: ${contextId}`);

  const sessionId = await createIgSession(contextId, { persist: true });
  const liveViewUrl = await getLiveViewUrl(sessionId);

  // Pre-open Instagram's login page so you land right on the form. Best-effort —
  // if it fails, just type instagram.com into the live view's address bar.
  let stagehand: { close: () => Promise<void> } | undefined;
  try {
    const { Stagehand } = await import("@browserbasehq/stagehand");
    const sh = new Stagehand({
      env: "BROWSERBASE",
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      browserbaseSessionID: sessionId,
      verbose: 1,
    });
    await sh.init();
    const page = sh.context.pages()[0] ?? (await sh.context.awaitActivePage());
    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "domcontentloaded",
    });
    stagehand = sh;
  } catch (err) {
    console.warn(
      "[ig-login] couldn't pre-open the login page — type instagram.com into the live view's address bar instead:",
      err instanceof Error ? err.message : err,
    );
  }

  console.log("\n  1. Open this live-view URL in your browser:");
  console.log(`\n     ${liveViewUrl}\n`);
  console.log("  2. Log into Instagram by hand (solve any phone/email checkpoint yourself).");
  console.log("  3. Then come back here and press Enter.\n");

  const rl = readline.createInterface({ input, output });
  await rl.question("  Press Enter once you are fully logged in… ");
  rl.close();

  // Disconnect the driver, then release the session so the cookies persist.
  try {
    await stagehand?.close();
  } catch {
    /* ignore */
  }
  await endSession(sessionId);
  console.log(`[ig-login] session released — cookies saved to context ${contextId}`);
  return contextId;
}

async function main(): Promise<void> {
  const count = Math.max(1, Number.parseInt(process.argv[2] ?? "1", 10) || 1);
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(await provisionOne(i, count));
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("Add (or append) this to your .env / .env.local:\n");
  console.log(`BROWSERBASE_CONTEXT_IDS=${ids.join(",")}`);
  console.log("──────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("[ig-login] failed:", err);
  process.exitCode = 1;
});
