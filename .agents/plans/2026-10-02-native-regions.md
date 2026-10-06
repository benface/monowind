# Native regions

Status: **implemented 2026-10-03**, milestones 0–8. The spec is
`.agents/specs/native-regions.md` (normative); this plan orders the
work onto the code as it stands at `754e3ad` (`file:line` cites it).
For 0.3.5, with print.

## Scope

In: the `mw-native` utility and its `data-mw-native` mark; a region as a
leaf of its own box (sizes the author sets, a replaced region's natural
size on the spacing scale, flowed contents measured natively and rounded
up through the cell); the companion's light-DOM rules moved into twin
selectors that skip a region's contents; the engine's walks, observers
and event handlers leaving a region's subtree to the browser; the region
in the paint order, clipped where later ink covers it; pointer,
selection, copy and focus across and inside a region; a `<mono-wind>`
nested in a region running as a host of its own. The user's stories: a
native (non-pixelated) `<img class="mw-native">`, a YouTube `<iframe>`,
and native non-monospace text.

Out: `<iframe>`, `<video>`, `<canvas>` without `mw-native` (they still
draw natively over the grid, unframed); print (`print.md`); a utility
undoing `mw-native` at a breakpoint (`[--mw-native:0]` does it).

## What it builds on

- **`bg-clear`** (`utilities.css:149-157`, read `style.ts:348`): a
  registered, non-inheriting `--mw-*` property a utility sets and the
  measure pass reads — `mw-native`'s shape.
- **The picture's surface** (`plain-text.ts:890-950`, `openLayer(…,
  picture = true)`; the painter step `1133-1158`): a layer of no cells
  at a replaced element's content step (`stacking.ts:300-313`), whose
  `holes` collect the cells later ink covers (`addCover`/`covering`,
  `plain-text.ts:721-744`) through nested layers and groups. A region's
  surface is the same; its holes become a `clip-path`.
- **Replaced sizing** (`tree.ts:1036-1087`, `buildImageLeaf`), and a
  percentage-sized image's min-content of zero (`layout.ts:1730-1734`).
- **`#scopeAnchors`** (`element.ts:1291-1302`, called `3050-3052`): an
  engine mark written after the build, rebuilding where a mark read late
  changed what the build read — `data-mw-native`'s pattern.
- **Content the engine sizes from what the browser reports**: the
  textarea re-wrap (`element.ts:1274-1284`), the image `load` relayout
  (`502-504`).
- **Host sizing** (`cell-model.md` "Host sizing"): a nested host's
  intrinsic widths are its content's cells, in px on its spacer — what
  a region measuring a nested host reads.
- **Copy**: `pageAround` (`selection.ts:379-466`) walks rendered DOM
  text and hands other hosts' parts to them; `copyGrids`/`imageRows`
  (`plain-text.ts:154-178`) and `gridCopy` (`paint.ts:622-651`) write an
  image's alt into its cells for a copy's render.
- **Node tests of the element** (`element.test.ts`, happy-dom, a
  stubbed probe): the walks and nesting test in Node.

## Decisions (2026-10-02, with the user; the spec's Decisions 5–8)

1. **Contents start native, from the host's font**: a region resets
   every property the locks hold on its ancestors to CSS's initial value
   (text fill, pointer, user-select, selection highlight, wrapping,
   line-height, cursor, …) and form controls inside keep their native
   chrome; the font family, size and color still inherit the host's.
2. **One atomic paint step**: a flowed region's contents paint at a
   replaced element's content step (after every block's ink, in tree
   order); a later block's background overlapping it lies beneath —
   spec deviation 3.
3. **The scrollbar and clip inside the frame**: a region's border cells
   are a transparent native border, its padding cells native padding,
   so a native scrollbar or `overflow-hidden` clip sits inside the
   grid's border; `isolation: isolate` keeps its stacking the same
   clipped or not.
4. **Twin selectors, no `@scope`** (revised 2026-10-02, after milestone
   1's benches; first taken as "`@scope` required"): each lock a
   region's contents could match comes twice, for a host with no region
   (`data-mw-no-regions`) and for one with (`data-mw-regions`), the
   second skipping the region's contents; no browser floor raised. A
   host holding regions inside another host's region takes no lock.

## Gaps answered (no spec decision needed)

- **Box locks that neutralize a box's contents** (the laid-out rule's
  grid/alignment resets `styles.css:855-861`, the shared rule's
  `column-rule-style`/`row-rule-style` and `line-height` `909-927`,
  `text-indent` `1047-1053`) skip the region (`:not([data-mw-native])`
  in their gates): on a region they'd break its native flex, grid,
  columns and leading. Place, size, fill, border, shadow and the
  engine's variables reach it.
- **`<img class="mw-native">`**: the region test runs before the `<img>`
  path (`tree.ts:288`) — no `ImageSource`, no picture, no palette; the
  content lock (`styles.css:567-569`) skips the region and its contents,
  so a region `<img>` (and any `<img>` inside a flowed region) draws
  natively. Sized as an image (`images.md` "Sizing"); its `load` lays
  out; a copy reads its alt as an image's does.
- **The replaced set**: `img`, `iframe`, `video`, `canvas`, `embed`,
  `object`, inline `svg`. Natural sizes: `img` its natural size;
  `video` `videoWidth/Height`, 300×150 without a ratio before its
  metadata (`loadedmetadata`/`resize` lay out where its size is auto);
  `canvas` its attributes; `iframe`/`embed`/`object` 300×150 without a
  ratio; inline `svg` the browser's unsized layout, measured once.
- **A top-layer backdrop** is a shadow box (`paint.ts:304-326`), not
  grid ink: a visible backdrop covers, whole, every region painted
  before its element (spec deviation 1).
- **The clip**: `path(evenodd, …)` of a far outer rectangle minus the
  covered cells' runs, applied only while something covers
  (`data-mw-native-clip`); the author's own `clip-path` applies
  otherwise, the two never intersected (documented). Overflow past the
  box isn't tracked for covering (a deviation).
- **A region never scrolls as the engine's**: overflow reads as
  `hidden` for its automatic minimum, but it takes no scroll range, no
  `data-mw-clip`, no `data-mw-scroll`; its scrolling is native
  (`scrolling.md` gets a sentence).
- **Arrows**: a focused region keeps all four arrows, as a textarea
  does; the engine invents no focusability (`focus-navigation.md`).
- **Copy**: a grid copy writes the region's serialized text into its
  content box's cells, wrapped and cut as an image's alt; a light copy
  takes its DOM walk (`pageAround`'s), blocks on lines of their own; a
  selection inside one region is the browser's.
- **Measuring cost**: one forced native layout per distinct request on
  a cache miss (max-content, min-content, rows at a width), cached
  across layouts until a change may reach the region; "size a heavy
  region" documented.
- **Nested host timing**: at connect, an inner host reads `--mw-native`
  between it and the outer host; after each layout's marks the outer
  host settles each host it holds; the "unsupported" warning waits.
- **A nested host's ground** derives from what's behind it: the outer
  box lock holds the region's native background transparent, so it
  sees the outer host's — documented (`--mw-bg` or a background names
  it).
- **What the outer host doesn't hear** (a deviation): its hover chain
  stops at an iframe's edge; a text-mode drag ends at the nearest text
  outside a region; events inside relay the host out only at the
  region's edge and on `pointerdown`, `pointerup`, `change`.
- **Smaller**: `display: contents` ignored with a warning; `mw-native`
  on the host or a pseudo-element ignored; an inline non-replaced
  region is `inline-block` natively, its `middle`/`baseline` reading
  `top`; counters count a region's contents, as CSS does; the font-size
  warning skips regions.

## Milestones

Every fix's test seen failing first.

### 0. Probes

In throwaway pages, Chromium, Firefox and WebKit (the pinned builds):

1. Inheritance across the limit: in a locked parent, a region's
   computed text fill, `pointer-events` (grid mode), `user-select`, the
   `::selection` paint, `overflow-wrap`, `line-height`, `cursor`; then
   Decision 1's reset making each native.
2. The `::selection` reset value under highlight inheritance:
   `revert`, `revert-layer`, `initial`, `Highlight`/`HighlightText`.
3. `@scope` mechanics: `:scope` vs `&` specificity; `@scope` inside
   `@layer` and `@media`; the lower bound `([data-mw-native] > *)`;
   surviving Tailwind's Lightning CSS, `@monowind/vite` and the CDN's
   inline string (`scripts/vite-css.mjs`).
4. The clip: `clip-path: path(evenodd, …)` clipping paint and hit
   testing on a `div`, a same- and cross-origin `<iframe>`, a `<video
   controls>`, an `<img>`, `fixed` descendants; updating with no
   layout.
5. The measure: `getComputedStyle().width/height` under `width:
   max-content | min-content | <px>`, `box-sizing: content-box`, for
   block, flex, grid, table and inline regions, under a transform,
   with no observer reporting the transient sizes.
6. A `content-visibility: hidden` hold under the read: focus, scroll,
   a playing video and an iframe's state kept; its saving timed.
7. A top-layer `::backdrop` over a region (the region above the shadow's
   backdrop box); a native modal making the iframe inert.
8. A `youtube-nocookie.com/embed/…` iframe under the clip, the drag's
   `pointer-events: none` and a transparent border; its referrer
   (`referrerpolicy="strict-origin-when-cross-origin"`).
9. The locks' cost: `boxes`, `prose`, `positioned` with the tree's
   bundle against the last commit's — a page without a region must
   not move.

### 1. The utility, the marks, the leaf and the twin locks

Sizes the author sets; contents-based sizing is milestone 3. Done.

- `utilities.css`: `@utility mw-native { --mw-native: 1; }`, `@property
  --mw-native { syntax: "<integer>"; inherits: false; initial-value: 0 }`.
- `styles.css` (Decision 4): each lock a region's contents could match —
  universal, by element type, or under a descendant combinator — takes
  twin selectors, `mono-wind[data-mw-no-regions] …` and
  `mono-wind[data-mw-regions] …:where(:not([data-mw-native] *))`, or
  `:where(:not([data-mw-native], [data-mw-native] *))` for a lock on
  what a box holds (type, ink, wrap, pointer, selection, the `<img>`
  content lock, the controls' normalizations). Outside the lock layer,
  where an author's rule meets ours on specificity, the host marks sit
  in a `:where()`. The universal rule splits in two, its box half
  reaching the region. Flag-keyed rules keep one selector; those shaping
  a box's contents (the laid-out rule's template and alignment resets,
  the shared rule's `line-height` and rule styles, `text-indent`, the
  grid-mode cursor) skip the region in their gates. New: Decision 1's
  reset on `mono-wind [data-mw-native]` in `base`, with its
  `::selection`; Decision 3's frame in theme;
  `[data-mw-native="inline"]` → `inline-block`.
- `style.ts`: `isNativeRegion(el, cs, display?)` (`display: contents`
  ignored with a warning); `readCellStyle(…, { native: true })`: a
  block leaf's display, no columns or line clamp, `auto`/`scroll` read
  as `hidden`, no grid leading or tracking, no font-size warning.
- `types.ts`: `LayoutNode.native?: { replaced, inline }`.
- `tree.ts`: `buildElement` tests for a region first →
  `buildNativeLeaf` (no children, no text, intrinsic size 0 here; in a
  line, a replaced region aligns as an image, another to the top or
  the bottom); `collectNodes` rides one as an atomic box; `hidesBlock`
  false for one; the host's own `--mw-native` never read (`buildRoot`).
- `render.ts`: no `data-mw-clip` on a region.
- `element.ts`: `#markRegions(root)` after the anchors' rebuild:
  `data-mw-native` (`""` or `"inline"`), and the host's
  `data-mw-regions` or `data-mw-no-regions` (the latter from
  connection on).
- `native.ts` (new): the marks, `REPLACED`, `regionsOf(root)`.
- Tests: `test/native.test.ts`; `test/cascade.test.ts` (every rule
  twinned, flag-keyed or the host's own; a twin setting an inherited
  property skips the region; the reset covers each inherited lock);
  `test/element.test.ts` (the marks written and removed; no clip
  flag).
- Story: `SizedRegions` (a `srcdoc` iframe; a `font-serif` panel with a
  range input and a rounded button).
- Visual: the whole run once — no golden but the new story's moves.

### 2. The engine's walks and events

Done.

- `native.ts`: `regionOf(node, host)` (the region a node is or lies
  in, from the marks), `insideRegion(node, host)`, `lightElements(host)`
  (a walker rejecting a region's children; `querySelectorAll` on a
  host with no region).
- `element.ts`: the gating walk over `lightElements`; `#markRegions`
  releases a new region's contents (`render.ts` `releaseRegion`: every
  `data-mw-*` attribute and every variable the engine wrote, a nested
  host's subtree left be; the released taken out of the pass's gated
  set) and restores a former one's (gated, marked for interactivity,
  the tree built again); `readControls`, the textareas and
  `#hostAnimations()` skip a region's contents; `#owns` excludes them
  (the phantom and covered tests, the covers loop, `#onToggle`, the
  animation handlers); `#native(target)` — a region or its content —
  leaves to the browser the phantom press, the text-mode press, the
  wheel, the scroll key, the arrows, a field press's hold and a scroll's
  grid move; `#onTransitionRun` and `#onMediaSized` skip contents;
  `#scheduleDynamicRelayout` lays out for contents' events only on a
  press, a `change` or the edge crossed (spec deviation 4);
  `#changesRendering` ignores records in a region's contents (milestone
  3 adds auto-sized regions).
- Tests (`element.test.ts`): no engine mark in a region's contents, a
  former layout's included, through later layouts; a former region's
  contents gated and marked in the layout that frees them; mutations,
  `input`, keys and inner focus moves schedule nothing, a `change` and
  an outside `input` do.
- Story: `RegionContentsInteract` (`!dev`, `!golden`; in an engine
  scroller): a press inside isn't the engine's, a wheel over the
  region's own scroller isn't cancelled, typing into a field inside
  lays the host out no more.

### 3. Sizing from contents

Done.

- `tree.ts`: `sizeReplaced` (from `buildImageLeaf`, shared): a natural
  size's cells on the spacing scale, a ratio's height derived;
  `naturalSize`: an image's, a video's (the default object's 300×150
  px, no ratio, before its metadata), a canvas's attributes, an
  iframe's, an embed's and an object's the default object's (75×38); an
  inline SVG's and a broken image's measured instead. Flowed regions
  get a `measure` on `node.native` (`types.ts` `NativeMeasure`): the
  host's px measurer (`MeasureContents`, `BuildContext.measureContents`,
  `buildRoot`'s and `buildTree`'s last parameter) through the measured
  cell, `ceil(px / cell − 1e-3)`.
- `layout.ts`: `intrinsicInnerWidth` asks the measure at min- or
  max-content; `layoutTextLeaf` asks it for the content height where
  the height is not definite or a ratio's floor needs it — a region its
  author sizes is measured only for a flex item's automatic minimum
  width; `widthContribution`'s compressible
  replaced boxes take replaced regions.
- `element.ts` `#measureContents`: `data-mw-native-measure` and
  `--mw-measure-w` on the region (under its measuring flag), a
  `getComputedStyle()` read; px cached per region and width, kept for
  the regions a layout measured (`#keepMeasures`), dropped where a
  mutation lands in, on, or (an attribute) around a region
  (`#forgetMeasures`), where a measured region's element child resizes
  (`#onResize`, the host's ResizeObserver: fonts, images, transitions,
  viewport units inside), on fonts loaded and window resizes; a
  measured region's mutations lay out (`#changesRendering`); a video
  region's `loadedmetadata` and `resize` lay out.
- `styles.css`: the measure rule (absolute, the width asked, height,
  min/max, ratio, padding, border and margin cleared, content-box), its
  `@property --mw-measure-w` not inherited.
- Tests: `native.test.ts` (a fake measurer: replaced sizes, shrink to
  fit rounded up, a block filling unmeasured but for its height, a
  sized region unmeasured, a flex item's min-content, a ratio floored at
  the contents, an SVG measured, compressible replaced regions);
  `element.test.ts` (a measured region's mutations lay out, a sized
  one's not).
- Story: `AutoRegion` (`!dev`, `!golden`): text rows snug, a transition
  inside followed to its end.

### 4. Paint: the region in the paint order

Done.

- `stacking.ts`: `PaintVisitor.native(node)` at `contentOf`, beside
  `picture`; `paintIndex` a `"box"` entry there, so the hit answers the
  region over the blocks' ink before its contents.
- `plain-text.ts`: `PaintedLayer.picture` became `surface: "picture" |
  "region" | null`, with `whole`; the painter's `native(node)` opens a
  region surface over its border box (the picture's machinery: later
  ink's covers, through groups and nested layers); a backdrop, at its
  top-layer element's `enter`, marks the region surfaces before it
  whole.
- `native.ts`: `regionClip(surface, cell)` (pure: each row's run of
  covered cells a rectangle cut from a plane past any overflow, in px of
  the border box, `path(evenodd, …)`; `inset(50%)` whole; null);
  `clipRegions(regions, surfaces, cell)` and `clip(el, path)`
  (`data-mw-native-clip`, `--mw-clip`).
- `paint.ts`: region surfaces get no shadow nodes; `paintGrid` hands
  the surfaces to `options.surfaces` before the rows, which a press may
  hold.
- `element.ts`: `#paint` clips the regions at every paint; an unmarked
  region's clip lifted.
- `styles.css`: `[data-mw-native-clip]` → `clip-path: var(--mw-clip)
  !important`, gated, before force-hidden; `@property --mw-clip`.
- Tests (`native.test.ts`): covered by later ink, a block's background
  before the contents not, the hit the region's there; through a
  translucent box and a layer; region-local px under a scroll; a
  backdrop's whole cover; run merging; the content box blank.
- Stories: `MenuOverRegion` (golden: the item, the menu's own box the
  grid's, the text around it the region's), `DialogOverRegion` and
  `RegionScrolledUnderHeader` (`!dev`, golden).

### 5. Interaction: pointer, selection, copy, focus

Done.

- `styles.css`: `mono-wind[select="grid"] [data-mw-native-drag]` and
  its descendants `pointer-events: none !important` (unlayered), the
  region's own flag, as Blink restyles a descendant rule's whole
  subtree wherever its attribute flips; the cascade test's region rules
  take it.
- `selection.ts`: `classifySelection` answers `"native"` for a range in
  one region (from the marks, before `"light"`); `pageAround` is the
  range split at the host over `renderedLines`; `collectItems` copies
  an image or a region through `surfaceText` (alt, region text, or in
  grid mode its cells).
- `rendered-text.ts`: `renderedLines(range, root, part)`, the page-text
  walk `pageAround` had (a `part` callback for hosts).
- `native.ts`: `regionText(node, range?)` (a region `<img>` its alt,
  other replaced nothing, flowed its rendered lines, all of them
  without a range); a copy writes a replaced region's as an image's
  alt, a flowed one's from its first row (`plain-text.ts` `textArea`).
- `image.ts`: `altLines` became `cellLines(text, columns, rows)` (each
  of a text's lines wrapped, then cut); `altArea(node)`.
- `plain-text.ts`: the painter's `picture` and `native` share
  `surface(node, kind)`, writing the text in `textArea` under
  `RenderOptions.alt`;
  `imageRows` became `textRows` (an image's or a region's).
- `paint.ts`: `LayerSet.regions`, each region's content cells in the
  grid holding them (`contentIn`, shared with the picture); `gridCopy`
  takes over where a grid span covers a picture's or a region's cells.
- `element.ts`: `#copyText` leaves a native selection's copy to the
  browser; `#lightSelection` none of it; `#reachesLight` only for
  `"light"` and `"outside"`. Arrows on or in a region were already the
  browser's (milestone 2).
- Tests (`native.test.ts`): classification (marks as of the last
  layout); a light copy across a paragraph and a region; a region
  `<img>`'s alt, an iframe nothing; the copy render's region lines,
  wrapped and cut; a grid-mode copy's cells. `image.test.ts`:
  `cellLines` keeps a text's lines.
- Stories (`!dev`, `!golden`): `GridDragAcrossRegion` (a flowed region
  and a frame, the drag's pointer, the grid under it),
  `CopyAcrossRegion` (both modes; a selection inside, no lock, an empty
  copy), `TabThroughRegion` (the contents' own focus ring),
  `ArrowsInRegion` (native inside; the host's navigation passes over
  the contents). Real input: `pointer.spec.ts` (a click on the menu
  item over a region; a grid drag across a frame),
  `keyboard.spec.ts` (Tab into a `srcdoc` frame and out; Firefox stops
  on the frame's document first, as on any page).

### 6. Nesting

Done.

- `element.ts`: `#nested` is the marks' answer — the nearest of a host
  and a region mark above the host being a host — read at connect, and
  again by `#settleNested` from the outer host's `#settleNesting`,
  after each of its layouts' marks, before its restored contents are
  read again; the warning waits for that settle (the page's styles
  applied). `data-mw-nested` (`NESTED_MARK`) on a nested host.
  `#start()` is connect's engine-on half; `#stop()` turns a host off
  where its region goes: its listeners, its pending frame, its probe,
  what it wrote on its light DOM and on itself (`releaseContents`,
  `release`), its `:host` rule, its paint (`clearPaint`), its write
  caches. The cell variables go through `setVar`, so `release` takes
  them back. The outer host drops a running inner host's mutation
  records (`#ofInnerHost`), its own to hear.
- `render.ts`: `releaseRegion` became `releaseContents` (skipping a
  running host, a nested one's contents the outer host's own writes)
  and `release(el)`; `clearUnwritten` leaves region contents, an inner
  host's writes.
- `selection.ts`: `classifySelection` reads a point through the
  shadows of the host's descendants (`lightNode`), so one in an inner
  host's grid is in its region.
- `styles.css`: the host visibility rules key on
  `:not([data-mw-nested])`.
- `agreement.spec.ts`: every running host, its own boxes alone.
  `host.stories.ts` `Nested` asserts `data-mw-nested`.
- Tests (`element.test.ts`): runs in a region as the marks stand;
  stays off in none, warned once the outer host lays out; turns off
  where its region goes, everything it wrote taken back, and on again;
  the outer host leaves its writes and records (each guard seen
  failing without it). `native.test.ts`: a selection in an inner host's
  shadow is native.
- Story: `NestedHost` (golden: an inner host at `text-xs`, its own grid,
  the region its rows).

### 7. Stories and goldens (`apps/storybook/stories/native.stories.ts`, `Features / Native regions`)

Done.

1. **`NativeImage`** (golden; the user's): `<img class="mw-native">`
   beside a plain `<img>` of the same picture — one canvas, the plain
   one's; the lock's `content` on the plain one alone; the same cells.
2. **`Video`** (`!golden`; the user's): the `youtube-nocookie.com`
   embed of Big Buck Bunny (`aqz-KE-bpKQ`, checked against YouTube's
   oEmbed), `aspect-video w-full` in a bordered card; its play checks
   the frame alone.
3. **`NativeText`** (golden; the user's): `font-sans` and `font-serif`
   paragraphs in a bordered region, and a `w-fit` one — the fill and
   font native, rows and columns the content's rounded up.
4. **`Regions`** (golden): a `srcdoc` frame, unsized (75×38 cells), and
   a native-text panel between the grid's heading and text.
5. **`RegionToggled`** (`!dev`, `!golden`): `mw-native` off locks the
   contents and draws them in cells; back on frees them.

The stories measure content boxes in fractional px (`contentBox`):
`clientWidth` rounds, which read a cell's slack as overflow in WebKit.
Preflight makes replaced elements blocks, so their regions' marks are
`""`; `expectOnCells` checks a box against the grid's cells wherever
its parent lies (`expectOnItsCells` reads the local `--mw-x`).

### 8. Docs, benches, verification

Done.

- Specs: `native-regions.md` implemented — the utility's ignored
  cases, the clip's two limits and an inline region's alignment as
  deviations 5 and 6, the nesting, testing and touch points;
  `cell-model.md` (host sizing, the drag's sweep, the font lock),
  `images.md` ("Sizing", "Later", touch points), `layers.md`,
  `positioning.md`, `scrolling.md`, `semantic-selection.md` and
  `focus-navigation.md` a sentence each.
- `core-architecture.md` D3 a paragraph; `packages/core/README.md`
  "Native regions"; `performance.md` "Native regions (2026-10-03)".
- Benches (Chromium 153, `754e3ad`'s bundle against the tree's, three
  alternated rounds, retaken after the review): boxes and positioned
  level within their rounds' spread, prose +2.4% load and a prose
  relayout about +2% — their style recalc, the twins' region halves as
  measured when they were chosen; layout level. `pnpm bench --shape
  native` (new): 470 ms to interactive for 300 regions, every one
  measured.
- Verification: `pnpm check` clean; `pnpm test` passed (960 stories,
  every smoke); the stories on Linux in the Playwright image (a fresh
  install there) passed, 960; the real-input specs in three engines;
  the full visual run.

## Risks

- The twins' cost on a page with no region (probe 9, the benches), and
  a lock added later without its twin (`cascade.test.ts`).
- An inherited lock missed by the reset: invisible or dead contents in
  one engine (probe 1, a story asserting each property in every
  engine).
- Forced layouts for measuring, and a stale generation cache (the
  region-child resize observer the net; nested hosts and big widgets
  the stress case).
- Clip lag: the clip follows paints, a frame behind compositor
  scrolling (spec deviation 2); a layer moved by transform covers on
  its layout cells (`layers.md` deviation 7).
- An engine failing iframe hit testing under `clip-path` (probe 4):
  its covered cells documented as a deviation.
- Feedback loops between nested hosts (both change-checked; layouts
  counted in the stories).
- The YouTube story offline or blocked in CI: `!golden`, its play
  independent of the load.

## Found on the way

- **Probes 1–5** (Chromium, Firefox, WebKit, 2026-10-02): `@scope` and
  its lower bound hold inside `@layer`, `@media` and `@layer` nest
  inside `@scope` (moot since Decision 4's revision); the reset in
  `base` restores each inherited lock; only `Highlight`/`HighlightText`
  restore a region's highlight in Chromium and WebKit (`revert`,
  `revert-layer`, `initial` stay transparent); `clip-path: path(evenodd,
  …)` clips an iframe's hit testing; Lightning CSS 1.32–1.33 keeps
  `@scope` whole, old targets included. The measure:
  `getComputedStyle()` width and height under `max-content`,
  `min-content` and a px width agree across engines for block, flex,
  grid, table and inline regions, a transform ignored, no ResizeObserver
  reporting the transient sizes, ~0.3 ms a read.
- **`@scope`'s cost, and Decision 4's revision** (probe 9, Chromium's
  `bench.mjs`, the last commit's bundle against the tree's, medians):
  the scoped stylesheet cost every page — prose style time 55 → 81 ms,
  load 195 → 225 ms; positioned +6%, boxes +3%. Neither the lower bound
  (no `to`: the same), `&` for `:scope` (the same) nor one `@scope`
  holding every rule (+19 ms) helped: a scoped rule matches dearer than
  a plain one, ~50% in Chromium and ~120% in WebKit in a micro-probe
  (WebKit also losing the ancestor filter's fast reject on scoped
  descendant rules); Firefox flat. Undoing the locks inside a region
  instead fails: `revert-layer` from the theme layer's important
  declarations reveals no author's plain declaration (probed in Chromium
  and Firefox). The twins, then: a `:where()` host condition cost +5 ms
  of prose style time — a negation, or `:where()` around even a plain
  attribute, leaves the style engines' fast path — and a plain attribute
  +1.9 ms, the region's own rules (the universal lock's split, above
  all) +1.2 ms of it. Final: prose style 56.0 → 58.9 ms (+5%), load
  ~+4%; positioned style +6%, load +3%; boxes within the noise. The
  host's mark, an attribute, ties each twin with the flag-keyed locks
  overriding it, which all follow it in the file — but in `base` and the
  unlayered rules it would also outrank an author's rule of one
  attribute more than ours (`@layer base { .field {…} }` against the
  controls' normalization), so there the marks sit in a `:where()`, at
  no measurable cost (prose style time within the noise of the plain
  marks').
- **The reset's list**: the multicol lock's `orphans` and `widows`
  inherit into a region too; the cascade test now classifies every
  inherited property a lock sets (`cascade.test.ts`).
- **Tailwind's preflight strips a button's chrome**, a region's
  included: the stories show native chrome with a range input.
- **Counters count a region's contents**, as CSS does — a list item in
  a region numbers the list around it — so the counter walk goes
  through regions (the plan had it stop there).
- **A press on a region's own element is native** (its frame and
  padding, where its scrollbar lies), not a grid press; a grid drag
  started on its border cells waits for milestone 5's drag across
  regions.
- **`selectstart` in a region still locks the host's highlight**: the
  lock skips the region's contents, and a drag leaving the region needs
  it on the light DOM it reaches.
- **The measure cache follows what can change a region's contents**
  rather than one generation every layout-scheduling record bumps: a
  mutation anywhere in the host would otherwise re-measure every region
  (a forced layout each) — a ticking clock beside a widget.
- **A region whose contents keep changing size** (a box animating its
  height inside) relays its host out every frame of it, through the
  resize observer: the README's "size heavy regions" covers it.
- **The host's own intrinsic widths** (its spacer track) ask every
  auto-width flowed region's min- and max-content, block ones included:
  two measures per region, cached.
- **The clip's names live in `native.ts`**, not `render.ts`: a former
  region stays a box, which `render()` writes on and so never clears;
  `#markRegions` lifts its clip as it unmarks it.
- **`clearUnwritten` leaves region contents** (milestone 6): a new
  region's stale box flags go with its release, and what lies in one
  after is an inner host's.
- **An inner host relays out when the outer host restyles a box around
  it**: its ancestor observer hears every `style` write on its
  ancestors, the region's clip included — a menu moving over the region
  relays the inner host out. Rare enough to leave.
- **The review (2026-10-04)** found and fixed, each with a test seen
  failing without its fix:
  - the drag rule's universal subject under the host's flag, which
    restyled every host's whole subtree as a grid drag began or ended
    — the flag is the regions' own now, and a cascade test forbids
    the shape;
  - the clip a scroll's or a sample's repaint writes, which laid the
    host out again;
  - a former region's contents a new region around them holds, left
    gated;
  - the sampling loop a stopping host kept;
  - measures kept across a cell, a stylesheet or a surrounding change;
  - input on a region that is a field itself, and an inner host's
    scrolls, reaching the outer host;
  - an inner host's region taken for the outer host's;
  - a hidden region left unclipped;
  - the variables a page's `style` write made `release` forget;
  - the keywords a stopping host reflected;
  - a host that is a region itself taken for a nested one;
  - an authored `pointer-events: none` above a region, which the reset
    overrode in grid mode;
  - an author's offsets on a region it measures.

  The cascade test checks each twin both ways, per part, and the skip
  each lock's kind takes (what the grid draws for a region's box, its
  contents alone; the rest, the region too). Left: an inner host
  relays out on the outer host's writes around it (above); a region
  moved out of any host keeps its mark until its host lays out; a
  press on a field in a region lays the host out under it, as a
  region's press does, which no test drags through in Firefox yet.

- **A performance pass (2026-10-04)**, `performance.md` "A performance
  pass": `:is()` subjects split into lists, the background-gap rule
  keyed in the shadow, glyph reads through accessors, regions collected
  as the tree builds, and cleared measures taken again together — the
  twins' cost taken back on relayouts, a resize's re-measure of many
  regions cut to a few forced layouts.
- **A last review (2026-10-04)**, each fix's test seen failing first:
  an inner host that is a region itself, its own box's change unheard
  by the outer host; a region moved to another host unmarked by the
  first; an author's keyword a stopping host took back; a host that
  ran, moved into no region, left running; a stopping host's regions
  left unmarked as the outer host's; a moved region's measure kept; a
  `pre`, a textarea or a link region reset past the browser's own
  sheet; a hidden image region's alt copied. The cascade test holds
  every lock, a twin or keyed on a flag, from setting what a region's
  contents inherit. And the images work's: a still read from its bytes
  kept at a scale its place no longer asks (a box grown less than
  twice, or one read before the font settled the cell), which the
  gate's Image Grown flaked on in Firefox.
- **A final review (2026-10-06)**, each fix's test seen failing first:
  `mw-native` on a `<mono-wind>` dropped at the user's choice (ignored
  with a warning; a region holds a host instead), which took five
  defects with it; the region's drag flag renamed `data-mw-native-drag`,
  as Blink restyled the host's whole subtree at each drag's start and
  end through the region rule's `*`; an element moved into a region
  released; a host in a region of a host turning off started again as
  the outer host's; a host that ran judged by `#started`, not its probe;
  a keyword set while off checked as it starts; the measures a layout's
  own drain takes made stale; a press or an edge crossing tested to lay
  the host out; a list item region's marker hung outside it and its
  native one suppressed; the reset's cursor grid mode's alone, and the
  browser's own kept for controls and `select`; no white-space flag on
  a region; a copy's blank lines, a field's value, `pre-line` and
  no-break spaces, a hidden replaced region in grid mode, and a host
  running in a region its own part; a grid copy's indents kept; an
  input button region's `user-select` the browser's. Grid mode's
  selection under an authored `user-select: none`, the grid's text's as
  much as a region's, recorded as a `semantic-selection.md` deviation.
- **Firefox stops Tab on a frame's document** before its first control,
  on any page: the real-Tab spec takes the extra press there.
- **A host's arrows pass over a region's contents**, which the layout
  does not know (Tab reaches them).
