# Spec: the cell model

Status: draft (2026-08-25). Normative for the engine and its tests.

This directory holds simplified, cell-adapted versions of the CSS features
monowind re-implements. The guiding rule: **follow the CSS specs as closely as
possible**; every deviation must be called out explicitly in a "Deviations"
section. Sibling specs: `flex.md` (written), `grid.md` (to be written
before the grid milestone).

## Units and value mapping

- The grid unit is the **cell**: 1 column (horizontal) × 1 row (vertical).
  Cells are not square; that is inherent to character grids.
- **Spacing/sizing scale: 1 cell = 0.25rem** (Tailwind's spacing unit).
  Computed px are converted via `px ÷ (0.25 × root font-size)` — measured root
  font-size, never hardcoded 4px. Horizontal values → columns, vertical → rows.
  Applies to: width/height, min/max, padding, margin, gap, insets, etc.
- **Percent spacing** (`p-[5%]`, `m-[10%]`, `gap-[5%]`) is supported:
  percentages stay symbolic at read time and resolve during layout against
  the CSS basis — the containing block's WIDTH for padding and margins
  (all four sides, per CSS), the container's own content box in the gap's
  axis (an unbounded axis resolves to 0). Percent padding counts as 0 in
  intrinsic-size contributions, per CSS. Flex passes carry the containing
  block's width separately from the flex-assigned size, so percent padding
  on flex items resolves against the parent's content width, per CSS. One
  small approximation remains: for a margined child in block flow (or a
  column's cross axis), the basis excludes the child's own margins.
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

**Status: specified, NOT yet implemented** — scheduled for Milestone 3
(see the plan); the engine currently ignores `position` and inset
properties.

- `position: relative` + insets (`top-1`, `-left-2`, `inset-*`) will be
  supported: a post-layout visual offset in cells that does not affect
  siblings, per CSS.
- For elements the engine lays out, the offset is applied through the engine's
  own geometry. For browser-rendered inline content, raw CSS values (e.g.
  `top: 0.25rem` = 4px ≠ 1 row) would land off-grid — the engine rewrites the
  offset via owned custom properties so it resolves to whole cells.
- `absolute`, `fixed`, `sticky`: deferred (absolute-in-grid is attractive for
  overlays later; not MVP).

## Overflow

`overflow: hidden` and `overflow: clip` (either axis longhand too) both mark
the element as clipping — content stays inside the engine-allocated box.
Internally normalized to `clip` (no scroll container, cheaper, the precise
semantic for what we do). `auto` and `scroll` are treated as `visible` until
the scrolling milestone.

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

**Whitespace collapsing**: whitespace inside text nodes — including literal
newlines from markup source formatting — collapses to single spaces during
text extraction, exactly like the browser under `white-space: normal`. Only
`<br>` produces a hard break. Whitespace around a hard break is stripped
(the browser strips it at line edges too).

**Hyphen break opportunities**: like the browser, the wrap model can break
a word after a hyphen run (`mx-auto` → `mx-` / `auto`), except before a
digit (UAX #14: `2026-08` doesn't break). Segments longer than the width
break at cell boundaries (`overflow-wrap: anywhere`). Exotic UAX #14 line
breaking (em dashes, CJK, soft hyphens, …) is not modeled — a deviation.

Mixed text nodes and block-level element children in the same container is
not supported (documented deviation).

## Borders: glyph mapping

`border-style` selects the glyph set; width selects ring count (above).
Styles and colors are per-side (`border-t-cyan-400`,
`[border-top-style:double]`): each edge uses its own style's glyphs and its
own color. A corner where both adjacent edges share a style uses that
style's corner glyph; mixed-style corners fall back to the light corners
(Unicode has no mixed junction glyphs for most pairs — same convention as
dashed/dotted). Corner color comes from the horizontal (top/bottom) edge.

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

## Intrinsic sizing keywords

`width: min-content | max-content | fit-content` (`w-min` / `w-max` /
`w-fit`) are supported:

- **min-content**: the longest unbreakable unit — the longest breakable
  segment under normal wrapping (words split at hyphen break
  opportunities), a whole hard line under `nowrap`. A nowrap flex row sums its
  items' min-content (plus gaps); wrapping rows and block/column containers
  take the widest child.
- **max-content**: the unwrapped intrinsic width (same measure used for
  shrink-to-fit sizing).
- **fit-content**: CSS shrink-to-fit — `min(max-content, max(min-content,
available))`.

All are outer (border-box) widths. On `height` these keywords behave as
`auto` (content height is already intrinsic). Detection uses Typed OM;
the Firefox pre-157 fallback scans the class list for `w-min`/`w-max`/
`w-fit` (getComputedStyle would return the browser's used px width, which
is not on the spacing scale).

The classic centering idiom works: `w-min mx-auto` (or `w-fit mx-auto`)
shrinks the box, then block-flow auto margins center it. Per CSS, `mx-auto`
alone on an auto-width block does nothing — the box fills its container.

## White-space and truncation

`white-space` is read per element and mapped to two engine values:

- **`normal`** (default; also `pre-wrap`, `pre-line`, `break-spaces`): text
  soft-wraps per the greedy word-wrap in `wrap.ts`.
- **`nowrap`** (also `pre`): no soft wrapping. The leaf's content height is
  its **hard-line count** (`<br>` still breaks, per CSS); its intrinsic
  width is the longest hard line (same as normal). **Deviation:** `pre`'s
  whitespace preservation is NOT honored — the tree builder collapses
  whitespace regardless; `pre` only gets `pre`'s no-wrap behavior.

The companion stylesheet locks `white-space: normal` on all descendants (so
browser wrapping matches the engine's), gated on `:not([measuring])` so the
style reader sees the authored value. Nowrap elements get the engine-owned
`data-mw-nowrap` attribute, which switches the lock to `nowrap`.

**Truncation** (Tailwind `truncate` = `overflow: hidden; text-overflow:
ellipsis; white-space: nowrap`) is paint-only: the engine sizes the box at
one hard line tall, and the browser clips and draws the `…` ellipsis
itself. The ellipsis lands on-grid (U+2026 is one monospace glyph; the clip
edge is the content edge, always a whole cell). For a nowrap element that
also clips, the companion stylesheet uses `overflow: hidden` rather than
the usual normalized `clip`, because `text-overflow` requires the box to be
a scroll container in some engines. The ASCII renderer mirrors truncation:
a clipped nowrap line is cut at the content width, with `…` in the last
visible cell when `text-overflow: ellipsis` is set.

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
9. `white-space: pre | pre-wrap | pre-line | break-spaces` don't preserve
   whitespace — only the wrap/no-wrap half of their behavior is honored.
10. `aspect-ratio` is ignored (deferred: cells aren't square, so it needs
    the cell-metric ratio plumbed into layout plus a spec decision on
    px-square vs cell-square semantics).
11. CSS `order` applies to flex items only (as in CSS); double-width glyphs
    (CJK, emoji) are counted as their UTF-16 length, not their rendered
    width — wcwidth-style counting is future work.
