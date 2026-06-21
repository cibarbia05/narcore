"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { outreach } from "@/lib/api-client";
import type { DraftedOutreach, LeadSummary, Post } from "@/lib/types";

type Loaded = { leadSummary: LeadSummary; draft: DraftedOutreach };

function triggerDownload(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Human-readable markdown export of the lead + drafted message. */
function toMarkdown({ leadSummary: s, draft }: Loaded): string {
  return [
    `# Narcore lead — ${s.handle}`,
    "",
    `- **Platform:** ${s.platform}`,
    `- **Risk score:** ${s.riskScore.toFixed(2)} (${s.riskBand})`,
    `- **Post:** ${s.postLink}`,
    `- **Posted:** ${s.postDate}`,
    `- **Detected code words:** ${s.detectedCodeWords.join(", ") || "n/a"}`,
    s.matchedKnownTerm ? `- **Nearest known term:** ${s.matchedKnownTerm}` : "",
    s.handoffApps.length ? `- **Off-platform handoff(s):** ${s.handoffApps.join(", ")}` : "",
    s.paymentCues.length ? `- **Payment cue(s):** ${s.paymentCues.join(", ")}` : "",
    "",
    `## Rationale`,
    "",
    s.rationale,
    "",
    `## Drafted message (${draft.channel})`,
    "",
    `**To:** ${draft.to}`,
    `**Subject:** ${draft.subject}`,
    "",
    draft.body,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs tabular-nums">{value}</span>
    </div>
  );
}

export function OutreachDialog({ post }: { post: Post }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function load() {
    setStatus("loading");
    try {
      const res = await outreach(post.id);
      setData({ leadSummary: res.leadSummary, draft: res.draft });
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && !data && status !== "loading") void load();
  }

  async function handleCopy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(`${data.draft.subject}\n\n${data.draft.body}`);
      toast.success("Draft copied to clipboard");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  function handleSend() {
    toast.success("Outreach queued (simulated)");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Outreach</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Outreach — {post.username}</DialogTitle>
          <DialogDescription>
            Lead summary and a drafted, simulated message for Trust &amp; Safety / law enforcement.
          </DialogDescription>
        </DialogHeader>

        {status === "loading" ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-live="polite">
            <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
            Drafting outreach…
          </p>
        ) : status === "error" ? (
          <div className="flex flex-col items-start gap-3 py-4" aria-live="polite">
            <p className="flex items-center gap-2 text-sm text-destructive">
              <TriangleAlertIcon className="size-4" aria-hidden="true" />
              Couldn&apos;t generate the draft.
            </p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : data ? (
          <div className="space-y-4">
            <section className="space-y-1.5 rounded-md bg-muted/50 p-3">
              <MetaRow label="Handle" value={data.leadSummary.handle} />
              <MetaRow label="Platform" value={data.leadSummary.platform} />
              <MetaRow
                label="Risk"
                value={`${data.leadSummary.riskScore.toFixed(2)} (${data.leadSummary.riskBand})`}
              />
              {data.leadSummary.detectedCodeWords.length > 0 ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {data.leadSummary.detectedCodeWords.map((term) => (
                    <Badge key={term} variant="secondary" className="font-mono text-[10px] font-normal">
                      {term}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <p className="pt-1 text-pretty text-xs text-muted-foreground">
                {data.leadSummary.rationale}
              </p>
            </section>

            <section className="space-y-2">
              <div>
                <span className="text-xs text-muted-foreground">Subject</span>
                <p className="text-sm font-medium">{data.draft.subject}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Body</span>
                <pre className="mt-1 max-h-56 overflow-auto rounded-md bg-muted/50 p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap">
                  {data.draft.body}
                </pre>
              </div>
            </section>
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={handleCopy} disabled={!data}>
              <CopyIcon aria-hidden="true" />
              Copy
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => data && triggerDownload(`lead-${post.id}.md`, toMarkdown(data), "text/markdown")}
              disabled={!data}
            >
              <DownloadIcon aria-hidden="true" />
              .md
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                data &&
                triggerDownload(
                  `lead-${post.id}.txt`,
                  `${data.draft.subject}\n\n${data.draft.body}`,
                  "text/plain",
                )
              }
              disabled={!data}
            >
              <DownloadIcon aria-hidden="true" />
              .txt
            </Button>
          </div>
          <Button size="sm" onClick={handleSend} disabled={!data}>
            <SendIcon aria-hidden="true" />
            Send (simulated)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
