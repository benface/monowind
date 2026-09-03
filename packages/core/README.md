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

## Scrolling

`overflow-y-auto` (or `-scroll`, either axis) makes the element a
scroll container: the browser owns the scroll physics — wheel, touch,
keyboard, `scrollIntoView`, `scrollTop` — while the engine mirrors it
on the grid in whole-cell steps and draws the scrollbar as characters
(track `░`, thumb `█`, draggable; themable via glyph sets;
`scrollbar-color` honored and defaulting to `currentColor` like borders,
`scrollbar-width: none` honored, thickness via
`scrollbar-<n>` cells, per bar with `scrollbar-x-<n>` /
`scrollbar-y-<n>`). Scroll containers pinned to the bottom stay pinned as content
grows — chat logs need no code.

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
