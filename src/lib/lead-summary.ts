// Lead Summary builder — pure, deterministic, from a stored Post's RiskBreakdown.
// WT-B may optionally enrich `matchedKnownTermDrug` from the corpus entry and
// add an LLM-polished `narrative`; the template output below is the default.
import { riskBand } from "./scoring";
import type { DraftedOutreach, LeadSummary, Post } from "./types";

function formatRiskScore(score: number): string {
  return score.toFixed(1);
}

export function buildLeadSummary(post: Post): LeadSummary {
  const hits = post.risk.hits;
  const handoffApps = uniq(hits.filter((h) => h.kind === "handoff").map((h) => h.term));
  const paymentCues = uniq(
    hits.filter((h) => h.kind === "payment").map((h) => h.label.replace(/^Payment cue:\s*/, "")),
  );
  const band = riskBand(post.riskScore);

  return {
    postId: post.id,
    generatedAt: new Date().toISOString(),
    handle: post.username,
    platform: post.platform,
    postLink: post.postLink,
    postDate: post.postDate,
    riskScore: post.riskScore,
    riskBand: band,
    detectedCodeWords: post.risk.detectedCodeWords,
    matchedKnownTerm: post.risk.matchedTermText,
    matchedKnownTermDrug: null,
    handoffApps,
    paymentCues,
    rationale: buildRationale(post, handoffApps, paymentCues),
    narrative: buildNarrative(post, band, handoffApps, paymentCues),
  };
}

/** A drafted (simulated) outreach email derived from the lead summary. */
export function buildOutreachDraft(
  summary: LeadSummary,
  channel: DraftedOutreach["channel"] = "platform_report",
): DraftedOutreach {
  const to =
    channel === "email" ? "tips@dea.gov" : `trust-and-safety@${summary.platform}.example`;
  const subject = `Narcore lead: ${summary.handle} on ${summary.platform} (risk ${formatRiskScore(summary.riskScore)})`;
  const codeWords = summary.detectedCodeWords.length
    ? summary.detectedCodeWords.join(", ")
    : "n/a";
  const body = [
    "Hello,",
    "",
    `Narcore flagged a public post by ${summary.handle} on ${summary.platform} as likely illicit-drug advertising (risk score ${formatRiskScore(summary.riskScore)}, band: ${summary.riskBand}).`,
    "",
    `Post: ${summary.postLink}`,
    `Posted: ${summary.postDate}`,
    `Detected coded terms: ${codeWords}`,
    summary.handoffApps.length ? `Off-platform handoff(s): ${summary.handoffApps.join(", ")}` : "",
    summary.paymentCues.length ? `Payment cue(s): ${summary.paymentCues.join(", ")}` : "",
    "",
    summary.rationale,
    "",
    "This is an automated, human-reviewed lead generated from public data for investigative triage.",
    "",
    "— Narcore",
  ]
    .filter(Boolean)
    .join("\n");

  return { to, subject, body, channel };
}

function buildRationale(
  post: Post,
  handoffApps: string[],
  paymentCues: string[],
): string {
  const parts: string[] = [];
  parts.push(
    `Semantic similarity to known drug-advertising language was ${(post.risk.semantic * 100).toFixed(0)}%` +
      (post.risk.matchedTermText ? ` (nearest known pattern: "${post.risk.matchedTermText}")` : ""),
  );
  if (post.risk.detectedCodeWords.length) {
    parts.push(`coded terms present: ${post.risk.detectedCodeWords.join(", ")}`);
  }
  if (handoffApps.length) parts.push(`redirect to encrypted messaging (${handoffApps.join(", ")})`);
  if (paymentCues.length) parts.push(`payment cues (${paymentCues.join(", ")})`);
  return `Flagged because ${parts.join("; ")}.`;
}

function buildNarrative(
  post: Post,
  band: LeadSummary["riskBand"],
  handoffApps: string[],
  paymentCues: string[],
): string {
  return [
    `Account ${post.username} on ${post.platform} published a post that Narcore assessed as ${band}-risk for illicit-drug advertising (score ${formatRiskScore(post.riskScore)}).`,
    `Caption: "${post.caption}"`,
    buildRationale(post, handoffApps, paymentCues),
    `Recommended action: forward to the relevant platform Trust & Safety team and/or local law-enforcement narcotics unit for review.`,
  ].join("\n\n");
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}
