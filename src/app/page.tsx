import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
      {/* Restrained background: faint orange glow + hairline grid, tokens only. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--foreground) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage:
              "radial-gradient(ellipse 80% 60% at 50% 0%, black, transparent 75%)",
          }}
        />
        <div
          className="absolute -top-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklch, var(--primary) 22%, transparent), transparent 70%)",
          }}
        />
      </div>

      <div className="flex w-full max-w-xl flex-col items-center text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 font-mono text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          Production-ready scaffold
        </span>

        <div className="mt-8 flex items-center gap-3">
          <Logo className="size-9" />
          <span className="font-mono text-lg font-medium tracking-tight">
            gov-dr-ai
          </span>
        </div>

        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Build something the public can trust.
        </h1>

        <p className="mt-5 max-w-md text-base text-pretty text-muted-foreground sm:text-lg">
          A dark, focused foundation for high-stakes government tooling — built on
          Next.js, TypeScript, and a precise design system.
        </p>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Button
            size="lg"
            className="h-11 px-5 text-sm"
            nativeButton={false}
            render={<a href="#get-started" />}
          >
            Get started
            <ArrowRight />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 px-5 text-sm"
            nativeButton={false}
            render={<a href="#docs" />}
          >
            View documentation
          </Button>
        </div>
      </div>

      <p className="absolute bottom-6 font-mono text-xs text-muted-foreground/70">
        Next.js · TypeScript · Tailwind · shadcn/ui
      </p>
    </main>
  );
}
