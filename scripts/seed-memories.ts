// Pre-seed the operative's long-term memory (R2) with a few realistic confirmed-
// operation lessons, so even the FIRST live operation shows a "Prior intel used"
// card and the /memory page isn't empty during a demo. Idempotent (fixed ids).
//
// Requires the agent-memory stack up (docker compose up -d). Run: pnpm seed:memories
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

const SEEDS = [
  {
    operationId: "seed-opioid",
    handle: "demo_plug_01",
    drug: "counterfeit oxycodone (M30)",
    codeWords: ["blues", "m30", "perc30s"],
    opener: "yo you around? lookin to grab a few",
    meetingLocation: "behind the Shell on 5th",
    meetingTime: "tonight",
    turnCount: 4,
  },
  {
    operationId: "seed-cannabis",
    handle: "demo_plug_02",
    drug: "high-grade cannabis",
    codeWords: ["zaza", "loud", "carts"],
    opener: "heard you got the good stuff, what's the move",
    meetingLocation: "the gas station on Telegraph",
    meetingTime: "tomorrow afternoon",
    turnCount: 5,
  },
  {
    operationId: "seed-stimulant",
    handle: "demo_plug_03",
    drug: "Adderall",
    codeWords: ["addy", "study buddies"],
    opener: "finals szn, need some addy. you still got?",
    meetingLocation: "the library parking lot",
    meetingTime: "friday",
    turnCount: 3,
  },
];

async function main(): Promise<void> {
  const { pinOperationMemory, listMemories } = await import("../src/lib/agent-memory");

  // Remove ad-hoc test memories from manual probing so the demo set is clean.
  try {
    const { connectRedis } = await import("../src/lib/redis");
    const client = await connectRedis();
    for await (const key of client.scanIterator({ MATCH: "memory_idx:*", COUNT: 300 })) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        const id = await client.hGet(k, "id");
        if (typeof id === "string" && (id.startsWith("op-narcore-test") || id === "narcore-test-mem-1" || id === "narcore-test-mem-2")) {
          await client.del(k);
        }
      }
    }
  } catch {
    /* best-effort cleanup */
  }

  let ok = 0;
  for (const seed of SEEDS) {
    const pinned = await pinOperationMemory(seed);
    console.log(`  ${pinned ? "✅" : "❌"} pinned ${seed.operationId} (@${seed.handle}, ${seed.drug})`);
    if (pinned) ok++;
  }

  console.log(`\nPinned ${ok}/${SEEDS.length}. Waiting for the worker to index…`);
  await new Promise((r) => setTimeout(r, 6000));
  const memories = await listMemories(50);
  console.log(`Memory now holds ${memories.length} long-term record(s).`);
  if (ok < SEEDS.length) {
    console.error("Some pins failed — is the agent-memory stack up? (docker compose up -d)");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("seed-memories failed:", err);
  process.exit(1);
});
