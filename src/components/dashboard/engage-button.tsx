"use client";

// Launches an operative against a flagged lead. Contact is gated by the operative
// allowlist (demo accounts we control). The button stays CLICKABLE so it's never a
// dead control: if a handle isn't allowed, clicking explains exactly why and how to
// fix it. The server enforces the same allowlist on POST (defense in depth).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, TargetIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { startOperation, useOperativeConfig } from "@/lib/api-client";
import { normalizeHandle } from "@/lib/operative-allowlist";
import { cn } from "@/lib/utils";
import type { Post } from "@/lib/types";

export function EngageButton({
  post,
  onEngaged,
}: {
  post: Post;
  // When provided (Command Center), the operative launches INLINE — we hand the caller
  // the new operation id instead of navigating to the full-page war room.
  onEngaged?: (operationId: string, post: Post) => void;
}) {
  const router = useRouter();
  const { data: cfg } = useOperativeConfig();
  const [busy, setBusy] = useState(false);

  const handle = normalizeHandle(post.username);
  // Optimistic until config loads; the real gate is re-checked on click + server-side.
  const gated = Boolean(cfg && cfg.enforced && !cfg.allowlist.includes(handle));

  async function handleEngage() {
    // Client-side guard with an actionable message (the server enforces this too).
    if (cfg && cfg.enforced && !cfg.allowlist.includes(handle)) {
      toast.error(`@${handle} isn't on the operative allowlist`, {
        description: cfg.allowlist.length
          ? `Engageable demo accounts: ${cfg.allowlist.map((h) => `@${h}`).join(", ")}.`
          : "Set OPERATIVE_TARGET_ALLOWLIST to the demo accounts you control, then restart the dev server. The post you engage must be authored by one of them.",
      });
      return;
    }

    setBusy(true);
    try {
      const res = await startOperation(post.id);
      toast.success(`Operative engaging @${handle}`);
      if (onEngaged) {
        onEngaged(res.operationId, post);
        setBusy(false); // inline: the component stays mounted, so clear the spinner
      } else {
        router.push(`/operations/${res.operationId}`); // navigation unmounts this button
      }
    } catch (err) {
      // postJson surfaces the server's error message (missing key, no contexts, etc.).
      toast.error("Couldn't start the operative", {
        description: err instanceof Error ? err.message : "Check the dev-server logs.",
      });
      setBusy(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleEngage}
      disabled={busy}
      className={cn(gated && "opacity-60")}
      title={gated ? `@${handle} isn't on the operative allowlist — click to see why.` : undefined}
    >
      {busy ? (
        <Loader2Icon className="animate-spin" aria-hidden="true" />
      ) : (
        <TargetIcon aria-hidden="true" />
      )}
      {busy ? "Starting…" : "Engage"}
    </Button>
  );
}
