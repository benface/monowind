# monowind

Build text-based user interfaces (TUIs) on the web from ordinary HTML and
Tailwind utility classes. A Web Component lays your HTML out on a strict
character grid — box-drawing borders, integer-cell geometry, monospace
everything — while native links, buttons, inputs, focus, forms, and
accessibility semantics stay fully intact.

**Pre-1.0.** APIs and behavior can still change.

## Try it — no build step

```html
<script src="https://unpkg.com/monowind/dist/cdn.js"></script>

<mono-wind>
  <div class="flex min-h-5 items-center justify-between border px-1">
    <div>left</div>
    <button>right</button>
  </div>
</mono-wind>
```

The host is a container like any element: `<mono-wind>hello</mono-wind>`
lays its own text out too.

## With your own Tailwind (v4) build

```sh
npm install monowind
```

```css
/* your main stylesheet */
@import "tailwindcss";
@import "monowind";
```

```js
// your entry script
import { defineMonoWind } from "monowind";
defineMonoWind();
```

## Selection

`select="grid"` (the default) selects the rendered grid: drag across
the art and copy exactly what you see. Double- and triple-click select
the element under the pointer — the word or the paragraph, as on any
page — and drag extends word by word or paragraph by paragraph.
`select="text"` selects your elements' text instead, character by
character, the way a page does. In both modes the highlight is drawn
on the grid, cell for cell, as reverse video: each cell's colors swap,
so colored text selects as a band of its color. A copy of element
text is plain text laid out by the standard `innerText` rules
(paragraphs separated by a blank line, table cells by tabs); an image
copies as its `alt`, or in `select="grid"` as its cells with the `alt`
in them, so the text beside stays aligned.

Glyph widths follow the terminal convention: CJK, Hangul, and emoji
take two cells, everything else one, whatever the font draws — a
glyph the font lacks is scaled into its cells so the grid never
drifts. `clusterWidth`, `clusterAdvances`, `graphemes`, and
`textCells` are exported for code that lays out text of its own.

## Keyboard focus

Tab moves focus as on any page. `focus="arrows"` on `<mono-wind>` adds
the arrow keys: from the focused element, an arrow moves focus to the
nearest focusable element in that direction on the grid, the way a
terminal form does. Controls keep the arrows they use — Left and Right
in a text field, all four in a textarea, a radio group's own — a
modifier makes any arrow native, and nothing wraps.

## Scrolling

`overflow-y-auto` (or `-scroll`, either axis) makes the element a
scroll container: the browser owns the scroll physics — wheel, touch,
keyboard, `scrollIntoView`, `scrollTop` — while the engine mirrors it
on the grid in whole-cell steps and draws the scrollbar as characters
(track `░`, thumb `█`, draggable; themable via glyph sets;
`scrollbar-color` honored and defaulting to `currentColor` like borders,
`scrollbar-width: none` honored, thickness via
`scrollbar-<n>` cells, per bar with `scrollbar-x-<n>` /
`scrollbar-y-<n>`; `scrollbar-inset-<n>` keeps cells clear around
the bars for your own arrow buttons). Scroll containers pinned to the
bottom stay pinned as content grows — chat logs need no code.

## Border & rule glyphs

Border styles render through a **glyph set** — swap the characters
without touching your markup. Pick a built-in with a `borders-*`
utility on the element that owns the decoration (or any ancestor —
it inherits):

```html
<div class="border borders-rounded">╭─╮ corners</div>
<div class="border border-double borders-ascii">+=+ everywhere</div>
<div class="border border-double borders-single">─│ only, DEC-style</div>
```

Built-ins: `default`, `rounded`, `ascii`, `single`, `blocks`, `cp437`. Or register your
own (per-glyph fallback — override only what you need) and reference
it the same way:

```js
import { registerBorderGlyphs } from "monowind";
registerBorderGlyphs("stars", { solid: { tl: "✧", tr: "✧", bl: "✧", br: "✧" } });
```

```css
.fancy {
  --mw-border-glyphs: stars; /* what the borders-* utilities set */
}
```

A registered set is frozen; to change one, register it again.

A set names glyphs; whether the FONT has them is the page's business.
Where it hasn't got one, the browser substitutes another font's, which
the engine boxes onto its cell so the grid holds — but a substitute
cannot both fit the cell and fill the row, so it shows as a corner
broken from the line beside it. Say so and it falls back instead, to a
glyph the font does draw:

```css
.retro {
  font-family: "Some 8x16 bitmap font";
  --mw-missing-glyphs: "╭╮╰╯"; /* no arcs in this font */
}
```

Inherited, so a theme declares it once for the page; a glyph named
there counts as unregistered, whatever set an author later asks for.
The bundled themes declare what their own fonts are missing.

A set can also register corner glyphs by `border-radius` — a corner
draws the registration nearest its radius in cells, the plain corner
counting at 0 (the defaults round light-line corners to `╭ ╮ ╰ ╯`
from `rounded-xs` up) — and the shade ramp box shadows step through,
densest first (default `█ ▓ ▒ ░`):

```js
registerBorderGlyphs("soft", {
  solid: {
    rounded: [{ radius: 2, tl: "◜", tr: "◝", bl: "◟", br: "◞" }],
    shadow: ["▓", "▒", "░", "·"],
  },
});
```

`border-width` is a **weight** the set interprets: the defaults draw
`border-2` and up as heavy lines (`━ ┃ ┏ ┓ ┗ ┛`) in one cell, and
`rule-2` on a gap the same way. A set registers its own weight bands —
glyphs for a width, and the cells it takes — so a theme whose font has
no heavy glyphs can draw two rings instead, which is what `ascii`,
`single`, `rounded`, and `blocks` do (`cp437` draws double, as DOS
did):

```js
registerBorderGlyphs("rings", { solid: { weights: [{ width: 2, cells: 2 }] } });
registerBorderGlyphs("bold", {
  solid: { weights: [{ width: 2, h: "═", v: "║", tl: "╔", tr: "╗", bl: "╚", br: "╝" }] },
});
```

Borders, blocks, and scrollbars tile in any font: where a font draws
its box-drawing or block glyphs shorter than the row (Menlo and SF
Mono do, and any font under a taller `leading-*`), the grid fits them
to it, so rows never show a seam.

## Shadows and rounded corners

`shadow-*` paints a box's silhouette behind it in shade glyphs from
the glyph set: offsets in whole cells (a `4px` offset is one cell, the
classic DOS shadow), blur as rings that fade outward, spread in cells,
a translucent color as a lighter shade leaning on the theme's
foreground, `inset` shadows inside the padding box. Tailwind's presets
are pixel recipes, and their blur and spread convert on the spacing
scale (4px to a cell), so `shadow-2xl`
is a six-ring halo. For presets tuned to the grid, redefine them in
your Tailwind theme:

```css
@theme {
  --shadow-sm: 4px 4px 0 0 rgb(0 0 0 / 0.1);
  --shadow-md: 4px 4px 8px 0 rgb(0 0 0 / 0.1);
  --shadow-lg: 4px 4px 16px 0 rgb(0 0 0 / 0.1);
}
```

`rounded-*` picks the corner glyphs a set registers nearest the radius
— the defaults' `╭ ╮ ╰ ╯` for light-line borders — while heavy and
double borders stay square.

## Gradients

`bg-linear-*`, `bg-radial`, and `bg-conic` (with `from-*`, `via-*`,
`to-*`, positions, and a space such as `/srgb`, `/oklch`, `/longer`)
paint a color per cell: each cell takes the gradient's color at its
center, in CSS's geometry for the box, the stops interpolated as CSS
does, layers composited over the plain color. Text keeps its own
color, and `bg-clip-text text-transparent` shows the gradient through
it. Sizes, positions, and repeats of the background image are ignored,
as are `url()` images (an `<img>` draws on the grid; see Images): a
gradient always covers the box once.

## Opacity

Translucent colors (`bg-black/50`, `text-white/60`) and `opacity-*`
blend into the cells beneath them as the browser composites them. An
`opacity-*` element fades as a whole, as in a browser: on a white page,
a `bg-blue-600 text-white opacity-50` button shows white text on a
light blue fill. A cell is one character on one background, so a
background of any alpha hides the glyph beneath it. A color at zero
alpha paints nothing.

Where nothing opaque lies beneath, a translucent color keeps its alpha
and a faded element its opacity, and the browser composites them over
whatever is behind the host: a background image, a gradient, the page.

## Images

An `<img>` (a `<picture>`'s too) is a box of whole cells, its picture
drawn at the grid's resolution: one pixel per column and two per row,
each the average of the image's pixels it covers. Unsized, it takes
its natural width on the spacing scale (a 400px-wide image is 100
columns) and its height from its natural ratio. `w-*`, `h-*`,
`max-w-full`, and `aspect-*` size it as any box, `object-fit` and
`object-position` place the picture in it, and where the engine's
rounding sized the box, the picture covers it rather than stretch. An
inline image rides its line, its bottom on the baseline; a broken one
shows its `alt` text.

Under a theme, each pixel takes the nearest of the theme's colors,
dithered, so a photo on a DOS page looks like a DOS photo; without
one, an image keeps its colors. Per image (or inherited):

- `image-posterize-<n>` — each channel reduced to n levels (2 or more)
- `image-dither-ordered` (the default), `image-dither-diffusion`
  (Floyd–Steinberg), `image-dither-none`
- `image-palette-none` — the theme's colors off; or set
  `--mw-image-palette` to colors of your own, and
  `--mw-image-match: lightness` for a monochrome ramp matched by
  lightness alone

An animated image (GIF, APNG, WebP, AVIF) plays where the browser
decodes its frames for the page (`ImageDecoder`), pausing while off
screen, and shows its first frame under `prefers-reduced-motion`. An
image from another origin takes its colors like any other where its
server shares it over CORS (no `crossorigin` needed); one its server
doesn't share, the page may not read: it draws at the grid's
resolution in its own colors, an animated one its first frame.

## Native regions

`mw-native` on any element makes it a native region: a box the grid
sizes and frames in cells — its border in glyphs, its fill, its place
in the paint order — whose contents the browser draws and runs as on
any page. An iframe, a video, a map, a chart on a canvas, a code
editor, or plain text in your own fonts:

```html
<mono-wind>
  <iframe class="aspect-video w-full border mw-native" src="…"></iframe>
  <div class="w-80 border p-1 font-serif mw-native">Native text.</div>
</mono-wind>
```

- **Sizing.** An `img`, `video` or `canvas` takes its natural size,
  as in Images above (a video 300×150 px until its metadata loads); an
  `iframe`, `embed` or `object` is 300×150 px on the spacing scale (75
  by 38 cells) until sized. Flowed contents, and an inline `svg`, are
  measured as the browser lays them out wherever their size counts —
  left auto, or a percentage when the host sizes itself to its content
  — rounded up to whole cells, and measured again as they change. Size
  a heavy region (a widget whose contents change often) yourself, its
  width and height both lengths, and `min-w-0` on a flex item, whose
  automatic minimum asks its contents: then it is never measured, and
  changes inside it never lay the host out.
- **What stays native.** Inside a region, nothing of the grid's
  applies: fonts, colors, backgrounds, borders, form controls, the
  pointer, selection and copy, focus and scrolling are the browser's.
  Its contents start from CSS's defaults, the host's font and color
  aside.
- **The paint order holds.** A menu, a dialog or a sticky header
  painted over a region hides it there, as it would any box.
- **Nesting.** A `<mono-wind>` inside a region is a host of its own;
  `mw-native` on a `<mono-wind>` itself is ignored, so wrap the host in
  a region.

## Companion packages

The core is self-contained; these are optional:

- [`@monowind/themes`](https://www.npmjs.com/package/@monowind/themes) —
  class-scoped themes modeled on real systems (`dos`, `c64`,
  `green-phosphor`, …): authentic palettes, period fonts, era-correct
  border characters
- [`@monowind/ascii`](https://www.npmjs.com/package/@monowind/ascii) —
  `<mono-ascii>` FIGlet banner text with gradient/metal effects
- [`@monowind/qr-code`](https://www.npmjs.com/package/@monowind/qr-code) —
  `<mono-qr>` scannable QR codes, packed into the grid's cells
- [`@monowind/vite`](https://www.npmjs.com/package/@monowind/vite) —
  zero-config Vite plugin, Tailwind included

## Docs

- [Storybook](https://storybook.monowind.benface.com) — live examples of
  every supported feature
- [Project overview and development setup](https://github.com/benface/monowind#readme)
- [Cell-model rules](https://github.com/benface/monowind/blob/main/.agents/specs/cell-model.md)
  — the layout semantics (spacing scale: 1 cell = 0.25rem; border
  width as a weight the glyph set draws; what's deliberately
  unsupported)
- [Example apps](https://github.com/benface/monowind/tree/main/apps) — CDN
  mode, Vite + Tailwind, and more
