# Theming (public contract)

Status: **implemented** (core: glyphs.ts + borders/table threading,
`--mw-ansi-*` defaults in the companion, `borders-*` utilities;
themes: `@monowind/themes`; 2026-09-02) — this file is the source of
truth.

## Locked contract

- **Core stands alone.** Everything themable ships with working
  defaults in `monowind` itself — default glyph set, `--mw-fg`/
  `--mw-bg` (the host's own colors; system colors on a bare page),
  and the ANSI-16 `--mw-ansi-*` defaults.
  Themes (from `@monowind/themes` or anyone) only OVERRIDE; zero
  `@monowind/*` packages is always a fully functional engine.
- **A theme is one CSS file, CLASS-SCOPED.** A theme's rules target
  `mono-wind.theme-<name>, .theme-<name> mono-wind` — applied per
  host (or any wrapper), so two hosts on one page can wear different
  themes and every theme file can load simultaneously. No class, no
  theme. Everything themable resolves through CSS the engine reads:
  tokens, `font-family`/`font-size`/`line-height`/`letter-spacing`
  (cell metrics are measured, any monospace works), and a glyph-set
  NAME. Themes need JS only to register a CUSTOM glyph set.
- **Token contract**: `--mw-fg` and `--mw-bg`, which the engine
  derives from the host before each measure (a host coloring itself
  through `--mw-fg` is circular and keeps the seed) — its computed
  `color`,
  and its `background-color` or the nearest ancestor's where its own
  is transparent, `canvas` past the root — and writes into the
  shadow's `:host` rule, so the text and background a host wears
  through `text-*`/`bg-*` or a theme's rule are what the engine
  inverts focus with and what `bg-(--mw-bg)` paints; an explicit
  token on the host outranks the derived one (an outer rule beats
  `:host`) and one on a descendant scopes its subtree. And the sixteen
  `--mw-ansi-{black,red,green,yellow,blue,magenta,cyan,white}` +
  `--mw-ansi-bright-*` properties, inherited, overridable at any
  scope. Consumers of the contract (the engine's focus-invert,
  ascii-art SGR colors, effects) reference tokens, never literals.
- **Border glyph SETS are orthogonal to border STYLES.** Authors keep
  writing `border`, `border-double`, `border-dashed`; a set is the
  rendering vocabulary those styles resolve through — what the themed
  "hardware" can draw (an `ascii` set renders `border-double` as
  `+=+`; a `single-only` set downgrades double to single, like DEC
  terminals). A set maps the engine's FULL glyph vocabulary: border
  styles per side, corners, table-lattice junctions, gap-decoration
  rules and their junctions, multicol rules. Partial sets fall back
  to `default` PER GLYPH (finest granularity — a set may override
  only corners and inherit the rest).
- **Selection is a NAME in CSS, tables in JS**: the inherited custom
  property `--mw-border-glyphs: <name>` — a SINGLE name (a fallback
  list is a possible additive extension) — is read during measuring
  and resolved against the `registerBorderGlyphs(name, set)` registry
  (shared idiom: normalized names, last-wins + warn, post-hoc
  registration relayouts connected hosts). Unknown or unreadable
  names (headless environments read "") resolve to `default`.
- **The set is resolved on the element that OWNS the decoration**:
  borders on the bordered element, a collapsed lattice on the table,
  gap-decoration rules on the gapped container, multicol rules on the
  column container. One owner, one set, per decoration — the general
  rule behind the lattice mixing policy below.
- **Lattice mixing policy**: a collapsed lattice resolves entirely
  with the TABLE's set; per-element overrides are for standalone
  boxes — two sets never negotiate a shared junction.
- **Font pairing is the theme's responsibility**: a glyph missing
  from the themed font falls to the fallback font, whose different
  advance can drift the grid — themes pair sets with fonts verified
  to cover them.
- **A theme DECLARES what its font has not got**, since it cannot know
  which set an author will name: the inherited
  `--mw-missing-glyphs: "╭╮╰╯"` (commas and whitespace free to
  separate) lists characters, read beside `--mw-border-glyphs` and
  applied to whatever set resolved — **a glyph the font has not got
  counts as UNREGISTERED**, so it falls through the per-glyph fallback
  above to one the font draws. Six of the seven themes declare the
  arcs — the five on `Web IBM VGA 8x16` and teletype on Courier New;
  only c64's Pet Me 64 draws them, at its cell. A substitute advancing
  9.633px in an 8px cell is boxed onto its cell, which no scale can do
  while also filling the row — `borders-rounded` on `theme-dos` drew a
  corner broken from the line below it until the declaration, and now
  draws the square corner the font has, as `cp437` always did. An
  absent band is REWRITTEN empty rather than removed, since an absent
  `rounded` inherits the defaults' arcs. Declared, never measured: the
  grid's text stays decided without the canvas, so a document yields
  the same cells in Node and the browser and none change when a
  webfont lands. Declared BECAUSE it cannot be measured: Courier New's
  substitute arc advances 9.03px against a 9.0156px cell, inside the
  tolerance that boxes a glyph, so nothing drifts and no signal fires —
  a wrong-looking corner is visible only to a reader, which is what the
  Test / Themes golden is for.

## Resolved design (as implemented)

- Set shape: per-STYLE tables of named ROLES (`h`, `v`, `tl/tr/bl/br`,
  `teeUp/teeDown/teeLeft/teeRight`, `cross`) — `registerBorderGlyphs`
  in core's glyphs.ts; junction bitmasks map to roles (stub masks read
  as lines). A table's `rounded` lists corner BANDS, `{ radius, tl?,
tr?, bl?, br? }` in cells: a corner draws the registration nearest
  its `border-radius` (`cell-model.md` "Borders: glyph mapping"), the
  plain corner counting at 0 — a set registering `rounded` (even
  empty) or a plain corner for a style replaces the defaults' arcs
  there, so `ascii`, `blocks`, and `rounded` keep their corners at any
  radius and `cp437` and `single` stay square (no arcs in the codepage,
  nor on one-line-style hardware). A table's `weights` lists WEIGHT
  bands, `{ width, cells?, h?, v?, tl?, …, cross? }` keyed by a
  `border-width` in px: a role table with per-glyph fallback to the
  plain table, and `cells`, the border's thickness (1 unless said),
  drawn as that many rings. A border draws the band nearest its width
  (`cell-model.md` "Box model"), ties to the wider, the plain table at
  one cell counting as the 1px band. A set that registers a style's
  table registers its weights too — `weights` when listed, else none —
  so only an untouched style takes the defaults, which register the
  heavy tables from 2px for solid, dashed, and dotted; `single`,
  `ascii`, `rounded`, and `blocks` register `{ width: 2, cells: 2 }`
  on every table they register, two rings of their lines (DEC, ASCII,
  and PETSCII hardware had no heavy) — so `ascii` keeps `double`, its
  own `=` emphasis, at one ring like the defaults, while `single` and
  `blocks`, whose double is their one line, ring it too; `cp437` the
  double table at 2px (the codepage has double, not heavy). A
  registered set is frozen and read as registered; a change is a new
  registration. The thickness is read with the style, so a set
  registered late relayouts connected hosts like any registration.
  Built-in roster: `default`, `rounded` (solid corners → arcs), `ascii` (7-bit;
  double as `+=+`, dotted as `.`/`:`),
  `single` (double/dashed/dotted all downgrade to light — DEC-style
  one-line-style hardware), `blocks` (uniform CP437 blocks per role;
  styles map to shade density — solid/double `█`, dashed `▒`, dotted
  `░`), `cp437` (double survives; dashed/dotted downgrade to solid —
  the codepage has no dashed line glyphs, and a fallback font would
  break the bitmap grid).
- Glyph tables also carry the scrollbar roles `scrollTrack` /
  `scrollThumb` (defaults `░` / `█`; `ascii` maps `|` / `#`) —
  specs/scrolling.md — and the `shadow` ramp, shades from a box's
  shadow core outward (default `█ ▓ ▒ ░`; `ascii` `# + : .`) —
  specs/box-shadow.md.
- ANSI defaults live in core's companion alone (`mono-wind` base
  block).
- Authoring sugar shipped: `borders-default/rounded/ascii/single/blocks/cp437`
  utilities in core's utilities.css set the custom property; arbitrary
  properties work for registered custom sets.
- Palette remapping needed nothing from core: `@monowind/themes`
  generates scoped `--color-*` overrides (nearest-in-OKLAB; lightness
  steps for monochromes) per theme at authoring time.

## Evolution policy

Public surface: every change is ADDITIVE (new tokens with defaults,
new optional set entries, new built-in sets). Anything else is a
breaking change requiring deliberate sign-off and a migration note.

Migration notes:

- 0.3.0: `--mw-fg`/`--mw-bg` derive from the host's colors; a theme
  sets `color` and `background-color` and drops the two tokens (one
  still declaring them keeps its values, an outer rule outranking
  `:host`).
