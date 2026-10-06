# Spec: native regions

Status: **implemented 2026-10-03**
(plans/2026-10-02-native-regions.md); its decisions taken with the user
("Decisions"). The paint order it follows is `positioning.md` "Paint
order" and `layers.md` "Later ink covers a layer"; the locks it lifts
are `cell-model.md`'s.

## Why

A real page holds things a text grid can't draw: a map, a video, an
iframe of another site, a chart on a canvas, a third-party widget, a
code editor. Without it, every light element is locked — its text
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
test. The prefix keeps the class clear of other libraries'. It is
ignored, with a warning, on an element whose `display` is `contents`,
which has no box to frame, and on a `<mono-wind>`, whose grid is its
own: a region holds a host instead ("Nesting").

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
    75 columns by 38 rows, until sized. An inline `<svg>` and a broken
    image, whose size the browser's layout gives, are measured as
    flowed contents are.
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
  layout positions. The clip applies only while something covers the
  region (deviation 5); a top-layer backdrop painted after it hides it
  whole (deviation 1).
- The region's contents keep their own fonts, colors, backgrounds,
  borders, shadows, selection highlight and pointer: none of the
  light DOM's locks reach inside it.

## Interaction

- **Pointer**: in grid mode the region's contents take the pointer as
  a page would; a grid drag that crosses the region sweeps through it,
  its contents giving up the pointer for the drag as an interactive
  element's do (`data-mw-dragging` on the host, `cell-model.md`;
  `data-mw-native-drag` on the region).
- **Selection**: inside one region, native — no highlight lock, no
  inverted cells, the browser's copy; in grid mode selectable under an
  authored `user-select: none`, as the grid's text is
  (`semantic-selection.md` "Deviations"). A selection across the region
  copies its contents' text as the page renders it, a block a line
  (`semantic-selection.md`); a region `<img>` its alt, any other
  replaced region nothing; a grid copy that text in the region's
  content cells, wrapped and cut as an image's alt.
- **Focus**: Tab is native, into and out of the region; under
  `focus="arrows"` the arrows inside a region are the contents' own,
  as for any focus the layout does not know, and the host's arrows pass
  over the contents (`focus-navigation.md`).
- **Keys, wheels and scrolls** inside a region, and a press on it, are
  the browser's: the engine routes none, defers no relayout for them.
- **What lays the host out**: of the contents' events, only a press, a
  `change`, and the pointer or the focus crossing the region's edge —
  what `:active`, `:has()`, `:hover` and `:focus-within` on the boxes
  around it follow (deviation 4).

## The locks

No light-DOM lock (`styles.css`) reaches a region's contents:

- **The box locks** — a laid-out element's place and size in cells, no
  native fill, border or shadow — reach the region itself, whose box
  the grid draws, but not inside it.
- **The ink, font and pointer locks** — transparent text, the grid's
  font, the grid-mode pointer — stop at the region, whose own text and
  pointer are native too.

A lock a region's contents could match comes as twin selectors: one
for a host holding no region (`data-mw-no-regions`), as the lock was,
and one for a host holding one (`data-mw-regions`), whose subject
skips the region's contents, or the region and its contents. The
engine writes the host's mark (`no-regions` from its connection) and
the region's; a lock keyed on an engine flag, which no region's
contents carry, needs no twin. A host nested in a region is a host of
its own, whose locks reach its light DOM through its own mark.

The first design scoped the locks (`@scope (mono-wind) to
([data-mw-native])`, and `to ([data-mw-native] > *)` for the box
locks): measured (2026-10-02), every scoped rule made style matching
dearer on every page, regions or none — Chromium's prose bench 55 →
81 ms of style, 195 → 225 ms to load; WebKit about twice that in a
micro-probe. The
twins cost a page with no region one attribute test per lock (+5%
style time on the same bench), and `revert-layer` from an important
lock can't reveal an author's plain styles, which rules out undoing
the locks inside a region instead.

## The engine's walks

The measure pass, the interactivity marks and the observer's
re-layouts skip the region's subtree; a change inside a region lays
the host out again only where the last layout measured it: a size left
auto — a flex item's automatic minimum width among them — or a
percentage width, whose intrinsic contribution the host's own
intrinsic width asks for.

## Nesting

A `<mono-wind>` inside a region is a host of its own, laid out by
itself: the region is native, so the outer host's locks ("The locks")
and walks stop at it — but for a nested host holding regions of its own,
which takes no lock (Decision 8). The outer host's grid-mode pointer
rules, keyed on its own mode and drag, still reach the inner host's
interactive elements: under a grid-mode outer host, a grid-mode inner
host's drag stops at them. Elsewhere a nested host stays unsupported:
marked `data-mw-nested`, its engine off, plain content of the outer
host, warned of once.

Which it is follows the outer host's marks: read as the inner host
connects — one that ran, moved into no region, stopping there — and
settled after each of the outer host's layouts: a region marked around
a nested host starts it, one unmarked stops it, everything it wrote
taken back for the outer host to lay its contents out, its regions'
marks the outer host's again. The warning waits for that settle, the
page's styles applied. The outer host hears none of a running inner
host's mutations, and a selection in its grid is the region's; a copy
across the region takes the inner host's part as it copies it. A
region moved into another host is that host's to mark, and an element
moved into a region is released of what the engine wrote on it.

## Decisions (2026-10-01, with the user)

1. **A utility class, `mw-native`**, on any element, valid HTML,
   variants included; prefixed at the user's ask, the first of
   monowind's utilities to be.
2. **It follows the paint order**: menus, dialogs and sticky headers
   paint over a region as over anything, its covered cells clipped.
3. **The grid frames it**: the region's own fill and border are cells,
   its contents native inside them.
4. **The locks stop at a region**: the box locks reach the region
   itself, the ink, font and pointer locks stop at it. Scoped with
   `@scope` at the user's suggestion; twin selectors since 2026-10-02
   (Decision 8).

Taken 2026-10-02, with the user (plans/2026-10-02-native-regions.md):

5. **Contents start native, from the host's font**: a region resets
   every property the locks hold on its ancestors to CSS's initial
   value, or the browser's own where its sheet sets one (a `pre`'s
   white-space, a link's cursor) — the locks skip it, but it
   inherits — and form controls inside keep their native chrome; the
   font family, size and color still inherit the host's.
6. **One atomic paint step**: a flowed region's contents paint at a
   replaced element's content step; a later block's background over it
   lies beneath them (deviation 3).
7. **The scrollbar and clip inside the frame**: a region's border cells
   are a transparent native border, its padding cells native padding,
   so its own scrollbar and overflow clip sit inside the grid's border.
8. **Twin selectors, no `@scope`**: `@scope` slowed every page down
   ("The locks"); the twins cost a page with no region a few percent of
   style time, and keep the browser floor where it was. A limit: a host
   holding regions, inside another host's region, takes no lock on its
   light DOM — its twins skip whatever lies in any region, the outer
   one's included; nesting that deep is rare.

## Deviations from CSS

1. A covering paint hides the region's covered cells whole, a
   translucent one (a modal's dimmed backdrop) included: the grid's one
   glyph per cell (`layers.md` deviation 7, `cell-model.md`
   deviation 11).
2. Inside a scroller, the contents slide with the native scroll while
   the region's border and fill step by cells (`scrolling.md`, as the
   light DOM already does).
3. A flowed region's contents paint as one step, at a replaced
   element's content's place: a later block's background overlapping
   the region lies beneath its contents, where CSS would paint the
   region's inner backgrounds beneath that block and its text above.
4. A box around a region whose style follows the contents' other
   states — `:has(:placeholder-shown)` as one types, `:has(:hover)` on
   an element inside — takes the change at the next press, `change`
   or crossing of the region's edge: a layout per keystroke or pointer
   move would cost a page its native widget's speed.
5. The covering clip is a `clip-path`: while later ink covers a region,
   it takes the place of an author's own `clip-path` on it, and its
   contents overflowing the region's box draw over the cells around it
   whatever covers those.
6. An inline flowed region aligns `baseline` and `middle` as `top`: the
   engine never reads its contents' baseline.
7. A region that is a list item has its marker hang outside it, an
   inside one too, drawn by the grid: its contents fill its content
   box, where an inside marker would push their first line aside.

## Testing

- Node (`native.test.ts`): the region a leaf of its box, inline as an
  atomic box, its cell style; replaced and flowed sizes, the native
  measure asked as the layout needs it, rounded up; the paint surface,
  its holes and its clip; a selection's classification, light and
  grid-mode copies. `element.test.ts`: the marks, the release and
  restore of contents, what lays the host out, the measure cache;
  nesting. `cascade.test.ts`: every lock's twin, the reset of every
  inherited lock, and no lock setting what a region's contents inherit.
- Storybook (`native.stories.ts`), in every engine: sized and auto
  regions; a region's own styles (a `pre`, a textarea, a button, an
  input button, a link and a list item as the browser's sheet styles
  them, a text-mode page's cursor); a native image, a video and native
  text, a page of regions; a menu, a modal and a sticky header over a
  region; a grid drag across one, copies across one, Tab and arrows; a
  nested host; a region toggled.
- Real input (`visual/pointer.spec.ts`, `visual/keyboard.spec.ts`): a
  click on a menu's cells over a region reaching the grid, a grid drag
  across a frame, Tab into a frame and out. Goldens of the stories that
  show a region.

## Touch points on implementation

- `utilities.css`: the `mw-native` utility and its `--mw-native`
  registration.
- `styles.css`: the twin selectors (the header's paragraph), the region
  reset in `base` and the browser's own defaults it keeps, the frame,
  the measure rule, the clip rule, the grid drag's sweep, and the host
  visibility rules keyed on `data-mw-nested`.
- `native.ts`: the marks; `regionOf` (the outermost region of the
  host's), `insideRegion` and `lightElements`, which the walks skip
  regions by; `regionsOf`; `regionText` and `surfaceText`, a region's
  part of a copy; `regionClip`, `clipRegions` and `clip`.
- `style.ts`: `isNativeRegion` (none on a host), and a region's cell
  style (a block, no columns or line clamp, unscrolled, no leading or
  tracking).
- `tree.ts`: `buildNativeLeaf` (natural sizes, `measureOf`, a marker
  hung outside), `sizeReplaced` and `replacedAlign`, shared with
  images; a region as an atomic inline box
  in `collectNodes`; the regions built, on the root
  (`LayoutNode.regions`).
- `types.ts`: `LayoutNode.native`, `NativeMeasure`.
- `layout.ts`: intrinsic widths and heights asked of `native.measure`;
  a replaced region compressible.
- `stacking.ts`: `PaintVisitor.native` at the content step, a box entry
  in the hit index.
- `plain-text.ts`: the region surface (`surface`, `whole`), a hidden
  region's too, and its holes; a copy render's region text
  (`textArea`, `textRows`).
- `paint.ts`: the surfaces handed to `options.surfaces`; a region's
  content cells (`LayerSet.regions`) for `gridCopy`; `clearPaint`.
- `render.ts`: `releaseContents` and `release`, which `forgetWrites`
  keeps the names for; `clearUnwritten` leaving region contents; no
  white-space flag on a region.
- `selection.ts`: `classifySelection`'s `"native"` through shadows
  (`lightNode`); `pageAround`; `surfaceCopy`; a copy's `nested` host
  parts.
- `rendered-text.ts`: `renderedLines`, a range's text as the page
  renders it, a field its value; `HostPart`.
- `image.ts`: `cellLines`; `altArea`.
- `element.ts`: `#markRegions`; `#measureContents` and its cache
  (`#measureAll`, `#forget`, `#remeasure`) and observers; `#native`,
  the event routing's edge rule and `#drag` (`data-mw-native-drag` on
  each region); the clip at `#paint`, its writes drained; `#copyText`,
  `#lightSelection`, `#reachesLight`, `#hostParts`; the page's records
  (`#takeIn`, `#releaseArrivals`); nesting (`#settleNesting`,
  `#settleNested`, `#start`, `#stop`, `#started`, `#ofInnerHost`).
