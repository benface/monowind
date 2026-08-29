# Agent guidelines

This is `monowind`, a pnpm workspaces monorepo for a library that renders
ordinary HTML styled with Tailwind utility classes as text-based user
interfaces (TUIs) on the web. Start with
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
- When authoring or testing Storybook stories, the running Storybook dev
  server (`pnpm dev`) exposes an MCP endpoint at `http://localhost:6006/mcp`
  (`@storybook/addon-mcp`) with story-authoring instructions and story-test
  tools. Note: its docs/component-inventory tools are React-only for now
  (manifests aren't generated for web-components setups), so don't rely on
  those.
- Keep comments terse. A comment earns its lines only by stating a
  non-obvious constraint or decision; one tight sentence usually suffices.
  No restating what the code does, no narrating history, no multi-sentence
  essays where a pointer to a spec would do.
- No diminutives or ad-hoc abbreviations in identifiers (`cumAuto`, `btnLbl`,
  `usrCfg`, `idx` in non-loop contexts, …). Spell it out
  (`cumulativeAutoOffset`, `buttonLabel`, `userConfig`, `index`).
  Standard loop counters (`i`, `j`, `k`) and well-known domain acronyms
  (`url`, `html`, `id`) are fine.
