# Wide characters implementation plan

Status: **done** (2026-09-05). Spec: `.agents/specs/wide-characters.md`
(normative; this plan only sequences it). Ships in 0.2.8 together with
the touch-selection fix already on the tree.

## Phases (each ends green: `pnpm check` + the visual sweep)

### 1. `width.ts` — cluster widths, no DOM

- `clusterWidth(cluster): 0 | 1 | 2`: 2 for a first code point in the
  East Asian Wide/Fullwidth block table (hand-condensed from
  `EastAsianWidth.txt` at block granularity: Hangul Jamo, CJK radicals
  and symbols, kana, Bopomofo, Hangul, Yi, the ideograph blocks and
  planes, compatibility and fullwidth forms, Tangut, Nushu, enclosed
  ideographic supplement) or with `\p{Emoji_Presentation}`; 2 for a
  cluster carrying U+FE0F, a ZWJ, or a keycap U+20E3 on a pictographic
  or keycap base, and for a regional-indicator pair; 1 when it carries
  U+FE0E; 0 for a cluster of nothing but default-ignorable or control
  code points; 1 otherwise.
- `graphemes(text): string[]`: ASCII fast path, else a cached grapheme
  `Intl.Segmenter` (the word segmenter cache in selection.ts moves here
  and generalizes to a granularity key).
- `clusterAdvances(text, tracking)`: code-unit-indexed advances — the
  width plus tracking on a cluster's first unit, 0 on the rest — the
  shape every consumer takes from here on.
- Tests (`width.test.ts`).

### 2. Runs, wrap, controls

- tree.ts `collectNodes`: text nodes are walked per cluster (both the
  collapsing and the `pre` paths; a tab or a collapsible space is its
  own cluster); `pushChar` takes the cluster string and its advance
  `clusterWidth + tracking` (0-width clusters get 0). `normalizeRun`
  is untouched (it works on cluster entries). At node build the
  cluster arrays expand to code units: `advances` and `charInline`
  gain 0-advance / same-index continuation entries, and the marker
  advance rewrite (`eachObjectMarker`) runs over the expanded text.
  `buildRendererLeaf` segments each line the same way. Textarea rows
  wrap the value with cluster advances; select labels measure cells.
- wrap.ts `trailingGap`: walk back over 0-advance units to the
  cluster's first unit (a line ending on a wide cluster must not read a
  −1 gap). The break loop and the ellipsis cut already cannot stop
  inside a cluster (its tail costs nothing).
- Tests: tree/leaf/wrap tests for an emoji before a link (aligned
  `charInline`/`advances`), a CJK line's wrap and truncation, a
  zero-width cluster, a tracked wide line's `lineAdvance`.

### 3. Plain-text paint

- `forEachLeafCell` visits CLUSTERS: `(index, length, x, y, advance)`;
  a 0-advance unit is never visited on its own. `charIndexAtCell`,
  `inlineElementRects` unchanged in meaning.
- `renderGrids(root, options)`: `PutGlyph` takes a `cells` width; the
  base put writes the cluster at its cell and `""` at continuation
  cells, and remembers wide owners so a later put on any of a wide
  cluster's cells blanks the rest to spaces; the clip wrapper blanks a
  cluster cut by its edge; text paints one cluster per visit with
  `cells = advance − its element's tracking`. Options: `boxed(cluster)`
  and `selection: Map<LayoutNode, { start; end }>` — a leaf's visit
  inside its range paints `selected: true`.
- `CellPaint.selected`; `applyCellPaint` swaps color/background for it
  (`--mw-bg`/`--mw-fg` fallbacks); `samePaint`, `isBarePaint`,
  `signatureOf` learn the field.
- `rowSegments(row, paints, boxed)`: a cluster wider than one cell or
  `boxed` closes its own segment `{ text, cells, box: true }`.
  `renderCellSegments` returns rows plus the per-row cell strings (the
  cell → offset map).
- Tests: goldens for wide text in a border, in columns, tracked,
  centered, clipped mid-cluster, overpainted by a border; rows exactly
  `width` cells; `charIndexAtCell` on both cells; selection paint over
  a focus-inverted control.

### 4. DOM adapter

- paint.ts: `paintGrid(root, target, options)` with `holdStructural`,
  `boxed`, `selection`; boxed segments become spans with the box
  styles (inline-block, `cells × --mw-cw`, scaled font-size, clip,
  centered); per-ROW structure match so a selection change patches
  only the rows whose segments changed; `cellOffset(target, col, row)`
  from the kept cell strings replaces `#gridOffsetAt`.
- `glyph-box.ts` (DOM): `glyphBox(cluster, font, cellWidth,
cellHeight)` → `{ scale } | null`, canvas-measured, cached per font
  string; no canvas (tests) → never boxed. Tolerance 0.01 cell; scale
  = cells × cw ÷ advance, capped by the ink height and width.
- element.ts pins `#grid`'s line-height to the measured cell height.

### 5. Selection: painted and routed

- selection.ts `selectedRanges(root, points)`: the leaves a light
  range intersects with their character ranges (renderer leaves whole).
- element.ts: `selectionchange` → one frame → repaint with the
  selection map (any host whose light DOM holds the range); the paint
  after a layout carries the current map too. Text-mode press and drag
  (`#startTextDrag`, `#extendTextDrag`): non-interactive target only;
  cell → innermost text leaf → `charIndexAtCell` → `positionOf`; a
  blank cell resolves to the nearest character on its row (left, then
  right), else the nearest row; Shift extends; double/triple reuse the
  gestures; a pointer past the host clamps. Keyboard extension native.
- styles.css / shadow CSS / @monowind/ascii: light `::selection`
  transparent outside `forced-colors: active` and off form controls;
  `#grid::selection` keeps the invert; the focus-visible swap and
  `data-mw-center-nudge` (render.ts, styles.css) go.

### 6. Stories, visual sweep, docs

- Storybook: `Test / Wide` (rows, box widths, row height; text-mode
  press/drag/Shift/word/paragraph/copy; painted cells for a drag, a
  keyboard extension, a focused control; textarea rows); Features
  "Wide characters" story for the sweep; selection goldens
  re-baselined; the Semantic/HostText fixtures re-pointed at the paint.
- Docs: cell-model.md (deviation 10, Selection, Text alignment),
  semantic-selection.md, README, core-architecture.md; the spec's
  status → implemented.
