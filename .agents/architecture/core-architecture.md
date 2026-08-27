# monowind — core architecture

Status: living document — Milestones 1+2 implemented (last updated 2026-08-26)

## What monowind is

A library for building text-based user interfaces (TUIs) on the web.
Applications author ordinary HTML (plain or via any framework — React, Svelte,
Solid, Vue…) styled with Tailwind utility classes, and a Web Component renders it as
a strict character grid: box-drawing borders, integer-cell geometry, monospace
everything — while keeping native links, buttons, inputs, focus, selection, forms,
and accessibility semantics fully intact.

```html
<mono-wind>
  <div class="flex justify-between items-center min-h-5 px-1 border border-red-600">
    <div>This will be on the left</div>
    <button>This will be on the right</button>
  </div>
</mono-wind>
```

renders as:

```text
┌──────────────────────────────────────────────────────┐
│                                                      │
│ This will be on the left   This will be on the right │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## Decisions

### D1. The input language is CSS itself, not class names

The engine does **not** parse utility class names. Tailwind (or any CSS source —
plain stylesheets, CSS-in-JS, inline styles) turns classes into real CSS
declarations; the browser resolves the cascade; the engine reads **computed styles**
from the light DOM and interprets lengths as cells.

The unit mapping: **1 cell = 0.25rem** (Tailwind's spacing unit, 4px at the default
root font size). So stock, zero-config Tailwind already means the right thing:
`p-1` → 0.25rem → 1 cell, `w-20` → 5rem → 20 cells. The engine divides computed px
by `0.25 × root font-size` (measured, not hardcoded 4px) to recover cell counts.
Horizontal values map to columns, vertical values to rows.

Why this instead of parsing class names (the original plan):

- **Variants come free.** `lg:p-2`, `hover:`, `focus:`, `group-*`, `data-*`,
  arbitrary variants like `[&:nth-child(-n+3)]:` — the browser resolves all of it.
  Re-implementing variant machinery was the fatal flaw of the parser approach.
- **Zero Tailwind configuration.** Users install stock Tailwind; no custom theme,
  preset, or plugin required. Theme colors inherit automatically.
- **Any styling technology works.** monowind is a character-cell rendering engine
  whose input language is CSS — Tailwind is the recommended authoring layer, not a
  dependency of the concept.

Consequences: something must compile classes to CSS (build step or CDN runtime, see
D5), and the engine must avoid reading back its own writes (see the measure/write
cycle below).

### D2. Layout is computed by a JS integer engine, not the browser

Browser layout produces fractional geometry the grid cannot tolerate:
`justify-center` with an odd leftover column offsets content by half a cell,
`flex-grow` splits space into fractional widths, and CSS offers no hook to round
flex-computed results. So the engine computes layout itself — block, flex, and
grid. Inline layout is the deliberate exception: inline content is delegated to
the browser as text runs (see `../specs/cell-model.md`). Simplified, cell-adapted
versions of the CSS specs we re-implement live in `.agents/specs/` and are
normative for the engine and its tests.

- All geometry is integer `Rect { x, y, width, height }` in cell units.
- When flexible space produces fractions, remainder cells are distributed
  deterministically in document order (documented and tested).
- The engine absolutely positions light-DOM nodes by writing CSS custom properties
  (`--mw-x/y/w/h`); a component stylesheet turns those into px via the measured cell
  size. Parent-relative coordinates, so the DOM hierarchy is preserved and no node
  is ever reparented.

### D3. Two rendering layers sharing one grid

1. **Light DOM content layer** — the application's own elements: text, links,
   buttons, inputs, containers. Visible, interactive, framework-owned. The
   component never clones, replaces, moves, or reorders them; it only writes CSS
   custom properties and owned `data-*` attributes.
2. **Shadow DOM decoration layer** — box-drawing borders, separators, backgrounds,
   decorative control framing (e.g. `[ Save ]` brackets). `aria-hidden="true"`,
   `pointer-events: none`, `user-select: none`. Never contains semantic content.

Native interactive elements stay native: normalized visually (no browser chrome)
but retaining tab order, focus, caret, selection, clipboard, form behavior, and
ARIA semantics. Relayout must never recreate or blur a focused control.

### D4. Framework-agnostic via a Web Component

One custom element hosts the grid: measures cell metrics, observes the light DOM,
schedules layout, paints decoration. Frameworks just render children into it — no
per-framework renderer needed (optional JSX type declarations only).

Note: custom element names **require a hyphen**, so `<monowind>` is invalid.
Decision (2026-08-25): the tag is **`<mono-wind>`**. If a component layer emerges
later (e.g. `<mono-textarea>`, `<mono-scroll>`), consider migrating the host to
`<mono-root>` so the whole family shares the `mono-` prefix.

### D5. One engine, three packagings

- **Native mode** — user already has Tailwind v4: install the core package, import
  the element + companion stylesheet. Their existing Tailwind build does the CSS.
- **Standalone mode** — a monowind Vite plugin / CLI wraps Tailwind's compiler as a
  regular (not peer) dependency, preconfigured. User never touches Tailwind.
- **CDN mode** — a single script tag bundling the engine with
  `@tailwindcss/browser` (the Play CDN compiler): no build step, full JIT and
  arbitrary variants at runtime.

All three share one core. Concretely, the planned packages:

- **`monowind`** (`packages/core`) — the only package until the MVP is done:
  the `<mono-wind>` element, style reader, layout engine, decoration renderer,
  companion stylesheet. Zero runtime dependencies. (The monorepo root
  package.json is named `monowind-monorepo` so the workspace never has two
  packages claiming the `monowind` name.)
- **`@monowind/vite`** (`packages/vite`) — standalone mode. _Implemented:_
  one plugin call wires everything — it embeds `@tailwindcss/vite`,
  generates the CSS entry (Tailwind + companion + optional user file) with
  absolute-path imports into `node_modules/.monowind/entry.css` (so
  resolution works although the user's project has no Tailwind dependency),
  and injects a virtual module into index.html (order-`pre`, so builds
  bundle it) that loads the CSS and registers `<mono-wind>`. The `css`
  option pulls a user file into the Tailwind compilation, so `@theme`
  customization works exactly as in native mode — "standalone" means zero
  _required_ Tailwind config, not zero customizability. (CDN mode gets the
  same via `<style type="text/tailwindcss">`, which `@tailwindcss/browser`
  supports.) Exercised by `apps/example-vite`.
- **CDN mode is a build output of core, not a package** — an extra IIFE bundle
  including `@tailwindcss/browser`, published with the core package and served
  via unpkg/jsdelivr. No separate versioning surface. _Implemented:_
  `dist/cdn.js` (~78 KB gzip), built by `vite.cdn.config.ts` from
  `src/cdn.ts`, exercised by `apps/example-html`.
- **`apps/`** — `storybook` (the showcase + dev environment; every story is
  also a browser test and a visual-regression fixture), `example-html` (CDN
  mode), `example-tailwind` (native mode, custom `@theme`), `example-vite`
  (standalone mode via `@monowind/vite`), `example-react` (React 19 owning
  the light DOM — its smoke test proves state → re-render → relayout), with
  a docs/landing site (`website`, → monowind.benface.com) to come.
- Per-framework packages: only if/when a component layer (`<mono-textarea>`,
  `<mono-scroll>`, …) happens.

**Workspace vs. publish resolution.** Each publishable package exposes its own
source via `exports` (`"default": "./src/index.ts"`) so workspace consumers
(the example apps, other packages, anything using a modern bundler with
TypeScript) resolve straight to `.ts` files — no build step, HMR just works,
no dep-optimizer staleness. At publish time, `publishConfig.exports` swaps in
built JS + declaration files under `dist/`. Both npm and pnpm respect
`publishConfig` on `npm publish`. This keeps dev ergonomics and publish
correctness in one place, at the package level — no per-consumer bundler
config needed.

## The measure/write cycle

The engine both reads authored styles and writes geometry, and both
`getComputedStyle` and `computedStyleMap` report the cascade winner — including our
own overrides. Planned solution, batched per animation frame (pre-paint, so no
visible flash):

1. Set a "measuring" attribute on the host that disables the geometry override
   rules (they are guarded by `:not([measuring])` or equivalent).
2. Read computed styles for the whole tree (one forced style recalc).
3. Compute integer layout in JS.
4. Write custom properties / decoration; remove the measuring attribute.

Do **not** use `display: none` tricks to read computed values — hiding elements
blurs focus and resets internal scroll state, violating focus preservation.

## Reading authored values: CSS Typed OM

`getComputedStyle` returns _used_ values for box properties (always px — `w-full`
vs `w-20` indistinguishable). `element.computedStyleMap()` returns _computed_
values: percentages stay percentages, `auto` stays `auto`, rem becomes px. The
engine uses Typed OM to learn intent and resolves percentages itself in integer
cell space.

Support (verified 2026-08-25): Chromium (long-standing), Safari 16.4+, and
Firefox — available in Nightly, expected to ship in **Firefox 157**. Typed OM is
therefore the primary path everywhere. Decision: for pre-157 Firefox, the
fallback is a **minimal class-name parser covering sizing utilities only**
(`w-* h-* min-* max-*` and their percentage/fraction forms) — chosen over
used-value heuristics; it's a temporary polyfill to drop once Firefox 157+ is
dominant.

## Rejected alternatives

- **Pure-CSS approach** (re-base Tailwind's `--spacing` to `1ch` inside the
  monowind subtree; no JS layout). CSS variables do scope correctly to the subtree,
  and this would have been nearly free — but browser flex produces fractional
  geometry with no rounding hook (D2), so the strict grid is unachievable. Parts of
  the idea survive: theme colors still flow through variables.
- **Class-name parser** (the original pre-monowind plan by ChatGPT): the engine
  parses `p-1`, `lg:p-2` itself. Zero build step, full control — but requires
  re-implementing variants, media queries, and the cascade, and caps monowind at a
  small utility subset forever. Survives only as a possible Firefox sizing
  fallback.

## Open questions

- **Dynamic style-change detection**: no observer fires when `:hover` /
  `:focus-visible` / animations change computed style. Leading option: the
  CSS-transition-event trick used by
  [style-observer](https://github.com/leaverou/style-observer) — install
  near-zero-duration transitions (`allow-discrete` for non-animatable
  properties) on the layout-affecting properties and listen for
  `transitionstart`/`transitionrun`, which do fire on pseudo-class-driven
  changes. Implement it natively in the engine, specialized to our fixed
  property set (~30 lines, via the companion stylesheet we already own) rather
  than bundling the library. Caveat to resolve: author-defined `transition`
  declarations on the same elements fight ours — rare for layout properties in a
  TUI, but needs a documented stance. Second caveat: **feedback loop** — the
  engine itself writes `width`/`height` via its geometry rules, so observing
  those properties would fire transition events on our own writes and relayout
  forever. Either observe only never-written properties (padding, gap, flex-*,
  display, border-width — missing hover-driven _sizing_), or suppress events
  during/immediately after the write phase. Alternatives if it proves fragile:
  relayout on pointer/focus events, or constrain dynamic states to paint-only
  properties. Needs a decision before the visual-system milestone.
- **Transforms**: `translate-y-1` etc. would shift content off-grid (browser
  applies raw px). Likely answer: rescale the standalone `translate` property to
  cells the way insets are handled; neutralize matrix `transform`s. Needs
  checking against how Tailwind v4 actually emits translate/rotate/scale.
- **Heavy border style exposure**: no CSS `border-style` keyword maps to heavy
  glyphs (`double` claims `═`); likely a monowind-specific opt-in via an owned
  custom property. See `../specs/cell-model.md`.
- **npm naming**: `monowind` verified unclaimed on npm and the `@monowind` org
  reserved (2026-08-25); a `monowind@0.0.0` placeholder publish is prepared and
  pending (`npm login` required).
- **Cell aspect ratio / font metrics**: measure the actual font (not `1ch`
  assumptions), re-measure on `document.fonts.ready`; whether to recommend/bundle a
  known-good monospace font.
- **Unicode display width**: MVP is single-column-glyph only (documented); real
  width algorithm (East Asian wide, emoji, combining marks) deferred.
- **Scrolling**: decision is native pixel scrolling inside the gridded viewport
  (content on-grid, scroll offset not) — keeps momentum, a11y, find-in-page. CSS
  scroll-snap approximation or an opt-in JS row-scroll mode may come much later.

## Prior art / references

- OpenTUI (SST) — TypeScript TUI framework for real terminals; Yoga-based integer
  layout is prior art for D2.
- Tailwind v4 — CSS-first config, `@tailwindcss/browser` Play CDN.
- The original implementation plan (pre-`monowind` naming) lives in
  `../plans/2026-08-25-mvp-implementation-plan.md`, amended per D1.
