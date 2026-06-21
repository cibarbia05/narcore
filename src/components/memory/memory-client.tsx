"use client";

// R2 — the operative's long-term memory browser (/memory). Every confirmed bust is
// pinned here as durable, searchable agent memory (Redis Iris) and recalled to prime
// the next operation. Proof that "it gets smarter every bust."
import { BrainCircuitIcon, RefreshCwIcon } from "lucide-react";

import { useAgentMemory } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { AgentMemoryItem } from "@/lib/types";

function MemoryCard({ memory }: { memory: AgentMemoryItem }) {
  const tags = [...memory.topics, ...memory.entities];
  return (
    <li className="rounded-lg border bg-card px-4 py-3">
      <p className="text-sm text-foreground">{memory.text}</p>
      {tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {tags.map((tag) => (
            <code
              key={tag}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {tag}
            </code>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function MemoryClient() {
  const { data, isLoading, isValidating, mutate } = useAgentMemory();
  const memories = data?.memories ?? [];

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
            <BrainCircuitIcon aria-hidden="true" className="size-3.5 text-primary" />
            Redis Iris · Agent Memory
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Operative memory</h1>
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
            Durable, searchable memory of every confirmed operation — recalled to prime the next
            one. The operative gets sharper each bust.
          </p>
        </div>
        <Button
          variant="outline"
          size="lg"
          className="w-fit"
          onClick={() => void mutate()}
          disabled={isLoading || isValidating}
        >
          <RefreshCwIcon aria-hidden="true" />
          {isLoading || isValidating ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {memories.length === 0 ? (
        <div className="grid place-items-center rounded-lg border border-dashed bg-card/50 px-6 py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading memory…"
              : "No memories yet. Confirm an operation (or run `pnpm seed:memories`) to populate the operative's long-term memory."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {memories.map((memory) => (
            <MemoryCard key={memory.id} memory={memory} />
          ))}
        </ul>
      )}
    </main>
  );
}
