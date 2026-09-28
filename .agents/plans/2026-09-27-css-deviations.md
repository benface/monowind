# CSS deviations for 0.3.4

Status: **implemented** (2026-09-28, uncommitted for review; see
Progress). The "Order" of
`2026-09-23-css-deviation-reasons.md` as a plan for release 0.3.4,
with the scope decided with the user on 2026-09-27: `aspect-ratio` and
anchor positioning first, then the numbered Order (item 4, stacking,
is done), and four extras beside it; the host's own height and width
(F2, F3), bugs found along the way, join it. Each item gives the deviation,
what CSS does, the approach, its size, its risks and its tests. Its
code-level steps and touch points are written when the item starts; a
medium item starts with its spec change. Deviation numbers are the
lists' as of 2026-09-27, before the review round renumbered them
(Progress). Progress is recorded here,
under "Progress", as each item lands.

## Scope

| Id  | Item                              | Deviation           | Size | 0.3.4 |
| --- | --------------------------------- | ------------------- | ---- | ----- |
| F1  | `aspect-ratio`                    | cell-model 9        | M    | in    |
| F2  | the host's own height             | host sizing (bug)   | M    | in    |
| F3  | a shrink-to-fit host's width      | host sizing (bug)   | S    | in    |
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

**Approach** (cell-model.md "Host sizing", decided with the user
2026-09-27): CSS sizes the host. It keeps `height: auto`; an in-flow
spacer stands for its content (the shadow viewport's `min-height`, the
content's rows); its sizes are the page's px (`h-1` is 4px, as `w-1`
is). Where CSS's height is not the content's, the root lays out against
the rows that fit. No measure tells an authored height from a content
one: the spacer's height is the content's by construction. The height
is not capped to whole rows (reviewed 2026-09-27): a cap at the last
layout's rows holds a `min-h-*` host at its floor as its content grows
past it, and hides the growth from the host's resize observer, which
otherwise sees every change to the height.

**Steps**:

1. The spacer. shadow.css: the slot positioned out of the viewport's
   flow (top left, the viewport's width) outside `:host([measuring])`,
   so neither content not yet laid out nor the host's own text gives
   the host height, and in flow under it as today, for the width's
   read. element.ts writes the viewport's `min-height`, the root's
   natural content rows in px, on the shadow element itself (no
   inherited variable, so nothing below restyles), where it wrote the
   host's inline `height`, which goes.
2. The read. element.ts: the host's content-box height
   (`clientHeight` less its padding) read before `measuring` goes on,
   the slot out of flow and the spacer the last layout's. Within
   half a pixel of the spacer, the content sizes it; else it floors to
   the rows the root lays out against. The cost is the read's forced
   layout (measured with `pnpm bench`, alternated).
3. The layout. layout.ts: `layoutRoot` takes the definite rows and
   forces the root's height; the spacer is the root's
   `naturalContentHeight`, so a height the author removes gives the
   content back. `#laidOutSize.height` is the height read where it
   sized the root, the rows otherwise, so the resize observer relays
   out on any change and never on the layout's own.
4. Tests: a story beside native boxes of the same classes, in three
   engines: `h-40`, `h-screen`, `h-full` in a sized parent, a
   stretching flex row and column, `aspect-video` from a width,
   `min-h-*` under and over the content (its content growing past it),
   `max-h-*` with the content overflowing, and a host whose `h-*` goes
   (the content back); a `flex flex-col` child filling an `h-40` host;
   `countLayouts` for one layout per change of the height, the first
   included, and one more where the content crosses a floor or a cap;
   content appended to an empty host.

**Size**: medium.

## Beside F2: a shrink-to-fit host's width (F3)

**Bug** (found 2026-09-28, all three engines, v0.3.3 too): a host whose
width is its content's (`w-fit`, `inline-block`, `float-left`,
`absolute`, a flex item in a row) is 0px wide once laid out. The
reading pass puts the slot back in the host's flow, so the host's
width is measured from its content and the right columns laid out; out
of it again, the slot takes the content away, and the host's box
collapses: its background and border shrink to nothing, and a flex
sibling paints over the grid (probed: `<p>` after a host in a flex row
at the grid's own left and top).

**CSS** (cell-model.md "Host sizing" already says it): a host sizes
like any box, its width its content's where nothing else sets it.

**Approach**: the viewport's `min-width` stands for the content's width
as its `min-height` stands for its height: the columns laid out, set
beside the height's spacer. Unlike the height, the width is read under
`measuring`, from the slot back in flow, so the spacer is lifted there
(`:host([measuring]) #viewport`); else a shrink-to-fit host could only
grow. A block host is unaffected: its spacer is never wider than the
width it was measured from, and a narrowing container shrinks it
natively, as the width cap already allows.

**Size**: small.

**Risks**: a flex item's automatic minimum is now its columns, so a
narrowing row holds it until the parent's resize relays it out (the
parent is observed already); goldens of shrink-to-fit hosts change,
their boxes now drawn.

**Tests**: a host story beside native boxes, in three engines: `w-fit`,
`inline-block`, `float-left` and a flex row, each host as wide as its
columns plus its chrome, a flex sibling past its right edge; the row
narrowed, the host relaid out narrower. Red first against the last
commit.

**Steps**:

1. shadow.css: `:host([measuring]) #viewport { min-width: 0 !important }`
   beside the slot's rule. element.ts step (6): the viewport's
   `min-width`, the columns laid out times the cell width, written
   where it changes, as `min-height` is.
2. The story (`host.stories.ts`, test-only) and its red run.
3. Docs: cell-model.md "Host sizing" (the spacer's width), shadow.css's
   viewport comment; this plan's Progress.

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

**Approach**: the pass keeps a list per name of the boxes and inline
elements naming it, each with its tree order, its containing-block
chain, whether it lies in the top layer, and its innermost scope, and a
box takes the last acceptable entry. A first walk applies the relative
offsets, records the anchors in flow outside every absolute box, so a
later in-flow anchor is ready, and collects the outermost absolute
boxes; each is then placed in tree order and its subtree walked,
recording its anchors. An anchor is recorded only once any absolute box
it lies in is placed, which is to say before the box looking it up: CSS's
order condition then needs no check of its own (deviation 10 the gap).
An anchor in the top layer anchors only a box there too (probed
2026-09-27: a submenu popover shown after its menu, not a box of the
page). `anchor-scope` is read only in a host where a box is anchored by
name; on a named element, from its inline style or utility; it scopes
authored names alone, a popover's implicit anchor out of its reach. The
spec's locked "the nearest element before it in tree order" changes
(decision D2).

**Steps**:

1. The read. types.ts: `CellStyle.anchorScope` and an inline entry's.
   tree.ts: `readAnchorScopes(root)`; style.ts: `readAnchorScope`,
   computed, or from the inline style or `[anchor-scope:…]` utility on
   a named element; element.ts runs it where `namedAnchors` finds a box
   anchored by name. anchor.test.ts.
2. The lookup. positioning.ts: `walk`, the relative offsets and the
   in-flow anchors, the outermost absolute boxes deferred, then each
   placed and its subtree walked; `recordAnchors` with each anchor's
   order, chain, top layer and scope; `anchorFor(name, box)`, the last
   acceptable one. anchor.test.ts, each probe case.
3. The `AnchorAcceptable` story beside native copies, three engines;
   `Anchored`'s submenu a popover shown after its menu; the anchor
   stories and goldens rechecked; `pnpm bench` (a positioned page)
   before and after.
4. Docs: the spec's touch points; this plan's Progress.

**Size**: medium.

**Risks**:

- The walk's order: relative offsets ahead of placements.
- Fixtures and stories relying on the nearest-preceding rule, names
  repeated under a shared containing block among them. The UI package
  names each trigger uniquely, and its positioners are popovers, so it
  is untouched.
- The engine's own `anchor-scope: all` lock, under the measuring flag,
  hides an authored `anchor-scope` on a named element itself, read
  there from its inline style or utility instead (deviation 3); on a
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
`clip-path: inset(50%)` in place of `visibility: hidden`, the top
layer being out of its ancestors' clip (decision D4, as changed).

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

## 1. The host's display and columns

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

**Approach** (superseded by the Steps below): the companion locks
`columns: auto` on the host, its display staying the author's (a
`hidden` host must hide). The engine warns once where the host has
columns or a flex or grid display: they lay out nothing there and
belong on a wrapper (decision D5).

**Size**: small.

**Risks**: `inline` and `contents` hosts measure no width, as today;
the warning names them too.

**Tests**: a host story with `columns-2`, `grid grid-cols-2` and
`flex gap-2` on the host, the agreement check keeping every light
element on its cells; host-leaf.test.ts, the warning. host-leaf.md's
deviation becomes the block rule and the lock.

**Probed 2026-09-28** (the current build, three engines, a host over
two paragraphs, a bordered box and two more): `block`, `flow-root`,
`flex gap-2`, `grid grid-cols-2`, `grid grid-cols-[100px_1fr]` and
padding with a border keep every light element on its cells, the host's
display laying out the viewport alone, its one child; `columns-2`
moves the last two paragraphs into a second column natively (the grid
906px wide in a 599px host); `inline` and `contents` hosts never lay
out (no content width to measure, so never ready: nothing shows);
`#viewport { column-span: all }` keeps a `columns-2` or `columns-3
gap-8` host's content whole and on its cells, the host's computed
`columns` still the author's.

**Steps** (decided with the user 2026-09-28: the spanner in place of
D5's lock; a warning only where nothing shows):

1. shadow.css: `#viewport { column-span: all }`, so the host's columns
   never fragment its one child, the author's `columns` left as read.
2. element.ts: where the host measures no columns, a display of
   `inline` or `contents` warns once that it lays nothing out.
3. Tests: element.test.ts, the warning, `none` silent; host.stories.ts
   `HostDisplay`, the agreement check under `columns-2`,
   `grid grid-cols-2` and `flex gap-2`, red first against the last
   commit.
4. Docs: host-leaf.md's deviation reworded to the rule, shadow.css's
   comment; this plan's Progress.

Left out: measuring the viewport, the grid's own box, in place of the
host (probed: 600px for an `inline` or `contents` host, a block on a
line of its own, where the host's `clientWidth` is 0) would lay those
hosts out as CSS places them; the height's read (F2) needs the same
switch, and the host rect's other readers an audit. Medium.

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

**Probed 2026-09-28** (native, three engines, a 3-row box): top: the
box at its top margin's row, the line its margin box's rows; bottom:
the line's text on the margin box's last row (`mb-5` 3 rows down, not
2); middle: the margin box centered, off the grid (1.48 rows), which
the whole-row baseline length rounds as it does unmargined.

**Steps**:

1. `inlineBox` carries the box's used margins (types.ts), as `flow`
   carries a flow child's: layout.ts resolves them against the leaf's
   width, lays the box out in the width they leave, and makes the
   marker's advance the margin box; the box sits past its left margin
   and down its top one; `inlineBoxRows`, the margin box's rows, sizes
   the line (`leafLineMetrics`, `lineOpener`). tree.ts's intrinsic
   advance adds the fixed margins.
2. render.ts writes the margins (`--mw-mt`…, beside a flow child's) and
   takes the top margin into the middle alignment's baseline length,
   the bottom one into the bottom-edge fallback; styles.css's inline-box
   rule applies them, the right one less the give-back.
3. Tests: layout.test.ts, each probe row; tree.test.ts, the intrinsic
   width; typography.stories.ts `InlineBoxMargins`, each box's cells
   and the word after it against the browser's, red first against the
   last commit.
4. Docs: cell-model.md "Atomic inline boxes" and deviation 5.

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

**Steps**:

1. layout.ts: `layoutNode`'s `forced.fill`, the width an auto width
   fills or shrinks within, `availableWidth` staying the percentages'
   basis; `resolveWidth` and `ratioWidth` take both. Each caller that
   took its margins off the width passes the containing block's width
   and the reduced one as `fill`: block flow, a float, a box beside
   floats, an inline box, a flex column's item (its percent padding
   against the parent's width too), a non-stretched grid item, a
   multicol column's box and spanner.
2. Tests: layout.test.ts "percentages beside margins", each context;
   box.stories.ts `PercentBesideMargins` against native copies, three
   engines, red first against the last commit.
3. Docs: cell-model.md "Units and value mapping"; this plan's Progress.

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

**Steps**: style.ts's `startsWithColor` takes `lab(` and `lch(`
(`(?:ok)?lab`, `(?:ok)?lch`); gradient.test.ts's read of each first
stop, red first.

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

**Probed 2026-09-28**: `color-mix(in <space>, rgb(255 100 50),
rgb(20 120 220))`, read back through a canvas, agrees within a unit in
all three engines for every space, `longer hue` in lch and hwb too.

**Steps**:

1. color.ts: one table, `SPACES`, a space's way from sRGB and back and
   its hue's index — the RGB spaces through XYZ (`rgbSpace`, the
   inverse matrices by `invert`), lab from XYZ D50, lch and oklch as
   `polar` forms, hsl and hwb — replacing `hueIndex`, the `color()`
   map and the per-space branches of `prepareColor` and `mixColors`;
   `colorSpaceNamed` reads the keyword, `xyz` as `xyz-d65`.
2. style.ts's `gradientSpace` takes any space `colorSpaceNamed` knows.
3. Tests: gradient.test.ts, each space's midpoint against the probe,
   the read of `in lab`, `in display-p3`, `in hwb longer hue` and
   `in xyz`; the gradients story's two cards, their centers apart, red
   first against the last commit.
4. Docs: gradients.md, the rule and deviation 4.

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

**Steps**:

1. layout.ts: `baselineRow(node, last)`, rows from a box's border-box
   top to its first (last) text row: a leaf's line, else its first
   (last) in-flow child's with one; none without a line. It replaces
   `LayoutNode.baselineRow`, which a relayout left stale, render.ts's
   middle alignment reading it.
2. flex.ts, a row's lines: the items aligned by `baseline` (or `last
baseline`) whose cross margins are not auto form a group; each sits
   where its baseline row meets the group's lowest (a box without a
   line its last row), the line's height growing to hold them; the
   group rides the line's cross-start (a `last baseline` group its
   end), the bottom under `wrap-reverse`.
3. table.ts: `verticalAlign` gains `baseline` (style.ts; an inline box
   takes it as top, as before); a row's baseline cells with a line
   shift their content to the row's lowest first row, the row growing
   to hold it.
4. grid.ts: a row track's baseline items (their first row) add their
   shift to their row contribution before the rows size, and sit by
   it.
5. Tests: flex.test.ts, table.test.ts, grid.test.ts, each probe case,
   red first; the `Baseline` story beside native copies, three engines,
   its golden. Docs: flex.md 2, grid.md 3 and table.md 4 become the
   rule.

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

**Steps**: style.ts reads a signed length or a percentage
(`CellStyle.textIndent: CellLength`); a leaf resolves it once as it
lays out (`LayoutNode.indent`), which the wrap (unclamped), `lineStart`
and the native `--mw-ti` (render.ts `nativeIndent`, a container's by
its first run) share; tree.ts's max-content and wrap.ts's min-content
add a length on the first line and segment; tree.ts gives a container's
runs after its first no indent. Tests: layout.test.ts and tree.test.ts
each probe row, typography.stories.ts `TextIndent` beside native
copies word by word (`expectWordsAsNative`), red first.

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

**Steps**: style.ts `readScrollPadding`, a scroll container's four
sides in cells (`CellStyle.scrollPadding`); render.ts writes them as
`--mw-sp*` beside the bars' cells; the lock adds them. Tests:
style.test.ts, cascade.test.ts's variables, overflow.stories.ts
`ScrollPadding` (a `scrollIntoView` stopping three rows up: `focus()`
centers, so it can't show the padding), red first.

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

**Steps**: style.ts's `parseTrackSize` reads `fit-content(L)` as
minmax(auto, a `fit-content` breadth over L), `parseTrackBreadth` a
`calc()` as a `math` sum of its percentage and cells (types.ts);
grid.ts's `fixedBreadth` sums, and a track's `cap` holds its limit's
growth at L and keeps it out of the auto stretch. Tests: grid.test.ts
(the parses, the three widths, the calc), grid.stories.ts
`TrackFunctions` beside native copies, red first.

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

**Steps**: style.ts keeps `subgrid [a] [b c]`'s list (types.ts's
subgrid template gains `lineNames`); grid.ts's `subgridOf` hands a
subgrid child its spans and the parent's names on the lines they
cover, and `placeholderTemplate` names the stand-in tracks' lines with
those, then the subgrid's own. Tests: grid.test.ts's parse and a
subgrid placing items by the parent's names and its own, red first.

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

**Steps** (with E2): table.ts lays the caption out at the table's
border-box width, its margins resolved against it and placed as block
flow places them (`blockCrossOffset`), outside the border and padding,
and floors both intrinsic widths at its min-content less the table's
chrome; the table's node keeps the whole box and `tableBox` (types.ts)
names the rows its border, fill and shadows take (plain-text.ts
`paintBox`). Tests: table.test.ts (above and below, margins, auto and
negative ones, the floor, a collapsed table's fill), table.stories.ts
`CaptionBox` beside native copies, red first.

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

**Steps**: pointer.ts's hit becomes a `Hit`, its stack and the inline
elements over the hit character (`hitOf`, from the character's inline
entry up its parents); `chainOf` appends them, and element.ts reads
the chain through `chainAt`. Tests: pointer.test.ts (a nested pair, a
relative span's glyph, a link that takes the pointer again), the
story's span hovering on its own characters, red first.

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

**Steps**: types.ts's `TextDecoration` (line, style, color, thickness;
the offset, inherited, stays a glyph property), one object per value
(`decorationOf`), replaces `textDecorationLine` on styles and inline
entries, and `decoration` the paint's field; style.ts's
`readDecoration` resolves `currentcolor` on the box; tree.ts's
`withPropagated` joins the lines in the innermost's drawing;
plain-text.ts's `applyDecoration` writes it on the span (and the
emoji's, paint.ts), whose prototype key reads it. Tests:
plain-text.test.ts, paint.test.ts (boxed clusters apart), the
`Decorations` story and its golden, red first.

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

**Steps**: types.ts's `OverflowAxis` gains `hidden` beside `clip`,
`isScrollContainer` (hidden, auto, scroll) and `clipsAxis` (hidden,
clip); style.ts's read keeps them apart and coerces as CSS does beside a
scroll container; `automaticMinimum` (flex.ts), the grid's contribution
(`scrolls`) and `isFormattingContextRoot` (layout.ts) ask
`isScrollContainer`; truncation, the native lock's flag and a leaf's
clip ask `clipsAxis`. The native lock (styles.css), which read back as
`clip` from the second layout on, is gated on the read flag and set
only on a box clipping both axes (a lone clipping axis is an authored
`clip` already). Tests: the four probes, red first; the 38
test sites that built `clip` to mean hidden take `hidden`; the
`ClipAndHidden` story across a relayout.

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

**Steps**: types.ts's `WhiteSpace` gains `pre-line` and `softWraps`,
which the nowrap checks ask (layout.ts, plain-text.ts, render.ts);
tree.ts's extraction pushes a hard break per source newline under it
(`breaks`); render.ts restores it natively (`--mw-ws` beside
`data-mw-pre`, styles.css, as 8b left it). Tests: tree.test.ts's
flipped case, the `WhiteSpace` story's pre-line cases beside native
copies and the host's own light rows.

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

**Steps**: types.ts's `WhiteSpace` gains both, `preservedSpaces`
naming wrap.ts's `preserve` mode; wrap.ts's `wrapHardLine` wraps
`lineUnits` (a word's segments, and `break-spaces`' every space), what
joins a unit being one space per collapsed run or the preserved ones,
a preserved line opening at its hard line's start; the extraction
keeps their spaces as `pre`'s (tree.ts), and `--mw-ws` restores the
value natively beside `data-mw-pre` (render.ts, styles.css). Tests:
wrap.test.ts, tree.test.ts, the `WhiteSpace` story (8a's `PreLine`
folded in) beside native copies and the host's light rows.

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

**Steps**: `textAlign` gains `justify` (types.ts, style.ts), and
`textAlignBlocked`, its flag and its lock go (render.ts, styles.css);
layout.ts's `lineStart` returns a justified line's `spread` (its gaps'
cells, `justifySpread`, the paragraph's last line and one before a hard
break left, `endsParagraph`), which the paint's walk
(`forEachLeafCell`) and the atomic box placement add. Tests:
plain-text.test.ts, the `Justify` story within a cell of the native
copy's fractional columns, `TextAlign`'s case.

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

**Steps**: wrap.ts's `breakableSegmentRanges` asks `breaksBetween` at
each non-ASCII pair (the classes by `breakClass`), `SOFT_HYPHEN`'s cell
counting in the fit and a line's width (`showsHyphen`, `lineCells`);
tree.ts pushes `WBR_MARKER` for a `<wbr>`, which the copy drops
(selection.ts); plain-text.ts's walk paints a broken soft hyphen as `-`
(`showsHyphen`). Tests: wrap.test.ts, tree.test.ts,
plain-text.test.ts, selection.test.ts, the `LineBreaks` story row by
row (`expectLinesAsNative`), the CJK copies spaced to two cells a
character.

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

**Steps**: tree.ts's `runSpotOf` gives each out-of-flow child of a leaf
its `runSpot` (types.ts): the character `charIndexAt` maps its DOM spot
to, and whether it was inline-level, read under `data-mw-static-read`
(styles.css) only where an axis lacks insets; layout.ts's `spotInRun`
turns it into the static slot, `lineStart` and a justified line's
spread included. A leaf without the spot (a hand-built node) keeps the
content origin, so "uses the leaf's content origin" stands. Tests:
positioning.test.ts's three, the `RunSpot` story beside native copies.

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

**Steps**: types.ts's `InlineElement` keeps `insetLengths` (and
`sticky` as lengths); tree.ts reads them through style.ts's
`readElementInsets` (Typed OM or the class scan); layout.ts's
`resolveInsets` turns them into `insets` per layout in the leaf, and
sticky.ts's `shiftWithin` against the scrollport. Tests:
tree.test.ts's flipped case, and a test-only `InlinePercentInsets`
story beside native copies (the golden `InlineRelative` left as is).

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

**Steps**:

1. tree.ts: a grid (not a form control) builds as a container over its
   runs, text alone making one anonymous item.
2. grid.ts: a lone anonymous item's offsets fold into the grid's
   padding, the item's rows returned as the content's; layout.ts's
   `alignLeafText` and leaf-dispatch docs lose the grid case.
3. styles.css: the laid-out reset takes `grid-auto-columns` and
   `grid-auto-rows` too (`gap` stays: a lone item crosses none).
4. Tests: tree.test.ts, grid.test.ts, layout.test.ts's place-items pin
   now through the item; grid.stories.ts `TextOnlyGrid` beside native
   copies, word by word, red first against the last commit.
5. Docs: grid.md's "Items in their areas" and deviation 6.

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

**Steps**: `gap: normal` reads as `null` (style.ts, types.ts), 0 to
`resolveGap`; grid.ts's `inheritTracks` moves each inner gutter to the
subgrid's gap (`subgridGap`: its own, or the parent's under `normal`)
about its middle (`gutterShift`), and `subgridContributions` counts the
cells as margin on the items beside an inner gutter, nested subgrids
taking the subgrid's gap as their parent's. Tests: grid.test.ts (the
probe's three gaps, the sizing in both axes), style.test.ts's `normal`,
grid.stories.ts `SubgridGap` beside native copies, red first.

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

**Steps**: glyphs.ts's `mixedJunction` reads each arm's line off the
glyph its band draws (`ARM_LINES`) and looks the arms up in Unicode's
junctions (`JUNCTIONS`), none where they draw alike, heavy meets
double, a line is no box drawing, or the font's missing list names the
glyph (`missingOf`, recorded by `glyphSetNameFor`); borders.ts's
`mixedArms` serves the box corners (`paintRing`), the gap rules'
crossings and border tees, and the lattice, whose cells keep the
heaviest segment per arm (lattice.ts). No set API: a set's own lines
decide. Tests: the pinned corners, lattice and rule junctions flip;
glyphs.test.ts "mixed junctions"; plain-text.test.ts's cp437 corner;
goldens where borders meet unlike.

## Added 2026-09-27

- **`text-transform` (a bug)**: the grid paints the authored case
  (`uppercase` shows "Hello world", probed). The transform can change
  a text's length (`ß` to `SS`), so the character map for selection
  and copy follows it. Small–medium; 0.3.4. Landed (see Progress).
- **`line-clamp-*`**: every line shows (3 under `line-clamp-2`,
  probed). The leaf's lines cut at the clamp, the last one ending in
  `…` as `truncate`'s does. Small–medium. **Steps**: style.ts's
  `readLineClamp` (types.ts `lineClamp`), layout.ts's
  `leafLineGeometry` keeping the clamp's lines (`clamped`), and
  plain-text.ts's `truncateSpan` ending the last in `…`. Tests:
  plain-text.test.ts, the `LineClamp` story beside native copies.
- **`text-balance`, `text-pretty`**: lines wrap greedily. Balance
  takes the narrowest width keeping the line count; pretty keeps a
  last line from holding one word. Small–medium, small. **Steps**:
  types.ts `textWrapStyle`, style.ts's `readTextWrapStyle`; layout.ts's
  `leafLineSpans` passes its wrap to `balanced` (a binary search on the
  width, six lines at most) or `pretty`. Tests: plain-text.test.ts, the
  `WrapStyle` story (pretty in Chromium alone).
- **`break-all`, `break-keep`**: a word past its line overflows it
  (20 letters in 14 cells, probed); `break-all` breaks it anywhere,
  `break-keep` keeps CJK runs whole. Small. **Steps**: types.ts
  `wordBreak`, read in style.ts; wrap.ts's `wordBreak` option turns
  `breaksBetween`'s letters into ideographs (`break-all`) or its
  ideographs into letters (`keep-all`), a break never inside a cluster.
  Tests: wrap.test.ts, the `LineBreaks` story's two cases.
- The glyph properties (types.ts `GLYPH_PROPERTIES`) landed beside the
  combobox fix: smoothing, `font-variant-numeric`, `text-shadow`,
  `text-underline-offset`. Decoration color, style and thickness stay
  item 7i: they belong to the element that draws the line, not to
  inheritance, and a translucent text's line blends with it.

## Decisions for the user

Each with the recommendation, D1–D10 taken as recommended
(2026-09-27); D4 and D5 changed 2026-09-28; D11 taken as recommended
2026-09-28, replacing D6.

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
  in the browsers. Changed 2026-09-28 to `clip-path: inset(50%)` (A6's
  Progress entry).
- **D5. Display on the host.** Lock and warn (recommended), since CSS
  lays the slotted children out as a block too. The alternative lays
  the root out with the host's display, flex, grid or columns: medium.
  Changed 2026-09-28 to the spanner (item 1's Steps).
- **D6. Justify's odd cells.** The shared integer distribution, the
  remainder to the first gaps (recommended), as flex and grid share
  cells; or spread across the line. Replaced by D11.
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

- **D11. Justify's odd cells, revisited (for the user, 2026-09-28).**
  D6's first-gaps rule drifts a native word or atomic box up to about a
  cell from the grid's (`Justify` at width 24: `but` 1.00 cells off in
  Chromium, 1.06 in Firefox), past the agreement sweep's half cell for
  boxes (visual/agreement.spec.ts). Recommended: the rounded spread
  (each gap's edge at `round(k × leftover ÷ gaps)`), within half a cell
  where the browser shares evenly (Chromium, WebKit). Neither fixes
  Firefox's line ending at an atomic box (it expands that line less,
  probed). Taken 2026-09-28: the rounded spread, each word at the cell
  nearest its even share.

## Order

1. F1, `aspect-ratio`, then F2, the host's own height.
2. A1–A6: A1 first; A3 and A4 in the same change, `placeTrying`'s;
   then A2, A5, A6.
3. F3 (a shrink-to-fit host's width, a bug), then
   items 1, 2 and 3.
4. 5a, then 5b.
5. Item 6: flex rows, then tables, then grid.
6. E1, after 6: both are item alignment in grid.ts.
7. 7a–7j, E3 right after 7f and E2 right after 7g, each sharing its
   code; `line-clamp-*` right after 7j, cutting lines as `truncate`
   does.
8. 8a, then 8b.
9. 9a, then `text-balance` and `text-pretty` (all three choose where
   lines break), 9b, then `break-all` and `break-keep` (the same line
   breaking), 9c, 9d.
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

Outcome: every item landed by 2026-09-28, uncommitted for review (see
Progress); E4 needed no set API, a set's own line glyphs deciding its
junctions.

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
  "Typography" gains the rule, and deviation 20 names `full-width`
  and `full-size-kana`.
- 2026-09-27, F1 `aspect-ratio`: read physically through the cell,
  derived in block flow, flex, grid and absolute placement as the specs
  say. Red first: style.test.ts, layout.test.ts, flex.test.ts,
  grid.test.ts and positioning.test.ts "aspect ratio", and the
  `AspectRatioAgainstNative` story's text box (a block's `auto` minimum
  read `0px` in Chromium and WebKit) and narrow row (a derived width is
  a flex item's min-content width). cell-model.md deviation 9 resolved.
- 2026-09-27, F2 the host's own height: CSS sizes the host (the slot
  out of its flow, the viewport's `min-height` the content's rows), and
  the root lays out against the rows its own height gives it. Red
  first: host.stories.ts `OwnHeight` against the last commit (an
  `h-40` host one row tall). cell-model.md "Host sizing" rewritten;
  deviation 21 (a host's `min-h-*` floor definite to the root).
- 2026-09-27, A1 the last acceptable anchor: `anchorFor` takes a box's
  last acceptable anchor in tree order, `anchor-scope` read where a box
  is anchored by name, an anchor in the top layer a top-layer box's
  alone. Red first: anchor.test.ts "the last acceptable anchor" (five
  of six) and `AnchorAcceptable` against the last commit. The
  `Anchored` story's submenu is a popover shown after its menu, as
  browsers refuse a page box an anchor in a popover. anchor-positioning
  deviation 3 reworded (`anchor-scope`'s read), deviation 10 added
  (placement in tree order).
- 2026-09-27, A3 and A4: the insets apply inside an area, which
  `placeTrying`'s block now takes like any containing block (Firefox
  ignores them, named in the spec), and `flip-start` swaps the box's
  sizes and their limits (`swapSizes`). Red first: anchor.test.ts
  "applies its insets inside the area…" and "swaps the box's sizes…";
  two tests of the old behavior now CSS's (an `anchor()`-inset box's
  area fallback keeps its insets, as in all three engines). Deviation
  1's two sentences removed.
- 2026-09-27, A2 sticky anchors: an anchor's rect takes the shift each
  sticky box on its chain sticks by for the current scroll (`stuckOn`,
  sticky.ts's `stickyShift` with the origins the pass has), a box
  sharing that sticky box taking its shift back (it moves with it at
  paint), one not sharing it noting its scroller for a relayout. Red
  first: anchor.test.ts "an anchor on a sticky box" (the shared header
  and a fixed button found in review) and `AnchorInScroller`'s
  stuck-header menu against the last commit. Deviation 6 narrowed to a
  sticky inline element, whose shift the paint alone computes.
- 2026-09-27, A5 an inline anchor's own clip: the anchor's chain goes
  on into its box, so the box's clip and scroll reach it, and its
  fragments are taken as laid out, a truncation cutting none (the
  clip alone would miss a `truncate` paragraph, whose cut text had no
  fragment). Red first: anchor.test.ts "…its paragraph's own clip cuts
  off" and "…its paragraph's own scroll" (the scroll now relays out),
  and `AnchorVisibility`'s `truncate` case against the last commit.
  Deviation 2's second sentence removed.
- 2026-09-27, A6 a hidden box stays focusable: `clip-path: inset(50%)`
  on the box, in place of D4's `opacity: 0` and no pointer events
  (changed with the user, 2026-09-28): the read flags keep opacity
  transitions alive, so the toggle started the author's fades, three
  per hide and show, for the grid to sample; the clip snaps, clips the
  subtree's paint and hits, and leaves a top-layer element alone, so
  the `data-mw-top-shown` flag goes. Red first: `AnchorVisibility`'s
  `focus()` against the last commit, and its no-transition check
  against the opacity version. Deviation 9 resolved.
- 2026-09-28, the review: `anchor-scope` read in `readCellStyle` from
  the style already computed, the lock's own flag picking the authored
  path, which drops the tree pass; `flip-start` swaps `anchor-size()`'s
  dimension with the sizes, each attempt resolving them (red first:
  anchor.test.ts "swaps anchor-size()'s dimension…").
- 2026-09-28, F3 a shrink-to-fit host's width: the viewport's
  `min-width`, the columns laid out, lifted under `measuring`
  (shadow.css). Red first: host.stories.ts `OwnWidth` (a `w-fit` host
  10px wide, its chrome alone, against a 52px cap). cell-model.md "Host
  sizing" names the spacer's width.
- 2026-09-28, item 1, the host's display and columns: the viewport
  spans the host's columns (`column-span: all`, shadow.css), in place of
  D5's lock, the author's value kept; an `inline` or `contents` host
  warns once, a `columns-*`, `flex` or `grid` host not (the user,
  2026-09-28). Red first: host.stories.ts `HostDisplay` (a 965px grid
  in a 639px `columns-2` host) against the last commit, and
  element.test.ts's warning. host-leaf.md's deviation reworded to the
  rule.
- 2026-09-28, item 2, margins on inline-blocks: an atomic inline box's
  margins join its advance, its line's rows and its native box
  (`inlineBox` now its used margins). Red first: layout.test.ts "an
  atomic inline box's margins", tree.test.ts's intrinsic width, and
  `InlineBoxMargins` (the `mx-2` box at cell 4, not 6) against the last
  commit. cell-model.md deviation 5's sentence and "Atomic inline
  boxes"' deviation removed.
- 2026-09-28, item 3, percent sizes beside margins: `layoutNode`'s
  `fill` apart from the percentages' basis, every margined caller
  passing both. Red first: layout.test.ts "percentages beside margins"
  and `PercentBesideMargins` (`w-full mx-4` 8 cells short) against the
  last commit. cell-model.md's "one small approximation" removed.
- 2026-09-28, 5a and 5b: a first stop in `lab()` or `lch()` reads as a
  stop; gradients interpolate in every space CSS names, through one
  table of spaces in color.ts (its per-space branches gone). Red first:
  gradient.test.ts's first-stop, space-read and per-space midpoint
  tests (each within a unit of the three engines' `color-mix()`), and
  the gradients story's lab and display-p3 centers, against the last
  commit. gradients.md deviation 4 resolved.
- 2026-09-28, item 6, baseline alignment: `baselineRow` (layout.ts)
  replaces the stale `LayoutNode.baselineRow`; a flex row's baseline
  groups (`baselineGroup`, flex.ts), shared by the grid's rows (their
  shifts in the rows' sizing), and a table row's baseline cells
  (`verticalAlign` gains `baseline`). Red first: flex.test.ts,
  grid.test.ts and table.test.ts "baseline", and box.stories.ts
  `Baseline` beside native copies (a flex row, an empty box, a
  div-table and a grid) against the last commit; the stories' native
  copies share `nativeCopies` (helpers.ts). flex.md 2, grid.md 3 and
  table.md 4 resolved.
- 2026-09-28, E1, a grid holding only text: one anonymous item, placed,
  sized and aligned by the grid, its offsets folded into the grid's
  padding for its native text. Red first: tree.test.ts, grid.test.ts "a
  grid holding only text" and `TextOnlyGrid` (a native copy per case,
  word by word) against the last commit. The story's `nativeCopies`
  now copies the grid's font longhands (the shorthand read empty, so
  the copies were in the page's font). grid.md deviation 6 resolved.
- 2026-09-28, 7a, text indent: signed and percentage indents, counted
  in intrinsic widths, a container's first run alone. Red first:
  layout.test.ts "text-indent", tree.test.ts's first-run and intrinsic
  tests, and `TextIndent` (the hanging line at cell 12, not 6) against
  the last commit. cell-model.md "Text indent"'s deviations removed.
- 2026-09-28, 7b, additive `scroll-padding`: a scroll container's
  authored `scroll-padding`, in cells, joins the lock's border and bar
  cells. Red first: style.test.ts's read and `ScrollPadding` (one row
  clear, not three) against the last commit. scrolling.md's deviation
  narrowed to a percentage.
- 2026-09-28, 7c and 7d, `fit-content()` and `calc()` tracks: a capped
  growth limit, and a symbolic sum. Red first: grid.test.ts's parses,
  "fit-content() and calc() tracks", and `TrackFunctions` against the
  last commit. grid.md deviation 5 resolved.
- 2026-09-28, 7e, multicol min-content: `multicolIntrinsicInnerWidth`
  takes the kind, min-content by css-multicol §3.4, for a leaf and a
  container alike. Red first: multicol.test.ts "a multicol box's
  min-content" against the last commit. multicol.md deviation 5
  resolved.
- 2026-09-28, 7f, subgrid line names: a subgridded axis's lines carry
  the parent's names over its span, then its own `subgrid [a] …` list
  (`subgridOf`, `placeholderTemplate`, grid.ts). Red first:
  grid.test.ts's `subgrid [a] [b c]` parse and "places its items by the
  parent's line names over its span, and its own" against the last
  commit. grid.md deviation 1's line-name clause removed.
- 2026-09-28, E3, the subgrid gap: a subgrid's own gap replaces the
  parent's inner gutters about their middles, the odd cell to the track
  after, and the parent's sizing counts the difference as its items'
  margin (`inheritTracks`, `subgridGap`, `gutterShift`,
  `subgridContributions`, grid.ts); `gap: normal` reads as `null`. Red
  first: grid.test.ts "moves each inner gutter to its own gap…" and
  "counts the gap difference in the parent's track sizing…",
  style.test.ts's `normal`, and `SubgridGap` (`bbbb` at cell 10, not 9)
  against the last commit. grid.md deviation 1's gap clause removed.
  The stories beside native copies share `besideNative` (helpers.ts):
  `TextOnlyGrid`, `TrackFunctions`, `SubgridGap`, `TextIndent`,
  `PercentBesideMargins`, `Baseline` (now every word's column too),
  `AspectRatioAgainstNative` and `AnchorAcceptable` (its copy now under
  `contain: layout` like the rest).
- 2026-09-28, 7g and E2, captions: the caption sits outside the table
  box's border and padding, as wide as its border box, its margins
  applied (auto ones centering, negative ones reaching past), and its
  min-content, not its max-content, floors the table's width; the
  table's border, fill and shadows take the table box alone
  (`tableBox`). Red first: table.test.ts "sets its caption outside the
  table's border and padding…", "fills a collapsed table's rows
  alone…" and "floors the table's width at its caption's
  min-content…", and `CaptionBox` (`alpha` a row lower, past the
  caption's margins) against the last commit. table.md "Caption"
  rewritten, the ignored margins gone; no golden changes (no captioned
  story draws a border or fill).
- 2026-09-28, 7h, hover on inline elements: the hit chain gains the
  inline elements over the cell's character, outermost first
  (pointer.ts `Hit`, `hitOf`, `chainAt`), so `hover:` and `active:` on
  a span apply and the cursor follows it. Red first: pointer.test.ts
  "takes in the inline elements over the character…" and the three
  chains through an inline member or link, which named the paragraph
  alone, and `SynthesizedPointerStates` (the span hovered on its own
  characters) against the last commit. cell-model.md's deviation
  removed.
- 2026-09-28, 7i, the decoration properties: a decoration draws in its
  box's `text-decoration-style`, `-color` (`currentcolor` resolved on
  the box, so a propagated line keeps it) and `-thickness`
  (`TextDecoration`, `decorationOf`, types.ts; `readDecoration`,
  style.ts; `applyDecoration`, plain-text.ts). Red first:
  plain-text.test.ts "draws a decoration in its style, color and
  thickness…", paint.test.ts "boxes clusters with unlike decorations
  apart" (against the fix without its prototype key), and the new
  `Decorations` story (`solid`, not `wavy`) against the last commit.
  cell-model.md "Typography"'s deviation narrowed to stacked
  decorations drawn unlike, the transition deviation folded into the
  non-sampled one; animations.md's keyframe sentence updated. New
  golden: features-typography--decorations.
- 2026-09-28, 7j, `overflow: clip`: read apart from `hidden`, which
  alone is a scroll container to CSS (types.ts `isScrollContainer`,
  `clipsAxis`; style.ts `readOverflow`'s coercion): a clip flex or grid
  item keeps its content-based minimum, `overflow-x: clip` leaves y
  visible, and a clip box beside a float shortens its lines. Red first:
  style.test.ts "keeps clip apart from hidden…", flex.test.ts and
  grid.test.ts "a clip item's automatic minimum", float.test.ts
  "shortens a clip box's lines beside a float…", all in the working
  tree before the change; the 38 test sites that built `clip` for
  hidden take `hidden`. The native lock is gated on the read flag and
  set per axis (styles.css, render.ts), as the ungated one read back as
  `clip`: `ClipAndHidden` (overflow.stories.ts) failed its hidden case
  with the lock ungated and its clip case against the last commit.
  cell-model.md "Overflow" states the difference; float.md,
  scrolling.md and sticky.md reworded.
- 2026-09-28, `line-clamp-*`: a text leaf's lines past
  `-webkit-line-clamp` are cut, the last kept ending in `…`
  (`readLineClamp`, style.ts, reading the `flow-root` Chromium and
  Firefox compute a clamping `-webkit-box` to; `leafLineGeometry`'s
  `clamped`, layout.ts; `truncateSpan`'s `clamp`, plain-text.ts). Red
  first: plain-text.test.ts "cuts a clamped leaf's lines at the clamp…"
  and `LineClamp` (the next paragraph a row lower) against the last
  commit. The `…` on a full line was probed the same day: each engine
  cuts where the grid does, given the host's sub-pixel headroom.
  cell-model.md "Line clamps" added,
  a container's block children its deviation.
- 2026-09-28, 8a, `pre-line`: its source newlines break as `<br>`s,
  its spaces collapsing and its lines wrapping (types.ts `softWraps`;
  tree.ts `breaks`), restored natively by `data-mw-pre="line"`
  (render.ts, styles.css). Red first: tree.test.ts "breaks at newlines
  under pre-line…" (which pinned the collapse), and `PreLine` against
  the last commit; its light-row check fails without the native rule.
  cell-model.md "White-space and truncation" gains the value, deviation
  8 narrowed to `pre-wrap` and `break-spaces`.
- 2026-09-28, 8b, `pre-wrap` and `break-spaces`: spaces and newlines
  kept, lines wrapping, `pre-wrap`'s spaces at a soft break hanging,
  `break-spaces`' taking their cells with a break after each (wrap.ts
  `preserve`, `lineUnits`; types.ts `preservedSpaces`); the native
  value restored through `--mw-ws`, which also replaces 8a's
  `data-mw-pre="line"`. Red first: wrap.test.ts "preserved white
  space…", tree.test.ts "keeps spaces and newlines under pre-wrap…",
  and `WhiteSpace` (`two` at cell 2) against the last commit. The
  light-rows helper measures a right-aligned text's end word by word,
  as a line's fragment spans the spaces `pre-wrap` hangs. cell-model.md
  "White-space and truncation" states the four values; deviation 8's
  last sentence resolved.
- 2026-09-28, 9a, `text-align: justify`: each line but a paragraph's
  last shares its leftover cells among its gaps, the odd ones first
  (D6; layout.ts `lineStart`'s `spread`); the native copy justifies
  itself, its lock gone with `textAlignBlocked`. Red first:
  plain-text.test.ts "justifies each line but a paragraph's last…" and
  `Justify` against the last commit. cell-model.md "Text alignment"
  states the rule, `text-align-last` its deviation; deviation 6's
  justify clause removed; host-leaf.md's host flags updated.
- 2026-09-28, `text-balance` and `text-pretty`: a leaf of up to six
  lines takes the narrowest width keeping its line count; a pretty
  one's last line holds more than one word where the word before fits
  (layout.ts `balanced`, `pretty`; style.ts `readTextWrapStyle`). Red
  first: plain-text.test.ts "balances a short paragraph's lines…" and
  `WrapStyle` (balance in three engines, pretty in Chromium) against
  the last commit. cell-model.md "White-space and truncation" states
  both, the engines' differences named.
- 2026-09-28, 9b, a UAX #14 subset: breaks at a zero-width space,
  `<wbr>`, a soft hyphen (shown as `-` where its line breaks), dashes,
  and between CJK characters but around their punctuation, `ー` and
  small kana as D7 has it (wrap.ts `breaksBetween`, `breakClass`,
  `lineCells`; tree.ts `WBR_MARKER`; plain-text.ts's hyphen). Red
  first: wrap.test.ts "the line-breaking subset…" (three), tree.test.ts
  "keeps a <wbr>…", plain-text.test.ts "shows a soft hyphen…", and
  `LineBreaks` against the last commit; selection.test.ts "copies
  nothing for a <wbr>" guards the marker. The CJK cases compare with
  their copies spaced to two cells a character (the fallback fonts draw
  them narrower), a cell of slack per row. cell-model.md "Line
  breaking" states the subset, the rest of UAX #14 its deviation.
- 2026-09-28, `break-all` and `break-keep`: `word-break` read and
  handed to the wrap, `break-all`'s letters breaking as ideographs,
  `keep-all`'s ideographs joining as letters (wrap.ts `breaksBetween`'s
  `wordBreak`). Red first: wrap.test.ts "word-break" (two) in the
  working tree before the change; `LineBreaks` gains both cases, its
  CJK copies' spaces kept a cell by `word-spacing`. cell-model.md "Line
  breaking" states them.
- 2026-09-28, 9c, an absolute box's spot in a run: an inline-level
  one sits at its character's cell on its line (a soft break's at the
  end of the text before it, as Chromium and WebKit have it), a
  block-level one at the next line's start (tree.ts `runSpotOf`,
  layout.ts `spotInRun`, D10's read under `data-mw-static-read`). Red
  first: positioning.test.ts "an out-of-flow element's spot in its
  run" (three) in the working tree before the change, and `RunSpot`
  (`*` at cell 0, not 7) against the last commit; Firefox's soft-break
  case skipped. positioning.md "Static position" states the rule,
  deviation 3 resolved.
- 2026-09-28, 9d, percent insets on inline elements: resolved against
  the block container's content box (down against a definite height
  only), a sticky one's against its scrollport (types.ts
  `insetLengths`; style.ts `readElementInsets`; layout.ts
  `resolveInsets`; sticky.ts). Red first: tree.test.ts "resolves an
  inline element's percent insets…" (the pinned "percent insets too"
  flipped), sticky.test.ts "resolves a sticky span's percent inset…",
  and `InlinePercentInsets` (`xy` at cell 2, not 14) against the last
  commit. positioning.md "Inline elements" states the rule,
  deviation 2 resolved.
- 2026-09-28, E4, mixed corners and junctions: a corner or junction
  of unlike lines draws Unicode's mixed glyph (`┍ ╂ ╒ ╫ …`), the arms
  read off the glyphs their bands draw, so cp437 draws `╒═╕`; heavy ×
  double, alike arms, non-box sets and a font's missing glyphs keep
  today's glyph (glyphs.ts `mixedJunction`; borders.ts `mixedArms`;
  lattice.ts's per-arm segments). Red first: plain-text.test.ts's
  three pinned corners, table.test.ts's two lattices, and
  gap-decorations.test.ts's four junctions, which pinned the heavier
  weight's glyph, flipped in the working tree before the change;
  glyphs.test.ts "mixed junctions" and plain-text.test.ts's cp437
  corner added. cell-model.md "Borders: glyph mapping" states the rule
  (its deferred mixed-style note and later-refinement aside gone);
  table.md, gap-decorations.md and theming.md follow.
- 2026-09-28, the review round. Fixes, each red first (unit tests
  against the working tree, the wrap ones also in a scratch copy):
  a grid holding only text as tall as its rows, its offsets folded
  once where a `max-height` lays it out again (grid.test.ts); a
  paragraph-flow multicol child's indent and relative insets
  (multicol.test.ts, green at the last commit: a regression of 7a/9d);
  a run's out-of-flow spot recorded where the run meets it, past a
  `<br>`, an atomic box or padding, and a flex text leaf's own as its
  sole flex item (positioning.test.ts, `RunSpot`); no break before an
  after-class character or a hyphen, none beside a no-break space or
  inline padding, no soft hyphen at a hard line's end, and `<wbr>`
  collapsing and trimming like padding (wrap.test.ts, tree.test.ts);
  a stylesheet's relative inset without Typed OM, a textarea's rows
  as `pre-wrap`, the indent past a leading float, an empty decoration
  line as none (tree.test.ts, paint.test.ts); a `fit-content()` cap
  passing the rest on and a nested subgrid's items past both gaps
  (grid.test.ts; the cap probed in all three engines); natively, a
  nowrap `overflow-x: clip` box's y left visible, a scroller's
  `hidden` axis left as authored (`ClipAndHidden`), and a nowrap box
  inside a `pre-wrap` one keeping its own (`WhiteSpace`, each box's
  `--mw-ws`); a sticky box inside a `hidden` box bound to it, which
  never scrolls, not to the scroller past it (sticky.test.ts;
  sticky.md's deviation 2 removed). Hot paths: justify's spread as arithmetic, a hit's
  character carried from `takes`, the table's baselines grouped in one
  pass, mixed junctions skipped where arms are alike. The
  `InlineBoxMargins` story's boxes are spans (a button takes the press
  from a selection). Deviation lists drop resolved entries and
  renumber (decided with the user): cell-model.md's 6 and 9 removed,
  3 and 5 split (25–27), 22–24 added; the other specs' resolved
  entries removed and their bundles split (grid 1, anchor 3); every
  reference updated. Earlier Progress entries keep the numbers they
  had.
- 2026-09-28, the hover chain and D11. An inline element joins the
  hover chain only where its hover can restyle something (it or an
  ancestor names a hover variant, or it is a `group` or `peer`;
  pointer.ts `REACTS_TO_HOVER`, `hoverChainAt`), the press chain and
  the cursor keeping
  every one: 7h had made each span edge a relayout (a prose page's
  hover step 60 ms against 33). Red first: the
  `SynthesizedPointerStates` story's plain `<b>`, hovered and laid out
  for; pointer.test.ts "the hover chain". cell-model.md deviation 28.
  Justify takes the rounded spread (D11): each word at the cell
  nearest its even share (layout.ts `spreadBefore`). Red first:
  plain-text.test.ts's justify case, which pinned D6's; the `Justify`
  story holds each word within half a cell, a width-24 line of halves
  added.
- 2026-09-28, the second review round. Fixes, each red first: a
  subgrid's parent line names past leading implicit tracks; a
  `fit-content()` track already past its cap passing nothing on; a
  rounded corner keeping its arc over a mixed glyph; a baseline from an
  item's first in-flow line, past a float; an auto table's percent
  padding against its container beside its margins; a table cell with
  no line baselined at its content's bottom, its shift moving its
  content (probed); a clamped line placed as the text it keeps and its
  `…`; split inlines' decorations drawn as the innermost's; a `<wbr>`
  drawing nothing; a justified gap's gained cells, and a tracked
  glyph's, filled with its element's background; a soft hyphen charged
  past its character's tracking gap (wrap.ts `lineCells`); `balance`
  no narrower than the longest word (probed); a sticky anchor inside a
  `hidden` box (types.ts `hasScrollport`); a host its text sizes
  holding every column of it, counted at the text's own advance from
  its fractional width. The hover gate became one selector
  (pointer.ts `REACTS_TO_HOVER`), an ancestor's `has-hover:` or
  `*:hover:` reaching its inline elements. Run spots map in one pass.
  A `min-width` spacer holding a `flex-1` column open was examined and
  kept: the column's sub-pixel resize re-lays the host out.
- 2026-09-28, the performance round. The native clip lock is a flag
  again, written only on a box clipping both axes: a lone clipping
  axis is an authored `clip`, so the per-axis rules were no-ops. Its
  gate costs a clipped relayout 0.25 ms per 300 `overflow-hidden`
  boxes (each read makes each one a scroll container and back) and is
  kept: 2110a55's ungated lock stayed on a box that dropped its overflow.
  Red first: the `ClipAndHidden` story's case with the overflow
  removed. A memo of parsed alignment values was tried and dropped
  (no measurable gain).
