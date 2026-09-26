# Spec: flex layout

Status: normative, extracted from the implementation (`flex.ts`) and its
tests after Milestone 2 shipped. Cell-unit fundamentals (rounding, box
model, margins) live in `cell-model.md`; this spec covers the flex
algorithm itself. Deviations from CSS Flexbox are listed at the end.

## Scope

`display: flex` with `flex-direction: row | column` and
`flex-wrap: nowrap | wrap` (wrap in row direction only — see Deviations).
All sizes and positions are integer cells.

## Definitions

- **Main axis**: horizontal for row, vertical for column. **Cross axis**:
  the other one.
- **Intrinsic outer width** of a node, min- or max-content: border +
  padding + the intrinsic inner width, where inner is — for a text leaf,
  its longest unbreakable unit (a word under normal wrapping, a whole
  hard line under `nowrap`) at min-content and its unwrapped text at
  max-content; for a flex row, the sum of the children's contributions
  plus gaps (at min-content only when it can't wrap); for a grid or a
  table, its track or column sizing's; for anything else, the widest
  child's (at max-content, floats share a line and multicol multiplies
  by its columns). A child contributes its cell or
  min-/max-content width, else its own intrinsic outer width — a
  percent or `fit-content` width contributes as auto (css-sizing-3) —
  clamped by its fixed min/max. (Memoized per layout pass.)
- **Intrinsic height** of an item: the height it lays out to when given its
  allocated width (text wraps; containers stack), before any flex
  redistribution.

## Reading alignment

Each alignment property (`justify-content`, `align-content`,
`align-items`, `align-self`, `justify-items`, `justify-self`) reads as
its keyword — `self-start` and `left` as `start`, their ends as `end`,
`flex-start` and `flex-end` apart from them, as a reversed flex axis
swaps them alone (steps 7–9) and they are `start` and `end` elsewhere —
with css-align's overflow position beside it: `safe` (Tailwind's
`*-safe` utilities) sets the field's flag (`justifyContentSafe`, …),
which changes nothing while overflow alignment is always safe
(cell-model.md deviation 21), `unsafe` reads as the bare keyword, and
`legacy` (`justify-items`) drops out. A baseline is safe, and places
an item at the line edge its baseline group sits at, as `flex-start`
(`flex-end` for `last baseline`), and anything else — a grid item, an
out-of-flow child's static position — at its fallback `start` (`end`);
`align-content` reads it as `flex-start` (`end`) (deviation 2). Any other value warns once and reads as the property's
initial value (`normal`, or `auto` for `align-self` and
`justify-self`).

## Row algorithm

1. **Collect items** in visual order — sorted by CSS `order` (stable,
   document order ties), then reversed for `row-reverse`/`column-reverse`
   — with their base main sizes, grow/shrink factors, and margins (`auto`
   margins tracked separately from fixed ones). The base size follows CSS
   `flex-basis`: an explicit basis when set (notably `0%` from Tailwind's
   `flex-1`, which makes grow distribute ALL the space — equal columns;
   `content` is `max-content`, the item's own width aside, CSS §7.2.3),
   else the item's explicit width — cells, percent, or an intrinsic keyword
   — else its max-content size. The base itself is unclamped (step 3's
   loop applies the item's min/max-width); its hypothetical size is the
   base clamped by them. Percentages (including percent min/max like
   `max-w-full`) resolve against the container's content box.
2. **Wrap into lines** (only when `flex-wrap: wrap`): greedy, in document
   order. An item's placement width is its intrinsic width plus its FIXED
   margins (auto margins count as 0 here). An item moves to a new line when
   `used + gap + itemWidth` would exceed the container's inner width; the
   first item of a line is always placed, even if it alone overflows
   (matches CSS).
3. **Resolve main-axis sizes per line**: available space = inner width −
   gaps − fixed margins, `auto` margins counting as 0 (CSS §8.1). Then:
   - Extra space → distributed to items proportionally to their
     `flex-grow` factors (integer distribution, below). No grow factors →
     items keep intrinsic sizes. What flexing leaves goes to the
     main-axis `auto` margins (step 7), which take it before
     `justify-content` does — so a growing item leaves them none, as in
     all three engines (probed 2026-09-23).
   - Shortfall → shrink proportionally to `base × flex-shrink`.
     Items with `flex-shrink: 0` keep their base size; if everything
     is shrink-0, the line overflows (real CSS behavior).
   - Both directions run the CSS §9.7 **iterative clamping loop**: each
     round's results clamp to the item's own min/max main size; violators
     FREEZE at their clamped size and the remaining space is redistributed
     among the rest until nothing new violates. When clamps bind, the line
     may underfill (justify-content sees the leftover) or overflow.
   - **Automatic minimum size** (`min-width/height: auto`, the CSS
     default, §4.5): a flex item with visible overflow never shrinks below
     its min-content main size (longest breakable segment in a row; in a
     column, its content's own height — a container's items, a text
     leaf's lines — whatever height or `min-height` floor the item has),
     capped by its own width or height and its max-width or max-height —
     a `w-3` item holding a longer word stays 3 wide, the word
     overflowing, and two `h-15` items holding a line each shrink to
     share an `h-20` column, containers and aligned text leaves alike, as
     Chromium and Firefox lay them out (probed 2026-09-23; WebKit keeps a
     grid item at its height, and grows a `min-h-*` aligned leaf from its
     floor), save for a percent-height child (deviation 3). Non-visible
     overflow (e.g. `truncate`) or an explicit `min-w-0`/`min-h-0`
     disables it — exactly the CSS idiom for shrinkable/truncatable flex
     children.
4. **Lay out each item at its final width** (text re-wraps at that width,
   nested containers re-lay out).
5. **Line height**: the tallest item on the line, its fixed cross-axis
   margins included (auto ones count 0) — an auto-height row holding a
   `my-1` item is three rows tall. For a single `nowrap`
   line whose container has a bounded inner height (explicit `height` or
   `min-height`), the line stretches to that height, so cross-axis
   alignment sees the enforced size.
6. **Cross-axis stretch**: an item whose effective alignment is `stretch`
   (container `align-items` unless overridden by the item's `align-self`),
   with no explicit height and no cross-axis auto margins, is re-laid out
   with its height FORCED to the line height minus its fixed cross-axis
   margins, clamped by the item's own `min-height`/`max-height` (a
   percent against the container's inner height when that is bounded),
   per CSS; its own children see the final size.
7. **Main-axis placement**: offsets from `justify-content` (start /
   center / end / space-between / space-around / space-evenly; center
   floors the half-leftover; the space-* variants integer-distribute the
   leftover across gap slots — evenly uses n+1 equal gaps, around weights
   the edges at half, between splits the n−1 inner gaps), plus accumulated
   gaps, fixed margins, and auto-margin shares (leftover split equally per
   auto margin, integer-distributed). Under `row-reverse`/`column-reverse`
   `flex-start` and `flex-end` swap (items are already collected
   reversed), `normal` and a sole item's `space-between` packing to the
   main-start with them (their fallback), where `start`, `end`, `left`
   and `right` keep the writing mode's:
   `justify-end` packs a `flex-row-reverse` to the left,
   `justify-content: end` to the right (probed 2026-09-25, every
   engine).
   An overflowing line (a negative leftover, auto margins taking none)
   starts at the start edge whatever the keyword: overflow alignment is
   always safe (cell-model.md deviation 21), where CSS centers or ends
   it past the start edge, the space-* keywords falling back to start
   (probed 2026-09-24, every engine).
8. **Cross-axis placement**: cross-axis auto margins win (both auto →
   centered, floor; one auto → that side absorbs the space; an item
   taller than its line gets none, at the line's start, per CSS);
   otherwise the item's margin box aligns in the line (start 0, center
   floor, end flush), so `items-end mb-1` ends the item a row above the
   line's end, as all three engines place it (probed 2026-09-23); an
   item larger than its line sits at the line's start, like an
   overflowing line (step 7). The column's cross axis aligns the same
   way, with the left and right margins; grid items align in their
   areas with the same function. Under `wrap-reverse` the cross axis
   runs backwards: `flex-start` and `flex-end` swap, `start` and `end`
   (the `place-*` utilities) keeping the writing mode's, and an item
   `stretch` leaves short of its line (an explicit height, a
   `max-height`) sits at the line's end, `flex-start` being stretch's
   fallback. A column's items (its one line) and a text leaf's anonymous
   item flip alike, a stretched anonymous item keeping its text at its
   start (probed 2026-09-25, every engine).
9. **`align-content`** (multi-line only, i.e. `flex-wrap: wrap`, per CSS):
   with a bounded inner height taller than the lines, the leftover cross
   space is distributed with the shared offset math — start / center /
   end / space-between / space-around / space-evenly — or, for `stretch`
   (the CSS default `normal`), split across the LINES' heights with the
   integer distribution (each line's items then re-align/stretch within
   the grown line). Lines overflowing a definite height start at its
   top, as step 7 aligns an overflowing line; a `min-height` floor grows
   with them instead. Under `wrap-reverse` the cross axis runs
   backwards: the line order is reversed at collection time and
   `flex-start`/`flex-end` swap, the `flex-start` that `stretch` and a
   sole line's `space-between` fall back to included, where
   `start`/`end` keep the writing mode's —
   overflowing lines, which CSS runs past the top from the bottom edge
   (probed 2026-09-25, every engine), stack from the top here.
10. Line heights plus `row-gap` between lines add up to the container's
    content height.

## Column algorithm

Same shape, transposed, with these specifics:

- No wrapping (see Deviations). `wrap-reverse` on a row container stacks
  its lines from the bottom up.
- **First pass** lays every child out at the container's inner width (minus
  the child's fixed cross-axis margins); a child stretches to fill that
  width when its effective alignment is `stretch`, otherwise it shrinks to
  its intrinsic width.
- With a bounded inner height, main-axis sizes resolve exactly like the row
  main axis (grow, shrink, `flex-basis`, auto margins on the leftover,
  and the same unclamped-base rule: the base is the pre-min/max
  first-pass height, or the content height for an intrinsic basis
  (`content`, `max-content`, …) whatever the item's own height —
  a container item's content, never the `min-height` floor it fills —
  so e.g. an item's `min-h-*` never skews the distribution). A percent
  basis resolves against a DEFINITE container height only; against an
  auto height or a `min-height` floor it is the content height, as CSS
  §7.2.3 treats it as `content` (all three engines, probed 2026-09-23:
  `flex-1 h-10` in an auto-height column is one row, and `flex-1` items
  of one and three rows under `min-h-10` are 4 and 6). A child whose
  height changed from its base is re-laid out with the new height forced,
  so nested content (e.g. `items-center` inside a stretched child) sees the
  final size. Forced (flex-assigned) sizes are authoritative and skip
  resolution — which also means a percent or explicit width on a row item
  is never re-resolved against its own assigned size.
- Unbounded inner height → children take their hypothetical sizes (bases
  clamped by their own min/max); container content height is their sum
  plus gaps and fixed margins, and main-axis auto margins get no space.

## Integer distribution (shared)

Distributing N integer units across slots proportionally to weights:
compute the exact shares, floor them, then hand the remainder out one unit
at a time to the slots with the largest fractional loss — ties broken by
document order. Deterministic; sums exactly to N. Used for grow, shrink,
and auto-margin shares.

## Interaction with min/max

`min/max-width` clamp the width BEFORE content layout — wrapping and child
sizing see the constrained width — and `min/max-height` clamp an explicit
height the same way: content lays out against the clamped height. An
auto height is the content's output, clamped after layout (overflow
handles the spill) — except that a container's `max-height` also caps
its USED size — a column's main size (css-flexbox §9.2), a single-line
row's cross size (§9.4.8): content past the cap re-flexes against it, so
a scroll-container item (automatic minimum 0) shrinks to fit and scrolls.
In the cross axis, `min-height: auto` is 0: a single line's cross size IS
a definite inner height, and stretched items shrink to it (content
overflows) as well as grow.
Clamp order: `max` first, then `min` — an inconsistent `min > max` resolves
to `min`, per CSS. A container's `min-height` also feeds the flex algorithm
as a bounded inner height so alignment and stretch see it (step 5), but as
a **floor, not a cap**: on a column's main axis it can hand extra space to
`flex-grow`, yet it never triggers `flex-shrink` — the items keep their
hypothetical sizes (bases clamped by their own min/max) and the container
grows to fit, as all three engines lay it out (probed 2026-09-23). Only a
definite height (explicit `height` or a parent-assigned flex size) can
shrink content.
A container's content height as its own flex parent reads it (an
intrinsic basis, the automatic minimum) is its content's natural extent —
a column's hypothetical sizes, a row's natural lines, a grid's
max-content rows, a text leaf's lines — whatever height or floor the
container itself has.

## Deviations from CSS Flexbox

1. `flex-wrap: wrap` only wraps in the row direction; column containers
   never wrap.
2. No baseline alignment: a baseline item sits at the line edge its
   baseline group starts from (`items-baseline` behaves as
   `items-start`, `items-baseline-last` as `items-end`) — cells make
   baselines moot anyway; revisit with the forms milestone. Under
   `wrap-reverse` that puts a group's shorter items at the line's
   bottom, where CSS lines their first rows up with the tallest's
   (probed 2026-09-25).
3. A column item's content height — its automatic minimum, an intrinsic
   basis — counts a percent-height child against the item's own
   definite height, as WebKit does: in an `h-20` column, an `h-15` item
   holding an `h-full` child keeps 15 rows beside an `h-15` sibling's 5,
   where Chromium and Firefox take the child's percent as `auto` for the
   minimum and share the column 10/10 (probed 2026-09-23).
4. `justify-content: right` reads as `end` in a column too, where
   css-align makes it `start` off the inline axis (probed 2026-09-25,
   every engine); no utility writes it.
5. All the cell-model deviations (integer rounding, etc.) apply.
