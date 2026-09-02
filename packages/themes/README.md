# @monowind/themes

Themes for [monowind](https://github.com/benface/monowind) modeled on
real systems — authentic palette, period font, and era-correct border
characters, one CSS file each:

| theme            | system                           | font                       | borders                       |
| ---------------- | -------------------------------- | -------------------------- | ----------------------------- |
| `dos`            | IBM PC text mode (VGA 16-color)  | Px437 IBM VGA 8x16         | CP437 single + double         |
| `dos-blue`       | the Norton/Turbo Vision look     | Px437 IBM VGA 8x16         | CP437 single + double         |
| `green-phosphor` | P1 green monochrome terminal     | Px437 IBM VGA 8x16         | single lines only (DEC-style) |
| `amber`          | P3 amber monochrome terminal     | Px437 IBM VGA 8x16         | single lines only             |
| `c64`            | Commodore 64                     | bring your own (see below) | PETSCII-style rounded corners |
| `teletype`       | hard-copy terminal, ink on paper | Courier stack              | 7-bit ascii (`+-\|`, `+=+`)   |
| `bbs`            | dial-up BBS, ANSI art            | Px437 IBM VGA 8x16         | CP437 blocks (`█`, `▒`/`░`)   |

## Usage

Import a theme next to monowind's stylesheet and put its class on a
`<mono-wind>` (or any wrapper):

```css
@import "tailwindcss";
@import "monowind";
@import "@monowind/themes/dos";
```

(or `@import "@monowind/themes"` for all of them — class scoping means
unused themes cost nothing)

```html
<mono-wind class="theme-dos">…</mono-wind>
```

No build? Themes are plain CSS — load one with a `<link>` next to the
monowind CDN script (fonts and palettes resolve relative to it):

```html
<link rel="stylesheet" href="https://unpkg.com/@monowind/themes/themes/dos.css" />
```

Themes are CLASS-SCOPED: two hosts on one page can wear different
themes, all theme files can load at once, and no class means monowind's
defaults. Everything a theme sets is overridable — utilities beat it.

**The whole Tailwind palette is quantized.** Each theme remaps every
`--color-*` token to its system's colors (nearest-in-OKLAB; lightness
steps for the monochromes), scoped to themed hosts: `text-red-500`
inside `green-phosphor` renders the right brightness of green, and the
rest of your page keeps stock colors. Arbitrary values (`text-[#f00]`)
bypass the mapping and stay literal.

Also set per theme: `--mw-fg`/`--mw-bg`, the ANSI-16 `--mw-ansi-*`
tokens (SGR-colored ascii art and `effect` filters follow the theme),
the border glyph set (`--mw-border-glyphs`), and the font with its
native bitmap size (keep `font-size` at integer multiples for crisp
cells).

## Fonts

The PC-era themes ship "Px437 IBM VGA 8x16" from the
[Ultimate Oldschool PC Font Pack](https://int10h.org/oldschool-pc-fonts/)
(© VileR, CC BY-SA 4.0 — license in `fonts/LICENSES/`). The `c64`
theme ships no font: the canonical C64 faces forbid redistribution —
add your own `@font-face` (e.g. Style64's C64 TrueType, licensed for
personal use) and set `font-family` on the themed host.
