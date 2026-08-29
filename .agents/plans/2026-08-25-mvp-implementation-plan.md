# monowind MVP — implementation plan

Adapted from the original pre-`monowind` plan (drafted with ChatGPT), amended to
match the decisions in `../architecture/core-architecture.md` — chiefly **D1: the
engine reads computed styles instead of parsing class names**. Read that document
first; this one is the build plan.

## Goal

A framework-independent Web Component that turns ordinary HTML plus Tailwind
utility classes into a responsive text-based user interface (TUI) in the
browser:

```html
<mono-wind>
  <div class="flex justify-between items-center min-h-5 px-1 border border-red-600">
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

Works with plain HTML and with React/Vue/Svelte/Solid. Native links, buttons,
inputs, focus, selection, events, forms, and accessibility semantics preserved.

## Shadow-root structure

```html
<mono-wind>
  #shadow-root
  <style>
    …
  </style>
  <div id="viewport">
    <div id="decorations" aria-hidden="true"></div>
    <slot></slot>
  </div>

  <!-- Application-owned light DOM -->
  <div class="flex border">
    <a href="/settings">Settings</a>
    <button>Save</button>
  </div>
</mono-wind>
```

Decoration layer: `pointer-events: none`, `user-select: none`, hidden from AT.

## Design principles

1. Plain HTML is the primary authoring API; CSS (usually via Tailwind) is the
   styling input — the engine never parses class names.
2. Numeric style values represent cells: 1 cell = 0.25rem (see D1).
3. Application frameworks retain ownership of the light DOM.
4. Native interactive elements remain native, visible elements.
5. Shadow DOM contains only decoration and internal infrastructure.
6. Layout uses deterministic integer geometry.
7. Structural styling is controlled; theming is exposed deliberately.
8. DOM/style changes are batched into at most one layout per animation frame.
9. Styles the engine doesn't understand are ignored for layout (they may still
   paint normally, e.g. colors), so app-specific classes coexist fine.
10. Favor a small, understandable layout engine over complete CSS compatibility.

## Cell semantics

Normative details (unit scales, rounding, box model, margins, insets, border
glyphs, typography locking, inline handling) live in
`../specs/cell-model.md`. Summary:

```text
w-20     → 20 columns          (5rem ÷ 0.25rem)
h-5      → 5 rows
px-1     → 1 column left and right
py-1     → 1 row above and below
gap-2    → 2 cells
m-1      → 1-cell margin       (adjacent-sibling collapsing only)
top-1    → pushed down 1 row   (with position: relative)
border-2 → 2 concentric border cells (border scale: 1px = 1 cell)
```

Lengths round to the nearest cell, ties up (`p-px` → 0, `p-0.5` → 1). All
geometry is integer:

```ts
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

Fractional flexible space distributes remainder cells deterministically in
document order (documented, tested).

## MVP scope

### Supported computed-style inputs

The engine reads (via the measure/write cycle) and interprets:

```text
display: block | flex | grid | table | none   (inline → text run, not a layout node;
  table-internal displays → roles: rows, cells, groups, captions, columns)
flex-direction: row | column (+ -reverse), flex-wrap (+ wrap-reverse)
flex-grow, flex-shrink, flex-basis, order
justify-content: start | center | end | space-between | space-around | space-evenly
align-items: start | center | end | stretch
width, height (incl. min/max/fit-content), min/max-width, min/max-height
  (px → cells; %, auto, intrinsic keywords — min-*: auto is the flex
  automatic minimum)
padding, margin (per side), gap (row/column)   (percent supported)
border-*-width (cells per edge) + per-side border-style/color → glyphs + color
color, background-color                        (paint-only, passed through)
overflow: hidden | clip                        (normalized to clip)
white-space: nowrap | pre (pre preserves whitespace), text-overflow: ellipsis
grid-template-columns/rows (cells, %, fr, minmax, repeat, auto-fill/fit,
  min()/max(), named lines, subgrid), grid-template-areas, grid-auto-*,
  grid-auto-flow, grid-column/row placement (numbers, spans, names),
  justify-items/justify-self; inline-element horizontal padding
line-height (leading-*) → rows per wrapped line; letter-spacing (tracking-*)
  → extra cells per character, inline elements included
position: static | relative | absolute (+ fixed → host, sticky → relative)
top/right/bottom/left, inset-*                 (per specs/positioning.md,
                                                incl. inline relative shifts)
table-layout, border-collapse (lattice) | separate + border-spacing,
  caption-side, vertical-align on cells (align-* scan + valign/align
  attributes), colspan/rowspan/span attributes  (specs/table.md)

# Specified but NOT implemented yet (their milestones):
aspect-ratio                                   (needs cell-metric ratio; spec TBD)
```

Utility classes this covers in practice: `block hidden flex flex-row flex-col
grid grow shrink basis-* order-* justify-* items-* w-* h-* min-* max-* p-* m-*
gap-* truncate whitespace-nowrap leading-* tracking-* relative
top/right/bottom/left-* border* text-* bg-* overflow-hidden table-*
border-collapse border-separate border-spacing-* caption-* align-*` and friends.
Explicitly not supported: `space-x/y-*` (superseded by `gap-*`), font
size/family utilities on descendants (see cell-model spec).

Every variant (`lg:`, arbitrary variants, `group-*`…) _resolves_ for free,
since the browser applies the cascade before we read. But _changes_ in dynamic
state (`hover:`, `focus:`, animations) on layout-affecting properties still
need change detection — see the dynamic-style question in the architecture doc.
Paint-only dynamic variants (colors) work with no engine involvement.

### Native content

Text, `<a>`, `<button>`, single-line `<input>`, nested containers.

### Deferred

Scrolling (including proper `position: sticky`); parent–child margin
collapsing; transforms (see architecture open questions); selects and
textareas; Unicode display-width; bidi/vertical text; background patterns;
broader Tailwind property coverage; virtualization.

### Never planned

`space-x/y-*` (use `gap-*`); descendant typography that changes cell metrics.

## Package structure (monorepo, current)

```text
packages/core/
├── src/
│   ├── element.ts            # <mono-wind> custom element host
│   ├── styles.css            # companion stylesheet
│   ├── types.ts              # CellStyle, LayoutNode, Insets/NullableInsets, defaults
│   ├── metrics.ts            # cell measurement, px→cells, rounding helpers
│   ├── style.ts              # computed-style reader (Typed OM + class-scan fallback)
│   ├── tree.ts               # DOM → LayoutNode tree
│   ├── layout.ts             # core: per-node sizing pipeline, block flow, intrinsics
│   ├── flex.ts               # flex row/column + §9.7 resolution (specs/flex.md)
│   ├── grid.ts               # grid placement, track sizing, areas, subgrid (specs/grid.md)
│   ├── table.ts              # table structure, column/row sizing, border lattice (specs/table.md)
│   ├── positioning.ts        # absolute/relative positioning pass (specs/positioning.md)
│   ├── wrap.ts               # greedy word-wrap for text leaves (lines + count)
│   ├── borders.ts            # border-run collection + glyph sets (pure, shared)
│   ├── warn.ts               # one-time developer warnings (silent deviations)
│   ├── render.ts             # writes geometry vars, paints border decorations (DOM)
│   ├── ascii.ts              # renders a laid-out tree as ASCII art (goldens + debug/AX)
│   ├── cdn.ts                # CDN entry: engine + companion CSS + @tailwindcss/browser
│   └── index.ts              # public exports
└── test/                     # vitest unit + golden + integration tests
packages/vite/                # standalone mode: @monowind/vite plugin (implemented)
# CDN mode is an extra IIFE build output of packages/core (dist/cdn.js)
```

Style, layout, wrap, and render stay independent of the custom element so
they can be tested without a browser (layout/wrap/metrics/render are fully
headless; style reading needs a DOM and is exercised via browser tests).

## Internal model

Current shapes in `packages/core/src/types.ts` — refer to the source for the
authoritative definitions. Summary:

- `LayoutNode { source, style, children, text, intrinsicWidth, intrinsicHeight, localRect }`
  — `text` holds a leaf's textContent (also captures inline-only mixed content
  like `<div>hello <span>world</span></div>`). `localRect` is parent-relative.
- `CellStyle` covers: display, flex direction/wrap/grow/shrink, justify/align
  items/self, width/height (`Size = cells | percent | auto`), min/max, padding
  (`Insets`), margin (`NullableInsets` — `null` = `auto`), gapX/gapY, border
  (`Insets`), borderStyle, borderColor, overflow (`visible | clip`), and
  paint-only color/backgroundColor reserved for the visual-system milestone.
  `position/insets/grid` fields aren't in yet — they land at their
  milestones.

An intrinsic-width cache (`WeakMap<LayoutNode, number>`) is used within a
single layout pass; multi-pass identity caching is future work.

## The measure/write cycle (replaces class parsing)

Once per animation frame, when dirty:

1. Set `measuring` attribute on host → companion stylesheet's geometry rules
   (guarded with `:not([measuring])`) stop applying.
2. Walk the light DOM; read each element via `computedStyleMap()` (Typed OM),
   falling back per the architecture doc where unsupported. Convert px → cells
   using `0.25 × measured root font-size`. Build/update `CellStyle`s.
3. Compute integer layout headlessly.
4. Write geometry custom properties and repaint decorations; clear `measuring`.

All pre-paint — no visible flash. Never toggle `display: none` for measurement
(blurs focus, resets scroll state).

## Element positioning

```css
mono-wind [data-mw-layout] {
  position: absolute;
  box-sizing: border-box;
  left: calc(var(--mw-x) * var(--mw-cell-width));
  top: calc(var(--mw-y) * var(--mw-cell-height));
  width: calc(var(--mw-w) * var(--mw-cell-width));
  height: calc(var(--mw-h) * var(--mw-cell-height));
}
```

Parent-relative coordinates; each element is the containing block for its
children — matches the DOM hierarchy, no reparenting. Root-level children
resolve against the nearest _positioned_ ancestor, so the host itself must be
`position: relative` (set in the shadow/companion styles). The component
sets/removes only properties it owns, never rewrites `style` wholesale.

## Character-grid measurement

Measure the actual rendered font (canvas or probe element), not `1ch` assumptions:

```ts
interface CellMetrics {
  width: number;
  height: number;
}
const columns = Math.floor(hostWidth / cellMetrics.width);
```

For content-driven height: fix width, lay out, size host to resulting rows.
Typography (`--mw-font-family`, `--mw-font-size`, `--mw-line-height` — default
`1` — and `--mw-letter-spacing`, which participates in cell width) is
configurable **on the host only**; the companion stylesheet locks it on all
descendants (see cell-model spec). Re-measure on `document.fonts.ready` and
typography changes.

## Layout strategy (build order)

Done (working in MVP):

1. Text intrinsic measurement (`text.length` cells; single-column glyphs only)
2. Block layout with adjacent-sibling margin collapsing
3. Flex row + column (grow, shrink, wrap, gap, fixed and auto margins)
4. Padding, min-height/min-width, alignment (justify/align-items/self)
5. Positioning and insets, including inline relative shifts
   (`specs/positioning.md`)

Still to do (later milestones):

6. Intrinsic size for native controls (input widths, etc.)
7. Overflow clipping / scrolling (incl. proper `position: sticky`)
8. Grid layout (against `specs/grid.md`)
9. Table layout (against `specs/table.md` — the milestone after grid)

## Native interactive elements

Original nodes get geometry + normalized visuals — never converted to inert text:

```css
mono-wind :is(button, input, select, textarea) {
  /* Padding, margin, border-width, and box-sizing are owned by the engine's
   * geometry rules on `[data-mw-laid-out]` — repeating them here would fight
   * author styles at measure time. We only strip UA chrome that isn't
   * already covered. */
  border-radius: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  line-height: inherit;
  text-align: inherit;
  appearance: none;
}
```

```text
button  → [ Save ]        (brackets painted by decoration layer;
input   → [hello      ]    native element owns the full hit rectangle)
link    → colored/underlined text
```

Must preserve: tab order, focus and `:focus-visible`, Enter/Space activation,
pointer targets, selection and caret, clipboard, form submission,
`disabled`/`required`/`aria-*`. Relayout must never recreate a focused control.

## Decoration renderer

Paints only: borders/intersections, separators, visible backgrounds, control
framing, other non-semantic glyphs.

Current shape (`packages/core/src/render.ts`): `BorderRun { glyph, x, y, length, color }`
— each edge of each ring is emitted as one run, painted as a `<span>` with
`text-content = glyph.repeat(length)`. Multi-cell borders paint as concentric
rings (`border-2`, `border-3`, …), same style per ring. Border intersections
(`├ ┤ ┬ ┴ ┼`) and merged nested borders are visual-system milestone work.

## Observation and scheduling

Update sources: `ResizeObserver` (host size), `MutationObserver` (children, text,
class/attrs), `input`/`change` events (control state), font-loading events (cell
metrics), and — per the open question on dynamic styles — possibly pointer/focus
events for `:hover`/`:focus`-driven layout changes.

Batch into one rAF layout; filter out mutations caused by the component's own
writes (owned `data-*` and custom properties) to prevent feedback loops.

## Accessibility

- Real native elements stay in the accessibility tree; decoration is
  `aria-hidden`, box-drawing glyphs never exposed as content, no duplicated
  controls.
- Logical DOM/tab order preserved even when visual placement differs; verify
  visual order doesn't mislead relative to reading order.
- Focus indicators visible in the ASCII style; hit areas usable.
- Test keyboard-only and with at least one screen reader.

## Testing strategy

**Status (2026-08-26): all four layers below are implemented.**

- Unit + golden: `packages/core/test/` (Vitest, headless) — layout math,
  rounding, wrap, and `renderAscii` golden outputs (the ASCII renderer is
  also exported as a debugging/agent tool).
- Story tests: every story in `apps/storybook` runs as a Vitest
  browser-mode test via `@storybook/addon-vitest` (part of `pnpm check`),
  across a Chromium + Firefox + WebKit matrix — Playwright's Firefox
  (pre-157) has no Typed OM, so it exercises the class-scan fallback
  against a real engine. The fallback branches also have deterministic
  headless coverage in `packages/core/test/style.test.ts` (happy-dom has
  no Typed OM either).
- Visual regression: `pnpm test:visual` — one screenshot per story,
  auto-discovered, captured inside the official Playwright Docker image
  (byte-stable across machines; JetBrains Mono self-hosted in
  `assets/fonts/` so glyph rendering is pinned). CI runs both suites
  (`.github/workflows/ci.yml`).
- Example smoke tests: `apps/example-html` (CDN mode) and
  `apps/example-tailwind` (native mode) each boot and assert layout +
  Tailwind compilation.

- **Unit**: style interpretation (mocked reader), intrinsic measurement inputs,
  block/flex math, integer rounding + remainder distribution, min/max, border
  edge-bit mapping.
- **Golden output**: `renderDecorations(layout)` compared against ASCII-art
  strings.
- **Browser (Playwright)**: responsive resize, real font metrics, DPR variations,
  hit targets, keyboard nav, focus/caret/selection preservation, React controlled
  inputs and reconciliation, dynamic children, SSR hydration, accessibility tree,
  decoration alignment. Plus a Typed OM availability matrix (Chromium / WebKit /
  Gecko).

## Milestones

1. **Static proof of concept** — element registered, measured grid, text-only
   blocks, one border style, resize re-render; motivating example with static
   text. _Includes the load-bearing spike: measure/write cycle + Typed OM reads
   proven against real Tailwind v4 output._
2. **Flexbox MVP** — row/column, padding/gaps/margins, fixed/min/max
   dimensions, grow/shrink, wrap, justification/alignment, deterministic
   rounding, nesting. _Implemented; normative spec extracted afterwards into
   `specs/flex.md` (the spec-first rule slipped here — hold the line for
   grid: write `specs/grid.md` BEFORE implementing Milestone 3)._
3. **Grid + positioning** — cell-based `grid-template-columns/rows`, gap,
   placement subset (write `specs/grid.md` first); plus `position`
   (static/relative/absolute; fixed → host-anchored, sticky → relative for
   now) and inset utilities per `specs/positioning.md`. _Core implemented
   2026-08 (placement incl. dense, §11 track sizing, auto-fill/fit,
   min()/max() breadths, alignment), then the §10.1 grid-area containing
   block for absolute children, named lines + `grid-template-areas`, and
   subgrid — the grid milestone is functionally complete; remaining
   grid deviations are listed in `specs/grid.md`. Inline-fidelity batch
   also landed: quantized
   horizontal padding on inline elements and `white-space: pre`
   preservation (see cell-model deviations 5 and 8). Still-deferred
   deviations ranked by expected hit-rate: Unicode width (Milestone 7),
   `calc()` in track lists, `text-center` (fundamental — fractional
   per-line offsets). Authored descendant `font-size` now warns once
   (class + inline-style scan in `readCellStyle`). Reader-overhaul idea
   investigated and REJECTED: reading styles under a `display: none`
   ancestor returns computed values for everything (probed — `50%`,
   `auto`, percent insets, full grid templates, no Typed OM needed) and
   could have deleted the degrid trick and every used-value-trap class
   scan — but a synchronous hide/read/restore destroys the user's text
   selection in Firefox (probed; the very engine it would serve — focus
   survives, Chromium/WebKit keep selection), restarts CSS
   animations/transitions in content, and costs a per-pass layout-tree
   rebuild vs Typed OM's zero-layout reads. The real simplification
   event is dropping Firefox pre-157 support, which deletes the
   fallback scans and converges on the single Typed OM path for free._
4. **Tables** — DONE (`table.ts`, spec'd first in `specs/table.md`):
   automatic + fixed layout with percent inflation, colspan/rowspan
   (`rowspan="0"` included), row-group reordering, captions,
   `border-collapse` as a shared junction-glyph lattice (`├ ┼ ┤`) and
   `border-separate` + spacing, `vertical-align` via class scan.
   Also: percent heights in cells (the legacy second pass), legacy
   `align`/`valign` attributes, `border-hidden`, fixed-layout auto-width
   fallback, percent width utilities (`w-1/2`, `w-full`, `w-[N%]`) in
   the no-Typed-OM class-scan fallback, and a companion reset for the
   UA's `th`/`caption` centering.
5. **Native interaction** — links, buttons, inputs, focus states,
   keyboard/pointer, forms; React example + integration tests.
6. **Visual system** — colors, border styles/widths per the cell-model glyph
   mapping, intersections, control framing, theme variables, public parts;
   hover/focus/selected/disabled states (requires settling the
   dynamic-style-detection question).
7. **Production hardening** — wrapping/clipping, Unicode width (two
   distinct problems: legitimately wide characters — CJK, emoji — get
   wcwidth-style 2-cell counting that browsers agree with; glyphs MISSING
   from the font render with unpredictable fallback advances that no
   counting rule can model — that lands as font-coverage guidance and
   possibly a dev-mode width-mismatch warning, not a fix), nested border
   merging (touching perpendicular borders can junction automatically —
   pure glyph selection atop the table lattice machinery; parallel
   doubled borders stay two lines, as in CSS) and CSS gap decorations
   (`specs/gap-decorations.md` — `rule-*` utilities mirroring
   css-gaps-1 into `--mw-*` props until browser support is universal),
   scrolling (including proper `position: sticky`, which behaves
   as `relative` until then), performance, incremental layout where
   justified, a11y audit.
8. **Playground (post-MVP)** — a Tailwind Play-style in-browser editor
   (`apps/play` → play.monowind.benface.com): live HTML editing rendered
   through `<mono-wind>`, shareable URLs. The CDN bundle (engine +
   `@tailwindcss/browser`) is already exactly the required runtime, so this
   is mostly editor UI.
9. **Server-side rendering (post-MVP)** — pre-laid-out output so first paint
   doesn't need JS. Requires (a) a bundled reference monospace font with
   known metrics so cell width is deterministic on the server, (b) a fixed
   set of breakpoints emitted as `@media` blocks with per-breakpoint
   `--mw-*` custom-property values, (c) client hydration that re-lays out
   only when the user's actual metrics or viewport fall outside the assumed
   set. Trivial SSR (emit DOM, let the client engine lay it out on
   hydration, keep `visibility: hidden` until then) works today with no
   engine changes.

## Key technical risks

- **Typed OM availability** (low risk as of 2026-08): Chromium and Safari 16.4+
  ship it; Firefox ships it in 157 (in Nightly now). Pre-157 Firefox uses a
  minimal sizing-utility class parser as a temporary polyfill. See architecture
  doc.
- **Dynamic style detection**: `:hover`/animation-driven computed-style changes
  have no observer; the transition-event trick also risks a feedback loop with
  our own geometry writes. Needs decision by the visual-system milestone.
- **Unicode width**: string length ≠ column width. MVP supports single-column
  glyphs only; document it.
- **Font consistency**: not every "monospace" font renders all glyphs at one
  width. Measure the real font; test box-drawing fallback glyphs; consider
  recommending/bundling a known-good font.
- **Framework ownership**: never mutate child structure; restrict writes to owned
  properties, safe metadata, shadow content.
- **Observer loops**: filter own mutations; batch.
- **Native input appearance**: normalize without breaking autofill, password
  fields, usability, or a11y.
- **Visual vs DOM order**: flex justification is safe; avoid/constrain future
  reordering utilities.

## Definition of MVP completion

- Motivating example renders accurately at multiple viewport widths.
- Resize relayout stable and visibly aligned.
- Nested row/column flex in integer cells; basic grid templates in integer
  cells.
- Native link, button, and controlled React input fully interactive; focus,
  caret, selection survive resizing.
- React owns and reconciles the original DOM without warnings.
- Decoration absent from the accessibility tree.
- Style interpretation, layout, and border painting deterministically tested.
- Works in plain HTML with one module import + one stylesheet import (plus the
  user's Tailwind setup, in native mode).

## First implementation slice

Smallest vertical slice before broadening:

1. Register the element; measure cell size.
2. **Spike the measure/write cycle**: read `display`, `justify-content`,
   `align-items`, `min-height`, `padding`, border presence from real Tailwind v4
   output via Typed OM (with the `measuring`-attribute toggle).
3. Build the layout tree from the light DOM.
4. Compute parent-relative integer rects.
5. Position the original nodes.
6. Paint the border in the decoration layer.
7. Relayout via `ResizeObserver`.
8. Add a button; verify native interaction.
9. Render the same example from React; verify state/focus retention.

Only then expand into more properties, border intersections, input framing, and
Unicode handling.
