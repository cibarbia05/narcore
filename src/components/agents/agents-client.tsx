"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PlayIcon, SquareIcon, RadioIcon } from "lucide-react";
import {
  buildPostsQuery,
  startRun,
  stopRun,
  useRun,
  usePosts,
  type PostsFilter,
} from "@/lib/api-client";
import { AGENT_TERMINAL_STATUSES, type AgentRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RiskBadge } from "@/components/dashboard/risk-badge";
import { AgentGrid } from "./agent-grid";
import { EmbeddingHealthBadge } from "./embedding-health-badge";

// "Latest leads" must mean *flagged* posts — not every scraped post. Filter to
// flagged so benign captures never show up under a "leads" heading.
const IG_LEADS_FILTER: PostsFilter = {
  status: "all",
  flagged: "true",
  platform: "instagram",
  q: "",
  sort: "riskScore",
  order: "desc",
};

function EmptyGrid() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-20 text-center">
      <RadioIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">No agents running</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Launch a fleet to watch each cloud browser scan Instagram for coded drug
          advertising in real time. Leads flow straight into the detection queue.
        </p>
      </div>
    </div>
  );
}

export function AgentsClient() {
  const [runId, setRunId] = useState<string | null>(null);
  const [seedAgents, setSeedAgents] = useState<AgentRecord[]>([]);
  const [agentCount, setAgentCount] = useState(5);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const { data } = useRun(runId);
  const run = data?.run;
  // Render the live-view tiles immediately from the launch response, then prefer
  // the polled state once it arrives.
  const agents = run?.agents.length ? run.agents : seedAgents;

  const leadsQuery = useMemo(() => buildPostsQuery(IG_LEADS_FILTER), []);
  const { data: leads } = usePosts(leadsQuery);
  const recentLeads = leads?.items.slice(0, 6) ?? [];

  const running = runId !== null && (run ? run.status === "running" : true);
  // Once the run is no longer running, freeze the tiles so a session torn down
  // mid-extract can never flash the dead "Reconnect DevTools" iframe.
  const frozen = run ? run.status !== "running" : false;
  const workingCount = running
    ? agents.filter((a) => !AGENT_TERMINAL_STATUSES.includes(a.status)).length
    : 0;
  // Scanned = every post the fleet ingested; leads = only the flagged ones. These
  // are different numbers on purpose — most scraped posts are benign.
  const totalScanned = agents.reduce((sum, a) => sum + a.postsFound, 0);
  const totalLeads = agents.reduce((sum, a) => sum + a.flaggedFound, 0);

  async function handleLaunch() {
    setStarting(true);
    try {
      const res = await startRun({ agentCount });
      setSeedAgents(res.agents);
      setRunId(res.runId);
      toast.success(`Launched ${res.agents.length} agents on Instagram`);
    } catch {
      toast.error("Couldn't launch agents", {
        description: "Check BROWSERBASE_CONTEXT_IDS and keys — run `pnpm ig:login` first.",
      });
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    if (!runId) return;
    setStopping(true);
    try {
      await stopRun(runId);
      toast.success("Stopping agents…");
    } catch {
      toast.error("Couldn't stop the run. Try again.");
    } finally {
      setStopping(false);
    }
  }

  return (
    <main className="mx-auto max-w-[100rem] space-y-6 px-6 py-10">
      <header className="space-y-4">
        <div className="space-y-1">
          <p className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Narcore · Fleet
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Parallel surveillance at scale
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Many Browserbase cloud browsers scan Instagram hashtags in parallel. Watch each one
            work, then review the flagged leads in the{" "}
            <Link href="/command" className="underline underline-offset-2 hover:text-foreground">
              Command Center
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {running ? (
            <Button onClick={handleStop} disabled={stopping} variant="outline" size="sm">
              <SquareIcon aria-hidden="true" />
              {stopping ? "Stopping…" : "Stop agents"}
            </Button>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                Agents
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={agentCount}
                  spellCheck={false}
                  onChange={(e) =>
                    setAgentCount(Math.min(20, Math.max(1, Number(e.target.value) || 1)))
                  }
                  className="h-8 w-16"
                  aria-label="Number of agents to launch"
                />
              </label>
              <Button onClick={handleLaunch} disabled={starting} size="sm">
                <PlayIcon aria-hidden="true" />
                {starting ? "Launching…" : `Launch ${agentCount} agents`}
              </Button>
            </>
          )}

          <p className="ml-auto text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {agents.length > 0
              ? `${workingCount} working · ${totalScanned} scanned · ${totalLeads} flagged`
              : "Idle"}
          </p>
        </div>
      </header>

      <EmbeddingHealthBadge />

      <section aria-label="Live agents">
        {agents.length === 0 ? <EmptyGrid /> : <AgentGrid agents={agents} frozen={frozen} />}
      </section>

      {recentLeads.length > 0 ? (
        <section aria-label="Recent Instagram leads" className="space-y-2">
          <h2 className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
            Latest leads
          </h2>
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
            {recentLeads.map((post) => (
              <li key={post.id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                <span className="shrink-0 font-mono text-xs">{post.username}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {post.caption}
                </span>
                <RiskBadge score={post.riskScore} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
