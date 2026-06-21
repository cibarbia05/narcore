import { cn } from "@/lib/utils";

/**
 * Brand mark: a surveillance eye on the azure badge — the system that watches.
 * The iris is drawn as radial lines converging on the pupil; an almond lid
 * clips it top and bottom, so the lines read as rays reaching in from the upper
 * and lower lids toward the centre. Eye linework uses the near-black
 * `background` token; the catch-light borrows the azure accent.
 */
const IRIS_INNER = 2.7;
const IRIS_OUTER = 6.6;
const SPOKES = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    x1: Number((16 + IRIS_INNER * cos).toFixed(2)),
    y1: Number((16 + IRIS_INNER * sin).toFixed(2)),
    x2: Number((16 + IRIS_OUTER * cos).toFixed(2)),
    y2: Number((16 + IRIS_OUTER * sin).toFixed(2)),
  };
});

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="narcore logo"
      className={cn("size-8", className)}
    >
      <defs>
        {/* Almond lid — clips the oversized iris so the lids cover its top/bottom. */}
        <clipPath id="narcore-eye-lid">
          <path d="M5.5 16Q16 7 26.5 16Q16 25 5.5 16Z" />
        </clipPath>
      </defs>

      <rect x="1.5" y="1.5" width="29" height="29" rx="8" className="fill-primary" />

      <g clipPath="url(#narcore-eye-lid)" className="stroke-background">
        {/* Radial iris lines converging on the pupil. */}
        <g strokeWidth="0.6" strokeLinecap="round">
          {SPOKES.map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
          ))}
        </g>
        {/* Iris boundary. */}
        <circle cx="16" cy="16" r="6.6" fill="none" strokeWidth="1" />
        {/* Pupil. */}
        <circle cx="16" cy="16" r="2.6" strokeWidth="0" className="fill-background" />
      </g>

      {/* Catch-light: a small azure glint on the pupil. */}
      <circle cx="14.5" cy="14.5" r="1" className="fill-primary" />

      {/* Eyelid outline, drawn on top for a crisp lens edge. */}
      <path
        d="M5.5 16Q16 7 26.5 16Q16 25 5.5 16Z"
        fill="none"
        className="stroke-background"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
