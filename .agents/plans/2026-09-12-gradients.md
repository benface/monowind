# Gradients implementation plan

Status: **implemented** (2026-09-12; every phase green, the story's golden recorded; `background-clip` and the oklch, hsl, srgb-linear spaces with hue modes followed the same day). Spec: `gradients.md` — normative;
`cell-model.md` "Box model" (the fill) and "Selection"; this plan only
sequences it.

## Phases (each ends green: `pnpm check` + the visual sweep)

### 0. Probe the computed forms

The parser reads what the engines serialize, so pin that first: a
temporary `apps/storybook/visual/zz-probe-gradients.spec.ts` (deleted
after) logs `getComputedStyle(el).backgroundImage` in all three
engines for Tailwind's utilities — `bg-linear-to-r from-cyan-500
to-blue-600`, `bg-linear-45`, `bg-linear-to-br via-*`, `from-10%
to-90%`, `bg-linear-to-r/srgb`, `bg-radial`, `bg-radial-[at_25%_25%]`,
`bg-conic`, `bg-conic-180`, two layers, a `bg-[url(…)]`, a
`bg-red-500` under a gradient with a transparent stop — and for
`currentcolor` stops. Expected shapes (to confirm): `linear-gradient(to
right in oklab, oklch(…) 0%, oklch(…) 100%)`, `radial-gradient(in
oklab, …)`, `conic-gradient(in oklab, …)`; colors as `oklch()`,
`rgb()`, `rgba()`, `color(srgb …)`. The recorded strings become the
parser's fixtures.

### 1. Reading: `background-image` as gradients

- `types.ts`: `Gradient` — `kind: "linear" | "radial" | "conic"`,
  `repeating`, `space: "oklab" | "srgb"`, `stops: { color: Color;
position: number | null }[]` (positions as fractions of the line,
  px converted on the spacing scale to cells then to px of the box),
  `hints` between stops, and per kind: linear `angle` (deg, `to
<side-or-corner>` converted by the box at paint), radial `shape`,
  `size` (the four keywords, or explicit lengths), `at`; conic `from`,
  `at` (positions as fractions or px). `CellStyle.backgroundImage:
Gradient[]`, default `[]`, first declared first.
- `color.ts` (new, small): parse a computed color — `rgb()`/`rgba()`,
  `hsl()`, `oklab()`, `oklch()`, `color(srgb …)`, `transparent` — to
  `{ r, g, b, a }` in gamma-encoded sRGB with alpha; convert to and
  from oklab; serialize back to `rgb(r g b / a)`. `borders.ts`
  `colorAlpha` moves here (one parser).
- `style.ts`: `readBackgroundImage(value, color, rootFontSizePx)`
  — `splitCommas` per layer, `splitTopLevelCommas` per argument; a
  layer that is not a gradient (`url()`, `none`) is dropped. Read
  beside `backgroundColor`; unaffected by `isTransparentColor`.
- `styles.css`: `background-image: none !important` beside the
  `background-color` lock (the same [measuring] gate).
- Tests (`style.test.ts` or a new `gradient.test.ts`, DOM cases with
  inline literals — happy-dom keeps them): every fixture from phase 0;
  positions with and without values, hints, two layers, `url()`
  dropped, `none`, the space keyword, `repeating-`.

### 2. Painting: a color per cell

- `gradient.ts` (new): `gradientColorAt(gradient, cx, cy, box)` in px
  — linear: CSS's gradient line for the angle (length `|w·sin θ| +
|h·cos θ|`, corners resolve `to <corner>` by the box's aspect as CSS
  does), the point projected to `t`; radial: the ellipse for the shape
  and size keyword at `at`, `t` the point's radius in the ellipse's
  metric; conic: the angle from `from` around `at`, `t` in turns;
  stops resolved as CSS does (fixed positions, missing ones spread
  evenly, later stops floored at earlier ones, hints as the midpoint
  easing), `repeating-` tiles `t`; interpolation in oklab or srgb with
  alpha premultiplied; the result composited over the previous layer,
  then over `backgroundColor` (or left translucent when none).
- The paint needs the measured cell in px: `renderGrids` options gain
  `cell` (the DOM adapter passes the host's; node tests default to
  a 1:2 cell), and the fill step in `plain-text.ts` `walk` paints a
  gradient box cell by cell — the color at the cell's center — with
  `put(x, y, " ", alphaPaint({ backgroundColor }))`, replacing the
  plain fill; `bg-clear` keeps its wipe. Layers paint last to first.
  Selection inverts per cell as it does now (`selected` swaps color
  and background).
- `render.ts`: an editable's `--mw-ground` under a gradient stays the
  plain `backgroundColor` — one line in the spec's deviations.
- Performance: a gradient box costs a color computation per cell per
  paint; benchmark a 200×50 gradient box before deciding on a per-node
  cache — measured: 5.8 ms per paint against 1.3 ms for a plain box,
  so the colors are kept on the layers array between layouts (a
  repaint then costs 1.28 ms), and the geometry and prepared stops are
  placed once per box. In the DOM, a row of gradient cells is one span
  with hard stops: 5,324 spans became 92 in the story, and a resize
  step fell from 161 ms to 69.
- Tests (`gradient.test.ts`, node level with `makeNode`): a two-stop
  horizontal gradient's colors per column (monotone, endpoints exact),
  vertical per row, a diagonal, `to <corner>` hitting the corners, a
  radial's rings, a conic's sweep, stops at positions, a hint, a
  repeating gradient, srgb vs oklab midpoint, a translucent stop over
  a `background-color`, two layers, glyphs keeping their color,
  `bg-clear` under a gradient, selection inverting a cell; the
  `color.ts` conversions round-trip.

### 3. Stories and docs

- `effects.stories.ts` "Gradients": Tailwind's `bg-linear-*` presets
  with `from-*`/`via-*`/`to-*`, a radial and a conic, text over a
  gradient card, a translucent stop over a color, a selection across
  it (play), a `borders-ascii` card to show glyphs unaffected; golden.
- `packages/core/README.md`: a short "Gradients" paragraph (a color
  per cell; what is ignored). `cell-model.md` "Box model": the fill
  sentence points to `gradients.md`. `gradients.md`: status
  implemented, the editable-ground deviation.
