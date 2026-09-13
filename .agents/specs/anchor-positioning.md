# Spec: anchor positioning — a box placed against another, in cells

Status: **proposed** (2026-09-13). Builds on `positioning.md`
(absolute and fixed boxes, containing blocks) and `top-layer.md`
(popovers, which are the usual anchored boxes).

## Motivation

A menu opens under its button, a tooltip above its word, a submenu
beside its item: CSS anchor positioning (`anchor-name`,
`position-anchor`, `position-area`, `position-try-fallbacks`) says
this without JavaScript, and the browsers position the light elements
by it — but in pixels of the companion's boxes, off the grid, and not
in every engine (probed 2026-09-13: Firefox parses the properties and
positions nothing). The engine already owns every positioned box's
place, in cells, and writes it onto the light element, so the native
box and the grid box coincide; anchored placement joins that: the
engine resolves the anchor and the area in cells, the browser's own
anchor positioning stays unused.

## Reading

Per element during the measure pass, from computed values:
`anchor-name` (`none`, or one or more dashed idents; the first is the
element's name), `position-anchor` (`auto`, or a dashed ident),
`position-area` (`none`, or one or two keywords of the 3×3 grid:
`top`, `bottom`, `left`, `right`, `center`, their `span-*` forms,
`span-all`, and the logical and `self-*` spellings, mapped to physical
for a horizontal, left-to-right host), `position-try-fallbacks`
(`none`, or a comma-separated list of tactics, each one or more of
`flip-block`, `flip-inline`, and `flip-start` applied together), and
`justify-self` / `align-self` for the alignment inside the area. An `anchor()` or `anchor-size()` in an inset or a size is not
read: the Typed OM reports it as `auto`, so it behaves as `auto`
(Deviations).

## Locked decisions

- **An anchored box is an absolutely positioned box with an anchor.**
  A box with `position: absolute`, `fixed`, or in the top layer, and
  a `position-area` other than `none`, is placed by its anchor: the
  element named by `position-anchor`, or for `auto` its implicit
  anchor — the button that invoked it through `popovertarget` or
  `commandfor`. The anchor is the nearest element before it in tree
  order whose `anchor-name` includes the name, laid out in the same
  host; without one the box is positioned as if `position-area` were
  `none`.
- **The area is a cell of the anchor's 3×3 grid.** The anchor's
  border box, in the host's cells, divides the anchored box's
  containing block (positioning.md) into three rows and three
  columns, an anchor edge past the block's own leaving an empty row
  or column; `position-area` picks the row and the column: `top`, `center`, `bottom` for the row, `left`, `center`,
  `right` for the column, and a `span-*` or `span-all` a row or
  column together with the anchor's own. One keyword sets its axis
  and leaves the other `span-all`. The box is laid out with the area
  as its containing block, as in CSS: `auto` insets are the area's
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
- **Fallbacks flip.** When the placed box overflows its area, each
  tactic of `position-try-fallbacks` is tried in order — `flip-block`
  mirrors the row, `flip-inline` the column, `flip-start` swaps the
  two axes across the diagonal, a tactic's keywords together — and
  the first that fits is taken; none fitting, the first placement
  stands and overflows, as in CSS. The area taken is written onto the
  light element as `data-mw-area` (its two physical keywords), so a
  style can follow a flip — an arrow, a rounded edge — as it would a
  `data-placement`.
- **The placement is live.** Every layout resolves the anchor afresh,
  so an anchored box follows its anchor through a scroll, a resize,
  or a relayout, and the light element takes the resolved cells like
  any positioned box, so its native hit-testing sits where the grid
  shows it.
- **Margins are the gap.** A margin on the anchored box moves it off
  the anchor's edge in cells, as it does in CSS, so `mt-1` under a
  button is the one-row gap a menu wants.

## Deviations from CSS (summary)

1. `anchor()` and `anchor-size()` read as `auto`: only `position-area`
   places a box.
2. `position-visibility` is not read: a box that overflows after the
   fallbacks stays visible.
3. The anchor is the nearest preceding element by name in the host;
   CSS's acceptability rules (containing-block and stacking checks)
   are not applied.
4. Logical keywords map as for a horizontal, left-to-right host.
5. `@position-try` rules are not read; only the flip keywords apply.

## Testing

- Node: the read of the four properties; a box under, above, beside,
  and centered on its anchor, spanning and flush on each side; the
  implicit anchor of a popover; a box shrunk to a narrow area and one
  that may not wrap overflowing it; a flip at the host's bottom edge
  and at its right edge, a `flip-start`; alignment keywords; an
  anchor inside a scroller followed through a scroll; a margin gap.
- Storybook: a menu under its button in every engine, the light
  element's box at the grid's cells; the flip near the host's edge;
  a tooltip above a word; a submenu beside its item.
- Visual: a golden of the anchored boxes.

## Touch points on implementation

- style.ts: the anchor properties on `CellStyle`.
- layout: anchored boxes resolved after their anchors, in the
  absolute pass.
- render.ts: the resolved cells written onto the light element as for
  any positioned box, and the area taken as `data-mw-area`.
