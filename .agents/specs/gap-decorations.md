# Spec: gap decorations (rules)

Status: implemented (`rules.css` utilities; engine painting via
`collectGapRuleRuns` in `borders.ts`, wired into flex and grid). The
normative source is CSS Gaps Level 1 (css-gaps-1), which generalizes
multicol's `column-rule-*` to flex and grid gaps and adds
`row-rule-*`. Shipped unflagged in Chrome/Edge 149 (flagged trial since
139); no Firefox or WebKit support, and Tailwind has no utilities for
it.

## Motivation

The author-controlled way to draw connected separator lines between
flex/grid items — the spec-faithful alternative to `border-l` on a
child, which renders as an unjoined crossing (see nested-border-merging
in the plan). A 1px rule in a 1-cell gap maps perfectly onto a `│`/`─`
run, junctioned into surrounding borders with the table tee machinery.

## Utilities

Named after the `gap-x`/`gap-y` axis convention (`rule-x` decorates
column gaps — vertical lines — like `gap-x` sizes them):

| class                                                                        | effect                                                                     |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `rule-x`, `rule-x-<n>`                                                       | column-rule width 1px / `<n>` px                                           |
| `rule-y`, `rule-y-<n>`                                                       | row-rule width 1px / `<n>` px                                              |
| `rule`, `rule-<n>`                                                           | both axes                                                                  |
| `rule-solid` / `rule-dashed` / `rule-dotted` / `rule-double`                 | style, both axes                                                           |
| `rule-<color>`                                                               | color, both axes (default `currentColor`, like borders)                    |
| `rule-break-none` / `rule-break-normal` / `rule-break-intersection`          | where segments break at gap intersections (both axes)                      |
| `rule-inset-<n>`                                                             | retract every segment endpoint by `<n>` px (both axes, all endpoint kinds) |
| `rule-visibility-all` / `rule-visibility-around` / `rule-visibility-between` | `rule-visibility-items`: which segments paint next to empty grid areas     |

Widths and insets quantize like borders (1px = 1 cell). Per-axis
style/color/break/inset variants are deferred until a need shows up.

## Custom-property contract

Each utility sets the real CSS property AND mirrors it into an `--mw-*`
custom property, one per longhand:
`--mw-rule-x-width`, `--mw-rule-x-style`, `--mw-rule-x-color`, and the
`-y` triple. The engine reads only the mirrors (readable via
`getComputedStyle` in every browser); the real properties are set for
the day css-gaps-1 is universal, when the mirrors can be dropped with no
class-name change. The `column-rule-*` longhands compute everywhere
already (multicol legacy); `row-rule-*` is written where supported.

The mirrors MUST be registered with `@property { inherits: false }` —
custom properties inherit by default, and an inherited rule width would
leak decorations into nested flex/grid containers. The color default
(`currentColor`, like borders) resolves at READ time against the
container's computed `color`: a CSS-side default can't work — an
`initial-value: currentColor` is illegal (not computationally
independent), and engines disagree on absolutizing `currentColor` in
registered `<color>` properties (probed: Firefox/WebKit resolve it,
Chromium keeps the keyword).

Excerpt from `rules.css` (imported by the companion `styles.css`, so
every build-step consumer reaches it via `@import "monowind"` inside
their Tailwind entry, where `@utility` compiles; plain-CSS consumers
drop the unknown at-rule harmlessly and `@property` survives as real
CSS. The CDN keeps injecting the companion as a plain `<style>` —
immediate, no compile tick — and injects `rules.css` separately as
`<style type="text/tailwindcss">`, the kind `@tailwindcss/browser`
compiles; no consumer-visible difference):

```css
@property --mw-rule-x-width {
  syntax: "<length>";
  inherits: false;
  initial-value: 0px;
}
@property --mw-rule-x-style {
  syntax: "solid | dashed | dotted | double";
  inherits: false;
  initial-value: solid;
}
/* … the other four … */

@utility rule-x {
  column-rule-width: 1px;
  --mw-rule-x-width: 1px;
}
@utility rule-x-* {
  column-rule-width: calc(--value(integer) * 1px);
  --mw-rule-x-width: calc(--value(integer) * 1px);
}
@utility rule-dashed {
  column-rule-style: dashed;
  row-rule-style: dashed;
  --mw-rule-x-style: dashed;
  --mw-rule-y-style: dashed;
}
/* … */
```

Width utilities set no style: Tailwind emits utilities alphabetically,
so `rule-dashed` sorts before `rule-x` and a `solid` there would win
(probed). The `solid` default lives in the `@property` initial values
instead — the same reason Tailwind's border width utilities rely on
preflight's `border-style: solid`. No native default is needed: the
companion neutralizes native rule painting on laid-out containers
outright (see Rendering).

## Rendering

A rule paints in each gap between adjacent items of the flex/grid
container, as a run of border glyphs (same style tables from
`cell-model.md`), centered in the gap (extra cells split like alignment,
floor on the leading side). Flex bands are the actual space between
adjacent item rects — whatever gap, justify-content, and margins
produced — per line (row rules between lines span the content width);
grid bands are the gutters between tracks, spanning the grid's extent.
Native css-gaps rules are neutralized on laid-out containers (the
engine paints the glyphs; a supporting browser must not double-paint
fractional ones). The used gap in a ruled axis floors at the rule
width — `rule` alone behaves as `gap-1 rule` — so a rule always has
cells to paint in (deviation 1). Crossing rules junction (`┼`), and a
rule that reaches the content edge through zero padding tees into the
container's own innermost border ring (`┬ ┴ ├ ┤`) — the shared
junction-glyph machinery in both cases.

### Segments (rule-break, rule-inset, rule-visibility-items)

A grid gap band divides into STRIPS along its length: one per crossing
track (the cells beside it), one per crossing gap. Coverage (probed in
Chromium 151, the only engine shipping css-gaps):

- A track strip is dropped when an item spans ACROSS the gap there
  (the gap doesn't exist inside a spanning item), or when
  `rule-visibility-items` drops it: `between` needs both adjacent cells
  occupied, `around` at least one, `all` (and grid's `normal`) always
  paints. (`normal` means `between` only in multicol, which monowind
  doesn't have.)
- A crossing-gap strip is covered per `rule-break`: `normal` (initial)
  iff BOTH neighboring track strips are covered (probed: a rule stops
  flush at a T intersection, e.g. against a spanning item);
  `intersection` never (each cell strip is its own segment);
  `none` iff at least one neighbor is covered (probed: the rule runs
  through the crossing strip up to a spanning item's edge).
- Consecutive covered strips merge into segments; `rule-inset` then
  retracts each segment endpoint by its cell count (cap and junction
  endpoints alike — the per-endpoint longhands are deviation 2). An
  emptied segment disappears.

Flex containers: `normal` behaves as `none` (continuous bands — no
intersection breaks by default) and `rule-visibility-items` is scoped
to grid/multicol, per css-gaps. Explicit `rule-break: intersection`
breaks a wrapped container's row-gap bands at the union of the two
adjacent lines' column gaps (probed in Chromium: a T from either side
counts); the per-line column bands already end flush at their line.
`rule-inset` retracts every band's endpoints.

## Deviations from css-gaps-1

1. Rules take layout space: the used gap floors at the rule width (in
   CSS rules never affect layout — a rule wider than its gap overflows
   the items, one with no gap is invisible). Same principle as borders
   occupying whole cells: ink needs cells.
2. `rule-inset` is one uniform value: the per-axis and per-endpoint
   longhands (`column-rule-inset-cap-start`, …), `overlap-join`,
   percentages, and negative insets are unsupported until needed. Same
   for per-axis `rule-break`/`rule-visibility-items` and repeat()/list
   values.
3. Everything in `cell-model.md` (quantization, glyph fallbacks)
   applies.
