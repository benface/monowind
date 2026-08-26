# Agent guidelines

This is `monowind`, a pnpm workspaces monorepo for a library that renders
ordinary HTML styled with Tailwind utility classes as TUI-style, character-cell
interfaces on the web. Start with
`.agents/architecture/core-architecture.md` for the design decisions.

## Layout

- `apps/` — applications
- `packages/` — the library packages
- `.agents/specs/` — feature and behavior specs, including simplified
  cell-adapted versions of the CSS features monowind re-implements (normative
  for the engine and its tests; deviations from real CSS marked explicitly)
- `.agents/plans/` — implementation plans (file names prefixed with the date:
  `YYYY-MM-DD-<topic>.md`)
- `.agents/architecture/` — architecture notes and decisions

## Conventions

- Use `pnpm` for all package management (never `npm` or `yarn`).
- Always use up-to-date dependencies: when adding or pinning anything (including
  the `packageManager` field), check the registry for the current latest version
  (e.g. `npm view <pkg> version`) — never trust memory or whatever happens to be
  installed locally.
- Before starting non-trivial work, check `.agents/` for relevant specs, plans, or architecture notes, and keep them up to date as you go.
- No diminutives or ad-hoc abbreviations in identifiers (`cumAuto`, `btnLbl`,
  `usrCfg`, `idx` in non-loop contexts, …). Spell it out
  (`cumulativeAutoOffset`, `buttonLabel`, `userConfig`, `index`).
  Standard loop counters (`i`, `j`, `k`) and well-known domain acronyms
  (`url`, `html`, `id`) are fine.
