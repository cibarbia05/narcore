// LLM-drafted outreach. The template (buildOutreachDraft) is the guaranteed
// fallback; when ANTHROPIC_API_KEY is set we ask Claude to polish the body from
// the same facts. Any failure (no key, network, refusal) falls back silently —
// the outreach draft is simulated and must never break the demo (SPEC §2.1, §12).
import Anthropic from "@anthropic-ai/sdk";

import { buildOutreachDraft } from "./lead-summary";
import type { DraftedOutreach, LeadSummary } from "./types";

// Cheap, sufficient for short factual drafting; overridable via OUTREACH_MODEL.
const DEFAULT_OUTREACH_MODEL = "claude-haiku-4-5-20251001";

export async function draftOutreach(
  summary: LeadSummary,
  channel: DraftedOutreach["channel"] = "platform_report",
): Promise<DraftedOutreach> {
  const template = buildOutreachDraft(summary, channel); // always have a fallback
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return template;

  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: process.env.OUTREACH_MODEL ?? DEFAULT_OUTREACH_MODEL,
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content:
            "You are drafting a concise, factual lead-referral email to a platform Trust & Safety " +
            "team about a likely illicit-drug-advertising post. Be professional, non-accusatory, " +
            "and evidence-based. Use ONLY these facts:\n" +
            JSON.stringify(summary, null, 2) +
            "\nReturn only the email body.",
        },
      ],
    });
    const textBlock = message.content.find((b) => b.type === "text");
    const body = textBlock && "text" in textBlock ? textBlock.text.trim() : template.body;
    return { ...template, body };
  } catch {
    return template; // never break the demo
  }
}
