// Risk scoring — pure functions, no I/O. Importable by the UI (band labels) and
// the API (server scoring). This REPLACES the brief's `distance*0.6 - 0.5`
// formula (mathematically inconsistent with a 0.7 cosine threshold).
//
//   rawCosine = 1 - cosineDistance                                   // KNN top-1
//   s = clamp01((rawCosine - SIM_FLOOR) / (1 - SIM_FLOOR))
//   h = min(HEURISTIC_CAP, Σ weightᵢ)
//   score = clamp01(W_SEM * s + (1 - W_SEM) * (h / HEURISTIC_CAP))
//   flagged = score >= THRESHOLD
//
// Semantics lead; heuristics corroborate. Heuristics alone max ≈0.20 — enough to
// tip a borderline post over the line, never enough to flag a semantically-clean one.
import { MODEL_VERSION } from "./model";
import type { HeuristicHit, RiskBand, RiskBreakdown } from "./types";

export const SCORING = {
  W_SEM: 0.8,
  SIM_FLOOR: 0.3,
  HEURISTIC_CAP: 0.25,
  THRESHOLD: clampNumber(Number(process.env.RISK_THRESHOLD ?? 0.7), 0, 1, 0.7),
  HIGH_BAND: 0.85,
} as const;

// --- explainable heuristic lexicons (short, editable; each hit carries a human label) ---

const KEYWORDS: Array<[term: string, label: string, weight: number]> = [
  ["m30", "Coded term: counterfeit oxy/fentanyl (M30)", 0.12],
  ["blues", "Coded term: blue M30 pills", 0.1],
  ["perc", "Coded term: Percocet", 0.1],
  ["percs", "Coded term: Percocet", 0.1],
  ["oxy", "Coded term: oxycodone", 0.08],
  ["xan", "Coded term: Xanax", 0.08],
  ["xans", "Coded term: Xanax", 0.08],
  ["bars", "Coded term: Xanax bars", 0.08],
  ["molly", "Coded term: MDMA", 0.08],
  ["addy", "Coded term: Adderall", 0.08],
  ["plug", "Slang: supplier/dealer ('plug')", 0.1],
  ["pressed", "Slang: pressed pills", 0.08],
  ["loud", "Slang: high-grade cannabis", 0.06],
  ["zaza", "Slang: high-grade cannabis", 0.06],
  ["cart", "Slang: vape cartridge", 0.05],
  ["carts", "Slang: vape cartridges", 0.05],
  ["hmu", "Contact solicitation ('hit me up')", 0.06],
  ["menu", "Menu / price-list cue", 0.08],
  ["restock", "Inventory cue ('restock')", 0.06],
  ["restockd", "Inventory cue ('restockd')", 0.06],
  ["tap in", "Order solicitation ('tap in')", 0.06],
];

const EMOJIS: Array<[emoji: string, label: string, weight: number]> = [
  ["🍃", "Emoji code: cannabis (leaf)", 0.06],
  ["💊", "Emoji code: pills", 0.08],
  ["❄️", "Emoji code: cocaine (snow)", 0.08],
  ["🔌", "Emoji code: dealer / 'plug'", 0.08],
  ["🐉", "Emoji code: high-potency", 0.06],
  ["🍫", "Emoji code: edibles", 0.05],
  ["🚀", "Emoji code: potent product", 0.05],
];

// substring match on lowercased text -> the encrypted/off-platform handoff app
const HANDOFFS: Array<[needle: string, app: string, weight: number]> = [
  ["telegram", "telegram", 0.12],
  ["t.me/", "telegram", 0.12],
  ["signal", "signal", 0.12],
  ["whatsapp", "whatsapp", 0.1],
  ["wa.me/", "whatsapp", 0.1],
  ["wickr", "wickr", 0.12],
  ["kik", "kik", 0.08],
  ["snapchat", "snapchat", 0.07],
  ["snap me", "snapchat", 0.08],
  ["dm me", "dm", 0.07],
];

const PAYMENT: Array<[pattern: RegExp, label: string, weight: number]> = [
  [/\bcash\s?app\b/i, "CashApp", 0.08],
  [/\bzelle\b/i, "Zelle", 0.08],
  [/\bvenmo\b/i, "Venmo", 0.07],
  [/\$\d/, "Priced offer ($)", 0.06],
  [/\bbtc\b|bitcoin/i, "Crypto", 0.07],
];

/** Pure, synchronous lexicon scan. Returns every heuristic that fired. */
export function detectHeuristics(caption: string): HeuristicHit[] {
  const lower = caption.toLowerCase();
  const hits: HeuristicHit[] = [];

  for (const [term, label, weight] of KEYWORDS) {
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    if (re.test(caption)) hits.push({ kind: "keyword", term, label, weight });
  }
  for (const [emoji, label, weight] of EMOJIS) {
    if (caption.includes(emoji)) hits.push({ kind: "emoji", term: emoji, label, weight });
  }
  for (const [needle, app, weight] of HANDOFFS) {
    if (lower.includes(needle)) {
      hits.push({ kind: "handoff", term: app, label: `Off-platform handoff: ${app}`, weight });
    }
  }
  for (const [pattern, label, weight] of PAYMENT) {
    if (pattern.test(caption)) hits.push({ kind: "payment", term: label, label: `Payment cue: ${label}`, weight });
  }
  return hits;
}

/** Blend the semantic similarity with the heuristic booster into a RiskBreakdown. */
export function computeRisk(input: {
  rawCosine: number;
  hits: HeuristicHit[];
  matchedTermId: string | null;
  matchedTermText: string | null;
}): RiskBreakdown {
  const { rawCosine, hits, matchedTermId, matchedTermText } = input;
  const s = clamp01((rawCosine - SCORING.SIM_FLOOR) / (1 - SCORING.SIM_FLOOR));
  const rawBoost = hits.reduce((acc, h) => acc + h.weight, 0);
  const boost = Math.min(SCORING.HEURISTIC_CAP, rawBoost);
  const boostNorm = SCORING.HEURISTIC_CAP > 0 ? boost / SCORING.HEURISTIC_CAP : 0;
  const score = clamp01(SCORING.W_SEM * s + (1 - SCORING.W_SEM) * boostNorm);

  const detectedCodeWords = uniq(
    hits.filter((h) => h.kind !== "payment").map((h) => h.term),
  );

  return {
    semantic: round(s),
    rawCosine: round(rawCosine),
    heuristicBoost: round(boost),
    score: round(score),
    flagged: score >= SCORING.THRESHOLD,
    threshold: SCORING.THRESHOLD,
    matchedTermId,
    matchedTermText,
    hits,
    detectedCodeWords,
    scoredAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
  };
}

export function riskBand(score: number): RiskBand {
  if (score >= SCORING.HIGH_BAND) return "high";
  if (score >= SCORING.THRESHOLD) return "elevated";
  return "low";
}

// --- helpers ---

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampNumber(n: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function uniq(items: string[]): string[] {
  return [...new Set(items)];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
