# monowind MVP — implementation plan

Adapted from the original pre-`monowind` plan (drafted with ChatGPT), amended to
match the decisions in `../architecture/core-architecture.md` — chiefly **D1: the
engine reads computed styles instead of parsing class names**. Read that document
first; this one is the build plan.

## Goal

A framework-independent Web Component that turns ordinary HTML plus Tailwind
utility classes into a responsive character-cell interface in the browser:

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
    <style>…</style>
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
interface Rect { x: number; y: number; width: number; height: number }
```

Fractional flexible space distributes remainder cells deterministically in
document order (documented, tested).

## MVP scope

### Supported computed-style inputs

The engine reads (via the measure/write cycle) and interprets:

```text
display: block | flex | grid | none      (grid in its own milestone;
                                          inline → text run, not a layout node)
flex-direction: row | column
flex-grow, flex-shrink
justify-content: start | center | end | space-between
align-items: start | center | end | stretch
width, height, min/max-width, min/max-height   (px → cells; % and auto via Typed OM)
padding, margin (per side), gap (row/column)
position: static | relative + top/right/bottom/left  (cell offsets)
border-*-width (cells per edge) + border-style/color → glyph set + decoration
grid-template-columns/rows, placement          (subset TBD by specs/grid.md)
color, background-color, border-color          (paint-only, passed through)
overflow: hidden
```

Utility classes this covers in practice: `block hidden flex flex-row flex-col
grid grow shrink justify-* items-* w-* h-* min-* max-* p-* m-* gap-* relative
top/right/bottom/left-* border* text-* bg-* overflow-hidden` and friends.
Explicitly not supported: `space-x/y-*` (superseded by `gap-*`), typography
utilities on descendants (see cell-model spec).

Every variant (`lg:`, arbitrary variants, `group-*`…) *resolves* for free,
since the browser applies the cascade before we read. But *changes* in dynamic
state (`hover:`, `focus:`, animations) on layout-affecting properties still
need change detection — see the dynamic-style question in the architecture doc.
Paint-only dynamic variants (colors) work with no engine involvement.

### Native content

Text, `<a>`, `<button>`, single-line `<input>`, nested containers.

### Deferred

Flex wrapping; scrolling; `position: absolute/fixed/sticky`; parent–child
margin collapsing; transforms (see architecture open questions); selects and
textareas; Unicode display-width; bidi/vertical text; background patterns;
broader Tailwind property coverage; virtualization.

### Never planned

`space-x/y-*` (use `gap-*`); descendant typography that changes cell metrics.

## Package structure (monorepo)

```text
packages/core/
├── src/
│   ├── element.ts            # custom element host (thin; wires the pieces)
│   ├── styles.css            # companion stylesheet (normalization, geometry rules)
│   ├── style/
│   │   ├── read-styles.ts    # measure-mode computed-style reader (Typed OM + fallback)
│   │   └── style-model.ts    # CellStyle types + px→cell conversion
│   ├── layout/
│   │   ├── build-tree.ts
│   │   ├── layout.ts
│   │   ├── flex.ts
│   │   ├── constraints.ts
│   │   └── text-measurement.ts
│   ├── rendering/
│   │   ├── buffer.ts
│   │   ├── borders.ts
│   │   ├── decorations.ts
│   │   └── position-elements.ts
│   └── scheduling/
│       └── scheduler.ts
├── tests/
└── examples/                 # vanilla + react
packages/vite/                # standalone mode (later)
# CDN mode is an extra IIFE build output of packages/core, not a package
```

Style reading, layout, and decoration rendering stay independent of the custom
element so they can be tested without a browser (layout/rendering fully headless;
style reading behind an interface with a mock).

## Internal model

```ts
interface LayoutNode {
  source: Element | Text
  style: CellStyle            // interpreted, cell-unit style (from computed CSS)
  children: LayoutNode[]
  intrinsicWidth: number
  intrinsicHeight: number
  localRect: Rect             // parent-relative
  globalRect: Rect            // for border painting, clipping, hit testing, debug
}
```

`WeakMap<Node, LayoutNode>` retains identity for incremental work later.

```ts
interface CellStyle {
  display: "block" | "flex" | "grid" | "none"   // inline content never becomes a node
  flexDirection: "row" | "column"
  flexGrow: number
  flexShrink: number
  justifyContent: "start" | "center" | "end" | "space-between"
  alignItems: "start" | "center" | "end" | "stretch"
  width?: Size                // cells | percent | auto
  height?: Size
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  padding: Insets
  margin: Insets              // may hold "auto" markers; sibling collapsing only
  gapX: number
  gapY: number
  border: Insets              // border cells per edge (0..n)
  borderStyle: "solid" | "double" | "dashed" | "dotted"
  position: "static" | "relative"
  insets: Insets              // cell offsets, applied post-layout
  overflow: "visible" | "hidden"
  // grid fields TBD by specs/grid.md (template columns/rows, placement)
  // paint-only passthrough for the decoration layer:
  color?: string
  backgroundColor?: string
  borderColor?: string
}
```

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
resolve against the nearest *positioned* ancestor, so the host itself must be
`position: relative` (set in the shadow/companion styles). The component
sets/removes only properties it owns, never rewrites `style` wholesale.

## Character-grid measurement

Measure the actual rendered font (canvas or probe element), not `1ch` assumptions:

```ts
interface CellMetrics { width: number; height: number }
const columns = Math.floor(hostWidth / cellMetrics.width)
```

For content-driven height: fix width, lay out, size host to resulting rows.
Typography (`--mw-font-family`, `--mw-font-size`, `--mw-line-height` — default
`1` — and `--mw-letter-spacing`, which participates in cell width) is
configurable **on the host only**; the companion stylesheet locks it on all
descendants (see cell-model spec). Re-measure on `document.fonts.ready` and
typography changes.

## Layout strategy (build order)

1. Text and intrinsic control measurement
2. Block layout
3. Horizontal flex
4. Vertical flex
5. Padding and gaps
6. Margins (adjacent-sibling collapsing)
7. Fixed dimensions
8. Min/max constraints
9. Grow/shrink
10. Alignment and justification
11. Relative-position cell offsets
12. Clipping

(Grid layout follows as its own milestone, against `specs/grid.md`.)

## Native interactive elements

Original nodes get geometry + normalized visuals — never converted to inert text:

```css
mono-wind :is(button, input, select, textarea) {
  box-sizing: border-box; margin: 0; border: 0; border-radius: 0; padding: 0;
  color: inherit; background: transparent; font: inherit; line-height: inherit;
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

```ts
interface Cell { glyph: string; foreground?: string; background?: string }
const enum Edge { Up = 1, Right = 2, Down = 4, Left = 8 }
```

Edge-bit combinations map to `├ ┤ ┬ ┴ ┼` etc. Render runs of identically styled
cells as single text spans, not one span per cell. Empty undecorated cells
produce no DOM.

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
   text. *Includes the load-bearing spike: measure/write cycle + Typed OM reads
   proven against real Tailwind v4 output.*
2. **Flexbox MVP** — row/column, padding/gaps/margins, fixed/min dimensions,
   grow/shrink, justification/alignment, relative insets, deterministic
   rounding, nesting. Write `specs/flex.md` first.
3. **Grid** — cell-based `grid-template-columns/rows`, gap, placement subset.
   Write `specs/grid.md` first.
4. **Native interaction** — links, buttons, inputs, focus states,
   keyboard/pointer, forms; React example + integration tests.
5. **Visual system** — colors, border styles/widths per the cell-model glyph
   mapping, intersections, control framing, theme variables, public parts;
   hover/focus/selected/disabled states (requires settling the
   dynamic-style-detection question).
6. **Production hardening** — wrapping/clipping, Unicode width, nested border
   merging, scrolling, performance, incremental layout where justified, a11y
   audit, SSR docs.

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
