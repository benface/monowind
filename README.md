# monowind

Build TUI-style, character-cell interfaces on the web from ordinary HTML and
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

> **Status: early design.** Nothing is implemented yet. The current thinking
> lives in [.agents/architecture](.agents/architecture) and
> [.agents/plans](.agents/plans).

## Structure

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces):

- `apps/` — applications (demos, docs site, …)
- `packages/` — the library packages (core engine, build integrations)
- `.agents/` — working documents for AI agents (specs, plans, architecture)

## Development

```sh
pnpm install
```
