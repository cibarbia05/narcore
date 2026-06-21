// The undercover operative. Attaches Stagehand to a PRE-CREATED Browserbase session
// (so the orchestrator already has the live-view URL for the UI), opens an Instagram
// DM thread with a flagged seller from one of our logged-in burner accounts, and
// negotiates toward two objectives: a confirmed deal and a confirmed meeting
// location. After EVERY seller reply it re-reads the conversation (the brain) and
// updates deal/location state, so the operator watches the confirmations flip live.
//
// Design choices that matter for a live demo:
//   - One session is held open for the whole negotiation; we poll the thread for new
//     replies (the counterparty is a controlled demo account a teammate replies from).
//   - Sending uses Stagehand `act` (robust to IG's obfuscated DM DOM); reading the
//     thread uses Stagehand `extract` with a schema that labels each bubble me/them.
//   - Everything is wrapped: a login wall / checkpoint / abort / timeout sets a clear
//     terminal status and exits cleanly, always closing the session.
//
// Contact is gated upstream (operation-orchestrator) to demo-adversary accounts we
// control — this loop never chooses who to message.
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { LeadSummary, OperationMessage } from "../src/lib/types";
import { appendMessage, patchOperation } from "../src/lib/agents/operation-store";
import { endSession } from "../src/lib/browserbase";
import { negotiate } from "../src/lib/operative-brain";
import { learnFromConfirmedOperation } from "../src/lib/field-intel";
import { recallMemories, pinOperationMemory } from "../src/lib/agent-memory";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

// Overall wall-clock budget for one negotiation (must stay under the session
// timeout). Per-reply wait, poll cadence, and a turn cap bound the loop.
const BUDGET_MS = clampInt(process.env.OPERATIVE_BUDGET_MS, 25 * 60_000, 60_000, 6 * 60 * 60_000);
const REPLY_WAIT_MS = clampInt(process.env.OPERATIVE_REPLY_WAIT_MS, 4 * 60_000, 30_000, 30 * 60_000);
const POLL_MS = clampInt(process.env.OPERATIVE_POLL_MS, 15_000, 5_000, 120_000);
const MAX_TURNS = clampInt(process.env.OPERATIVE_MAX_TURNS, 12, 1, 50);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The visible DM thread as raw, ordered message texts. We deliberately do NOT ask
// the model to label sender (me/them): alignment labelling proved unreliable and
// caused the operative's own messages to be read back as seller replies. Instead we
// extract just the texts and classify sender ourselves against what we KNOW we sent.
const threadSchema = z.object({
  messages: z
    .array(z.object({ text: z.string().describe("the message text") }))
    .describe("every visible message in this DM conversation, in order, oldest first"),
});

/** A page is a login wall / checkpoint if IG bounced us off the content. */
function detectBlock(url: string): "captcha" | "blocked" | null {
  if (/\/challenge\//i.test(url) || /\/checkpoint\//i.test(url)) return "captcha";
  if (/\/accounts\/login/i.test(url) || /\/accounts\/suspended/i.test(url)) return "blocked";
  return null;
}

export interface OperativeAgentOptions {
  operationId: string;
  handle: string; // seller handle (no leading '@'); chosen + allowlist-checked upstream
  lead: LeadSummary;
  sessionId: string;
  signal: AbortSignal;
}

export async function runOperativeAgent(opts: OperativeAgentOptions): Promise<void> {
  const { operationId, handle, lead, sessionId, signal } = opts;
  const deadline = Date.now() + BUDGET_MS;
  const timedOut = () => Date.now() > deadline;

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    await patchOperation(operationId, {
      status: "error",
      error: "BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not set",
    });
    return;
  }

  // B3: opt-in Stagehand action caching (zero-token replay of stable nav chrome).
  // Off by default so a stale cached action can never surprise a live demo; set
  // OPERATIVE_STAGEHAND_CACHE_DIR to enable. Concurrent operatives need distinct dirs.
  const cacheDir = process.env.OPERATIVE_STAGEHAND_CACHE_DIR;
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey,
    projectId,
    browserbaseSessionID: sessionId,
    verbose: 1,
    model: {
      modelName: process.env.SCRAPE_MODEL ?? DEFAULT_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    ...(cacheDir ? { cacheDir } : {}),
  });

  // Hoisted so the send guard and helpers can read the current URL. A DM thread is
  // genuinely open only when the URL is /direct/t/<id>.
  let page!: ReturnType<typeof stagehand.context.pages>[number];

  const transcript: OperationMessage[] = [];
  // Ground truth: normalized texts of messages WE have sent. Sender is decided by
  // matching against this set, never by the model's (unreliable) me/them guess.
  const sentTexts: string[] = [];
  let sellerConsumed = 0; // seller messages already handled

  // Normalize for fuzzy matching (strip emojis/punctuation/case/extra spaces).
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const isOurs = (text: string): boolean => {
    const t = norm(text);
    if (!t) return false;
    return sentTexts.some((s) => s === t || s.includes(t) || t.includes(s));
  };

  /** Extract every visible message text, oldest first (no sender labels). */
  async function readThreadTexts(): Promise<string[]> {
    const { messages } = await stagehand.extract(
      "Read this Instagram direct-message conversation and return the text of EVERY visible message, in order, oldest first. Return the message texts only.",
      threadSchema,
    );
    return messages.map((m) => m.text).filter((t) => t && t.trim().length > 0);
  }

  /** The seller's messages = every visible message that isn't one we sent. */
  async function sellerMessages(): Promise<string[]> {
    return (await readThreadTexts()).filter((t) => !isOurs(t));
  }

  /** Send one DM and CONFIRM it actually landed before recording it. Returns false
   *  if the message never appeared in the thread, so the caller surfaces a real
   *  failure instead of a phantom "sent" line. Uses observe→act (the documented
   *  reliable pattern) and verifies against the rendered thread. */
  async function sendMessage(text: string): Promise<boolean> {
    // HARD GUARD: never type into anything unless we're actually inside a DM thread
    // (/direct/t/...). Without this, a failed open dumps the message into the
    // new-message "To" search box instead of sending it.
    if (!/\/direct\/t\//i.test(page.url())) {
      console.warn(
        `[operative ${operationId}] refusing to send — not in a DM thread (URL: ${page.url()})`,
      );
      return false;
    }
    // Focus the composer via observe→act (more reliable than a blind click).
    try {
      const box = await stagehand.observe(
        "the message text input box at the bottom of the conversation where you type a message",
      );
      if (box.length > 0) await stagehand.act(box[0]);
    } catch {
      /* fall through — typing may still focus it */
    }
    await stagehand.act("type the message %msg% into the message box", { variables: { msg: text } });
    await stagehand.act("press Enter to send the message");

    // Verify our text actually appears in the thread before recording it. Stagehand
    // act can silently no-op on IG's DM DOM, so confirm against the rendered thread
    // and retry via a Send button. We match on TEXT, never on alignment.
    const target = norm(text);
    const landed = (texts: string[]): boolean =>
      texts.some((t) => {
        const n = norm(t);
        return n === target || n.includes(target) || target.includes(n);
      });
    for (let attempt = 0; attempt < 3; attempt++) {
      await sleep(1500);
      try {
        if (landed(await readThreadTexts())) {
          sentTexts.push(target); // ground truth — never read this back as a reply
          const msg: OperationMessage = { role: "operative", text, at: new Date().toISOString() };
          transcript.push(msg);
          await appendMessage(operationId, msg);
          return true;
        }
      } catch {
        /* transient extract failure — retry */
      }
      try {
        const send = await stagehand.observe("the Send button to send the typed message");
        if (send.length > 0) await stagehand.act(send[0]);
        else await stagehand.act("press Enter to send the message");
      } catch {
        /* ignore and re-verify */
      }
    }
    return false;
  }

  /** Poll the thread until a NEW seller message appears, the budget/wait expires,
   *  or we're aborted. Returns the new seller text (joined if several), or null. */
  async function waitForReply(): Promise<string | null> {
    const waitUntil = Math.min(Date.now() + REPLY_WAIT_MS, deadline);
    while (Date.now() < waitUntil) {
      if (signal.aborted) return null;
      await sleep(POLL_MS);
      if (signal.aborted) return null;
      let seller: string[];
      try {
        seller = await sellerMessages();
      } catch (err) {
        console.warn(`[operative ${operationId}] reading replies failed:`, err);
        continue; // transient — keep polling
      }
      if (seller.length > sellerConsumed) {
        const fresh = seller.slice(sellerConsumed);
        sellerConsumed = seller.length;
        return fresh.join("\n");
      }
    }
    return null;
  }

  try {
    await patchOperation(operationId, {
      status: "opening",
      currentAction: "connecting to browser",
    });
    await stagehand.init();
    page = stagehand.context.pages()[0] ?? (await stagehand.context.awaitActivePage());

    // 1. Open the seller's profile.
    await patchOperation(operationId, { currentAction: `opening @${handle}` });
    await page.goto(`https://www.instagram.com/${encodeURIComponent(handle)}/`, {
      waitUntil: "domcontentloaded",
    });
    await sleep(2500);

    const block = detectBlock(page.url());
    if (block) {
      await patchOperation(operationId, {
        status: "blocked",
        currentAction:
          block === "captcha" ? "checkpoint — take over the live view" : "blocked by login wall",
        error: `navigation landed on ${page.url()}`,
      });
      return;
    }

    // Best-effort: clear the "Turn on Notifications" / cookie popups IG throws up,
    // which otherwise sit on top of the Message button and the composer.
    const dismissPopups = async (): Promise<void> => {
      try {
        const x = await stagehand.observe(
          "a 'Not Now', 'Not now', 'Allow all cookies' or 'Dismiss' button on an open popup dialog, if any",
        );
        if (x.length > 0) await stagehand.act(x[0]);
      } catch {
        /* no popup */
      }
    };
    await dismissPopups();

    // A DM thread is genuinely open ONLY when the URL is /direct/t/<id>. We do not
    // accept "a text box is visible": the new-message dialog's "To" search box is a
    // text box too, and trusting it caused the opener to be typed into search.
    const waitForThreadOpen = async (timeoutMs: number): Promise<boolean> => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (signal.aborted) return false;
        if (/\/direct\/t\//i.test(page.url())) return true;
        await sleep(1000);
      }
      return /\/direct\/t\//i.test(page.url());
    };

    // Poll observe until it returns a candidate or times out — handles IG's slow SPA
    // hydration (the page sits on a loading splash for several seconds after goto, so
    // a single observe after a fixed sleep frequently finds nothing).
    const observeUntil = async (
      instruction: string,
      timeoutMs: number,
    ): Promise<Awaited<ReturnType<typeof stagehand.observe>>> => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        if (signal.aborted) break;
        try {
          const r = await stagehand.observe(instruction);
          if (r.length > 0) return r;
        } catch {
          /* retry */
        }
        await sleep(2000);
      }
      return [];
    };

    // 2. Open the DM thread. Two strategies (OPERATIVE_DM_OPEN_STRATEGY):
    //    - "ladder" (default): the hand-rolled observe→act ladder below.
    //    - "agent": one self-healing stagehand.agent({mode:'dom'}) call that finds its
    //      own path through popups/DOM churn. Either way the SAME invariant decides
    //      success (URL is /direct/t/…), never the agent's self-report.
    //
    //    Ladder — Path A (quick): a profile "Message" button, if Instagram shows one.
    //             Path B (reliable): the DM inbox search finds ANY account — including
    //             non-followers, under "More accounts" — and clicking the result
    //             opens/creates the /direct/t/ thread.
    const openDmThreadLadder = async (): Promise<boolean> => {
      // Path A — profile Message button (present only for some relationships).
      await patchOperation(operationId, { currentAction: "looking for the Message button" });
      const msgBtn = await observeUntil(
        "the 'Message' button on this profile header that opens a direct message thread",
        6_000,
      );
      if (msgBtn.length > 0) {
        await patchOperation(operationId, { currentAction: "clicking Message" });
        await stagehand.act(msgBtn[0]);
        await dismissPopups(); // a "Turn on Notifications" prompt often appears here
        if (await waitForThreadOpen(15_000)) return true;
      }

      // Path B — DM inbox search → pick the result → open the thread.
      await patchOperation(operationId, { currentAction: "opening direct messages" });
      await page.goto("https://www.instagram.com/direct/inbox/", { waitUntil: "domcontentloaded" });
      await sleep(6000); // let the SPA hydrate
      if (detectBlock(page.url())) return false;
      await dismissPopups();

      const searchBox = await observeUntil(
        "the search input box at the top of the conversations list on the left (placeholder 'Search')",
        20_000,
      );
      if (searchBox.length === 0) return false;
      await stagehand.act(searchBox[0]);
      await patchOperation(operationId, { currentAction: `searching for @${handle}` });
      await stagehand.act("type the username %handle% into the search box", { variables: { handle } });

      const result = await observeUntil(
        `the search result row for the account @${handle} under "More accounts" (or any account result matching ${handle})`,
        20_000,
      );
      if (result.length === 0) return false;
      await patchOperation(operationId, { currentAction: `opening chat with @${handle}` });
      await stagehand.act(result[0]);
      if (await waitForThreadOpen(15_000)) return true;

      // Some layouts pop a New Message dialog needing a final "Chat"/"Next" click.
      try {
        const chat = await stagehand.observe("the 'Chat' or 'Next' button to open the conversation");
        if (chat.length > 0) await stagehand.act(chat[0]);
      } catch {
        /* ignore */
      }
      return waitForThreadOpen(10_000);
    };

    // B3: self-healing DM open via a DOM-mode agent. Reuses the constructor's model +
    // key (no CUA, no extra key). The post-agent invariant + detectBlock still gate
    // success, and the auditable sendMessage loop below is deliberately NOT delegated.
    let dmAgentStep = 0;
    const openDmThreadAgent = async (): Promise<boolean> => {
      await patchOperation(operationId, { currentAction: "self-healing DM open (agent)" });
      try {
        const agent = stagehand.agent({ mode: "dom" });
        const result = await agent.execute({
          instruction:
            `Open a direct-message conversation with the Instagram user @${handle}. ` +
            `Dismiss any popups (e.g. 'Turn on Notifications', cookie banners). Prefer the ` +
            `profile 'Message' button; otherwise open the Direct inbox, search for ${handle}, ` +
            `and click the matching account to open the thread. Stop as soon as the conversation ` +
            `thread is open with a message input box visible. Do NOT type or send any message.`,
          maxSteps: clampInt(process.env.OPERATIVE_DM_AGENT_MAX_STEPS, 14, 4, 40),
          signal,
          callbacks: {
            onStepFinish: async () => {
              dmAgentStep += 1;
              await patchOperation(operationId, {
                currentAction: `self-healing DM open · step ${dmAgentStep}`,
              }).catch(() => {});
            },
          },
        });
        // Stream the agent's reasoning to the logs for observability (the play-by-play).
        for (const action of result.actions ?? []) {
          const line = `${action.action ?? action.type ?? ""} ${action.reasoning ?? ""}`.trim();
          if (line) console.log(`[operative ${operationId}] dm-agent: ${line}`);
        }
      } catch (err) {
        console.warn(`[operative ${operationId}] DM-open agent failed:`, err);
      }
      // The invariant — not the agent's self-report — decides success.
      return waitForThreadOpen(8_000);
    };

    const dmStrategy = (process.env.OPERATIVE_DM_OPEN_STRATEGY ?? "ladder").toLowerCase();
    const openDmThread = dmStrategy === "agent" ? openDmThreadAgent : openDmThreadLadder;

    await patchOperation(operationId, { status: "opening", currentAction: "opening a direct message" });
    const opened = await openDmThread();
    if (detectBlock(page.url())) {
      await patchOperation(operationId, {
        status: "blocked",
        currentAction: "blocked opening the DM",
        error: `navigation landed on ${page.url()}`,
      });
      return;
    }
    if (!opened) {
      await patchOperation(operationId, {
        status: "error",
        currentAction: "couldn't open the DM thread",
        error:
          `Could not open a DM with @${handle}: neither the profile Message button nor the inbox ` +
          `search reached a conversation (URL: ${page.url()}). Watch the live view — @${handle} may ` +
          `not exist/be searchable, or a popup is covering the UI.`,
      });
      return;
    }
    await dismissPopups();

    // Baseline: treat any messages already in the thread as seen, so prior history
    // isn't mistaken for a reply.
    try {
      sellerConsumed = (await sellerMessages()).length;
    } catch {
      sellerConsumed = 0;
    }

    // R2: prime with cross-operation agent memory before the first message
    // (fail-open — recall returns [] if the memory server is down).
    let priorIntel: string[] = [];
    try {
      const recalled = await recallMemories({
        handle,
        drug: lead.matchedKnownTermDrug,
        codeWords: lead.detectedCodeWords,
      });
      priorIntel = recalled.map((m) => m.text);
      if (priorIntel.length) {
        await patchOperation(operationId, { priorIntel });
        console.log(`[operative ${operationId}] primed with ${priorIntel.length} prior-intel memo(s)`);
      }
    } catch (err) {
      console.warn(`[operative ${operationId}] memory recall failed (fail-open):`, err);
    }

    // 2. The brain produces the opening line.
    await patchOperation(operationId, { currentAction: "composing the opening message" });
    const opening = await negotiate(lead, transcript, priorIntel);
    let outgoing = opening.nextMessage;

    // 3. Negotiation loop: send → wait → analyze → check deal/location → repeat.
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal.aborted) break;
      if (!outgoing) {
        // Brain declined to produce a message before any deal — treat as a dead lead.
        await patchOperation(operationId, {
          status: "rejected",
          currentAction: "no viable approach",
        });
        return;
      }

      const sent = await sendMessage(outgoing);
      if (!sent) {
        await patchOperation(operationId, {
          status: "error",
          currentAction: "couldn't send the message",
          error:
            `Typed the message but it never appeared in the thread (URL: ${page.url()}). The ` +
            `composer may not be focused, or Instagram didn't accept the send — watch the live view.`,
        });
        return;
      }
      await patchOperation(operationId, {
        status: "awaiting_reply",
        currentAction: "waiting for a reply",
        turnCount: turn + 1,
      });

      const reply = await waitForReply();
      if (signal.aborted) break;
      if (reply === null) {
        await patchOperation(operationId, {
          status: "stalled",
          currentAction: timedOut() ? "time budget reached" : "no reply within the window",
        });
        return;
      }

      const sellerMsg: OperationMessage = {
        role: "seller",
        text: reply,
        at: new Date().toISOString(),
      };
      transcript.push(sellerMsg);
      await appendMessage(operationId, sellerMsg);

      await patchOperation(operationId, {
        status: "analyzing",
        currentAction: "assessing the reply",
      });
      const step = await negotiate(lead, transcript, priorIntel);
      const a = step.analysis;

      // THE CORE CHECK — update deal/location after every exchange.
      await patchOperation(operationId, {
        status: "negotiating",
        dealConfirmed: a.dealConfirmed,
        locationConfirmed: a.locationConfirmed,
        meetingLocation: a.meetingLocation,
        meetingTime: a.meetingTime,
        currentAction: `Deal ${a.dealConfirmed ? "✓" : "✗"} · Location ${a.locationConfirmed ? "✓" : "✗"}`,
      });

      if (a.dealConfirmed && a.locationConfirmed) {
        if (step.nextMessage) await sendMessage(step.nextMessage); // optional closing line
        await patchOperation(operationId, {
          status: "confirmed",
          currentAction: a.meetingLocation
            ? `confirmed — meet at ${a.meetingLocation}`
            : "deal & location confirmed",
        });
        // R1: this confirmed bust teaches the detection corpus (best-effort — must
        // never affect the already-confirmed outcome).
        try {
          await learnFromConfirmedOperation({ operationId, handle, lead, transcript });
        } catch (err) {
          console.warn(`[operative ${operationId}] field-intel learning failed:`, err);
        }
        // R2: pin this confirmed operation as long-term memory so the NEXT op is
        // primed by it (fail-open).
        try {
          await pinOperationMemory({
            operationId,
            handle,
            drug: lead.matchedKnownTermDrug,
            codeWords: lead.detectedCodeWords,
            opener: transcript.find((m) => m.role === "operative")?.text ?? null,
            meetingLocation: a.meetingLocation,
            meetingTime: a.meetingTime,
            turnCount: transcript.filter((m) => m.role === "operative").length,
          });
        } catch (err) {
          console.warn(`[operative ${operationId}] memory pin failed (fail-open):`, err);
        }
        return;
      }
      if (a.rejection || step.done) {
        await patchOperation(operationId, {
          status: "rejected",
          currentAction: "target declined",
        });
        return;
      }
      if (timedOut()) {
        await patchOperation(operationId, {
          status: "stalled",
          currentAction: "time budget reached",
        });
        return;
      }

      outgoing = step.nextMessage;
    }

    // Fell out of the loop: aborted, or hit the turn cap.
    if (signal.aborted) {
      await patchOperation(operationId, {
        status: "stopped",
        currentAction: "stopped by operator",
      });
    } else {
      await patchOperation(operationId, {
        status: "stalled",
        currentAction: "reached the message limit without both confirmations",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[operative ${operationId}] error:`, err);
    await patchOperation(operationId, {
      status: "error",
      currentAction: "operative error",
      error: message.slice(0, 300),
    });
  } finally {
    try {
      await stagehand.close();
    } catch {
      /* ignore */
    }
    await endSession(sessionId);
  }
}
