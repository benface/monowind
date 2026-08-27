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

## Docs

- [Storybook](https://storybook.monowind.benface.com) — live examples of
  every supported feature
- [Project overview and development setup](https://github.com/benface/monowind#readme)
- [Cell-model rules](https://github.com/benface/monowind/blob/main/.agents/specs/cell-model.md)
  — the layout semantics (spacing scale: 1 cell = 0.25rem; border scale:
  1px = 1 cell; what's deliberately unsupported)
- [Example apps](https://github.com/benface/monowind/tree/main/apps) — CDN
  mode, Vite + Tailwind, and more
