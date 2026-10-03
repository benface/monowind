# Spec: native regions

Status: **specified 2026-10-01**, not implemented; its decisions taken
with the user the same day ("Decisions"). The paint order it follows
is `positioning.md` "Paint order" and `layers.md` "Later ink covers a
layer"; the locks it lifts are `cell-model.md`'s.

## Why

A real page holds things a text grid can't draw: a map, a video, an
iframe of another site, a chart on a canvas, a third-party widget, a
code editor. Today every light element is locked — its text
transparent, its backgrounds and borders off, its font the grid's, and
in grid mode its pointer off — so a widget's text and boxes are
invisible inside `<mono-wind>`, and an iframe or a video, which no
lock reaches, draws over the grid with no box of its own and no
pointer. A native region is the hole for it: a box the
grid sizes and frames in cells, whose contents the browser draws and
runs as it would anywhere else.

## The utility

`mw-native` on any element makes it a native region; it sets
`--mw-native: 1`, a registered property that does not inherit, as
`bg-clear` sets `--mw-bg-clear` (utilities.css). Responsive and state
variants apply (`md:mw-native`). The engine reads it in the measure
pass and marks the element `data-mw-native` (engine-written, as every
`data-mw-*` is), which is what the locks and the engine's own walks
test. The prefix keeps the class clear of other libraries'.

## Layout

**The box is the grid's; its contents are the browser's.**

- The region is laid out as any element is — its sizes, margins,
  border and padding in cells, a block or flex item as its `display`
  says — with one difference: where its `display` is inline, it is an
  atomic inline box (native content can't break across the grid's
  lines).
- The engine never lays out its subtree: the region is a leaf of its
  own box.
- **A size the author leaves auto comes from the contents** where CSS
  takes it from them: an auto width resolves as any box's — a block's
  fills its container — and where a box shrinks to fit (an atomic
  inline box, a float, an absolute box), it is the contents' preferred
  width.
  - **A replaced region** (an `<iframe>`, a `<video>`, a `<canvas>`
    marked `mw-native`) takes its natural size as an image does
    (`images.md` "Sizing"): the width on the spacing scale, the height
    from its natural ratio where it has one, on the scale where it has
    none — an `<iframe class="mw-native">` is its default 300×150 px,
    75 columns by 38 rows, until sized.
  - **Flowed contents** (a `<div class="mw-native">` of native text, a
    widget) are measured as the browser lays them out — the preferred
    width where the box shrinks to fit, the height at the box's width —
    and the px become cells through the measured cell, rounded up: the
    box must hold what the browser draws, which the spacing scale would
    not.

## Paint

- **The grid paints the region's own box**: its fill, its border in
  glyphs, its shadow, as any box's. The content box shows the
  contents, natively, over that fill.
- **The region follows the paint order.** The browser draws the
  contents above every grid cell, so the engine clips the region (a
  `clip-path` of the cells nothing later covers) wherever later ink
  covers its cells (`layers.md` "Later ink covers a layer"): a menu, a
  dialog, a sticky header or a later sibling over the region hides it
  there, the pointer included, as the grid's own paint would. A region
  under a layer root is clipped to the layer's covered cells on their
  layout positions.
- The region's contents keep their own fonts, colors, backgrounds,
  borders, shadows, selection highlight and pointer: none of the
  light DOM's locks reach inside it.

## Interaction

- **Pointer**: in grid mode the region's contents take the pointer as
  a page would; a grid drag that crosses the region sweeps through it,
  its contents giving up the pointer for the drag as an interactive
  element's do (`data-mw-dragging`, `cell-model.md`).
- **Selection**: inside, native; a grid selection across the region
  copies its contents' text as the light DOM's serialization does
  (`semantic-selection.md`), an iframe's not at all.
- **Focus**: Tab is native, into and out of the region; under
  `focus="arrows"` the arrows inside a region are the contents' own,
  as for any focus the layout does not know (`focus-navigation.md`).

## The locks

The light DOM's locks (`styles.css`) are scoped, each to the host, with
a region as its limit, so no selector grows a per-element exemption:

- **The box locks** — a laid-out element's place and size in cells, no
  native fill, border or shadow — reach the region itself, whose box
  the grid draws, but not inside it:
  `@scope (mono-wind) to ([data-mw-native] > *)`.
- **The ink, font and pointer locks** — transparent text, the grid's
  font, the grid-mode pointer — stop at the region, whose own text and
  pointer are native too: `@scope (mono-wind) to ([data-mw-native])`.

A host nested in a region is a scope root of its own, so its locks
reach its own light DOM as an outer host's reach its. Probed in
Chromium, Firefox and WebKit (2026-10-01): each limit holds, the region
takes the box locks alone, and a nested host's subtree takes both,
inside `@layer` and with `!important` as the locks are.

## The engine's walks

The measure pass, the interactivity marks and the observer's
re-layouts skip the region's subtree; a change inside a region lays
the host out again only where the region's measured size may change
(a size the author left auto).

## Nesting

A `<mono-wind>` inside a region is a host of its own, laid out by
itself: the region is native, so the outer host's locks ("The locks")
and walks stop at it. Elsewhere a nested host stays unsupported, as now.

## Decisions (2026-10-01, with the user)

1. **A utility class, `mw-native`**, on any element, valid HTML,
   variants included; prefixed at the user's ask, the first of
   monowind's utilities to be.
2. **It follows the paint order**: menus, dialogs and sticky headers
   paint over a region as over anything, its covered cells clipped.
3. **The grid frames it**: the region's own fill and border are cells,
   its contents native inside them.
4. **The locks are `@scope`d**, a region their limit, at the user's
   suggestion: the box locks reach the region itself, the ink, font
   and pointer locks stop at it.

## Deviations from CSS

1. A covering paint hides the region's covered cells whole, a
   translucent one (a modal's dimmed backdrop) included: the grid's one
   glyph per cell (`layers.md` deviation 7, `cell-model.md`
   deviation 11).
2. Inside a scroller, the contents slide with the native scroll while
   the region's border and fill step by cells (`scrolling.md`, as the
   light DOM already does).

## Testing

- Node: the utility marking the element; the region a leaf of its box;
  the native measure for an auto size, rounded up; the locks' and the
  walks' exemption; the clip computed from covered cells.
- Storybook, in every engine: an iframe and a native-text panel in a
  page; a menu opened over a region (clipped, and the menu's items
  clickable where they cover it); a modal dialog over one; a region in
  a scroller; a nested host in a region; Tab into and out of one.
- Visual: goldens of the region's frame and a covered region.

## Touch points on implementation

None until implemented: this section maps the code once it lands.
