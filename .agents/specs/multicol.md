# Spec: multi-column layout

Status: **implemented** — multicol.ts (container path, leaf geometry,
rules), the `layoutTextLeaf` path in layout.ts, and the
`data-mw-multicol` companion rule in styles.css. The normative source
is CSS Multi-column Layout Level 1 (css-multicol-1), cell-adapted per
the rules in `cell-model.md`. Column rules reuse the gap-decoration
machinery (`gap-decorations.md`), which css-gaps-1 explicitly
generalizes from multicol's own `column-rule-*`.

## Motivation

Tailwind's `columns-*` utilities cover two patterns: multi-column
prose (one long text flowing through columns) and masonry-ish card
stacks (children flowing down N columns). Both are supported. Column
rules (`rule-x`) are the classic TUI column separator — a full-height
`│` run in each gap.

## Reading

A container becomes multicol when its computed `column-count` or
`column-width` is not `auto` (and it isn't flex/grid/table — per CSS,
`display: block` + column properties). Inputs:

- **`column-count`** (`columns-1`…`columns-12`, `columns-[N]`):
  computed integer or `auto`, floored. No used-value trap (probe 5:
  computed = specified on a live multicol container), so no
  `data-mw-degrid`-style read assist is needed.
- **`column-width`** (`columns-3xs`…`columns-7xl`, `columns-[16rem]`):
  computed length (px) or `auto`, converted on the SPACING scale
  (horizontal length → columns of cells, like `width`).
- **`column-gap`** (`gap-*`, `gap-x-*`): read as `gapX`, with
  `normal` special-cased per display — 0 for flex/grid, `1em` for
  multicol (16px → 4 cells at default sizes), per CSS. Headless DOMs
  report unset as an empty string; that reads as `normal` too. The
  gap floors at the rule width, exactly like gap decorations
  elsewhere.
- **`column-fill`** (`auto` | `balance`, initial `balance`): read as
  computed; `balance-all` behaves as `balance`.
- **`column-span`** on children (`column-span: all` via Tailwind's
  arbitrary properties or plain CSS): computed `all` | `none`.
- **Rules**: the `rule-x` / `rule-*` utilities via their `--mw-*`
  mirrors, unchanged. Native `column-rule-style` is already neutralized
  on laid-out elements (styles.css), so nothing double-paints.
- **Forced breaks**: `break-before-column` / `break-after-column` on
  children (computed `break-before`/`break-after: column`). Other
  break values are ignored.
- **`break-inside`** on paragraph-flow children: `avoid` /
  `avoid-column` make the child one unbreakable unit (probe 9);
  `avoid-page` correctly does nothing in a column context. Atomic
  children never split anyway.

## Used column count and width (css-multicol §3.4, in cells)

With `available` = the container's content-box width in cells and
`gap` = the used gap:

1. `column-count: N` alone: `count = N`,
   `width = floor((available − (N − 1) × gap) / N)` (min 1).
2. `column-width: W` alone:
   `count = max(1, floor((available + gap) / (W + gap)))`, then width
   as in 1 — columns flex to fill, per CSS.
3. Both: `count = min(N, max(1, floor((available + gap) / (W + gap))))`,
   width as in 1.

**Intrinsic widths**: a multicol container's max-content inner width is
`count × content-max + (count − 1) × gap` when `column-count` drives
the count — probed, all three engines agree. With only `column-width`,
Chromium/WebKit use the content's own max-content (floored at one
`W`-wide column) while Firefox clamps to `W`; the engine follows
Chromium/WebKit (documented divergence). Min-content stays the block
default (widest child / longest unbreakable unit) — deviation 6.

For ELEMENT-CHILDREN containers, leftover cells after `count × width +
(count − 1) × gap` distribute one per column left to right
(deterministic remainder rule, as in flex and grid). A TEXT LEAF
instead keeps all columns EQUAL at the base width and folds the
remainder into the engine-owned right padding: the browser always
equalizes native columns to fractional widths, so unequal engine
tracks would drift off its column origins — with the remainder padded
away, the browser's equal columns start on exactly the engine's whole
cells. A container too narrow for even one `W`-wide column gets one
column at the available width.

## Layout

Three container shapes: a direct-text LEAF, a PARAGRAPH FLOW
(chrome-less text-leaf children, spanners allowed), and ATOMIC element
children (everything else):

### Direct text (the container is a leaf) — full fragmentation

A multicol container whose content is a text run fragments at **line
granularity**, like CSS prose columns. The engine wraps the text at
the column width (the existing wrap model) — TRACKED text at
`width − tracking`: the browser fits a line into its column counting
the phantom trailing letter-spacing gap, and the single-column
trailing-gap carve-out can't work per column (native columns split
the content box equally, so a widened box would widen only the LAST
column) — the companion suppresses the carve-out on multicol leaves
and the fit rule tightens instead; alignment offsets compute against
the same tracked width. The engine then distributes lines
sequentially: a column of `L` lines occupies the TIGHT
`L × (1 + lineGap) − lineGap` rows, its last line's trailing leading
trimmed exactly like a single-column leaf's. The browser counts FULL
line boxes when fragmenting, so the companion re-extends the native
box by the `lineGap` trailing rows (see Browser agreement) — the
fill rule is identical either way (`tight(L) ≤ H` ⟺
`L × (1 + lineGap) ≤ H + lineGap`), and the extra rows are blank
leading hanging past the grid box, the same invisible overhang a
single-column leaf's half-leading already produces. A line's rows
never split across columns. Atomic inline boxes ride their line into whatever column it
lands in (their engine coordinates follow the fragmented line map).

Browser agreement — the reason this is exact: the companion stylesheet
gives the light-DOM container native columns with fully quantized
inputs (`column-count: count`, `column-width: auto`, `column-gap:
gap × cell-width`, `column-fill: auto` via the engine's owned vars,
the `data-mw-multicol` rule), plus `orphans: 1` and `widows: 1` —
their CSS initial value is **2**, and without the reset
Chromium/WebKit would refuse the single-line column endings the
engine's model allows. The engine also folds vertical slack (a box
taller than the fill — explicit height, min-height, flex-assigned
size) into its owned bottom padding, AFTER min/max height clamping so
the fold reconciles against the box the browser actually gets. With
integral line-box heights and a native column height quantized to
exactly the engine's tight fill plus the `lineGap` trailing rows (the
companion's height rule), the `--mw-ink` overhang, and 1/32px rounding
slack (probe 8), the browser's sequential fill breaks at exactly the
lines the engine computed — so the (invisible) native text, the caret, and
selection geometry all sit under the grid's glyphs, the same trick as
everything else in the cell model. `column-fill: auto` plus an
engine-computed height reproduces `balance` deterministically
(sequential fill into the balanced height IS the balanced layout);
the loosely-specified browser balancer is never consulted. Native
columns are applied ONLY to leaf and paragraph-flow containers — an
atomic element-children container's light DOM has nothing in flow
(children are absolutized), so native columns there are inert and
stay off.

### Fragmenting text-leaf children (paragraph flow)

When EVERY in-flow child is a chrome-less text leaf — `display: block`,
static, childless text (styled inline descendants fine), no border,
padding, background, explicit sizing, or `column-span`, `white-space:
normal`, and the container's own line gap — the container lays out as
a PARAGRAPH FLOW: children fragment at line granularity like the
container's own direct text would. One unit stream drives the fill:
each child's wrapped lines (at the tracked column width) as full
`1 + lineGap` line boxes — a `break-inside: avoid` child as ONE
multi-line unit that moves whole to the next column, or, when too
tall for any column, breaks to a fresh column and then splits
greedily (probe 9; WebKit instead abandons `avoid` when it can't be
honored — documented divergence) — collapsed margins between children
(the
engine's collapse rule IS native collapsing: max/min/sum), the column
end trimming the last line's trailing leading (tight model), and a
break truncating any margin it lands in (CSS Fragmentation §5.2 —
probed; WebKit instead KEEPS a margin that falls exactly at a column
end or leads an unforced break, a documented divergence like Firefox's
hyphen wrapping). The first child's top margin stays: a multicol
container is an independent formatting context, so it never
parent-collapses — natively too.

Browser agreement: these children stay IN FLOW (like atomic inline
boxes and form controls) inside the container's native columns —
probed, all three engines split a child at line boundaries and
continue the next child in-column exactly as the engine predicts. The
companion quantizes each child's margins to cells and leaves its width
auto (the native column width); each child carries the engine's
per-line fragment map (`multicolGeometry`) in container-content
coordinates — and NEVER the container's native-columns rule (a flow
child sub-columning itself was the one bug this shipped with).

**In-flow spanners**: a spanner among fragmentable children splits the
flow into SEGMENTS that each balance independently, the spanner (a
normally laid-out box of any kind, at the columns' folded full width)
staying in the native flow with engine-forced geometry and quantized
margins (`data-mw-multicol-flow-span`; its half-leading translate
doubles as the containing block for its absolutized descendants).
Here the reconstruction trick has no per-segment height to force, so
the companion keeps `column-fill: balance` and the natural height and
trusts the NATIVE balancer — probed pixel-identical in all three
engines under quantized inputs, spanner margins never collapsing with
column content (matching deviation 5 and css-multicol §6.1). The
probes bound the scope: segment-leading margins derail WebKit's
balancer and mid-segment margins feed Chromium/WebKit's balance cost
off-grid, so a spanner container requires ZERO vertical margins on its
paragraphs (spanner margins are fine), `column-fill: balance`, and no
height restriction; the engine advances non-final segments by FULL
line boxes (the native stacking) and trims only the final one.

Any other non-fragmentable in-flow child (a decorated box) reverts
the WHOLE container to atomic distribution below — mixing in-flow and
absolutized children would break the native-flow correspondence.

### Element children — atomic distribution

In-flow block-level children are laid out at the column width (the
normal block-child sizing pass) and assigned wholly to one column,
absolutized and engine-positioned like every other laid-out child.
Packing measures every child at the NARROWEST track (so a
remainder-widened column never overflows the fill height) and re-lays
a child out at its placed track's real width.
This is equivalent to `break-inside: avoid` on every child
(**deviation 1**: a tall child never splits mid-element; wrap prose in
its own multicol leaf, or in more elements, to fragment finer).
Adjacent siblings' margins collapse within a column (block-flow
rules); margins never carry across a column break, and a run's leading
margin truncates at the column top, per CSS fragmentation.

Absolute/fixed children position against the container per
`positioning.md`, unaffected by column boxes; their STATIC position is
the column-flow position the box would have occupied (resolved during
the placement pack, top margin collapsing like a sibling's).

### Balancing (`column-fill: balance`, the initial value)

The balanced height `H` is the smallest height such that packing the
content sequentially — starting a new column when the next unit (line
or child) would exceed `H`, and at every forced break — needs at most
`count` columns. The greedy packing at that minimal `H` IS the layout.
Container content height = the tallest column.

### Restricting heights (css-multicol §7)

Both `height` and `max-height` RESTRICT column heights (the effective
restriction is the smaller of the two, when both apply). With a
definite height, `column-fill: auto` fills each column to it
sequentially, and the segment (and its rules) keeps the full fill
height. Content that doesn't fit in `count` columns continues into
**overflow columns** laid inline after the last track (css-multicol
§7.2); they render past the content box and clip or show per
`overflow`, like any overflowing content. `balance` clamps its `H` to
the restriction, overflow columns catching the rest. A `max-height`
restriction alone caps `H` the same way, but the container's height
stays content-driven (the tallest column).

For a TEXT LEAF, the restriction also has to hold browser agreement:
the engine folds the FINAL clamped box's vertical slack into its owned
bottom padding (after min/max height clamping), so the browser's
column box is exactly as tall as the engine's fill and its native
sequential fill breaks on the same lines.

Without any restriction, `auto` behaves as `balance` (CSS: filling
"an infinite height" is meaningless; browsers balance too).

### Spanners (`column-span: all`, css-multicol §6.1)

A child with `column-span: all` interrupts the flow: content before it
forms one multicol SEGMENT (balanced into columns as above), the
spanner lays out at the container's full content width, and content
after it starts a fresh segment below. Segments stack vertically;
each balances independently; column rules paint per segment (their
segments end at the spanner, per css-gaps). A spanner in a direct-text
container can't occur (no element children in a run — an atomic inline
marked `column-span: all` is ignored, matching CSS's "only block-level
descendants span").

## Column rules

Vertical rules paint in each column gap through the existing
gap-decoration pipeline: one band per gap, one segment per SEGMENT
(spanners split them) running the segment's full height. Multicol has
no crossing row gaps, so `rule-break` never splits anything and
`rule-y` is inert. `rule-inset-<n>` retracts segment ends;
`rule-visibility-items` decides whether a rule paints beside an empty
trailing column (`normal`/`between` hide it — CSS paints rules only
between two columns that both have content — `around` needs either
side, `all` always paints). A fixed-height `column-fill: auto`
segment keeps its rules at the full fill height (the column boxes);
balanced segments' rules are as tall as the tallest column. A
full-extent rule tees into the container's border through zero
padding, same as flex/grid.

## Deviations from CSS (running list)

1. **Decorated element children are atomic** (implicit `break-inside:
avoid`): a child with a border, padding, background, explicit
   sizing, or non-text content never splits across columns, and one
   such child (or a spanner) makes ALL the container's children
   atomic. Chrome-less text-leaf children fragment at line granularity
   (see "Fragmenting text-leaf children"). Workaround for prose in a
   decorated child: move the decoration to the container, or split
   into more elements.
2. `orphans`/`widows` are not honored for direct-text fragmentation —
   every line is a valid break point. Since their CSS initial value is
   2, the companion stylesheet actively resets both to 1 on multicol
   leaves (see Browser agreement).
3. ~~A column's last line keeps its trailing leading rows~~ — resolved:
   columns are TIGHT like single-column leaves; the companion re-extends
   the native box by the trailing leading (see Direct text).
4. `break-before`/`break-after` values other than `column` (`page`,
   `avoid`, …) are ignored.
5. Spanner margins don't collapse with adjacent column content
   (segments are independent blocks); CSS collapses them in some
   cases.
6. Min-content width uses the block default (widest child) rather than
   a column-aware contribution; max-content is column-aware (see
   "Used column count and width").

## Implementation probes — PROBED 2026-08-31, all three engines agree

Throwaway page: 7 `<br>`-separated lines, `column-count: 3`,
`column-fill: auto`, height = 3 line boxes exactly, 36px line-height
on 14px text:

1. ✅ `column-fill: auto` + fixed height = pure sequential fill
   ([3, 3, 1] in Chromium, Firefox, and WebKit alike).
2. ✅ Exact-multiple heights break cleanly on line-box boundaries — no
   subpixel flooring in the probe's conditions (integral line-height,
   ink within the line box; probe 8 later found the exception).
3. ✅ `orphans: 1; widows: 1` is LOAD-BEARING: without it Chromium
   breaks [3, 2, 2] (its widows: 2 default avoids the lone last-column
   line) while Firefox and WebKit give [3, 3, 1]. With the reset, all
   three agree.
4. ✅ A `translate` on the container doesn't change fragmentation.
5. ✅ Computed `column-count`/`column-width` on a LIVE multicol
   container return the SPECIFIED values ("2" / "100px" for
   `columns: 2 100px`) — no used-value trap, no degrid assist needed.
6. ✅ In-flow block children inside quantized native columns
   (paragraph flow): all three engines split a child at line-box
   boundaries and continue the next child in-column — exact. A margin
   STRADDLING a break is truncated everywhere (CSS Fragmentation
   §5.2). ⚠️ A margin falling EXACTLY at a column end, or leading an
   unforced break, is truncated by Chromium/Firefox but KEPT by
   WebKit — the engine follows the spec + majority (documented
   divergence).
7. ✅ In-flow spanner under NATIVE `column-fill: balance` (natural
   height, quantized inputs, margin-less paragraphs): all three
   engines balance each segment to the engine's minimal height and
   apply spanner margins without collapsing — pixel-identical,
   spanner margins included. ⚠️ A margin-top on a segment's first
   paragraph derails WebKit's balancer outright (negative offsets),
   and a mid-segment paragraph margin feeds Chromium/WebKit's balance
   cost by HALF its size (off-grid heights) while Firefox truncates
   it — hence the zero-vertical-margin eligibility for paragraphs in
   spanner containers.
8. ⚠️ Found during implementation: WebKit breaks columns at a line's
   INK bottom, not its line-box bottom. A font whose ascent + descent
   exceed its `normal` line box (JetBrains Mono: 18.47px ink in an
   18px box at 14px) gets its last line ejected from every column.
   Chromium and Firefox fragment on line boxes. Fix: the cell-metrics
   probe also measures the ink overhang (Range rect height − line-box
   height) and the companion adds it — `--mw-ink`, plus 1/32px of
   calc-rounding slack — to the multicol leaf's native height. The
   slack is far below a line box, so no engine fits an extra line.
9. ✅ `break-inside: avoid` / `avoid-column` on an in-flow child:
   identical in all three engines under fill:auto AND native balance —
   the child moves whole to the next column, and the balancer accounts
   for the atomic unit. ⚠️ Too tall for any column: Chromium/Firefox
   break to a fresh column and then split greedily; WebKit abandons
   `avoid` and fills greedily from the current column. WebKit's
   balancer can also split a FITTING avoid child when it is the last,
   dominant child (seen live; the probed mid-flow shape is exact). The
   engine follows the majority / its own model — documented
   divergences.

## Testing

- Headless goldens (test/multicol.test.ts): count/width/both
  resolution incl. remainders and the too-narrow case; the 1em default
  gap; max-content intrinsic width; direct-text fragmentation (line
  distribution, leading rows, trailing short column, per-column
  text-align centering, tracked wrap); paragraph flow (a child
  splitting across columns, margin collapse and break truncation,
  `break-inside: avoid` incl. the too-tall fresh-column split, in-flow
  spanners with per-segment rules, sequential fill with overflow
  columns, the decorated-child and margined-spanner-container
  fallbacks to atomic); atomic distribution (equal, unequal, forced
  breaks, margins, static positions, spanner segments, restricting
  heights incl. overflow columns — each pinned to the atomic path with
  a paint-only background, since chrome-less children now take the
  flow path); rules with visibility and per-segment splitting;
  rule-border tees.
- Lockstep: the public `multicolLines` predictor (the multicol
  analogue of `wrapLines`) shares the engine's wrap and fill code; a
  headless test pins its output to the engine's stored geometry, and
  the stories' agreement helper derives its expectations from it.
- Browser stories (multicol.stories.ts): prose columns — count-driven,
  width-driven, and under text-end/center, `leading-loose`, and
  `tracking-wide` — asserting per-character that native line positions
  match the engine's columns (the load-bearing agreement); a
  two-paragraph flow (the first paragraph splitting mid-element, the
  second continuing past its margin row); atomic block children
  distributing across `columns-3 gap-4 rule-x`; single paragraphs
  fragmenting around an in-flow spanner; a fixed-height flow
  pairing overflow columns with `column-fill: auto` underfilling; and a
  gap-decorations matrix (flush `gap-0`, `gap-0 rule` flooring, rule
  styles, inset, border tees, visibility beside an empty trailing
  column).
