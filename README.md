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

> **Status: pre-1.0.** The feature surface below works and is covered
> by unit, story, and visual-regression tests, but APIs and behavior
> can still change. Design docs live in
> [.agents/architecture](.agents/architecture),
> [.agents/specs](.agents/specs), and [.agents/plans](.agents/plans).

## What works

**Layout** — block, flex, and grid (subgrid and named areas included),
multi-column (`columns-*`, balancing, spanners, column rules), tables
(collapsed borders as shared box-drawing lattices), floats
(`float-*`/`clear-*`, with text wrapping beside them), margins, text
wrap, and gap decorations (`rule-*` separators with junction glyphs).

**Paint** — rounded corners (`rounded-*` picks a theme's corner
glyphs), box shadows (`shadow-*` as shade glyphs), gradients
(`bg-linear-*`, `bg-radial-*`, `bg-conic-*`, `bg-clip-text`), opacity,
and transforms and filters (`rotate-*`, `scale-*`, `translate-*`,
`blur-*`, `grayscale`, `backdrop-blur-*`, … — the element's cells in a
layer of their own, which the browser transforms).

**Motion** — CSS transitions and animations (`animate-spin`,
`animate-pulse`, keyframe enters and exits) sampled onto the grid.

**Scrolling and position** — scroll containers
(`overflow-auto`/`-scroll`) with native physics and engine-drawn TUI
scrollbars, sticky positioning (table headers and columns included),
and anchor positioning (`anchor-name`, `position-area`,
`position-try-fallbacks`) that places a menu under its button in
cells.

**Top layer** — popovers and modal dialogs (`popover`, `showModal()`)
paint above everything, their `backdrop:` drawn beneath.

**Interaction** — one cell-precise renderer draws the grid while the
light DOM stays the browser's own, so everything above is native
behavior rather than a reimplementation. Drag-select the grid, or set
`<mono-wind select="text">` for a semantic text mirror; `:hover` and
`:active` work on any element without breaking selection (see
[Pointer states](#pointer-states-in-grid-mode)).

## Getting started

**No build step** — one script tag, and `<mono-wind>` does the rest:

```html
<script src="https://unpkg.com/monowind/dist/cdn.js"></script>
```

**With Vite** — the plugin brings Tailwind with it, so there is nothing
to configure:

```sh
npm install -D @monowind/vite
```

**With your own Tailwind v4 build:**

```sh
npm install monowind
```

```css
@import "tailwindcss";
@import "monowind";
```

```js
import { defineMonoWind } from "monowind";
defineMonoWind();
```

See [packages/core/README.md](packages/core/README.md) for the engine
and [packages/vite/README.md](packages/vite/README.md) for the plugin.
The `pnpm --filter @monowind/example-* dev` lines under
[Development](#development) each run one of these setups end to end.

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

## Components

`@monowind/ui` adds accessible components — a menu, a listbox, a
select, a combobox, a dialog, a popover, a tooltip — as
[Zag.js](https://zagjs.com) state machines wired to the grid: Zag runs
the roles, the keyboard, typeahead, focus, and dismissal; the engine
places each floating part against its trigger in cells, in the top
layer above everything, flipped where the host leaves no room, and a
listbox in the flow like any other box. Headless, so a component styled
through the theme's tokens wears whatever theme its host does.

Write one as markup — `<mono-menu>` and its kin, attributes for props
and events for callbacks, which any framework or none can render, and
the whole answer where a framework has no Zag adapter (Solid 2, and
any markup-first stack — htmx, Turbo, Alpine, a server's views):

```html
<mono-menu placement="bottom-start">
  <button data-part="trigger" class="border px-1">File</button>
  <div data-part="positioner" popover="manual">
    <div data-part="content" class="border bg-clear">
      <div data-part="item" data-value="new" class="px-1">New</div>
    </div>
  </div>
</mono-menu>
```

Or take the components of your framework —
[`Menu.Root`](packages/ui-react/README.md) in React, `MenuRoot` in Vue
and Svelte — its hook, composable or `create…`, the mount on markup
marked with `data-part`, or Zag's adapter for another framework with
the package's `props()` and `connect()`.

See [packages/ui/README.md](packages/ui/README.md) for the parts,
states, placement, and the framework path, and
[packages/ui-react](packages/ui-react/README.md),
[packages/ui-vue](packages/ui-vue/README.md), and
[packages/ui-svelte](packages/ui-svelte/README.md) for theirs.

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

## QR codes

`@monowind/qr-code` adds `<mono-qr>`: the element's text as a
scannable QR code packed into the grid's cells — half blocks where a
cell is twice as tall as wide, so a version-1 code is 21 × 11 — with
the value kept in the light DOM for screen readers and a drag over
the code selecting characters that paste as a working code. Padding
is its quiet zone; `text-*` and `bg-*` set its colors; glyph sets
restyle its modules.

```html
<mono-qr class="mx-auto px-2 py-1">https://play.monowind.benface.com</mono-qr>
```

See [packages/qr-code/README.md](packages/qr-code/README.md) for the
attributes.

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
    &:is(:hover:where(:not([data-mw-covered])), [data-mw-hover]) {
      @slot;
    }
  }
}
```

(`[data-mw-covered]` marks an element another box paints over: the
browser drops its hover with its pointer events, and the `:where()`
drops the style at once where an engine lags.)

## Structure

This is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces):

- `apps/` — applications (Storybook, the playground, example apps)
- `packages/` — the library packages (core engine, build integrations, elements, components)
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

# lint + format check + typecheck
pnpm check

# same, but auto-fixes lint/format issues
pnpm check:fix

# tests (unit + golden + story tests + example smoke tests), one package
# at a time: two app tests rebuild the packages they load
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
pnpm --filter @monowind/example-svelte dev     # Svelte 5 + @monowind/vite
pnpm --filter @monowind/example-vue dev        # Vue 3 + @monowind/vite

# Styled by something other than Tailwind — the engine reads computed
# styles, so what wrote them does not matter:
pnpm --filter @monowind/example-unocss dev          # UnoCSS
pnpm --filter @monowind/example-panda dev           # Panda CSS
pnpm --filter @monowind/example-vanilla-extract dev # vanilla-extract
pnpm --filter @monowind/example-stylex dev          # StyleX

# Driven from attributes, with @monowind/ui's elements and no
# component code of their own:
pnpm --filter @monowind/example-htmx dev       # htmx
pnpm --filter @monowind/example-alpine dev     # Alpine
pnpm --filter @monowind/example-turbo dev      # Turbo (Hotwire)
pnpm --filter @monowind/example-datastar dev   # Datastar
```
