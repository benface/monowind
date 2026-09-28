# Spec: anchor positioning — a box placed against another, in cells

Status: **implemented** (2026-09-13; the anchor functions, fallbacks
for every box, `position-try-order`, and `position-visibility`
2026-09-22; the last acceptable anchor, `anchor-scope` and sticky
anchors 2026-09-27; `style.ts` reads the properties, `positioning.ts` places
the box and tries the fallbacks, `render.ts` writes the area taken).
Builds on `positioning.md` (absolute and fixed boxes, containing
blocks) and `top-layer.md` (popovers, which are the usual anchored
boxes).

## Motivation

A menu opens under its button, a tooltip above its word, a submenu
beside its item: CSS anchor positioning (`anchor-name`,
`position-anchor`, `position-area`, `position-try-fallbacks`) says
this without JavaScript, and the browsers position the light elements
by it — but in pixels of the companion's boxes, off the grid, and not
in every release (Firefox before 155 parsed the properties and
positioned nothing, probed 2026-09-13; Firefox 155 anchors natively).
The engine already owns every positioned box's
place, in cells, and writes it onto the light element, so the native
box and the grid box coincide; anchored placement joins that: the
engine resolves the anchor and the area in cells, the browser's own
anchor positioning stays unused.

## Reading

Per element during the measure pass, from computed values:
`anchor-name` (`none`, or one or more dashed idents, each a name of
the element), and for an out-of-flow box `position-anchor` (`auto`,
the implicit anchor; `normal`, the initial, the implicit anchor for a
box with a `position-area` and none otherwise, as in CSS and all
three engines (probed 2026-09-22: a centered popover's `anchor()`
takes its fallback); `none`; `match-parent`, the parent's; or a
dashed ident),
`position-area` (`none`, or one or two keywords of the 3×3 grid:
`top`, `bottom`, `left`, `right`, `center`, their `span-*` forms,
`span-all`, and the logical and `self-*` spellings, mapped to physical
for a horizontal, left-to-right host), `position-try-fallbacks`
(`none`, or a comma-separated list of fallbacks, each a tactic — one
or more of `flip-block`, `flip-inline`, `flip-start`, `flip-x`, and
`flip-y`, applied in their written order — or a `position-area` of
its own),
`position-try-order` (`normal`, `most-width`, `most-height`, and the
logical `most-inline-size` and `most-block-size`),
`position-visibility` (`always`, or any of `anchors-valid`,
`anchors-visible`, and `no-overflow`, the draft's singular spellings
too; `anchors-visible` is the initial value in all three engines), and
`justify-self` / `align-self` for the alignment inside the area. An
`anchor()` as an inset and an `anchor-size()` as a size (`width`,
`height`, and their minimums and maximums) are read as authored, from
the inline style or an arbitrary-value utility (`top-[anchor(bottom)]`,
`min-w-[anchor-size(width)]`): the browsers resolve them against the
anchor's pre-grid box, px the grid cannot use.

No anchor name resolves natively while the engine reads: the
companion scopes each element naming one to its own subtree
(`anchor-scope: all`) under its measuring flag, an element the engine
marks `data-mw-anchor` from the `anchor-name` it read, so the browser
applies no fallback of its own to what the read sees. An element
named since the last layout, or whose mark a script took off (a
DOM-morphing library's), is read unscoped the first time: that
layout marks it and, where a box in the tree is anchored by name,
reads the tree again before laying it out, so the layout that first
meets a new anchor places by it as authored. An invoker's name,
synthesized for its popover (`--mw:` and the popover's id), is the
engine's alone and takes no mark. `anchor-scope` (`none`, `all`, or
dashed idents) is read on every box; on an element the engine scopes,
from its inline style or an arbitrary-property utility
(`[anchor-scope:--menu]`), the lock hiding the computed value. A
scope takes authored names alone: a popover's implicit anchor is out
of its reach, as in CSS.

## Locked decisions

- **An anchored box is an absolutely positioned box with an anchor.** A
  box with `position: absolute`, `fixed`, or in the top layer, and a
  `position-area` other than `none`, is placed by its anchor: the
  element named by `position-anchor`, or its implicit anchor — the
  button that invoked it through `popovertarget` or `commandfor` — under
  `auto`, and under `normal` where it has a `position-area`. The anchor
  is the last acceptable element in tree order whose `anchor-name`
  includes the name, laid out in the same host — a box, or an inline
  element, whose first fragment is the anchor (css-anchor-position-1,
  all three engines, probed 2026-09-27). Acceptable is inside the box's
  containing block, the block itself refused (anywhere in the host for
  a fixed or top-layer box), and, where it shares that block, in flow
  or before the box, else where the box on its containing-block chain
  just under the block's is. So a later static namesake wins over an
  earlier one, one inside a later `relative` box too, a later absolute
  one is refused, and an ancestor that is the box's containing block
  never anchors it. A name under an `anchor-scope` (a list of names, or
  `all`) is seen only inside that element's subtree, and a lookup
  inside it sees only the names there: `anchor-scope: --menu` on each
  list item keeps each item's menu on its own button, where without it
  every menu takes the last. An anchor in the top layer, inside an open
  popover or dialog, anchors only a box in the top layer after it — a
  submenu shown as a popover after its menu — never a box of the page.
  Without an anchor the box is positioned as if `position-area` were
  `none`.
- **`anchor-size()` is the anchor's cells.** A size authored as
  `anchor-size()` — an anchor name and a dimension, each optional, the
  box's own anchor and the property's own axis by default, the logical
  dimensions those of a horizontal host — resolves as the box is placed
  to that dimension of the anchor's border box, in cells; with no such
  anchor, the property takes the fallback after
  the comma, else keeps its initial value, as in CSS.
  `min-w-[anchor-size(width)]` makes a menu at least as wide as the
  button that opens it.
- **`anchor()` is a point of the anchor.** An inset authored as
  `anchor()` — an anchor name, optional, the box's own by default,
  and a side — resolves as the box is placed to the distance, in
  cells, from its containing block's edge to that point of the
  anchor's border box: the inset's own axis's sides (`top: anchor(bottom)`
  puts the box's top on the anchor's bottom), `center`, the logical
  sides of a horizontal left-to-right host, `inside` and `outside`
  (the inset's own side and the opposite), or a percentage from the
  start, the point rounded to the cell once, so boxes on either side
  of it meet. Another axis's side, or no such anchor, takes the
  fallback after the comma, else leaves the inset
  `auto` — a popover's UA `inset: 0` included — as in CSS. Under
  `anchor-center`, a box placed by its insets centers on its default
  anchor in the block they leave, its auto insets and margins zero,
  shifting to stay inside it.
- **The area is a cell of the anchor's 3×3 grid.** The anchor's
  border box, in the host's cells, divides the anchored box's
  containing block (positioning.md) into three rows and three
  columns, an anchor edge past the block's own leaving an empty row
  or column; `position-area` picks the row and the column: `top`,
  `center`, `bottom` for the row, `left`, `center`, `right` for the
  column, and a `span-*` or `span-all` a row or
  column together with the anchor's own. One keyword sets its axis
  and leaves the other `span-all`. The box is laid out with the area
  as its containing block, as in CSS: its insets offset it from the
  area's edges, an `anchor()` measured from them (`position-area:
bottom` with `top: 2` two rows under the anchor, as in Chromium and
  WebKit; Firefox leaves it on the anchor's edge), a fallback's own area
  keeping the box's insets too; `auto` insets are the area's
  edges, its size shrinks to fit the area as an absolute box's does
  (so a menu whose items may not wrap — `whitespace-nowrap` — keeps
  its width and overflows a narrow area instead, which is what the
  fallbacks answer), and it is aligned in the area toward the anchor:
  against the anchor's edge on an axis that names a side, along the
  anchor's edge a span keeps (`span-right` aligns left edges, `span-left`
  right edges), centered on the anchor where the axis spans all or is
  `center` — unless `justify-self` or `align-self` says `start`, `end`,
  `center`, or `anchor-center`. The area is small, so the relayout it
  takes is the box's subtree alone, once per placement tried.
- **Fallbacks flip.** When the placed box overflows — its margin box
  past its area, or for a box placed by its insets past the block its
  insets leave — each fallback of `position-try-fallbacks` is tried in
  order and the first that fits is taken; none fitting, the placement
  in effect stands and overflows, as in CSS. A tactic's flips apply in
  their written order: `flip-block` mirrors the row, `flip-inline` the
  column, `flip-start` swaps the two axes across the diagonal, the
  box's width and height with them, their minimums and maximums too
  (an 80 × 20 box is 20 × 80, all three engines, probed 2026-09-27;
  `w-20` a height of 20 rows), an `anchor-size()` taking the other
  dimension (`min-w-[anchor-size(width)]` a minimum height of the
  anchor's) (`flip-x` and `flip-y` the inline and
  block flips of a horizontal host); a box placed by its insets has
  them flipped instead, each
  side's value moving to its mirrored side, an `anchor()` there naming
  the mirrored point (`top: anchor(bottom)` under `flip-block` is
  `bottom: anchor(top)`), rounded from the mirrored edge so the cell
  mirrors too. The margins and the self-alignment flip with
  them — `start` and `end` trade on a mirrored axis. A `position-area`
  of its own places the box in that area of its default anchor.
  `position-try-order` sorts the placements, the base among them, by
  their room on the axis it names (an area's size, or the block the
  insets leave, an auto inset as zero), the roomiest first, ties in
  their own order.
- **The placement that fit is kept.** A box keeps the placement it
  last fit in while that still fits, trying the others only when it
  overflows, as CSS keeps its last successful option: a menu flipped
  above its button stays above as the button scrolls back up. The
  host remembers each box's placement from one layout to the next,
  and forgets it when the box's styles that choose it change (its
  position, anchor, area, fallbacks, try order, insets, margins,
  sizes, or self-alignment) or a layout leaves the box out.
- **The area taken is written.** The area is written onto the
  light element as `data-mw-area` (its two physical keywords), so a
  style can follow a flip — an arrow, a rounded edge — as it would a
  `data-placement`.
- **The placement is live.** Every layout resolves the anchor afresh,
  so an anchored box follows its anchor through a scroll, a resize,
  or a relayout, and the light element takes the resolved cells like
  any positioned box, so its native hit-testing sits where the grid
  shows it. The anchor's box is where the scroll shows it: moved by
  the scroll containers on the anchor's containing-block chain that
  the box's own chain skips (positioning.md "Paint order"; a fixed box
  skips them all), and a scroll of such a container lays the host out
  again, so the box follows. A sticky anchor, or one inside a sticky
  box, is where it sticks for the current scroll (sticky.md), as in
  Chromium and WebKit, where Firefox 155 keeps its laid-out box
  (probed 2026-09-27): a menu under a stuck header's button stays under
  it, its scroller's scroll laying the host out again even where the
  box scrolls with it, and a box inside that header moves with it once.
- **`position-visibility` hides the box and its subtree**, whatever
  their own `visibility`, as the browsers' force-hidden: under
  `anchors-valid` where the box needs its default anchor (an area,
  `anchor-center`, or an anchor function naming none) and it has
  none; under `anchors-visible` where that anchor is
  hidden — by its `visibility`, or by a `position-visibility` of its
  own or of a box above it, so a submenu goes with its menu — or
  clipped out of view: no cell of its border box inside the window of
  a box on its containing-block chain that clips it and is not on the
  positioned box's (an inline anchor's taking in its own paragraph, a
  `truncate` one's cutting it off as in CSS), each window moved by its
  own scroll and the anchor by the scroll of the clipping boxes inside
  it; under `no-overflow`
  where the box overflows after the fallbacks. A scroll of such a
  clipping box lays the host out again, so the box shows as its anchor
  scrolls back. Hidden, it
  paints and takes nothing (visibility.md), and the light element is
  clipped away with its subtree, so it takes no pointer yet stays in
  the accessibility tree and takes the focus, as the browsers hide it
  at paint alone — a top-layer element inside it aside, whose box is
  the viewport's, as in CSS.
- **Margins are the gap.** A margin on the anchored box moves it off
  the anchor's edge in cells, as it does in CSS, so `mt-1` under a
  button is the one-row gap a menu wants, and a flip mirrors the
  margins with the area as CSS does — `flip-block` swaps top and
  bottom, `flip-inline` left and right, `flip-start` the two axes — so
  a gap or a shift set on the anchor's side follows the box, and the
  fit a fallback tests is the margin box's.

## Deviations from CSS (summary)

1. `anchor()` and `anchor-size()` are read only as a whole inset or
   size from the inline style or a utility — not inside `calc()`, not
   from a stylesheet's rule (its px read instead), a fallback only as
   a length, a percentage, or a calc() of them. A utility's variant
   is not evaluated: which utility the cascade leaves in effect is told
   from the computed value, where Typed OM has it (Chromium, WebKit).
   The engine reads under `anchor-scope`, so an anchor function in
   effect computes to the property's initial value, or to its fallback
   where it has one (probed 2026-09-23), and any other value rules it
   out — a later utility's (`inset-[anchor(bottom)] top-4` is
   `top: 1rem`) or an active variant's, compared in px, so
   `md:top-[17px]` rules out `top-[anchor(bottom,1rem)]` though both
   round to four cells. The first utility in the class attribute the value leaves
   standing is read, so the initial value stays ambiguous: it is every
   fallback-less anchor function's
   (`top-[anchor(bottom)] md:top-[anchor(top)]` reads `anchor(bottom)`
   at `md` too), an inactive variant's alone
   (`hover:top-[anchor(bottom)]` unhovered), a later utility's setting
   it (`top-[anchor(bottom)] md:top-auto`), and in WebKit a competing
   `min-*-0`'s (its initial minimum reads `0px`); so does a fallback's
   value, a later utility's computing to it
   (`top-[anchor(bottom,1rem)] md:top-4` reads the anchor at `md` too),
   and a fallback the reader cannot evaluate (`em`, `var()`). In
   Firefox, and for a box whose default anchor is a popover's invoker
   where the function names no anchor (the invoker resolves natively),
   the first such utility is read whatever the cascade says. A `width`
   or `height` takes a fallback of whole cells or a plain percentage, a
   calc() of both reading `auto`.
2. `anchors-visible` tests the anchor's border box, not its ink
   overflow.
3. `anchor-scope` is not read on an inline element that names no
   anchor, so such an element scopes no names.
4. On an element the engine scopes, `anchor-scope` is read from its
   inline style or an arbitrary-property utility alone, the engine's
   own scope hiding a stylesheet's (Reading).
5. Logical keywords map as for a horizontal, left-to-right host.
6. `@position-try` rules are not read; only the flip keywords and
   `position-area` values apply.
7. A sticky inline element naming an anchor is anchored where it is
   laid out, not where it sticks.
8. Every anchor follows its scroll containers at every layout; CSS
   remembers the scroll offsets of anchors other than the default one
   and updates them only when the placement is chosen again.
9. The last successful placement is recorded at each layout, not at
   the time `ResizeObserver` events are delivered.
10. The engine places absolute boxes in tree order, where browsers place
    them by containing block and the top layer in the order it opened:
    an anchor inside an absolute box after the anchored box is refused,
    where CSS accepts one whose absolute box lies in a later in-flow box
    under the anchored box's containing block (a `relative` card after
    it), and a top-layer box takes an anchor in another top-layer
    element that comes before it in tree order, not one opened before
    it.

## Testing

- Node (`anchor.test.ts`): the read of the properties, the anchor
  functions (their sides, dimensions, and fallbacks, a calc() and a
  zero one, the utility the cascade leaves in effect among several, a
  popover's naming an anchor), the try tactics in their order (`flip-x`, `flip-y`), and
  the implicit anchor under each keyword; a box under, above, beside,
  and centered on its anchor, spanning and flush on each side; a box
  shrunk to a narrow area and one that may not wrap overflowing it; a
  flip at the host's bottom edge and at its right edge, a `flip-start`
  swapping the sizes and `anchor-size()`'s dimension,
  flips in their written order, an area of its own, the self-alignment
  mirrored; the same for a box placed by `anchor()` insets, its margins
  mirrored, on either axis; alignment keywords, `anchor-center` on a
  box placed by its insets; an anchor inside a scroller followed
  through a scroll; a margin gap, mirrored through a flip; a negative
  margin's shift along the anchor; `anchor-size()` and `anchor()` in
  layout, stretched between two anchors and rounded once from the
  anchor's edge; `position-try-order` on either axis, the base sorted
  with the fallbacks, for areas and for insets; the last successful
  placement kept, retried on overflow, and forgotten; each
  `position-visibility` condition, an anchor hidden or in a chain, a
  zero-height anchor, an anchor inside a fixed menu declared in a
  scroller, a fixed anchor declared in one, and an inline anchor its
  paragraph cuts off or scrolls; an anchor on a sticky box, stuck, not
  yet stuck, held at its parent's end, fixed inside it, and anchoring a
  box in the same header; the last acceptable
  anchor (a later in-flow one, a later absolute one refused, the
  containing block refused, a fixed box's, a scoped list, the top
  layer's, an invoker's name out of every scope) and `anchor-scope`'s
  read.
- Storybook (`positioning.stories.ts`): a menu under its button in every
  engine, the light element's box at the grid's cells; the flip near
  the host's edge, kept as the button scrolls back up; a tooltip above
  a word; a submenu, a popover shown after its menu, beside its item; a
  menu following its button
  through a list's scroll, flipping as the button nears the host's
  edge, and one under a stuck header's button staying there
  (`AnchorInScroller`); a note flipping with the host's width; the anchor functions
  from utilities and the inline style, a utility the cascade overrides
  left out (`AnchorFunctions`), the try
  order (`AnchorTryOrder`), and a box hiding as its anchor scrolls away,
  its button still taking the focus and its opacity transition never
  running, or as a `truncate` paragraph cuts
  its anchor off (`AnchorVisibility`); in `ui.stories.ts`, a select's menu as wide as
  its trigger; which element anchors a box (`AnchorAcceptable`), beside
  the browser's own boxes.
- Visual: a golden of the anchored boxes.

## Touch points on implementation

- tree.ts: a named inline element's `anchor-scope`.
- style.ts: `readAnchorScope`, a box's `anchor-scope` in `readCellStyle`;
  the anchor properties on `CellStyle` (`anchorNames` for
  every element, the anchoring for out-of-flow boxes, `normal`'s
  implicit anchor in `readPositionAnchor`, the tactics in
  `parsePositionTryFallbacks`); `readAnchorNames` shared with tree.ts,
  which names inline elements' entries; `IMPLICIT_ANCHOR`, the start
  of an invoker's synthesized name, by which positioning.ts tells it
  from an author's; `readAnchorSizes` and
  `readAnchorInsets` the authored `anchor-size()`s and `anchor()`s
  (`authoredAnchorFunction`), the first of a property's utilities the
  cascade can leave in effect (`inEffect`, against the function's
  fallback in px, or the initial value as the engine reads an `auto` minimum
  — the cell metrics' `autoMinimum`), their properties unset until placed
  (`setAnchorSize`).
- metrics.ts: `autoMinimum`, how Typed OM reads an `auto` minimum, read
  once off the host's probe, which holds its own at `auto`.
- types.ts: the anchoring on `CellStyle`, `AnchorFallback` and `Flip`,
  `AnchorSize` and `AnchorInset`, and a placed box's `anchorArea` and
  `forceHidden` on `LayoutNode`.
- positioning.ts: `namedAnchors`, the elements a tree reads as naming
  an anchor and whether a box in it is anchored by name;
  `positionOutOfFlow` runs the pass, carrying each box's last successful
  placement (`Remembered`): `walk` offsets the boxes in flow and
  records their anchors, deferring each outermost absolute box, then
  places each deferred box in tree order, syncing its scroll offsets
  before reading the anchors inside it. `recordAnchors` records each
  anchor's rect, its sticky boxes' shifts added (`stuckOn`), its tree
  order, its containing-block chain (`containingChain`), whose scroll
  moves it and whose clips hide it, whether it lies in the top layer, its
  scope (`scopeOf`), and whether it is hidden (an inline element's
  first fragment as laid out from `inlineElementRects`, its chain going
  on into its box); `anchorFor` takes a box's last acceptable one, and
  `anchorRectFor` its rect as the box sees it. `placeAbsolute` hands
  the box to `placeTrying`, which keeps its last placement while it
  fits, else tries its placements in `position-try-order` — its
  `anchor-size()`s resolved for each (`resolveAnchorSizes`, swapped with
  the sizes under `flip-start`, `swapSizes`), in an area
  (`placeInArea`), or by its insets (`resolvedInsets`, `placeByInsets`,
  `anchor-center` included), under a tactic's flips (`flipSides`,
  `flipArea`, `flipSelf`), the fit its margin box in the block
  (`fitsIn`) — and a fixed box keeps its host rect. The scrollers whose
  scroll moves an anchor under a box are noted on the root as
  `anchorScrollers`, and a
  placed box's `position-visibility` sets its `forceHidden`
  (`anchorClipped` for `anchors-visible`).
- plain-text.ts: a `forceHidden` box's subtree paints nothing; the
  top-layer stack paints on its own; `inlineElementRects` gives an
  inline anchor's fragments whole where a truncation cuts them.
- pointer.ts: a `forceHidden` box's subtree takes no hit; the top-layer
  stack takes its own.
- focus.ts: focus navigation skips a `forceHidden` box's subtree, a
  top-layer element inside it aside.
- selection.ts: the copy skips a `forceHidden` box's subtree.
- layout.ts: the scroll offsets land on the tree between the flow and
  positioning passes, and `layoutRoot` hands their sync and the host's
  placements to the positioning pass.
- element.ts: the host's placements (`#placements`) from one layout to
  the next; the anchors' marks (`#scopeAnchors`), which have the tree
  read again when one joined and a box is anchored by name — a second
  read that animate.ts's `trackBackground` answers as the first; the
  scroll sync for whichever subtree the layout hands it,
  a scroll of an anchor scroller schedules a layout, and the metrics
  probe's minimum held at `auto` against the page's CSS.
- render.ts: the resolved cells written onto the light element as for
  any positioned box, the area taken as `data-mw-area`,
  and `data-mw-force-hidden` on a box `position-visibility` hides.
- styles.css: `position-area: none` locked on laid-out elements
  outside their `data-mw-measuring` flag, so an engine that positions
  by it natively leaves the placement to the engine;
  `anchor-scope: all` on every element marked `data-mw-anchor`, under
  its flag, so no named anchor resolves natively while the engine
  reads and the browser applies no fallback of its own — every engine
  otherwise reports the fallback it chose from pixel geometry as the
  computed `position-area` (probed 2026-09-23). On every element, the
  property would keep Chromium from sharing any read style between
  elements (architecture/performance.md). The implicit anchor of a
  popover is out of `anchor-scope`'s reach, and needs none: Chromium
  reports an implicitly anchored popover's `position-area` as authored
  whatever its native placement (probed 2026-09-19). A box
  `position-visibility` hides takes `clip-path: inset(50%)` outside its
  `data-mw-measuring` flag, which the read flags' transition mask snaps
  (an `opacity` there would start the author's fades). The browsers' own
  `position-visibility` hides at paint alone — the computed
  `visibility` stays `visible` (probed 2026-09-22) — so the read is
  untouched by it.
