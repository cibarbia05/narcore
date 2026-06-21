// End-to-end verification for B2 (session identity).
//   PART 1  pure: sessionIdentity() reflects env.
//   PART 2  Redis persist / read / diff / describeContexts (ok + mismatch).
//   PART 3  LIVE: a real Browserbase session is created with os pinned (proves the
//           SDK + API accept `os`), then released. No Instagram navigation.
//
// Run:  npx tsx scripts/test-identity.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(join(process.cwd(), file), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");
process.env.IG_PROXY_COUNTRY = process.env.IG_PROXY_COUNTRY ?? "US";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TEST_CTX = "narcore-test-ctx-b2";

async function main(): Promise<void> {
  const { sessionIdentity, createIgSession, endSession } = await import("../src/lib/browserbase");
  const { persistContextIdentity, getContextIdentity, diffIdentity, describeContexts } =
    await import("../src/lib/session-identity");
  const { connectRedis } = await import("../src/lib/redis");

  // PART 1 — pure resolution incl. the plan guard
  console.log("PART 1 — sessionIdentity() reflects env (with the Enterprise-os guard)");
  process.env.BB_BROWSER_OS = "mac";
  process.env.BB_VERIFIED = "false";
  const guarded = sessionIdentity();
  check("non-linux os WITHOUT verified is guarded → null (no 400 footgun)", guarded.os === null, `os=${guarded.os}`);

  process.env.BB_BROWSER_OS = "linux";
  const linuxId = sessionIdentity();
  check("os=linux passes through (the only non-verified option)", linuxId.os === "linux");

  process.env.BB_BROWSER_OS = "mac";
  process.env.BB_VERIFIED = "true";
  const verifiedId = sessionIdentity();
  check("non-linux os WITH verified passes through", verifiedId.os === "mac" && verifiedId.verified === true);

  // settle on a safe, deterministic identity for the rest of the test
  process.env.BB_BROWSER_OS = "linux";
  process.env.BB_VERIFIED = "false";
  const id = sessionIdentity();
  check("viewport is the desktop 1280×800", id.viewport.width === 1280 && id.viewport.height === 800);
  check("proxyCountry + region populated", Boolean(id.proxyCountry && id.region), `${id.proxyCountry}/${id.region}`);

  // PART 2 — Redis persist / read / diff
  console.log("\nPART 2 — identity persistence + drift detection (Redis)");
  await persistContextIdentity(TEST_CTX, id);
  const readBack = await getContextIdentity(TEST_CTX);
  check("persisted identity reads back", readBack !== null && readBack.os === "linux");
  check("diff of identical identities is empty", readBack !== null && diffIdentity(id, readBack).length === 0);

  const drifted = { ...id, os: "windows" };
  check(
    "diff detects a changed os",
    diffIdentity(id, drifted).includes("os") && diffIdentity(id, drifted).length === 1,
    diffIdentity(id, drifted).join(","),
  );

  const okStatuses = await describeContexts([TEST_CTX]);
  check("describeContexts → match OK when env matches login", okStatuses[0]?.match === "ok", okStatuses[0]?.match);
  check("context id is masked", !okStatuses[0]?.id.includes(TEST_CTX) || TEST_CTX.length <= 8);

  await persistContextIdentity(TEST_CTX, drifted as typeof id);
  const mismatchStatuses = await describeContexts([TEST_CTX]);
  check(
    "describeContexts → mismatch when login os differs",
    mismatchStatuses[0]?.match === "mismatch" && mismatchStatuses[0]?.diffs.includes("os"),
    `${mismatchStatuses[0]?.match} (${mismatchStatuses[0]?.diffs.join(",")})`,
  );

  const unknownStatuses = await describeContexts(["narcore-never-logged-in"]);
  check("describeContexts → unknown when no record", unknownStatuses[0]?.match === "unknown");

  // PART 3 — LIVE Browserbase session creates
  console.log("\nPART 3 — LIVE: real Browserbase session creation");
  const contextIds = (process.env.BROWSERBASE_CONTEXT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!process.env.BROWSERBASE_API_KEY || contextIds.length === 0) {
    console.log("  ⏭️  skipped (no BROWSERBASE_API_KEY / BROWSERBASE_CONTEXT_IDS)");
  } else {
    // 3a: os=linux pinned → API accepts it.
    process.env.BB_BROWSER_OS = "linux";
    process.env.BB_VERIFIED = "false";
    let s1 = "";
    try {
      s1 = await createIgSession(contextIds[0], { timeoutSeconds: 60 });
      check("real session created with os=linux pinned", Boolean(s1), s1);
    } catch (err) {
      check("real session created with os=linux pinned", false, String(err));
    } finally {
      if (s1) await endSession(s1);
    }

    // 3b: os=mac without verified → guard drops it → session still creates (no 400).
    process.env.BB_BROWSER_OS = "mac";
    process.env.BB_VERIFIED = "false";
    let s2 = "";
    try {
      s2 = await createIgSession(contextIds[0], { timeoutSeconds: 60 });
      check("guard prevents the os=mac/unverified 400 (session still creates)", Boolean(s2), s2);
    } catch (err) {
      check("guard prevents the os=mac/unverified 400 (session still creates)", false, String(err));
    } finally {
      if (s2) await endSession(s2);
    }
  }

  // cleanup
  const client = await connectRedis();
  await client.del(`identity:context:${TEST_CTX}`);

  console.log(`\n──────── RESULT: ${passed} passed, ${failed} failed ────────`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});
