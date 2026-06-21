// R1 — Field intelligence loop: a CONFIRMED undercover operation teaches the
// detection corpus, so the system gets better at catching dealers every time it
// catches one.
//
// Flow (called best-effort after an operation reaches "confirmed"):
//   1. One forced-tool Claude call extracts the coded slang the SELLER used.
//   2. PROVENANCE GATE — keep a term only if confidence >= MIN_CONFIDENCE AND its
//      evidence quote is a real substring of one of the seller's own messages.
//      This stops the operative from teaching the detector words the seller never
//      said (anti self-poisoning).
//   3. NEAR-DUPLICATE GATE — skip a term already represented in the corpus (KNN
//      distance below DEDUP_DISTANCE), so we don't pile up redundant vectors.
//   4. Embed survivors as "document" vectors (same space as seeds/approved) and
//      write them as corpus:field:* entries — they immediately become KNN
//      neighbors for upstream detection (idx:corpus, HASH prefix corpus:).
//   5. Re-score pending posts against the grown corpus (reusing scorePost, the
//      same path as /api/rescore — NOT a KNN over idx:posts, which has no vector
//      field) and count how many flipped to flagged.
//   6. Append one event to the stream:field-intel ticker.
//
// Every step is wrapped so a failure here NEVER affects the (already-confirmed)
// operation outcome — learning is a bonus, not a dependency.
import Anthropic from "@anthropic-ai/sdk";

import { embed } from "./embeddings";
import {
  addFieldEntry,
  corpusKnn,
  listPosts,
  savePost,
  scorePost,
} from "./repo";
import { connectRedis, FIELD_INTEL_STREAM } from "./redis";
import type { FieldIntelEvent, LeadSummary, OperationMessage, Post } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MIN_CONFIDENCE = 0.7;
const MAX_TERMS = 8; // bound how many vectors one operation can add
const STREAM_MAXLEN = 200;

// COSINE distance below which a term is treated as "already in the corpus" and
// skipped (cosine similarity above ~0.95). Conservative: only near-duplicates.
const DEDUP_DISTANCE = clampFloat(process.env.FIELD_INTEL_DEDUP_DISTANCE, 0.05, 0, 2);
const RESCORE_LIMIT = clampInt(process.env.FIELD_INTEL_RESCORE_LIMIT, 200, 1, 1000);

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampFloat(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined ? fallback : Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Same normalization the operative uses to match message text: lowercase, strip
 *  emojis/punctuation to single spaces. Used by the provenance gate. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// ---- extraction (forced tool) ----

interface ExtractedTerm {
  term: string;
  evidenceQuote: string;
  drug: string | null;
  confidence: number;
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "submit_field_terms",
  description:
    "Record the coded drug-slang terms the SELLER used in this confirmed conversation, with verbatim evidence.",
  input_schema: {
    type: "object",
    properties: {
      terms: {
        type: "array",
        description:
          "Distinct coded terms / slang the SELLER (never the operative) used to refer to drugs, products, quantities, packaging, or deal mechanics. Only include terms actually present in the seller's messages. Empty array if none.",
        items: {
          type: "object",
          properties: {
            term: {
              type: "string",
              description:
                "The coded term as a short normalized phrase, lowercase, e.g. 'tap in', 'addy', 'zaza', 'half a bean'.",
            },
            evidenceQuote: {
              type: "string",
              description:
                "A SHORT verbatim snippet copied from one of the SELLER's messages that contains this term (used to verify provenance).",
            },
            drug: {
              type: ["string", "null"],
              description: "The drug/product this term refers to if clear, else null.",
            },
            confidence: {
              type: "number",
              description: "0..1 confidence this is genuine drug-coded slang the seller used.",
            },
          },
          required: ["term", "evidenceQuote", "drug", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["terms"],
    additionalProperties: false,
  },
};

function extractSystemPrompt(lead: LeadSummary): string {
  const drug = lead.matchedKnownTermDrug ?? "illicit drugs";
  return [
    "You are a narcotics-intelligence analyst reviewing a CONFIRMED undercover chat where a flagged seller agreed to a drug deal.",
    `Context: the account @${lead.handle} was flagged for advertising ${drug}.`,
    "Extract the coded slang the SELLER used — terms a future detector should recognize.",
    "Rules:",
    "- Only terms the SELLER actually wrote (ignore the operative/buyer messages).",
    "- evidenceQuote MUST be copied verbatim from a seller message.",
    "- Prefer genuinely coded/ambiguous terms over plain English.",
    "- If the seller used no coded slang, return an empty terms array.",
    "Call submit_field_terms exactly once.",
  ].join("\n");
}

/** Render only the seller's side of the transcript for extraction. */
function sellerOnly(transcript: OperationMessage[]): string {
  return transcript
    .filter((m) => m.role === "seller")
    .map((m) => `SELLER: ${m.text}`)
    .join("\n");
}

/** Extract + provenance-gate the seller's coded slang. Returns [] on any failure. */
export async function extractFieldTerms(
  lead: LeadSummary,
  transcript: OperationMessage[],
): Promise<ExtractedTerm[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const sellerText = transcript.filter((m) => m.role === "seller").map((m) => m.text).join("\n");
  if (!sellerText.trim()) return [];
  const sellerNorm = norm(sellerText);

  let raw: Record<string, unknown>;
  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: process.env.FIELD_INTEL_MODEL ?? process.env.OPERATIVE_MODEL ?? DEFAULT_MODEL,
      max_tokens: 1024,
      system: extractSystemPrompt(lead),
      tools: [EXTRACT_TOOL],
      tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Seller messages from the confirmed conversation:\n\n${sellerOnly(transcript)}`,
        },
      ],
    });
    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") return [];
    raw = block.input as Record<string, unknown>;
  } catch (err) {
    console.warn("[field-intel] extraction call failed:", err);
    return [];
  }

  const items = Array.isArray(raw.terms) ? raw.terms : [];
  const seen = new Set<string>();
  const gated: ExtractedTerm[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const term = typeof o.term === "string" ? o.term.trim() : "";
    const evidenceQuote = typeof o.evidenceQuote === "string" ? o.evidenceQuote.trim() : "";
    const confidence = typeof o.confidence === "number" ? o.confidence : 0;
    const drug = typeof o.drug === "string" && o.drug.trim() ? o.drug.trim() : null;

    if (!term || term.length > 40) continue;
    if (confidence < MIN_CONFIDENCE) continue;
    // PROVENANCE GATE: the evidence must really be in the seller's own words.
    const evNorm = norm(evidenceQuote);
    if (!evNorm || !sellerNorm.includes(evNorm)) continue;

    const dedupKey = norm(term);
    if (!dedupKey || seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    gated.push({ term, evidenceQuote, drug, confidence });
    if (gated.length >= MAX_TERMS) break;
  }
  return gated;
}

// ---- orchestration ----

export interface LearnFromOperationInput {
  operationId: string;
  handle: string;
  lead: LeadSummary;
  transcript: OperationMessage[];
}

/** The full closed loop. Returns the emitted event, or null if nothing was learned
 *  (or anything failed). Safe to call un-awaited / inside a try-catch. */
export async function learnFromConfirmedOperation(
  input: LearnFromOperationInput,
): Promise<FieldIntelEvent | null> {
  const { operationId, handle, lead, transcript } = input;

  const terms = await extractFieldTerms(lead, transcript);
  if (terms.length === 0) return null;

  // Embed + near-duplicate gate + write each survivor.
  const learned: string[] = [];
  for (const t of terms) {
    try {
      const docVec = await embed(t.term, "document");
      const [nearest] = await corpusKnn(docVec, 1);
      if (nearest && nearest.distance < DEDUP_DISTANCE) continue; // already represented
      await addFieldEntry(operationId, t.term, t.drug, t.evidenceQuote, docVec);
      learned.push(t.term);
    } catch (err) {
      console.warn(`[field-intel] failed to learn term "${t.term}":`, err);
    }
  }
  if (learned.length === 0) return null;

  // Re-score pending posts against the now-grown corpus (same path as /api/rescore).
  let rescored = 0;
  let newlyFlagged = 0;
  try {
    const page = await listPosts({
      status: "pending",
      sort: "riskScore",
      order: "DESC",
      limit: RESCORE_LIMIT,
    });
    for (const post of page.items) {
      const wasFlagged = post.flagged;
      const { risk, queryVec } = await scorePost(post.caption);
      const updated: Post = {
        ...post,
        risk,
        riskScore: risk.score,
        flagged: risk.flagged,
        scoredAt: risk.scoredAt,
      };
      await savePost(updated, queryVec);
      rescored++;
      if (!wasFlagged && risk.flagged) newlyFlagged++;
    }
  } catch (err) {
    console.warn("[field-intel] re-score pass failed:", err);
  }

  const at = new Date().toISOString();
  let id = "";
  try {
    id = await appendFieldIntelEvent({ at, operationId, handle, terms: learned, rescored, newlyFlagged });
  } catch (err) {
    console.warn("[field-intel] failed to append ticker event:", err);
  }
  return { id, at, operationId, handle, terms: learned, rescored, newlyFlagged };
}

// ---- stream ticker ----

/** Append one learning event to the field-intel stream (trimmed MAXLEN ~). */
export async function appendFieldIntelEvent(e: Omit<FieldIntelEvent, "id">): Promise<string> {
  const client = await connectRedis();
  return client.xAdd(
    FIELD_INTEL_STREAM,
    "*",
    {
      at: e.at,
      operationId: e.operationId,
      handle: e.handle,
      termsJson: JSON.stringify(e.terms),
      rescored: String(e.rescored),
      newlyFlagged: String(e.newlyFlagged),
    },
    { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: STREAM_MAXLEN } },
  );
}

/** Read the most recent field-intel events (newest first) for the live ticker. */
export async function getFieldIntelEvents(limit = 20): Promise<FieldIntelEvent[]> {
  const client = await connectRedis();
  const entries = await client.xRevRange(FIELD_INTEL_STREAM, "+", "-", { COUNT: limit });
  return entries.map((entry) => {
    const m = entry.message;
    let terms: string[] = [];
    try {
      const parsed = JSON.parse(m.termsJson ?? "[]");
      if (Array.isArray(parsed)) terms = parsed.filter((t): t is string => typeof t === "string");
    } catch {
      /* tolerate a corrupt entry */
    }
    return {
      id: entry.id,
      at: m.at ?? "",
      operationId: m.operationId ?? "",
      handle: m.handle ?? "",
      terms,
      rescored: Number.parseInt(m.rescored ?? "0", 10) || 0,
      newlyFlagged: Number.parseInt(m.newlyFlagged ?? "0", 10) || 0,
    };
  });
}
