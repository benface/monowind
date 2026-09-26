# Wide characters, fallback glyphs, and the grid-painted selection

Status: **implemented** (2026-09-05; plan:
`.agents/plans/2026-09-05-wide-characters.md`; auto-scroll and the
box-bounded nearest-unit search 2026-09-06). Carries cell-model.md
deviation 10 (glyph widths are the `wcwidth` table's) and the
grid-painted selection. Two findings from the implementation: a
glyph box measured while a web font was still loading must be
forgotten when the font lands (the
fallback's advance was cached under the same font name — the theme
gallery boxed its borders in the sweep), and a `Range` rect around a
boxed span unions the scaled text inside it, so alignment checks read
the span's own box.

## Why

An engine that counted one cell per UTF-16 code unit and let the
browser draw every glyph at its font's advance would go wrong twice,
and the two are one problem:

- **Glyphs the primary font lacks come from a fallback font at that
  font's own advance.** A CJK ideograph or a Hangul syllable takes one
  cell in the layout and paints across 1.4–1.7; an emoji takes two code
  units and paints 2.1–2.3 cells; a star (★, U+2605), a check mark, a
  heart, ⌘, and any symbol outside the monospace font paint at 0.8–1.3
  cells. From that glyph on, the row is off the grid: text drifts,
  borders zigzag against the rows above and below.
- **Whatever the grid does about it, the transparent native text under
  the grid keeps the font's advances.** Left alone, the two drift
  together on a line, so a text-mode highlight sits on the glyphs you
  see — until the native text wraps at a different point than the grid, which a
  paragraph of narrow-drawn ideographs does within a few lines: from
  there the native rows and the grid rows disagree, and a press lands
  on a character rows away from the glyph under the pointer. Fix the
  grid alone and the highlight sits beside the glyphs on every drifted
  line — a worse look than the drift. The native layer cannot be fixed:
  a text node has no per-glyph width control, and `font-size-adjust`'s
  `ic-width` scales the primary font along with the fallback (probed:
  `M` grows to 1.2 cells).

So the grid must own both the glyph and the highlight.

## Probe results (2026-09-05, this machine, Chromium / Firefox / WebKit)

Advances in cells (the advance of `M`), with the CDN default stack
(`ui-monospace`) and Storybook's JetBrains Mono, both falling back to
system fonts for these glyphs:

| Glyph                     | Chromium  | Firefox   | WebKit    |
| ------------------------- | --------- | --------- | --------- |
| 中 (CJK ideograph)        | 1.69–1.70 | 1.70      | 1.61–1.67 |
| 한 (Hangul syllable)      | 1.44      | 1.44      | 1.40–1.44 |
| 😀, 👨‍👩‍👧 (ZWJ), 🇯🇵 (flag)   | 2.08      | 2.18–2.19 | 2.19–2.33 |
| ﾊ (halfwidth katakana)    | 0.83      | 0.83      | 0.75–0.83 |
| é, é (combining), →, ─, █ | 1.00      | 1.00      | 1.00      |

Canvas `measureText` and DOM rects agree to the pixel. Fonts differ per
engine and machine; none give whole cells for these glyphs. With
`font-size-adjust: ic-width` set for a two-cell ideograph, 中 lands on
2.00 in all three engines but `M` on 1.19–1.24: the primary font is
scaled too, so that road is closed.

In the Docker sweep image (JetBrains Mono self-hosted, WenQuanYi Zen
Hei Mono and Noto Color Emoji as fallbacks): 中 한 ★ ♥ at 1.60
(Chromium) / 1.67 (Firefox, WebKit), 😀 at 2.00 / 2.08, ﾊ at 0.80 /
0.83, ✓ ⌘ é ─ █ at 1.00. The boxed set therefore differs by engine and
machine (★ is 1.00 in Menlo, 1.3 in JetBrains Mono on macOS, 1.6 in
the sweep; an emoji is exactly two cells in the sweep's Chromium): tests
assert cell alignment, never which clusters got boxed.

Block probe (2026-09-05, `scratchpad/fill.mjs`): at 14px in a 16px
row, Menlo's `█` measures 14.27px tall (SF Mono 14px in 17px; JetBrains
Mono 19px in 18px), its `│` 17.84px; a span scaled 16 ÷ 14.27 with
`line-height` set so the ink starts at the row's top covers the row in
all three engines within a pixel, the halves meeting at the middle.

Boxing probe (2026-09-05, `verify/box.mjs`): an inline-block span of
`cells × cell width`, `vertical-align: top`, `line-height` pinned to the
cell, `overflow: hidden`, with a scaled `font-size`, inside a `<pre>`
with the same pinned line-height keeps every row at one cell and the
next glyph on its cell in all three engines; the glyph's font box is
centered on the row within half a pixel; a native selection over the
row includes it (`"ab中cde"`). Ink at the fill scale: 中 fits (0.92–1.0
rows), 한 at 1.39–1.43× touches or crosses the row (0.99–1.07), 😀 at
0.86–0.96× is taller than the row (0.95–1.16) and wider than its
advance — hence the ink cap below. `Intl.Segmenter` walks 100 KB of
mixed text in 6 ms (Node 26, Unicode 17); the ASCII test costs 0.1 ms.
After a `preventDefault`ed mousedown that blurs the active control and
sets a programmatic range, Shift+ArrowRight extends the range and a
copy event sees it in all three engines.

Tiling probes (2026-09-05 to 2026-09-21, the three engines on macOS
unless named):

- Rows against glyphs: Menlo and SF Mono draw `█` 14.3px and 14px tall
  in the 16px and 17px rows their `line-height: normal` makes, so
  every row of blocks gaps (the scrollbar's track and thumb included);
  Monaco's `│` is 11.9px in a 19px row; Firefox's rows for Courier New,
  Andale Mono and PT Mono are a pixel taller than their `│`; a
  `leading-*` on the root makes the row taller than any font's glyph.
- The pin: unpinned by a measured baseline, a box seamed half a pixel
  in Chromium and left Firefox's top row half bare; box drawing
  centered on the row instead of pinned to its baseline moved a pixel
  up in WebKit and half a pixel down elsewhere, and a line of text in
  a box looked off its middle.
- Past the row: JetBrains Mono's `█`, 19px in an 18px row, and
  Menlo's `│`, 17.8px in 16, overlap at every joint; Menlo's stem in
  Chromium, unboxed, is 62% darker at the joint than along the row at
  1×, 14% at 3×, which is why a zoom hides it.
- One text run of `─`: SF Mono at 2× takes the stroke's top edge row
  from 148 to 92 of 255 at each joint (plain text's borders always had
  these dots). A shared `█` run: Menlo at 2× in Chromium, the row's
  top row from 180 to 127 of 255 on the joint's columns.
- The overhang floor, swept glyph by glyph at 1×, 2× and 3× (a run of
  boxes at a sweep of scales, read back for a column lighter than the
  stroke's own darkness): Chromium wanted 0.27 CSS pixels at 1× and
  0.36 at 2×, WebKit 0.41 at 1×. At 0.25 a bordered box's top edge
  dips 33% of its darkness at every joint in Chromium at 2×; the
  default font's `─` overhangs 0.277 unscaled and does not close a
  joint on its own, and the floor costs its borders 3.9% of scale.
  JetBrains Mono's `│`, 21px in an 18px row, would shrink to 0.987
  without the floor of 1.
- Centering: `text-align: center` left one joint in six a fraction
  short of the clip's edge column, a lighter column through the stroke
  (SF Mono at 2× in Chromium, 41% of the ink; Firefox at 1× too).
- Moiré: Chromium's scrollbar tracks, twice over, with a shade at an
  arbitrary scale.

## Locked decisions

### Widths and units

- **Widths come from a table, not from the font.** A grapheme cluster
  is 2 cells when it is East Asian Wide or Fullwidth (CJK ideographs,
  Hangul syllables, kana, fullwidth forms, CJK punctuation, …) or an
  emoji with emoji presentation (`Extended_Pictographic` with
  `Emoji_Presentation`, a U+FE0F variation selector, a ZWJ sequence, a
  keycap sequence, or a regional-indicator pair), and 1 cell otherwise
  — the `wcwidth` convention every terminal uses. The layout is
  therefore deterministic across engines, machines, and fonts, the Node
  renderer needs no font, and a copy pastes into a terminal at the
  width the grid showed. One cell each: ambiguous-width symbols (★ ✓ ♥
  →), halfwidth katakana, text-presentation emoji (♥, ↔ without
  U+FE0F) outside the East Asian Wide blocks (〰 and ㊗ are two). Zero
  cells: a cluster made only of default-ignorable or
  control code points (a zero-width space, a soft hyphen, a lone joiner
  or variation selector), which stays in the text and the copy, costs
  no cell, and paints nothing.
- **The grapheme cluster is the unit.** Runs are collected per cluster
  (`Intl.Segmenter`, grapheme granularity; a fast path skips
  segmentation for ASCII-only text): a combining sequence, a ZWJ
  family, a flag, a keycap are one unit with one width, painted at one
  cell and never split by a wrap, a truncation, or a gesture.
- **Per-character data is indexed by code unit, like `text`.** A
  leaf's `advances` and `charInline` line up with `text`, `charSource`,
  and every line span: a cluster's width sits on its first code unit
  and its remaining units carry an advance of 0, a shape the
  machinery handles — `advanceOf` sums, the wrap's
  cell-boundary break and the ellipsis cut cannot stop inside a cluster
  because its tail costs nothing, `charIndexAtCell` reports the
  cluster's first unit for any of its cells, and `positionOf` maps that
  unit to the DOM.
- **Form controls use the same widths for their estimates.** A
  textarea's row count and an input's intrinsic width count clusters at
  table widths; the native control still renders its own value.

### The grid stays on its cells in any font

- **A glyph the font does not draw at its cell count is boxed and
  scaled.** The DOM adapter measures each distinct non-ASCII cluster
  once per grid font — family, size, weight, and style, since a bold
  fallback can advance differently — with canvas `measureText`, cached
  for the host's life, and, when the advance differs from its table
  width by more than 0.01 cell, paints the cluster as an inline-block
  span of exactly its cells, top-aligned and centered horizontally,
  with a `font-size` scaled so the glyph fills the box (cells × cell
  width ÷ measured advance) — capped so its ink, measured with
  the same `measureText` call, stays inside the row and the box: a
  1.7-cell ideograph fills two cells, a 2.3-cell emoji shrinks until
  its ink fits two cells by one row, a 1.3-cell star fits in one, a
  Hangul syllable stops short of two cells and sits centered. Nothing
  overflows into the next cell; `overflow: hidden` is the safety net
  for ink the measurement missed. Clusters the font already draws at
  their width (a 2:1 CJK font, the primary font's own symbols) need no
  box, so a well-chosen font costs nothing extra. The decision is the
  adapter's: the paint model takes a `boxed(cluster)` predicate from
  the caller the way it takes the selection, and the Node renderer
  passes none.
- **That measurement is the one way past a box, and it is the
  cluster's own.** A range's fit below is measured from its reference
  glyph, and a reference says nothing about a cluster the FONT HAS NOT
  GOT: the VGA bitmap fonts the dos, dos-blue, green-phosphor, amber,
  and bbs themes wear draw `│` and `─` on the cell and have no arc at
  all, so `borders-rounded` on them falls back to another font at
  9.633px in an 8px cell. Left unboxed on the range's behalf, two arcs
  carried 3.27px of drift to every box after them on the row while the
  rows above and below stayed put. So a cluster whose own advance is
  off its cells is boxed whatever range it belongs to, and a fit taken
  from a reference is returned only when it exists — a range that
  needs none leaves each of its clusters to the measurement above.
  A box cannot overflow (its width is its cells and it clips), so this
  gate is the whole of the grid's promise that a run keeps its
  columns. It is the BACKSTOP, not the cure: those five themes now
  declare the arcs missing (theming.md), so the corner falls back to
  one the font draws and never reaches a box at all — the gate is what
  holds the grid together for a gap nobody declared. The
  Test / Themes "Glyph Sets On Every Font" story holds
  every set against every period font for it.
- **Tiling glyphs fit their row.** Block Elements (U+2580–U+259F:
  `█ ▀ ▄`, the quadrants) and Box Drawing (U+2500–U+257F) are the
  glyphs meant to abut, and a font's line box need not match them
  ("Tiling probes"). The adapter measures each range's reference glyph
  once per grid font — `█` for blocks, `│` for box drawing. Where the
  font draws it past the row or off its cell width, every glyph of the
  range is boxed with the one transform; so is every block where the
  font draws `█` short of the row, its `font-size` scaled until the
  glyph is a pixel and a half taller than the row on each side, since
  a block stands for a cell filled. A stroke short of the row keeps
  the size the font gives it, and its rows gap: that growth would make
  it as much bolder as the row is taller than the glyph, a hairline
  border a bar at a raised leading. A glyph the font draws at the
  row's height, within a twentieth of a pixel, is left alone.
- **One transform per range** keeps a junction's strokes on its
  neighbors': box-drawing strokes sit at the glyph's center and edges,
  which a uniform scale about the box's center preserves. A block pays
  for it in ink as much bolder as the row is taller than the glyph.
- **The box is pinned to the row.** A `line-height` on the box places
  the baseline at half-leading plus the font's ascent, both from the
  same `measureText` call; engines round a scaled font's metrics their
  own way, so the host measures the baseline the engine actually gives
  that box (an empty inline-block's top) and corrects the line-height
  by twice the error, stepping until the nearest lands where the engine
  snaps a baseline to whole pixels (Chromium; WebKit and Firefox place
  it fractionally). The box is a row tall and clips the overshoot. Box
  drawing is pinned to the row's own baseline, the one the host
  measured, so a border sits where the font sets it against the text;
  a filling glyph hangs its ink a pixel and a half past the row's top,
  so the blocks' halves meet at the row's middle and a shade raised to
  its lattice lands as it did in the row above. A box takes that same
  pin where the host measured no baseline.
- **A shade keeps its lattice.** `░ ▒ ▓` are periodic by design, and
  an arbitrary scale resamples a lattice into moiré. A shade takes the
  same fit with its scale raised to the nearest factor that makes its
  period a whole number of device pixels, so every dot rasterizes
  alike — the period read off a rendering, the first peak of the
  alpha's autocorrelation down the glyph's most patterned column. Its
  box carries the lattice on from row to row: the box's
  pseudo-elements draw the glyph in the box's line box moved down by
  the row's phase — less than a period — and a period above that, each
  clipped to the strip it fills, so every pixel of the box is drawn
  once, as the browser draws the glyph, whatever its color. The box's
  own glyph, pinned as any tiling glyph's, is transparent: the text a
  selection and a copy read. A zoom, which moves the device pixel
  ratio, refits. A fallback font's double-width block clips to its
  cell instead of shrinking to half a row.
- **A glyph drawn past the row is boxed too.** It tiles, but its rows
  overlap, and the two antialiased edges over each other paint a
  darker band along every row's edge. The box clips each row to its
  own slice, so the strokes meet on one edge, and a shade takes its
  own fit once the blocks take one, its lattice locked as where they
  fall short.
- **A stroke is boxed one per cell, by design.** A run of `─` in one
  text run overdraws itself at every joint — a font draws the line
  past its advance so joins never gap, and two antialiased ends over
  each other darken the stroke's edge rows into a dot per cell — and
  only the box's clip, snapped to device pixels, keeps each glyph's
  ink to its cell; nothing in one text run can, at any letter-spacing.
  The price is the row's nodes (performance.md "Tiling glyph boxes").
- **A run of one full-width band shares a box.** `▀`, `█`, the lower
  eighths and `▔` (U+2580–U+2588, U+2594) draw the same ink at both
  edges of the cell, so the ink one pushes into its neighbor is ink the
  neighbor draws there anyway: repeats of ONE of them, on one paint,
  take a single box of their cells, the glyphs kept on their cells by a
  `letter-spacing` of the cell less the advance and placed by the same
  `text-indent`, halved per cell. The overdraw then shows only where
  the band's own antialiased edge row meets a joint. A half, a
  quadrant, a shade or a stroke keeps its own box: their ink would
  spill into what the neighbor leaves blank, or rasterize differently
  at every phase. A band drawn translucent, by its color or its span's
  opacity, keeps its own box too, the ink it pushes into its neighbor
  otherwise composited twice.
- **The joints close.** The scale never leaves the range's widest ink —
  box drawing's `─`, the blocks' own reference — short of 0.45 CSS
  pixels past each of the cell's edge columns, nor below 1: a glyph at
  its own size can leave the edge column part bare, and one taller
  than the row would otherwise shrink. CSS pixels, not device ones:
  what closes a joint holds roughly steady in CSS pixels while a
  device-pixel floor thins as the screen gets denser, and 0.45 clears
  every case the sweep measured, with no margin to spare. The glyph is
  placed by a `text-indent` of half the room its advance leaves in the
  box, not `text-align: center`, whose rounded line position leaves
  some joints a fraction short of the clip's edge column.
- **A layer that resamples its cells drops the past-the-row box.** In
  a scaled, rotated or skewed layer a transform never moves layout, so
  the pin holds, but each box's clip edge lands between device pixels
  and is antialiased, a lighter seam at every row that the
  overshooting glyph covers unboxed (a border's stems fell away from
  its corners in a `scale-150` layer); so a glyph drawn past the row
  keeps the glyph the font gives it there (specs/layers.md). The short
  and off-width fits keep their box and pay the seam, having no glyph
  that covers the row, and a glyph both past the row and off its cell
  width keeps its box everywhere, the width fit being needed either
  way. A line glyph drawn translucent keeps a box there for its color
  or opacity (cell-model.md "Opacity and translucency") but not the
  past-the-row fit: the font's own glyph, centered in its cells. A
  layer inside a resampling one resamples too, its box a child
  of theirs. Every other layer takes the box: one that only stacks (a
  dialog's, a popover's), one a filter opens (a blur, a backdrop
  blur), one a translation moves, and one resting at an identity are
  all the host's grid in every way that matters here. The layer's read
  marks it (types.ts `resampled`), off the effects it already reads,
  so the paint reads no style of its own. Two limits: a transform
  ABOVE the host resamples the main grid and nothing weighs it, and a
  layer in transition keeps the decision of the paint before it, the
  settle repainting at the final value.
- **Rows cannot grow.** The grid's `line-height` is pinned to the
  measured cell height so a fallback font's taller line box (emoji
  fonts, some CJK fonts) cannot push the rows below.
- **Continuation cells are empty, and a broken cluster is blank.** In
  the plain-text grid a wide cluster occupies its first cell and its
  continuation cells hold the empty string, so a row joins to the
  visible text and a terminal renders it at the same width. A cluster
  that loses any of its cells — a later paint over a continuation cell
  (a border through a wide glyph), a clip edge or a truncation cut
  through it — becomes one space per cell, the way a terminal blanks a
  half-overwritten wide character. A row is always exactly `width`
  cells.
- **Cell ↔ text offset in the grid is a map, not arithmetic.** A padded
  row is `width` cells but any number of code units once it holds a
  wide cluster or a multi-unit one (a combining sequence is one cell),
  so the DOM adapter keeps, per painted row, the code-unit offset of
  each cell; the engine's grid drag and the selection restore resolve
  cells through it instead of `row × (width + 1) + col`.

### The grid paints the selection

- **A light-DOM selection is painted on the grid, not by the browser.**
  Whenever the document selection has a range in the host's light DOM
  (`select="text"`, a semantic gesture in either mode, a keyboard
  extension, a select-all reaching in), the engine maps the range to
  cells — the leaves the range intersects, their character ranges
  through `charIndexAt`, their cells through the paint's own
  character-to-cell walk, a renderer leaf whole — and paints those
  cells as REVERSE VIDEO: each cell's own color and background swap,
  the theme's `--mw-fg`/`--mw-bg` standing in where the cell has none.
  Plain text therefore highlights as the theme invert; colored text
  highlights as a band of ITS color with theme-background glyphs (an
  emerald banner selects emerald, not black), where a `::selection`
  rule would paint every element with the theme colors; and a
  focus-inverted control re-inverts under selection with no special
  case. The light `::selection` sites — styles.css's rule, the host's
  slot, the ascii and QR transcripts — are transparent except under
  `forced-colors: active`, where the system paints selections and
  strips backgrounds, so the native rule stays. The light DOM's rule
  holds while the host carries `data-mw-selection`: set before the
  engine writes a range of its own (a gesture's, in the style
  resolution a semantic gesture's lift forces), at a `selectstart`
  in the host's light DOM or on an ancestor of it (a user's drag, a
  select-all, Firefox's keyboard extension from a caret) outside the
  form controls and editables, whose own rule is below, at the first
  move over a text-mode host of a press begun outside it (a drag that
  may carry a selection in, ahead of the move's own extension), held
  through a press's gesture to its release and a key's to its first
  `selectionchange`, and at a `selectionchange` finding a range that
  reaches the host's light DOM — both ends in it, or one across its
  edge (a select-all, a drag in from page text, a script's range
  around the host), a grid drag's aside; dropped at a
  `selectionchange` or a release finding none, and at the host's
  disconnect. Matched on every
  element, the rule would have each restyle compute a `::selection`
  too; the shadow sites style one element each and hold always. Form controls and
  editables, which render their own text, swap their own colors by a
  rule of their own, as the grid swaps a selected cell's: the engine
  writes each editable's measured ink and the ground the grid paints
  under it — its own fill, else the nearest above, `bg-clear` cutting
  through to the theme's, which is written out too (`var(--mw-bg)`) —
  as `--mw-ink` / `--mw-ground` (render.ts),
  and the rule reads them swapped. A focus-inverted control's measured
  colors are the inverted ones; a contenteditable's inline descendants
  inherit their block's. An editable region inside a host keeps its
  native selection; a host that is itself editable, or sits inside an
  editable, is unsupported, its text locked as any grid-mode text. The properties land with the relayout a focus
  change triggers, so a gesture that focuses and selects at once can
  show the previous colors for a frame. Left unstyled, Firefox paints
  them its native highlight, and Chromium and WebKit hand a control its
  parent's `::selection` (css-pseudo-4 highlight inheritance), so the
  transparent rule blanks the selected value (probed 2026-09-11). A
  grid-mode drag on the `<pre>` keeps the browser's highlight: that
  text IS the grid — and the browser's rule is the theme invert, so
  colored text highlights differently under a grid drag than under a
  text-mode or semantic selection (see Deviations). The paint is a
  style-only pass (same texts, new paints) coalesced to one frame per
  `selectionchange` burst, patching only the rows whose selected cells
  changed, so a drag on a large grid costs a few row patches per frame.
- **Text-mode drags are routed like grid-mode gestures.** A primary
  press on the host in `select="text"` that is not on an interactive
  element is the engine's: it hit-tests the cell, maps it to the
  character under the glyph the user sees, and sets a collapsed range
  there; moves extend the range character by character the same way
  (base at the anchor, extent under the pointer, the browser's own
  direction rules); Shift extends the current range; double- and
  triple-click are the word and paragraph gestures the grid mode
  already has. A pointer past the host's edge clamps to the nearest
  cell, so the extent runs to the nearest character of the box under
  that edge cell.
  Keyboard extension (Shift+arrows, Shift+Home) stays the browser's, on
  the range. A custom leaf's transcript (specs/leaf-renderers.md) is
  text like any other: its `selectionTarget` holds the leaf's text
  verbatim, so a cell maps to a position in it and a drag inside the
  leaf selects by character, with the highlight and the copy reading
  the transcript range back as indices into the leaf's text; a drag
  across the leaf's edge takes it whole (points in different trees
  pair at light-tree edges), a double-click selects the art's line
  under the pointer, and a triple-click the whole leaf — in both
  modes. Touch is untouched: a long-press selects natively, as the
  pointer handlers ignore touch, and the engine paints what it selects.
  The browser is never asked which character sits under a mouse, so a
  drifted native glyph cannot pick its neighbor. What the native drag
  did for free and the engine does too: leaving a control's focus
  on press, and the copy through the engine's serializer.
- **An engine gesture auto-scrolls its scroller, as a native drag
  does — a text-mode drag, and the word and paragraph gestures in
  either mode.** The host captures the pointer for the gesture (a trusted
  press; synthetic tests dispatch their own moves), so moves keep
  arriving past the host's edge and the window's. The gesture's
  scroller is the innermost scroll container enclosing the PRESSED
  cell — a scroll container in its hit stack, else the innermost
  native scroller outside the host, else the page — for the whole
  gesture, never chaining outward (Chromium and WebKit instead scroll
  whichever scroller's edge the pointer is past, the page beyond the
  viewport). While the primary button is held, every 50 ms (Chromium's
  autoscroll interval) the pointer's distance past the scroller's box
  on each axis — its padding box, the scrollport for the page —
  scrolls it that many whole cells toward the pointer, rounded up,
  through the instant scroll and quiesce settle a routed wheel tick
  uses (`scrollStep`, pointer.ts); a pointer inside the box, or a
  scroller with no room that way, scrolls nothing. Content moving
  under a held pointer — an auto-scroll tick, a wheel mid-drag, the
  page scrolling — extends the selection to the unit now under it,
  after the paint that mirrors the scroll, whose grid and tree the
  search reads. A semantic selection is the same content-anchored range
  in grid mode, so its gestures scroll the same way there; the plain
  grid drag is the browser's own positional selection on the `<pre>`
  (specs/scrolling.md), which auto-scrolls the page natively and
  scrolls no scroll container.

## Deviations (documented, like the cell model's running list)

- **A grid drag highlights colored text with the theme invert, every
  other selection with reverse video.** The `<pre>`'s highlight is the
  browser's `::selection`, which cannot swap a span's own colors; the
  painted highlight can and does. Plain text looks the same both ways.
  A faded element's cells over an opaque background, blended into it
  (an `opacity: 0` one's glyphs included), highlight in the full
  invert too, where CSS keeps a selection at the element's opacity, as
  the span's opacity keeps it over none.
- **In text mode, a selection a script makes that reaches a host, or
  one a key or a drag carries into it from outside with no move over
  the host, can show the browser's highlight for a frame.** `selectionchange`,
  which sets the host's `data-mw-selection` then, is a task of its own
  in every engine, and a frame can render before it (probed
  2026-09-24): always after a selection made in a
  `requestAnimationFrame` callback; after one made in a task, rarely
  (at random phases of the frame, 10 in 120 in Firefox, 1 in Chromium,
  none in WebKit); after a Shift+Arrow extension, 4 in 4 in Chromium,
  2 in 4 in Firefox, none in WebKit. That frame shows, in Chromium and
  WebKit, which hand every light element the slot's transparent
  highlight (css-pseudo-4 highlight inheritance), only an element's
  authored `::selection` colors (a `selection:` utility); in Firefox,
  which inherits none, the default highlight as well. Grid mode shows
  none: the browser paints no highlight on its unselectable light
  text. A gesture in the host, a select-all, a keyboard extension from
  a caret (Firefox's starts with a `selectstart`; Chromium and WebKit
  extend no caret outside caret browsing), a drag pressed outside from
  its first move over the host, and the engine's own ranges set the
  flag first, and a change to a live selection keeps it.
- **In WebKitGTK and WPE, a script's selection of a grid-mode host's
  text shows no highlight while nothing else on the page is
  selectable.** WebKit queues `selectionchange` only when its visible
  selection, the range snapped to selectable positions, changes
  (`FrameSelection::setSelection`); with the host's `user-select: none`
  text the only text, the range snaps to none before and after, so no
  event reaches the engine, though `getSelection()` holds the range
  (probed 2026-09-26; macOS WebKit, Chromium and Firefox fire it). The
  Selection API fires on any change of the selection's range. A press
  or a key is seen through its `selectstart`.
- **Keyboard selection extension follows the native wrap.** Shift+Down
  in text mode moves by the browser's line boxes, which can differ
  from the grid's rows on lines holding drifted glyphs; the painted
  highlight shows the characters that were actually selected.
- **A text-mode drag selects the host's text only.** A native drag
  could run from the host into the surrounding page; the engine's
  clamps to the host's nearest character, scrolling the gesture's
  scroller or the page while the pointer sits past their edges.
- **Native `:hover` freezes under a captured drag in text mode.**
  The host holds the pointer for an engine gesture, so light elements
  see no boundary events until release, where a native drag keeps
  their `:hover` live.
- **A selection cannot be dragged as text.** The press that would start
  a native drag-and-drop of the selected text starts a new selection
  instead, as in grid mode.
- **Touch handles sit on the native glyphs.** The OS draws long-press
  handles at the native layer's positions, beside the painted highlight
  on a drifted line.
- **Widths are the table's, not the font's**: a symbol the font draws
  wide is scaled into one cell, the way terminals fit ambiguous-width
  glyphs — a ★ or ♥ that a CJK fallback draws full-width shrinks to
  about 60% in its cell. A new emoji may be 1 cell in Node and 2 in a
  browser, or the reverse, until both ship the same Unicode version.

## Testing

- Node: `clusterWidth` and `graphemes` over a fixture (CJK, Hangul,
  kana, fullwidth, halfwidth, emoji with and without presentation, ZWJ,
  flags, keycaps, combining marks, Latin); the code-unit expansion (an
  emoji before a link keeps `charInline` and `advances` aligned);
  wrapping never splits a cluster; truncation keeps one whole; a
  zero-width cluster costs no cell; `renderPlainText` goldens with wide
  text in a border, in columns, tracked, centered, clipped by a scroll
  container mid-cluster, and overpainted by a border; every row exactly
  `width` cells; `charIndexAtCell` on both cells of a wide glyph; the
  per-cell offsets; the selection → cells mapping and the inverted
  paint over a focus-inverted control.
- Storybook (three engines): a paragraph mixing CJK, emoji, a star, and
  Latin — grid rows, the boxed spans' widths, an emoji's row one row
  tall; text-mode press and drag selecting characters by cell
  (the star's neighbor is the one you see), Shift extension, the word
  and paragraph gestures, copy; the painted highlight's cells for a
  drag, for a keyboard extension, and over a focused control; a
  textarea with CJK sized by cluster widths; the selection stories
  asserting the painted cells; auto-scroll (`Test /
Selection / Autoscroll`, a text-mode host): a press in a scroll
  container and one synthetic move past its bottom edge scroll it and
  extend the selection to a paragraph that was below its fold, a move
  past its top edge scrolls it back, a move inside scrolls nothing, and
  a press outside any container with a move past the viewport's bottom
  edge scrolls the page and extends to the line below the fold, a
  horizontal scroller scrolls past its right edge to its tail, a
  `pointercancel` ends the ticks, a container scroll whose paint a
  relayout takes over still extends the gesture, and in grid mode a
  triple-click in the container held past its edge scrolls it the same
  way; in three engines. `Nearest Unit`: a leaf taller than its scroll
  container — a drag over its blank visible rows reaches the paragraph
  above, not the one painted past the clip. `Highlight Lock` and
  `Drag In Lock`: an authored `selection:` color reads transparent
  from a script's `selectionchange`, a press's `selectstart`, a word
  gesture's press, and a text-mode drag pressed outside from its first
  move over the host, each through its release, and from a key's
  `selectstart` to its first `selectionchange`, a selection crossing
  the host's edge — a drag's carried in from page text, past its
  release, a select-all, a script's range across the host — for as
  long as it lasts, and not otherwise. Node (element.test.ts): a
  `selectstart` in the light DOM or on an ancestor locks, one in a
  form control or an editable does not (a region that is not
  editable locks, an editable's island does not), a press whose
  release a page stops short of the window still ends, and a
  disconnect drops the lock, the lift, and the drag mark.
- Node: `scrollStep` — cells past each edge, rounded up, zero inside.
- Visual (`visual/selection.spec.ts`, a real mouse, on the play-less
  `Autoscroll Fixture`): a drag from a scroll container's first line
  to below its box and outside the host — a text-mode press, a
  grid-mode double-click — scrolls it, never the page, and extends the
  selection past its fold, as only the captured pointer's moves reach
  the engine there; both modes, three engines.
- Visual: the selection-invert fixtures (the paint is the engine's,
  so text mode's are engine-identical), a "Wide characters" story
  under Features, and the deviation story of a native Shift+Down
  on a drifted line.
- Tiling fit: the stubbed-canvas unit tests (one measurement per range
  and font, the scale and line-height from Menlo's numbers, a glyph
  drawn past the row boxed and held to its overhang floor, a stroke
  short of it left alone where a block fills, its advance for the box's
  indent, a double-width one clipped, box drawing
  fitted apart from the blocks, a shade locked to its lattice and its
  phase row by row, the pin corrected by a measured baseline), the
  paint test of a shade's phase and period on its box, the blend
  fixture's translucent shades (`visual/blend.spec.ts`: over no
  background, over a translucent one, and a shadow's ring, their
  fullest ink against the browser's glyph drawn once, in three
  engines), the layer tests
  of the effects that resample a layer's cells and of the paint told
  which cells a resampled layer draws, and the
  `Features / Typography / Tiling Glyphs` story — a `leading-6`
  root, where the bundled font's `█` and `│` are short of the row,
  beside a host at the font's own leading, where its `│` runs past it,
  as the play asserts —
  asserting every tiling glyph's box, the shades' lattice and phase
  and their copies' glyph, a painted row's padding, and the cell as
  whole layout units in three engines, with its golden in the sweep.

## Verification

Probed (results above): the boxed span's row height, neighbor cells,
vertical centering, native selection, and ink at the fill scale in all
three engines; `Intl.Segmenter` cost; the sweep image's fonts; keyboard
extension and copy after a prevented mousedown. Measured
(2026-09-05, `verify/paint-bench.mjs`,
80 paragraphs in an 89 × 320 grid, one character added per frame): a
drag move within a paragraph or across paragraphs is indistinguishable
from an idle frame in all three engines (median 17 ms Chromium and
Firefox, 33 ms WebKit, idle the same); selecting the whole host in one
step adds 10 ms in Chromium and Firefox and 8 ms in WebKit. The paint
model alone (`renderGridRows` on 80 leaves, 200 × 160 cells, Node)
takes 5 ms unselected and 7 ms fully selected: the render is whole-grid
per change, the DOM patch is per row.

## Touch points on implementation

- width.ts: `clusterWidth` (0, 1 or 2 cells per grapheme, from a
  hand-condensed East Asian Wide/Fullwidth table and the
  `Extended_Pictographic`, `Emoji_Presentation`, `Regional_Indicator`
  and `Default_Ignorable_Code_Point` properties), `graphemes` (the ASCII
  fast path, a cached grapheme `Intl.Segmenter`), `clusterAdvance`,
  `clusterAdvances` and `textCells`, exported from the package — the
  terminal convention every measure goes through.
- tree.ts: `collectNodes` walks text per cluster (its width plus
  tracking as the advance; CRLF one break); `expandClusters` spreads
  `advances` and `charInline` over code units; `buildRendererLeaf`,
  textarea rows and select labels count the same widths.
- wrap.ts: `lineAdvance` takes the text, so a line's trailing gap is
  its last cluster's advance beyond its cells.
- plain-text.ts: `forEachLeafCell` visits clusters; `renderGrids`
  writes a cluster at its cell and `""` at its continuation cells,
  keeping each cell's wide owner so a later paint or a clip edge blanks
  the cluster whole; `RenderOptions`' `boxed` and `selection`; a
  selected paint swaps color and background (`applyCellPaint`);
  `rowSegments` closes a boxed cluster into its own segment, and
  `renderGridRows` returns the segments with the cell strings.
- glyph-box.ts: `GlyphBoxes` — `measureText` per distinct cluster and
  font (family, size, weight, style), the 0.01-cell tolerance, the
  fill scale capped by the ink; `#tileFit` and the `BaselineOf`
  measurer the host lends it; the cache `configure` clears on a font
  or cell change and `invalidate()` re-measures on fonts settling, a
  cluster's box uncached while `document.fonts` is loading.
- paint.ts: `paintGrid`'s per-row patch (styles in place when the
  row's structure matches, a rebuild between its neighbors' newlines
  when not), `holdStructural` while a press the engine has not taken
  over may be a native drag; `applySegment`, a boxed segment's
  `data-box` span — its width, `text-indent`, scale, a tiling fit's
  `line-height`, a shade's `data-shade`, `--mw-period` and `--mw-phase` —
  built once and cloned down the page, and every box restyled when the glyph
  cache's `generation` moved; `gridOffsetAt` and `paintedCell` read the
  kept cell strings.
- metrics.ts: `backgroundGap` (the host's `--mw-bgpad`, the grid's span
  padding) and `gridLetterSpacing` (the cell rounded up to 1/64 px, set
  on the grid).
- selection.ts: `selectedRanges(root, points)`.
- element.ts: `#paint` (glyph boxes and the selection's ranges);
  `#onSelectionChange` repainting a host holding the range or just
  left by it; the text-mode press (`#startGesture`) and the
  `"character"` gesture unit, extended by `#extendGesture`; `#unitAt`,
  the nearest unit over painted cells in `nearestCells` order; the
  grid's `line-height` and `letter-spacing`; the host's `--mw-bgpad`;
  the glyph cache configured per layout, `#baselineOf` lending the
  tiling fit its baseline; the shadow's `[data-shade]` rules drawing a
  shade's lattice at its phase and a period above, each clipped to its
  strip, each shade's glyph a literal (performance.md "Shades drawn
  once"); `#autoscroll` and `#followPointer`; the
  light DOM's `::selection` lock under `data-mw-selection`
  (`#onSelectStart`, a press's held on the window's `#pressHeld`, both
  its edges captured, `#onSelectionChange` and `#reachesLight`,
  `#selectThrough` and `#liftLock`, a press
  begun outside in `#onPointerMove`, the release in `#onPointerUp`,
  the disconnect);
  the shadow's transparent `slot::selection` and the grid's invert.
- styles.css: the light `::selection` sites transparent outside forced
  colors; form controls and editables swapping their engine-written
  colors by a rule of their own, ungated.
- render.ts: `--mw-ink` / `--mw-ground` on editables, the ground
  threaded down the walk.
- packages/ascii/src/index.ts: the transcript's transparent
  `#mirror::selection`.
- packages/qr-code/src/index.ts: the same, on its transcript.
- cell-model.md "Selection", "Text alignment" and "Typography",
  semantic-selection.md's gesture model and core-architecture.md's
  display-width entry point here.
