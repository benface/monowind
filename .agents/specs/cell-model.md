# Spec: the cell model

Status: normative for the engine and its tests, updated as milestones ship.

This directory holds simplified, cell-adapted versions of the CSS features
monowind re-implements. The guiding rule: **follow the CSS specs as closely as
possible**; every deviation must be called out explicitly in a "Deviations"
section. Sibling specs: `flex.md`, `grid.md`, `positioning.md`,
`table.md`, `gap-decorations.md`.

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

Normative spec: `positioning.md` (static/relative/absolute per CSS,
fixed → host-anchored absolute, sticky → relative until scrolling, insets
on the spacing scale, CSS containing blocks and static positions, inline
relative rescaling).

## Overflow

`overflow: hidden` and `overflow: clip` (either axis longhand too) both mark
the element as clipping — content stays inside the engine-allocated box.
Internally normalized to `clip` (no scroll container, cheaper, the precise
semantic for what we do). `auto` and `scroll` are treated as `visible` until
the scrolling milestone.

## Typography

- `font-family`, `font-size`, `line-height` (default **`normal`**), and
  `letter-spacing` (default **0**) on the **`<mono-wind>` root** define the
  cell metrics: cell width = one glyph advance **plus the root's
  letter-spacing**, cell height = the root's line box. The default
  `normal` picks the font's natural leading (~1.15–1.30em) so cell
  height fully contains ascent + descent — inline span backgrounds
  (selection, `bg-*`, focus-invert) then fit within one row instead of
  bleeding into the next. Root leading and tracking size the grid
  itself, decorations included (box-drawing glyphs don't stretch, so a
  cell taller or wider than the glyph shows gaps in borders). On inner
  elements `font-family`/`font-size` are **locked** (neutralized by the
  companion stylesheet); multi-size text is out of scope for the
  foreseeable future. An authored inner font size (Tailwind size
  utility or inline style — the lock hides it from computed style)
  triggers a one-time console warning.
- **Line height on the grid** (`leading-*`, any element the engine lays
  out): `rows per line = max(1, floor(line-height ÷ font-size))`, and
  `line gap = rows − 1` empty rows are inserted **between** wrapped lines
  only — a single line is unaffected, and N lines occupy
  `N + (N − 1) × gap` rows. The divisor is **font-size**, not cell
  height: under the default `line-height: normal` the cell is ~1.15em,
  so dividing by cell height would shrink every leading. Unitless
  values are ratios of the font size (`leading-loose` = 2 → 2 rows per
  line, 1 empty row between); length values (`leading-6` = 24px) go
  through the same floor, so they scale with the root font size like
  CSS. Preflight's default 1.5 floors to 1 row.
  `leading-*` on inline elements is ignored (**deviation**). Rendering: the
  browser paints wrapped lines with `line-height = rows × cell`, and the
  engine cancels CSS's half-leading (the (rows − 1)/2-row offset CSS puts
  above the first line) with an engine-owned shift so every glyph stays on
  its row.
- **Letter spacing on the grid** (`tracking-*`, every element including
  inline ones): `extra = max(0, floor(excess ÷ 0.025em))` where `excess` is
  the element's letter-spacing minus the root's (0.025em is Tailwind's
  `tracking-wide` step; the root's value is inherited and already part of
  the cell, so only the excess counts — symmetric with leading), and each
  character advances `1 + extra` cells — `tracking-wide` renders "hello" as
  `h e l l o`, `tracking-wider` as `h  e  l  l  o`. (Trailing gaps: see the
  subsection below.)
  Tracking gaps are not line-break opportunities; wrapping, min-content,
  and truncation use per-character advances. Negative tracking clamps to 0
  (a grid can't squeeze). Rendering: the engine rewrites `letter-spacing`
  to exactly `root letter-spacing + extra × cell width`.
- Paint-only typography (weight, style, decoration, color) passes through.
  Note: bold/italic can render wider in some monospace fonts — listed under
  font risks, mitigated by font recommendations.
- Inline content must not disturb row height: `vertical-align` and any other
  baseline-shifting properties are neutralized on inline descendants.
  On ATOMIC inline boxes, authored `vertical-align: bottom` is honored —
  the box passes it through to the browser (grid-exact in every engine,
  probed) and the engine drops the line's text to the box's last row
  (the largest bottom-aligned box on the line wins; mixing top- and
  bottom-aligned boxes on one line follows the engine's single text row);
  `top` is the default pin, and `middle`/`baseline` behave as `top`
  (both off-grid: fractional centering, descender-grown line boxes);
  an authored `middle` warns once, like other silent deviations.

### Tracking: trailing gaps

Browsers add letter-spacing after an element's LAST character too, and
require that trailing gap to fit when they break lines. The engine keeps it as well, for exact and
identical behavior in every engine, with one refinement for a laid-out
box's **own** tracking: the gap after a line's last character doesn't
count toward the line's width — the box gives the browser that room by
carving a trailing-gap allowance out of its engine-owned right
padding/border cells (only when those are fewer than the gap does the
element box widen — invisibly; the decorated border stays put). A
tracked **inline element** therefore shows its trailing gap before the
following text (`w i d e  end`), exactly as browsers render it natively.
Cancelling that gap (a negative end margin) was tried and rejected:
browsers then disagree on where such lines break, in content-dependent
ways that resist modeling, so no single wrap model could be exact
everywhere. Laid-out boxes also carry one layout unit (1/32px) of
headroom in their width: engines store lengths by flooring to 1/64px
(Chromium, WebKit) or 1/60px (Firefox), so `n × cell` can land one unit
below the exact advance of a line that fits exactly, and the browser
would wrap it. (Observed with Menlo/DejaVu Sans Mono metrics, not with
JetBrains Mono's 0.6em advance — the `SubpixelHeadroom` story test
guards it with a self-hosted DejaVu subset.) Note: some platforms
(Linux Chromium under default hinting) QUANTIZE glyph advances to whole
pixels; the cell width then measures as an integer, the browser lays
text out with the same quantized advances, and the engine stays
self-consistent — with no fractional accumulation the exact-fit hazard
cannot occur there, and the sweep skips itself.

## Inline content

Elements whose computed `display` is `inline`/`inline-*`/`contents` are **not
layout nodes**: they belong to their parent's text run and are rendered by
the browser in place. Layout-affecting utilities on inline elements are
ignored (except relative insets, rescaled to cells — see
`positioning.md`).

An element whose direct children are ALL inline (or which has no element
children) is treated as a **leaf**, with its combined text content as the
text to wrap. So `<div>hello <span class="text-red-500">world</span></div>`
lays out as a single "hello world" text run — the inline `<span>` still
renders red (browser inheritance), but doesn't get its own layout box.

**Inline detection** goes by COMPUTED display: a child belongs to the
text run iff its computed display is exactly `inline` (or `contents`).

**Atomic inline boxes** (`inline-block`, `inline-flex`, `inline-grid`)
ride the run as SINGLE UNBREAKABLE UNITS, per CSS: the run holds an
object-replacement marker (U+FFFC) whose advance is the box's laid-out
width (shrink-to-fit against the leaf's content box), with break
opportunities on both sides like browsers give replaced elements. The
box stays IN FLOW — the engine sizes it to exactly those cells and the
browser's own line layout places it, so the two agree by construction;
its interior is a normal layout subtree on the grid (`inline-flex`
really is a flex container inside). A box taller than one row GROWS its
line, per CSS line-box growth: the box is `vertical-align: top`, the
line's text stays on the line's first row, and later lines shift down.
**Deviation:** the box's margins are ignored. A BLOCK-level element
nested inside a run is skipped with a warning.
CSS blockification then falls out for free: an authored `block`/`flex` on
a `<span>` makes it a layout node; `position: absolute`/`fixed` blockifies
at computed-value time, so a positioned span leaves the run and becomes an
out-of-flow box (see `positioning.md`); and every element child of a
flex/grid container is an item, exactly as CSS makes it. `display: none`
children are ignored entirely (their text never joins the run).

**Leaves with out-of-flow children**: out-of-flow (absolute/fixed)
children don't force container mode — the element stays a text leaf, its
in-flow inline content forms the run, and the out-of-flow children hang
off it as layout nodes placed by the positioning pass (the
`relative`-parent badge idiom inside a text block).

**`<br>` support**: a `<br>` inside a leaf becomes a hard line break in the
wrap calculation. The leaf's intrinsic width is the longest hard-broken
line, and its intrinsic height is the count of hard-broken lines.

**Whitespace collapsing**: whitespace inside text nodes — including literal
newlines from markup source formatting — collapses to single spaces during
text extraction, exactly like the browser under `white-space: normal`. Only
`<br>` produces a hard break. Whitespace around a hard break is stripped
(the browser strips it at line edges too). A final `<br>` produces no
last line box, but every other edge `<br>` counts (probed, all engines:
`a<br>` is one line, `a<br><br>` two, `<br>a` two, a lone `<br>` one) —
the same rule that gives a final newline in `pre` content no line of
its own.

**Hyphen break opportunities**: like the browser, the wrap model can break
a word after a hyphen run (`mx-auto` → `mx-` / `auto`), except a
word-initial run (UAX #14 LB20a: `-top-1` → `-top-` / `1`, never `-` /
`top-1`; probed — Chromium and WebKit agree, Firefox instead breaks
BEFORE hyphens and is a documented divergence). Segments longer than the width
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
cells since character width equals cell width in monospace. The engine
reads the computed value (normalized LTR: `right`/`end` → end) so
`renderPlainText` mirrors the browser's per-line offsets; a line at or over
the content width stays at start, matching truncation.

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

All are outer (border-box) widths, valid both as `width` and as min/max
limits (`max-w-max`, `min-w-max`, `max-w-fit`, …). On `height` (and height
limits) these keywords behave as `auto` / no constraint (content height is
already intrinsic). Detection uses Typed OM;
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
a scroll container in some engines. The plain-text renderer mirrors truncation:
a clipped nowrap line is cut at the content width, with `…` in the last
visible cell when `text-overflow: ellipsis` is set.

## Form controls

`<input>`, `<textarea>`, and `<select>` render their value, caret,
selection, and IME **natively** — the tree builder treats them as empty
leaves (never descending into a `<select>`'s options), and the light-DOM
color-transparent lock exempts them so their native ink shows on top of
the grid's borders and backgrounds. Placeholders (`::placeholder`, and
`select:invalid` for a required select on its empty option) paint at
half the themed color.

Intrinsic sizes mirror the native ones:

- `<input>`: the `size` attribute (default 20) in content cells.
- `<textarea>`: `cols` (default 20) wide; tall enough for
  `max(rows, wrapped value lines)` — the value is wrapped by the engine
  against the content width from the PREVIOUS layout (snapshotted by
  the host before the measuring pass), so the box grows and shrinks
  with typing and reflow. `field-sizing: content` drops the `rows`
  floor to 1. A trailing newline shows its empty line (where the caret
  sits), unlike `<br>`. Line-gap rows from `leading-*` apply as on any
  leaf. Textareas never scroll (`overflow: clip`; the box always fits
  the value) and have no resize handle.
- `<select>`: the longest option label; the SELECTED option's label
  under `field-sizing: content`.

Relayouts are held while a focused select's picker is open (Chromium
dismisses the picker on style churn; detected via `select:open`), and
run synchronously when focus moves onto or off a select so the
focus-invert never shows stale.

Screen-reader-only elements (absolutely positioned with a zero `clip`
rect or a clipped ≤1px box — Tailwind `sr-only`) build no layout node:
no grid ink, no layout footprint, still read by assistive tech.

## Deviations from CSS (running list)

1. No parent–child / empty-box margin collapsing (sibling collapsing works
   per CSS: `max` for two positives, `min` for two negatives, sum for mixed).
2. All lengths round to whole cells (rule above).
3. Font family/size are root-only; descendant `leading-*`/`tracking-*` are
   re-quantized to whole rows/cells rather than applied as authored, and
   `leading-*` on inline elements is ignored.
4. Border-width uses the 1px = 1 cell scale, not the spacing scale.
5. Inline elements ignore MOST layout-affecting properties (borders,
   sizing, margins). Horizontal padding IS honored, quantized to whole
   cells: the run reserves the cells as blank markers glued to the
   element's edges (U+2060, so a wrap carries the padding with the edge
   like `box-decoration-break: slice`), and the companion stylesheet
   applies exactly those cells as real padding — any raw off-grid inline
   padding is neutralized. Percent padding reads as 0; vertical inline
   padding passes through untouched (it never moves layout, per CSS).
   Inline backgrounds (`bg-*`, focus-invert) are mirrored into the
   grid, cell-aligned, over the run's cells INCLUDING the reserved
   padding cells (the light-DOM bg itself is transparent-locked). The
   native selection highlight still paints the font's content area
   (ascent + descent); the `line-height: normal` default sizes the row
   to that content area, so it fits within its own row instead of
   bleeding into the next.
   Atomic inline boxes ride the line per CSS (growing their line when
   taller) but their margins are ignored, and BLOCK-level elements nested
   inside a run are skipped with a warning.
6. `text-align: center | justify` on descendants is forced to `start`.
   Content/item alignment on a flex or grid element whose content is BARE
   text (`flex items-center justify-center`, `grid place-items-center`) IS
   supported, but quantized: the browser's own anonymous-item alignment
   would land at fractional, off-grid offsets, so the companion stylesheet
   resets `place-content`/`place-items` on laid-out elements and the
   engine folds the whole-cell offsets into its owned padding instead
   (flex rows justify horizontally / align vertically, columns swap, grid
   uses `justify-items`/`align-items`). The wrap is unchanged — the padded
   content box is exactly the widest line.
7. Mixed direct text nodes + in-flow block-level element children in one
   container don't get their text laid out (an all-inline mix does, and
   out-of-flow children don't count — see Inline content). The dropped
   text is HIDDEN (it would otherwise paint unpositioned over the laid-out
   children) and the engine warns once with the fix: wrap each text
   segment in its own element.
8. `white-space: pre` DOES preserve whitespace: spaces and newlines
   survive as authored, tabs expand to `tab-size` stops (default 8)
   measured from each hard line's start, and browsers render the same
   preserved text (a companion rule restores `pre` on the leaf and its
   inline descendants). Caveats: preservation is decided by the LEAF's
   white-space (an override on an inline descendant is ignored), a final
   newline produces no extra line (as in browsers), and tab stops under
   `tracking-*` may drift from the browser's letter-spaced tabs.
   `pre-wrap | pre-line | break-spaces` still collapse — only the
   wrap/no-wrap half of their behavior is honored.
9. `aspect-ratio` is ignored (deferred: cells aren't square, so it needs
   the cell-metric ratio plumbed into layout plus a spec decision on
   px-square vs cell-square semantics).
10. CSS `order` applies to flex items only (as in CSS); double-width glyphs
    (CJK, emoji) are counted as their UTF-16 length, not their rendered
    width — wcwidth-style counting is future work.
