# Border weight implementation plan

Status: **implemented** (2026-09-12; every phase green, goldens re-recorded). Specs: `cell-model.md` "Box model"
and "Borders: glyph mapping", `theming.md` (weight bands),
`gap-decorations.md` and `multicol.md` (rules) — normative; this plan
only sequences them.

## Phases (each ends green: `pnpm check` + the visual sweep)

### 1. Weight bands in the glyph registry

- `glyphs.ts`: `HEAVY_JUNCTIONS` (the 16-mask table: `━ ┃ ┏ ┓ ┗ ┛ ┳ ┻
┣ ┫ ╋`), and heavy line pairs for dashed (`╍ ╏`) and dotted
  (`┉ ┋`) over the heavy corners and junctions. `GlyphTable.weights?:
WeightBand[]`, a band `{ width: number; cells?: number } & GlyphRoles`
  (the role fields, `rounded` and `shadow` excluded). The defaults'
  bands: solid, dashed, dotted at `width: 2`, one cell, the heavy
  tables.
- `weightBand(style, px, set)`: the band nearest `px`, ties to the
  wider, the plain table at 1px and one cell counting as a band; a set
  that registers a style's table registers its weights too — `weights`
  when listed, else none — so only an untouched style takes the
  defaults. Returns the merged table (band roles over the set's plain
  table over the built-ins, per glyph) and `cells`.
- Built-in sets: `single` and `ascii` register `{ width: 2, cells: 2 }`
  for solid, dashed, dotted (two rings of their lines); `cp437` the
  double table at `width: 2` for solid; `blocks` `{ width: 2, cells: 2
}`; `rounded` `{ width: 2, cells: 2 }` (PETSCII has no heavy);
  `double` gets no band anywhere.
- `cornerGlyph` takes the weighted table: a band with its own corner
  (heavy) has no arcs, so it stays square; a band without (rings)
  keeps the plain corner's arcs, a ring inside a cell less.
- `glyphs.test.ts`: bands per set — the defaults heavy from 2px, a tie
  at 1.5px wider, rings for `single`/`ascii`/`blocks`/`rounded`, double
  for `cp437`, a custom band's per-glyph fallback, `double` unbanded.

### 2. Reading: cells and weight

- `types.ts`: `CellStyle.borderWeight: PerSide<number>` (px, 1 where
  there is no border); `border: Insets` stays the cells. `GapRule`
  gains `weight` (px) beside `width`, which becomes the band's cells.
  `LatticeBorder` and `LatticeSegment` gain `weight`.
- `style.ts`: `readBorderInsets` becomes `readBorder(cs, set)` — the
  set resolved from `--mw-border-glyphs` before the borders are read —
  yielding `border` (band cells per side) and `borderWeight`;
  `readGapRule` resolves the band for the rule's style and width, the
  gap floor following `width` in cells unchanged (`layout.ts`,
  `grid.ts`, `multicol.ts` read `ruleX.width` already). A missing
  registry entry (an unknown set) reads the defaults.
- `glyphs.test.ts` (DOM cases): `border-2` reads one cell and weight
  2 under the defaults, two cells under `ascii`; a rule width 2px
  likewise (`gap-decorations.test.ts`).

### 3. Painting by band

- `borders.ts`: `borderGlyphs(style, weight, set)` from the band's
  merged table; `paintRing` takes weights per side, a corner drawing
  the heavier side's band in the corner style rule already there; the
  ring count is the widest side's band cells (`collectBorderRuns`
  unchanged otherwise, rings kept). `lineGlyph` and `junctionGlyph`
  take a weight; a junction's arms of mixed weights draw the heaviest
  arm's band. Gap rules draw their band's table at `rule.width` cells.
- `table.ts`: `resolveSegment` ranks by `weight` (px) then
  `STYLE_RANK`, the line thickness (`vLines`/`hLines`) the winners'
  `width` in cells; `lattice.ts` dominance by weight, glyphs through
  the segment's band.
- `plain-text.test.ts`: the rings test becomes the weight test — a 2px
  solid border heavy at one cell, dashed and dotted heavy, `ascii` two
  rings, `cp437` double, a 2px double border unchanged at one cell;
  `table.test.ts`: a wider cell border winning a shared edge draws
  heavy; `gap-decorations.test.ts`: a 2px rule draws `┃` at one cell,
  two under `ascii`.

### 4. Stories and docs

- `box.stories.ts` "Border Widths": `border-2` heavy (solid, dashed,
  dotted) under the defaults, `border-3 border-double` double; the same under `borders-ascii` (rings) and
  `borders-cp437` (double); a `rounded border-2` square. Golden
  re-recorded. `interactive.stories.ts` Textarea: the `border-2` cell
  count in its play (2, not 4). A gap-decorations story gains a
  `rule-x-2` heavy rule.
- `packages/core/README.md` "Border & rule glyphs": weights, the
  bands, the rings choice; `theming.md` the exact band rule (a
  registered table brings its own weights); `cell-model.md` and
  `gap-decorations.md` as written.
