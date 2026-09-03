# Agent guidelines

This is a pnpm workspaces monorepo for `monowind`, a library that renders
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
- Test hooks in stories and DOM-based tests use `data-test="<name>"`
  (queried as `[data-test="name"]`) — never ad-hoc attributes like
  `data-pane` or `data-inner`, and `id` only for label/control wiring.
- Keep comments terse. A comment earns its lines only by stating a
  non-obvious constraint or decision; one tight sentence usually suffices.
  No restating what the code does, no narrating history, no multi-sentence
  essays where a pointer to a spec would do.
- No backticks inside comments in JS/TS template literals — they close
  the string. The shadow template in `packages/core/src/element.ts` is
  the trap; use plain quotes or bare identifiers.
- No plan-internal jargon in code, tests, or story text (milestone
  numbers, phase numbers, plan-file dates, "before/after" migration
  language). Describe what the code IS; cite a spec or a concrete rule
  when shape-of-change context helps. That vocabulary lives in
  `.agents/plans/` and rots when a plan is archived.
- No diminutives or ad-hoc abbreviations in identifiers (`cumAuto`, `btnLbl`,
  `usrCfg`, `idx` in non-loop contexts, …). Spell it out
  (`cumulativeAutoOffset`, `buttonLabel`, `userConfig`, `index`).
  Standard loop counters (`i`, `j`, `k`) and well-known domain acronyms
  (`url`, `html`, `id`) are fine.

## Releasing

Bump the `version` in every `packages/*/package.json` (same number) —
preferably inside the release's final substantive commit, to avoid a
version-only commit and its extra CI run — push, and wait for green CI.
Then
`gh release create vX.Y.Z --title vX.Y.Z --notes "…"` — the tag triggers
`.github/workflows/release.yml`, which re-runs the checks, publishes every
package to npm (trusted publishing, no tokens), and deploys the Storybook
site to Netlify (`NETLIFY_AUTH_TOKEN` repo secret; Netlify never builds on
its own). The two jobs are independently re-runnable: if only the deploy
fails, re-run failed jobs — never re-publish a version.
