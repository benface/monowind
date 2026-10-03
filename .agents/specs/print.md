# Spec: print

Status: **specified 2026-10-01**, not implemented; its decisions taken
with the user the same day ("Decisions").

## Why

Printing a monowind page today prints its last screen layout as it
stands: the grid keeps the screen's width in px and overflows a
narrower page (a layout waits for an animation frame, which the switch
to print need not give before its snapshot), every cell's color is a
literal inline style no print stylesheet reaches, so a dark theme
prints pale text on white once the printer drops backgrounds, and a
gradient's text disappears with them. A text UI should print the way a
terminal's text prints: the page's own width in columns, ink on paper.

## Layout for the page

- **When the page switches to print, every host lays out at once**,
  synchronously, for the printed page; when it switches back, again
  for the screen. Nothing waits for a frame. The moment is the
  earliest of `beforeprint` and the change of the `print` media query
  at which an engine already computes print styles, the moment chart
  libraries resize at (each engine yet to be probed).
- **The page's width in columns** is the first of these that answers
  — the cell stays the screen's, and the rows follow from the layout
  at that width:
  1. `--mw-print-columns` on the host, a whole number;
  2. the host's width under print media, where the engine can measure
     it before the snapshot (each engine yet to be probed);
  3. 80 columns, a terminal's.
- **Page breaks fall between rows**: a box taller than what is left of
  a page continues on the next at a row boundary, as the grid's lines
  are the page's lines.
- What a scroller shows is what it prints, as in CSS: content scrolled
  out of view is not printed.

## Color on paper

- **By default a print is ink on paper**: every glyph in the print
  ink (black), no cell fills, and text a gradient colors drawn in the
  ink, so nothing depends on the printer's background setting. Borders,
  rules, shadows and shades are glyphs and print as such. Images print
  as drawn (`images.md`).
- **`print-color-adjust: exact`** on the host, or `print-color-adjust`
  `exact` inherited by it, prints the screen's colors and fills
  instead, for a page meant to print as it looks.
- The focus invert and the grid's selection highlight do not print.

## What the engine reads

The engine reads computed styles, as always, at that moment: where an
engine computes print styles there, Tailwind's `print:` variants and
every `@media print` rule reach the grid's layout and paint, and the
host's width is the page's. Where none does, the engine applies the
page's `@media print` rules itself for the print layout — copied,
layer and all, into a sheet of its own for as long as the print
lasts — from every sheet it may read; a cross-origin sheet's are
left out (`sheets.ts` reads only those it may, as for counter styles).
`--mw-print-columns` and `print-color-adjust` are read the same way.

## Decisions (2026-10-01, with the user)

1. **The page's width**: the host's width under print media where an
   engine lets it be measured in time, `--mw-print-columns` to set it,
   80 columns when neither answers.
2. **Ink on paper by default**, the screen's colors on
   `print-color-adjust: exact`.
3. **`print:` variants reach the grid**: read under print media where
   an engine computes it in time, applied by the engine itself where
   none does.

## Deviations from CSS

1. Where the engine applies `@media print` rules itself, a
   cross-origin sheet's are left out of the grid (native regions,
   which the browser draws, take them all), and a copied rule comes
   after the page's own in source order, so it wins a tie a
   same-layer rule printed earlier would have lost.

## Testing

- Node: the column count's order of precedence; the ink-on-paper
  paint (no fills, ink color, gradient text in ink) and `exact`
  keeping the screen's.
- Browser: the switch to print laying out synchronously at the print
  width, a `print:` variant applied, and the switch back, in every
  engine; a print-media emulation
  (Playwright's `emulateMedia({ media: "print" })`) of a tall page,
  its rows split across pages.
- Visual: a printed page's PDF (Chromium's `page.pdf()`) rasterized,
  for a light and a dark theme.

## Touch points on implementation

None until implemented: this section maps the code once it lands.
