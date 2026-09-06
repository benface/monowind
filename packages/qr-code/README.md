# @monowind/qr-code

Scannable QR codes on the [monowind](https://github.com/benface/monowind)
grid: the `<mono-qr>` element.

```html
<mono-qr class="mx-auto px-4 py-2">https://play.monowind.benface.com</mono-qr>
```

The element's text is the value. The code renders as block glyphs on
the grid, packed to the font's real cell proportions — half blocks
where a cell is twice as tall as wide, so a version-1 code is 21
columns by 11 rows — while the light DOM keeps the value for screen
readers. A drag over the code selects its characters (a transparent
transcript in the element's shadow), and a copy pastes into a
terminal as a working code.

The rows are the bare symbol: give it the light margin readers need
(the _quiet zone_, four modules in the QR standard) as padding —
`px-4 py-2` at the usual cell, `px-2 py-1` where most phones still
cope — or blank surroundings. Utilities style it: `text-*` sets the
modules' color, `bg-*` the background, padding included;
`bg-white text-black` is a guaranteed-normal code on any theme, and
it behaves like a replaced element (`mx-auto` centers it).

## Setup, by integration

**Your own Tailwind v4 build, or `@monowind/vite`** — import the
element and the companion styles next to monowind's:

```ts
import { defineMonoWind } from "monowind";
import "@monowind/qr-code";

defineMonoWind(); // `@monowind/vite` does this for you
```

```css
@import "tailwindcss";
@import "monowind";
@import "@monowind/qr-code";
```

**CDN, no build** — one script after monowind's:

```html
<script src="https://unpkg.com/monowind/dist/cdn.js"></script>
<script src="https://unpkg.com/@monowind/qr-code/dist/cdn.js"></script>
```

## Attributes

- `level` — error correction, `L` `M` `Q` `H` (7%, 15%, 25%, 30% of
  the code may be damaged), default `M`. The code is the smallest
  version that holds the value; spare room raises the level for free.
- `aspect` — the cell's height over its width, default `auto`
  (measured, snapped to the nearest packing): `2` packs two module
  rows per cell with half blocks, `4` the same two cells wide, `1`
  one module per cell, `0.5` one module two rows tall.
- `scale` — an integer from 1 to 16 (default `1`); the symbol grows
  uniformly (scale the padding with it).

A glyph set of your own restyles the modules: `qrFull`, `qrUpper`,
and `qrLower` on its `solid` table (`registerBorderGlyphs` in
monowind, then `--mw-border-glyphs` on the element or a theme). A set
naming `qrFull` alone has no half blocks, so each module is two cells
wide — `##` for an ASCII-only code. The built-in sets all draw the
default blocks.

**Playground** — [play.monowind.benface.com](https://play.monowind.benface.com)
has all of this wired: type `<mono-qr>` with any value.

## API

- `encode(value, level)`, `scaleUp`, `pack`, `renderQr` — the pure
  pipeline, for rendering codes outside the element.
- `snapAspect(ratio)`, `resolveGlyphs(set)`, `DEFAULT_GLYPHS`.
- `defineMonoQr()`, `MonoQrElement`.

The encoder is the [`qr`](https://www.npmjs.com/package/qr) package,
used under its MIT license.
