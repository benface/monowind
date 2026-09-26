# Spec: gradients

Status: **implemented** (2026-09-12; `color.ts`, `gradient.ts`, the
`backgroundImage` read in `style.ts`, the fill in `plain-text.ts`). Cell-unit
fundamentals live in `cell-model.md`; backgrounds in `cell-model.md`
"Box model" (the fill, inside the box `background-clip` names); the
shade glyphs of shadows in
`box-shadow.md`.

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
space (`in oklab`, the default, or `in srgb`, `in oklch longer hue`,
…; srgb where every stop is a legacy `rgb()` color, as CSS defaults),
and its color stops (computed colors with optional positions in
percent, px, or, for a conic, an angle, and transition hints) are
parsed. Positions in px convert on the spacing scale.
`background-clip` is read beside it: `border-box` (the default),
`padding-box`, `content-box`, or `text`.

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
  interpolated in the named color space (oklab, oklch, srgb,
  srgb-linear, hsl, the polar ones with the four hue modes; others
  fall back to oklab). A cell is a grid cell, not a square: the math
  runs in px from the measured cell, so a diagonal is CSS's diagonal.
  The cell's glyphs keep their color; only the background changes, as
  with any fill.
- **It is the box's fill.** The gradient replaces the plain
  background fill in the paint walk and paints over what ancestors
  painted at its cells as `bg-*` does, their glyphs hidden and its
  color over their background. Layers paint from the last declared to
  the first (the first on top); a `background-color` under them shows
  through transparent stops as CSS composites it, approximated by
  compositing each cell's color over the plain color; and `bg-clear`
  keeps its wipe under a gradient with transparent stops.
  `background-clip` says where the fill paints — the border box, the
  padding box, or the content box, the gradient's geometry the border
  box's either way — and `text` paints no fill at all: the box's own
  glyphs take the gradient's color at their cell, each glyph's own
  color composited over it, so `text-transparent` shows the gradient
  through the text and an opaque color hides it, as CSS clips the
  background to the glyphs. The plain `background-color` clips the
  same way, to a box or to the text. An inline element's `opacity`
  composites the tinted glyph as a group (cell-model.md) after that,
  as Firefox draws it — Chromium draws them whole and WebKit not at
  all (probed 2026-09-23).
- **The light DOM's own gradient is off**: the companion locks
  `background-image: none` beside its `background-color` lock; the
  grid owns backgrounds.
- **Selection inverts the cell's own color**, as it does for any
  filled cell: a selected cell swaps its glyph color and its gradient
  color.
- **A run of gradient cells is one span.** A gradient box computes a
  color per cell once per layout, kept between layouts. In the DOM a
  run of cells apart only in their gradient background is one span,
  its colors as hard stops of a `linear-gradient` at the cell width; a
  run of gradient-colored glyphs likewise, the stops shown through the
  text, where the cells have no background of their own (a span's text
  clip would clip that away, and Firefox draws no per-layer clip).

## Deviations from CSS (summary)

1. One color per cell, at the cell's center: a gradient's edge within
   a cell is quantized to the cell, and a px length in it (a stop
   position, a radius, a position) is cells of the cell width on the
   spacing scale, whichever axis it lies on.
2. `background-size`, `background-position`, and `background-repeat`
   are ignored: a gradient always covers the border box once.
   `background-clip: text` colors whole glyph cells, where CSS clips
   to the glyph shapes, and applies to the box's own text; the clip is
   read once, the first layer's, for every layer.
3. `url()` images are ignored.
4. Interpolation spaces other than oklab, oklch, srgb, srgb-linear,
   and hsl interpolate in oklab.
5. An editable's native selection (`styles.css`, its `--mw-ground`)
   sits on the plain `background-color` under a gradient, not on the
   gradient's color at its cells.
6. An hsl saturation below 0 (a color outside sRGB, Tailwind's
   wide-gamut `oklch()` colors among them, which mix and paint
   unclipped and clip to sRGB only to composite, cell-model.md
   "Opacity and translucency") mixes as it is, as Chromium and
   Firefox mix it, where css-color-4 turns the hue half round, as
   WebKit does (probed 2026-09-23).

## Testing

- Node: the read (Chromium's serialization of Tailwind's utilities,
  angles and corners, stops with and without positions, hints, the
  interpolation space, several layers, `url()` ignored); the paint —
  a two-stop horizontal gradient's colors per column, a vertical one
  per row, a diagonal, a radial's rings, a conic's sweep, stops at
  positions, a translucent stop over a `background-color`, glyphs
  keeping their color, selection inverting a cell; the clip boxes and
  the text clip over transparent, opaque, and translucent glyph
  colors; the hue modes on red to blue in hsl; the span runs.
- Storybook: Tailwind's `bg-linear-*` presets with `from-*`/`via-*`/
  `to-*`, radial and conic forms, layers, a translucent stop over a
  plain color, text over the cards; golden. Selection inverts per
  cell as for any fill, pinned in the node tests.

## Touch points on implementation

- style.ts: `readBackgroundImage`, the parser (colors, stops,
  directions, spaces, hue modes), and the `background-clip` read.
- types.ts: `backgroundImage: Gradient[]` and `backgroundClip` on
  `CellStyle`.
- color.ts: computed colors parsed (`lab()`, `lch()` and every
  `color()` space among them, cell-model.md "Opacity and translucency"),
  prepared per space, mixed with the hue modes, composited clipped to
  sRGB, written unclipped.
- gradient.ts: the color at a cell (direction math, stop resolution,
  compositing), kept per box.
- plain-text.ts `walk`: the fill step paints per-cell colors when
  gradients are present, a plain color or a gradient inside the
  `background-clip` box (`backgroundInset`), which the store blends
  over the cells beneath; the leaf's paint tints a glyph through the
  palette (cell-model.md "Opacity and translucency").
- styles.css: the `background-image: none` lock.
- cell-model.md: the box-model fill sentence points here.
