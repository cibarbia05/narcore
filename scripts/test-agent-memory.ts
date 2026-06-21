// End-to-end verification for the R2 agent-memory client against the LIVE
// redislabs/agent-memory-server (docker-compose: agent-memory + worker + proxy).
//   - pinOperationMemory writes an episodic memory (worker indexes it via nomic).
//   - recallMemories returns it semantically (turn-0 priming).
//   - listMemories includes it.
//   - FAIL-OPEN: with the server unreachable, recall returns [] (never throws).
//
// Run (server must be up): npx tsx scripts/test-agent-memory.ts
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
process.env.AGENT_MEMORY_URL = process.env.AGENT_MEMORY_URL ?? "http://localhost:8000";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const { pinOperationMemory, recallMemories, listMemories } = await import("../src/lib/agent-memory");

  const handle = "test_seller_zzz";
  const opId = "narcore-test-am-1";

  console.log("PART 1 — pin a confirmed-operation memory");
  const pinned = await pinOperationMemory({
    operationId: opId,
    handle,
    drug: "ketamine",
    codeWords: ["special k", "vitamin k"],
    opener: "yo you around? heard you're the one to talk to",
    meetingLocation: "the parking lot behind Rite Aid on 12th",
    meetingTime: "tonight 10pm",
    turnCount: 5,
  });
  check("pinOperationMemory returned true", pinned === true);

  console.log("\nPART 2 — recall it (after worker indexing)");
  let recalled: Awaited<ReturnType<typeof recallMemories>> = [];
  for (let i = 0; i < 8; i++) {
    await sleep(2000);
    recalled = await recallMemories({ handle: "someone_new", drug: "ketamine", codeWords: ["special k"] });
    if (recalled.some((m) => m.id === `op-${opId}`)) break;
  }
  check("recall returns at least one memory", recalled.length >= 1, `${recalled.length} recalled`);
  const mine = recalled.find((m) => m.id === `op-${opId}`);
  check("the pinned memory is recalled semantically", Boolean(mine), mine ? `sim=${mine.similarity}` : "not found");
  check("recalled memory carries its text + entities", Boolean(mine && mine.text.includes("Rite Aid") && mine.entities.includes(handle)));

  console.log("\nPART 3 — listMemories includes it");
  const listed = await listMemories(50);
  check("listMemories returns the pinned memory", listed.some((m) => m.id === `op-${opId}`), `${listed.length} total`);

  console.log("\nPART 4 — FAIL-OPEN when the server is unreachable");
  const saved = process.env.AGENT_MEMORY_URL;
  process.env.AGENT_MEMORY_URL = "http://127.0.0.1:59999"; // nothing listening
  const failOpen = await recallMemories({ handle, drug: "ketamine", codeWords: [] });
  check("recall returns [] when server is down (no throw)", Array.isArray(failOpen) && failOpen.length === 0);
  const pinFailOpen = await pinOperationMemory({
    operationId: "x",
    handle,
    drug: null,
    codeWords: [],
    opener: null,
    meetingLocation: null,
    meetingTime: null,
    turnCount: 1,
  });
  check("pin returns false when server is down (no throw)", pinFailOpen === false);
  process.env.AGENT_MEMORY_URL = saved;

  // cleanup: best-effort delete the test memory key from Redis
  try {
    const { connectRedis } = await import("../src/lib/redis");
    const client = await connectRedis();
    for await (const key of client.scanIterator({ MATCH: "memory_idx:*", COUNT: 200 })) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        const id = await client.hGet(k, "id");
        if (id === `op-${opId}`) await client.del(k);
      }
    }
    console.log("\ncleaned up test memory key(s)");
  } catch (err) {
    console.warn("cleanup skipped:", err instanceof Error ? err.message : err);
  }

  console.log(`\n──────── RESULT: ${passed} passed, ${failed} failed ────────`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});
