# `<mono-qr>`: QR codes on the grid

Status: **proposed** (2026-09-05) — spec first; a plan and the
`@monowind/qr-code` package follow. The second consumer of the
leaf-renderer API (specs/leaf-renderers.md) after `<mono-ascii>`.

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
  version that holds the value at the chosen level, with the encoder's
  automatic numeric, alphanumeric, and byte segmentation; text is
  UTF-8. An attribute that does not parse reads as its default.
- **`level`** is the error-correction level, `L | M | Q | H`,
  default `M`: how much of the code can be damaged or covered and
  still read — 7%, 15%, 25%, 30% — bought with more modules. A code's
  size is its VERSION: version 1 is 21 × 21 modules, each version up
  adds 4 per side, to 177 × 177 at version 40. The renderer picks the
  smallest version that holds the value at the requested level; when
  that version has room to spare, the encoder spends it on a higher
  level — the same size, more damage tolerated.
- **`quiet`** is the quiet zone in modules on every side, an integer
  ≥ 0, default `4` — the value the QR spec requires and every reader
  accepts; `2` for tight layouts, which most readers cope with.
- **`aspect`** is the cell's shape: its height over its width, `2`
  for the usual monospace cell that is twice as tall as it is wide
  (two cells side by side make a square). It decides how a square
  module is drawn (see "Packing"). Default `auto`: the renderer reads
  the host's measured cell (`--mw-ch` / `--mw-cw`) each layout and
  snaps it — `≥ 1.5` to `2`, `≤ 0.75` to `0.5`, else `1`. A number
  overrides the measurement and snaps the same way, for a font that
  measures oddly or an author who wants a taller code. Before the
  first measurement (and in the Node renderer) the value is `2`.
- **`scale`** is an integer ≥ 1, default `1`: every module, quiet
  zone included, becomes a `scale × scale` block of modules before
  packing, so the code grows uniformly. Anything else reads as `1`.
- **Colors are the element's.** Dark modules paint in `currentColor`;
  light modules and the quiet zone are the element's background, which
  is transparent by default — `text-*` and `bg-*` utilities on
  `<mono-qr>` set both, and a `bg-*` fills the leaf's whole box, quiet
  zone included. Light ink on a dark background gives an inverted
  code, which most readers accept; `bg-white text-black` on the
  element is the guaranteed-normal code on any theme.

### Packing modules into cells

Cells are whole; the half-block glyphs are what let a cell show two
modules: `▀` inks only the top half of its cell, `▄` the bottom half,
`█` all of it. So at aspect 2 a module — one cell wide, half a cell
tall — is square, and a cell row holds two module rows.

- **Aspect 2 — half blocks.** One module column per cell, two module
  rows per cell row: both dark paints `█`, upper only `▀`, lower only
  `▄`, neither a space. A matrix of `M` modules (quiet zone included)
  is `M` columns by `⌈M / 2⌉` rows; an odd `M` leaves the last row's
  lower half light. A version-1 code with the default quiet zone is
  29 × 15. (The other square at this aspect is two cells wide and one
  tall, `██` — twice the size; that is `scale="2"`, or the fallback
  for a glyph set without half blocks.)
- **Aspect 1 — one module per cell**, `█` or space: `M × M`.
- **Aspect 0.5 — one module per column, two rows tall**, two `█`
  stacked: `M` columns by `2M` rows.
- The packing runs on the SCALED matrix, so `scale` composes with any
  aspect (aspect 2, scale 2: full blocks two cells wide).

### Glyphs through the registry

- A set's `solid` table may name three more roles, next to the
  scrollbar's: `qrFull`, `qrUpper`, `qrLower`. Core carries only the
  type (three optional fields), the `glyphSetFor` export, and one
  string on the built-in `ascii` set; the defaults `█ ▀ ▄`, the
  fallback, and everything else live in the QR package, so the core
  bundle grows by a few bytes. The renderer resolves the element's
  `--mw-border-glyphs` (inherited, so a theme's or a `borders-*`
  utility's set applies) the way the engine does for borders.
- **A set without half blocks renders a module two cells wide.** A
  set that declares none of the three roles gets the defaults; one
  that declares `qrFull` without both halves has no half blocks — the
  `ascii` set declares `qrFull: "#"` alone. At aspect 2 the renderer
  then draws each module of the scaled matrix as two full cells in one
  row, `##`, one cell row per module row: square-ish in the same
  cells, twice the size, and it scans. Aspects 1 and 0.5 never need
  halves.
- A theme therefore restyles a code through its set alone, and an
  author can register a set of their own. The one invariant the
  renderer keeps for scannability is that dark and light stay solid
  areas: a role's glyph is always one cell of ink or none.

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

- **A vendored encoder**, Nayuki's `qrcodegen` (MIT), as a single
  TypeScript module with its license header, the way the ascii package
  ships its FIGlet fonts. No runtime dependency. Versions 1–40, all
  four levels, automatic mask selection.

## Deviations

- **Modules are only as square as the font's cell allows.** At
  aspect 2 a module is one cell wide and half a cell tall, so in a
  font whose cell is 2.4 times taller than wide a module is 1.2 times
  taller than wide. Readers tolerate that much; `aspect` and `scale`
  are the escape hatches.
- **A glyph set's blocks are the code's ink.** A decorative set can
  make a code unscannable; the registry's built-ins cannot.

## Testing

- Node: the encoder against known vectors (a fixed string at each
  level decodes to the expected version and mask); the packing at each
  aspect and scale over a hand-made 3 × 3 matrix; the quiet zone; the
  ascii fallback doubling columns; `renderPlainText` of a host with a
  code.
- Scannability, end to end: a test decodes the rendered code with a
  decoder (`jsqr`, dev dependency) — first from the packed rows
  rasterized cell by cell in Node, at every aspect, scale, and level,
  dark on light and light on dark; then from a real screenshot of the
  Storybook story in the Docker sweep, in the default font and in the
  `dos`, `c64`, and `teletype` themes — exact and off-square half
  blocks, and the ascii fallback — plus an `aspect="1"` story for the
  one-module-per-cell packing no bundled font reaches.
- Storybook: `Components / mono-qr` for the sweep; `Test / QR` for the
  attribute changes, selection and copy of the transcript, and the
  value text kept for assistive technology.

## Verification

Done before the plan: the bundled fonts' cell ratios (above). After
the implementation: a phone scans the Storybook story in Chromium,
Firefox, and WebKit on this machine, at `quiet="4"` and `quiet="2"`,
in the default font and the `dos` theme; the decoder test stands in
for it in CI.

## Touch points on implementation

- core: the three optional roles on the glyph table's type, `qrFull:
"#"` on the `ascii` set, `glyphSetFor` exported; leaf-renderers.md
  lists the second consumer.
- `packages/qr-code`: the package, mirroring `packages/ascii`'s
  layout, build, README, and tests; the release workflow publishes it
  with the others.
- README and the Storybook sidebar mention it beside `<mono-ascii>`.
