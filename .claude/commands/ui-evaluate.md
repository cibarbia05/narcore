---
description: Audit running UI against the project's own declared design tokens, Vercel web-design-guidelines, Lighthouse, Core Web Vitals, axe-core, computed-style tokens, multi-viewport, and keyboard navigation. Returns structured JSON findings.
argument-hint: "[path-or-url]"
context: fork
agent: ui-auditor-generic
allowed-tools: Bash(curl *), mcp__playwright__*, mcp__chrome-devtools__*
---

## Current state

- Branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-git"`
- Dev server (localhost:3000): !`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "down"`
- Path argument: $ARGUMENTS

## Task

Run the multi-step audit pipeline against the path above (defaults to `/` if no argument). The pipeline is in your system instructions. Order matters; STOP at any hard-fail.

If the dev server is down (status code is not `200` or `30x`), report that as the only finding and stop — no other audit step is meaningful without a running page.

Return the structured JSON output exactly as specified in your output schema. Hard-fails first, then scoring.
