# Why each unexplained CSS deviation exists

Status: **research, 2026-09-23**; the decisions under "Order" record
what has been done since. For every deviation the specs list without a
reason: where it came from (spec text, plans, `git log -S`), whether
that reason still holds, and a recommendation. Probes ran in Chromium,
Firefox and WebKit. Origins: **deliberate** (a stated reason),
**deferred** (scope or time), **shortcut** (an implementation
simplification), **none** (no evidence).

Several stated reasons are factually wrong and need correcting whatever
is decided: borders' "most pairs", text indent's "off-grid" and
"per-line", positioning.md 2's "per-line", flex.md's "moot" and
table.md's "exact", host-leaf.md's "they never did", and the
decoration-color claim.

## Main list

- **An ancestor anchors its descendant** (anchor-positioning 3) —
  shortcut (`76a5d17`): anchors are recorded before their subtree is
  walked, in one flat map. No longer holds. Fix, small: the
  containing-block check, a list per name so a refused anchor falls
  back to an earlier one. Browsers refuse the box's containing block
  and an absolute anchor after the box; they accept a static ancestor
  inside the containing block, and any ancestor of a fixed box or a
  popover.
- **`scroll-smooth` locked to `auto`** (scrolling 4) — deliberate
  (scrolling.md "Scroll containers scroll at once", `fa37b24`): a
  smooth thumb drag fought itself, a relayout's restore scrolled a
  reveal back. Partly holds: three writes still rely on it, and a
  relayout cancels a smooth scroll in flight. Keep, with that wording;
  optional medium fix (instant writes, relayouts held during a
  non-gesture scroll).
- **Authored `scroll-padding` discarded** (scrolling 3) — shortcut: the
  lock replaces rather than adds. Fix, small: the authored value in
  cells added inside the lock's `calc()`.
- **Text indent: negative → 0, `%` → 0, left out of intrinsic sizes**
  (cell-model "Text indent") — shortcut (`57b923f`), wrong reasons: `%`
  is readable and resolves once against the block, a negative indent is
  whole cells, and browsers count the indent in min/max-content. Fix,
  small ×3; risk: code assuming a line's x ≥ 0.
- **`%` insets on inline relative elements → 0** (positioning 2) —
  shortcut, wrong reason: the basis is the block container's content
  box, and Firefox's px path makes it inconsistent today. Fix,
  small–medium.
- **Margins on inline-blocks ignored** (cell-model 5) — none
  (`4872a4d`). Horizontal margins are whole cells, vertical ones whole
  rows; `<button class="mr-2">` in text loses its margin. Fix,
  small–medium; risks: negative and auto margins, the vertical-align
  math.
- **Mixed-weight or mixed-style corners fall back** (cell-model
  "Borders") — deferred, wrong justification: light×heavy is complete
  in Unicode, and single×double has every junction whose through-lines
  share a style; only heavy×double lacks them. Fix, medium: the mixed
  glyph where the set has it; cp437 themes gain `╒═╤═╕`.
- **An absolute box in a text run at the paragraph's top-left**
  (positioning 3) — none (`4872a4d`). Browsers place it at its inline
  spot, and the atomic-box placement exists. Fix, small–medium.
- **Baseline alignment as `start`** (flex 2, grid 3, table 4) —
  deliberate, wrong reason ("moot"): first-line rows differ by margin,
  border and padding, a whole row each here, and div-table cells
  default to baseline. Fix, medium: a first-baseline row per box; flex
  rows, then tables, then grid.
- **Out-of-sRGB gradient stops clipped, `display-p3` read as sRGB,
  `lab()`/`lch()` unparsed** (gradients 7) — shortcut (the clamped
  `Rgba`). A `lab()` stop is silently dropped, a leading `lab()` is
  taken for the direction, `color(xyz …)` comes out wrong, and
  `from-cyan-500` differs from `bg-cyan-500`. Fix, medium, with the
  missing interpolation spaces and the fade drift.
- **`pre-line`, `pre-wrap`, `break-spaces` collapse whitespace**
  (cell-model 8) — deferred (`980bb2d` did `pre` only); the three
  engines agree on the wrap cases. Fix: `pre-line` small,
  `pre-wrap`/`break-spaces` medium.
- **CJK, em dash, ZWSP, `<wbr>`, soft hyphen are no break points**
  (cell-model hyphen breaks) — deferred; partly holds, since full UAX
  #14 needs the line-break tables. Fix a subset, medium (ZWSP, `<wbr>`,
  soft hyphen, dashes, CJK); keep the rest with that reason.
- **Stacking sorted among siblings only** (positioning "Paint order")
  — shortcut (`20fbec9`, when the browser still painted the text). An
  `absolute z-10` menu in a `relative` card paints under the next
  card; `-z-1` paints over its parent. Fix, medium–large; first step:
  lift z-indexed positioned descendants through `z-index: auto`
  ancestors.
- **`text-align: justify` as start** (cell-model 6) — deliberate,
  expired: the unified render removed its premise. Whole-space
  justification fits the grid, the native copy drifting under a cell
  as center's does. Fix, small–medium.
- **`aspect-ratio` deferred** (cell-model 9) — deferred, stated. The
  metrics reach the reader, and precedent (viewport units, shadows,
  gradients) settles on physical. Fix, medium.

## Lower value

- **`leading-*` on inline elements ignored** — deliberate, holds: a
  taller inline line-height moves the line's text by half-leading, half
  a row for even multiples. Keep, with that wording.
- **Column flex never wraps** — deferred, no cell constraint. Fix,
  medium (Chromium's intrinsic width).
- **`fit-content()` and `calc()` grid tracks** — deferred, no longer
  holds. Fix, small each.
- **A grid holding only text becomes a text leaf** — deliberate, holds
  (native text on the cells), but loses content alignment and track
  sizing. Keep the leaf path; fix content alignment (small) and track
  sizing (medium).
- **`empty-cells`** — deferred. Keep: separate model only, which
  preflight makes rare.
- **Caption margins; the caption inside the table's border** —
  shortcut, browsers apply them. Fix: margins small, the caption outside
  the border medium.
- **`visibility: collapse`** — deferred. Fix for tables (small–medium,
  every engine collapses); keep for flex (Chromium and WebKit hide it).
- **Multicol min-content** — shortcut; the engines agree on count ×
  widest word + gaps. Fix, small.
- **Multicol `break-*: avoid`** — holds: Firefox and WebKit ignore it
  between paragraphs. Keep, with that wording.
- **`@position-try`** — holds: rule descriptors reach no computed value
  (core-architecture D1). Keep, with that wording.
- **Sticky elements as anchors** — shortcut (ordering). Fix,
  small–medium.
- **`shape-outside`** — holds: the browser's wrap around a shape has
  fractional edges. Keep, with that wording.
- **Gradient `background-size`/`-position`/`-repeat`** — deferred;
  Tailwind's gradient utilities never set them. Keep, with that
  wording.
- **Other gradient interpolation spaces** — deferred. Fix, small, with
  the gradient colors.
- **Percent sizes against the space minus margins** — shortcut, wider
  than stated: `w-full mx-4` gives 12 cells where CSS gives 20. Fix,
  small–medium.
- **Ink above or left of the host dropped** — shortcut, costly to
  change. Keep: the host is the canvas.
- **Decoration-color transitions** — the spec is wrong: the grid never
  reads `text-decoration-color`, `-style` or `-thickness`. Fix,
  small–medium: read and paint them.
- **Subgrid gap and line names** — shortcuts; browsers split the gap
  and resolve names. Fix: names small, gap small–medium.
- **Column utilities on the host** — "they never did" is false:
  `columns-2` on the host misplaces every element. Fix now, small: lock
  `columns: auto` on the host (check `flex` and `grid` too).
- **Hover never marked on inline elements** — deliberate, expired (tied
  to the inline-opacity deviation, now gone). Fix, small.
- **`overflow: clip` read as `hidden`** — none: both get an automatic
  minimum of 0 in flex and grid, where browsers keep the content-based
  one for `clip`. Fix, small.

## Order

Decided 2026-09-24: item 4 (stacking) comes next, ahead of incremental
reads, as its own change — an `absolute z-10` menu in a `relative` card
paints under the next card, and a stuck `<th class="sticky top-0">`
under the table body (the StickyHeaderCells story). Its scope: every
positioned box paints in its nearest stacking context's positioned
step, by z-index then tree order, carrying its own clip, scroll and
group; hit testing and the collapsed-table lattice follow the same
order.

Decided 2026-09-25: overflow alignment past the start edge follows
stacking (cell-model.md deviation 21, `2026-09-25-overflow-alignment.md`).

Decided 2026-09-23, after the follow-ups commit: opacity becomes one
color-blending model — each translucent glyph or background color
composited over what the cell already holds, cell `opacity` kept for
layers alone — replacing today's two paths and the "blends only with
the page behind the host" deviation (a spec change first). **Done
2026-09-23** (`2026-09-24-one-opacity-model.md`), group-faithful, each
color clipped to sRGB where it blends, as every engine blends, while a
gradient's stops mix unclipped: item 5's "unclamped" is done with it
for gradients; its `lab()`/`lch()`/`color()` parsing and the rest
stay. The parsing is done since: `lab()`, `lch()` and, from
2026-09-25, every `color()` space (the opacity plan's "Follow-ups").

1. Lock `columns` on the host.
2. Margins on inline-blocks.
3. Percent sizes against the space minus margins.
4. Stacking: lift z-indexed positioned descendants.
5. Gradient color fidelity (lab/lch/`color()`, unclamped,
   interpolation spaces, the fade drift).
6. Baseline alignment: flex rows, then tables.
7. The smalls: text indent ×3, additive `scroll-padding`,
   `fit-content()`/`calc()` tracks, multicol min-content, subgrid
   names, the anchor containing-block check, caption margins, hover on
   inline elements, the decoration properties, `overflow: clip`.
8. `pre-line`, then `pre-wrap`/`break-spaces`.
9. Justify, the UAX #14 subset, the absolute box's static position in a
   run, percent inline insets, `aspect-ratio`.

Also out of date: anchor-positioning.md's "Firefox … positions nothing"
(Firefox 155 anchors natively). **Fixed 2026-09-24.**
