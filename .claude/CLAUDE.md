@../.codex/AGENTS.md

## Claude Code

Single source of truth: the shared instructions above live in the in-repo
`.codex/AGENTS.md` (imported relatively so the import resolves for every
teammate who clones this repo, regardless of their home directory). Codex
reads that same `.codex/AGENTS.md` directly, so both tools stay aligned.
Edit `.codex/AGENTS.md`, not this file.

When making **any** UI change, invoke these skills to ensure best practices:

- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `web-design-guidelines`
