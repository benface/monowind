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
> areas included), multi-column (`columns-*`, balancing, spanners,
> column rules), and table layout (collapsed borders as shared
> box-drawing lattices), gap decorations (`rule-*` separators with
> junction glyphs), text wrap, margins, and scrolling
> (`overflow-auto`/`-scroll` scroll containers with native physics and engine-drawn
> TUI scrollbars) work. The unified-render
> initiative shipped: one cell-precise renderer that keeps the light
> DOM fully interactive, with the ASCII grid selectable via
> `<mono-wind select="text">` for a semantic text mirror. Opacity and
> CSS transitions animate the grid (backgrounds synthesized by the
> engine), hover/active states work on any element without breaking
> grid selection, and `<mono-ascii>` renders FIGlet banner text —
> see the sections below. Design docs
> live in [.agents/architecture](.agents/architecture),
> [.agents/specs](.agents/specs), and [.agents/plans](.agents/plans).

## Pointer states in grid mode

Under the default `select="grid"`, non-interactive elements pass
pointer events through to the grid so drag-selection works — which
would normally make `:hover`/`:active` dead on a plain `<div>`.
monowind synthesizes both instead: the engine hit-tests the pointer
against the cell layout and Tailwind's `hover:` and `active:` variants
(plus `group-*`/`peer-*`) respond as usual, `cursor-*` included, with
selection intact. Two things still need a real hit target: native
`title` tooltips and your own JS click handlers on non-interactive
elements — opt those elements in with `pointer-events-auto!` (they
then block grid selection over their cells, like buttons do).

If you redefine Tailwind's `hover:` variant yourself, your definition
wins — include the data attribute (and Tailwind's hover-capability
gate) to keep grid-mode hover working:

```css
@custom-variant hover {
  @media (hover: hover) {
    &:is(:hover, [data-mw-hover]) {
      @slot;
    }
  }
}
```

## Ascii-art banners

`@monowind/ascii` adds `<mono-ascii>`: FIGlet/TOIlet banner text
rendered on the grid, with the semantic string intact for screen
readers; selecting over the banner selects the art itself. Fonts are
per-module imports (or `registerAsciiFont` with your own
`.flf`/`.tlf` data); SGR-colored fonts and the `effect` attribute
(`rainbow`, `metal`) paint through theme-aware `--mw-ansi-*` tokens.

```html
<mono-ascii font="small" class="text-emerald-400">monowind</mono-ascii>
```

44 clearly-licensed fonts ship with the package; see
[packages/ascii/README.md](packages/ascii/README.md) for setup per
integration and the full font list.

## Themes

`@monowind/themes` ships class-scoped themes modeled on real systems —
`dos`, `dos-blue`, `c64`, `green-phosphor`, `amber`, `teletype`, `bbs`:
authentic palettes (every Tailwind color token quantized to the
system's colors), period fonts, and era-correct border characters
(`border-double` renders `+=+` on a teletype and downgrades to single
lines on a phosphor terminal). Try the theme switcher in the
[playground](https://play.monowind.benface.com); details in
[packages/themes/README.md](packages/themes/README.md). Anyone can
build a theme — it's one CSS file against the core theming contract.

## Structure

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces):

- `apps/` — applications (Storybook, example apps, docs site, …)
- `packages/` — the library packages (core engine, build integrations)
- `.agents/` — working documents for AI agents (specs, plans, architecture)

## Showcase & docs

- [Storybook](https://storybook.monowind.benface.com) — live examples of every
  supported feature, deployed from `apps/storybook`.
- [Playground](https://play.monowind.benface.com) — edit HTML in the browser and
  see the character grid update live; every document is a shareable URL, long
  or short. Deployed from `apps/play`.

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

# Playground (live HTML editing through <mono-wind>, shareable URLs), port 5181
pnpm --filter @monowind/play dev

# same, wrapped in the Netlify CLI so the short-link functions run too, port 8888
pnpm --filter @monowind/play dev:netlify

# Example apps (each demonstrates one way to consume monowind):
pnpm --filter @monowind/example-html dev       # CDN mode: one script tag
pnpm --filter @monowind/example-tailwind dev   # your own Tailwind v4 build
pnpm --filter @monowind/example-vite dev       # standalone: @monowind/vite, zero Tailwind setup
pnpm --filter @monowind/example-react dev      # React 19 + @monowind/vite
pnpm --filter @monowind/example-solid dev      # Solid 2.0 (RC) + @monowind/vite
```
