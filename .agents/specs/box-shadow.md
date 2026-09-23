# Spec: box shadows

Status: **normative, implemented** (2026-09-12). Cell-unit
fundamentals live in `cell-model.md`; glyph sets and their roles in
`theming.md`.

## Motivation

The DOS window shadow: a box offset a cell right and down, drawn in a
shade behind it. Tailwind's `shadow-*` utilities and arbitrary
`shadow-[…]` values, on the grid.

## Reading

`box-shadow` is read from the computed value, a comma-separated list
of shadows, each a color, two to four lengths (`x y blur spread`, px
once computed; a bare `0` is read too), and an optional `inset`. The
offsets are a displacement and convert PHYSICALLY, by the measured
cell (`x` by the cell's width, `y` by its height, rounded, a nonzero
offset at least one cell): Tailwind's presets sit a row below the box
as they do on screen, and a `4px` DOS offset is one cell. The spread
converts on the spacing scale, rounded; the blur stays unrounded for
the ring count, on the spacing scale too, so softness grows with the
preset (`shadow-md` one ring, `-xl` three, `-2xl` six). The color is
the computed one (`currentcolor` spelled out by the browser); a
translucent one reads as a lighter shade (Locked decisions). `inset`
marks a shadow drawn inside the padding box.

## Locked decisions

- **A shadow is the box's silhouette in a shade.** The border box
  moved by `x` and `y` and grown by `spread` on every side is the
  shadow's core; blur adds `round(blur / 2)` rings around it (CSS
  blurs with a standard deviation of half the radius, and the rings
  stop there, short of its faint tail), each ring lighter than the one
  inside it.
- **The shades come from the owner's glyph set**: the set's `shadow`
  ramp lists glyphs from densest to lightest, `█ ▓ ▒ ░` by default
  (`ascii`: `# + : .`). The core draws the base glyph; the rings fade
  from it to the lightest glyph at the outer edge — the ring at
  distance `d` from the edge (0 the outermost) draws the glyph at
  `base + round((rings − d) × (last − base) / rings)` — and each ring's
  ink fades toward transparent by `(d + 1) / (rings + 1)`, a level per
  ring whatever glyphs are left, so an opaque shadow with a two-cell
  blur runs `█ ▒ ░` outward, the `░` at a third.
- **A translucent color is a lighter shade, leaning on the theme's
  foreground.** The color's alpha picks the base glyph,
  `round((1 − √alpha) × last)`: opaque is the densest, a tenth the
  second-lightest (`▒`), leaving blur room to fade to `░`; and the ink
  is the color mixed toward `--mw-fg` by the rest of its alpha
  (`color-mix(in srgb, <color> <alpha>%, var(--mw-fg))`) — so
  Tailwind's default, black at a tenth, is the text's shade on a light
  theme and a dark one alike, where the browser's own would vanish into
  a dark page; an opaque color paints as itself. A shadow cell keeps
  its background; the glyph beneath is replaced.
- **Painted behind the box, over what painted before it**: a shadow's
  cells go down at the element's paint step, before its own
  background fill — later siblings cover it, earlier ones are covered,
  as CSS layers backgrounds — and never inside the border box, which
  CSS clips an outer shadow from. Shadows paint from the last declared
  to the first, so the first is on top, as CSS. A clipping ancestor
  culls a shadow with the rest of the element's ink.
- **An inset shadow lights a rectangle inside the padding box**: the
  padding box moved by `x` and `y` and shrunk by `spread` is lit, and
  the padding box around it is the shadow, its rings fading INTO the
  lit rectangle over `round(blur / 2)` cells. It paints after the
  box's own background fill and before its borders and text, as CSS
  layers it, so text sits on the shade and the border covers its edge.
- **The light DOM's own shadow is off**: the companion locks
  `box-shadow: none` on every element, like backgrounds — the grid
  owns the shadow, form controls included.

## Deviations from CSS (summary)

1. An inset shadow's cells are whole cells of the padding box; under
   text, the glyph is the text's and the shade shows only around it.
2. Blur is stepped by the cell: `round(blur / 2)` rings, each one
   glyph and ink level; a blur under a cell adds none.
3. A shadow covers the glyph beneath (one glyph per cell); a color's
   alpha is a shade and a lean on the foreground, not a blend with
   the cell.
4. Overlapping shadows never blend — the earlier-declared paints on
   top.
5. Offsets are physical cells with a one-cell floor, the rest on the
   spacing scale: `shadow-md` (0 4px 6px −1px) is one row down with
   one ring and no spread.

## Testing

- Node: the read (Chromium's serialization, bare zeros, several
  shadows, `inset` kept, a keyword and a function color, physical
  offsets against measured cells with the one-cell floor); the
  paint — an offset shadow's L shape beside and below the box, the
  cells under the box untouched, spread, blur rings from the ramp,
  two shadows with the first on top, the `ascii` ramp, a translucent
  color's shade and lean, a transparent one painting nothing, the
  rings' ink fading by level, an inset shadow's strip inside the
  border with its offsets, blur, and spread.
- Storybook: the DOS shadow in the theme foreground, the `shadow-md`
  to `-xl` presets (rings), a spread-only ring, the `ascii` ramp, an
  inset DOS shadow and `shadow-inner`; golden.
