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
- `.agents/architecture/` — architecture notes and decisions, including
  `performance.md`: what `pnpm bench` measures and where the numbers stand

A spec's optional **`## Touch points on implementation`** is a
present-tense map from the spec to the code that carries it: one
bullet per source file, naming what that file holds for the feature.
A cross-reference to another doc belongs there only as a standing
relationship ("cell-model.md's box-model fill sentence points here"),
never as an edit to make ("deviation 2 is removed", "the backlog item
becomes a pointer") — that is a plan's job, and it rots in a spec the
day it is done.

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
- Tailwind classes in `class` and `className` attributes take their
  canonical form (`scrollbar-gutter-stable`, not `[scrollbar-gutter:stable]`):
  `pnpm check` reports any other form and `pnpm check:fix` rewrites it,
  against the stylesheet `.oxfmtrc.json` maps each file to.
- Keep comments terse. A comment earns its lines only by stating a
  non-obvious constraint or decision; one tight sentence usually suffices.
  No restating what the code does, no narrating history, no multi-sentence
  essays where a pointer to a spec would do.
- CSS belongs in a `.css` file, imported `?inline` where a string is
  needed (the shadow's, `packages/core/src/shadow.css`, its importer
  referencing `vite/client` for the source's consumers), not in a
  template literal, where a backtick in a comment closes the string.
  Both core builds strip its comments.
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

## Git

The user reviews work by staging it while agents are still working,
so the index moves under you — expected, not worth reporting:

- Never stage, unstage, stash or check out; the index is the user's.
- Commit or push only with the user's explicit approval, given for
  that batch — an earlier approval doesn't carry over to the next.
- The index is no baseline for "without the fix": run the test against
  a scratch copy with the fix taken out, never by swapping the fix out
  of the tracked tree, which the user may stage mid-swap.

## Testing

Every fix comes with a regression test seen failing without the fix
(written first, or run against a scratch copy, as above).

Run the narrowest check that covers a change while working, and the
full suites once, before handing off:

- A package's unit tests: `npx vitest run test/<file>.test.ts` in the
  package (`-t "<name>"` for one test) — seconds.
- A story file, in `apps/storybook` (~5 s):
  `npx vitest run stories/<file>.stories.ts --browser=chromium`; drop
  `--browser` to add Firefox and WebKit once it holds (the whole suite
  is ~50 s).
- Visual goldens only when paint or layout changes, scoped with
  `node scripts/test-visual.mjs --grep "<story-id>"`; the full run
  (a Storybook build, then Docker) once, at the end.
- `pnpm check` and `pnpm test` (the smokes build every package they
  serve) once, at the end — not after each edit.
- Never run two browser suites (stories, visual, smokes) at once,
  parallel agents included: they contend for the CPU and time out.
  Long runs go to the background with a hard timeout.

## Releasing

Bump the `version` in every `packages/*/package.json` (same number) —
preferably inside the release's final substantive commit, to avoid a
version-only commit and its extra CI run — push, and wait for green CI.
Then
`gh release create vX.Y.Z --title vX.Y.Z --notes "…"` — the tag triggers
`.github/workflows/release.yml`, which re-runs the checks, publishes every
package to npm (trusted publishing, no tokens), and deploys the Storybook
and playground sites to Netlify (`NETLIFY_AUTH_TOKEN` repo secret; Netlify
never builds on its own; the playground deploy bundles its short-link
functions, `apps/play/netlify/functions`). The jobs are independently
re-runnable: if only a deploy fails, re-run failed jobs — never re-publish
a version.
