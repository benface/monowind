# Wide characters, fallback glyphs, and the grid-painted selection

Status: **implemented** (2026-09-05; plan:
`.agents/plans/2026-09-05-wide-characters.md`). Lifts cell-model.md
deviation 10 ("double-width glyphs are counted as their UTF-16 length")
and retires the native selection highlight in the light DOM. Two
findings from the implementation: a glyph box measured while a web
font was still loading must be forgotten when the font lands (the
fallback's advance was cached under the same font name — the theme
gallery boxed its borders in the sweep), and a `Range` rect around a
boxed span unions the scaled text inside it, so alignment checks read
the span's own box. Auto-scroll and the box-bounded nearest-unit
search were added 2026-09-06 (no plan: one phase).

## Why

The engine counts one cell per UTF-16 code unit and lets the browser
draw every glyph at its font's advance. Two things go wrong, and they
are one problem:

- **Glyphs the primary font lacks come from a fallback font at that
  font's own advance.** A CJK ideograph or a Hangul syllable takes one
  cell in the layout and paints across 1.4–1.7; an emoji takes two code
  units and paints 2.1–2.3 cells; a star (★, U+2605), a check mark, a
  heart, ⌘, and any symbol outside the monospace font paint at 0.8–1.3
  cells. From that glyph on, the row is off the grid: text drifts,
  borders zigzag against the rows above and below.
- **Whatever the grid does about it, the transparent native text under
  the grid keeps the font's advances.** Today the two drift together on
  a line, so a text-mode highlight sits on the glyphs you see — until
  the native text wraps at a different point than the grid, which a
  paragraph of narrow-drawn ideographs does within a few lines: from
  there the native rows and the grid rows disagree, and a press lands
  on a character rows away from the glyph under the pointer. Fix the
  grid alone and the highlight sits beside the glyphs on every drifted
  line — a worse look than the drift. The native layer cannot be fixed:
  a text node has no per-glyph width control, and `font-size-adjust`'s
  `ic-width` scales the primary font along with the fallback (probed:
  `M` grows to 1.2 cells).

So the grid must own both the glyph and the highlight. There is also a
latent bug on the same axis: a leaf's `advances` and `charInline` are
indexed per code POINT (the run collects `for (const ch of text)`) while
`text`, `charSource`, and the paint walk index per code UNIT, so anything
astral (every emoji) shifts the per-character data after it by one.

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
  U+FE0F). Zero cells: a cluster made only of default-ignorable or
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
  and its remaining units carry an advance of 0. The existing machinery
  already handles that shape — `advanceOf` sums, the wrap's
  cell-boundary break and the ellipsis cut cannot stop inside a cluster
  because its tail costs nothing, `charIndexAtCell` reports the
  cluster's first unit for any of its cells, and `positionOf` maps that
  unit to the DOM. The astral-index bug goes away with the change.
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
  glyphs meant to abut, and a font's line box need not match them:
  Menlo and SF Mono draw `█` 14.3px and 14px tall in the 16px and 17px
  rows their `line-height: normal` makes, so every row of blocks shows
  a gap (the scrollbar's track and thumb included); Monaco's `│` is
  11.9px in a 19px row, and Firefox's rows for Courier New, Andale
  Mono, and PT Mono are a pixel taller than their `│`, so their
  vertical borders gap; and a `leading-*` on the root makes the row
  taller than any font's glyph. The adapter measures each range's
  reference glyph once per grid font — `█` for blocks, `│` for box
  drawing; when the font draws it past the row or off its cell width,
  every glyph of the range is boxed with the one transform, and so it
  is when a BLOCK is drawn short of the row: a block stands for a cell
  filled, so its `font-size` is scaled until the glyph is a pixel and a
  half taller than the row on each side. A stroke stands for a line,
  and that growth makes it as much bolder as the row is taller than the
  glyph — at a raised leading it turns a hairline border into a bar —
  so a stroke short of the row keeps the size the font gives it and its
  rows gap. Either way a `line-height` on the box pins it —
  a line box places the baseline at half-leading plus the font's
  ascent, both from the same `measureText` call, and the host then
  measures the baseline the engine actually gives that box (an empty
  inline-block's top) and corrects the line-height by twice the error,
  since engines round a scaled font's metrics their own way, stepping
  until the nearest lands where the engine snaps a baseline to whole
  pixels (Chromium; WebKit and Firefox place it fractionally) — the
  box a row tall and clipping the overshoot (half a pixel seamed in
  Chromium; a whole one left Firefox's top row half bare). Box drawing
  is pinned to the row's own baseline, the one the host measured, so a
  border sits where the font sets it against the text: centered on the
  row instead, it moved a pixel up in WebKit and half a pixel down
  elsewhere, and a line of text in a box looked off its middle. A
  filling glyph hangs its ink a pixel and a half past the row's top,
  where the blocks' halves meet at the row's middle and a shade raised
  to its lattice lands as it did in the row above; a box takes that
  same pin where the host measured no baseline. One transform per range
  is what keeps a junction's strokes on its neighbors': box-drawing
  strokes sit at the glyph's center and edges, which a uniform scale
  around the box's center preserves; a block's cost for that is ink as
  much bolder as the row is taller than the glyph, which is why a
  stroke is not scaled to fill. The shades `░ ▒ ▓` are patterns, periodic
  by design: at an arbitrary scale a lattice resamples into moiré
  (Chromium's scrollbar tracks, twice over). A shade takes the same
  fit with its scale raised to the nearest factor that makes its
  period a whole number of device pixels, so every dot rasterizes
  alike — the period read off a rendering, the first peak of the
  alpha's autocorrelation down the glyph's most patterned column. Its
  box then carries the lattice on from row to row: its line box grows
  by twice the row's phase, which moves the glyph down by the phase —
  or shrinks, moving it up by the rest of the period, when down would
  carry the glyph's content area off the box's top and up keeps it
  past the bottom (a selection highlight covers the content area, so
  the move must not bare the box) — and a copy a period above and
  below, drawn by the box's pseudo-elements in the same line box,
  fills what the shift uncovers. The box clips the rest, and a zoom,
  which moves the device pixel ratio, refits. The
  halves still meet at the row's middle, and a fallback font's
  double-width block clips to its cell instead of shrinking to half a
  row. A glyph drawn PAST the row takes the same box: it tiles, but its
  rows overlap, and the two antialiased edges over each other paint a
  darker band along every row's edge — Menlo's stem in Chromium, its
  edge at the joint 62% darker than along the row at 1×, 14% at 3×,
  which is why a zoom hides it (JetBrains Mono's `█`, 19px in an 18px
  row; Menlo's `│`, 17.8px in 16). The box clips each row to its own
  slice, so the strokes meet on one edge, and a shade takes its own fit
  once the blocks take one, its lattice locked there as where they fall
  short. The box is one per cell for a stroke, by design: a run of `─`
  in one text
  run overdraws itself at every joint — a font draws the line past its
  advance so joins never gap, and two antialiased ends over each other
  darken the stroke's edge rows into a dot per cell (plain text's
  borders always had them; SF Mono at 2x, the top edge row from 148
  to 92 of 255) — and only the box's clip, snapped to device pixels, keeps each
  glyph's ink to its cell; nothing in one text run can, at any
  letter-spacing.
- **A run of one full-width band shares a box.** `▀`, `█`, the lower
  eighths and `▔` (U+2580–U+2588, U+2594) draw the same ink at both
  edges of the cell, so the ink one pushes into its neighbor is ink the
  neighbor draws there anyway: repeats of ONE of them, on one paint,
  take a single box of their cells, the glyphs kept on their cells by a
  `letter-spacing` of the cell less the advance and placed by the same
  `text-indent`, halved per cell. The overdraw then shows only where
  the band's own antialiased edge row meets a joint (Menlo at 2× in
  Chromium, a `█` row's top row from 180 to 127 of 255 on the joint's
  columns), against a span a cell for every module of a QR code —
  a page of seven codes, bordered panels, a scroller and two shade rows
  paints 2191 grid spans against 3341, and 220 with nothing boxed at
  all. A half, a quadrant, a shade or a stroke keeps its own box: their
  ink would spill into what the neighbor leaves blank, or rasterize
  differently at every phase. Two more things keep the joint whole: the scale never
  leaves the range's widest ink — box drawing's `─`, the blocks' own
  reference — short of 0.45 CSS pixels past each of the cell's edge
  columns, nor below 1 (a glyph at its own size can leave
  the edge column part bare, and JetBrains Mono's `│`, 21px in an 18px
  row, would otherwise SHRINK to 0.987). CSS pixels, not device ones:
  swept glyph by glyph against the three engines at 1×, 2× and 3× — a
  run of boxes at a sweep of scales, read back for a column lighter
  than the stroke's own darkness — what closes a joint holds roughly
  steady in CSS pixels (Chromium wanted 0.27 at 1× and 0.36 at 2×,
  WebKit 0.41 at 1×) while a device-pixel floor thins as the screen
  gets denser. 0.45 clears every case measured, and the margin is not
  spare: at 0.25 a bordered box's top edge dips 33% of its darkness at
  every cell joint in Chromium at 2×, and the default font's `─`,
  which overhangs 0.277 unscaled, does not close one on its own. It
  costs that font's borders 3.9% of scale,
  and the glyph is placed by a `text-indent` of half the room its
  advance leaves in the box, not `text-align: center`: a centered line
  lands on a rounded position, and at one joint in six its end fell a
  fraction short of the clip's edge column, a lighter column through
  the stroke (SF Mono at 2× in Chromium, 41% of the ink; Firefox at
  1× too). The price is the row's nodes: on a page of sixty bordered
  boxes at the macOS
  defaults, whose glyphs run past the row, 360 grid nodes unboxed and
  1260 boxed. What the nodes cost per layout was set by the measuring
  gate, not the boxes: read through descendant rules, the host's
  `[measuring]` and `[settling]` flips walked the whole subtree, shadow
  grid included, four times a layout — 8.4 ms of the boxed page's style
  recalc, 3.3 of the unboxed one's, where the relayout's own row costs
  a fraction of a millisecond — so each light element gates its own
  rules by its own flag instead (cell-model.md "Typography"): the flips
  then cost 0.07 ms, and the page relays out in 13.2 ms boxed against
  10.7 unboxed at the old gate (18.5 boxed at it; Chromium's own
  counters, 30 relayouts, three rounds). A glyph the font draws at the
  row's height, within a twentieth of a pixel, is left alone. That case
  alone stops at a layer that RESAMPLES its cells
  — scaled, rotated, skewed: a transform never moves layout, so the pin
  holds there, but each box's clip edge lands between device pixels and
  is antialiased, a lighter seam at every row that the overshooting
  glyph covers unboxed (a border's stems fell away from its corners in a
  `scale-150` layer; the short and off-width fits pay the same seam
  there, having no glyph that covers the row), so those cells keep the
  glyph the font gives them (specs/layers.md). A layer inside one is
  resampled too, its box a child of theirs. Every other layer takes the
  box: one that only stacks (a dialog's, a popover's), one a filter
  opens (a blur, a backdrop blur), one a translation moves, and one
  resting at an identity are all the host's grid in every way that
  matters here. The layer's read marks it (types.ts `resampled`), off
  the effects it already reads, so the paint reads no style of its own;
  a glyph both past the row AND off its cell width keeps its box
  everywhere, the width fit being needed either way. Two limits to know:
  a transform ABOVE the host resamples the main grid and nothing weighs
  it, and a layer in transition keeps the decision of the paint before
  it, the settle repainting at the final value.
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
  Plain text therefore highlights as the theme invert, as before;
  colored text highlights as a band of ITS color with theme-background
  glyphs (an emerald banner selects emerald, not black), where the
  retired CSS rule painted every element with the theme colors; and a
  focus-inverted control re-inverts under selection with no special
  case, which the CSS rule needed. The canonical light-DOM
  `::selection` rule turns transparent (its three sites — styles.css,
  the host, the ascii transcript — go with it) except under
  `forced-colors: active`, where the system paints selections and
  strips backgrounds, so the native rule stays; form controls and
  editables, which render their own text, swap their own colors by a
  rule of their own, as the grid swaps a selected cell's: the engine
  writes each editable's measured ink and the ground the grid paints
  under it — its own fill, else the nearest above, `bg-clear` cutting
  through to the theme's — as `--mw-ink` / `--mw-ground` (render.ts),
  and the rule reads them swapped. A focus-inverted control's measured
  colors are the inverted ones; a contenteditable's inline descendants
  inherit their block's. The properties land with the relayout a focus
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
  direction rules); Shift extends the existing range; double- and
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
  did for free and the engine now does too: leaving a control's focus
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
- **The centering nudge is retired.** `data-mw-center-nudge` existed
  to land the native highlight on centered glyphs; with the highlight
  painted from cells it has no job.

## Mechanics

- `width.ts`: `clusterWidth(cluster): 0 | 1 | 2` from a hand-condensed
  East Asian Wide/Fullwidth block table plus JS's own
  `\p{Extended_Pictographic}`, `\p{Emoji_Presentation}`,
  `\p{Regional_Indicator}`, and `\p{Default_Ignorable_Code_Point}`;
  `graphemes(text)` with the ASCII fast path and a cached grapheme
  `Intl.Segmenter`; `clusterAdvance`, `clusterAdvances`, `textCells`.
  All four helpers are exported from the package.
- tree.ts: `collectNodes` walks text nodes per cluster (a cluster
  string, its width plus tracking as the advance; CRLF one break);
  `normalizeRun` unchanged (a space is its own cluster); at node build
  `expandClusters` spreads `advances` and `charInline` over code units.
  `buildRendererLeaf`, textarea rows, and select labels use the same
  widths.
- wrap.ts: `lineAdvance` takes the text so a line's trailing gap is
  its last cluster's advance beyond its cells, exact for wide clusters
  and markers alike.
- plain-text.ts: `forEachLeafCell` visits clusters (`index, length, x,
y, advance`); `renderGrids` writes a cluster at its cell and `""` at
  its continuation cells, keeps the wide owner of every cell so a later
  paint or a clip edge blanks the cluster whole, and takes
  `RenderOptions` — `boxed(cluster, cells, paint)` and `selection:
Map<leaf, { start, end }>`; a `selected` paint swaps color and
  background in `applyCellPaint`; `rowSegments` closes a boxed cluster
  into its own `{ text, cells, box }` segment; `renderGridRows` returns
  the segments with the cell strings.
- glyph-box.ts (DOM): `GlyphBoxes` — canvas `measureText` per distinct
  cluster and font (family, size, weight, style), the 0.01-cell
  tolerance, the fill scale capped by the ink, a cache the element
  clears on `configure` changes and on font `loadingdone`; a cluster's
  box is not cached while `document.fonts` is loading, a tiling fit is
  (its measurement forces a layout, and the `loadingdone` invalidation
  refreshes it).
- paint.ts: `paintGrid(root, target, { holdStructural, glyphs,
selection })` — `holdStructural` while a press on the grid the engine
  has not taken over may be a native drag, whose anchor a rebuild would
  lose; a press on a control is the control's — patches per ROW (styles
  in place when the row's structure matches, a rebuild between its
  neighbors' newlines when not); a boxed segment wears `data-box`, which
  a shadow rule draws as an `inline-block` `--mw-ch` tall, unpadded and
  clipped — the shape every box shares costs one rule rather than six
  declarations apiece — with its own `cells × --mw-cw` width inline,
  the glyph placed by a
  `text-indent` of half the room its `advance` leaves, its font-size
  the scale; boxes repeat down a page, so a span's style is built once
  and its fellows are clones of it; a tiling fit adds its
  `line-height`, a shade's moved by
  twice the row's shift; a shade adds `data-shade` (its glyph, which
  the shadow's `::before`/`::after` repeat a period above and below)
  and `--mw-period` in px; the glyph cache's `generation` — counting
  its refits, a font load's or a cell change's — is kept with the paint,
  and a grid painted under an earlier one restyles every box even where
  no row changed (a layer whose text stood still kept the fallback
  font's fit); every other grid span pads
  `padding-block: var(--mw-bgpad)`, the host's `ceil(backgroundGap /
2)` px — on a host wearing `data-mw-bgpad`, which it sets only where
  that gap is real, so a span carries no lookup on any other page; `gridOffsetAt` and `paintedCell` read the kept cell strings.
- selection.ts: `selectedRanges(root, points)`.
- element.ts: `#paint` (glyph boxes plus the selection's ranges);
  `#onSelectionChange` repaints a host holding the range or just left
  by it; the text-mode press (`#startCharacterDrag`) and the
  `"character"` gesture unit, extended by the existing
  `#extendGesture`; `#unitAt` finds the nearest unit over painted
  cells only, in `nearestCells` order (pointer.ts) inside the innermost
  box under the cell, then the grid; the
  grid's `line-height` pinned to the cell and its `letter-spacing` set
  to `gridLetterSpacing`; the host's `--mw-bgpad`; the glyph cache
  configured per layout from the grid's computed font, with
  `#baselineOf` lending the tiling fit its measured baseline;
  `#autoscroll` (the gesture's scroller, captured pointer, and 50 ms
  tick through `#scrollRouted`, the wheel's scroll-and-settle)
  and `#followPointer`, which a scroll-driven paint and a page scroll
  call to extend the live gesture under the held pointer.
- styles.css / element.ts / @monowind/ascii: the light `::selection`
  sites are transparent outside forced colors, form controls and
  editables swapping their engine-written colors by a rule of their
  own; `#grid::selection` keeps the invert; `data-mw-center-nudge` is
  gone.
- render.ts: `--mw-ink` / `--mw-ground` on editables, the ground
  threaded down the walk.

## Deviations (documented, like the cell model's running list)

- **A grid drag highlights colored text with the theme invert, every
  other selection with reverse video.** The `<pre>`'s highlight is the
  browser's `::selection`, which cannot swap a span's own colors; the
  painted highlight can and does. Plain text looks the same both ways.
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
  Latin — grid rows, the boxed spans' widths, an emoji row's height
  unchanged; text-mode press and drag selecting characters by cell
  (the star's neighbor is the one you see), Shift extension, the word
  and paragraph gestures, copy; the painted highlight's cells for a
  drag, for a keyboard extension, and over a focused control; a
  textarea with CJK sized by cluster widths; the existing selection
  stories re-pointed at the painted cells; auto-scroll (`Test /
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
  above, not the one painted past the clip.
- Node: `scrollStep` — cells past each edge, rounded up, zero inside.
- Visual (`visual/selection.spec.ts`, a real mouse, on the play-less
  `Autoscroll Fixture`): a drag from a scroll container's first line
  to below its box and outside the host — a text-mode press, a
  grid-mode double-click — scrolls it, never the page, and extends the
  selection past its fold, as only the captured pointer's moves reach
  the engine there; both modes, three engines.
- Visual: the selection-invert fixtures re-baselined (the paint is the
  engine's now, so they become engine-identical), a "Wide characters"
  story under Features, and the deviation story of a native Shift+Down
  on a drifted line.
- Tiling fit: the stubbed-canvas unit tests (one measurement per range
  and font, the scale and line-height from Menlo's numbers, a glyph
  drawn past the row boxed and held to its overhang floor, a stroke
  short of it left alone where a block fills, its advance for the box's
  indent, a double-width one clipped, box drawing
  fitted apart from the blocks, a shade locked to its lattice and its
  phase row by row, the pin corrected by a measured baseline), the
  paint test of a shade's phase and period on its box, the layer tests
  of the effects that resample a layer's cells and of the paint told
  which cells a resampled layer draws, and the
  `Features / Typography / Tiling Glyphs` story — a `leading-6`
  root, where the bundled font's `█` and `│` are short of the row,
  beside a host at the font's own leading, where its `│` runs past it,
  as the play asserts —
  asserting every tiling glyph's box, the shades' lattice and phase, a
  painted row's padding, and the cell as whole layout units in three
  engines, with its golden in the sweep.

## Verification

Done before the plan (results above): the boxed span's row height,
neighbor cells, vertical centering, native selection, and ink at the
fill scale in all three engines; `Intl.Segmenter` cost; the sweep
image's fonts; keyboard extension and copy after a prevented mousedown.
Measured after the implementation (2026-09-05, `verify/paint-bench.mjs`,
80 paragraphs in an 89 × 320 grid, one character added per frame): a
drag move within a paragraph or across paragraphs is indistinguishable
from an idle frame in all three engines (median 17 ms Chromium and
Firefox, 33 ms WebKit, idle the same); selecting the whole host in one
step adds 10 ms in Chromium and Firefox and 8 ms in WebKit. The paint
model alone (`renderGridRows` on 80 leaves, 200 × 160 cells, Node)
takes 5 ms unselected and 7 ms fully selected: the render is whole-grid
per change, the DOM patch is per row.

## Touch points on implementation

- cell-model.md: deviation 10 rewritten; "Selection" describes the
  painted highlight and the routed text-mode drag; "Text alignment"
  loses the nudge.
- semantic-selection.md: text mode's drag joins the gesture model; the
  "highlight is the native layer's" statement inverts.
- README "Selection": selection in both modes is drawn on the grid;
  a "Unicode" note on terminal widths.
- core-architecture.md: the "Unicode display width" backlog item
  becomes the pointer to this spec.
- Tiling glyphs (2026-09-05): glyph-box.ts `#tileFit` and the
  `BaselineOf` measurer the host lends (`#baselineOf` in element.ts);
  paint.ts `applySegment` pins, clips, and stretches; metrics.ts
  `backgroundGap` (→ the host's `--mw-bgpad`, the grid's span padding)
  and `gridLetterSpacing` (the cell rounded up to 1/64 px, set on the
  grid); cell-model.md "Typography" records both.
