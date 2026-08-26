# Spec: the cell model

Status: draft (2026-08-25). Normative for the engine and its tests.

This directory holds simplified, cell-adapted versions of the CSS features
monowind re-implements. The guiding rule: **follow the CSS specs as closely as
possible**; every deviation must be called out explicitly in a "Deviations"
section. Planned sibling specs: `flex.md`, `grid.md` (each written before its
implementation milestone).

## Units and value mapping

- The grid unit is the **cell**: 1 column (horizontal) × 1 row (vertical).
  Cells are not square; that is inherent to character grids.
- **Spacing/sizing scale: 1 cell = 0.25rem** (Tailwind's spacing unit).
  Computed px are converted via `px ÷ (0.25 × root font-size)` — measured root
  font-size, never hardcoded 4px. Horizontal values → columns, vertical → rows.
  Applies to: width/height, min/max, padding, margin, gap, insets, etc.
- **Border scale: 1px = 1 cell.** Tailwind's border scale is in px (`border` =
  1px, `border-2` = 2px), so border-width in px maps directly to border cells.
  This is intentionally a different scale from spacing — document it prominently
  in user-facing docs.

### Rounding

After conversion to cells, every value is rounded to the **nearest integer,
ties rounding away from zero** (so negative margins stay symmetric with
positive ones):

```text
p-px   → 1px  = 0.25 cells  → 0
p-0.5  → 2px  = 0.5  cells  → 1
p-1    → 4px  = 1    cell   → 1
p-1.5  → 6px  = 1.5  cells  → 2
-m-0.5 → -2px = -0.5 cells  → -1
w-[137px]     = 34.25 cells → 34
```

Percentages resolve against the parent's content-box cell count, then round by
the same rule. (Flex/grid remainder distribution is separate and lives in those
specs: deterministic, document order.)

## Box model

- All boxes are **border-box**: `width`/`height` include border cells and
  padding cells, matching Tailwind's global default.
- A border consumes N cells on each enabled edge, where N is its cell-mapped
  width. Multi-cell borders render as **concentric rings** of the same style:

  ```text
  border-2:
  ┌──────────────────────┐
  │┌────────────────────┐│
  ││       content      ││
  │└────────────────────┘│
  └──────────────────────┘
  ```

- **Margins are supported** (`m-*`, `mx-*`, `-m-*`…). `space-x/y-*` is
  deliberately **not** supported — use `gap-*` (which is supported).
- Margin collapsing: **adjacent-sibling collapsing only** (the visible gap is
  `max` of the touching margins), in block flow only — margins never collapse
  in flex/grid, per CSS. **Deviation:** no parent–child or empty-box
  collapsing (rare in utility-class code, where padding dominates).
- Auto margins: recognized for centering (`mx-auto`; auto margins in flex
  per the flex spec). MVP may defer; the value must at least parse as `auto`.

## Positioning and insets

- `position: relative` + insets (`top-1`, `-left-2`, `inset-*`) are supported:
  a post-layout visual offset in cells that does not affect siblings, per CSS.
- For elements the engine lays out, the offset is applied through the engine's
  own geometry. For browser-rendered inline content, raw CSS values (e.g.
  `top: 0.25rem` = 4px ≠ 1 row) would land off-grid — the engine rewrites the
  offset via owned custom properties so it resolves to whole cells.
- `absolute`, `fixed`, `sticky`: deferred (absolute-in-grid is attractive for
  overlays later; not MVP).

## Typography

- `font-family`, `font-size`, `line-height` (default **1**), and
  `letter-spacing` are configurable **on the `<mono-wind>` root only**. They
  define the cell metrics (letter-spacing participates in measured cell width).
- On inner elements these properties are **locked** (neutralized by the
  companion stylesheet); font-size/typography utilities on descendants have no
  effect. Multi-size text is out of scope for the foreseeable future.
- Paint-only typography (weight, style, decoration, color) passes through.
  Note: bold/italic can render wider in some monospace fonts — listed under
  font risks, mitigated by font recommendations.
- Inline content must not disturb row height: `vertical-align` and any other
  baseline-shifting properties are neutralized on inline descendants.

## Inline content

Elements whose computed `display` is `inline`/`inline-*`/`contents` are **not
layout nodes**: they belong to their parent's text run and are rendered by
the browser in place. Layout-affecting utilities on inline elements are
ignored (except rescaled relative-position insets, above).

An element whose direct children are ALL inline (or which has no element
children) is treated as a **leaf**, with its combined text content as the
text to wrap. So `<div>hello <span class="text-red-500">world</span></div>`
lays out as a single "hello world" text run — the inline `<span>` still
renders red (browser inheritance), but doesn't get its own layout box.

**Inline detection**: because CSS "blockifies" every direct child of a
`display: flex`/`grid` container (so a `<br>` inside a flex parent computes
to `display: block`), the engine can't rely on `getComputedStyle` alone to
decide inline-ness. It uses a hardcoded list of HTML tags whose default
display is inline (`a`, `br`, `span`, `b`, `i`, `em`, `strong`, `code`, …),
falling back to computed style for anything else. That list is small and
the HTML spec rarely adds new inline elements.

**`<br>` support**: a `<br>` inside a leaf becomes a hard line break in the
wrap calculation. The leaf's intrinsic width is the longest hard-broken
line, and its intrinsic height is the count of hard-broken lines.

Mixed text nodes and block-level element children in the same container is
not supported (documented deviation).

## Borders: glyph mapping

`border-style` selects the glyph set; width selects ring count (above).

| style            | H   | V   | corners       | junctions       |
| ---------------- | --- | --- | ------------- | --------------- |
| `solid` (light)  | `─` | `│` | `┌ ┐ └ ┘`     | `├ ┤ ┬ ┴ ┼`     |
| `double`         | `═` | `║` | `╔ ╗ ╚ ╝`     | `╠ ╣ ╦ ╩ ╬`     |
| `dashed`         | `╌` | `╎` | light corners | light junctions |
| `dotted`         | `┄` | `┊` | light corners | light junctions |
| heavy (reserved) | `━` | `┃` | `┏ ┓ ┗ ┛`     | `┣ ┫ ┳ ┻ ╋`     |

- Unicode has no dashed/dotted corners or junctions; solid-light stands in
  (standard TUI convention).
- `border-radius > 0` maps corners to arcs `╭ ╮ ╰ ╯` (light-line only, so
  applies to solid/dashed/dotted; double/heavy ignore radius).
- Heavy has no CSS `border-style` keyword (`double` claims `═`); exposure is
  TBD — likely a monowind-specific opt-in (e.g. an owned custom property).
- Mixed-style junctions (light meets double: `╞ ╤ ╧ ╡` exist; light meets
  heavy: partial coverage) — resolution rules TBD in the decoration renderer.

## Text alignment

`text-align: left | right | start | end` are on-grid: each line's offset is
`(container_width − line_length) × cell_width`, always a whole number of
cells since character width equals cell width in monospace.

`text-align: center` and `justify` produce fractional per-line offsets when
`(container_width − line_length)` is odd (center) or when inter-word spacing
is redistributed (justify). Both are **forced back to `start`** by the
companion stylesheet (via the engine-owned `data-mw-text-align-blocked`
attribute). To center a text leaf as a whole, wrap it in a flex container
with `justify-center` — that centers at the cell level.

## Deviations from CSS (running list)

1. No parent–child / empty-box margin collapsing (sibling collapsing works
   per CSS: `max` for two positives, `min` for two negatives, sum for mixed).
2. All lengths round to whole cells (rule above).
3. Typography is root-only; descendant typography that affects metrics is
   neutralized.
4. Border-width uses the 1px = 1 cell scale, not the spacing scale.
5. Inline elements ignore layout-affecting properties (borders, sizing).
6. `text-align: center | justify` on descendants is forced to `start`.
7. Mixed direct text nodes + block-level element children in one container
   don't get their text laid out (an all-inline mix does — see Inline content).
8. Inline-ness of an element is determined by its HTML tag (`br`, `span`,
   `a`, `b`, `i`, `em`, `strong`, `code`, …), not by its computed display —
   flex/grid "blockification" of direct children is ignored on purpose.
