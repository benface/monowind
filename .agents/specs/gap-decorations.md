# Spec: gap decorations (rules)

Status: draft, future work (parked with nested border merging in the
plan; builds on the table milestone's junction machinery) — the utility
names and custom-property contract are designed now so classes are
stable from day one. The normative source is CSS Gaps Level 1 (css-gaps-1), which
generalizes multicol's `column-rule-*` to flex and grid gaps and adds
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

| class                                                        | effect                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `rule-x`, `rule-x-<n>`                                       | column-rule width 1px / `<n>` px                        |
| `rule-y`, `rule-y-<n>`                                       | row-rule width 1px / `<n>` px                           |
| `rule`, `rule-<n>`                                           | both axes                                               |
| `rule-solid` / `rule-dashed` / `rule-dotted` / `rule-double` | style, both axes                                        |
| `rule-<color>`                                               | color, both axes (default `currentColor`, like borders) |

Widths quantize like borders (1px = 1 cell). Per-axis style/color
variants, `rule-outset`, and `rule-break` are deferred until a need
shows up.

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
leak decorations into nested flex/grid containers.

Sketch (lives in the core companion `styles.css`: every build-step
consumer `@import`s it inside their Tailwind entry, where `@utility`
compiles; plain-CSS consumers drop the unknown at-rule harmlessly and
`@property` survives as real CSS. The CDN keeps injecting the companion
as a plain `<style>` — immediate, no compile tick — and injects only
this block as a second `<style type="text/tailwindcss">`, the kind
`@tailwindcss/browser` compiles; no consumer-visible difference):

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
preflight's `border-style: solid`. The real `column-rule-style` default
for native-support browsers is pinned at implementation time (likely a
companion rule).

## Rendering

A rule paints in each gap between adjacent items of the flex/grid
container, as a run of border glyphs (same style tables from
`cell-model.md`), centered in the gap (extra cells split like alignment,
floor on the leading side). The used gap in a ruled axis floors at the
rule width — `rule` alone behaves as `gap-1 rule` — so a rule always
has cells to paint in (deviation 1). Where a rule meets the container's
border or a crossing rule, the junction glyph machinery picks
tees/crosses.
Details (span extent, behavior at spanning grid items) follow css-gaps-1
and are pinned at implementation time.

## Deviations from css-gaps-1

1. Rules take layout space: the used gap floors at the rule width (in
   CSS rules never affect layout — a rule wider than its gap overflows
   the items, one with no gap is invisible). Same principle as borders
   occupying whole cells: ink needs cells.
2. `rule-outset`, `rule-break`, `rule-paint-order`, and repeat()/list
   values are unsupported until needed.
3. Everything in `cell-model.md` (quantization, glyph fallbacks)
   applies.
