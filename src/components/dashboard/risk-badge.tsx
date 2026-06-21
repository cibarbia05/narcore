import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { riskBand } from "@/lib/scoring";
import type { RiskBand } from "@/lib/types";

// Band -> token-based styling. Severity is intentionally independent of the brand
// accent: high uses destructive (red = urgent), elevated uses amber (chart-2 =
// caution), low recedes into muted. The azure brand accent is reserved for trust/UI
// signals, never severity. Color is never the only signal — the score and an
// sr-only band label are always present.
const BAND: Record<RiskBand, { className: string; label: string }> = {
  high: { className: "border-destructive/30 bg-destructive/15 text-destructive", label: "High" },
  elevated: { className: "border-chart-2/30 bg-chart-2/15 text-chart-2", label: "Elevated" },
  low: { className: "border-transparent bg-muted text-muted-foreground", label: "Low" },
};

export function RiskBadge({ score }: { score: number }) {
  const band = riskBand(score);
  const { className, label } = BAND[band];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-mono tabular-nums", className)}
      title={`${label} risk`}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      <span className="sr-only">{label} risk: </span>
      {score.toFixed(0)}
    </Badge>
  );
}
