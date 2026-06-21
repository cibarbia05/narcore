# narcore

A dark, focused web foundation for high-stakes government tooling.

## Stack

- **[Next.js](https://nextjs.org) (App Router)** + **React 19** + **TypeScript**
- **[Tailwind CSS v4](https://tailwindcss.com)** — CSS-first config via `@theme`
  (no `tailwind.config.js`)
- **[shadcn/ui](https://ui.shadcn.com)** (Base UI primitives, Lucide icons)
- **[next-themes](https://github.com/pacocoursey/next-themes)** — dark-first theming

## Getting started

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Other scripts:

```bash
pnpm build        # production build (type-check + lint + compile)
pnpm start        # serve the production build
pnpm lint         # ESLint
```

> Uses **pnpm**. Install it with `npm i -g pnpm` (or via Corepack) if needed.

## Project layout

```
src/
  app/
    layout.tsx        # fonts, dark-default ThemeProvider, metadata
    globals.css       # design tokens — single source of truth (dark + azure)
    page.tsx          # starter page
  components/
    ui/               # shadcn/ui primitives (e.g. button)
    theme-provider.tsx
    logo.tsx          # brand mark
  lib/
    utils.ts          # cn() class merge helper
components.json       # shadcn/ui config
brand.md              # brand & UI guidelines
```

## Design system

The visual language (dark surface, single azure accent, typography, motion) is
documented in **[`brand.md`](./brand.md)**. All color/spacing/radius/motion values
live as tokens in **[`src/app/globals.css`](./src/app/globals.css)** — edit tokens
there; `brand.md` explains intent.

## Adding UI components

```bash
pnpm dlx shadcn@latest add <component>
```
