# Spec: flex layout

Status: normative, extracted from the implementation (`layout.ts`) and its
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
- **Intrinsic outer width** of a node: border + padding + intrinsic inner
  width, where inner is — for a text leaf, the longest hard-broken line;
  for a flex-row container, the sum of children's intrinsic outer widths
  plus gaps; for anything else, the max of children's intrinsic outer
  widths. (Memoized per layout pass.)
- **Intrinsic height** of an item: the height it lays out to when given its
  allocated width (text wraps; containers stack), before any flex
  redistribution.

## Row algorithm

1. **Collect items** in visual order — sorted by CSS `order` (stable,
   document order ties), then reversed for `row-reverse`/`column-reverse`
   — with their base main sizes, grow/shrink factors, and margins (`auto`
   margins tracked separately from fixed ones). The base size follows CSS
   `flex-basis`: an explicit basis when set (notably `0%` from Tailwind's
   `flex-1`, which makes grow distribute ALL the space — equal columns),
   else the item's explicit width — cells, percent, or an intrinsic keyword
   — else its max-content size; clamped by the item's own min/max-width.
   Percentages (including percent min/max like `max-w-full`) resolve
   against the container's content box.
2. **Wrap into lines** (only when `flex-wrap: wrap`): greedy, in document
   order. An item's placement width is its intrinsic width plus its FIXED
   margins (auto margins count as 0 here). An item moves to a new line when
   `used + gap + itemWidth` would exceed the container's inner width; the
   first item of a line is always placed, even if it alone overflows
   (matches CSS).
3. **Resolve main-axis sizes per line**: available space = inner width −
   gaps − fixed margins. Then:
   - Extra space with any main-axis `auto` margin present → items keep
     intrinsic sizes (auto margins absorb the leftover — CSS gives auto
     margins priority over both `flex-grow` and `justify-content`).
   - Extra space otherwise → distributed to items proportionally to their
     `flex-grow` factors (integer distribution, below). No grow factors →
     items keep intrinsic sizes.
   - Shortfall → shrink proportionally to `base × flex-shrink`.
     Items with `flex-shrink: 0` keep their base size; if everything
     is shrink-0, the line overflows (real CSS behavior).
   - Both directions run the CSS §9.7 **iterative clamping loop**: each
     round's results clamp to the item's own min/max main size; violators
     FREEZE at their clamped size and the remaining space is redistributed
     among the rest until nothing new violates. When clamps bind, the line
     may underfill (justify-content sees the leftover) or overflow.
   - **Automatic minimum size** (`min-width/height: auto`, the CSS
     default): a flex item with visible overflow never shrinks below its
     min-content main size (longest breakable segment in a row; first-pass
     content height in a column). Non-visible overflow (e.g. `truncate`)
     or an explicit `min-w-0`/`min-h-0` disables it — exactly the CSS
     idiom for shrinkable/truncatable flex children.
4. **Lay out each item at its final width** (text re-wraps at that width,
   nested containers re-lay out).
5. **Line height**: the tallest item on the line. For a single `nowrap`
   line whose container has a bounded inner height (explicit `height` or
   `min-height`), the line stretches to that height, so cross-axis
   alignment sees the enforced size.
6. **Cross-axis stretch**: an item whose effective alignment is `stretch`
   (container `align-items` unless overridden by the item's `align-self`),
   with no explicit height and no cross-axis auto margins, is re-laid out
   with its height FORCED to the line height minus its fixed cross-axis
   margins. The forced height overrides the item's `min-height` (the flex
   "used size" is authoritative), and its own children see the final size.
7. **Main-axis placement**: offsets from `justify-content` (start /
   center / end / space-between / space-around / space-evenly; center
   floors the half-leftover; the space-* variants integer-distribute the
   leftover across gap slots — evenly uses n+1 equal gaps, around weights
   the edges at half, between splits the n−1 inner gaps), plus accumulated
   gaps, fixed margins, and auto-margin shares (leftover split equally per
   auto margin, integer-distributed). Under `row-reverse`/`column-reverse`
   the start/end meanings flip (items are already collected reversed).
8. **Cross-axis placement**: cross-axis auto margins win (both auto →
   centered, floor; one auto → that side absorbs the space); otherwise
   fixed margin-top plus the alignment offset (start 0, center floor,
   end flush).
9. **`align-content`** (multi-line only, i.e. `flex-wrap: wrap`, per CSS):
   with a bounded inner height taller than the lines, the leftover cross
   space is distributed with the shared offset math — start / center /
   end / space-between / space-around / space-evenly — or, for `stretch`
   (the CSS default `normal`), split across the LINES' heights with the
   integer distribution (each line's items then re-align/stretch within
   the grown line). Under `wrap-reverse` the cross axis runs backwards:
   the line order is reversed at collection time and `start`/`end` swap
   meaning (symmetric values are unaffected).
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
  main axis (auto-margin priority, grow, shrink, `flex-basis`, and the same
  unclamped-base rule: the base is the pre-min/max first-pass height, so
  e.g. an item's `min-h-*` never skews the distribution). A child whose
  height changed from its base is re-laid out with the new height forced,
  so nested content (e.g. `items-center` inside a stretched child) sees the
  final size. Forced (flex-assigned) sizes are authoritative and skip
  resolution — which also means a percent or explicit width on a row item
  is never re-resolved against its own assigned size.
- Unbounded inner height → children keep intrinsic heights; container
  content height is their sum plus gaps and fixed margins.

## Integer distribution (shared)

Distributing N integer units across slots proportionally to weights:
compute the exact shares, floor them, then hand the remainder out one unit
at a time to the slots with the largest fractional loss — ties broken by
document order. Deterministic; sums exactly to N. Used for grow, shrink,
and auto-margin shares.

## Interaction with min/max

`min/max-width` clamp the width BEFORE content layout — wrapping and child
sizing see the constrained width. `min/max-height` clamp the final height
after layout (content height is an output; overflow handles the spill) —
except that a container's `max-height` also caps its USED size — a
column's main size (css-flexbox §9.2), a single-line row's cross size
(§9.4.8): content past the cap re-flexes against it, so a
scroll-container item (automatic minimum 0) shrinks to fit and scrolls.
In the cross axis, `min-height: auto` is 0: a single line's cross size IS
a definite inner height, and stretched items shrink to it (content
overflows) as well as grow.
Clamp order: `max` first, then `min` — an inconsistent `min > max` resolves
to `min`, per CSS. A container's `min-height` also feeds the flex algorithm
as a bounded inner height so alignment and stretch see it (step 5), but as
a **floor, not a cap**: on a column's main axis it can hand extra space to
`flex-grow`, yet it never triggers `flex-shrink` — content taller than the
floor keeps its intrinsic size and the container grows to fit. Only a
definite height (explicit `height` or a parent-assigned flex size) can
shrink content.

## Deviations from CSS Flexbox

1. `flex-wrap: wrap` only wraps in the row direction; column containers
   never wrap.
2. No baseline alignment (`items-baseline` behaves as `start` — cells make
   baselines moot anyway; revisit with the forms milestone).
3. `flex-basis: content` behaves as `auto`.
4. All the cell-model deviations (integer rounding, etc.) apply.
