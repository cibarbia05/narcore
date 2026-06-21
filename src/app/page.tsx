import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { TopNav } from "@/components/top-nav";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
      <TopNav placement="absolute" />

      {/* Restrained background: faint azure glow + hairline grid, tokens only. */}
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

      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 font-mono text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          Law-enforcement AI for illicit-drug trafficking
        </span>

        <div className="mt-8 flex items-center gap-3">
          <Logo className="size-9" />
          <span className="font-mono text-lg font-medium tracking-tight">
            narcore
          </span>
        </div>

        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Find the dealer. Make the deal. Build the case.
        </h1>

        <p className="mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
          Narcore scans social platforms for drug ads, sends an autonomous undercover operative to
          confirm the deal and meeting, and exports a court-ready case report.
        </p>

        {/* The three-stage pipeline at a glance — the spine of the whole product. */}
        <ol className="mt-8 flex flex-wrap items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
          {[
            "1 Detect — Redis vector ranking",
            "2 Engage — Claude operative via Browserbase",
            "3 Resolve — case report",
          ].map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              {i > 0 ? <span className="text-muted-foreground/40" aria-hidden="true">›</span> : null}
              <span className="rounded-full border border-border bg-card/50 px-3 py-1">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Button
            size="lg"
            className="h-11 px-5 text-sm"
            nativeButton={false}
            render={<Link href="/command" />}
          >
            Open Command Center
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-11 px-5 text-sm"
            nativeButton={false}
            render={<Link href="/feed" />}
          >
            See the live feed
          </Button>
        </div>
      </div>

      <p className="absolute bottom-6 font-mono text-xs text-muted-foreground/70">
        Redis vector search · Browserbase · Claude Sonnet
      </p>
    </main>
  );
}
