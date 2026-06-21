import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TopNavPlacement = "sticky" | "absolute";

const placementClasses: Record<TopNavPlacement, string> = {
  absolute: "absolute inset-x-0 top-0",
  sticky: "sticky inset-x-0 top-0",
};

export function TopNav({
  className,
  placement = "sticky",
}: {
  className?: string;
  placement?: TopNavPlacement;
}) {
  return (
    <header
      className={cn(
        "z-10 border-b border-border/60 bg-background/80 backdrop-blur",
        placementClasses[placement],
        className,
      )}
    >
      <nav
        aria-label="Primary"
        className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6"
      >
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo className="size-7 shrink-0" />
          <span className="hidden truncate font-mono text-sm font-medium tracking-tight sm:inline">
            narcore
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Supporting proof points (Redis vector space, Browserbase fleet) behind the
              core flow — visually subordinate to the primary Command Center button. */}
          <div className="hidden items-center gap-2 sm:flex">
            <Button
              variant="ghost"
              size="lg"
              className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              nativeButton={false}
              render={<Link href="/semantic-drift" />}
            >
              Vector Space
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              nativeButton={false}
              render={<Link href="/agents" />}
            >
              Fleet
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
              nativeButton={false}
              render={<Link href="/memory" />}
            >
              Memory
            </Button>
            <span className="h-5 w-px bg-border/60" aria-hidden="true" />
          </div>

          {/* The whole flow — Detect → Engage → Resolve, on one screen. */}
          <Button
            size="lg"
            className="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
            nativeButton={false}
            render={<Link href="/command" />}
          >
            Command Center
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </nav>
    </header>
  );
}
