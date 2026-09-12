# Spec: gradients

Status: **proposed** (2026-09-12), awaiting review. Cell-unit
fundamentals live in `cell-model.md`; backgrounds in `cell-model.md`
"Box model" (the border-box fill); shade glyphs, which this does NOT
use, in `box-shadow.md`.

## Motivation

`bg-linear-to-r from-cyan-500 to-blue-600`, a radial glow, a conic
sweep: a gradient background on a character grid is a color per cell,
the way a terminal with true color paints one. The dithered ANSI-art
look was weighed and set aside: a glyph-based ramp breaks wherever a
cell holds a character or a line gap separates rows.

## Reading

`background-image` is read from the computed value per element: a
comma-separated list of layers, each a `linear-gradient()`,
`radial-gradient()`, or `conic-gradient()` (their `repeating-`
forms too), or something else (`url()`, `none`), which is ignored.
Each gradient's direction (an angle, `to <side-or-corner>`, a radial
shape and position, a conic angle and position), its interpolation
hint (`in oklab`, Tailwind's default, or `in srgb`, …), and its color
stops (computed colors with optional positions in percent or px)
are parsed. Positions in px convert on the spacing scale.

## Locked decisions

- **A gradient is a color per cell.** Over the element's border box
  (the CSS default painting area), each cell takes the gradient's
  color at its center: the cell's center projected onto the gradient
  line (linear, the line's length CSS's for the angle and the box),
  its distance to the center in the ellipse's metric (radial, the
  `farthest-corner` ellipse at the center by default, the sizes and
  shapes CSS names), or its angle (conic, `from` and `at` honored),
  with the stops resolved as CSS resolves them (missing positions
  spread evenly, hints honored, repeating forms tiled) and
  interpolated in the named color space (oklab and srgb at least;
  others fall back to oklab). A cell is a grid cell, not a square: the
  math runs in px from the measured cell, so a diagonal is CSS's
  diagonal. The cell's glyphs keep their color; only
  the background changes, as with any fill.
- **It is the box's fill.** The gradient replaces the plain
  background fill in the paint walk: it wipes ancestor decorations at
  its cells like `bg-*` does, layers paint from the last declared to
  the first (the first on top), a `background-color` under them shows
  through transparent stops as CSS composites it — approximated by
  compositing each cell's color over the plain color — and `bg-clear`
  keeps its wipe under a gradient with transparent stops.
- **The light DOM's own gradient is off**: the companion locks
  `background-image: none` beside its `background-color` lock; the
  grid owns backgrounds.
- **Selection inverts the cell's own color**, as it does for any
  filled cell: a selected cell swaps its glyph color and its gradient
  color.

## Deviations from CSS (summary)

1. One color per cell, at the cell's center: a gradient's edge within
   a cell is quantized to the cell.
2. `background-size`, `background-position`, `background-repeat`, and
   `background-clip` are ignored: a gradient always covers the border
   box once.
3. `url()` images are ignored.
4. Interpolation spaces other than oklab and srgb interpolate in
   oklab.
5. Cost: a row of a gradient is one span per distinct color, so a
   wide gradient is a span per cell on every row it covers. Fine for
   a card or a bar; a full-page gradient is a large grid.

## Testing

- Node: the read (Chromium's serialization of Tailwind's utilities,
  angles and corners, stops with and without positions, hints, the
  interpolation space, several layers, `url()` ignored); the paint —
  a two-stop horizontal gradient's colors per column, a vertical one
  per row, a diagonal, a radial's rings, a conic's sweep, stops at
  positions, a translucent stop over a `background-color`, glyphs
  keeping their color, selection inverting a cell.
- Storybook: Tailwind's `bg-linear-*` presets with `from-*`/`via-*`/
  `to-*`, a radial and a conic, text over a gradient card, a
  selection across it; golden.

## Touch points on implementation

- style.ts / types.ts: `backgroundImage: Gradient[]` on `CellStyle`,
  the parser (colors, stops, directions, spaces).
- A `gradient.ts` module: the color at a cell (direction math, stop
  resolution, oklab/srgb interpolation, compositing).
- plain-text.ts `walk`: the fill step paints per-cell colors when
  gradients are present.
- styles.css: the `background-image: none` lock.
- cell-model.md: the box-model fill sentence points here.
