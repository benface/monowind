# @monowind/vite

Zero-config Vite plugin for [monowind](https://www.npmjs.com/package/monowind)
— Tailwind included, no Tailwind setup required. Add the plugin, write HTML.

```sh
npm install -D @monowind/vite
```

```ts
// vite.config.ts
import monowind from "@monowind/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [monowind()],
});
```

```html
<!-- index.html — no stylesheet, no script: the plugin injects both. -->
<mono-wind>
  <div class="flex min-h-5 items-center justify-between border px-1">
    <div>left</div>
    <button>right</button>
  </div>
</mono-wind>
```

## Customizing Tailwind

Pass a CSS entry to add `@theme` tokens, custom utilities, or any other
Tailwind CSS features:

```ts
monowind({ css: "./src/theme.css" });
```

```css
/* src/theme.css */
@theme {
  --color-phosphor: #00ff88;
}
```

Setups without an `index.html` can load everything manually with
`import "virtual:monowind"`.

## Docs

See the [monowind repository](https://github.com/benface/monowind) for
documentation and examples.
