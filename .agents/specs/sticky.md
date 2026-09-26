# Spec: sticky positioning

Status: **normative, implemented** (2026-09-11). Cell-unit
fundamentals live in `cell-model.md`; `position` and the inset
properties in `positioning.md`, whose sticky entry points here; the
scroll machinery it rides on in `scrolling.md`
(paint-only scrolling, cell-quantized offsets, the scrollport and its
gutters).

## Motivation

A section heading that stays at the top of a scrolling list, a table
header over its rows, a toolbar pinned to the bottom of a pane — TUI
staples, and Tailwind's `sticky` with `top-*`/`bottom-*`/`inset-*` is
already there. Its insets are constraints, not offsets: they offset
nothing at rest, and hold the box inside the scrollport as its
content scrolls.

## Reading

`position: sticky` and the insets are read already (`positioning.md`
"Insets"): each side a cell length, `auto`, a percentage, or a `calc()`
of a percentage and cells. For a sticky box a percentage resolves
against the corresponding dimension of its scroll container's
scrollport (probed — see "Browser agreement"), so
`top-[calc(100%-(--spacing(2)))]` holds a box two rows above the
scrollport's bottom.

## Locked decisions

- **A sticky box is in flow, shifted at paint time.** It lays out as a
  static box — its insets shape no offset, CSS's sticky insets being
  constraints, not offsets — and it is positioned: a containing block
  for absolute descendants, `z-index` applies, it paints in the
  positioned step (`positioning.md`). Its painted position is its layout
  position plus a STICKY SHIFT derived from its scroll container's
  cell-quantized offset, moving the box and its whole subtree together —
  ink, hit-testing, focus rects, the selection — exactly as a scroll
  offset moves a container's content (`scrolling.md` "Scrolling is
  PAINT-ONLY"). Layout never sees scrolling: the box's normal position
  sizes its parent and the scroll range as a static box would, as CSS
  counts a sticky box's normal position in scrollable overflow.

- **The scroll container and the sticky view rectangle.** The box's
  scroll container is its nearest ancestor with a scrolling axis
  (`overflow: auto | scroll` on x or y — `scrollsAxis`), the host
  included. Its scrollport is its padding box less the reserved gutter
  cells (`scrolling.md`); the sticky view rectangle is the scrollport
  inset by the box's non-`auto` insets — with every inset `auto` the
  box never shifts. No scrolling ancestor, no shift: the page's own
  scroll is not modeled, as for `fixed` (deviation 1). A `fixed`
  ancestor, a top-layer element's included, ends the search: it paints
  outside the scrolling ancestors above it, so a sticky box inside it
  sticks only to a scroller inside it, as CSS's scroll container for it
  is the viewport's. An ancestor that only clips (`overflow: hidden`,
  read as `clip` — `cell-model.md`) is passed over (deviation 2).

- **The shift, per axis, per css-position-3 §3.4.** In the scroll
  container's coordinates with its current offset applied — a box
  scrolled past the scrollport's top edge has a negative top — with a
  `top` inset, a border-box top above the view rectangle's top edge is
  shifted down onto it; with a `bottom` inset, a border-box bottom below
  the view's bottom edge is shifted up onto it; both set and both
  violated (the box taller than the view), `top` wins, as for relative
  insets. The shift is then limited so the box's BORDER box stays inside
  its containing block — css-position-3 speaks of the margin box, and
  the three engines ignore the margins (probed): down at most until the
  border box's bottom meets the block's bottom, up at most until its top
  meets the block's top, and none toward a side the box already crosses.
  The containing block is the parent's
  content box — or, when the parent is the scroll container itself, its
  content area extended to the scrollable extent (`scrollRange`), so a
  heading placed directly in the scroller stays pinned for the whole
  scroll, as CSS keeps it. `left`/`right` mirror. Every input is whole
  cells — the quantized offset, the insets, the boxes — so the shift is
  whole cells and the box lands on the grid.

- **Nesting.** A sticky box's containing block is its parent's content
  box WHERE THE PARENT PAINTS — the parent's own shift or scroll applied
  first, in the walk's order — so a sticky heading inside a sticky
  section sticks within the section, and a sticky box inside a plain box
  inside a scroller sticks within that box against the scroller.

- **Native agreement: the engine writes the shift.** The light element
  keeps the companion's position — `absolute` at its `--mw-x`/`--mw-y`,
  or, as a mixed block container's flow child (`cell-model.md` "Inline
  content"), `relative` where the browser's flow puts it; the shift
  rides beside it as `--mw-sx`/`--mw-sy` cells the layout and each
  scroll repaint write (only when changed), added into `left`/`top` by
  the rule that places it. The write lands in the
  frame that repaints the grid — the `scroll` event and the paint's
  rAF run in one rendering update — so the light element moves when
  the grid ink does; what shows natively (a form control) slides
  fractionally between cell steps and converges at the settle, as any
  scrolled control already does (`scrolling.md`'s deviation). The
  repaint drains its own `style` records from the mutation observer,
  as the layout pass does. Not native `position: sticky`: the light
  element is out of flow, and putting it in flow takes the flow-child
  machinery, which
  exists for block containers alone (`cell-model.md` "Inline content"),
  where CSS sticks flex and grid items and table parts too; and a
  browser-computed shift would be a second algorithm to keep in step.
  One shift, computed once, read everywhere.

- **What does not change.** Layout, intrinsic sizes, the scroll range,
  margin collapsing, clipping: a sticky box's ink is culled at its scroll
  container's padding box like all of that container's content. A
  `fixed` descendant stays on the host's cells: its light element takes
  back the sticky shift as it takes back a scroll (`positioning.md`).

- **Table parts stick, borders and all.** A row group (`thead`,
  `tbody`, `tfoot`), a row, or a cell sticks like any box, its
  containing block the table's content box (a header sticks until the
  table ends), a cell's shift adding to its row's and group's. The
  table's collapsed border lattice follows: a shifted part takes its
  own lines along — a row group's or row's top and bottom lines, a
  cell's column lines — while its neighbours keep theirs, coincident at
  rest and covered by the part or scrolled out once it moves; junction
  glyphs are resolved at paint from the segments that actually land on
  each cell, so at rest the lattice is the static one, and a stuck header's
  bottom line meets the column lines running on below it in `┼`.
  Browsers differ here — Chromium leaves collapsed borders behind a
  sticky header, Firefox moves them — and the engine does what the
  author means.

- **Inline-level elements stick too.** A sticky `<span>` in a run has no
  box of its own; its shift is computed from the bounding box of its
  fragments within its leaf, its containing block the leaf's content
  box — extended to what the leaf scrolls where the leaf is its scroll
  container, as for a box placed directly in its scroller — its
  margins ignored (cell-model deviation 5), and applied per
  glyph through the path inline relative insets already take
  (`forEachLeafCell`, so paint, hit-testing and selection follow) — its
  sticky insets constrain, they offset nothing. Natively the same path
  carries it: the inline-inset marker pins `position: relative` and its
  custom properties hold the shift, so the browser never runs its own
  sticky on the span. An atomic inline box (`inline-block`) is a box and
  sticks as one, its containing block its leaf's content box, its native
  shift a relative offset by the shift vars.

## Browser agreement

Probed 2026-09-11 in Chromium, Firefox, and WebKit with plain HTML
(200px scrollers, 20px rows), identical in the three:

- `top: 10%` in a 200px scrollport inside a 1000px block sticks 20px
  down at every offset — percentages resolve against the scrollport.
- `top: 0; bottom: 0` on a 300px box in the 200px scrollport keeps the
  box's top on the scrollport's top at every offset — `top` wins.
- A 60px box with `margin: 20px 0` and `top: 0` in a 400px block
  starting at 100px: pinned from offset 300, and at offsets 450 and 480
  sitting at −10px — its border box's bottom on the block's bottom
  (shift 320), where a margin-box clamp would give −30 (shift 300).
- A box placed directly in the scroller stays pinned at offset 600 —
  the block extends to the scrollable extent.

## Deviations from CSS (summary)

1. No page-level sticking: without a scrolling ancestor inside the host
   a sticky box never shifts (as `fixed` anchors to the host).
2. An `overflow: hidden` ancestor is not a scroll container here (it
   reads as `clip`); it never scrolls, so the difference shows only for
   a hidden box scrolled by script, which the engine does not mirror.
3. All cell-model deviations apply: whole-cell shifts, an inline
   element's margins ignored, and the native layer's fractional slide
   between cell steps (`scrolling.md`).

## Testing

- Node: `stickyShiftAxis` — each side, both sides with `top` winning,
  the containing-block clamp (none toward a side the box already
  crosses), no inset on an axis → no shift on it; `placePainted` on a
  tree — a scroller with sections and sticky headings at offsets 0,
  mid-section (the heading pinned at the inset row), the section's end
  (the heading pushed out by the block's bottom), the next heading
  taking over; a heading placed directly in the scroller pinned to the
  end of the scroll; a sticky footer (`bottom`); a sticky column
  (`left`) in an x-scroller; nested sticky; a sticky box inside a plain
  box inside the scroller; a percent inset; a calc inset of the
  scrollport's height less two rows; all insets `auto` → no shift; no
  scrolling ancestor → no shift; in a fixed box inside a scrolled
  scroller, no shift, and a scroller's inside the fixed box; a sticky
  `thead` in a bordered table at rest (the static lattice) and stuck (its
  lines along, `┼` where its bottom line meets the column lines, the
  body's lattice intact), a sticky
  first column in an x-scrolled table, the line two stuck cells of a
  column share, a stuck header's bottom line joined to a stuck column's
  lines with both axes scrolled, a sticky cell inside a sticky row
  group; a sticky span pinned at its inset row with its glyphs
  moved and the rest of the line still, and one in a scrolling leaf
  pinned to the leaf's own scroll; a relayout that moves nothing
  writes nothing, a stuck span's shift included; a fixed box inside a
  fixed box in a scrolled scroller keeps a zero takeback through a
  scroll repaint; `hitStack` at the pinned row
  hits the heading; `focusableRects` shifted; the transcript paints
  the heading at the pinned row; a sticky box's insets offset nothing
  at rest (the positioning test).
- Storybook (three engines): a scrolling list with sticky section
  headings and a sticky footer — scrolled natively (`scrollTo`), the
  paint awaited, the heading's row at the scrollport's top on the grid
  and the native box on the same cell; the hand-over at a section
  boundary; a bordered table with a sticky header and a sticky first
  column, scrolled both ways; a bar hidden until the scroll reaches it,
  then held on the scrollport's bottom row by a calc inset; a sticky
  heading in a fixed box and one in a scrolling popover inside a
  scrolled list, each on its box's first row, a fixed box inside the
  fixed box on the host's cells, grid and native; a sticky heading
  among its scroller's runs of text held on the scrollport's first
  row, grid and native.
- Visual: the story's golden mid-scroll (the play scrolls before the
  screenshot).

## Touch points on implementation

- paint-origin.ts: `placePainted(root)`, one walk down the tree
  writing each box's `paintOrigin` for the current scroll offsets —
  its parent's less the parent's scroll plus its own offset, a fixed
  box's its `hostRect` — with a sticky box's shift on top, an
  ancestor's origin in place before its descendants', each scroll
  container's scrollport taken once as the walk enters it. The walk
  returns the boxes whose light elements a scroll shifts — sticky
  boxes, fixed boxes off the top-layer stack, and the leaves holding
  sticky inline elements — with their parents.
- sticky.ts: `stickyShiftAxis(box, block, view, start, end)`, the
  per-axis rule above, pure rect math; `stick`, a sticky box's shift
  onto its `paintOrigin` (`node.stickyShift`, absent when zero), from
  its scroll container's scrollport and its containing block where
  they paint; `stickInline`, each sticky inline element's
  `stickyShift`, from its fragments' bounds taken once per leaf; and
  `partLines`, the lattice line cells a table part's box takes in.
- layout.ts: `layoutRoot` runs `placePainted` last.
- types.ts: `paintOrigin` and `stickyShift` on the layout node,
  paint-time values beside `scroll`; an inline element's `sticky`
  (its insets, `null` for `auto`) and `stickyShift`.
- tree.ts: a `position: sticky` inline element's insets, read as
  constraints (`inlineElements[i].sticky`) where a relative one's are
  offsets (`insets`).
- positioning.ts: a sticky box keeps its static position in the
  positioning pass.
- plain-text.ts: `walk` paints each box at its `paintOrigin`, a table
  part's cells in the part's turn, the table's own paint after its
  rows and cells, and the transcript takes the same path;
  `forEachLeafCell` adds a sticky inline element's shift as it adds
  relative insets, so paint, hit-testing and selection follow.
- pointer.ts: `hitStack` hit-tests each box at its `paintOrigin`.
- focus.ts: `focusableRects` places each box at its `paintOrigin`.
- table.ts: the lattice as geometry on the table node — the winning
  segment per line piece, the cell at each grid position with its row
  and group.
- lattice.ts: `resolveLattice` places each segment once per distinct
  shift of the cells beside it into an arms map and reads each visible
  cell's glyph off it — a line where one segment runs, `junctionGlyph`
  where several meet. Inside its region a part covers what paints
  before it and moves differently — the table's own lattice, an
  earlier part with another shift — while parts moving together (a
  stuck column's cells, a cell and its stuck row) form one piece and
  merge where they meet; a covered contribution keeps the arms
  reaching a visible cell no such part covers, and a segment shared
  by two parts is both of theirs. A part's shift is the sticky-shifted
  node's among the cell, its row and its row group.
- render.ts: `writeShift` gives a box's light element the offset from
  where its parent places it to its `paintOrigin` as
  `--mw-sx`/`--mw-sy` — a sticky box's shift, a fixed box's takeback
  of the scroll and shifts it escapes (`positioning.md`), zero
  (unwritten) elsewhere and on a top-layer box, which the companion
  places on its painted cells — and `stuckInsets` a sticky inline
  element's shift as its inset properties: `render` writes both at a
  layout; `renderScroll`, a scroll repaint's one call, syncs the
  offsets, runs `placePainted`, and writes both for the boxes it
  returns.
- element.ts: a scroll repaint runs `renderScroll` with
  `#syncScrollOffsets` and drains its own `style` records.
- styles.css: the shared geometry rule's `left`/`top` add
  `var(--mw-sx)`/`var(--mw-sy)`, as the inline-box rule's and the
  flow children's do; the inline-inset rule pins `position: relative`
  and applies the inset properties; the engine variables' reset zeroes
  the shift on every element (`cell-model.md` "Engine variables").
- positioning.md, scrolling.md and cell-model.md "Positioning and
  insets" point here, as does the README's supported-CSS summary.
