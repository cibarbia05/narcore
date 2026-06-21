"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SCORING } from "@/lib/scoring";
import type { HeuristicHit, Post } from "@/lib/types";
import { CodeWordChips } from "./code-word-chips";
import { RiskBadge } from "./risk-badge";

const HEURISTIC_KIND_LABEL: Record<HeuristicHit["kind"], string> = {
  keyword: "Keyword",
  emoji: "Emoji",
  handoff: "Handoff",
  payment: "Payment",
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function formatScore(score: number): string {
  return score.toFixed(1);
}

// The Caption-column trigger doubles as the row's "open details" affordance: a real
// <button> (keyboard-operable, visible focus ring) styled as truncated caption text.
export function PostDetailDialog({ post }: { post: Post }) {
  const { risk } = post;
  return (
    <Dialog>
      <DialogTrigger className="block max-w-md truncate rounded text-left text-sm text-foreground/90 underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        {post.caption}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{post.username}</span>
            <RiskBadge score={post.riskScore} />
          </DialogTitle>
          <DialogDescription>
            {post.platform} · posted {new Date(post.postDate).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-pretty rounded-md bg-muted/50 p-3 text-sm">{post.caption}</p>

          <div>
            <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Risk breakdown
            </h3>
            <dl className="divide-y divide-border">
              <Metric label="Final score" value={formatScore(risk.score)} />
              <Metric label="Semantic similarity" value={risk.semantic.toFixed(2)} />
              <Metric label="Raw cosine" value={risk.rawCosine.toFixed(2)} />
              <Metric label="Heuristic boost" value={risk.heuristicBoost.toFixed(2)} />
              <Metric label="Flag threshold" value={formatScore(risk.threshold)} />
            </dl>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {risk.flagged
                ? `Flagged — score ≥ ${formatScore(SCORING.THRESHOLD)} threshold.`
                : `Cleared — score below the ${formatScore(SCORING.THRESHOLD)} threshold.`}
            </p>
          </div>

          {risk.matchedTermText ? (
            <div>
              <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Nearest known term
              </h3>
              <p className="font-mono text-sm">{risk.matchedTermText}</p>
            </div>
          ) : null}

          {risk.detectedCodeWords.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Detected code words
              </h3>
              <CodeWordChips terms={risk.detectedCodeWords} max={12} />
            </div>
          ) : null}

          <div>
            <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Heuristic hits
            </h3>
            {risk.hits.length === 0 ? (
              <p className="text-sm text-muted-foreground">No heuristics fired.</p>
            ) : (
              <ul className="space-y-1.5">
                {risk.hits.map((hit, i) => (
                  <li
                    key={`${hit.kind}-${hit.term}-${i}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant="outline" className="shrink-0 font-mono text-[10px] font-normal">
                        {HEURISTIC_KIND_LABEL[hit.kind]}
                      </Badge>
                      <span className="truncate">{hit.label}</span>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      +{hit.weight.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
