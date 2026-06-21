import { AgentTile } from "./agent-tile";
import type { AgentRecord } from "@/lib/types";

export function AgentGrid({ agents }: { agents: AgentRecord[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {agents.map((agent) => (
        <AgentTile key={agent.idx} agent={agent} />
      ))}
    </div>
  );
}
