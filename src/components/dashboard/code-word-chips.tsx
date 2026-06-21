import { Badge } from "@/components/ui/badge";

// Small mono chips of the deduped detected code words (risk.detectedCodeWords).
// Caps the visible count so a noisy caption can't blow out the table row.
export function CodeWordChips({
  terms,
  max = 4,
}: {
  terms: string[];
  max?: number;
}) {
  if (terms.length === 0) return null;
  const shown = terms.slice(0, max);
  const extra = terms.length - shown.length;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {shown.map((term) => (
        <Badge key={term} variant="secondary" className="font-mono text-[10px] font-normal">
          {term}
        </Badge>
      ))}
      {extra > 0 ? (
        <Badge variant="outline" className="font-mono text-[10px] font-normal text-muted-foreground">
          +{extra}
        </Badge>
      ) : null}
    </div>
  );
}
