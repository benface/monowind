# Spec: grid layout

Status: implemented (`grid.ts`) except the two later phases: **subgrid**
(currently behaves as `none`) and the **§10.1 grid-area containing block**
for absolutely positioned children (they currently get the block static
slot at the content origin). Cell-unit fundamentals (rounding, box model,
margins) live in `cell-model.md`; shared machinery (integer distribution,
intrinsic widths, alignment offsets) is the same as in `flex.md`.
Deviations from CSS Grid are listed at the end.

## Reading grid styles

The `getComputedStyle` value of `grid-template-columns` /
`grid-template-rows` on a live grid container is the USED track list —
expanded to px, with fr, `repeat()`, and `minmax()` structure gone. Typed
OM (`computedStyleMap()`) returns the COMPUTED value with the authored
structure intact (verified in Chromium and WebKit), so it is the primary
source — the same split as margins and insets. Without Typed OM (Firefox
pre-157), the reader sets a `data-mw-degrid` attribute for the duration
of the read; a measuring-gated companion rule blockifies the element, and
`getComputedStyle` then returns the computed value too. The attribute is
not in the engine's mutation filter, so the write doesn't re-trigger
layout. The other grid properties (placement longhands, `grid-auto-*`,
`grid-auto-flow`, `justify-items`/`justify-self`) have no used-value trap
and are read normally. `justify-content: normal | stretch` is kept as
`stretch` (it stretches auto tracks, §11.8); flex treats it as `start`,
per css-align.

## Scope

`display: grid` with:

- `grid-template-columns` / `grid-template-rows` — explicit tracks
  (`grid-cols-<n>`, `grid-rows-<n>`, and arbitrary values with the track
  subset below).
- `gap` / `column-gap` / `row-gap` (already-shared machinery, percent
  included).
- Placement: `grid-column` / `grid-row` start/end/span (`col-span-<n>`,
  `col-start-<n>`, `col-end-<n>`, `-<n>` counting from the end,
  `col-span-full`; same for rows), auto-placement per CSS §8.5.
- `grid-auto-flow: row | column | row dense | column dense`
  (`grid-flow-*` incl. the dense variants).
- `grid-auto-rows` / `grid-auto-columns` for implicit tracks.
- Alignment: `justify-items` / `align-items` / `justify-self` /
  `align-self` (start / center / end / stretch) and `justify-content` /
  `align-content` (start / center / end / space-between / space-around /
  space-evenly) — reusing the flex offset machinery.
- CSS `order` participates in auto-placement order, per CSS.

Everything integer cells; columns resolve against the container's content
width, rows against its content height (definite) or content (indefinite).

## Track sizes

A track size is one of:

- **cells** — px/rem lengths on the spacing scale (`grid-cols-[8rem_1fr]`).
- **percent** — of the container's content box in the track's axis
  (indefinite axis → treated as `auto`, per CSS).
- **`min()` / `max()`** over cells/percent arguments — the canonical
  responsive auto-fill pattern
  `minmax(min(8rem, 100%), 1fr)`. Resolved at layout time; a percent
  argument on an indefinite axis makes the whole function behave as
  `auto`, mirroring the percent rule.
- **`<n>fr`** — flexible; shorthand for `minmax(auto, <n>fr)`, per CSS.
- **`auto`** — sized to its items (min = largest min-content contribution,
  max = largest max-content contribution).
- **`min-content` / `max-content`** — the corresponding item contribution.
- **`minmax(min, max)`** — with min ∈ {cells, percent, auto,
  min/max-content} and max ∈ {cells, percent, fr, auto, min/max-content}.
  Tailwind's `grid-cols-<n>` compiles to `repeat(n, minmax(0, 1fr))`, so
  this form is required, not optional.
- **`repeat(<count | auto-fill | auto-fit>, …)`** — fixed counts expand at
  read time. `auto-fill` / `auto-fit` (no core Tailwind utility, but the
  canonical responsive arbitrary value) resolve at LAYOUT time, per CSS:
  `count = max(1, floor((available + gap) ÷ (trackMin + gap)))` — exact in
  integer cells, no rounding ambiguity — with `trackMin` the repetition's
  minmax min (its max if the min is intrinsic). `auto-fit` additionally
  collapses empty repeated tracks to 0 (and drops their gaps), per CSS.
  Requires a definite axis size; an indefinite axis repeats once, per CSS.

## Track sizing algorithm (CSS Grid §11, integer-adapted)

Run per axis; columns first (row heights depend on items laid out at their
final column widths).

1. **Initialize** each track at its minmax min (cells/percent resolved; a
   content-based min starts at 0) and minmax max (∞ for fr until step 4).
2. **Resolve intrinsic minimums/maximums** from items, in ascending span
   order (span-1 items first, per CSS): each item's min-content and
   max-content contributions (outer sizes: the item's border + padding +
   content measure, plus its fixed margins) grow the base/limit of the
   intrinsic tracks it spans. An item spanning multiple tracks distributes
   its still-needed space across the spanned intrinsic tracks with the
   shared integer distribution, equal weights (**simplification** of the
   spec's growth-limit ordering — deterministic and close in practice; a
   spanning item never grows tracks that have no intrinsic component).
   An item spanning an fr track distributes only its MIN-content
   contribution, and only to the fr tracks with an intrinsic min,
   weighted by flex factor (CSS §11.5.1) — this seeds the automatic
   minimum that makes bare `1fr 1fr` columns unequal under long content;
   its max contribution is step 4's job.
3. **Clamp** each track: base ≤ limit (limit wins when the pair is
   inconsistent, mirroring min/max-width and emulating the spec's
   limited-contribution rule); an intrinsic limit is floored at its base.
4. **Maximize** (CSS §11.6, definite axis only): grow bases up to their
   growth limits with the free space, equal integer shares — this is what
   fills `minmax(0, <fixed>)` tracks and gives `auto` tracks their
   max-content before fr distribution.
5. **Distribute free space to fr tracks** (§11.7): leftover = inner size −
   gaps − non-fr tracks; shared out proportionally to fr factors with the
   integer distribution (a factor sum below 1 only distributes that
   fraction, per CSS). Each fr track's result is floored at its base —
   for bare `<n>fr` that's the automatic minimum from step 2, so the
   track never drops below its items' min-content (`minmax(0, 1fr)` from
   `grid-cols-<n>` opts out, which is why Tailwind columns divide evenly
   regardless of content). Re-run the distribution with floored tracks
   frozen, §9.7-style, until nothing new violates.
6. **Stretch auto tracks** (§11.8): when the axis's content-distribution
   is `stretch` (the CSS-initial `normal` included), remaining free space
   grows the auto-limited tracks equally — a lone grid item in a definite
   height container fills it, as in CSS.
7. **Indefinite axis** (rows without a bounded container height): the
   axis sizes under CSS's max-content constraint — every non-fr track
   maximizes to its growth limit (a fixed minmax max like
   `minmax(0, 2rem)` fills even without content; §11.6's infinite free
   space — all three browser engines agree), percent tracks behave as
   `auto`, and fr tracks size to the shared flex fraction (§11.7 with
   indefinite space: the largest of each fr track's base ÷ factor and
   each crossing item's max-content contribution over the crossed
   factors) — so two `1fr` rows both take the TALLEST item's height,
   per CSS. The content height is the sum of row tracks plus gaps. The
   row axis counts as bounded whenever the inner height is finite — a
   `min-height` floor included, matching the flex line behavior
   (`min-h-* content-*` and self-alignment work). The container's
   min-content width instead sizes columns under the min-content
   constraint (no maximize; fr at its base).
8. A definite container size smaller than the track sum simply overflows
   (tracks don't shrink, per CSS — grid has no `flex-shrink`).

## Placement (CSS §8.5)

1. Items with definite positions in both axes go first.
2. Remaining items flow with the auto-placement cursor in `grid-auto-flow`
   order (row-major default; column-major with `grid-flow-col`), in
   `order`-then-document order, skipping occupied cells. Sparse (default):
   the cursor only moves forward. `dense`: the scan restarts from the
   grid's start for every item, back-filling earlier holes, per CSS.
3. Negative lines count from the explicit grid's end line, per CSS.
4. A placement past the explicit grid creates **implicit tracks**, sized by
   `grid-auto-rows` / `grid-auto-columns` (default `auto`) using the same
   sizing algorithm.
5. A `span` larger than the remaining explicit tracks also creates implicit
   tracks, per CSS.

## Items in their areas

An item's **grid area** is the track span plus the gaps it crosses. Within
it, per axis:

- **stretch** (default): the item is laid out with its outer size forced to
  the area (minus fixed margins), same authority rules as a flex-assigned
  size; the item's own min/max still clamp, and a clamped or explicitly
  sized item falls back to start alignment, per CSS.
- **start / center / end**: the item takes its intrinsic (or explicit) size
  and the area's leftover becomes the alignment offset (center floors).
- **auto margins** win over alignment, absorbing the area's leftover
  (both → centered, one → that side), exactly like flex.
- Content-distribution (`justify-content` / `align-content`) offsets the
  whole track grid inside the content box when the tracks underfill it,
  using the shared offset math (space-* variants included).

## Subgrid

`grid-template-columns: subgrid` / `grid-template-rows: subgrid`
(Tailwind's `grid-cols-subgrid` / `grid-rows-subgrid`) are supported, per
CSS Grid 2:

- A subgridded axis adopts the PARENT's track sizes for the tracks the
  subgrid spans; the subgrid defines no tracks of its own there. The other
  axis (if not subgridded) sizes independently as a normal grid axis.
- The parent's gap is inherited in the subgridded axis (an explicit gap on
  the subgrid overrides it, per spec).
- Subgrid items participate in the PARENT's intrinsic track sizing: during
  the parent's step 2 they contribute through the mapped tracks, with the
  subgrid's own border and padding added to the contributions of the edge
  tracks it spans (the spec's margin/border/padding accounting; margins
  likewise).
- Nested subgrids compose by mapping through each level.
- Line NAMES are not inherited (named lines are deferred wholesale).
- A `subgrid` axis on something that is not a grid item behaves as `none`,
  per CSS.

## Out-of-flow children

Per CSS Grid §10.1, for a POSITIONED grid container an absolute child's
containing block is its **grid area**: placement properties resolve
normally except that `auto` (and `span` against auto) lines resolve to the
container's padding edges, and the child does not affect track sizing or
auto-placement. Insets then resolve against that area, and an inset-less
axis uses the static-position rectangle — the same area with the child's
self-alignment applied — through the shared `staticSlot` machinery. A
non-positioned grid container behaves like any other non-positioned
ancestor (`positioning.md`).

## Interaction with the rest of the engine

- A grid container's intrinsic outer width: explicit cell tracks count
  their cells; percent, intrinsic, and fr tracks behave as `auto` (CSS
  §11.1's "treated as auto when the container size depends on the tracks")
  and count their items' contributions — max-content for the intrinsic
  width, min-content for the min-content width — plus gaps. (Good enough
  for `w-max`/shrink-to-fit on grid containers; refinements can follow
  usage.)
- `min/max-width/height` on the container clamp exactly as for flex
  (width before content, height after).
- Grid items are laid-out boxes: text wraps at the final track width,
  nested flex/grid/block lay out inside, borders paint as glyphs.

## Deviations from CSS Grid

1. Named lines, `grid-template-areas`, and `grid-area: <name>` are
   deferred — no core Tailwind utilities emit them (arbitrary values
   only); areas are attractive for TUI dashboards, revisit once numeric
   placement ships. Subgrids accordingly don't inherit line names.
2. Masonry: never planned.
3. No baseline alignment (as in flex).
4. Spanning-item space distribution uses equal weights across spanned
   intrinsic tracks instead of the spec's growth-limit ordering.
5. `fit-content()` track sizes are deferred (they read as `auto`), and so
   is `calc()` arithmetic inside track lists (reachable via arbitrary
   values like `grid-cols-[calc(100%-2rem)_1fr]`) — it parses as `auto`.
   `min()` / `max()` over plain lengths/percentages ARE supported (see
   Track sizes).
6. A grid container whose content is ONLY inline (text, no block-level
   children) lays out as a text leaf: the anonymous grid item CSS would
   create is not placed into the track grid — the text sizes the box
   directly, wrapping at the content width. Wrap the text in an element
   to make it a real grid item.
7. All cell-model deviations (integer rounding, etc.) apply.
