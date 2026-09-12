# Spec: floats and `clear`

Status: **normative, implemented** (2026-09-11); the native agreement
it rests on was probed the same day (see "Browser agreement"). Cell-unit
fundamentals live in `cell-model.md`; out-of-flow boxes in
`positioning.md`; the native flow machinery this builds on in
`cell-model.md` "Inline content" (flow children and anonymous runs).

## Motivation

A drop cap — a banner glyph, a QR code, a bordered pull quote — beside
text that wraps around it is the one classic print shape the engine
cannot express. Everything else in a TUI newspaper already works:
columns, rules, banners, tables. `float-left` is the missing piece, and
Tailwind ships the utilities (`float-*`, `clear-*`) already.

## Reading

`float: left | right | none` and `clear: left | right | both | none`
are read per element during the measure pass, where the companion's
`position: absolute` is not yet applied — so the computed values are
the authored ones. `float-start`/`float-end` and `clear-start`/`clear-end`
compute to the left/right forms (LTR).

Per CSS, `position: absolute | fixed` computes `float` to `none`, so an
out-of-flow box is never a float and needs no engine rule of its own.

A float is **block-level** regardless of its authored `display` (CSS
blockification): a floated `<span>` leaves its text run and becomes a
layout node, exactly as an absolutely positioned one does
(`positioning.md` "Inline elements"). The text it left re-wraps around
it as an anonymous run.

## Locked decisions

- **Floats live in a block container.** `float` is honored on the
  in-flow children of a `display: block` container (the host included).
  It is ignored — as CSS ignores it — on flex and grid items, on table
  parts, and on out-of-flow boxes. A float DIRECTLY inside a multicol
  container is ignored and warned (deviation 1); one inside a multicol
  container's child works, because a child holding a float has children
  and so is not a fragmentable leaf (`multicol.md` "Fragmenting
  text-leaf children") — it distributes into a column atomically, and
  floats normally inside its own box.

- **Every container is a block formatting context root.** Natively,
  every laid-out element is `position: absolute` — a BFC root (CSS 2.1
  §9.4.1) — and a container that is a native flow child is one through
  its `contain: layout`; a text leaf is neither. The engine models the
  same, which is the one **deviation** this spec cannot avoid (for the
  author, an ordinary `<div>` is no BFC root), with two consequences:
  a container CONTAINS its floats, as `display: flow-root` does — its
  content height reaches the lowest float bottom, and a float never
  reaches a later sibling's lines — and a container beside a float
  AVOIDS it, as `overflow: hidden` does in CSS (§9.5: a BFC root's
  border box never overlaps a float's margin box), taking the band's
  width when its own is `auto`, as browsers size one. A leaf CSS makes
  a root anyway — a flex, grid, table, or multicol box of bare text, a
  scroll container, `overflow: hidden`/`clip`, a truncated leaf — is a
  root here too; an empty box passes under like a leaf. Text inside a
  container child therefore never wraps around a sibling's float; the
  float belongs in the container whose text should wrap.

- **A float reserves a rectangle; leaves pass under it, lines shorten;
  containers step aside.** Per CSS, a float is out of the block
  cursor's flow — following siblings take the y they would have
  without it — but its margin box is an EXCLUSION. A TEXT LEAF child
  (an anonymous run, a `<p>`, a bordered one too) keeps its border box
  where the cursor put it, and every line box of its that overlaps the
  float vertically loses the cells the float covers, starting after a
  left float or ending before a right one. A ROOT child is placed as
  browsers place a BFC root: from its hypothetical top, at the first
  row — that one, then each float bottom below it — whose band holds
  its margin box, an `auto` width taking the band (and a narrower one
  when a float lower down narrows the band over the height that comes
  out), an explicit or min-content width the band cannot hold moving
  it down; it lands at the band's start plus its own left margin.

- **A line box opens at the first row with a free cell.** A line is
  wrapped against the band its own ROW leaves — found as the line opens,
  from the rows the lines before it took (a tall atomic inline box
  makes its line taller, and the rows after it shift accordingly) — and
  a row where floats leave no cell at all is skipped: the line box moves
  down to the first row that has one, as CSS 2.1 §9.5 shifts a line box
  that can hold no content. That is the ONLY case a line moves: the
  companion locks `overflow-wrap: anywhere` natively, so one free cell
  already holds a character, and both models break a long word at the
  band's edge instead. An unbreakable line (`nowrap`, `pre`) wider than
  its band stays on its row and overflows, as browsers keep it (probed).

- **Placement, per CSS §9.5.1, in document order.** A float's top is the
  flow cursor at its DOM slot — past the sibling before it and that
  sibling's own bottom margin, not the margin it goes on to collapse
  with (probed) — plus its own top margin, never above the top of an
  earlier float in the container.
  Its outer edge is the container's content edge, or the inner edge of
  the earlier floats on those rows when its margin box still fits in the
  remaining width; otherwise it moves down to the first row where it
  fits — past the bottom of the shallowest float in the way.

- **A float's size is shrink-to-fit**, exactly the rule absolute boxes
  already use (`positioning.md` "Absolute layout"): explicit
  width/min/max first, else `min(max-content, max(min-content,
available))` against the container's content width. Height is content
  height unless explicit. Margins apply and never collapse — with
  anything, in either direction, per CSS.

- **`clear` moves a box below the floats it names.** A cleared in-flow
  box's border top is the later of its hypothetical top (margins
  collapsed as usual) and the bottom margin edge of the container's
  floats on the named side — CSS 2.1 §9.5.2's clearance, reduced to the
  max it computes. `clear` on a float applies before its own placement.
  The authored `clear` stays native and adds nothing there: the flow
  child's engine margin already puts its top at the cleared row, so the
  browser's own clearance comes out zero.

- **Floats paint after the blocks they sit over.** CSS 2.1 Appendix E
  paints floats after in-flow blocks and before inline content and
  positioned boxes; `paintOrderedChildren` gives them that bucket, so
  a later block's background and border pass under the float on the
  grid, in the plain-text transcript, and in the decoration lattice
  alike, as they do natively.

- **The browser does the native wrapping.** A container holding a float
  lays out its in-flow children as FLOW CHILDREN (`cell-model.md`
  "Inline content"): native `position: static`, engine-quantized
  margins, engine-forced size. A leaf flow child carries no layout
  containment, so the browser shortens its line boxes; a container flow
  child carries `contain: layout`, so the browser places it beside or
  below the float as the engine did (a margin-top in the way is
  honored first, probed), and its left margin is written relative to
  the band it sits beside, since the browser adds it to the float's
  edge. The float itself keeps a native `float` with its engine cells
  and its authored margins quantized to cells, and the browser places
  it from the engine's base: the flow child before it carries its
  pending bottom margin natively (elsewhere a flow child carries none,
  the next child's top margin holding the gap), the float's top margin
  absorbs any part it does not, and the next child's top margin
  collapses with it as siblings' do; the native block cursor passes
  the float by, as the engine's does. Every input — the container's
  content width, the float's margin box, the rows it spans, a child's
  margin box — is a whole number of cells in both models, so the two
  agree; a float and a root give the shared geometry rule's widening
  (its layout-unit headroom, a tracking allowance) back on their right
  margin, so a box that fits the engine's band exactly fits natively.

- **Intrinsic sizes treat a float as sharing the line beside it,** per
  CSS: a container's max-content width is its floats' outer max-content
  widths PLUS the max-content of the content beside them (they would
  share one line if nothing wrapped), a cleared child starting a new
  line whose width counts on its own; its min-content width is the
  largest of theirs (at that width the text has already wrapped to a
  single column beside the float).

## Browser agreement

Probed 2026-09-11 in Chromium, Firefox, and WebKit with a synthetic
page shaped like the engine's output (an absolutely positioned
container `40ch` wide, `overflow-wrap: anywhere`, a locked 20px line
height, whole-`ch` floats and margins, each word in a span): a left
float, a right float, two floats side by side with a third that drops
below them, a float placed after a paragraph, a full-width float, and a
two-row inline box beside a float. Every word landed on the row and
cell the rules above predict, 37 of 37 in each case and engine, with
`1ch` exactly 8px. A second probe placed `contain: layout` boxes beside
a 7-cell, 3-row float: a 40-cell one landed on row 3, below it; a
20-cell one at column 7 beside it and a second stacked under that; one
with a 1-row top margin at row 1 beside it; a plain block passed under
at column 0 — identically in the three engines. A third probe (a
draft of the Drop Cap story, three engines) held a widthless root
between two floats taking their band exactly and wrapping in it, a
root wider than the band stepping below, and an unbreakable line wider
than its band staying on its row (the draft had moved it down; the
probe corrected it). A fourth (plain HTML, three engines) placed a
float after a block with a bottom margin: past that margin, whether
the next block's top margin collapses with it or not, and past the
float's own top margin on top.

## Mechanics

- `style.ts`: `float` and `clear` on `CellStyle`, read like every other
  keyword property, `float` forced to `none` on an out-of-flow box as
  CSS computes it. Flex and grid items, table parts, and multicol need
  no forcing: only block layout consults the field.
- `floats.ts`: the exclusion rectangles and the queries block layout
  makes of them — `bandAt`, `firstFit` and `placeFloat` (the first fit
  plus §9.5.1's never-above-an-earlier-float), `clearanceBelow`,
  `floatsBottom` — pure rect math in content-box cells.
- `types.ts`: `LayoutNode.lineBands?` on a leaf — the per-line x and
  width its wrap used, which paint, plain text, and hit-testing read the
  way they read multicol's `lineX`.
- `layout.ts` `layoutBlock`: children are placed in document order
  against a running float context. Each child's top is known before its
  own layout (margins and clearance need no content), so a leaf is
  wrapped against the intrusions at its own rows, and a root
  (`isFormattingContextRoot`) is fitted by `layoutRootBesideFloats` —
  laid out in the band at each candidate row, again narrower when the
  band over its height is, the next row when the band holds less than
  its min-content contribution. A float is laid out shrink-to-fit,
  placed by the rule above, added to the context, and skipped by the
  block cursor; the container's content height is the larger of the
  cursor and the lowest float bottom. `placeFlowChildren` skips floats
  too, and a float's native margins are its own.
- `wrap.ts`: `WrapOptions.openLine` — called as each line box opens
  with its index and the lines closed so far, it returns the line's
  usable width. Layout's opener (`lineOpener`) supplies it for a leaf
  beside floats and records each line's row and x as it answers: the
  row after the previous lines' heights (a tall inline box counted),
  moved down past any row with no free cell, and that row's band.
  Without it a line has the full content width, as today.
- `layout.ts` `leafLineGeometry`: the rows the opener recorded are the
  lines' `lineY`; the per-line x and width are the leaf's `lineBands`,
  which the paint's cell walk (`forEachLeafCell`, so selection and
  hit-testing follow), the plain-text transcript, and per-line
  alignment and truncation read beside multicol's `lineX`.
- `borders.ts` `paintOrderedChildren`: a floats bucket between the
  in-flow blocks and the inline boxes.
- `render.ts` / `styles.css`: `data-mw-float` — native `float: left`/
  `right`, `position: static`, the shared engine geometry, the authored
  margins in cells; the container's other in-flow children become
  `data-mw-flow` children as they do for anonymous runs — a container
  among them — a root — keeping the `contain: layout` that makes it a
  BFC root, a leaf carrying none (`data-mw-flow="box"` / `"text"`), so
  the browser steps the one aside and wraps the other.

## Deviations from CSS (summary)

1. A `float` whose parent IS a multicol container is ignored and warned
   once — the engine fragments that container's content into columns
   itself, and an exclusion per column region is out of scope. Inside a
   multicol container's children, floats work (see above).
2. Every container is a BFC root (see above): it contains its floats,
   where CSS lets one escape a parent that establishes no BFC, and it
   steps aside from a sibling's float, where CSS lets an ordinary block
   pass under with its lines wrapping. Leaves wrap as in CSS, and a
   leaf CSS makes a root is one here as well.
3. `shape-outside` and `shape-margin` are ignored: an exclusion is
   always the float's margin-box rectangle.
4. All cell-model deviations apply — integer rounding (a float's margin
   box occupies whole cells, so text clears it by a whole cell), and a
   float being a native flow child, its `position: relative` insets
   moving it on the grid only.

## Testing

- Node: float placement (left, right, both edges, side by side, pushed
  down when the remaining width is short, never above an earlier
  float's top); shrink-to-fit width and explicit widths; margins; a
  container's height containing its floats; a root beside a float
  placed beside it when its margin box fits the band, a widthless one
  taking the band, a too-wide one below, a top margin honored first,
  a leaf CSS makes a root (a scroll container, a flex box of text)
  stepping aside, a root at its own top beside the first float when an
  earlier float sits lower, one narrowing again under a lower float,
  and a bordered leaf passing under with its lines shortened, a leaf
  with auto margins centered in the container with its lines shortened,
  an unbreakable line overflowing its band; `clear` on a block and on a float
  against a hypothetical top above and below the float bottom;
  per-line bands in the wrap, a full-width float shifting the first
  line below it, a tall inline box beside a float moving the rows
  after it; per-line alignment and truncation within a band; paint
  order with a block under a float; intrinsic widths; a floated
  `<span>` blockified out of its run; `float` ignored on flex and grid
  items and on absolute boxes; a float inside a multicol container's
  child, and the ignored-and-warned direct one; the transcript
  (`renderPlainText`).
- Storybook (three engines, each story asserting the floats' native
  boxes on their cells and the browser's glyphs on the grid's cells
  character by character for every line, retried until a late font
  load's relayout lands, as the multicol stories do): "Drop Cap" — a
  `<mono-ascii>` floated left before a paragraph, and a text-mode drag
  across the wrapped lines highlighting their glyphs from the first
  row after the cap; "Pull Quote" — a left and a right float side by
  side with prose between them, a box with a width passing under the
  quote (its box at the content origin, its text below the quote), a
  right float declared later a row (its top margin) under that box,
  and the aside's height containing it; "Multiple Floats" — six tiles
  of one width floated left, four filling the row exactly (the native
  fit of an exact band) and two wrapping under them, each tile's
  native box on the cell its border corner is painted, the paragraph
  after them flowing into the first band with room and then the full
  width, six tiles floated right after it starting where it ended and
  wrapping the same way from the right edge, and the box's height
  containing them; "Clear" — `clear-right`,
  `clear-left`, and `clear-both` paragraphs, each after a left and a
  right float of different heights with a line between them, landing
  at the named floats' bottom and wrapping beside the other float.
- Visual: the four stories' goldens in the sweep.

## Touch points on implementation

- cell-model.md: "Inline content" notes that a floated inline leaves
  its run, and that a flow child's `contain: layout` is a container's
  alone; the deviations list points here.
- positioning.md: `float` is `none` on out-of-flow boxes, per CSS.
- multicol.md: the ignored-and-warned deviation.
- README: a line in the supported-CSS summary.
