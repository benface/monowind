# Performance

## The benchmark

`pnpm bench` (`scripts/bench.mjs`) times a page of 300 bordered boxes
— the shape that stresses the grid hardest, since every border cell is
a glyph the font may draw off its row
(`specs/wide-characters.md`). It reports the median of five runs of:

- **interactive** — navigation until the host sets `data-mw-ready`,
- **style recalc** and **layout** — Chromium's own counters,
- **grid spans** — what the shadow `#grid` holds.

A plain desktop client: 1280×720 at one device pixel per CSS pixel,
Chromium, no throttling. `--count`, `--runs` and `--rate` (CPU
throttling) vary it; `--bundle <path>` measures a `cdn.js` built
elsewhere, which is how a tag is compared:

```
git worktree add -f --detach /tmp/v0.3.0 v0.3.0
(cd /tmp/v0.3.0 && pnpm install && pnpm -C packages/core build)
node scripts/bench.mjs --bundle /tmp/v0.3.0/packages/core/dist/cdn.js
```

Absolute numbers belong to the machine that took them, so a comparison
is only worth reading when every row of it was taken in one sitting.
Record what moves here.

## Where it stands

Taken together on one machine (Apple silicon, 2026-09-21). Two builds
of one commit taken minutes apart gave 323 ms and 327 ms, so read a
difference under about 5 ms as the harness talking.

`pnpm bench` — 300 bordered boxes, where every border cell is a stroke:

| build  | interactive | style    | layout  | grid spans |
| ------ | ----------- | -------- | ------- | ---------- |
| v0.3.0 | 166 ms      | 50.9 ms  | 9.8 ms  | 1500       |
| v0.3.1 | 338 ms      | 107.6 ms | 37.2 ms | 7880       |
| main   | 231 ms      | 58.3 ms  | 25.6 ms | 7880       |

`pnpm bench --shape blocks --count 40` — rows of one block glyph each,
where a run shares a box:

| build  | interactive | style   | layout  | grid spans |
| ------ | ----------- | ------- | ------- | ---------- |
| v0.3.0 | 131 ms      | 35.5 ms | 15.1 ms | 1600       |
| v0.3.1 | 108 ms      | 22.8 ms | 13.0 ms | 781        |
| main   | 92 ms       | 11.1 ms | 11.2 ms | 781        |

Style recalc on the strokes is back within a hair of v0.3.0 on five
times the spans, so what is left of that gap is not the styling:
against v0.3.0 the page rasterizes 94.7 ms against 38.5 and lays out
26.6 against 9.7, which is what 7880 clipped inline-blocks cost the
compositor. A page that is neither shape lands between them: a QR
code's modules alternate, so its runs are short and share less than a
shadow band's.

`pnpm bench --shape prose` — paragraphs whose inline elements nest,
which is what the run walk and the leaf-or-container question cost on
an ordinary page. Added 2026-09-22 with block-in-inline, to measure a
classification that reads a style per inline element that has element
children:

| build                  | interactive | style    | layout  | grid spans |
| ---------------------- | ----------- | -------- | ------- | ---------- |
| before block-in-inline | 309 ms      | 131.4 ms | 18.7 ms | 2400       |
| with it                | 314 ms      | 130.9 ms | 18.9 ms | 2400       |

Inside the noise, and layout — where the new walk lives — does not
move. `hidesBlock` answers on `children.length` before reading a
style, which nearly every inline element on a page satisfies.

Read both builds back to back and check `uptime` first: a loaded
machine read the same bundle at 226 ms and 268 ms an hour apart, so a
number without its pair beside it says nothing.

**The open one: 166 ms against 231 ms on the strokes.** Six of the
seven themes pay none of it: dos, dos-blue, green-phosphor, amber and
bbs draw with the VGA bitmap font and c64 with Pet Me 64, and those
put `│`, `─` and `█` exactly on the cell, so nothing is boxed at all
and the grid is the size it was in v0.3.0. Teletype is the exception —
Courier New is an ordinary outline font and boxes like the default
stack.

## What the last round bought

None of these changed a pixel; the goldens this commit moves, it
moves for the fills/strokes split and the overhang.

- **A font settling no longer restyles the page.** `document.fonts`
  settles on every page, webfont or not, and `invalidate()` bumped the
  generation for it, which tells a paint its boxes are stale: every
  boxed span was restyled in place (`paint.ts`, `refit`). Every
  `measureText` a cached measurement rests on now records how the font
  drew that glyph, and `invalidate()` measures exactly those again and
  forgets nothing while they all draw as they did. Worth 60 ms of the
  93, at one measurement per cached cluster.
- **`--mw-host-w` does not inherit.** Only `mono-wind:not([measuring])`
  reads it, and the layout writes it after the grid is painted, where
  an inherited custom property restyles every span below. Declared
  `@property { inherits: false }`.
- **A box prototype is shared across rows.** The paint cached one per
  segment AND row, though only a shade's style answers to its row, its
  lattice shifting with it.

What did NOT help, measured: sharing the fits across hosts (unsound
besides — a fit keyed on the font string is wrong for two hosts whose
font name resolves differently), warming the fits before the paint,
moving the baseline probe out of the grid, and replacing five inline
declarations with a class (Chromium shares the style either way; 7880
spans cost 4.7 ms of recalc in isolation).

The three attribute rounds a layout makes over every light element —
`data-mw-measuring` on, swapped for `data-mw-settling`, then off — cost
about 46 ms here and are not removable: the flags are what lift the
engine's locks so the measurement reads authored values. v0.3.0 pays
them too.

## What a box is for, and what it costs to skip one

Four fifths of this page's spans are `─`, one box a cell. In the
default font `─` is drawn inside its row and on its cell, so it looks
like it needs no clip, and leaving those runs as plain text does take
the page back to 1500 spans and 167 ms. It also SEAMS, which is the
thing to know before trying it again:

- A run of `─` left as text abuts at the font's own advance, while the
  corners and stems beside it stay boxed and stay scaled, so the joint
  between a scaled `╭` and an unscaled `─` shows.
- `█` takes its whole horizontal overhang from its scale, its ink
  being its cell's width to within a hundredth. Trimming that scale to
  the least overhang that seemed to serve `─` seams a shared block run
  between its cells — which is what paints a box-shadow and a
  scrollbar.
- The baseline a box is pinned by cannot be read from one measurement
  per font: engines round a font's ascent and descent at each size, so
  the pair read at scale 1 does not predict the pair at 1.43, and a
  shade's line-height came out 8px wrong.

So the span count and the joints are one question, not two. The lead
worth testing is the one that drops the per-cell element without
changing what any glyph is scaled to: a tile repeated at the cell
pitch as a `mask` over `currentColor`, which measured zero spread on
every row but leaves webfonts, the other two engines, mixed runs and
selection unanswered.
