# Spec: table layout

Status: implemented (`table.ts`; lattice glyphs in `borders.ts`).
Cell-unit fundamentals (rounding, box model) live in `cell-model.md`;
column sizing reuses the integer-distribution and intrinsic-contribution
machinery from `flex.md`/`grid.md`. The normative sources are CSS 2.1
§17 (the only finished table spec; css-tables-3 is a non-normative
elaboration of the same model) and the WHATWG HTML rendering section.
Deviations are listed at the end.

## Reading table styles

Roles come from the computed `display` — `table`, `inline-table`,
`table-row-group` / `table-header-group` / `table-footer-group`,
`table-row`, `table-cell`, `table-caption`, `table-column`,
`table-column-group` — so `<table>`/`<tr>`/`<td>` (via UA styles) and
Tailwind's `table`, `table-row`, `table-cell`, … utilities on divs read
identically. Reads happen while `[measuring]` is set, before the
companion stylesheet absolutizes laid-out elements, so the table-internal
displays are still intact (absolute positioning would blockify them —
that is what neutralizes the browser's native table layout afterwards,
same trick as grid).

No used-value traps: `table-layout`, `border-collapse`, `border-spacing`
(px → cells per axis), `caption-side`, and `vertical-align` all read
from computed style — the companion's baseline lock (and the forced
`text-align: start` on blocked elements) is measuring-gated, so the
reader sees the authored/UA values from any authoring, Tailwind or
plain CSS. The UA's `td`/`th { vertical-align: middle }` arrives the
same way. `colspan`/`rowspan` are HTML content attributes
on `<td>`/`<th>` (CSS has no span property, so div-tables can't span);
parsed per HTML: `colspan` clamped to 1–1000, `rowspan` to 0–65534, and
`rowspan="0"` spans to the end of the row group. `<col>`/`<colgroup>`
`span` attributes and widths are read for column sizing. The legacy
`valign`/`align` attributes work through their computed forms (browsers
map presentational hints into computed style — `align` surfaces as
vendor-prefixed centering); direct attribute reads remain only as
fallbacks for environments that don't map hints (happy-dom).

## Scope

- Automatic table layout (`table-layout: auto`, the default): column
  widths from cell content.
- Fixed layout (`table-fixed`): widths from `<col>`s and the first row;
  content never widens a column.
- `colspan`/`rowspan`, including `rowspan="0"`.
- Row groups (`thead`/`tbody`/`tfoot`), rendered header-first and
  footer-last regardless of DOM order, per HTML.
- `border-collapse: collapse` (Tailwind preflight's default for
  `<table>`) as a shared box-drawing lattice with junction glyphs, and
  `border-separate` + `border-spacing-*`.
- `<caption>` with `caption-side` top/bottom.
- `inline-table` as an atomic inline box (same machinery as
  `inline-grid`).

Out of scope for now (see Deviations): anonymous table-box generation,
`empty-cells`, `visibility: collapse`.

## Structure

The tree builder maps roles structurally: a table box contains an
optional caption, column boxes, and row groups; row groups contain rows;
rows contain cells. Rows directly in the table act as one implicit
group. `<col span>` expands to that many columns; a `<colgroup>` with no
`<col>` children uses its own span.

CSS generates anonymous boxes around misparented content (§17.2.1); we
don't. Content that isn't where the model expects it — text or non-row
children in a table, non-cell children in a row — is hidden and warned
about once, the same pattern as dropped text in `cell-model.md`. Real
HTML tables are always well-formed (the HTML parser guarantees it);
this only bites hand-rolled div-tables.

Cell placement is the grid auto-placement cursor specialized: rows are
definite (one per `table-row`), cells fill left-to-right skipping slots
occupied by earlier `rowspan`/`colspan` cells, never dense. The column
count is the widest row's extent. Missing cells leave holes (no box, no
borders).

## Column sizing — automatic

CSS 2.1 §17.5.2.2, integer-adapted; contributions and distribution reuse
the grid track machinery.

1. Per column: **min width** = max over its cells of their min-content
   outer width, **max width** = max of their max-content outer widths.
   A cell-count `w-*` on a cell or `<col>` REPLACES the max contribution
   (floored at the content min — a width can't shrink a column below its
   content, and doesn't raise its min, per CSS 2.1); a percent width
   leaves the column's intrinsic sums content-based and acts through
   inflation (step 3) and resolution (step 4).
2. Spanning cells distribute their excess (contribution minus what the
   spanned columns already provide, minus the chrome between them) in
   ascending span order, proportionally to the spanned columns' max
   widths — equal shares when all are zero — using the shared integer
   distribution.
3. Used table width: an authored width is honored but floored at the
   min-width sum plus chrome (border/spacing cells); `auto` shrink-to-
   fits: `max(min-sum, min(max-sum, available))`, all including chrome.
   Percent columns inflate the max sum (the css-tables-3 rule, which
   CSS 2.1 leaves undefined): each percent column demands
   `its max ÷ p`, the non-percent columns together demand
   `their sum ÷ (1 − Σp)`, and the max sum is the largest demand —
   `Σp ≥ 100%` demands everything, so `min(…, available)` yields the
   full available width. Inflation is skipped when available is
   indefinite (the table's own intrinsic sizing): percents behave as
   auto there, grid's indefinite-axis rule.
4. Percent widths resolve now, against the used content width (used
   table width minus chrome) — the same rule as percent flex bases and
   percent grid tracks against a definite axis, possible here because
   step 3 fixes the table width before distribution. Each percent
   column's target is the rounded share, floored at its min width;
   percents summing past 100% scale down proportionally, and targets
   shrink further (proportionally to `target − min`, via the shared
   integer distribution) if the non-percent columns would otherwise
   drop below their min widths — the step-3 floor guarantees all-mins
   always fits. Percent columns are pinned at their targets and sit
   out of step 5.
5. The remaining columns start at their min widths and grow toward
   their max widths, extra distributed proportionally to `max − min`.
   Width beyond the max sum is distributed proportionally to the max
   widths (equal when all zero).

The table's intrinsic min/max content widths (as a flex/grid item, or
for abspos shrink-to-fit) are the step-3 sums.

## Column sizing — fixed

`table-layout: fixed` applies only with an authored (non-auto) width —
a width-auto fixed table uses the automatic algorithm, like every
browser (probed; CSS 2.1 §17.5.2 allows it). The used table width is
then definite, so percents resolve against it directly. Column widths
come from `<col>` widths, then the first row's cells (a spanning cell
splits its width equally);
columns still unsized share the remaining table width equally (integer
distribution). Cell content is never measured — overflow clips per the
cell's own overflow handling. A width sum exceeding the table width
wins (the table overflows, per CSS).

## Row sizing

A row's height is the max of its cells' content heights laid out at the
final column widths (plus each cell's vertical chrome), floored by any
`h-*` on the row or its cells. Percent heights resolve against a
DEFINITE table height (minus caption and border chrome) and pin their
rows — the leftover goes to the other rows, and an auto table height
ignores them; probed: all three engines agree (CSS 2.1 declines to
define it). `rowspan` cells contribute like spanning grid items: ascending
span, excess over the spanned rows distributed equally. Authored table height beyond the row sum is distributed equally
to the rows (CSS leaves this undefined; browsers vary).

## Cells

A cell is a normal block container: own padding, borders (drawn as its
own ring in the separate model, contributed to the lattice when
collapsed), background, and nested layout at its final column width.
An explicit cell height makes the natural box taller (flooring the row
through it), but `vertical-align` still positions the CONTENT within
the final area, per CSS — alignment works from the content-derived
height. A cell whose direct children have percent heights is laid out
a second time at its final area height so they resolve against it —
the browsers' legacy pass (percent heights never contribute to the row
height itself; that would be circular).
`vertical-align: top | middle | bottom` normalizes to the engine's
`start | center | end` and goes through the shared alignment-offset
machinery (`center` floors the extra, as everywhere); `baseline` maps to
`start`, the same rule as `items-baseline` in flex/grid — and exact for
us: with one shared font size all first lines have identical metrics, so
baseline alignment degenerates to top alignment. The default is
`center` on `<td>`/`<th>` (UA `middle`, probed in all three engines;
the companion's lock hides it, so the tag decides) and `start` on
div-cells (CSS initial `baseline`). `text-align` follows the
cell-model rules (start/center/end honored, justify blocked) — the
UA's `th`/`caption` centering applies as-is, engine-quantized. The
legacy `align` attribute maps through the same reader.

## Borders — collapsed

Tailwind preflight sets `border-collapse: collapse` on `<table>`, so
this is the default in practice — and it is exactly the TUI drawing
model: adjacent cells share single border lines.

Geometry: a border lattice of vertical lines at column boundaries and
horizontal lines at row boundaries, each line as many cells wide as the
widest border meeting it (0 when none). Cells sit between the lines;
the table's border box includes the outer lines fully. CSS centers
collapsed borders on the grid line with halves sticking out of the
table; whole cells can't split, so the full line width lives inside —
the integer analog, documented as a deviation.

Conflict resolution at each line segment, per §17.6.2.1: `hidden` wins
(suppresses the segment), then wider border, then style rank (`double` >
`solid` > `dashed` > `dotted`), then origin (cell > row > row group >
table; `<col>`/`<colgroup>` borders are not read — they carry widths
only). Color comes from the winner.

Rendering: junction glyphs. At each lattice intersection the glyph is
picked from which of the four arms exist — `┼ ├ ┤ ┬ ┴ ─ │` and the
corners — extending `borders.ts` with T- and cross-junction tables per
border style; mixed-style junctions fall back to the light set, the
existing corner convention. Line segments bordering a hole (missing
cell) exist only if the other side has a cell or is the table edge.

## Borders — separate

`border-separate`: every cell draws its own full border ring through the
existing box machinery, `border-spacing` cells (quantized per axis)
between cell border boxes and between cells and the table's own border.
HTML's UA default spacing of 2px quantizes to 1 cell at typical roots;
preflight's collapse default means this only appears when authored.

## Caption

`display: table-caption` lays out as a block spanning the used table
width, above the table box for `caption-side: top` (default), below for
`bottom`; it sits inside the table's margin box (margins on the table
wrap caption and grid together, per CSS). Margins on the caption itself
are ignored.

## Interaction with the rest of the engine

- A table is a normal box to its parent: block flow (auto margins
  center it), flex/grid item (intrinsic widths from the column
  algorithm), abspos child.
- `inline-table` rides text runs as an atomic inline box (U+FFFC
  marker), like `inline-grid`.
- Cells are containing blocks for their content as ordinary blocks;
  `relative` on a cell works for abspos descendants.
- Browser side, laid-out cells/rows/groups are absolutized by the
  companion stylesheet, which blockifies their computed display — the
  native table layout dissolves and every box lands where the engine
  says, no table-specific resets needed. The table element itself is
  absolutized and blockified the same way; reads stay honest because
  they happen under `[measuring]`, with the locks off.

## Deviations from CSS tables

1. **No anonymous table boxes** (§17.2.1). Misparented content is hidden
   with a one-time console warning instead of being wrapped. Well-formed
   HTML tables are unaffected.
2. **Collapsed borders live inside the table** — no half-border overhang
   past the border box; the lattice occupies whole cells between and
   around the cells.
3. **Percent inflation follows css-tables-3, capped at the available
   width** (CSS 2.1 leaves it undefined; probed: all three engines
   match the formula on single-row cases, within a pixel). In intrinsic
   (indefinite-available) contexts percents behave as auto, as in grid.
4. **`baseline` vertical alignment behaves as `start`** — the flex/grid
   rule, and exact under the single-font-size model (see Cells).
5. **Extra table height is distributed equally to the non-percent
   rows** (undefined in CSS; browsers vary).
6. **`empty-cells` and `visibility: collapse`** on rows/columns are not
   supported.
7. Everything in `cell-model.md` (rounding, integer distribution ties)
   applies.
