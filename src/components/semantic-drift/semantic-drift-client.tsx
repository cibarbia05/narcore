"use client";

import { RefreshCwIcon, SparklesIcon, ZoomInIcon } from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import useSWR from "swr";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  SemanticDriftPoint,
  SemanticDriftResponse,
  SemanticNeighborsResponse,
  SemanticPointKind,
} from "@/lib/types";

const POINT_STYLE: Record<
  SemanticPointKind,
  { color: string; label: string; radius: number }
> = {
  seed: { color: "#38bdf8", label: "Seed", radius: 4.75 },
  post: { color: "#a3e635", label: "Posts", radius: 4.25 },
  approved: { color: "#f97316", label: "Learned", radius: 5.5 },
  field: { color: "#f43f5e", label: "Field Intel", radius: 5.5 },
};
const KIND_ORDER: SemanticPointKind[] = ["seed", "post", "approved", "field"];

const VIEWBOX_SIZE = 720;
const CENTER = VIEWBOX_SIZE / 2;
const PLOT_RADIUS = 318;
const MIN_SCALE = 0.6;
const MAX_SCALE = 6;

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

export function SemanticDriftClient() {
  const { data, error, isLoading, isValidating, mutate } =
    useSWR<SemanticDriftResponse>("/api/semantic-drift", fetcher, {
      refreshInterval: 5000,
      keepPreviousData: true,
    });

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<SemanticPointKind>>(() => new Set());

  const points = useMemo(() => data?.points ?? [], [data]);
  const visiblePoints = useMemo(
    () => points.filter((p) => !hidden.has(p.kind)),
    [points, hidden],
  );

  // The point whose details fill the inspector: pinned wins, then hovered, then first.
  const activeId = pinnedId ?? hoverId ?? null;
  const activePoint = useMemo(
    () => points.find((p) => p.id === activeId) ?? visiblePoints[0] ?? null,
    [activeId, points, visiblePoints],
  );

  // A pinned *post* fetches its real KNN corpus neighbors → edges + risk split.
  const pinnedPoint = useMemo(
    () => points.find((p) => p.id === pinnedId) ?? null,
    [points, pinnedId],
  );
  const neighborsKey =
    pinnedPoint?.kind === "post"
      ? `/api/semantic-drift/neighbors?id=${encodeURIComponent(pinnedPoint.id)}`
      : null;
  const { data: neighborData } = useSWR<SemanticNeighborsResponse>(
    neighborsKey,
    fetcher,
  );

  const toggleKind = useCallback((kind: SemanticPointKind) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const handlePin = useCallback(
    (id: string | null) => setPinnedId((prev) => (prev === id ? null : id)),
    [],
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="space-y-2">
          <div className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground uppercase">
            <SparklesIcon aria-hidden="true" className="size-3.5 text-primary" />
            Redis Vector Space
            <EmbeddingBadge live={data?.embeddingLive} />
          </div>
          <h1 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance">
            Vector Space
          </h1>
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
            Every dot is a 768-d Redis vector, laid out by UMAP so{" "}
            <span className="text-foreground">nearby dots are semantically similar</span>.
            Click a post to trace its nearest known-slang vectors — the same cosine match
            that drives the risk score.
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

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="relative min-h-[min(78vh,780px)] overflow-hidden rounded-lg border border-border bg-card">
          <VectorField
            points={visiblePoints}
            hoverId={hoverId}
            pinnedId={pinnedId}
            neighbors={neighborData?.neighbors ?? []}
            onHover={setHoverId}
            onPin={handlePin}
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
          <FilterPanel
            points={points}
            hidden={hidden}
            onToggle={toggleKind}
          />
          <InspectorPanel point={activePoint} neighbors={neighborData} />
        </aside>
      </section>
    </main>
  );
}

function EmbeddingBadge({ live }: { live: boolean | undefined }) {
  if (live === undefined) return null;
  return (
    <Badge variant={live ? "outline" : "secondary"} className="gap-1.5">
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full",
          live ? "bg-primary" : "bg-muted-foreground",
        )}
      />
      {live ? "Live embeddings" : "Mock embeddings"}
    </Badge>
  );
}

interface ViewTransform {
  scale: number;
  x: number;
  y: number;
}

function VectorField({
  points,
  hoverId,
  pinnedId,
  neighbors,
  onHover,
  onPin,
}: {
  points: SemanticDriftPoint[];
  hoverId: string | null;
  pinnedId: string | null;
  neighbors: SemanticNeighborsResponse["neighbors"];
  onHover: (id: string | null) => void;
  onPin: (id: string | null) => void;
}) {
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  // Keyboard navigation traverses points left→right; a single tab stop, not 240.
  const sorted = useMemo(
    () => [...points].sort((a, b) => a.x - b.x || a.y - b.y),
    [points],
  );
  const activeId = hoverId ?? pinnedId;

  const moveActive = useCallback(
    (delta: number) => {
      if (sorted.length === 0) return;
      const current = sorted.findIndex((p) => p.id === activeId);
      const next = (current + delta + sorted.length) % sorted.length;
      onHover(sorted[next].id);
    },
    [sorted, activeId, onHover],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<SVGSVGElement>) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          moveActive(1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          moveActive(-1);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          if (activeId) onPin(activeId);
          break;
        case "Escape":
          onPin(null);
          break;
      }
    },
    [moveActive, activeId, onPin],
  );

  const onWheel = useCallback((event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    setView((v) => ({
      ...v,
      scale: clamp(v.scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_SCALE, MAX_SCALE),
    }));
  }, []);

  // Drag on empty canvas = pan. A drag past threshold suppresses the click-to-clear.
  const onPointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    d.x = event.clientX;
    d.y = event.clientY;
    const k = (VIEWBOX_SIZE / event.currentTarget.clientWidth) / view.scale;
    setView((v) => ({ ...v, x: v.x + dx * k, y: v.y + dy * k }));
  }, [view.scale]);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const wasDrag = drag.current?.moved ?? false;
      drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (!wasDrag) onPin(null); // a clean click on empty canvas clears the pin
    },
    [onPin],
  );

  const isZoomed = view.scale !== 1 || view.x !== 0 || view.y !== 0;
  const groupTransform = `translate(${CENTER} ${CENTER}) scale(${view.scale}) translate(${
    -CENTER + view.x
  } ${-CENTER + view.y})`;

  const pointById = useMemo(
    () => new Map(points.map((p) => [p.id, p])),
    [points],
  );
  const pinned = pinnedId ? pointById.get(pinnedId) ?? null : null;
  const activePoint = activeId ? pointById.get(activeId) ?? null : null;
  const activeLabel = activePoint
    ? `${POINT_STYLE[activePoint.kind].label}: ${activePoint.label}${
        activePoint.flagged ? ", flagged" : ""
      }`
    : "";

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {activeLabel}
      </p>
      <svg
        aria-label="Vector space map. Arrow keys move between vectors; Enter pins one to trace its neighbors."
        className="h-full min-h-[min(78vh,780px)] w-full touch-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        role="application"
        tabIndex={0}
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <defs>
          <pattern id="vsGrid" width="36" height="36" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="var(--border)" opacity="0.5" />
          </pattern>
          <filter id="pointGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} fill="var(--card)" />
        <rect width={VIEWBOX_SIZE} height={VIEWBOX_SIZE} fill="url(#vsGrid)" />

        <g transform={groupTransform}>
          {/* Edges: pinned post → its real cosine-KNN corpus neighbors. */}
          {pinned
            ? neighbors.map((n) => {
                const target = pointById.get(n.id);
                if (!target) return null;
                const x1 = CENTER + pinned.x * PLOT_RADIUS;
                const y1 = CENTER + pinned.y * PLOT_RADIUS;
                const x2 = CENTER + target.x * PLOT_RADIUS;
                const y2 = CENTER + target.y * PLOT_RADIUS;
                return (
                  <g key={`edge-${n.id}`}>
                    <line
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke="var(--primary)"
                      strokeOpacity="0.55"
                      strokeWidth={1.5 / view.scale}
                    />
                    <text
                      x={(x1 + x2) / 2}
                      y={(y1 + y2) / 2}
                      fill="var(--primary)"
                      fontSize={11 / view.scale}
                      textAnchor="middle"
                      className="font-mono"
                      style={{ paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3 / view.scale }}
                    >
                      {n.cosine.toFixed(2)}
                    </text>
                  </g>
                );
              })
            : null}

          {/* Points. */}
          {points.map((point) => {
            const style = POINT_STYLE[point.kind];
            const cx = CENTER + point.x * PLOT_RADIUS;
            const cy = CENTER + point.y * PLOT_RADIUS;
            const isActive = point.id === activeId;
            const isPinned = point.id === pinnedId;
            const radius = (isActive ? style.radius + 3.5 : style.radius) / view.scale;
            return (
              <g
                key={point.id}
                aria-hidden="true"
                className="cursor-pointer"
                transform={`translate(${cx} ${cy})`}
                onPointerEnter={() => onHover(point.id)}
                onPointerLeave={() => onHover(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  onPin(point.id);
                }}
              >
                {isActive || isPinned ? (
                  <circle
                    className="semantic-drift-pulse"
                    r={radius * 2.4}
                    fill={style.color}
                    opacity={0.2}
                  />
                ) : null}
                <circle
                  className="transition-[r] duration-150"
                  r={radius}
                  fill={style.color}
                  filter="url(#pointGlow)"
                  opacity={point.flagged ? 1 : point.kind === "post" ? 0.74 : 0.9}
                  stroke={isActive ? "white" : "var(--card)"}
                  strokeWidth={(isActive ? 2.25 : 1) / view.scale}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {isZoomed ? (
        <Button
          variant="outline"
          size="sm"
          className="absolute right-3 bottom-3 gap-1.5"
          onClick={() => setView({ scale: 1, x: 0, y: 0 })}
        >
          <ZoomInIcon aria-hidden="true" className="size-3.5" />
          Reset view
        </Button>
      ) : null}
    </>
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

function FilterPanel({
  points,
  hidden,
  onToggle,
}: {
  points: SemanticDriftPoint[];
  hidden: Set<SemanticPointKind>;
  onToggle: (kind: SemanticPointKind) => void;
}) {
  const counts = useMemo(() => {
    const map = new Map<SemanticPointKind, number>();
    for (const p of points) map.set(p.kind, (map.get(p.kind) ?? 0) + 1);
    return map;
  }, [points]);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Layers</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {KIND_ORDER.map((kind) => {
          const style = POINT_STYLE[kind];
          const isHidden = hidden.has(kind);
          return (
            <li key={kind}>
              <button
                type="button"
                aria-pressed={!isHidden}
                onClick={() => onToggle(kind)}
                className={cn(
                  "flex items-center gap-2 rounded-4xl border px-2.5 py-1 text-xs transition-colors",
                  isHidden
                    ? "border-border text-muted-foreground opacity-60"
                    : "border-border text-foreground hover:bg-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{
                    backgroundColor: isHidden ? "var(--muted-foreground)" : style.color,
                  }}
                />
                {style.label}
                <span className="font-mono text-muted-foreground tabular-nums">
                  {counts.get(kind) ?? 0}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function InspectorPanel({
  point,
  neighbors,
}: {
  point: SemanticDriftPoint | null;
  neighbors: SemanticNeighborsResponse | undefined;
}) {
  if (!point) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Selected Vector</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Hover a dot to preview it; click to trace its neighbors.
        </p>
      </section>
    );
  }

  const style = POINT_STYLE[point.kind];
  const isPost = point.kind === "post";
  const risk = isPost ? neighbors?.risk : undefined;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{point.label}</h2>
          <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: style.color }}
            />
            {style.label}
          </p>
        </div>
        <Badge variant={point.flagged ? "destructive" : "outline"} className="shrink-0">
          {isPost && point.riskScore !== null
            ? point.riskScore.toFixed(0)
            : point.category || point.kind}
        </Badge>
      </div>

      <p className="mt-4 max-h-32 overflow-auto break-words text-sm leading-6 text-muted-foreground">
        {point.text}
      </p>

      {point.drug ? (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Drug:</span> {point.drug}
        </p>
      ) : null}

      {isPost ? (
        risk ? (
          <RiskExplain risk={risk} neighbors={neighbors?.neighbors ?? []} />
        ) : (
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            Tracing nearest vectors…
          </p>
        )
      ) : null}
    </section>
  );
}

function RiskExplain({
  risk,
  neighbors,
}: {
  risk: NonNullable<SemanticNeighborsResponse["risk"]>;
  neighbors: SemanticNeighborsResponse["neighbors"];
}) {
  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4">
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Semantic similarity</span>
          <span className="font-mono tabular-nums">{risk.semantic.toFixed(2)}</span>
        </div>
        <Meter value={risk.semantic} color="var(--primary)" />
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Heuristic boost</span>
          <span className="font-mono tabular-nums">+{risk.heuristicBoost.toFixed(2)}</span>
        </div>
        <Meter value={risk.heuristicBoost / 0.25} color="var(--chart-2, #f59e0b)" />
      </div>

      {risk.matchedTermText ? (
        <p className="text-xs text-muted-foreground">
          Nearest known term:{" "}
          <span className="text-foreground">{risk.matchedTermText}</span>
        </p>
      ) : null}

      {neighbors.length > 0 ? (
        <div>
          <p className="font-mono text-xs text-muted-foreground">Nearest vectors</p>
          <ul className="mt-2 space-y-1.5">
            {neighbors.map((n) => (
              <li
                key={n.id}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="truncate">{n.text || n.id}</span>
                <span className="shrink-0 font-mono tabular-nums text-primary">
                  {n.cosine.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {risk.detectedCodeWords.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {risk.detectedCodeWords.map((word) => (
            <Badge key={word} variant="secondary" className="font-mono">
              {word}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${clamp(value, 0, 1) * 100}%`, backgroundColor: color }}
      />
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
