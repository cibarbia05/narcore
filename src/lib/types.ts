// Narcore shared domain types — the frozen contract.
//
// This file has ZERO runtime imports. It is the dependency root: every other
// module imports from it and it imports from nothing. Keep it that way so the
// UI, API, scraper, and scripts all agree on one set of shapes.

// ----- Enums (string unions; serializable, no TS `enum`) -----

export const PLATFORMS = [
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "telegram",
  "snapchat",
  "unknown",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** Provenance of a corpus vector:
 *  - "seed":     an original DEA/SAMHSA seed term.
 *  - "approved": a human-confirmed post caption (the analyst learning loop).
 *  - "field":    coded slang a confirmed undercover operation extracted from the
 *                seller's own messages (the operative→detection closed loop, R1). */
export const CORPUS_SOURCES = ["seed", "approved", "field"] as const;
export type CorpusSource = (typeof CORPUS_SOURCES)[number];

export type HeuristicKind = "keyword" | "emoji" | "handoff" | "payment";
export type RiskBand = "low" | "elevated" | "high";

// ----- Risk -----

/** One explainable heuristic match — shown to a human and used in the lead summary. */
export interface HeuristicHit {
  kind: HeuristicKind;
  term: string; // the matched token, e.g. "perc", "🍃", "telegram"
  label: string; // human label, e.g. "Coded term: Percocet"
  weight: number; // pre-cap contribution to the heuristic booster, >= 0
}

/** Fully explainable score. Stored alongside the post and shown in the UI / lead summary. */
export interface RiskBreakdown {
  semantic: number; // s in [0,1] — normalized max cosine similarity to the corpus
  rawCosine: number; // raw max cosine in [-1,1] before normalization (transparency)
  heuristicBoost: number; // h in [0,1] — capped sum of heuristic hits
  score: number; // final risk in [1,100]
  flagged: boolean; // score >= threshold
  threshold: number; // threshold used (snapshot, so old scores stay interpretable)
  matchedTermId: string | null; // corpus entry id of the nearest neighbor (the "why")
  matchedTermText: string | null; // its term/caption text
  hits: HeuristicHit[]; // every heuristic that fired
  detectedCodeWords: string[]; // deduped term list for the lead summary
  scoredAt: string; // ISO timestamp
  modelVersion: string; // e.g. "nomic-embed-text-v2-moe@768" — invalidate on model change
}

// ----- Post -----

/** Exactly what the Browserbase scraper produces. Mirrors the brief's field names. */
export interface ScrapedPost {
  agent_id: number; // which scraper agent found it
  post_link: string; // canonical URL — also the dedup key
  post_username: string;
  post_caption: string;
  post_date: string; // ISO 8601, UTC
  platform?: Platform; // optional; ingest infers from post_link if absent
}

/** The stored, scored post. `id` is derived deterministically from post_link. */
export interface Post {
  id: string; // sha1(post_link) hex — stable, dedup-friendly
  agentId: number;
  postLink: string;
  username: string;
  caption: string;
  platform: Platform;
  postDate: string; // ISO — when it was posted
  ingestedAt: string; // ISO — when we first stored it
  scoredAt: string; // ISO — when risk was last computed
  risk: RiskBreakdown;
  riskScore: number; // denormalized from risk.score for sort/index
  flagged: boolean; // denormalized from risk.flagged for filter
  approvalStatus: ApprovalStatus;
  approvedAt: string | null; // ISO when a human approved (drives the learning loop)
  corpusEntryId: string | null; // if approved -> the corpus vector id we created
}

// ----- Parallel browser agents ("War Room") -----

/** Lifecycle of one live Instagram agent. Drives the tile's status badge.
 *  - starting:   session created, Stagehand attaching
 *  - loading:    navigating to the target hashtag
 *  - browsing:   scrolling the feed
 *  - extracting: pulling posts from the rendered page
 *  - ingesting:  POSTing extracted posts to /api/ingest
 *  - captcha:    a CAPTCHA/checkpoint appeared (human can take over the live view)
 *  - blocked:    a login wall / rate limit stopped the agent
 *  - done:       finished its post budget cleanly
 *  - error:      unexpected failure (see `error`)
 *  - stopped:    aborted by the operator */
export const AGENT_STATUSES = [
  "starting",
  "loading",
  "browsing",
  "extracting",
  "ingesting",
  "captcha",
  "blocked",
  "done",
  "error",
  "stopped",
] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

/** Terminal states — the agent loop has ended and its session is released. */
export const AGENT_TERMINAL_STATUSES: readonly AgentStatus[] = [
  "done",
  "blocked",
  "error",
  "stopped",
];

export const RUN_STATUSES = ["running", "done", "stopped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** One agent's live, pollable state. Each agent owns its own Redis hash so the
 *  five parallel loops never race on a shared record. */
export interface AgentRecord {
  idx: number; // 1-based agent number within the run
  name: string; // display name, e.g. "Agent 1"
  target: string; // the Instagram hashtag it browses (no leading '#')
  sessionId: string; // Browserbase session id
  liveViewUrl: string; // debuggerFullscreenUrl — embedded read-only in the UI
  status: AgentStatus;
  currentAction: string; // human-readable "what it's doing right now"
  postsFound: number; // distinct posts scanned/ingested so far
  flaggedFound: number; // of those, how many the detector flagged (the real leads)
  lastCaption: string | null; // most recent caption (a heartbeat for the UI)
  error: string | null;
  updatedAt: string; // ISO
}

/** A run = the 5 agents launched together. */
export interface AgentRun {
  id: string;
  status: RunStatus;
  startedAt: string; // ISO
  agentCount: number;
  agents: AgentRecord[];
}

/** POST /api/agents/run response — returned immediately so the grid can render
 *  the live-view iframes before any agent has finished. */
export interface StartRunResponse {
  runId: string;
  agents: AgentRecord[];
}

// ----- Suspicious corpus -----

/** A seed slang entry as authored in the JSON dataset. */
export interface SuspiciousTerm {
  term: string; // e.g. "M30"
  category: string; // e.g. "opioid", "stimulant", "cannabis", "handoff", "general"
  drug: string; // canonical drug, e.g. "counterfeit oxycodone / fentanyl"
  aliases?: string[]; // extra surface forms embedded together
  note?: string; // human gloss for the lead summary
}

export interface SeedDataset {
  version: string;
  source: string;
  terms: SuspiciousTerm[];
}

/** A vector entry living in Redis — either a seed term or a learned (approved) caption.
 *  The float32 vector is stored in the same hash under field `vector`, but is never
 *  part of this TS shape — we never ship vectors to the client. */
export interface CorpusEntry {
  id: string;
  source: CorpusSource;
  text: string; // the embedded text (term+aliases+note for seeds, caption for approved)
  category: string; // seed category, or "learned" for approved
  drug: string | null;
  note: string | null;
  postDate: string | null; // for approved entries: the source post's date
  sourcePostId: string | null; // for approved entries: which post produced this
  createdAt: string; // ISO
  lastUsed: string; // ISO — refreshed on every KNN match; drives eviction
}

export interface CorpusStats {
  size: number;
  seed: number;
  approved: number;
  field: number; // learned from confirmed operations (R1 field-intel loop)
}

// ----- Field intelligence (operative → detection closed loop, R1) -----

/** One "the operative taught the detector" event, surfaced as a live ticker.
 *  Persisted as an entry in the `stream:field-intel` Redis Stream. */
export interface FieldIntelEvent {
  id: string; // Redis stream entry id (monotonic)
  at: string; // ISO
  operationId: string;
  handle: string; // seller handle the intel came from (no leading '@')
  terms: string[]; // coded slang promoted into the corpus this operation
  rescored: number; // pending posts re-scored against the grown corpus
  newlyFlagged: number; // pending posts that flipped to flagged after re-scoring
}

export interface FieldIntelResponse {
  events: FieldIntelEvent[];
}

// ----- Semantic drift visualization -----

export type SemanticPointKind = CorpusSource | "post";

export interface SemanticDriftPoint {
  id: string;
  kind: SemanticPointKind;
  label: string;
  text: string;
  category: string;
  drug: string | null;
  x: number;
  y: number;
  riskScore: number | null;
  flagged: boolean | null;
}

export interface SemanticDriftResponse {
  points: SemanticDriftPoint[];
  stats: {
    seed: number;
    approved: number;
    posts: number;
  };
  embeddingLive: boolean; // true => real provider vectors (structure is meaningful)
  generatedAt: string;
}

/** One real cosine-KNN corpus match for a post (the "why" edges on the map). */
export interface SemanticNeighbor {
  id: string; // corpus point id — matches a point on the map
  text: string;
  drug: string | null;
  source: CorpusSource;
  cosine: number; // cosine similarity in [-1,1]; higher = closer
}

/** GET /api/semantic-drift/neighbors?id=<postId> — neighbors + the post's risk split. */
export interface SemanticNeighborsResponse {
  neighbors: SemanticNeighbor[];
  risk: RiskBreakdown;
}

// ----- Outreach / lead summary -----

export interface LeadSummary {
  postId: string;
  generatedAt: string; // ISO
  handle: string; // @username
  platform: Platform;
  postLink: string;
  postDate: string;
  riskScore: number;
  riskBand: RiskBand;
  detectedCodeWords: string[];
  matchedKnownTerm: string | null; // nearest corpus term text
  matchedKnownTermDrug: string | null;
  handoffApps: string[]; // encrypted-app handoffs detected, e.g. ["telegram"]
  paymentCues: string[]; // e.g. ["CashApp"]
  rationale: string; // one-paragraph "why flagged", built from hits
  narrative: string; // longer LE-facing summary (template default; optional LLM enrich)
}

export interface DraftedOutreach {
  to: string;
  subject: string;
  body: string;
  channel: "email" | "platform_report";
}

// ----- Operative agent (undercover DM negotiation) -----

/** Lifecycle of one operative negotiation. Drives the operation view's status.
 *  - opening:        attaching, opening the DM thread, sending the first message
 *  - awaiting_reply: message sent, polling the thread for the seller's response
 *  - analyzing:      a reply arrived; the brain is assessing deal/location
 *  - negotiating:    mid-conversation, working toward both confirmations
 *  - confirmed:      deal AND location confirmed (success, terminal)
 *  - rejected:       the seller declined / went cold-hostile (terminal)
 *  - stalled:        hit the turn or time budget without both confirmations (terminal)
 *  - blocked:        login wall / checkpoint stopped the operative (terminal)
 *  - error:          unexpected failure (terminal)
 *  - stopped:        aborted by the operator (terminal) */
export const OPERATION_STATUSES = [
  "opening",
  "awaiting_reply",
  "analyzing",
  "negotiating",
  "confirmed",
  "rejected",
  "stalled",
  "blocked",
  "error",
  "stopped",
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/** Terminal states — the operative loop has ended and its session is released. */
export const OPERATION_TERMINAL_STATUSES: readonly OperationStatus[] = [
  "confirmed",
  "rejected",
  "stalled",
  "blocked",
  "error",
  "stopped",
];

/** One turn in the negotiation transcript. */
export interface OperationMessage {
  role: "operative" | "seller";
  text: string;
  at: string; // ISO
}

/** The brain's structured read of the conversation after a seller reply. Computed
 *  fresh each turn so the UI can show "Deal ✓ · Location ✗" while still mid-talk. */
export interface OperationAnalysis {
  dealConfirmed: boolean; // seller agreed to sell + transact
  locationConfirmed: boolean; // seller named/agreed a meeting place
  meetingLocation: string | null; // the agreed place, if any
  meetingTime: string | null; // the agreed time, if any
  rejection: boolean; // seller declined / the lead is dead
  confidence: number; // 0..1 — the brain's confidence in this read
  reasoning: string; // one-line "why" for the operator
}

/** Live, pollable state of one operative negotiation. Owns its own Redis hash +
 *  an append-only message list. */
export interface Operation {
  id: string;
  postId: string; // the flagged lead this came from
  handle: string; // seller handle being engaged (no leading '@')
  platform: Platform;
  sessionId: string; // Browserbase session id
  liveViewUrl: string; // debuggerFullscreenUrl — embedded read-only in the UI
  status: OperationStatus;
  currentAction: string; // human-readable "what it's doing right now"
  dealConfirmed: boolean;
  locationConfirmed: boolean;
  meetingLocation: string | null;
  meetingTime: string | null;
  turnCount: number; // operative messages sent so far
  messages: OperationMessage[]; // full transcript, oldest first
  priorIntel: string[]; // recalled cross-operation memory that primed this op (R2)
  error: string | null;
  startedAt: string; // ISO
  updatedAt: string; // ISO
}

/** POST /api/operations response — returned immediately so the view can render the
 *  live-view iframe before the negotiation has progressed. */
export interface StartOperationResponse {
  operationId: string;
  operation: Operation;
}

/** GET /api/operations response — the target allowlist + whether it's enforced, so
 *  the dashboard can gate the "Engage" action client-side (server still enforces). */
export interface OperativeConfigResponse {
  allowlist: string[]; // normalized demo-adversary handles the operative may contact
  enforced: boolean;
}

// ----- Agent memory (R2 — Redis Iris cross-operation memory) -----

/** One long-term memory the operative learned from a confirmed operation. */
export interface AgentMemoryItem {
  id: string;
  text: string;
  similarity: number | null; // recall similarity 0..1, when from a search
  topics: string[];
  entities: string[];
}

export interface AgentMemoryListResponse {
  memories: AgentMemoryItem[];
  available: boolean; // false if the memory server is unreachable
}

// ----- Browser session identity (B2 — consistent fingerprint = fewer checkpoints) -----

/** The env-derived browser fingerprint a Browserbase session is created with. Login
 *  and every automated run pass through one chokepoint (createIgSession), so they
 *  share this by construction. `os` is null when unpinned (Browserbase default). */
export interface SessionIdentity {
  os: string | null;
  verified: boolean;
  advancedStealth: boolean;
  viewport: { width: number; height: number };
  proxyCountry: string;
  region: string;
}

export type IdentityMatch = "ok" | "mismatch" | "unknown";

/** Per-context comparison of the identity recorded at login vs. the current env. */
export interface ContextIdentityStatus {
  id: string; // masked context id
  persisted: SessionIdentity | null; // identity recorded at `pnpm ig:login`
  match: IdentityMatch;
  diffs: string[]; // field names that differ when mismatched
}

export interface SessionIdentityResponse {
  current: SessionIdentity;
  contexts: ContextIdentityStatus[];
}

// ----- API envelopes -----

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface IngestResponse {
  post: Post;
  deduped: boolean;
}

export interface HealthResponse {
  ok: boolean;
  redis: boolean;
  embeddings: boolean;
  embeddingMode: "auto" | "mock" | "live"; // configured EMBEDDING_MODE
  embeddingLive: boolean; // a real provider is serving (vs deterministic mock vectors)
  corpusSize: number;
  postCount: number;
  modelVersion: string;
}
