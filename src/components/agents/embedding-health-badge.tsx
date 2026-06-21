"use client";

// Advisory banner: warns when semantic scoring has fallen back to deterministic
// mock vectors (no embedding provider configured/reachable). In that state the
// detector cannot legitimately flag, so "0 flagged" is expected — this makes that
// explicit instead of letting the operator read it as a real-but-empty result.
// Renders nothing when a real embedding provider is serving (the normal case).
import { TriangleAlertIcon } from "lucide-react";

import { useHealth } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function EmbeddingHealthBadge({ className }: { className?: string }) {
  const { data } = useHealth();
  // Only surface a problem; stay silent on the happy path.
  if (!data || data.embeddingLive) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      <TriangleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">Semantic scoring is running on mock embeddings</span>
      <span className="text-destructive/80">
        (mode: <code className="font-mono">{data.embeddingMode}</code>) — no embedding provider is
        reachable, so the detector can&apos;t flag. Expect 0 flagged. Set{" "}
        <code className="font-mono">EMBEDDING_API_URL</code> /{" "}
        <code className="font-mono">NOMIC_API_URL</code> to enable real detection.
      </span>
    </div>
  );
}
