// End-to-end verification for the R1 field-intel closed loop.
//
// Runs against REAL infrastructure (Redis Stack + the embedding sidecar + Claude):
//   PART A  provenance gate — real Claude extraction; every surviving term's
//           evidence must be a verbatim substring of the seller's own messages.
//   PART B  deterministic mechanics (no LLM) — adding a field vector raises a
//           pending post's risk score (the corpus feedback is real), corpusStats
//           counts it, and the stream ticker records + reads back the event.
//   PART C  full integration — learnFromConfirmedOperation() over a crafted
//           confirmed transcript writes corpus:field:* + emits a ticker event.
//
// Cleans up every key it creates. Exit code 0 = all assertions passed.
//
// Run:  npx tsx scripts/test-field-intel.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

// --- minimal .env loader (tsx does not auto-load dotenv) ---
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
    const key = m[1];
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");
// Bound the integration re-score so the test stays fast even with many real posts.
if (process.env.FIELD_INTEL_RESCORE_LIMIT === undefined) process.env.FIELD_INTEL_RESCORE_LIMIT = "100";

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

async function main(): Promise<void> {
  const { connectRedis, CORPUS_FIELD_PREFIX, FIELD_INTEL_STREAM } = await import("../src/lib/redis");
  const { ensureIndexes } = await import("../src/lib/redis");
  const { embed } = await import("../src/lib/embeddings");
  const { SCORING } = await import("../src/lib/scoring");
  const { postIdFromLink } = await import("../src/lib/ids");
  const {
    addFieldEntry,
    corpusStats,
    savePost,
    scorePost,
    seedCorpus,
    getPost,
  } = await import("../src/lib/repo");
  const { extractFieldTerms, learnFromConfirmedOperation, appendFieldIntelEvent, getFieldIntelEvents } =
    await import("../src/lib/field-intel");

  const client = await connectRedis();
  await ensureIndexes();
  // Guarantee a non-empty corpus so "before" scores have realistic neighbors.
  const seeded = await seedCorpus();
  console.log(`\nseed corpus ready (${seeded.loaded} terms)\n`);

  const createdKeys: string[] = [];
  const createdStreamIds: string[] = [];

  const lead: import("../src/lib/types").LeadSummary = {
    postId: "test",
    generatedAt: new Date().toISOString(),
    handle: "demo_plug_test",
    platform: "instagram",
    postLink: "https://instagram.com/p/test",
    postDate: new Date().toISOString(),
    riskScore: 80,
    riskBand: "high",
    detectedCodeWords: [],
    matchedKnownTerm: null,
    matchedKnownTermDrug: "counterfeit oxycodone",
    handoffApps: [],
    paymentCues: [],
    rationale: "test",
    narrative: "test",
  };

  try {
    // ===================== PART A — provenance gate (real Claude) =====================
    console.log("PART A — provenance gate (real Claude extraction)");
    const transcriptA: import("../src/lib/types").OperationMessage[] = [
      { role: "operative", text: "yo you around? looking to grab something", at: new Date().toISOString() },
      { role: "seller", text: "ya i got blues and some zaza, also pressed perc30s. tap in", at: new Date().toISOString() },
      { role: "operative", text: "bet. where we linking", at: new Date().toISOString() },
      { role: "seller", text: "pull up to the shell on 5th, cash only", at: new Date().toISOString() },
    ];
    const sellerNormA = transcriptA
      .filter((m) => m.role === "seller")
      .map((m) => m.text)
      .join("\n")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

    const termsA = await extractFieldTerms(lead, transcriptA);
    check("extraction returns an array", Array.isArray(termsA), `${termsA.length} term(s): ${termsA.map((t) => t.term).join(", ")}`);
    check("at least one coded term extracted", termsA.length >= 1);
    const allHaveValidEvidence = termsA.every((t) => {
      const ev = t.evidenceQuote.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return ev.length > 0 && sellerNormA.includes(ev);
    });
    check("PROVENANCE: every term's evidence is verbatim in the seller's words", allHaveValidEvidence);
    const allConfident = termsA.every((t) => t.confidence >= 0.7);
    check("every surviving term passed the confidence floor (>=0.7)", allConfident);

    // ===================== PART B — deterministic mechanics (no LLM) =====================
    console.log("\nPART B — deterministic corpus feedback (no LLM)");
    const novelTerm = "wizard sparkles 💊"; // nonsense slang absent from seeds
    const postLinkB = "https://instagram.com/p/narcore-test-B";
    const postIdB = postIdFromLink(postLinkB);
    const captionB = novelTerm; // identical text => strong post↔field match after learning

    const before = await scorePost(captionB);
    const postB: import("../src/lib/types").Post = {
      id: postIdB,
      agentId: 0,
      postLink: postLinkB,
      username: "narcore_test_b",
      caption: captionB,
      platform: "instagram",
      postDate: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      scoredAt: before.risk.scoredAt,
      risk: before.risk,
      riskScore: before.risk.score,
      flagged: before.risk.flagged,
      approvalStatus: "pending",
      approvedAt: null,
      corpusEntryId: null,
    };
    await savePost(postB, before.queryVec);
    createdKeys.push(`post:${postIdB}`);
    const beforeScore = before.risk.score;

    const statsBefore = await corpusStats();
    const docVec = await embed(novelTerm, "document");
    const fieldKeyB = await addFieldEntry("TESTOPB", novelTerm, "test-substance", "wizard sparkles", docVec);
    createdKeys.push(fieldKeyB);
    check("addFieldEntry created a corpus:field:* key", fieldKeyB.startsWith(CORPUS_FIELD_PREFIX), fieldKeyB);

    const statsAfter = await corpusStats();
    check("corpusStats.field incremented", statsAfter.field === statsBefore.field + 1, `${statsBefore.field} → ${statsAfter.field}`);
    check("corpusStats.size includes field entries", statsAfter.size === statsAfter.seed + statsAfter.approved + statsAfter.field);

    const after = await scorePost(captionB);
    const afterScore = after.risk.score;
    check(
      "CLOSED LOOP: learning the term RAISES the pending post's score",
      afterScore > beforeScore,
      `score ${beforeScore} → ${afterScore} (threshold ${SCORING.THRESHOLD})`,
    );
    check(
      "nearest neighbor is now the learned field vector",
      after.risk.matchedTermId === fieldKeyB,
      `matched ${after.risk.matchedTermId}`,
    );
    if (beforeScore < SCORING.THRESHOLD && afterScore >= SCORING.THRESHOLD) {
      check("post flipped pending → flagged after learning", true, `now flagged at ${afterScore}`);
    } else {
      console.log(`  ℹ️  flip status: before flagged=${before.risk.flagged}, after flagged=${after.risk.flagged} (threshold ${SCORING.THRESHOLD})`);
    }

    // stream ticker round-trip
    const evAt = new Date().toISOString();
    const streamId = await appendFieldIntelEvent({
      at: evAt,
      operationId: "TESTOPB",
      handle: "demo_plug_test",
      terms: [novelTerm],
      rescored: 1,
      newlyFlagged: afterScore >= SCORING.THRESHOLD && beforeScore < SCORING.THRESHOLD ? 1 : 0,
    });
    createdStreamIds.push(streamId);
    const events = await getFieldIntelEvents(20);
    const found = events.find((e) => e.id === streamId);
    check("stream ticker recorded the event", Boolean(found));
    check("ticker round-trips terms array", Boolean(found && found.terms.includes(novelTerm)), found ? found.terms.join(", ") : "");

    // ===================== PART C — full integration (real LLM + loop) =====================
    console.log("\nPART C — full learnFromConfirmedOperation() integration");
    const novelC = "glitter caps"; // novel slang the seller will use
    const postLinkC = "https://instagram.com/p/narcore-test-C";
    const postIdC = postIdFromLink(postLinkC);
    const captionC = "fresh glitter caps 💊 dm me"; // paraphrases what the seller says
    const beforeC = await scorePost(captionC);
    const postC: import("../src/lib/types").Post = {
      id: postIdC,
      agentId: 0,
      postLink: postLinkC,
      username: "narcore_test_c",
      caption: captionC,
      platform: "instagram",
      postDate: new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      scoredAt: beforeC.risk.scoredAt,
      risk: beforeC.risk,
      riskScore: beforeC.risk.score,
      flagged: beforeC.risk.flagged,
      approvalStatus: "pending",
      approvedAt: null,
      corpusEntryId: null,
    };
    await savePost(postC, beforeC.queryVec);
    createdKeys.push(`post:${postIdC}`);

    const transcriptC: import("../src/lib/types").OperationMessage[] = [
      { role: "operative", text: "you got anything rn", at: new Date().toISOString() },
      { role: "seller", text: `yeah i got ${novelC}, super clean batch. how many u want`, at: new Date().toISOString() },
      { role: "operative", text: "lemme grab a few. where", at: new Date().toISOString() },
      { role: "seller", text: "meet me behind the 7-eleven on main st at 9, cash", at: new Date().toISOString() },
    ];
    const event = await learnFromConfirmedOperation({
      operationId: "TESTOPC",
      handle: "demo_plug_test",
      lead,
      transcript: transcriptC,
    });
    check("learnFromConfirmedOperation returned an event", event !== null, event ? `terms: ${event.terms.join(", ")}, rescored ${event.rescored}, newlyFlagged ${event.newlyFlagged}` : "null");
    check("at least one term promoted to the corpus", Boolean(event && event.terms.length >= 1));
    if (event) createdStreamIds.push(event.id);

    // verify a corpus:field key for this op exists
    const opCKeys = await scanKeys(client, `${CORPUS_FIELD_PREFIX}*-TESTOPC`);
    for (const k of opCKeys) createdKeys.push(k);
    check("corpus:field:*-TESTOPC entries were written", opCKeys.length >= 1, `${opCKeys.length} key(s)`);

    const afterC = await getPost(postIdC);
    if (afterC) {
      console.log(`  ℹ️  test post C score: ${beforeC.risk.score} → ${afterC.riskScore} (flagged ${afterC.flagged})`);
    }
  } finally {
    // ---- cleanup: remove everything this test created ----
    console.log("\ncleaning up test artifacts…");
    const client2 = await connectRedis();
    for (const k of createdKeys) {
      try {
        await client2.del(k);
      } catch {
        /* ignore */
      }
    }
    for (const id of createdStreamIds) {
      try {
        await client2.xDel(FIELD_INTEL_STREAM, id);
      } catch {
        /* ignore */
      }
    }
    console.log(`removed ${createdKeys.length} keys + ${createdStreamIds.length} stream entries`);
    // Restore truth: Part C re-scored real pending posts against a corpus that briefly
    // contained the test field term. Re-score once more (now that the test terms are
    // deleted) so any real post is back to its artifact-free score.
    try {
      const { listPosts, scorePost, savePost } = await import("../src/lib/repo");
      const page = await listPosts({ status: "pending", limit: 200 });
      for (const p of page.items) {
        const { risk, queryVec } = await scorePost(p.caption);
        await savePost(
          { ...p, risk, riskScore: risk.score, flagged: risk.flagged, scoredAt: risk.scoredAt },
          queryVec,
        );
      }
      console.log(`restored ${page.items.length} pending post score(s) to the real corpus`);
    } catch (err) {
      console.warn("restore pass failed:", err);
    }
    try {
      await client2.close();
    } catch {
      /* ignore */
    }
  }

  console.log(`\n──────── RESULT: ${passed} passed, ${failed} failed ────────`);
  process.exit(failed === 0 ? 0 : 1);
}

/** SCAN for keys matching a pattern (avoids KEYS on a hot server). */
async function scanKeys(
  client: Awaited<ReturnType<typeof import("../src/lib/redis").connectRedis>>,
  pattern: string,
): Promise<string[]> {
  const out: string[] = [];
  for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
    if (Array.isArray(key)) out.push(...key);
    else out.push(key);
  }
  return out;
}

main().catch((err) => {
  console.error("test crashed:", err);
  process.exit(1);
});
