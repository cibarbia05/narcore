import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { CodeSphereField } from "@/components/landing/code-sphere-field";
import { TypingHeadline } from "@/components/landing/typing-headline";
import { Logo } from "@/components/logo";
import { TopNav } from "@/components/top-nav";

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
      <TopNav placement="absolute" />

      {/* Restrained background: rotating code-spheres, faint azure glow + hairline grid. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        {/* Ambient "depth of the corpus": code-glyph spheres rotating in 3D. */}
        <CodeSphereField intensity="subtle" />
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

        <TypingHeadline />

        <p className="mt-5 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">
          Narcore scans social platforms for drug ads, sends an autonomous undercover operative to
          confirm the deal and meeting, and exports a court-ready case report.
        </p>

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
    </main>
  );
}
