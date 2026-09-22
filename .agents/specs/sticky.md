# Spec: sticky positioning

Status: **normative, implemented** (2026-09-11). Cell-unit
fundamentals live in `cell-model.md`; `position` and the inset
properties in `positioning.md`, whose "sticky behaves as relative" this
spec supersedes; the scroll machinery it rides on in `scrolling.md`
(paint-only scrolling, cell-quantized offsets, the scrollport and its
gutters).

## Motivation

A section heading that stays at the top of a scrolling list, a table
header over its rows, a toolbar pinned to the bottom of a pane — TUI
staples, and Tailwind's `sticky` with `top-*`/`bottom-*`/`inset-*` is
already there. Today `sticky` is read and treated as `relative`: the
insets offset the box at rest, which CSS's sticky never does, and
nothing sticks.

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
  static box — its insets shape no offset; CSS's sticky insets are
  constraints, not offsets, and the `relative` treatment ends — and it
  is positioned: a containing block for absolute descendants, `z-index`
  applies, it paints in the positioned step (`positioning.md`). Its
  painted position is its layout position plus a STICKY SHIFT derived
  from its scroll container's cell-quantized offset, moving the box and
  its whole subtree together — ink, hit-testing, focus rects, the
  selection — exactly as a scroll offset moves a container's content
  (`scrolling.md` "Scrolling is PAINT-ONLY"). Layout never sees
  scrolling: the box's normal position sizes its parent and the scroll
  range as a static box would, as CSS counts a sticky box's normal
  position in scrollable overflow.

- **The scroll container and the sticky view rectangle.** The box's
  scroll container is its nearest ancestor with a scrolling axis
  (`overflow: auto | scroll` on x or y — `scrollsAxis`), the host
  included. Its scrollport is its padding box less the reserved gutter
  cells (`scrolling.md`); the sticky view rectangle is the scrollport
  inset by the box's non-`auto` insets — with every inset `auto` the
  box never shifts. No scrolling ancestor, no shift: the page's own
  scroll is not modeled, as for `fixed` (deviation 1). An ancestor that
  only clips (`overflow: hidden`, read as `clip` — `cell-model.md`) is
  passed over (deviation 2).

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
  keeps the companion's `position: absolute` and its `--mw-x`/`--mw-y`;
  the shift rides beside them as `--mw-sx`/`--mw-sy` cells the paint pass
  writes (only when changed), added into `left`/`top` by the shared
  geometry rule. The write lands in the frame that repaints the grid —
  the `scroll` event and the paint's rAF run in one rendering update —
  so the light element moves when the grid ink does; what shows natively
  (a form control) slides fractionally between cell steps and converges
  at the settle, as any scrolled control already does (`scrolling.md`'s
  deviation). The pass drains its own `style` records from the mutation
  observer, as the layout pass does. Not native `position: sticky`: the light element is out of
  flow, and putting it in flow takes the flow-child machinery, which
  exists for block containers alone (`cell-model.md` "Inline content"),
  where CSS sticks flex and grid items and table parts too; and a
  browser-computed shift would be a second algorithm to keep in step.
  One shift, computed once, read everywhere.

- **What does not change.** Layout, intrinsic sizes, the scroll range,
  margin collapsing, clipping: a sticky box's ink is culled at its scroll
  container's padding box like all of that container's content. A
  `fixed` descendant moves with a sticky ancestor as it moves with a
  scrolled one today.

- **Table parts stick, borders and all.** A row group (`thead`,
  `tbody`, `tfoot`), a row, or a cell sticks like any box, its
  containing block the table's content box (a header sticks until the
  table ends), a cell's shift adding to its row's and group's. The
  table's collapsed border lattice follows: a shifted part takes its
  own lines along — a row group's or row's top and bottom lines, a
  cell's column lines — while its neighbours keep theirs, coincident at
  rest and covered by the part or scrolled out once it moves; junction
  glyphs are resolved at paint from the segments that actually land on
  each cell, so at rest the lattice is today's, and a stuck header's
  bottom line meets the column lines running on below it in `┼`.
  Browsers differ here — Chromium leaves collapsed borders behind a
  sticky header, Firefox moves them — and the engine does what the
  author means.

- **Inline-level elements stick too.** A sticky `<span>` in a run has no
  box of its own; its shift is computed from the bounding box of its
  fragments within its leaf, its containing block the leaf's content
  box, its margins ignored (cell-model deviation 5), and applied per
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

## Mechanics

- `sticky.ts`: `stickyShift(box, block, view, insets)` — the per-axis
  rule above, pure rect math; `collectStickyBoxes(root)` — the sticky
  boxes with their ancestor chains, in document order, gathered by the
  layout pass as the scroll containers are; `applyStickyShifts(boxes)`
  — per box, its painted origin from the chain (borders, padding, scroll
  offsets, and the ancestors' shifts, computed before its own by the
  order), its scroll container's scrollport and containing block, then
  `node.stickyShift` (absent when zero). Nothing walks the whole tree per
  frame.
- `types.ts`: `LayoutNode.stickyShift?: { x: number; y: number }` — a
  paint-time input beside `scroll`.
- `positioning.ts`: a sticky box is static in the positioning pass (no
  offset from its insets); `tree.ts` records an inline sticky element's
  insets as constraints (`inlineElements[i].sticky`) rather than
  offsets; `applyStickyShifts` writes `inlineElements[i].stickyShift`,
  which `forEachLeafCell` adds as it adds relative insets, and the
  native inline-inset properties carry.
- `table.ts` / `lattice.ts`: the lattice stays geometry on the table
  node (the winning segment per line piece, the cell at each grid
  position with its row and group); `resolveLattice` places each
  segment once per distinct shift of the cells beside it into an arms
  map and reads each visible cell's glyph off it — a line where one
  segment runs, `junctionGlyph` where several meet. Inside its region a
  part covers what paints before it and moves differently — the
  table's own lattice, an earlier part with another shift — while parts
  moving together (a stuck column's cells, a cell and its stuck row)
  form one piece and merge where they meet; a covered contribution
  keeps only arms reaching a visible cell no such part covers. A
  segment shared by two parts is both of theirs. A part's cells are
  handed to it to paint in its turn, the table's own paint after its
  rows and cells. A part's sticky box takes in the line cells its rect
  leaves out (`partLines`). The transcript takes the same path.
- `plain-text.ts` `walk`, `pointer.ts` `hitStack`, `focus.ts`
  `focusableRects`: a child's painted origin adds its `stickyShift` —
  the three sites that add `localRect.x/y` and subtract `scroll`.
- `element.ts`: after `#syncScrollOffsets` — the layout pass's paint and
  every scroll repaint — `applyStickyShifts`; a sticky node whose shift
  changed gets `--mw-sx`/`--mw-sy` written (cleared at zero), the
  records drained; `render.ts` clears both on a box that is no longer
  sticky.
- `styles.css`: the shared geometry rule's `left`/`top` add
  `var(--mw-sx, 0)`/`var(--mw-sy, 0)`.

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

- Node: `stickyShift` — each side, both sides with `top` winning, the
  containing-block clamp (none toward a side the box already crosses),
  no inset on an axis → no shift on it; `applyStickyShifts` on a tree — a
  scroller with sections and sticky headings at offsets 0, mid-section
  (the heading pinned at the inset row), the section's end (the heading
  pushed out by the block's bottom), the next heading taking over; a
  heading placed directly in the scroller pinned to the end of the
  scroll; a sticky footer (`bottom`); a sticky column (`left`) in an
  x-scroller; nested sticky; a sticky box inside a plain box inside the
  scroller; a percent inset; a calc inset of the scrollport's height
  less two rows; all insets `auto` → no shift; no scrolling
  ancestor → no shift; a sticky `thead` in a bordered table at rest
  (today's lattice) and stuck (its lines along, `┼` where its bottom
  line meets the column lines, the body's lattice intact), a sticky
  first column in an x-scrolled table, the line two stuck cells of a
  column share, a stuck header's bottom line joined to a stuck column's
  lines with both axes scrolled, a sticky cell inside a sticky row
  group; a sticky span pinned at its inset row with its glyphs
  moved and the rest of the line still; `hitStack` at the pinned row
  hits the heading; `focusableRects` shifted; the transcript paints
  the heading at the pinned row; a sticky box's insets no longer offset
  it at rest (the positioning test updated).
- Storybook (three engines): a scrolling list with sticky section
  headings and a sticky footer — scrolled natively (`scrollTo`), the
  paint awaited, the heading's row at the scrollport's top on the grid
  and the native box on the same cell; the hand-over at a section
  boundary; a bordered table with a sticky header and a sticky first
  column, scrolled both ways; a bar hidden until the scroll reaches it,
  then held on the scrollport's bottom row by a calc inset.
- Visual: the story's golden mid-scroll (the play scrolls before the
  screenshot).

## Touch points on implementation

- sticky.ts: `stickyShiftAxis`, the shift on one axis from the
  scroll container's cell-quantized offset, and the pass that walks
  each sticky box's ancestor chain and stores `node.stickyShift`.
- types.ts: `sticky` (the insets, `null` for `auto`) and
  `stickyShift` on the layout node; tree.ts reads the insets off a
  `position: sticky` inline element.
- The walks add the shift where they add the box's own position:
  render.ts, plain-text.ts, pointer.ts (hit-testing) and focus.ts.
- lattice.ts: a table part's shift, taken from the sticky-shifted
  node among the cell, its row, and its row group.
- positioning.md, scrolling.md and cell-model.md "Positioning and
  insets" point here, as does the README's supported-CSS summary.
