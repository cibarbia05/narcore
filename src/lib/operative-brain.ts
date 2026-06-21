// The operative brain — one structured Claude call per turn that BOTH reads the
// conversation (deal/location confirmation) AND drafts the operative's next DM.
//
// This is an AUTHORIZED law-enforcement undercover-contact tool: the operative
// poses as an interested buyer to get a flagged drug-advertising seller to (1)
// agree to a deal and (2) name a meeting location, so the human operator can act.
// Contact is hard-limited to demo-adversary accounts we control (see
// `operative-allowlist.ts`).
//
// Unlike `outreach.ts` (which has a deterministic template fallback), the brain is
// load-bearing — there is no sensible fallback for live negotiation. If
// ANTHROPIC_API_KEY is missing, the operation fails fast at start.
import Anthropic from "@anthropic-ai/sdk";

import type { LeadSummary, OperationAnalysis, OperationMessage } from "./types";

// Sonnet is the right tier for fast, multi-turn social reasoning. Overridable.
const DEFAULT_OPERATIVE_MODEL = "claude-sonnet-4-6";

/** The brain's full output for one turn. */
export interface NegotiationStep {
  analysis: OperationAnalysis;
  /** The operative's next DM, or null when the conversation is over. */
  nextMessage: string | null;
  /** True => stop the loop (both objectives met, or the lead is dead). */
  done: boolean;
}

/** Cheap precondition check used by the orchestrator before provisioning a session. */
export function operativeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Forced tool call → the model MUST return exactly this shape (Anthropic tool use).
const STEP_TOOL: Anthropic.Tool = {
  name: "submit_negotiation_step",
  description:
    "Record your assessment of the conversation so far and the operative's next move.",
  input_schema: {
    type: "object",
    properties: {
      dealConfirmed: {
        type: "boolean",
        description:
          "True only if the seller has clearly agreed to sell a specific product to the buyer AND to transact/meet — not merely chatting or listing a menu.",
      },
      locationConfirmed: {
        type: "boolean",
        description:
          "True only if a specific in-person meeting place has been named and not contradicted (a real place/address/landmark, not 'somewhere' or 'dm me').",
      },
      meetingLocation: {
        type: ["string", "null"],
        description: "The agreed meeting place verbatim, or null if none yet.",
      },
      meetingTime: {
        type: ["string", "null"],
        description: "The agreed meeting time verbatim, or null if none yet.",
      },
      rejection: {
        type: "boolean",
        description:
          "True if the seller declined, is hostile, suspects a setup, or the lead is otherwise dead.",
      },
      confidence: {
        type: "number",
        description: "Your confidence (0..1) in the above read of the conversation.",
      },
      reasoning: {
        type: "string",
        description: "One concise sentence justifying the assessment, for the operator.",
      },
      nextMessage: {
        type: ["string", "null"],
        description:
          "The operative's next DM to send. Null if and only if the conversation should end now (both objectives met with nothing left to say, or rejection).",
      },
      done: {
        type: "boolean",
        description:
          "True if the loop should stop after this turn (both objectives confirmed, or rejection).",
      },
    },
    required: [
      "dealConfirmed",
      "locationConfirmed",
      "meetingLocation",
      "meetingTime",
      "rejection",
      "confidence",
      "reasoning",
      "nextMessage",
      "done",
    ],
    additionalProperties: false,
  },
};

function systemPrompt(lead: LeadSummary): string {
  const drug = lead.matchedKnownTermDrug ?? "the advertised product";
  const codeWords = lead.detectedCodeWords.length ? lead.detectedCodeWords.join(", ") : "n/a";
  return [
    "You are an undercover online operative for an AUTHORIZED law-enforcement narcotics investigation.",
    `A public Instagram account (@${lead.handle}) was flagged for advertising illicit drugs (assessed: ${drug}; coded terms seen: ${codeWords}).`,
    "You are direct-messaging that account posing as an ordinary interested buyer.",
    "",
    "YOUR TWO OBJECTIVES, in order:",
    "1. DEAL: get the seller to clearly agree to sell to you and to meet/transact.",
    "2. LOCATION: get the seller to name a specific in-person meeting place (and ideally a time).",
    "",
    "STYLE: write like a real person texting — short, casual, lowercase is fine, light slang, one or two sentences, no emojis spam. Never reveal you are automated or law enforcement. Don't over-ask; move the conversation naturally toward a meetup. Ask for a meeting spot once a deal is in hand. Don't propose specifics of drugs/quantities beyond what's needed to seem real; let the seller lead on product details.",
    "",
    "Every turn, call submit_negotiation_step with your honest read of the conversation and your next message. Be STRICT: only set dealConfirmed/locationConfirmed when the seller has genuinely committed, not on vague replies. If both are confirmed, set done=true (nextMessage may be a brief closing confirmation or null). If the seller refuses or smells a setup, set rejection=true and done=true.",
  ].join("\n");
}

function renderTranscript(transcript: OperationMessage[]): string {
  if (transcript.length === 0) {
    return "(no messages yet — produce the opening DM that starts the conversation)";
  }
  return transcript
    .map((m) => `${m.role === "operative" ? "YOU (operative)" : "SELLER"}: ${m.text}`)
    .join("\n");
}

function asBool(v: unknown): boolean {
  return v === true;
}
function asNullableString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function asNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Run one negotiation turn. `transcript` is the full conversation so far (empty
 *  for the opening message). Throws if the brain is not configured or returns no
 *  structured step. */
export async function negotiate(
  lead: LeadSummary,
  transcript: OperationMessage[],
): Promise<NegotiationStep> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set — the operative brain requires it");
  }
  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: process.env.OPERATIVE_MODEL ?? DEFAULT_OPERATIVE_MODEL,
    max_tokens: 1024,
    system: systemPrompt(lead),
    tools: [STEP_TOOL],
    tool_choice: { type: "tool", name: STEP_TOOL.name },
    messages: [
      {
        role: "user",
        content: `Conversation so far (oldest first):\n\n${renderTranscript(transcript)}`,
      },
    ],
  });

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("operative brain returned no structured step");
  }
  const raw = block.input as Record<string, unknown>;

  const analysis: OperationAnalysis = {
    dealConfirmed: asBool(raw.dealConfirmed),
    locationConfirmed: asBool(raw.locationConfirmed),
    meetingLocation: asNullableString(raw.meetingLocation),
    meetingTime: asNullableString(raw.meetingTime),
    rejection: asBool(raw.rejection),
    confidence: asNumber(raw.confidence),
    reasoning: typeof raw.reasoning === "string" ? raw.reasoning : "",
  };
  const nextMessage = asNullableString(raw.nextMessage);
  // Hard invariant: if both objectives are met or the lead is rejected, we're done.
  const done =
    asBool(raw.done) ||
    analysis.rejection ||
    (analysis.dealConfirmed && analysis.locationConfirmed);

  return { analysis, nextMessage, done };
}
