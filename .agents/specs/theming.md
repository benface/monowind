# Theming (public contract)

Status: **implemented** (core: glyphs.ts + borders/table threading,
`--mw-ansi-*` defaults in the companion, `borders-*` utilities;
themes: `@monowind/themes`; 2026-09-02) — this file is the source of
truth.

## Locked contract

- **Core stands alone.** Everything themable ships with working
  defaults in `monowind` itself — default glyph set, `--mw-fg`/
  `--mw-bg` (system colors), and the ANSI-16 `--mw-ansi-*` defaults.
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
- **Token contract**: `--mw-fg`, `--mw-bg`, and the sixteen
  `--mw-ansi-{black,red,green,yellow,blue,magenta,cyan,white}` +
  `--mw-ansi-bright-*` properties. Inherited, overridable at any
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

## Resolved design (as implemented)

- Set shape: per-STYLE tables of named ROLES (`h`, `v`, `tl/tr/bl/br`,
  `teeUp/teeDown/teeLeft/teeRight`, `cross`) — `registerBorderGlyphs`
  in core's glyphs.ts; junction bitmasks map to roles (stub masks read
  as lines). Built-in roster: `default`, `rounded` (solid corners →
  arcs), `ascii` (7-bit; double as `+=+`, dotted as `.`/`:`),
  `single` (double/dashed/dotted all downgrade to light — DEC-style
  one-line-style hardware), `blocks` (uniform CP437 blocks per role;
  styles map to shade density — solid/double `█`, dashed `▒`, dotted
  `░`), `cp437` (double survives; dashed/dotted downgrade to solid —
  the codepage has no dashed line glyphs, and a fallback font would
  break the bitmap grid).
- Glyph tables also carry the scrollbar roles `scrollTrack` /
  `scrollThumb` (defaults `░` / `█`; `ascii` maps `|` / `#`) —
  specs/scrolling.md.
- ANSI defaults live in core's companion (`mono-wind` base block);
  `@monowind/ascii` no longer ships duplicates.
- Authoring sugar shipped: `borders-default/rounded/ascii/single/blocks/cp437`
  utilities in core's rules.css set the custom property; arbitrary
  properties work for registered custom sets.
- Palette remapping needed nothing from core: `@monowind/themes`
  generates scoped `--color-*` overrides (nearest-in-OKLAB; lightness
  steps for monochromes) per theme at authoring time.

## Evolution policy

Public surface: every change is ADDITIVE (new tokens with defaults,
new optional set entries, new built-in sets). Anything else is a
breaking change requiring deliberate sign-off and a migration note.
