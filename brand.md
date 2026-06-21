# Brand & UI Guidelines

The visual system for **narcore** — a dark, focused interface for high-stakes
government tooling. The bar is *world-class production*, not demo. Restraint is the
defining quality: a near-black ground, generous space, precise type, and a **single
authoritative-azure accent** that earns attention because nothing else competes for it.

> **Source of truth:** all color/spacing/radius/motion values live as tokens in
> [`src/app/globals.css`](./src/app/globals.css). This document explains *intent and
> usage* — it never restates raw values that could drift out of sync. When a token
> and this doc disagree, the token wins; fix the doc.

---

## 1. Principles

1. **Clarity over decoration.** Every element earns its place. If it doesn't aid
   comprehension or action, remove it.
2. **Restraint with the accent.** Azure marks the *one* thing that matters in a
   view — the primary action, focus, or a live signal. Never use it for large
   fills or as a background wash.
3. **Technical confidence.** Monospace for system/metadata, a clean grotesque for
   prose. The product should feel engineered, exact, and calm under pressure.
4. **Trust by default.** High contrast, predictable interaction, no dark patterns.
   This is software the public relies on.

---

## 2. Color

Dark-first. The light theme exists for completeness, but the brand surface is dark
(`<html class="dark">`, set in [`layout.tsx`](./src/app/layout.tsx)). Colors are
authored in **OKLCH** for perceptually-even steps and predictable contrast.

> **Severity ≠ brand.** Risk bands use dedicated semantic colors — red (`--destructive`)
> for *High*, amber (`--chart-2`) for *Elevated*, neutral for *Low* — and are
> intentionally independent of the azure accent. The brand color signals trust and
> action, never danger.

### Semantic roles (token → usage)

| Token | Role |
| --- | --- |
| `--background` / `--foreground` | Page ground (near-black, faintly warm) and primary text (soft off-white). |
| `--card` / `--popover` | Raised surfaces, one step above the ground. |
| `--primary` / `--primary-foreground` | **The azure accent** + the near-white text that sits on it. Primary buttons, focus, key emphasis. |
| `--secondary` / `--accent` | Quiet neutral surfaces for hover and low-emphasis controls. |
| `--muted` / `--muted-foreground` | Muted fills and secondary/supporting text. |
| `--border` / `--input` | Hairline separators and field outlines — low-contrast, translucent white. |
| `--ring` | Focus ring — azure, matches `--primary`. |
| `--destructive` | Errors, irreversible actions, and the **High** risk band. |
| `--chart-1…5` | Data viz — an azure-anchored multi-hue ramp; `--chart-2` is the amber used for the **Elevated** risk band. |
| `--sidebar-*` | App-shell surfaces (reserved for future navigation chrome). |

### The one-accent rule

- ✅ Primary CTA, focus ring, a live/status dot, a single emphasized number.
- ❌ Azure headings, azure body text, large azure panels, two competing accents
  in one viewport.
- Need a softer azure touch? Mix with the surface
  (`color-mix(in oklch, var(--primary) X%, transparent)`), as the hero glow does —
  don't introduce a new color.

### Contrast

Target **WCAG AA**: ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries.
`--foreground` on `--background` and `--primary-foreground` on `--primary` both
clear AA. Re-check any new pairing before shipping.

---

## 3. Typography

- **Sans (UI + prose):** Geist, exposed as `--font-sans`. Default for everything.
- **Mono (system + metadata):** Geist Mono, exposed as `--font-mono`. Use for
  labels, badges, code, counts, and technical chrome — it signals "machine-exact".
- Both are loaded via `next/font` in [`layout.tsx`](./src/app/layout.tsx) (self-hosted,
  no external CDN).
- **Headings:** tight tracking (`tracking-tight`), semibold; let size and weight —
  not color — create hierarchy. Use `text-balance` on headings, `text-pretty` on
  paragraphs.
- **Measure:** cap body line length around 60–70ch for readability.

---

## 4. Spacing, radius & layout

- **Radius:** driven by `--radius` (`0.625rem`) with a derived scale
  (`--radius-sm … --radius-4xl`). Use the scale; don't hardcode pixel radii.
- **Borders:** hairline and translucent (`--border`). Separation comes from spacing
  and subtle elevation first, lines second.
- **Density:** generous whitespace. Crowding reads as low-quality; let content breathe.
- **Grid/glow:** background treatments (e.g. the hero's faint grid + radial glow) are
  built **only from tokens** and kept low-opacity so they never fight foreground content.

---

## 5. Motion

- **Easing tokens:** `--ease-out-brand` (entrances/most transitions) and
  `--ease-in-out-brand` (reversible state). Snappy and confident, never bouncy.
- **Duration:** short — roughly 120–200ms for UI feedback. Speed reads as quality.
- **Reduced motion:** honored globally. `prefers-reduced-motion: reduce` collapses
  animation/transition durations in the base layer of `globals.css` — never rely on
  motion to convey meaning.

---

## 6. Components

- **Buttons** (shadcn/ui + Base UI, [`button.tsx`](./src/components/ui/button.tsx)):
  - `default` → the azure primary action. **One primary per view.**
  - `outline` / `secondary` / `ghost` → supporting actions.
  - `link` / `destructive` → inline navigation and dangerous actions.
  - Rendering a button as a link? Use `render={<a … />}` **and** `nativeButton={false}`
    so semantics and accessibility stay correct.
- **Focus:** always visible — the azure `--ring` on `focus-visible`. Never remove it.
- **Icons:** Lucide, sized to the text (`~1em`), used sparingly to reinforce meaning.
- **Badges/labels:** mono, low-contrast, often paired with a small `--primary` dot
  for live/status signals.

---

## 7. Voice

Short, declarative, credible. Plain language a citizen or official can trust — no
hype, no jargon for its own sake. Say what the system does and what to do next.

---

## 8. Accessibility (non-negotiable)

- Semantic HTML and landmarks (`main`, headings in order).
- Full keyboard operability with a visible focus ring on every interactive element.
- AA contrast (§2). Color is never the *only* signal — pair it with text/icon/shape.
- Respect `prefers-reduced-motion` (§5).
