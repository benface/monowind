# monowind

Build text-based user interfaces (TUIs) on the web from ordinary HTML and
Tailwind utility classes — plain or with any framework (React, Svelte, Solid,
Vue, …).

Author ordinary HTML with Tailwind utility classes, wrap it in `<mono-wind>`, and
it renders as a strict character grid — box-drawing borders, integer-cell
geometry, monospace everything — while native links, buttons, inputs, focus,
forms, and accessibility semantics stay fully intact.

```html
<mono-wind>
  <div class="flex justify-between items-center min-h-5 px-1 border">
    <div>This will be on the left</div>
    <button>This will be on the right</button>
  </div>
</mono-wind>
```

```text
┌──────────────────────────────────────────────────────┐
│                                                      │
│ This will be on the left   This will be on the right │
│                                                      │
└──────────────────────────────────────────────────────┘
```

> **Status: early development.** Block, flex, grid (subgrid and named
> areas included), and table layout (collapsed borders as shared
> box-drawing lattices), gap decorations (`rule-*` separators with
> junction glyphs), text wrap, and margins work; native-interaction
> polish and the visual system are next. Design docs live in
> [.agents/architecture](.agents/architecture),
> [.agents/specs](.agents/specs), and [.agents/plans](.agents/plans).

## Structure

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces):

- `apps/` — applications (Storybook, example apps, docs site, …)
- `packages/` — the library packages (core engine, build integrations)
- `.agents/` — working documents for AI agents (specs, plans, architecture)

## Showcase & docs

- [Storybook](https://storybook.monowind.benface.com) — live examples of every
  supported feature, deployed from `apps/storybook`.

## Development

```sh
pnpm install

# Storybook (the main showcase / dev environment), port 6006
pnpm dev

# lint + format check + typecheck + tests
pnpm check

# same, but auto-fixes lint/format issues
pnpm check:fix

# tests only (unit + golden + story tests + example smoke tests)
pnpm test

# visual regression tests (screenshots via Docker, one per story)
pnpm test:visual

# regenerate the screenshot baselines
pnpm test:visual:update

# build all packages
pnpm build

# interactively update dependencies across the workspace
pnpm check-updates

# Example apps (each demonstrates one way to consume monowind):
pnpm --filter @monowind/example-html dev       # CDN mode: one script tag
pnpm --filter @monowind/example-tailwind dev   # your own Tailwind v4 build
pnpm --filter @monowind/example-vite dev       # standalone: @monowind/vite, zero Tailwind setup
pnpm --filter @monowind/example-react dev      # React 19 + @monowind/vite
```
