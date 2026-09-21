# A theme declares the glyphs its font has not got

## The bug

`borders-rounded` (or `borders-default`) on a theme whose font has no
arc draws a broken corner: `theme-dos`, `theme-dos-blue`,
`theme-green-phosphor`, `theme-amber` and `theme-bbs` all wear
`Web IBM VGA 8x16`, which has `│` and `─` on the cell and no
`╭ ╮ ╰ ╯` at all. The substitute advances 9.633px in an 8px cell, so
the box scales it 0.83 to keep the grid — and a glyph scaled to its
width cannot also fill the row's height, since `font-size` scales both
axes together. Measured on the left border of a `borders-rounded` box
under `theme-dos` (device px at dpr 4, rows 64px from y=64):

```
cp437 box   (the font HAS ┌ and │)    ink 91 → 223              unbroken
rounded box (the arc is substituted)  ink 94→123, gap, 127→219  breaks at the row edge
```

The arcs are the DEFAULTS', not just the `rounded` set's —
`DEFAULT_BANDS` gives `solid`, `dashed` and `dotted` an `ARCS` band at
radius 1 — so any `rounded-*` radius draws them unless the active set
registers `rounded: []`, which is exactly what `cp437`, `single` and
`blocks` do.

## What is actually missing

theming.md already calls this out: "Font pairing is the theme's
responsibility: a glyph missing from the themed font falls to the
fallback font, whose different advance can drift the grid — themes
pair sets with fonts verified to cover them." The themes did their
part. The gap is that a theme can say WHICH SET to use and not WHAT
ITS FONT LACKS, so the only way to express a gap today is to bake it
into a set — which an author overrides the moment they name another.

Those are two axes:

- a **set** is the vocabulary an author wants (rounded, ascii, blocks),
- a **font** is what can actually be drawn.

The engine composes them per glyph, which the registry already does
for partial sets. Only the second axis has no voice.

## The rule

**A glyph the theme declares missing counts as not registered.**

An inherited custom property beside `--mw-border-glyphs`, holding the
characters the font has not got:

```css
mono-wind.theme-dos {
  --mw-border-glyphs: cp437;
  --mw-missing-glyphs: "╭╮╰╯";
}
```

`style.ts` reads it where it already reads `--mw-border-glyphs`, and
drops those glyphs from the set it resolved. `cornerGlyph` then finds
no band offering a corner and falls back to the weighted table's
square `plain` one — the path that exists. `borders-rounded` on a VGA
theme draws the corner the font has, like `cp437` does today.

Declared, not measured, which is the whole point:

- no canvas measurement, so the grid's TEXT keeps being decided
  without it — a document yields the same cells in Node and the
  browser, and does not change characters when a webfont lands;
- no heuristic that can misfire on a font that has the glyph but
  advances it oddly;
- no scope limit to the tiling ranges — any character can be declared,
  blocks and shades included;
- additive: absent the property, behaviour is exactly today's;
- it generalises past the fonts we ship — anyone pairing a set with
  their own font declares what it is missing the same way.

## Design

- `style.ts` reads `--mw-missing-glyphs` next to `--mw-border-glyphs`,
  normalizing to a set of clusters (quotes stripped; whitespace and
  commas separate, so `"╭ ╮"` and `"╭,╮"` both work).
- `glyphs.ts` gains `withoutGlyphs(set, missing)`: a shallow copy with
  every named glyph in `missing` removed, role by role, through
  `rounded` bands, `weights` bands, `scrollTrack`/`scrollThumb`, `qr*`
  and the `shadow` ramp. An emptied band drops out, which leaves the
  square corner. Nothing missing returns the original object, so the
  common path allocates nothing.
- Memoised per `(set name, raw property value)` — both plain strings,
  looked up through a two-level map so a hit costs no allocation on a
  path that runs per element, per layout. `registerBorderGlyphs` clears
  both maps, a derived set being a copy of one that just changed.
- The node keeps carrying a NAME, as today, so the ten
  `glyphSetFor(style.glyphSet)` call sites in borders/table/flex/grid/
  multicol are untouched: derived entries live in their own map that
  `glyphSetFor` consults first, keyed beyond what a CSS ident can
  spell.

## Checks

- Unit: a set whose corner band names `╭`, with a missing list holding
  it, resolves `cornerGlyph` to the square corner; the same set with an
  empty missing list returns the identical object.
- Unit: a missing glyph in a weight band, the scroll ramp and the QR
  roles each falls back rather than painting the declared character.
- Story: `Test / Themes → Glyph Sets On Every Font` holds every set
  against every period font, and asserts per host that nothing that
  host declares missing reaches its grid — a stronger check than
  hunting a broken stroke, and one that stays true as themes change.
- Six themes declare `╭╮╰╯` — the five on the VGA font and teletype on
  Courier New; c64 declares nothing, its Pet Me 64 drawing the arc at
  its cell (measured 16px in a 16px cell). Teletype is the case that
  proves the rule has to be declared: its substitute advances 9.03px
  against a 9.0156px cell, within the tolerance that boxes a glyph, so
  no measurement can find it — only the golden shows it.

## Not in scope

Fitting a substituted glyph to both its cell and its row: it needs a
non-uniform scale, so a transform on an inner element and a second node
per glyph. Degrading away from the glyph beats placing it well.

Detecting the missing glyphs by measurement. It was the first draft of this plan and
it is worse on every axis that matters: it would make the grid's text
depend on canvas measurement (so Node and the browser would disagree,
and characters would change when a webfont loaded), it can only infer
coverage inside U+2500–U+259F, and it misfires on a font that has a
glyph but advances it oddly.
