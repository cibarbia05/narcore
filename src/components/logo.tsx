import { cn } from "@/lib/utils";

/**
 * Brand mark: a rounded badge with an upward chevron — signalling recovery,
 * resilience, and forward momentum. Inherits the orange accent via `fill-primary`.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="gov-dr-ai logo"
      className={cn("size-8", className)}
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" className="fill-primary" />
      <path
        d="M9 19.5 16 12l7 7.5"
        fill="none"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
