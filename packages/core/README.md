# monowind

Build text-based user interfaces (TUIs) on the web from ordinary HTML and
Tailwind utility classes. A Web Component lays your HTML out on a strict
character grid — box-drawing borders, integer-cell geometry, monospace
everything — while native links, buttons, inputs, focus, forms, and
accessibility semantics stay fully intact.

**Early development.** APIs and behavior will change.

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
/* app.css */
@import "tailwindcss";
@import "monowind";
```

```js
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
(paragraphs separated by a blank line, table cells by tabs).

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

## Companion packages

The core is self-contained; these are optional:

- [`@monowind/themes`](https://www.npmjs.com/package/@monowind/themes) —
  class-scoped themes modeled on real systems (`dos`, `c64`,
  `green-phosphor`, …): authentic palettes, period fonts, era-correct
  border characters
- [`@monowind/ascii`](https://www.npmjs.com/package/@monowind/ascii) —
  `<mono-ascii>` FIGlet banner text with gradient/metal effects
- [`@monowind/vite`](https://www.npmjs.com/package/@monowind/vite) —
  zero-config Vite plugin, Tailwind included

## Docs

- [Storybook](https://storybook.monowind.benface.com) — live examples of
  every supported feature
- [Project overview and development setup](https://github.com/benface/monowind#readme)
- [Cell-model rules](https://github.com/benface/monowind/blob/main/.agents/specs/cell-model.md)
  — the layout semantics (spacing scale: 1 cell = 0.25rem; border scale:
  1px = 1 cell; what's deliberately unsupported)
- [Example apps](https://github.com/benface/monowind/tree/main/apps) — CDN
  mode, Vite + Tailwind, and more
