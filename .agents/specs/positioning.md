# Spec: positioning and insets

Status: normative, implemented. Written spec-first for the positioning
work (Milestone 3 scope, expanded to include `absolute`), "Paint order"
rewritten spec-first for `../plans/2026-09-27-stacking-contexts.md`.
Cell-unit fundamentals live in `cell-model.md`; this spec covers
`position` and the inset properties.
Two sibling specs build on it: `anchor-positioning.md` places an
out-of-flow box against a named anchor (`position-area`), and
`top-layer.md` lays out an open popover or a modal dialog as a fixed
box of the host, painted last in a stack.

## Values

`position: static | relative | absolute | fixed | sticky` is read per
element. Behavior:

- **static** (default): normal flow; insets are ignored, per CSS.
- **relative**: normal flow, then a pure visual offset by the resolved
  insets — siblings and the parent's size are unaffected, per CSS. The
  element becomes a containing block for absolute descendants.
- **absolute**: removed from flow (siblings lay out as if it didn't exist;
  it contributes nothing to the parent's content size). Positioned against
  its containing block by the resolved insets. Its `float` computes to
  `none`, per CSS (specs/float.md).
- **fixed**: treated as `absolute` with the `<mono-wind>` host as the
  containing block, and painted and hit-tested from the host's origin,
  outside its ancestors' clips and scroll offsets, as CSS paints a
  fixed box outside its scrollers; a layer root above it captures it
  (specs/layers.md), as a transformed ancestor does in CSS. Its light
  element, placed from its parent's, takes back the scroll and sticky
  shifts its parent paints with (`--mw-sx`/`--mw-sy`, sticky.md
  "Native agreement"), so it sits on the cells the grid paints it on,
  a fixed box inside it taking back none.
  **Deviation** (CSS anchors to the viewport) — a component shouldn't
  escape its host. A top-layer element is the one exception, and only
  for its placement: it resolves in the cells of the host the viewport
  shows, so a dialog opens where the reader is looking
  (specs/top-layer.md).
- **sticky**: normal flow, then a paint-time shift that keeps the box
  inside its scroll container's scrollport by its insets, per
  css-position-3 §3.4 — `sticky.md`. The insets are constraints, not
  offsets: at rest the box is where flow put it. The element becomes a
  containing block for absolute descendants.

## Insets

`top / right / bottom / left` (and the `inset-*` shorthands, which the
browser expands to longhands before we read them) are read as
`CellLength | auto` per side:

- Lengths follow the spacing scale (0.25rem = 1 cell; vertical insets →
  rows, horizontal → columns), rounded per the cell-model rules. Negative
  values are fine.
- Percentages resolve against the **containing block**: width for
  left/right, height for top/bottom, per CSS. A `calc()` of a
  percentage and lengths keeps both, the lengths as cells added once
  the percentage resolves (`cell-model.md` "Mixed-unit calc()").
- Over-constrained axes follow CSS LTR resolution: `top` wins over
  `bottom`, `left` wins over `right` (for relative, the losing side is
  ignored; for absolute with a definite size, the losing inset yields).
- An `auto` side must read as `auto`. On a positioned element
  `getComputedStyle` gives the USED distance instead, which would read
  as an authored inset and stretch the box between its two sides; the
  Typed OM keeps the computed value, and without it (Firefox pre-157)
  a side counts only where an inline style or a utility for THAT side
  authors it (style.ts `readInsets`). The axis shorthands author their
  own axis alone: `inset-y-*` leaves left and right `auto`, as
  `inset-x-*` leaves top and bottom, and a logical side (`inset-s-*`,
  `inset-e-*`, `inset-bs-*`, `inset-be-*`, left-to-right) its own side
  alone — `inset-*` itself authors all four.

## Containing block (per CSS)

The containing block of an absolute element is the **padding box of its
nearest positioned ancestor** (`position` ≠ static — relative, absolute,
fixed, or sticky), or the `<mono-wind>` host's content box when there is
none. The companion stylesheet's own `position: absolute` on laid-out
elements is an implementation detail and does NOT make an element a
containing block — only the author's `position` does (deviation 7).

For a relative element, percent insets resolve against its own parent's
content box (its containing block in flow).

## Absolute layout

- **Width**: explicit width/min/max apply as usual. With `left` and `right`
  both set and width auto → the element stretches between them. Otherwise
  auto width = shrink-to-fit within the containing block, per CSS.
- **Height**: symmetric — `top` + `bottom` with auto height stretches;
  otherwise content height.
- **Aspect ratio** (cell-model.md "Aspect ratio"): an axis the insets
  or a set size give derives the other; with every size and inset
  pair open, the shrink-to-fit width does. Where both inset pairs are
  set and neither size, the width comes from `left` and `right` and the
  height from the ratio, not the insets: `inset-0 aspect-2/1` fills its
  block's width and is half as tall as it is wide (all three engines,
  probed 2026-09-27).
- **Static position** (an axis with both insets `auto`): the element sits
  where it would have been in flow, per CSS:
  - Block parent: the flow cursor position at its DOM slot (x: content
    origin + margin; y: where the next in-flow sibling starts).
  - Flex parent: as if it were the **sole flex item** of the container —
    `justify-content` / `align-items` (with its own `align-self`,
    `stretch` as its fallback `flex-start`) applied to its hypothetical
    box as to a line spanning the container (css-flexbox §4.1), reversed
    axes swapping `flex-start` and `flex-end` (flex.md steps 7–8;
    `align-content` moves it in no engine, probed 2026-09-25), its outer
    size including the box's fixed margins (`auto` margins
    count as 0 in the static position). An overflowing box sits at the
    start edge on either axis, as an overflowing line does
    (cell-model.md deviation 21; CSS centers or ends it past the start
    edge, and centers it under `space-around` / `space-evenly`, probed
    2026-09-24, all three engines).
- Margins apply between the inset edges and the box, per CSS. `auto`
  margins center within the inset-defined space when the size is definite
  (the `inset-0 m-auto` centering idiom). Per CSS 2 §10.3.7 and §10.6.4,
  a single auto margin takes whatever the insets, the size and the other
  margin leave, negative included — a 20-wide `left-0 right-0 ml-auto`
  box in a 10-wide block starts at −10 — and two auto margins split it,
  negative only vertically: an over-tall box centers past both edges,
  an over-wide one starts at the left inset (all three engines, probed
  2026-09-23).

## Inline elements (`<span class="relative top-1">` in a text run)

Inline descendants of a leaf are browser-rendered, so authored inset
values would paint off-grid (`top-1` = 0.25rem = 4px ≠ 1 row). The engine
detects inline elements whose computed position is relative with non-auto
insets during the measure pass, converts each inset to whole cells, and
rewrites the offset through engine-owned custom properties so the browser
applies a whole-cell shift (`calc(n × cell)`), keeping the author's
`position: relative` itself intact. An inline sticky element's insets are
constraints for its scroll-time shift (`sticky.md`), carried natively
through the same properties. An inline element's glyphs move by its own
shift plus every inline ancestor's, as CSS moves an inline box's
content with it: a static `<b>` in a `relative top-1` span moves with
the span, and a relative span in another moves by both (`inlineShift`).

- Only cell-mappable lengths are supported on inline insets; **percent
  insets on inline elements are treated as 0** (deviation, a shortcut:
  their basis is the block container's content box, which the engine
  has). In Firefox, whose computed style gives them as used px where
  Chromium and WebKit keep the `%`, the engine reads that px as a
  length instead, so the element shifts by it, rounded to cells.
- `absolute`/`fixed` on an inline element blockifies it, per CSS: it
  leaves the text run entirely (the text reflows without it) and becomes
  an out-of-flow box positioned like any other. **Deviation:** its static
  position approximates to its leaf's content-box origin rather than
  CSS's hypothetical inline position (the spot mid-text where it would
  have sat).

## Paint order

The grid paints as CSS does (CSS 2.1 Appendix E, css-position-4
"Painting order"): each box within its nearest stacking context, not
among its siblings. So an `absolute z-10` menu in a `relative` card
paints over the next card, a stuck `sticky top-0` header cell paints
over the table body, and a `-z-1` box paints under its parent's
background unless the parent is a stacking context. The paint walk
(the grid and `renderPlainText` alike), hit testing and the
collapsed-table lattice follow one order.

**Stacking contexts.** A box forms one when it is:

- the host;
- positioned with a `z-index` other than `auto` (`relative z-0`
  included), or a flex or grid item with one: wherever `z-index`
  applies;
- `fixed` or `sticky`, whatever its `z-index`;
- faded: an `opacity` below 1 as the frame paints it (its own times
  its inline ancestors', cell-model.md "Opacity and translucency"),
  or an `opacity` in transition or animation (animations.md), so a
  fade stays one context through its opaque frames;
- a layer root (layers.md). An identity effect counts too:
  `scale-100` at rest or `translate: 0` leaves the cells on the grid,
  and any value other than `none` still forms a context;
- `isolation: isolate`, a `mix-blend-mode` other than `normal`, a
  `perspective`, `transform-style: preserve-3d`, a `clip-path` or
  `mask-image` other than `none`, `contain` with `layout` or `paint`
  (`strict` and `content` among them), or a `will-change` that names
  a property forming one;
- a top-layer element or its backdrop (top-layer.md).

`container-type` forms none (probed 2026-09-27 in all three engines,
though MDN lists it). An inline element forms one by its position,
`z-index` and opacity alone (deviation 8).

**Members and steps.** A box paints in the positioned step when it is
positioned or forms a stacking context. Every other box is in flow.
A box in the positioned step is a **member** of its nearest ancestor
that forms a stacking context, reached through in-flow ancestors and
through positioned ancestors that form none. It orders by its
`z-index`, as 0 where that is `auto` or does not apply, with tree
order breaking ties. A stacking context paints, in order:

1. its own shadows, fill, borders and gap rules;
2. its negative members, lowest first;
3. its in-flow content, in CSS's phases:
   - every in-flow box's shadows, fill, borders and gap rules, in tree
     order, a collapsed table's lattice (table.md) over its parts'
     fills;
   - its floats, each whole (float.md);
   - its text and every in-flow leaf's, and its atomic inline boxes,
     each whole, in tree order, a scroll container's bars
     (scrolling.md) over its content;
4. its members at 0, in tree order;
5. its positive members, lowest first.

A member that forms a context paints all five steps in its turn. A
positioned member at `z-index: auto` that forms none paints steps 1
and 3 only, and its own positioned descendants stay members of the
context above it. A float and an atomic inline box paint the same
way, whole, in their phase. So does a flex or grid item, which paints
as an inline block does (css-flexbox §5.4, css-grid §9), a flex or
grid container's items in order-modified document order (`order`).
So a block's text that overflows onto a later block's fill shows over
it, and a float over a later block from another parent (probed
2026-09-27, all three engines).

**A member keeps its own state.** It paints later than its tree
position, but what it paints under is still its own:

- _Origin_: where it paints for the current scroll (scrolling.md,
  sticky.md), with the scroll offsets and sticky shifts of its
  containing-block chain applied.
- _Clip_: the overflow clips of the boxes on its containing-block
  chain (below).
- _Group and layer_: every group (a faded box) and every layer (a
  transformed or filtered box) above it forms a stacking context, so
  its context's turn paints inside them. A `z-10` descendant of an
  `opacity-50` card fades with the card and stays under a later
  `relative z-1` sibling of it (probed 2026-09-27).
- _Hiding_: a box that `position-visibility` hides hides its members
  with it (anchor-positioning.md); `visibility: hidden` hides its own
  ink alone (visibility.md).

**Clips and scrolls follow the containing-block chain.** In CSS an
ancestor's overflow clips a box only when the box's containing block
is that ancestor or lies inside it (CSS 2.1 §11.1.1), and a scroll
container moves only such boxes. The grid does the same. The chain
runs from a box to its containing block ("Containing block"): the
parent for an in-flow box, the nearest positioned ancestor for an
absolute box, the host for a fixed box. It goes on the same way from
there. A layer root ends the chain for the boxes in its layer, whose
clips are in the layer's own space (layers.md), as a transformed box
contains its positioned descendants in CSS. So an `absolute` menu in
an `overflow-hidden` box whose `relative` ancestor lies outside that
box shows whole past the box's edge. In a scrolled `overflow-auto`
list with such an ancestor, it holds still while the list scrolls
(probed 2026-09-27, all three engines). Its light element takes back
the scroll it escapes (`--mw-sx`/`--mw-sy`), as a fixed box's does.
A `sticky` box inside it sticks to a scroller on its own chain
(sticky.md), an anchored box's scrollers and clips are those on its
chain (anchor-positioning.md), and the grid grows to show it past a
static clipping box, as visible overflow does (cell-model.md
"Overflow"); no scroller's range counts it (scrolling.md, Deviations).

**Hit testing** follows the same order (pointer.ts). The box at a cell
is the last one painted there, inside its own clip, that shows and
takes pointer events. That includes a descendant painted outside its
ancestors' boxes, such as a menu below its button's card. A box
takes a cell where its border box lies (a text leaf's grown to its
ink, scrolling.md), in the phase its fill paints in, and a leaf takes
it again where its glyphs paint, in theirs: a block's text
overflowing onto a later block takes the cells of its glyphs, the
later block the rest. (WebKit hits the text there too; Chromium and
Firefox hit the later block, probed 2026-09-27.) The hit stack is
that box and all its ancestors, outermost first, as native `:hover`
climbs them. The top layer paints last, so it is tried first
(top-layer.md); a hit through a layer scans the layer's own entries
(layers.md).

**The lattice** ranks a collapsed table's parts by the same order
(sticky.md "Table parts stick"): a part covers the lines of an
earlier part it slides over. A `sticky top-0` `<thead>` at
`z-index: auto` comes before the body in tree order, so a sticky
first column's cells paint over its corner as they scroll up beneath
it, as in CSS. A `z-*` on the `<thead>` lifts it over them (probed
2026-09-27). A part in the positioned step, a sticky one among them,
paints its own lines in its turn, over its background, even where
that turn comes before its table's. Chromium and WebKit paint them
that way; Firefox paints a positioned row's background over them
(probed 2026-09-27).

**Inline elements.** A positioned inline element (`relative`,
`sticky`) and one that forms a stacking context — a faded one, a
positioned one with a `z-index` — paint their glyphs in the positioned
step of their leaf's stacking context, as members ordered like boxes
(probed 2026-09-27): a `relative` span shifted onto a later block's
text paints over it, and a `relative z-10` span paints over a later
`relative` block. The leaf's other
glyphs paint in its own turn. A nested one is a member of its own,
ordered after the one it sits in, or it paints inside that one where
that one forms a context. A glyph a member paints over the leaf's
own is the character at that cell, for the hit and the selection.

**Native stacking.** The light elements stack as the browser stacks
them: every laid-out element absolutely positioned (cell-model.md),
with `z-index` in effect only where CSS applies it, positioned
elements and flex and grid items. The engine writes `--mw-z` there
alone (cell-model.md "Engine variables"), since the absolute
positioning would otherwise let it apply everywhere. In grid mode the
covered marks give the pointer to what the grid shows (cell-model.md
"Pointer states").

**Deviations**: 5–8 below.

## Plain-text renderer

`renderPlainText` applies relative offsets and absolute placement
(plain rect math), and inline relative shifts too: the run records each
character's inline element, so its whole-cell insets move the glyphs.

## Deviations from CSS (summary)

1. `fixed` anchors to the `<mono-wind>` host, not the viewport.
2. Percent insets on inline elements are treated as 0 (in Firefox, as
   the px it resolves them to).
3. An out-of-flow element extracted from a text run takes its leaf's
   content-box origin as its static position, not CSS's hypothetical
   inline position.
4. All cell-model deviations (integer rounding, etc.) apply; sticky's
   own are in `sticky.md`.
5. **The light DOM stacks and clips as absolutely positioned boxes.**
   Natively every laid-out element is `position: absolute`, so the
   in-flow ones stack with the positioned ones in tree order, and
   every clipping ancestor clips each one. Two effects follow. In
   `select="text"`, where the light DOM takes the pointer, an in-flow
   box that overlaps an earlier positioned one takes the native hover
   and press where the grid paints the positioned one. In either mode,
   a native control past a clip that its box escapes on the grid (an
   `absolute` box past a static `overflow-hidden` box, a `fixed` box)
   takes no press there. The cause: the engine places every box
   natively as an absolute one.
6. **An inline element forms a stacking context for its glyphs
   alone.** An out-of-flow box inside an inline element that forms one
   is a member of its leaf's context, with its inline
   ancestors' opacity folded into its own group (cell-model.md
   "Opacity and translucency"). CSS makes it a member of the inline
   element's context. And an inline member orders at its leaf's place
   in tree order, before the leaf's out-of-flow boxes, where CSS puts
   a box that precedes it in the document first. The cause: an inline
   element is no node of the layout tree.
7. **Only `position` makes a containing block.** A `transform`,
   `filter`, `perspective`, `contain: layout | paint` or a
   `will-change` of one makes none for layout, where CSS makes one for
   absolute and fixed descendants. They are placed against the nearest
   positioned ancestor, or the host. A layer root still ends their
   paint's chain ("Paint order"). The cause: the positioning pass
   reads the author's `position` alone.
8. **An inline element's own effects form no stacking context.** A
   `filter`, `backdrop-filter`, `mix-blend-mode`, `clip-path`,
   `mask-image`, `isolation: isolate` or `will-change` of one leaves an
   inline element's glyphs in its leaf's turn, where CSS paints them in
   the positioned step. The cause: the grid draws none of those
   effects on an inline element, and reading them for every inline
   element cost 2.8% of a prose relayout's script
   (`../architecture/performance.md` "Stacking contexts").

## Touch points on implementation

For "Paint order":

- stacking.ts: the rules — `zIndexApplies`, `formsContext`,
  `inPositionedStep`, `inlineOpacity`; a context's members
  (`membersOf`), a leaf's inline members among them
  (`inlineMembersOf`, `inlineOwners`, `glyphTurns`); the one traversal
  (`paintOrder`, `paintTurn`), its phases (`boxesOf`, `floatsOf`,
  `contentOf`, each child's by `phaseOf`) in order-modified document
  order (`ordered`), handed to a `PaintVisitor`; and `paintIndex`, the
  layout's paint order for the hit, each layer's span and each box's
  parent.
- style.ts: `readStacking` into `CellStyle.stacking`, `readLayer`
  counting an effect's identity.
- types.ts: `CellStyle.stacking`; a node's `paintClip` and a leaf's
  `inlineMembers` and `inlineOwners`; an `InlineElement`'s
  `positioned`, `zIndex` and `context`.
- tree.ts: `inlineEntry` reads an inline element's position,
  `z-index` and context (sticky, a `z-index`, an opacity below 1 or
  running); `buildLeaf` records the leaf's `inlineMembers` and each
  entry's glyph turn (`inlineOwners`).
- paint-origin.ts: `placePainted` — each box's `paintOrigin` and
  `paintClip` from the frame its chain continues from (its parent's,
  an absolute box's containing block's with the scroll between taken
  back, a fixed box's the host's or its layer's), and the boxes that
  escape a scroller among those a scroll shifts.
- layout.ts: `containsAbsolute`, where the chain continues;
  `contentExtent` counts an absolute box where its chain reaches (the
  grid's ink extent, a scroller's range).
- plain-text.ts: `painter`, the paint's visitor — every table's
  lattice resolved first (`resolveLattices`), a turn's group or layer
  on `enter`, `paintBox`, a leaf's glyphs by turn (`paintText` tells
  each glyph's, a leaf with inline members walked once and held),
  `paintBars`, a table's lattice; `inkClip`; `inlineShift`, a member's
  shift; `charIndexAtCell`, the glyph painted last at a cell.
- pointer.ts: `lastTaking` scans `paintIndex` from its end (`takes`,
  a member's glyphs where its shift moves them), `cellAtPoint`
  covering a layer by its span.
- lattice.ts: `coverage` ranks a table's parts by `paintTurn`, and
  `placementOf`'s owner is the innermost part in the positioned step.
- render.ts: `--mw-z` where `zIndexApplies`; `writeShift` takes back
  the scroll an absolute box escapes.
- positioning.ts: `containingChain`, the frames whose scroll and
  clips reach an anchored box and its anchor.
- sticky.ts: `stick` takes the scrollport of the box's chain.
