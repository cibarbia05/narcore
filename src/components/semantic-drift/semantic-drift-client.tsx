"use client";

import { RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  SemanticDriftPoint,
  SemanticDriftResponse,
  SemanticPointKind,
} from "@/lib/types";

const POINT_STYLE: Record<
  SemanticPointKind,
  { color: string; label: string; radius: number }
> = {
  approved: { color: "#f97316", label: "Learned", radius: 5.5 },
  post: { color: "#a3e635", label: "Posts", radius: 4.25 },
  seed: { color: "#38bdf8", label: "Seed", radius: 4.75 },
};

const VIEWBOX_SIZE = 720;
const VIEWBOX_CENTER = VIEWBOX_SIZE / 2;
const PLOT_RADIUS = 292;

async function fetcher(url: string): Promise<SemanticDriftResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<SemanticDriftResponse>;
}

export function SemanticDriftClient() {
  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<SemanticDriftResponse>("/api/semantic-drift", fetcher, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });
  const [activeId, setActiveId] = useState<string | null>(null);

  const points = useMemo(() => data?.points ?? [], [data]);
  const activePoint = useMemo(
    () => points.find((point) => point.id === activeId) ?? points[0] ?? null,
    [activeId, points],
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
            <SparklesIcon aria-hidden="true" className="size-3.5 text-primary" />
            Redis Vector Space
          </div>
          <h1 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance">
            Semantic Drift
          </h1>
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

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="relative min-h-[min(78vh,780px)] overflow-hidden rounded-lg border border-border bg-card">
          <VectorField
            activeId={activePoint?.id ?? null}
            points={points}
            onActivate={setActiveId}
          />
          {isLoading ? (
            <div className="absolute inset-0 grid place-items-center bg-background/50 text-sm text-muted-foreground backdrop-blur-sm">
              Loading…
            </div>
          ) : null}
          {error ? (
            <div className="absolute inset-0 grid place-items-center bg-background/80 px-6 text-center">
              <div className="max-w-sm space-y-3">
                <p className="text-sm font-medium">Vector snapshot unavailable</p>
                <p className="text-sm text-muted-foreground">
                  {error instanceof Error ? error.message : "Could not load vectors."}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <StatsPanel data={data ?? null} />
          <PointPanel point={activePoint} />
          <Legend />
        </aside>
      </section>
    </main>
  );
}

function VectorField({
  activeId,
  points,
  onActivate,
}: {
  activeId: string | null;
  points: SemanticDriftPoint[];
  onActivate: (id: string) => void;
}) {
  return (
    <svg
      aria-label="Semantic drift vector map"
      className="h-full min-h-[min(78vh,780px)] w-full"
      role="img"
      viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
    >
      <defs>
        <radialGradient id="fieldGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </radialGradient>
        <filter id="pointGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} fill="var(--card)" />
      <circle cx={VIEWBOX_CENTER} cy={VIEWBOX_CENTER} r="315" fill="url(#fieldGlow)" />
      {[90, 170, 250, 330].map((radius) => (
        <circle
          key={radius}
          cx={VIEWBOX_CENTER}
          cy={VIEWBOX_CENTER}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeDasharray="4 10"
        />
      ))}
      <path
        d={`M ${VIEWBOX_CENTER} 44 V ${VIEWBOX_SIZE - 44} M 44 ${VIEWBOX_CENTER} H ${
          VIEWBOX_SIZE - 44
        }`}
        stroke="var(--border)"
        strokeOpacity="0.7"
      />

      {points.map((point, index) => {
        const style = POINT_STYLE[point.kind];
        const cx = VIEWBOX_CENTER + point.x * PLOT_RADIUS;
        const cy = VIEWBOX_CENTER + point.y * PLOT_RADIUS;
        const isActive = point.id === activeId;
        const radius = isActive ? style.radius + 4 : style.radius;
        return (
          <g
            key={point.id}
            aria-label={`${style.label}: ${point.label}`}
            className="cursor-pointer outline-none focus-visible:[&>circle:last-child]:stroke-white"
            onFocus={() => onActivate(point.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onActivate(point.id);
              }
            }}
            onMouseEnter={() => onActivate(point.id)}
            role="button"
            tabIndex={0}
            transform={`translate(${cx} ${cy})`}
          >
            <circle
              className="semantic-drift-pulse"
              r={radius * 2.2}
              fill={style.color}
              opacity={isActive ? 0.2 : 0.06}
              style={{ animationDelay: `${(index % 12) * 140}ms` }}
            />
            <circle
              className="transition-[r,opacity,stroke-width] duration-200"
              r={radius}
              fill={style.color}
              filter="url(#pointGlow)"
              opacity={point.flagged ? 1 : point.kind === "post" ? 0.74 : 0.9}
              stroke={isActive ? "white" : "var(--card)"}
              strokeWidth={isActive ? 2.5 : 1}
            />
          </g>
        );
      })}
    </svg>
  );
}

function StatsPanel({ data }: { data: SemanticDriftResponse | null }) {
  const stats = data?.stats ?? { approved: 0, posts: 0, seed: 0 };
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Vector Cache</h2>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="Seed" value={stats.seed} />
        <Stat label="Posts" value={stats.posts} />
        <Stat label="Learned" value={stats.approved} />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="font-mono text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function PointPanel({ point }: { point: SemanticDriftPoint | null }) {
  if (!point) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Selected Vector</h2>
        <p className="mt-3 text-sm text-muted-foreground">No vectors loaded.</p>
      </section>
    );
  }

  const style = POINT_STYLE[point.kind];
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{point.label}</h2>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{style.label}</p>
        </div>
        <Badge
          variant={point.flagged ? "destructive" : "outline"}
          className="shrink-0"
        >
          {point.kind === "post" && point.riskScore !== null
            ? point.riskScore.toFixed(2)
            : point.category || point.kind}
        </Badge>
      </div>
      <p className="mt-4 max-h-36 overflow-auto break-words text-sm leading-6 text-muted-foreground">
        {point.text}
      </p>
      {point.drug ? (
        <p className="mt-4 text-sm">
          <span className="text-muted-foreground">Drug:</span> {point.drug}
        </p>
      ) : null}
    </section>
  );
}

function Legend() {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Legend</h2>
      <ul className="mt-4 space-y-3 text-sm">
        {(Object.keys(POINT_STYLE) as SemanticPointKind[]).map((kind) => (
          <li key={kind} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full"
              style={{ backgroundColor: POINT_STYLE[kind].color }}
            />
            <span>{POINT_STYLE[kind].label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
