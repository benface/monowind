# `<mono-qr>`: QR codes on the grid

Status: **implemented** (2026-09-05; plan:
`plans/2026-09-05-qr-code.md`) as the `@monowind/qr-code` package,
the second consumer of the leaf-renderer API
(specs/leaf-renderers.md) after `<mono-ascii>`.

## Why

A TUI that shows a link, a session id, or a payment address wants it
scannable from the screen. A QR code is a matrix of square modules;
the grid's cells are not square, so the renderer's job is to pack
modules into cells at the font's real proportions, and to do it with
glyphs a theme can restyle without breaking the code.

## Probe results (2026-09-05, Storybook themes, Chromium / Firefox / WebKit)

Measured cell height over width: the IBM VGA themes (`dos`,
`dos-blue`, `green-phosphor`, `amber`, `bbs`) exactly 2.00; `c64`
1.62–1.66 and `teletype` 1.67; the default JetBrains Mono 2.14 (2.38 in
Firefox). Every bundled font snaps to aspect 2, so half blocks are the
packing everywhere and modules range from 0.83 to 1.19 times as tall
as wide; no bundled font has square cells.

## Locked decisions

### The element

- **`<mono-qr>https://…</mono-qr>`** in `@monowind/qr-code`,
  registered with `registerLeafRenderer` like `<mono-ascii>`;
  `defineMonoQr()` and a CDN bundle (`dist/cdn.js`) mirror the ascii
  package. Attributes and character data are observed, so a change
  re-renders.
- **The value is the element's text**, as for `<mono-ascii>`: the
  text content with surrounding whitespace trimmed and everything
  inside kept verbatim (a value's spaces and line breaks are data).
  Element children are ignored with a warning. An empty value renders
  no rows; a value too long for the largest version at the chosen
  level renders no rows and warns once. Encoding is the smallest QR
  version that holds the value at the chosen level, in the encoder's
  numeric, alphanumeric, or byte mode — one mode for the whole value,
  bytes as UTF-8. An attribute that does not parse reads as its default.
- **`level`** is the error-correction level, `L | M | Q | H`,
  default `M`: how much of the code can be damaged or covered and
  still read — 7%, 15%, 25%, 30% — bought with more modules. A code's
  size is its VERSION: version 1 is 21 × 21 modules, each version up
  adds 4 per side, to 177 × 177 at version 40. The renderer picks the
  smallest version that holds the value at the requested level; when
  that version has room to spare, the renderer raises the level — the
  same size, more damage tolerated.
- **The quiet zone is padding.** The rows are the bare symbol; the
  light margin a reader needs around it — four modules in the QR
  standard, which every reader accepts; two, which most cope with —
  is the author's `p-*`, opt-in like every utility: `px-4 py-2` at
  aspect 2 (a column is a module; a row is two), or blank
  surroundings. (A `quiet` attribute in modules was the first
  design, dropped 2026-09-05: it duplicated padding under another
  name.)
- **`aspect`** is the cell's shape: its height over its width, `2`
  for the usual monospace cell that is twice as tall as it is wide
  (two cells side by side make a square). It decides how a square
  module is drawn (see "Packing"). Default `auto`: the renderer reads
  the host's measured cell (`--mw-ch` / `--mw-cw`) each layout and
  snaps it to the nearest packing — from `1.5` up, half blocks
  `round(aspect / 2)` cells per module (`2` for the usual cell, `4`
  two cells per module); from `0.75` down, full blocks
  `round(1 / aspect)` rows per module; between, one full block. A
  number overrides the measurement and snaps the same way, for a font
  that measures oddly or an author who wants a taller or wider code.
  Before the first measurement (and in the Node renderer) the value
  is `2`.
- **`scale`** is an integer from 1 to 16, default `1` (larger reads as
  16: the matrix grows with its square and would freeze the tab):
  every module becomes a `scale × scale` block of modules before
  packing, so the symbol grows uniformly (the padding is the author's
  to scale). Anything else reads as `1`.
- **Colors are the element's.** Dark modules paint in `currentColor`;
  light modules are the element's background, which is transparent by
  default — `text-*` and `bg-*` utilities on `<mono-qr>` set both, and
  a `bg-*` fills the leaf's whole box, padding included, so a padded
  code carries its quiet zone. Light ink on a dark background gives an
  inverted code, which most readers accept; `bg-white text-black` on
  the element is the guaranteed-normal code on any theme.

### Packing modules into cells

Cells are whole; the half-block glyphs are what let a cell show two
modules: `▀` inks only the top half of its cell, `▄` the bottom half,
`█` all of it. So at aspect 2 a module — one cell wide, half a cell
tall — is square, and a cell row holds two module rows.

- **Aspect 2 — half blocks.** One module column per cell, two module
  rows per cell row: both dark paints `█`, upper only `▀`, lower only
  `▄`, neither a space. A matrix of `M` modules is `M` columns by
  `⌈M / 2⌉` rows; an odd `M` leaves the last row's lower half light. A
  version-1 code is 21 × 11, 29 × 15 with the standard quiet zone as
  padding. (The other square at this aspect is two cells wide and one
  tall, `██` — twice the size; that is `scale="2"`, or the fallback
  for a glyph set without half blocks.)
- **Aspect 2k — half blocks, k cells per module.** The same glyph
  repeated across the module's cells: at aspect 4 a module is two
  cells wide and half a cell tall, `M` modules `2M` columns by
  `⌈M / 2⌉` rows.
- **Aspect 1 — one module per cell**, `█` or space: `M × M`.
- **Aspect 1/m — one module per column, m rows tall**, `█` stacked:
  `M` columns by `mM` rows (`0.5`: two rows).
- The packing runs on the SCALED matrix, so `scale` composes with any
  aspect (aspect 2, scale 2: full blocks two cells wide).

### Glyphs through the registry

- A set's `solid` table may name three more roles, next to the
  scrollbar's: `qrFull`, `qrUpper`, `qrLower`. Core carries only the
  type (three optional fields) and the `glyphSetFor` export; the
  defaults `█ ▀ ▄`, the fallback, and everything else live in the QR
  package, so the core bundle grows by a few bytes. The renderer
  resolves the element's `--mw-border-glyphs` (inherited, so a theme's
  or a `borders-*` utility's set applies) the way the engine does for
  borders.
- **No built-in set names a role**, so every theme draws the default
  blocks — the `ascii` set included: a `#` in a thin face is too
  sparse to scan (tried and dropped 2026-09-05), and a code's job is
  to scan. An ASCII-only code is an authored set's.
- **A set without half blocks renders a module two cells wide.** A
  set that declares none of the three roles gets the defaults; one
  that declares `qrFull` without both halves has no half blocks. At
  aspect 2 the renderer then draws each module of the scaled matrix
  as `aspect` full cells in one row, one cell row per module row:
  square-ish in the same cells, twice the size. Aspects at or below 1
  never need halves.
- A theme therefore restyles a code through its set alone, and an
  author can register a set of their own. Light modules are always
  spaces; a set supplies only the dark ink, one cell per role.

### Selection, copy, accessibility

- Like `<mono-ascii>`, the element keeps a transparent transcript of
  the packed rows in its shadow root as its `selectionTarget`: a drag
  selects by character, a double-click a row, a triple-click the whole
  code (specs/wide-characters.md), and a copy pastes into a terminal
  as a working code.
- The value text stays in the light DOM, visually hidden as the ascii
  element hides its text, so assistive technology reads the value
  itself — the one thing a listener can use. No role of its own; an
  authored `role` or `aria-label` is the author's.

### Encoding

- **The `qr` package** (paulmillr, MIT/Apache-2.0, zero dependencies,
  auditable, 5 KB gzipped) is the encoder — a runtime dependency, the
  package's only one, bundled into the CDN build and left external in
  the module build. Its `raw` output is the module matrix (it wants a
  border of at least one module, which never touches the symbol, so
  one is asked for and sliced off); versions 1–40, all four levels,
  automatic mask selection. The level boost is the renderer's: after
  the smallest version at the requested level, the highest level that
  still fits that version, tried from the top. Its decoder
  (`qr/decode.js`) is the test decoder, in Node and on screenshots.

## Deviations

- **Modules are only as square as the font's cell allows.** At
  aspect 2 a module is one cell wide and half a cell tall, so in a
  font whose cell is 2.4 times taller than wide a module is 1.2 times
  taller than wide; the snapping keeps every module within 1.5× of
  square either way. Readers tolerate that much; `aspect` and `scale`
  are the escape hatches.
- **A glyph set's blocks are the code's ink.** An authored set can
  make a code unscannable; the built-ins cannot.

## Testing

- Node: the encoder's version choice and level boost (a fixed string
  at each level lands on the expected version, never a lower level);
  the packing at each aspect and scale over a hand-made 3 × 3 matrix;
  the full-only fallback widening modules; the
  element's attributes, fallbacks, whitespace, warnings, transcript,
  and glyph set through `renderQrLeaf`.
- Scannability, end to end: a test decodes the rendered code with
  `qr/decode.js` — first from the packed rows
  rasterized cell by cell in Node, at every aspect, scale, and level,
  dark on light and light on dark; then from a real screenshot of a
  Storybook fixture in the Docker sweep, in each font the repo ships —
  the preview's JetBrains Mono (off-square half blocks) and the `dos`
  theme's VGA face (exact) — with the standard quiet zone as padding,
  the decoder's minimum. Themes on system fonts stay out of the fixture:
  they would test the machine's fallback (the Docker image's
  `monospace` is a CJK face whose block glyphs are double-width,
  clipped to their cell). An `aspect="1"` story covers the one-module-per-cell
  packing no bundled font reaches, and a `CustomGlyphs` story the
  two-cell fallback of an authored full-only set.
- Storybook: `Packages / qr-code` for the sweep; `Test / QR` for the
  attribute changes, selection and copy of the transcript, the value
  text kept for assistive technology, and the `Fonts` fixture the
  decode spec screenshots.

## Verification

Done: the bundled fonts' cell ratios (above); a phone read the
Storybook story in all three engines on this machine, at four and two
modules of padding, in the default font and the `dos` theme
(2026-09-05). The decoder test stands in for it in CI.

## Touch points on implementation

- core: the three optional roles on the glyph table's type,
  `glyphSetFor` exported; leaf-renderers.md lists the second consumer.
- `packages/qr-code`: the package, mirroring `packages/ascii`'s
  layout, build, README, and tests; the release workflow publishes it
  with the others.
- README and the Storybook sidebar mention it beside `<mono-ascii>`.
