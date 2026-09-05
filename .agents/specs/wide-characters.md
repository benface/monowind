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
the span's own box.

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
  strips backgrounds, so the native rule stays; form controls keep
  their native highlight, as they render their own text. A grid-mode
  drag on the `<pre>` keeps the browser's highlight: that text IS the
  grid — and the browser's rule is the theme invert, so colored text
  highlights differently under a grid drag than under a text-mode or
  semantic selection (see Deviations). The paint is a style-only pass (same texts, new
  paints) coalesced to one frame per `selectionchange` burst, patching
  only the rows whose selected cells changed, so a drag on a large grid
  costs a few row patches per frame.
- **Text-mode drags are routed like grid-mode gestures.** A primary
  press on the host in `select="text"` that is not on an interactive
  element is the engine's: it hit-tests the cell, maps it to the
  character under the glyph the user sees, and sets a collapsed range
  there; moves extend the range character by character the same way
  (base at the anchor, extent under the pointer, the browser's own
  direction rules); Shift extends the existing range; double- and
  triple-click are the word and paragraph gestures the grid mode
  already has. A pointer past the host's edge clamps to the nearest
  cell, so the extent runs to the start or end of the host's text.
  Keyboard extension (Shift+arrows, Shift+Home) stays the browser's, on
  the range. Touch is untouched: a long-press selects natively, as the
  pointer handlers ignore touch, and the engine paints what it selects.
  The browser is never asked which character sits under a mouse, so a
  drifted native glyph cannot pick its neighbor. What the native drag
  did for free and the engine now does too: leaving a control's focus
  on press, and the copy through the engine's serializer.
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
  clears on `configure` changes and on font `loadingdone`, and no
  caching while `document.fonts` is loading.
- paint.ts: `paintGrid(root, target, { holdStructural, glyphs,
selection })` patches per ROW (styles in place when the row's
  structure matches, a rebuild between its neighbors' newlines when
  not); a boxed segment is an `inline-block` span `cells × --mw-cw`
  wide, centered, clipped, its font-size the scale; `gridOffsetAt` and
  `paintedCell` read the kept cell strings.
- selection.ts: `selectedRanges(root, points)`.
- element.ts: `#paint` (glyph boxes plus the selection's ranges);
  `#onSelectionChange` repaints a host holding the range or just left
  by it; the text-mode press (`#startCharacterDrag`) and the
  `"character"` gesture unit, extended by the existing
  `#extendGesture`; `#unitAt` finds the nearest character over
  painted cells only, in `nearestCells` order (pointer.ts); the
  grid's `line-height` pinned to the cell; the glyph cache configured
  per layout from the grid's computed font.
- styles.css / element.ts / @monowind/ascii: the light `::selection`
  sites are transparent outside forced colors and off form controls;
  `#grid::selection` keeps the invert; the focus-visible swap rule and
  `data-mw-center-nudge` are gone.

## Deviations (documented, like the cell model's running list)

- **A grid drag highlights colored text with the theme invert, every
  other selection with reverse video.** The `<pre>`'s highlight is the
  browser's `::selection`, which cannot swap a span's own colors; the
  painted highlight can and does. Plain text looks the same both ways.
- **Keyboard selection extension follows the native wrap.** Shift+Down
  in text mode moves by the browser's line boxes, which can differ
  from the grid's rows on lines holding drifted glyphs; the painted
  highlight shows the characters that were actually selected.
- **A text-mode drag stays inside the host.** A native drag could run
  from the host into the surrounding page, or auto-scroll the page
  while the pointer sat past its edge; the engine's clamps to the
  host's text and scrolls only with the wheel mid-drag. Auto-scroll of
  the page and of scroll containers can be added to the gesture later.
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
  stories re-pointed at the painted cells.
- Visual: the selection-invert fixtures re-baselined (the paint is the
  engine's now, so they become engine-identical), a "Wide characters"
  story under Features, and the deviation story of a native Shift+Down
  on a drifted line.

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
