# @monowind/ascii

FIGlet/TOIlet ascii-art banner text for [monowind](https://github.com/benface/monowind):
the `<mono-ascii>` element plus a library of 44 clearly-licensed fonts.

```html
<mono-ascii font="small" class="mx-auto text-emerald-400">monowind</mono-ascii>
```

The banner renders as art on the monowind grid while the light DOM
keeps the semantic string — screen readers hear `monowind`, never
glyph soup, while selecting over the banner — a drag in text mode, a
double- or triple-click in grid mode — selects the art itself (a
transparent transcript in the element's shadow; the string never
leaks into copied text). Utilities style
the whole banner (colors, transitions, `hover:` — everything monowind
supports); it behaves like a replaced element (shrink-wrapped to the
art, so `mx-auto` centers it and `w-full` stretches it).

## Setup, by integration

**Your own Tailwind v4 build, or `@monowind/vite`** — import the
element (registers `<mono-ascii>` + the default fonts) and the
companion styles next to monowind's:

```ts
import "monowind";
import "@monowind/ascii";
```

```css
@import "tailwindcss";
@import "monowind";
@import "@monowind/ascii";
```

Additional fonts are one import each (~11KB, tree-shaken):

```ts
import "@monowind/ascii/fonts/slant"; // registers "slant"
```

or typo-proof via the property (wins over the attribute):

```ts
import slant from "@monowind/ascii/fonts/slant";
document.querySelector("mono-ascii").font = slant;
```

**CDN (no build step)** — load the bundle next to monowind's; the
defaults (`standard`, `small`, `mono9`) are included and any other
bundled font lazy-loads on first use, so `font="slant"` just works:

```html
<script src="https://unpkg.com/monowind/dist/cdn.js"></script>
<script src="https://unpkg.com/@monowind/ascii/dist/cdn.js"></script>
<mono-wind>
  <mono-ascii font="slant" effect="rainbow">HELLO</mono-ascii>
</mono-wind>
```

`monowind.ascii.loadFont(name)` preloads explicitly; fonts resolve
same-origin (`fonts/…` if your site ships the directory) then from
this package via jsdelivr.

**Playground** — [play.monowind.benface.com](https://play.monowind.benface.com)
has all of this wired: type `<mono-ascii font="…">` with any font
below.

## API

- `font` attribute: a registered font name (default `standard`);
  unknown fonts warn and fall back to the plain text. `font` property:
  a parsed font object (from a font module or `parseFont`), overriding
  the attribute.
- `effect` attribute: `rainbow` or `metal` — per-cell color mapped to
  the `--mw-ansi-*` theme tokens, so effects follow your theme.
- `registerAsciiFont(name, data)`: register raw `.flf`/`.tlf` text —
  the bring-your-own-file path for fonts this package doesn't
  redistribute (zipped fonts must be extracted first). SGR color
  escapes in fonts render as per-cell color, with the ANSI-16 palette
  mapped to `--mw-ansi-*` (override the tokens to retheme).
- Content is a single line of text; whitespace collapses. Element
  children are ignored (with a warning).

## Bundled fonts

FIGlet distribution (BSD, © their authors): `banner` `big` `block`
`bubble` `digital` `ivrit` `lean` `mini` `mnemonic` `script` `shadow`
`slant` `small` `smscript` `smshadow` `smslant` `standard` `term`.

TOIlet distribution (WTFPL, © Sam Hocevar): `ascii9` `ascii12`
`bfraktur` `bigascii9` `bigascii12` `biggray9` `biggray12` `bigmono9`
`bigmono12` `circle` `emboss` `emboss2` `fauxcyrillic` `fullcyrillic`
`future` `letter` `mono9` `mono12` `pagga` `smascii9` `smascii12`
`smblock` `smbraille` `smmono9` `smmono12` `wideterm`.

Attribution details live in `fonts/LICENSES/`. The wider community
font collections are mixed/unclear licensing and are deliberately not
redistributed — use `registerAsciiFont` with files you source
yourself.
