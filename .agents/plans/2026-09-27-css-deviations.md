# CSS deviations for 0.3.4

Status: **planned 2026-09-27**. The "Order" of
`2026-09-23-css-deviation-reasons.md` as a plan for release 0.3.4,
with the scope decided with the user the same day: `aspect-ratio` and
anchor positioning first, then the numbered Order (item 4, stacking,
is done), and five extras beside it; the host's own height (F2), a bug
found with `aspect-ratio`, joins it. Each item gives the deviation,
what CSS does, the approach, its size, its risks and its tests. Its
code-level steps and touch points are written when the item starts; a
medium item starts with its spec change. Progress is recorded here,
under "Progress", as each item lands.

## Scope

| Id  | Item                              | Deviation           | Size | 0.3.4 |
| --- | --------------------------------- | ------------------- | ---- | ----- |
| F1  | `aspect-ratio`                    | cell-model 9        | M    | in    |
| F2  | the host's own height             | host sizing (bug)   | M    | in    |
| A1  | the last acceptable anchor        | anchor 3            | M    | in    |
| A2  | sticky anchors                    | anchor 6            | S–M  | in    |
| A3  | insets inside an area             | anchor 1            | S    | in    |
| A4  | `flip-start` swaps the sizes      | anchor 1            | S    | in    |
| A5  | an inline anchor's own clip       | anchor 2            | S    | in    |
| A6  | a hidden box stays focusable      | anchor 9            | S    | in    |
| 1   | columns on the host               | host-leaf           | S    | in    |
| 2   | margins on inline-blocks          | cell-model 5        | S–M  | in    |
| 3   | percent sizes beside margins      | cell-model units    | S–M  | in    |
| 5a  | a first `lab()` or `lch()` stop   | gradients (bug)     | S    | in    |
| 5b  | the other interpolation spaces    | gradients 4         | S    | in    |
| 5c  | the fade drift                    | —                   | —    | fixed |
| 6   | baseline: flex rows, tables, grid | flex 2, table 4 …   | M    | in    |
| 7a  | text indent                       | cell-model indent   | S–M  | in    |
| 7b  | additive `scroll-padding`         | scrolling           | S    | in    |
| 7c  | `fit-content()` tracks            | grid 5              | S    | in    |
| 7d  | `calc()` tracks                   | grid 5              | S    | in    |
| 7e  | multicol min-content              | multicol 5          | S    | in    |
| 7f  | subgrid line names                | grid 1              | S    | in    |
| 7g  | caption margins                   | table caption       | S    | in    |
| 7h  | hover on inline elements          | cell-model pointer  | S    | in    |
| 7i  | the decoration properties         | cell-model type     | S–M  | in    |
| 7j  | `overflow: clip`                  | cell-model overflow | S    | in    |
| 8a  | `pre-line`                        | cell-model 8        | S    | in    |
| 8b  | `pre-wrap`, `break-spaces`        | cell-model 8        | M    | in    |
| 9a  | `text-align: justify`             | cell-model 6        | S–M  | in    |
| 9b  | a UAX #14 subset                  | cell-model breaks   | M    | in    |
| 9c  | an absolute box's spot in a run   | positioning 3       | M    | in    |
| 9d  | percent insets on inline elements | positioning 2       | S–M  | in    |
| E1  | a grid holding only text          | grid 6              | M    | in    |
| E2  | the caption outside the border    | table caption       | M    | in    |
| E3  | the subgrid gap                   | grid 1              | S–M  | in    |
| E4  | corners of mixed weight or style  | cell-model borders  | M    | in    |

Out, for later: `visibility: collapse`, column flex wrapping and
`scroll-smooth` (decided 2026-09-27); `mix-blend-mode`, `clip-path`
and `mask-image` (layers.md 8), behind new features. The absolute
boxes' scroll range is `2026-09-25-overflow-alignment.md` step 2. The
research's "Keep" entries stay kept: `leading-*` on inline elements,
`empty-cells`, multicol `break-*: avoid`, `@position-try`,
`shape-outside`, a gradient's size, position and repeat, and ink above
or left of the host. Anchor deviations 1 (the reading), 2 (the border
box), 4, 5, 7 and 8 stay, their reasons verified below.

## Probes (2026-09-27)

Chromium 153, Firefox 155 and WebKit 26.6 through Playwright, a plain
page each (monospace 16px on 20px lines, no host): rects, the text
rows by `Range`, computed values, `elementFromPoint`. The engines
agree unless an item says otherwise. The scripts ran in scratch and
were not kept. Where the research had probed a case (the anchor
refusals, `w-full mx-4`, the `pre-*` wraps, multicol min-content,
`overflow: clip`'s minimum), it was not probed again unless an item
needed more of it.

Findings that changed an item:

- CSS takes the **last** acceptable anchor in tree order, a later
  in-flow namesake included, not the nearest preceding one (A1). Names
  repeated under one containing block all anchor to the last; a
  `relative` list item or `anchor-scope` keeps each to its own.
- A box with a `position-area` applies its insets inside the area, and
  `flip-start` swaps its width and height (A3, A4): two sentences of
  anchor deviation 1 that are not about the reading.
- `anchors-visible` tests the border box in Chromium and Firefox, as
  the engine does; WebKit tests the ink (anchor deviation 2 is kept,
  reworded). An inline anchor that its own `truncate` paragraph clips
  hides the box in all three (A5).
- A sticky anchor: Chromium and WebKit anchor to its stuck position,
  Firefox to its laid-out one (A2).
- A gradient opening with a `lab()` or `lch()` stop still loses it
  (5a), and the fade drift is gone (5c).
- `overflow-x: clip` alone turns y into a scroll container in the
  engine, and a clip box steps aside from floats; in CSS neither (7j).
- Every anonymous run takes its container's `text-indent`; CSS indents
  the container's first formatted line alone (7a).
- A table's width floors at its caption's min-content, not its
  max-content (7g).
- An absolute span at a line's end: Chromium and WebKit put it there,
  Firefox at the next line's start (9c).

## How each item runs

- A medium item starts with its spec change, reviewed before code.
- Tests are seen red first: written first, or run against a scratch
  copy without the fix, never by swapping the tracked tree.
- Narrow runs while working; goldens only where paint or layout
  moves, each move checked against the browsers before its golden is
  updated; the full suites once per batch.
- Where an item touches a hot path — the wrap (7a, 8, 9a, 9b), the
  positioning pass (F1, A1, A2), the hit (7h) — `pnpm bench` runs
  before and after, alternated, and a measure that moves is traced
  before going on.
- Each new `CellStyle` or inline-entry field is one the incremental
  reads (`2026-09-24-incremental-reads.md`, after this plan) compare.

## First: `aspect-ratio` (F1)

**Deviation**: cell-model.md 9, `aspect-ratio` ignored, deferred on
the choice between a square in px and a square in cells.

**CSS** (probed):

- The ratio sizes the axis left `auto`: `w-20 aspect-square` is as
  tall as wide. A block with a height and an auto width takes its
  width from the ratio (160 × 80 in a 320 container), not the fill.
- Content taller than the ratio grows the box (a content-based
  automatic minimum height), unless its overflow is not visible or it
  has a `min-h-*`.
- A min or max on one axis transfers through the ratio:
  `aspect-square max-h-[50px]` is 50 × 50.
- A flex item stretched in a line of indefinite height takes the
  line's height and drops the ratio (80 × 200). In a definite-height
  row, the stretched height gives the width (100 × 100).
- A grid item's `normal` alignment acts as `start` for a box with a
  ratio (100 × 56.25 in a 100 track). Under an explicit `self-stretch`
  Chromium and WebKit take the width from the stretched height, past
  the track, as the spec reads; Firefox keeps the track's width.
- An absolute box between two insets and an inline block take the
  other axis from the ratio; a box with both sizes ignores it.

**Approach**: the ratio is physical (decision D1): the read converts
it to columns per row through the measured cell, as viewport units and
shadow offsets are converted, and each derived size rounds once to the
nearest cell. Layout derives the auto axis where sizes resolve, floors
the height at the content for visible overflow, and transfers min and
max. Flex takes a base size through a definite cross size, stretch in
an indefinite line winning. Grid reads `normal` as `start` for such an
item. The positioning pass derives the other axis of an inset-stretched
box. A read without metrics (headless) takes gradients' default 1:2
cell.

**Spec first**: cell-model.md gains a section on the preferred aspect
ratio and loses deviation 9; flex.md and grid.md name their rules.

**Size**: medium.

**Risks**: the flex and grid interplay (stretch against the ratio, the
automatic minimum); a chain of derived sizes rounding more than once;
`renderPlainText` without metrics.

**Tests**: style.test.ts, the read (`16/9`, `auto 16/9`, the cell
conversion); layout.test.ts, flex.test.ts, grid.test.ts and
positioning.test.ts, each probe row in cells. A story, `AspectRatio`,
renders each probe case in the host and natively beside it, each box's
cells against the native box through the measured cell, in three
engines; its golden.

**More probes (2026-09-27, standards mode)**: a derived height is
definite for a child's percent height (all three); a derived width
floors at the min-content width unless overflow clips; `min-h-*` with
both sizes auto widens the box past its container; `inset-0` takes the
width from the insets and the height from the ratio; a set height
contributes its derived width to an `auto` column and a `w-max`
parent; tables take the ratio in Chromium and Firefox (WebKit
otherwise), cells, rows and inline elements never. Engine splits: a
column item with no width (Chromium and Firefox derive the width from
the content height, WebKit keeps fit-content), a grid item aligned
`start` in its column (Firefox and WebKit fit-content, Chromium
stretches the height), an explicit `self-stretch` (Chromium and WebKit
derive the width past the area, Firefox keeps it). In each, the specs
follow the CSS rule and name the engine that departs from it.

**Steps**:

1. The read. types.ts: `CellStyle.aspectRatio`, columns per row, null
   for none (`defaultCellStyle`). style.ts:
   `readAspectRatio(cs, metrics)` in `readCellStyle`, `auto` and a zero
   term none, through the cell (`DEFAULT_CELL` without metrics). style.test.ts.
2. Block flow and every box (layout.ts). One helper for the derived
   size, `ratioSize(length, ratio, axis)`, rounding once. `resolveWidth`
   derives an auto width from a definite height before the fill or
   shrink-to-fit, and takes the height's limits through the ratio when
   both are auto; `layoutNode` derives an auto height from the final
   width, counts it definite, floors a derived axis at the content
   while overflow is visible and its min is `auto`, and clamps it to
   its own limits. `widthContribution` counts the width a set height
   derives. layout.test.ts: each block probe row, tables and floats.
3. Flex (flex.ts). `flexBaseOuterWidth` derives a row base from a
   definite cross size (a set height, or a stretch in a definite
   single line); a row item that does not stretch lays out with its
   height from its final width; a stretch in an indefinite line forces
   the height as today. The column pass derives its base height from
   the stretched or set width, and a column item with neither lays out
   at its content height, its width derived after. flex.test.ts.
4. Grid (grid.ts). The block-axis pass reads `normal` as `start` for a
   ratio item and derives its height from its width; an explicit
   `stretch` derives the width from the stretched height; an
   inline-axis `start`, `center` or `end` item takes fit-content and
   derives its height. Track sizing takes the width a set height
   derives. grid.test.ts.
5. Absolute boxes (positioning.ts). `absoluteWidth` and the height in
   `placeByInsets` derive one axis from the other as the insets and
   sizes leave them, the width first where both inset pairs are set.
   positioning.test.ts.
6. The `AspectRatio` story (box.stories.ts) beside native copies,
   three engines, its golden; `pnpm bench` before and after (the
   positioning pass and block flow), alternated.
7. Docs: the specs' touch points; this plan's Progress.

## Beside F1: the host's own height (F2)

**Bug** (found 2026-09-27, all three engines): the host writes its
content's rows as its inline `height`, overriding the author's: a host
with `height: 200px` or `width: 320px; aspect-ratio: 2/1` is one row
tall. Its width follows the author's (`w-*`, capped to whole columns),
and a `min-height` wins over the inline height natively, though the
root lays out without it.

**CSS**: the host is a box like any other; its height is the author's
where set (`h-*`, `h-full` of a definite parent, `h-screen`, a flex or
grid parent's stretch, `aspect-ratio` from its width) and its content's
otherwise, floored and capped by its limits.

**Approach**: the height measured natively with the engine's rule
lifted, as the width is ("Host sizing"), where the author gives one:
the host is a page box, so its sizes are the page's px, not cells
(`h-1` is 4px, as `w-1` is), capped to the whole rows that fit as the
width is to whole columns;
the root lays out against it as a definite height, its content
overflowing or scrolling as the host's `overflow` says. How a measure
tells an authored height from the content's is the spec's question,
written when the item starts.

**Size**: medium. **Tests**: host stories for each case beside a
native box; element.test.ts where happy-dom can say it.

## First: anchor positioning (A1–A6)

anchor-positioning.md lists nine deviations; each was probed. Six
changes follow, the first the research's containing-block check; the
rest are kept with their reasons.

### A1. The anchor is the last acceptable element

**Deviation**: anchor 3, the anchor is the nearest preceding element
by name in the host, so an ancestor anchors its descendant.
`positioning.ts` records each name in one map as the walk reaches it,
before its subtree.

**CSS** (probed): the anchor is the last acceptable element in tree
order with the name (css-anchor-position-1, "acceptable anchor
element"). Acceptable means:

- inside the box's containing block, the block itself refused;
  anything in the document for a fixed box or a popover, whose block
  is the viewport;
- where it shares the box's containing block, in flow or before the
  box;
- else, the last containing block on its own chain before the box's is
  in flow or before the box.

So a later static namesake wins over an earlier one, as does one
inside a later `relative` box, while a later absolute one, or one
inside a later absolute box, is refused; one inside an earlier
absolute box is accepted, and a refused one falls back to an earlier
acceptable one. Repeated names under one containing block all anchor
to the last; `relative` list items, or `anchor-scope` on them, keep
each box to its own.

**Approach**: the pass keeps a list per name, in tree order, of the
boxes and inline elements naming it, each with its containing-block
chain, and a box takes the last acceptable entry. A later in-flow
anchor's rect is its flow rect moved by the relative offsets on its
chain, which the pass applies before the placements that could need
them; an anchor inside a later absolute box is refused, so no box
waits on another's placement. An authored `anchor-scope` limits a name
to its element's subtree. The spec's locked "the nearest element
before it in tree order" changes (decision D2).

**Size**: medium.

**Risks**:

- The walk's order: relative offsets ahead of placements.
- Fixtures and stories relying on the nearest-preceding rule, names
  repeated under a shared containing block among them. The UI package
  names each trigger uniquely, and its positioners are popovers, so it
  is untouched.
- The engine's own `anchor-scope: all` lock, under the measuring flag,
  hides an authored `anchor-scope` on a named element itself; on a
  list item, the usual place, it reads.
- The lists' cost, paid only where a name is authored (`namedAnchors`
  already tells).

**Tests**: anchor.test.ts, each probe case: the containing block
refused, a static ancestor inside it, a fixed box's pick among the
host's, a later absolute and a later static namesake, one inside a
later `relative` box, a later and an earlier absolute box, a refused
one falling back, and the list three ways. A story, `AnchorAcceptable`,
renders the cases in the host and natively beside it, each box's cells
against the native box.

### A2. Sticky anchors

**Deviation**: anchor 6, a sticky anchor is anchored at its laid-out
box.

**CSS** (probed): Chromium and WebKit anchor to the stuck position (a
box under a stuck header at 20px), Firefox 155 to the laid-out one
(at −60px).

**Approach**: the pass adds a sticky anchor's shift, sticky.ts's from
the synced scroll offsets, to its rect, and notes its scroller for a
relayout on scroll even where the box scrolls with it.

**Size**: small–medium.

**Risks**: a relayout per scroll step of that scroller while a box
depends on it (the scroll step benched on a stuck header's menu); a
sticky box inside a sticky box.

**Tests**: anchor.test.ts, an anchor stuck, not yet stuck, and held
at its containing block's end; `AnchorInScroller` gains a menu under a
stuck header's button.

### A3. Insets inside an area

**Deviation**: anchor 1, "a box with a `position-area` … its insets
are not applied inside it" (`placeInArea` takes the area whole).

**CSS** (probed): the area is the containing block, so insets offset
from its edges: `position-area: bottom; top: 8px` sits 8px below the
anchor, and `left: 16px` under `bottom span-right` 16px in.

**Approach**: `placeInArea` resolves the insets against the area as
`placeByInsets` does against a block, the fit taken in what they
leave.

**Size**: small. **Tests**: anchor.test.ts, both probe cases and one
under a flip.

### A4. `flip-start` swaps the sizes

**Deviation**: anchor 1, "`flip-start` leaves the box's own sizes
where they are".

**CSS** (probed): an 80 × 20 box is 20 × 80 under `flip-start`.

**Approach**: the tactic swaps width, height and their minimums and
maximums with the margins and insets; a swapped length keeps its
authored value, so `w-20` becomes a height of 20 rows.

**Size**: small. **Tests**: anchor.test.ts.

### A5. An inline anchor's own clip

**Deviation**: anchor 2's second sentence, an inline anchor is tested
against the boxes above its paragraph, the paragraph's own clip
aside.

**CSS** (probed): a box whose inline anchor a `truncate` paragraph
cuts off hides, in all three.

**Approach**: an inline anchor's clips include its leaf's own.

**Size**: small. **Tests**: anchor.test.ts; `AnchorVisibility` gains
the case.

### A6. A hidden box stays focusable

**Deviation**: anchor 9, a box `position-visibility` hides is
`visibility: hidden` natively, so its content leaves the accessibility
tree and loses the focus.

**CSS** (probed): the computed `visibility` stays `visible`, and a
button inside takes the focus, in all three.

**Approach**: the companion hides a `data-mw-force-hidden` box with
`opacity: 0` and `pointer-events: none` in place of `visibility:
hidden`; a `data-mw-top-shown` element takes the pointer back, the top
layer being out of its ancestors' opacity (decision D4).

**Size**: small.

**Risks**: the text-mode selection across the invisible text (the
copy already skips it); a focused element there shows no focus invert,
as the browsers show nothing.

**Tests**: a story: `focus()` reaches a button in a hidden box, nothing
paints, a press passes through; cascade.test.ts if a variable moves.

### Kept, with the reasons verified

- **1, the reading**: an anchor function counts only as a whole inset
  or size from the inline style or a utility, the cascade's pick among
  utilities and the fallback's forms with it. The browser resolves it
  at computed-value time against the pre-grid boxes, so its text
  survives only in the style attribute and the class list
  (core-architecture D1). A3 and A4 take the two sentences that are
  not about the reading.
- **2, the border box**: Chromium and Firefox test the anchor's border
  box, as the engine does; WebKit, and the spec's wording, its ink
  overflow. Probed: an anchor whose shadow alone is in view hides the
  box in Chromium and Firefox. The entry is reworded so when A5 takes
  its second sentence.
- **4, logical keywords**: `direction` is not read (cell-model.md 20);
  the entry points there.
- **5, `@position-try`**: rule descriptors reach no computed value
  (D1).
- **7, every anchor follows its scrollers**: probed, all three keep a
  non-default anchor's offset through its scroller's scroll; WebKit
  retakes it at the next relayout, Chromium and Firefox do not. The
  engine places each box afresh at every layout, its one
  recalculation point; mirroring CSS would keep a stale offset per box,
  for a snapshot the engines retake at different times (decision D3).
- **8, the placement recorded at each layout**: the engine's layout is
  its only update; there is no `ResizeObserver` delivery to mirror.

**Steps** (A1–A6): written when the anchor batch starts.

## 1. Lock `columns` on the host

**Deviation**: host-leaf.md, "Column utilities on the host itself are
not modeled", with a false reason that the research corrected.

**CSS and the code**: the host's display applies to its shadow tree,
whose one child is the viewport; the light children are slotted into
a `flow-root`, so in CSS too the host lays them out as a block. What
breaks is the viewport's own box: `columns-2` fragments it and every
element leaves its cells (the research's probe). A grid template
leaves it whole (probed 2026-09-27: a paragraph under
`grid-template-columns: 100px 1fr` on the host keeps the host's width
and the grid's line count in all three engines), as `flex` does.
Nothing locks `columns` (styles.css).

**Approach**: the companion locks `columns: auto` on the host, its
display staying the author's (a `hidden` host must hide). The engine
warns once where the host has columns or a flex or grid display: they
lay out nothing there and belong on a wrapper (decision D5).

**Size**: small.

**Risks**: `inline` and `contents` hosts measure no width, as today;
the warning names them too.

**Tests**: a host story with `columns-2`, `grid grid-cols-2` and
`flex gap-2` on the host, the agreement check keeping every light
element on its cells; host-leaf.test.ts, the warning. host-leaf.md's
deviation becomes the block rule and the lock.

**Steps**: written when the item starts.

## 2. Margins on inline-blocks

**Deviation**: cell-model.md 5 and "Atomic inline boxes": an atomic
inline box's margins are ignored. The run's marker advances by the
border box, and the companion zeroes the native margins.

**CSS** (probed):

- Horizontal margins join the box's advance: under `ml-4 mr-8` the box
  starts 16px past the text before it, the text after 32px past it. A
  negative margin overlaps the text before; `auto` is 0. A margin at a
  line's start counts toward the fit and shows.
- Vertical margins, under the engine's `vertical-align: top` pin:
  `mt-5` puts the box 20px down and grows the line, its text staying
  on the first row; `-mt-5` lifts the box above the line, which does
  not grow; `mb-5` grows the line.

**Approach**: the marker's advance is the margin box's width, the box
placed past its left margin; line growth counts the margin box's rows;
the native box takes its margins in cells, the give-back folded into
its right margin. Bottom and middle alignment align the margin box.

**Size**: small–medium.

**Risks**: the advance's floor of one cell (a margin box narrower than
a cell); ink above the leaf from a negative top margin; the middle
alignment's baseline fallback, the margin box's bottom; the agreement
check in three engines; multicol leaves, which share the line metrics.

**Tests**: layout.test.ts, each probe row; tree.test.ts, intrinsic
widths with margins. A leaf story, `InlineBoxMargins`: buttons with
`mx-1`, `-ml-1` and `mt-1` in a paragraph, the agreement check on
them; its golden.

**Steps**: written when the item starts.

## 3. Percent sizes beside margins

**Deviation**: cell-model.md "Units and value mapping", the "one small
approximation": a margined child in block flow, or in a column's cross
axis, resolves percentages against the width less its margins.

**CSS**: against the containing block's content width: `w-full mx-4`
in 20 cells is 20 wide and overflows by 8 (the research's probe).

**The code**: block flow and the flex column hand the child its width
less its margins as the available width, which a percent width, its
minimum and maximum, and percent padding resolve against. So do the
float band, a non-stretched grid item and multicol's columns and
spanners.

**Approach**: the containing block's width goes down as the percent
basis, the reduced width staying the space an auto width fills or
shrinks to. `layoutNode`'s `forced` contract already keeps the two
apart.

**Size**: small–medium.

**Risks**: stories and goldens with `w-full` beside margins now
overflow, as in the browser; a non-stretched grid item's basis is its
area.

**Tests**: layout.test.ts, flex.test.ts, grid.test.ts and
multicol.test.ts: `w-full mx-4`, `w-1/2 ml-2`, percent padding and
`max-w-full` beside margins; a box story's rows against a native copy.

**Steps**: written when the item starts.

## 5. Gradients: the remainder

The parsing and the unclipped stops are done (the research's "Decided
2026-09-23"). What remains:

### 5a. A first stop in `lab()` or `lch()`

**Found**: style.ts's `startsWithColor` knows `rgb()`, `hsl()`,
`oklab()`, `oklch()` and `color()`, not `lab()` or `lch()`, which all
three engines serialize as written (probed). A gradient opening with
such a stop takes it for its direction and drops it; with two stops,
the gradient is gone (run through the engine 2026-09-27: no gradient
cell for a two-stop `lab()` or `lch()` gradient in Chromium and
Firefox, against eleven for `rgb()`). The research's "a leading `lab()` is taken for
the direction" still holds.

**Approach**: the test names every function the color parser reads.

**Size**: small. **Tests**: gradient.test.ts, both functions first,
red before.

### 5b. The other interpolation spaces

**Deviation**: gradients.md 4, a space other than oklab, oklch, srgb,
srgb-linear and hsl interpolates in oklab.

**CSS**: `in lab`, `lch`, `hwb`, `xyz`, `xyz-d50`, `xyz-d65`,
`display-p3`, `a98-rgb`, `prophoto-rgb`, `rec2020`, serialized as
written (probed). Tailwind's modifiers name srgb, hsl, oklab and oklch
alone, so these come from arbitrary values and inline styles.

**Approach**: color.ts gains the conversions from sRGB into each space
(it has only the way back), hwb both ways, lch and hwb polar under the
hue modes; `ColorSpace` and the space's read take them.

**Size**: small.

**Tests**: gradient.test.ts, a midpoint per space against the
engines' `color-mix()` in that space, which interpolates alike and
reads back from computed style (probed when the item starts); the
gradients story gains `in lab` and `in display-p3` cards, its golden
moving.

### 5c. The fade drift: fixed, dropped

**What it was**: the follow-ups plan's "engine-run fades of out-of-sRGB
colors" (377fd08): color.ts clamped each endpoint on parse, so a
synthesized `background-color` fade of such a color drifted mid-fade
(emerald-400 to gray-800 at 0.25). The same batch fixed it before its
commit: colors stay unclipped, and a fade mixes each end's own value
(cell-model.md "Animation").

**Verified**: at 0.25, for emerald-400 to gray-800, emerald-300 to
white, and display-p3 red to blue, the engine's mix equals Chromium's
and WebKit's own interpolation (Web Animations, paused). Firefox
interpolates otherwise, apart from both. Nothing is left to fix.

## 6. Baseline alignment

**Deviation**: flex.md 2, grid.md 3, table.md 4: a baseline item sits
at its line's start edge.

**CSS** (probed):

- Items line up their first text rows: a `pt-5` item, a top-bordered
  one and one whose nested child is padded each move down until their
  text rows meet.
- In flex and grid, a box with no line takes its border box's bottom
  edge as its baseline, so the others' text rows end there.
- A table row lines up its cells' first rows, a cell with no line left
  out; div-table cells default to `baseline`.

**Approach**: a first-baseline row per box: a leaf's first text row,
past its content origin; a container's first in-flow child's, plus
that child's offset; none without a line. A last one serves `last
baseline`. A flex row's baseline group moves each item down by the
group's deepest row less its own, and the line's cross size grows to
hold them above and below. Tables do the same per row, grid per row
track. The `baselineRow` behind `vertical-align: middle` shares the
helper where it can, and is cleared per layout (it is not today).

**Spec first**: flex.md, grid.md and table.md each state the rule, and
their deviations go.

**Size**: medium: flex rows first, then tables and grid, small each.

**Risks**: div-table stories move where their cells' paddings differ;
`wrap-reverse` and `last baseline`; the helper's cost, memoized per
layout.

**Tests**: flex.test.ts, table.test.ts and grid.test.ts, each probe
case; positioning.test.ts's in-flow baseline pin under `wrap-reverse`
revisited. A story, `Baseline`: a flex row, a div-table and a grid,
each beside a native copy, their text rows compared; its golden.

**Steps**: written when the item starts.

## 7. The smalls

The research's item 7 lists the anchor containing-block check too; it
is A1 now.

### 7a. Text indent

**Deviation**: cell-model.md "Text indent": a negative indent reads 0,
a percentage 0, and intrinsic sizes leave it out.

**CSS** (probed):

- A negative indent hangs: `-indent-6 pl-12` starts the first line
  24px in, the rest 48px.
- `10%` is a tenth of the block's content width.
- Min- and max-content count it: an inline block `abc` indented 48px
  is 48px plus three glyphs wide, and `w-min` over `ab cdefgh` is
  `ab` plus the indent; a negative indent narrows max-content.
- **Found**: every anonymous run of a mixed container takes the
  container's indent; CSS indents the first formatted line alone, so a
  run after a block child starts at 0 in all three.

**Approach**: the indent reads as a length and resolves once against
the leaf's content width, negative allowed; the wrap and `lineStart`
take it signed; intrinsic widths add it to the first line and the
first segment; an anonymous run takes it only as its container's first
child.

**Size**: small–medium (four smalls).

**Risks**: a line starting left of its box. The hit rect grows right
and down only, `leafLineCovers` rejects a cell left of the line's
start, `contentExtent` tracks maxima, and the wrap clamps the indent
at 0; each takes the negative start.

**Tests**: wrap.test.ts, layout.test.ts and tree.test.ts, each probe
row; a typography story's indents against native rows.

### 7b. Additive `scroll-padding`

**Deviation**: scrolling.md, Deviations: an authored `scroll-padding`
is not read; the companion locks it to the border and bar cells.

**CSS**: a scroll container's `scroll-padding` insets the area a
reveal brings its target into; `scroll-mt-*` on the target adds to it.

**Approach**: read the four sides (the lock is measuring-gated, so
they read), convert them to cells, and write them as variables the
lock's `calc()` adds.

**Size**: small.

**Tests**: style.test.ts, the read; cascade.test.ts sorts the new
variables; a scrolling story: a focus reveal stops clear by the
authored padding.

### 7c, 7d. `fit-content()` and `calc()` tracks

**Deviation**: grid.md 5, both parse as `auto`.

**CSS**: `fit-content(L)` sizes as `minmax(auto, max-content)` with
its limit clamped at L (css-grid §7.2.4); a `calc()` of lengths and
percentages is a fixed breadth.

**Approach**: the track parse reads a `calc()` through the existing
calc evaluator into a length; `fit-content()` becomes a breadth whose
growth limit clamps at its argument in track sizing.

**Size**: small each.

**Tests**: grid.test.ts's pinned parses flip; a track at
min(max-content, L), floored at min-content;
`grid-cols-[calc(100%-2rem)_1fr]`.

### 7e. Multicol min-content

**Deviation**: multicol.md 5, the widest child.

**CSS**: count × widest word + gaps (the research's probe).

**Approach**: min-content goes through the multicol intrinsic width
as max-content does, a leaf's and a container's alike.

**Size**: small. **Tests**: multicol.test.ts.

### 7f. Subgrid line names

**Deviation**: grid.md 1, the subgrid inherits no line names, and its
own `subgrid [a] [b]` list is dropped at parse.

**CSS**: a subgrid's items resolve the parent's names on the spanned
lines, and the subgrid's own (the research's probe).

**Approach**: the inherited tracks carry the spanned lines' names; the
parse keeps the subgrid's list.

**Size**: small. **Tests**: grid.test.ts. E3 rides with it.

### 7g. Caption margins

**Deviation**: table.md "Caption", margins on the caption are ignored.

**CSS** (probed): they apply: `mt-5 mr-4 mb-2.5 ml-8` puts the caption
20px down and 32px in, 16px short of the right edge, the grid 10px
below; negative margins reach past the table; auto margins center a
sized caption. **Found**: the table's width floors at the caption's
min-content, a long caption wrapping to the table, where the engine
widens the table to the caption's max-content.

**Approach**: the caption's margins resolve against the table's width
and place it; its min-content floors the table's.

**Size**: small. **Tests**: table.test.ts, the probe cases. E2 rides
with it.

### 7h. Hover on inline elements

**Deviation**: cell-model.md "Pointer states", deviations: hover
resolves to block-level boxes.

**CSS**: `:hover` holds on the innermost element under the pointer and
its ancestors, inline ones included. A link hovers natively already
(interactive elements take the pointer); a `hover:` utility on a
non-interactive span does nothing under `select="grid"`.

**The code**: the hit already finds the character at the cell and its
inline entry, and drops them.

**Approach**: the chain gains the inline elements over the cell's
character, outermost first, after the leaf's boxes; hover, active and
the cursor follow.

**Size**: small.

**Risks**: more attribute changes as the pointer crosses spans; the
prose hover step, benched.

**Tests**: pointer.test.ts, chains through a span and a nested pair;
the `SynthesizedPointerStates` story's span, pinned unhovered, flips.

### 7i. The decoration properties

**Deviation**: cell-model.md "Typography": a decoration line is drawn
in its glyph's color, solid, at the font's thickness;
`text-decoration-color`, `-style` and `-thickness` are never read.

**CSS**: `decoration-*` colors, `decoration-wavy` and the other
styles, `decoration-2`, `underline-offset-*`; a propagated decoration
keeps the decorating box's color, style and thickness.

**The code**: the grid's span draws a native `text-decoration` of the
line alone.

**Approach**: read the color, style, thickness and underline offset on
each box and inline entry, propagate them with the line, and write
them on the grid's span; the paint fields gain them.

**Size**: small–medium.

**Risks**: spans split by the new fields; a `text-decoration-color`
transition still shows nothing, since the lock keeps the light DOM's
decoration transparent (decision D8).

**Tests**: plain-text.test.ts, the paint fields and a propagated
color; style and tree tests; a typography story with wavy, colored and
offset underlines; its golden.

### 7j. `overflow: clip`

**Deviation**: the research's "`overflow: clip` read as `hidden`",
automatic minimum 0 for both. **Found in the code**: `overflow-x:
clip` alone makes y a scroll container (the read's coercion), and a
clip box is a formatting-context root (float.md lists it).

**CSS** (probed): a clip flex item keeps its content-based minimum
(192px wide, hidden 0); `overflow-x: clip` leaves y `visible`; a clip
box does not step aside from a float, a hidden one does.

**Approach**: the read keeps clip apart from hidden, neither a scroll
container: the coercion skips clip, the automatic minimum and the
grid's contribution keep the content for clip, and a clip box is no
formatting-context root.

**Size**: small.

**Risks**: 31 test sites build `"clip"` to mean hidden; they take
hidden. float.md's root list changes.

**Tests**: style.test.ts, flex.test.ts, grid.test.ts, float.test.ts,
each probe case.

**Steps** (7a–7j): written as each starts.

## 8. White space

### 8a. `pre-line`

**Deviation**: cell-model.md 8, `pre-line` collapses newlines.

**CSS**: newlines break, spaces collapse, lines wrap (the research: the
engines agree).

**Approach**: the extraction emits a hard break for each newline under
`pre-line`, the wrap unchanged; a native flag restores `pre-line` as
`data-mw-pre` restores `pre`.

**Size**: small.

**Risks**: each `whiteSpace !== "normal"` check that means nowrap.

**Tests**: tree.test.ts ("keeps collapsing without the pre flag"
flips), wrap.test.ts; a typography story against native rows.

### 8b. `pre-wrap`, `break-spaces`

**Deviation**: cell-model.md 8, spaces collapse under both.

**CSS**: spaces are kept and lines wrap. Under `pre-wrap`, spaces at a
soft break hang, taking no width; under `break-spaces` they take width
and wrap, with a break after every space.

**Approach**: the `pre` extraction; wrap.ts gains a preserved mode:
leading spaces kept, separators at their own advance, a line of spaces
kept, a break after a space run or after every space. Hanging spaces
are left out of the fit and the alignment, as the trailing tracking
gap is, and `lineStart`, the paint and the clip agree on them.
Min-content alike.

**Spec first**: cell-model.md "White-space and truncation".

**Size**: medium.

**Risks**: the wrap's hot path (the prose relayout, benched); the
selection across hanging spaces; a textarea, natively `pre-wrap`,
could use the mode for cell-model.md 19, not in this item.

**Tests**: wrap.test.ts, tree.test.ts; a typography story against
native rows in three engines.

**Steps** (8a, 8b): written as each starts.

## 9. Justify, line breaks, a run's absolute boxes, inline percentages

### 9a. `text-align: justify`

**Deviation**: cell-model.md 6, justify is forced to `start`, its
premise gone with the unified render (the research).

**CSS**: every line but the last, and one ending at a hard break,
fills the width, the space shared among its word gaps.

**Approach**: the grid shares a line's leftover cells among its gaps
(decision D6); the native copy, its lock lifted, is justified by the
browser and drifts under a cell as center's half cell does. The
per-gap offsets join `lineStart`'s, read by the paint, the atomic box
placement and the text extent.

**Size**: small–medium.

**Risks**: the paint, the box placement and the text extent reading
the same offsets; a line of one word; hanging spaces (8b) left out;
find-in-page's highlight up to a cell off.

**Tests**: layout.test.ts and plain-text.test.ts; the `TextAlign`
story's justify case, pinned at start, flips to justified rows,
compared by word.

### 9b. A UAX #14 subset

**Deviation**: cell-model.md "Hyphen break opportunities": CJK, dashes,
ZWSP, `<wbr>` and the soft hyphen are no break points.

**CSS** (probed):

- ZWSP and `<wbr>` are break opportunities.
- A soft hyphen breaks, showing a hyphen at the line's end, and shows
  nothing unbroken.
- An em dash breaks before and after it, an en dash after.
- CJK ideographs, kana and Hangul break between any two, never before
  closing punctuation (`。、）」`) nor after opening punctuation.
- Before the prolonged sound mark `ー` and small kana, Chromium breaks,
  Firefox and WebKit do not.
- Beyond the subset: `?` before a letter breaks in all three, `/` in
  Firefox alone.

**Approach**: wrap.ts's segments gain the subset's classes, from a
table of ranges behind an ASCII fast path. `<wbr>` becomes a
zero-advance break marker in the run, standing for no text. A broken
soft hyphen paints `-` in the cell after its line. The rest stays a
deviation: full UAX #14 needs the line-break tables, which the
platform does not expose (`Intl.Segmenter` has no line granularity).

**Size**: medium.

**Risks**: the wrap's hot path (benched); the selection and the copy
across a marker and a shown hyphen, which copy nothing; wide CJK
beside the cell-boundary fallback; the kana case (decision D7).

**Tests**: wrap.test.ts, each probe case; tree.test.ts, `<wbr>` and the
soft hyphen. A typography story, `LineBreaks`, against native rows in
three engines, the kana case left out where the engines differ.

### 9c. An absolute box's spot in a run

**Deviation**: positioning.md 3, an out-of-flow element of a text run
takes its leaf's content-box origin as its static position.

**CSS** (probed):

- An inline-level box (a `<span class="absolute">`) sits where it
  would have been in the line: mid-line at its character's spot,
  centered text included.
- At a line's end, Chromium and WebKit put it there, Firefox at the
  next line's start.
- A block-level one (a `<div>`, or `block` on the span) starts the
  next line, at the content edge.
- An inset on one axis replaces that axis alone.

**Approach**: the run records where each out-of-flow child sat, a
character index found through the leaf's `charSource`, as the
selection's `charIndexAt` finds one, so it survives the run's
normalization. Layout puts an inline-level child at that character's
line and column, a block-level one at the next line's start. Whether a
box is inline-level is its display before blockification, read with
its position held static under a read flag, as `data-mw-degrid` reads
a grid template (decision D10).

**Size**: medium.

**Risks**: the extra read's style recalc, for those elements alone;
the line's end (the engine follows Chromium and WebKit); a child at
the run's start or end.

**Tests**: positioning.test.ts, the probe rows ("uses the leaf's
content origin" flips); a story: a badge span in a paragraph without
insets, beside a native copy.

### 9d. Percent insets on inline elements

**Deviation**: positioning.md 2, a percentage inset on an inline
element reads 0, and in Firefox the px it resolves to.

**CSS** (probed): the basis is the block container's content box:
`left-1/2` is half its width, for a nested span too (not its parent
span's). A vertical percentage resolves against a definite height and
is 0 under an auto one. Chromium and WebKit compute the percentage;
Firefox 155, without Typed OM, gives the used px, which the engine
reads as a length today.

**Approach**: an inline entry keeps each inset a length, read as a
box's insets are, the class scan standing in for Typed OM in Firefox.
The shift resolves it against its leaf's content box, a vertical one
against a definite height alone; a sticky span's against its
scrollport (sticky.md); the native variables take the resolved cells.

**Size**: small–medium.

**Risks**: the inline entry's type; the sticky span's path.

**Tests**: tree.test.ts ("… percent insets too" flips);
plain-text.test.ts, the shifts; the `InlineRelative` story gains
`left-1/2`, against a native copy.

**Steps** (9a–9d): written as each starts.

## Extras

### E1. A grid holding only text

**Deviation**: grid.md 6, such a grid lays out as a text leaf: no
tracks, its alignment folded into its padding.

**CSS** (probed): the text is an anonymous grid item. Under
`grid-cols-3` it wraps in the first column; `place-items-center` and
`place-content-center` center it; `grid-rows-[40px] items-end` ends it
in its row; `w-max grid-cols-2 gap-x-2` takes the tracks' width. An
element child is an item of its own, so only a grid of text nodes
alone is concerned.

**Approach**: the anonymous-item path does both. A grid of text nodes
builds as a container of one anonymous run, which `layoutGrid` places,
sizes and aligns as any item. Its native text, which a mixed container
leaves where the browser flows it (cell-model.md 7), lands here
because it is the only item: its offsets fold into the container's
padding, as `alignLeafText` folds them now, over the companion's
resets of the templates and `place-*`. Those resets gain `gap` and
`grid-auto-*`, which they leave today: an implicit track's authored
size reaches the lone item natively (probed 2026-09-27: a text grid
under `grid-auto-columns: 80px` wraps its native text into 8 lines
where the grid shows 1, in all three engines). The grid case of `alignLeafText` and of the leaf dispatch
goes. A flex container of text keeps its leaf path:
its alignment is complete, and it is every text button (decision D9).

**Spec first**: grid.md's deviation 6 goes, and "Items in their areas"
names the anonymous item.

**Size**: medium.

**Risks**: code keyed on the container being the leaf (the selection's
run handling, `charSource`, the leaf extent, focus); layout.test.ts's
grid-leaf padding pin.

**Tests**: tree.test.ts and grid.test.ts, each probe case; a grid
story, `TextOnlyGrid`, beside native copies; its golden.

### E2. The caption outside the table's border

**Deviation**: table.md "Caption": the caption lays out in the
table's content box. In the separate model the table's ring and fill
wrap caption and grid; collapsed, the lattice starts under the
caption, but the fill still paints the caption's rows.

**CSS** (probed): the caption sits outside the table box's border and
padding, as wide as its border box (95px over a separate table with a
4px border, 5px padding and 6px spacing), above or below it; the
table's margins wrap both.

**Approach**: the table's node keeps its whole box, caption and grid,
as the browser's table element rect does, and paints its fill, shadow
and ring over the grid's part alone. The caption lays out at the
border box's width, outside border and padding, with 7g's margins.

**Spec first**: table.md "Caption".

**Size**: medium.

**Risks**: the table's paint over part of its rect; the table
element's native box, whose border wraps both natively while its
children's offsets start at its padding box; sticky table parts; the
lattice's origin.

**Tests**: table.test.ts, separate and collapsed; the
`CaptionAndAlignment` story with a bordered table; its golden.

### E3. The subgrid gap

**Deviation**: grid.md 1, a subgrid's own gap does not override the
parent's gutters.

**CSS** (probed): it does, the difference split at each inner gutter.
Over a parent's 20px gap, a subgrid's `gap-0` gives items 110, 120,
120 and 110px wide, each gaining 10px on each inner side; a 40px gap
takes 10px off there. Rows alike; the subgrid's padding still counts.

**Approach**: the inherited tracks keep the parent's lines; each
subgrid item's area grows or shrinks by half the difference on each
inner side, the odd cell to its start side (stated in the spec); the
subgrid's intrinsic width takes the same gap (it reads the subgrid's
own today).

**Size**: small–medium.

**Tests**: grid.test.ts, the probe cases in cells; a subgrid story
against a native copy.

### E4. Mixed-weight and mixed-style corners

**Deviation**: cell-model.md "Borders: glyph mapping": a corner or
junction between weights draws the heavier weight's glyph (`┏` for a
heavy top over light sides), and between styles the solid glyph at the
heavier weight; Unicode's mixed glyphs are "a later refinement".

**Unicode**: light × heavy is complete, corners (`┍ ┎ ┑ ┒ ┕ ┖ ┙ ┚`) and
every tee and cross. Single × double exists where each axis's arms
share a style (`╒ ╓ ╕ ╖ ╘ ╙ ╛ ╜ ╞ ╟ ╡ ╢ ╤ ╥ ╧ ╨ ╪ ╫`). Heavy × double has
none. cp437 has the single × double set, and its heavy band is double,
so a cp437 theme draws `╒═╤═╕`.

**Approach**: a corner or junction takes its glyph by each arm's
weight and style: the default sets from Unicode's mixed glyphs, a set
able to register its own (theming.md), and today's glyph where none
exists (heavy × double; dashed and dotted arms take solid's at their
weight).

**Spec first**: cell-model.md "Borders: glyph mapping" and
theming.md.

**Size**: medium.

**Risks**: goldens with mixed borders (a heavy header line, gap
rules); a font without the mixed glyphs (the glyph degradation path);
the set's API.

**Tests**: plain-text.test.ts's pinned corners flip (`┏━━━━┓` over light
sides becomes `┍━━━━┑`); table.test.ts's lattice (`┏━━┳──┐`);
gap-decorations.test.ts; glyphs.test.ts; the themes story's cp437
golden.

**Steps** (E1–E4): written as each starts.

## Added 2026-09-27

- **`text-transform` (a bug)**: the grid paints the authored case
  (`uppercase` shows "Hello world", probed). The transform can change
  a text's length (`ß` to `SS`), so the character map for selection
  and copy follows it. Small–medium; 0.3.4. Landed (see Progress).
- **`line-clamp-*`**: every line shows (3 under `line-clamp-2`,
  probed). The leaf's lines cut at the clamp, the last one ending in
  `…` as `truncate`'s does. Small–medium.
- **`text-balance`, `text-pretty`**: lines wrap greedily. Balance
  takes the narrowest width keeping the line count; pretty keeps a
  last line from holding one word. Small–medium, small.
- **`break-all`, `break-keep`**: a word past its line overflows it
  (20 letters in 14 cells, probed); `break-all` breaks it anywhere,
  `break-keep` keeps CJK runs whole. Small.
- The glyph properties (types.ts `GLYPH_PROPERTIES`) landed beside the
  combobox fix: smoothing, `font-variant-numeric`, `text-shadow`,
  `text-underline-offset`. Decoration color, style and thickness stay
  item 7i: they belong to the element that draws the line, not to
  inheritance, and a translucent text's line blends with it.

## Decisions for the user

Each with the recommendation, all ten taken as recommended
(2026-09-27).

- **D1. `aspect-ratio` in px or in cells.** Physical (recommended): an
  `aspect-square` box looks square, as the research and the precedent
  of viewport units, shadows and gradients have it. The cost:
  `aspect-square w-20` and `size-20` differ, the spacing scale's
  cells not being square. In cells, the two agree and nothing looks
  square.
- **D2. The anchor rule.** CSS's (recommended): the last acceptable
  element, later in-flow ones included, with `anchor-scope` honored.
  The smaller change keeps the nearest preceding element and adds the
  containing-block check alone. CSS's changes a locked decision of
  anchor-positioning.md, and repeated names under one containing block
  then anchor to the last, as in the browser.
- **D3. Anchor deviation 7.** Keep (recommended), for the reason
  above. The alternative remembers each non-default anchor's offsets
  per box until a placement is chosen again.
- **D4. A hidden anchored box, natively.** `opacity: 0` and no pointer
  events (recommended): the focus and the accessibility tree stay, as
  in the browsers.
- **D5. Display on the host.** Lock and warn (recommended), since CSS
  lays the slotted children out as a block too. The alternative lays
  the root out with the host's display, flex, grid or columns: medium.
- **D6. Justify's odd cells.** The shared integer distribution, the
  remainder to the first gaps (recommended), as flex and grid share
  cells; or spread across the line.
- **D7. Kana in the UAX #14 subset.** No break before `ー` and small
  kana (recommended), as Firefox and WebKit, and `line-break: strict`,
  have it. Chromium breaks there, as `line-break: normal` allows.
- **D8. `text-decoration-color` transitions.** Later (recommended): 7i
  reads and paints the color; a transition needs a synthesized fade as
  `background-color` has, small–medium, and stays a stated deviation
  until then.
- **D9. Text-only flex containers.** Keep their leaf path
  (recommended), E1 routing grids alone.
- **D10. An absolute box's display before blockification.** Read it
  under a flag (recommended), exact for any authoring. The alternative
  guesses from the tag and the class list. At a line's end, the engine
  follows Chromium and WebKit.

## Order

1. F1, `aspect-ratio`, then F2, the host's own height.
2. A1–A6: A1 first; A3 and A4 in the same change, `placeTrying`'s;
   then A2, A5, A6.
3. Items 1, 2 and 3.
4. 5a, then 5b.
5. Item 6: flex rows, then tables, then grid.
6. E1, after 6: both are item alignment in grid.ts.
7. 7a–7j, E3 right after 7f and E2 right after 7g, each sharing its
   code.
8. 8a, then 8b.
9. 9a, 9b, 9c, 9d.
10. E4.

## Estimate

Nine medium items and twenty-four small or small–medium ones.
The stacking batch, one large item, took a day with two review rounds;
this plan is three to four such batches.

- **Fits 0.3.4**: F1, A1–A6, items 1, 2, 3 and 5, item 6's flex rows,
  7a–7j with E3, 8a, 9d.
- **At risk**: item 6's tables and grid, E1, E2, 8b and 9a. Each is
  bounded but moves stories or goldens.
- **Likely to slip**: 9b, 9c and E4, each medium with machinery of its
  own (a break-class table and markers, a second display read, a glyph
  set API) and the most stories and goldens to settle. If 0.3.4 must
  ship sooner, these three go first to 0.3.5, and the plan says so
  here.

## Progress

Each item's line goes here as it lands: the date, what changed, the
tests seen red, and the spec's deviation removed or reworded.

- 2026-09-27, `text-transform`: text-transform.ts maps a text node's
  clusters (case, content language, capitalize's word across elements),
  and tree.ts pushes a lengthened cluster's characters at its offset.
  `charIndexAt` puts a point at a cluster several characters stand for
  before the first, which also fixes a copy starting at a tab (it kept
  the tab's last space alone). Red first: tree.test.ts
  "text-transform", selection.test.ts's transformed and tab copies,
  and the `TextTransform` story in Chromium. cell-model.md
  "Typography" gains the rule, and deviation 22 names `full-width`
  and `full-size-kana`.
- 2026-09-27, F1 `aspect-ratio`: read physically through the cell,
  derived in block flow, flex, grid and absolute placement as the specs
  say. Red first: style.test.ts, layout.test.ts, flex.test.ts,
  grid.test.ts and positioning.test.ts "aspect ratio", and the
  `AspectRatioAgainstNative` story's text box (a block's `auto` minimum
  read `0px` in Chromium and WebKit) and narrow row (a derived width is
  a flex item's min-content width). cell-model.md deviation 9 resolved.
