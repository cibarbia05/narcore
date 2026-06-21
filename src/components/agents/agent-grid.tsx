import { AgentTile } from "./agent-tile";
import type { AgentRecord } from "@/lib/types";

// Column count scales with fleet size so a big run fills the screen instead of
// showing a few oversized tiles. Wide breakpoints (xl / 2xl) carry the demo's
// "war room" layout; the smaller ones keep it usable on a laptop.
function columnClasses(n: number): string {
  if (n <= 2) return "grid-cols-1 sm:grid-cols-2";
  if (n <= 4) return "grid-cols-2 lg:grid-cols-4";
  if (n <= 6) return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4";
  if (n <= 9) return "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5";
  if (n <= 12) return "grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";
  if (n <= 16) return "grid-cols-3 sm:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7";
  return "grid-cols-4 sm:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8";
}

export function AgentGrid({ agents, frozen = false }: { agents: AgentRecord[]; frozen?: boolean }) {
  const n = agents.length;
  const dense = n > 8; // compact tiles once the grid gets busy
  return (
    <div className={`grid ${dense ? "gap-2" : "gap-3"} ${columnClasses(n)}`}>
      {agents.map((agent) => (
        <AgentTile key={agent.idx} agent={agent} frozen={frozen} dense={dense} />
      ))}
    </div>
  );
}
