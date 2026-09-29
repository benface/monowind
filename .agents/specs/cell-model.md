# Spec: the cell model

Status: normative for the engine and its tests.

This directory holds simplified, cell-adapted versions of the CSS features
monowind re-implements. The guiding rule: **follow the CSS specs as closely as
possible**; every deviation must be called out explicitly in a "Deviations"
section. Sibling specs: `flex.md`, `grid.md`, `positioning.md`,
`table.md`, `gap-decorations.md`, `multicol.md`.

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
  on flex items resolves against the parent's content width, per CSS. A
  percent width, its limits and percent padding resolve against the
  containing block's width whatever the box's margins, the width they
  leave being the space an auto width fills or shrinks within (`fill`):
  `w-full mx-4` in 20 cells is 20 wide and overflows by 8, in block
  flow, a float, a flex column, a grid item, multicol and an inline box
  alike.
- **Border width is a weight the glyph set interprets.** A border's px
  width picks the WEIGHT BAND the owner's glyph set registers nearest
  it, and the band says both what to draw and how many cells thick:
  the defaults draw `border` (1px) as light `─ │` and `border-2` and
  up as heavy `━ ┃`, one cell thick either way, while a set whose font
  has no heavy glyphs may register two cells of its plain lines
  instead — "Borders: glyph mapping". Gap-decoration rules take their
  weight from their width the same way (`gap-decorations.md`).
- **Viewport-relative lengths** (`h-screen`, `h-dvh`/`svh`/`lvh`,
  `w-screen`, arbitrary values like `h-[95dvh]`, and the min/max
  variants) express PHYSICAL screen intent, so they convert via the
  **measured cell size** (`floor(px ÷ cell width|height)`), not the
  spacing scale — `h-screen` fills the actual viewport. Detection is by
  CLASS SCAN in every engine: computed values (Typed OM included)
  resolve viewport units to plain px, indistinguishable from
  spacing-scale lengths. A scanned utility is ACTIVE-CHECKED against
  the resolved computed px (within 30%) — an inactive variant
  (`md:h-screen` below `md`) or an overriding utility or inline style
  resolves elsewhere, to other px or to a keyword (`h-screen md:h-auto`
  at `md` resolves to `auto`), and wins; when they agree the resolved
  px is used, so sv/lv/dv bases are exact. A window `resize` listener
  retriggers layout (the host ResizeObserver alone can miss height-only
  viewport changes). Inline styles are caught too (the style attribute keeps
  the authored unit verbatim, and inline beats classes per cascade).
  **Deviation:** viewport units authored in plain CSS stylesheets are
  only caught where the unit survives to the computed string —
  detecting them otherwise would mean re-implementing the cascade over
  document.styleSheets.

### Mixed-unit `calc()`

An authored `calc()` (an arbitrary-value utility such as
`max-h-[calc(100vh-(--spacing(2)))]`, `_` for spaces, or an inline style) is
evaluated **per term** into cells, because the browser's single computed px
has already lost what each term meant: viewport units convert through the
measured cell like `h-screen` (the rows or columns that fit, floored),
`rem` and `--spacing(N)` are exact cells on the spacing scale, `px` sits on
the same scale, and `+ − * /` with parentheses combine them — so
`100vh − --spacing(2)` is "the rows that fit, minus two". Applies to
`w`/`h` and the four min/max limits, active-checked against the computed px
like viewport utilities (an inactive variant resolves elsewhere and wins).
A term outside that model (`%`, `em`, `var()`) leaves the whole value to
the computed px. Plain-stylesheet calc() shares the viewport
deviation above.

Insets and margins read the browser's computed `calc()` instead, which
keeps only a percentage symbolic and every other term in px: a
percentage plus cells (`{ percent, cells }`), the cells added once the
percentage resolves against its basis — `top-[calc(100%-(--spacing(2)))]`
on a sticky box is the scrollport's height less two rows
(`sticky.md`). Viewport terms there arrive as px, on the spacing scale.
Without Typed OM (Firefox before 157) an inset's used px has resolved
the percentage already, so a percentage inset utility — a fraction,
`full`, an arbitrary percentage or calc() — is read from the class
list, like the sizing utilities' fallback, negative ones too, whether
the minus leads the utility or the value (`-top-1/2`, `top-[-50%]`).

Without Typed OM an inline width, height or inset is read as authored,
as it computes: `px`, `rem` and viewport units by the terms above (on
the spacing scale for an inset, as its computed px has them), a
percentage kept, and a length in another unit (`em`, `ch`, `lh`, a
`calc()` of one) through `getComputedStyle`'s px — the authored length
for an inset. **Deviation (no Typed OM — Firefox before 157):** that px
is a size's USED one, so a size in such a unit that the browser's own
layout has moved (a shrunk flex item, a table cell) reads as moved, as
an arbitrary-value sizing utility (`h-[3ch]`) does.

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
  padding cells, matching Tailwind's global default, and a box is at
  least its edges — a zero-height box with a top border is its border
  row, so an `<hr>` under Tailwind's preflight is a line.
- A border consumes the cells its weight band says — one, by default,
  whatever the width; the width selects the band (heavy from 2px in
  the default set):

  ```text
  border:                  border-2 (default set):   border-2 (a rings band):
  ┌────────────────┐       ┏━━━━━━━━━━━━━━━━┓        ┌────────────────┐
  │    content     │       ┃    content     ┃        │┌──────────────┐│
  └────────────────┘       ┗━━━━━━━━━━━━━━━━┛        ││   content    ││
                                                     │└──────────────┘│
                                                     └────────────────┘
  ```

  A band of N cells draws N concentric rings of its glyphs; the
  allocation is read with the style, so a set registered later
  relayouts connected hosts as any registration does.

- A `background-color` fills the box `background-clip` names in the
  grid — the border box by default, or the padding or content box —
  over what ancestors and earlier boxes painted there: their glyphs
  hidden whatever its alpha, its color composited over their
  background ("Opacity and translucency"). A gradient
  `background-image` fills it a color per cell, and `text` hands
  either to the glyphs (`gradients.md`).
- **Margins are supported** (`m-*`, `mx-*`, `-m-*`…); the spacing
  between siblings is `gap-*`.
- Margin collapsing: **adjacent-sibling collapsing only** (the visible gap is
  `max` of the touching margins), in block flow only — margins never collapse
  in flex/grid, per CSS. **Deviation:** no parent–child or empty-box
  collapsing (rare in utility-class code, where padding dominates).
- Auto margins: recognized for centering (`mx-auto`; auto margins in flex
  per the flex spec). A box wider than its slot gets none and starts at
  the slot's start, per CSS 2 §10.3.3 — in block flow, flex and grid.
  An absolutely positioned box between two insets solves them instead
  (`positioning.md`).
  **Deviation (no Typed OM — Firefox before 157):** `auto` is detected by
  class scan, which cannot see the cascade: a variant override of an auto
  side (`mx-auto sm:ms-0` at `sm` and up) still reads as auto, and an
  inactive variant (`md:mx-auto` below `md`) reads as auto too. Engines
  with Typed OM read the computed value, where the cascade has been applied.

## Positioning and insets

Normative spec: `positioning.md` (static/relative/absolute per CSS,
fixed → host-anchored absolute painted outside its ancestors' clips,
sticky per `sticky.md`, insets on the spacing scale, CSS containing
blocks and static positions, inline relative rescaling). Popovers and
modal dialogs paint last, in a stack above everything, a backdrop a
box the browser draws beneath them (`top-layer.md`); an out-of-flow
box with a `position-area` is placed against its anchor in cells,
flipped where it overflows (`anchor-positioning.md`).

## Overflow

`overflow: hidden` and `overflow: clip` (either axis longhand too) both mark
the element as clipping — content stays inside the engine-allocated box,
and the engine scrolls neither (deviation 24; the light element's lock,
off while the engine reads, is `clip` on a box clipping both axes — a
lone clipping axis is an authored `clip`, and a box with an `auto` or
`scroll` axis keeps its `hidden` axis as authored). They differ as CSS has them: `hidden` makes a scroll
container,
so its automatic minimum is 0 and it roots a formatting context, and
beside it the other axis's `visible` computes to `auto`, its `clip` to
`hidden`; `clip` does none of these, so a clip flex or grid item keeps
its content-based minimum, `overflow-x: clip` alone leaves y visible,
and a clip box beside a float shortens its lines. `auto` and `scroll`
make the element a SCROLL CONTAINER: native scroll physics on the light
element, cell-quantized mirroring on the grid, engine-drawn bars —
specs/scrolling.md is the full contract.

Visible overflow paints past the host, as CSS paints it past any box: the
grid is sized to the INK extent along each visible axis (a root leaf
under `truncate` keeps its box — specs/host-leaf.md) while the host
keeps its in-flow height, so
a box's overflowing rows overlay what follows (its text over a later
block's fill, that block's text over its fills, per positioning.md
"Paint order"), and the host's background follows the ink — the host is
the canvas, as a document's root background covers its overflow. Ink above or
left of the host has no cells and is dropped (deviation).

## Host sizing

The host's used width is a whole number of cells: each layout measures the
host's natural CSS width (its own `width`/`max-width`, its container, its
flex slot) with the engine's rule lifted, lays out the columns that fit
at the text's own advance (the cell rounds it up a hair, so a host
its text sizes holds as many columns as the text characters),
and caps the box to exactly those columns plus its padding and border via
an engine-owned `max-width` — so borders, backgrounds, and `mx-auto`
centering land on the grid instead of a fractional edge. A cap rather than
a width, so a shrinking container still shrinks the host natively; growth
is caught by observing the host's parent (a growing container), its
siblings (a flex or grid slot that grows because a sibling shrank), and
the window. A host whose width is its content's (`w-fit`,
`inline-block`, a float, an absolute box, a flex row's item) takes it
from a spacer, as its height does: the shadow viewport's `min-width`,
the columns laid out, lifted while the engine reads so the content
measures anew.

The height is CSS's too. The host keeps `height: auto`; its content
lies out of its flow (the shadow's slot is positioned, outside the
engine's reads), and an in-flow spacer as tall as the content's rows
stands for it, so a host without a height of its own is as tall as its
content, and `h-*`, `h-full`, `h-screen`, a flex or grid parent's
stretch, `aspect-*` from its width, `min-h-*` and `max-h-*` size it as
they size any box. Its sizes are the page's px, not cells, as its
width's are: `h-1` is 4px, and `h-80` is 16 rows of a 20px cell. The
engine reads the height at the start of each layout, the spacer still
the last layout's: equal to it, the content sizes the host; else the
root lays out against the rows that fit, a definite height, and what is
left under the last row, less than a row, is the host's own
background. The height
is not capped to whole rows as the width is: a
cap would hold a `min-h-*` host at its floor as its content grew past
it, where nothing reports the growth. Any change to the height, whatever
changed it, is the host's own resize, which relays it out. A host with
nothing to lay out and no height of its own is zero rows — its padding
and border only, and an empty grid; a `min-h-*` floor above the content
is deviation 21. A host in no box (inside `display: none`)
measures no cell and keeps its last layout, writing nothing, until
its resize as it shows lays it out. The host's own inline content is the root
leaf (specs/host-leaf.md), laid out inside the same content box. A
host inside another host is unsupported: it warns once and keeps its
engine off, and the outer host lays it out as plain content.

## Engine variables

The engine hands the browser its geometry and typography as custom
properties on each light element (render.ts), which the companion
stylesheet turns into cells. Custom properties inherit, so a variable
a rule can read on an element that didn't write it is reset plainly
on every light element, and the engine's inline value, which beats a
plain rule, sets it: `--mw-z` (positioning.md "Paint order"), the
inline insets `--mw-it`/`--mw-ir`/`--mw-ib`/`--mw-il`, an inline
element's padding `--mw-ipl`/`--mw-ipr`, a box's shift
`--mw-sx`/`--mw-sy` (sticky.md) and the middle-alignment baseline
`--mw-vb`. The reset is `initial` where a missing value means `auto`
— `--mw-z` and the insets, whose reading declarations are then
invalid at computed-value time — and the neutral value elsewhere, and
a rule reads a reset variable with no fallback. A variable written on
every box and read under an engine flag alone (geometry, padding and
border cells, leading, indent) needs none, nor does one read only
under a flag render.ts sets with it (flow margins, multicol, the
scroll spacer and gutters, `--mw-va`, a box's restored white space
`--mw-ws`). `--mw-ls` and an editable's
`--mw-ink`/`--mw-ground` are their parent's by design, so an inline
element without its own takes its block's; the ground is written on
every editable box, the theme's spelled out (`var(--mw-bg)`) where no
fill paints. cascade.test.ts sorts every variable render.ts writes
into one of these four classes and checks the reads of each.

A `::before` or `::after` has no inline style, so the engine writes
its variables on its element under its name (`--mw-before-x`), and
its kind in the element's flag (`data-mw-before`, generated-content.md
"The light DOM"): each kind's variables whole, so none is reset,
where the element's descendants inherit them.

What an element carries is its last layout's: an element that layout
wrote no box on — one now inline, or out of the tree — loses a box's
flags and variables, found by the flags one of which marks every box;
one it wrote no inline insets on loses those; one whose pseudo-element
it wrote nothing for, or another kind for, loses that pseudo-element's
writes; and a box, an inline element's padding cells.

A write happens only on change, against the engine's own last write
to that element, so a relayout reads no inline style back. A page's
own mutation that may have changed what the engine wrote — a `style`
written, an element taken out of the host — forgets that element's
last writes, which its next layout makes anew (the pending ones taken
as the layout starts, before its own writes queue theirs).

## Typography

- `font-family`, `font-size`, `line-height` (default **`normal`**), and
  `letter-spacing` (default **0**) on the **`<mono-wind>` root** define the
  cell metrics. Root leading and tracking size the grid itself,
  decorations included (box-drawing and block glyphs stretch to the
  row — specs/wide-characters.md — but not to a cell wider than the
  glyph, so tracking shows gaps in horizontal rules). On inner
  elements `font-family`/`font-size` are **locked** (neutralized by the
  companion stylesheet); multi-size text is out of scope for the
  foreseeable future. An authored inner font size (Tailwind size
  utility or inline style — the lock hides it from computed style)
  triggers a one-time console warning.
  - **Cell width** = one glyph advance **plus the root's
    letter-spacing**, rounded up to a whole number of 1/64 px — the
    layout unit Chromium and WebKit snap box widths to, so a row of
    boxed glyphs (specs/wide-characters.md) ends where a row of text
    does. The grid's letter-spacing carries the sub-unit remainder;
    the light DOM keeps its natural advance and so never overflows an
    element sized in cells.
  - **Cell height** = the root's line box. The default `normal` picks
    the font's natural leading (~1.15–1.30em) so cell height fully
    contains ascent + descent — inline span backgrounds (selection,
    `bg-*`, focus-invert) then fit within one row instead of bleeding
    into the next.
  - **Background gap**: where the line box exceeds the content area
    (WebKit's SF Mono, 16.5px in 17; Chromium and Firefox round the
    two together), an inline background stops short of the row's edges
    and rows of `bg-*` show a hairline, so the host measures the
    difference (`backgroundGap`) and the grid's spans carry half of it,
    rounded up to a whole pixel (Chromium snaps an inline box's
    fractional padding and drags its text a pixel with it), as vertical
    padding, which an inline element paints without moving the line.
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
  `leading-*` on inline elements is ignored (deviation 25). Rendering: the
  browser paints wrapped lines with `line-height = rows × cell`, and the
  engine cancels CSS's half-leading (the (rows − 1)/2-row offset CSS puts
  above the first line) with an engine-owned shift so every glyph stays on
  its row. An atomic inline box's shift starts from where its line's
  leading puts it: half its line's gap below a top-aligned box's line
  box top, above a bottom-aligned one's line box bottom, and none for a
  middle-aligned one, whose baseline already holds its text (render.ts
  `inlineLift`).
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
- Paint-only typography passes through, each element's own on its
  glyphs: the glyph properties (types.ts `GLYPH_PROPERTIES`: weight,
  style, `font-variant-numeric`, `-webkit-font-smoothing`,
  `text-shadow`, `text-underline-offset`) are inherited ones that
  change how a glyph draws, never its advance, read as computed and
  written back on the element's cells where they differ from the
  host's, which the grid inherits — so an upright span in an `italic`
  host stays upright. A property joins the list by that rule; one that
  moves a glyph (`letter-spacing`, `font-stretch`, ligatures) cannot.
  `diagonal-fractions` and `stacked-fractions` are dropped, as they
  merge glyphs. Color and the text decoration have paths of their
  own. Note: bold/italic can render wider in some monospace fonts —
  listed under font risks, mitigated by font recommendations.
  A box's text shows the decoration lines its in-flow ancestors
  propagate beside its own (css-text-decor-3 §2): a paragraph in an
  `underline` block, and a span's text in an `underline` link, are
  underlined; an out-of-flow box, a float and an atomic inline box
  start without them. Each draws as its decorating box draws it, in
  that box's `text-decoration-style`, `-thickness` and `-color`, its
  `currentcolor` resolved there: an underlined amber paragraph's line
  stays amber under a cyan span. **Deviation**: where boxes that draw
  theirs unlike each other stack their lines, all of them draw as the
  innermost draws its own — a cell's span carries one decoration.
- `text-transform`'s case shows on the grid, each text node mapped
  whole in its content language (`lang`): `istanbul` under `lang="tr"`
  is `İSTANBUL`, and a final `Σ` lowers to `ς`. A cluster the mapping
  lengthens (`ß` as `SS`) takes a cell per character, each mapped to
  the source cluster for selection, as a tab's spaces are; a copy
  takes the case shown, as `innerText` does in every engine.
  `capitalize` titlecases a word's first letter where it is lowercase
  (`ß` to `Ss`, `ǆ` to `ǅ`); a word is letters, marks, digits and `_`,
  holds `'`, `’` and `·` between its characters, and runs across inline
  elements (`hel<b>lo</b>` is `Hello`). Where the engines differ, the
  grid takes one: a period ends a word, as in Chromium and Firefox
  (WebKit keeps `foo.bar` one word), and `ß` and the ligatures
  titlecase, as in Firefox and WebKit (Chromium leaves them).
  `full-width` and `full-size-kana` are deviation 20.
- Inline content must not disturb row height: `vertical-align` and any other
  baseline-shifting properties are neutralized on inline descendants.
  On ATOMIC inline boxes, authored `vertical-align: bottom` is honored —
  the box passes it through to the browser (grid-exact in every engine,
  probed) and the engine drops the line's text to the box's margin
  box's last row (the largest bottom-aligned box on the line wins;
  mixing top- and bottom-aligned boxes on one line follows the engine's
  single text row); `top` is the default pin. `middle` puts the line's
  text on the box's margin box's middle row — the lower of the two for
  an even height — and places the box natively by a whole-row baseline
  length the engine writes: the rows from the box's own baseline (its
  last line's, where the box's own alignment puts it — an
  `items-center h-3` box's on its middle row — or its bottom margin
  edge where it draws no line of its own, in which case
  the row's measured baseline is added) to that row, so the browser's text lands on the
  same row in every engine (probed). `baseline` behaves as `top`
  (off-grid: descender-grown line boxes).

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
headroom in their width: engines store lengths on a fixed grid,
truncating to 1/64px (Chromium, WebKit) or rounding to 1/60px
(Firefox), so `n × cell` can land a unit below the exact advance of a
line that fits exactly, and the browser would wrap it. (Observed with
Menlo/DejaVu Sans Mono metrics, not with
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

An element with no block-level element below it — neither among its own
children nor under an inline one — is treated as a **leaf**, with its
combined text content as the text to wrap. So `<div>hello <span class="text-red-500">world</span></div>`
lays out as a single "hello world" text run — the inline `<span>` still
renders red (browser inheritance), but doesn't get its own layout box.

**Inline detection** goes by COMPUTED display: a child belongs to the
text run iff its computed display is exactly `inline` (or `contents`).

**A block inside an inline splits it**, as CSS does (CSS 2.1
§9.2.1.1 block-in-inline): `<span>a<p>b</p>c</span>` lays out as an
anonymous run "a", the block, and an anonymous run "c". An element
whose inline child hides a block is a CONTAINER, not a leaf, and that
child is flattened into its children, so the block reaches the
container's own loop and the inline content each side of it falls
into the runs around it. The inline element still PAINTS as the
browser lays it out, and on the grid its text either side keeps its
style, an entry of its own in each run; what it loses is a layout box
of its own, which it never had. An atomic inline box (`inline-block`
and its kin) is
its own formatting context and keeps its blocks, and an out-of-flow
child is built whole either way. A list item's inside marker before a
leading block is a run of its own, the marker alone (specs/lists.md
"Inside").

**Inline padding and backgrounds.** An inline element's horizontal
padding is quantized to whole cells: the run reserves the cells as
blank markers glued to the element's edges (U+2060, so a wrap carries
the padding with the edge like `box-decoration-break: slice`), and the
companion stylesheet applies exactly those cells as the element's own
padding, its inline descendants taking none. Percent padding reads as
0 (deviation 26); vertical inline padding passes through untouched (it
never moves layout, per CSS). Inline backgrounds (`bg-*`,
focus-invert) are mirrored into the grid, cell-aligned, over the run's
cells including the reserved padding cells (the light element's own
background is transparent-locked).

**Atomic inline boxes** (`inline-block`, `inline-flex`, `inline-grid`)
ride the run as SINGLE UNBREAKABLE UNITS, per CSS: the run holds an
object-replacement marker (U+FFFC) whose advance is the box's margin
box: its laid-out width (shrink-to-fit against the leaf's content box
less its margins) and its horizontal margins, in cells, a percentage
against the leaf's width, `auto` zero, a negative one overlapping its
neighbor, with break opportunities on both sides like browsers give
replaced elements. Where the container sizes itself to its content,
the marker's advance is the box's width contribution and its margins,
as it is for any child: a width of its own, clamped by its min and max,
else its content's. The
box stays IN FLOW — the engine sizes it to exactly those cells and the
browser's own line layout places it, so the two agree by construction
(its right margin gives back the layout-unit headroom and tracking
allowance its width carries, above, so its advance is its cells and a
line holding several boxes that fits exactly fits natively too;
`visual/agreement.spec.ts` checks every story, in all three engines,
for such a box, a flow child, or a float off its cells);
its interior is a normal layout subtree on the grid (`inline-flex`
really is a flex container inside). A margin box taller than one row
GROWS its line, per CSS line-box growth: the box is `vertical-align:
top`, its top margin's rows above it, the line's text stays on the
line's first row, and later lines shift down; a negative top margin
lifts the box above its line (probed 2026-09-28, all three engines). A
bottom-aligned box's line text sits on its margin box's last row, a
middle-aligned one's on its margin box's middle row.
The leaf's boxes are paired with its markers by ORDER — the leaf's
children are built in document order, so a box nested in an inline
ancestor sorts into place — through one accessor (`inlineBoxesOf`),
never by ad-hoc filtering. A margin box narrower than a cell advances
one (deviation 23). A BLOCK-level element nested inside a run is
skipped with a warning (deviation 27).

**Anonymous runs.** A container whose in-flow children mix inline
content — text, inline elements, atomic inline boxes — with
block-level elements lays out each maximal run of consecutive
inline-level nodes as an ANONYMOUS LEAF, CSS 2 §9.2.1.1's anonymous
block box: `source` the container, built over exactly those nodes,
styled by the container's text and inherited paint properties alone
(white-space, leading, tracking, color, weight, style) on no box of
its own. In a block container a run is a block leaf filling the
content width between its block siblings, in document order; in a
flex or grid container each run is an anonymous item, as CSS makes
it. Whitespace-only text between blocks forms no run; out-of-flow
elements in a run are the run's positioned children, as in any leaf.
The host's own text beside a block child runs the same way
(specs/host-leaf.md). A run's bare text nodes cannot be positioned
natively (a wrapper element would break frameworks' reconciliation),
so a mixed BLOCK container keeps its in-flow block children in the
browser's flow instead — FLOW CHILDREN, engine-sized like any laid-out
box, `position: relative` with the engine's insets alone (a sticky
one's shift, sticky.md), with engine margins that put them where the
engine did, the container's half-leading translate and a run's native
line boxes (`lines × (1 + gap)` rows) counted in. A flow child that is
a formatting-context root — a container, or a leaf CSS makes one —
keeps its own (`contain: layout`), and the shadow slot one for the
host's, so a first child's top margin stays inside its container as
the engine placed it; a plain leaf flow child carries none, so a
float's exclusion reaches its lines (specs/float.md). The runs' native lines then fall
on their rows through the typography lock, exactly as a leaf's do: the
text is selectable and copied, a link in a run is clickable at its
cells, a triple-click selects the run, find-in-page lands. In a mixed
flex, grid, or multicol container the bare text stays where the
browser flows it (deviation 6).
CSS blockification then falls out for free: an authored `block`/`flex` on
a `<span>` makes it a layout node; `position: absolute`/`fixed` blockifies
at computed-value time, so a positioned span leaves the run and becomes an
out-of-flow box (see `positioning.md`); a `float` blockifies the same way,
so a floated span leaves its run and the text around it becomes anonymous
runs (see `float.md`); and every element child of a flex/grid container is
an item, exactly as CSS makes it. `display: none`
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

**Line breaking**: like the browser, the wrap model can break a word
after a hyphen run (`mx-auto` → `mx-` / `auto`), except a word-initial
run (UAX #14 LB20a: `-top-1` → `-top-` / `1`, never `-` / `top-1`;
probed — Chromium and WebKit agree, Firefox instead breaks BEFORE
hyphens and is a documented divergence). A subset of UAX #14 beyond it
(wrap.ts `breaksBetween`, an ASCII pair breaking only at a hyphen, save
under `break-all`): a break after a zero-width space, a `<wbr>` (a
zero-cell marker in the run that copies as nothing), a soft hyphen, an
en dash and an ideographic space, never before one, nor before a
hyphen; before and after an em dash, not between two; either side of a
CJK ideograph, kana or Hangul, except before closing punctuation
(`。、）」` and ASCII's `)]},.:;!?`), `ー`, small kana or a combining
mark, and after opening punctuation (`「（`) — the kana as Firefox and
WebKit have it, where Chromium breaks; never either side of a no-break
space (U+00A0, U+202F, U+2007, U+FEFF) or an inline element's padding
cell. A soft hyphen takes no cell, and where a line breaks at it shows
as a `-` in a cell of its own at the line's end, which the line's fit
and alignment count; a hard line's end shows none. `word-break: break-all` breaks between
any two letters as between ideographs, punctuation's rules kept and a
cluster whole, so a word fills its line's end; `keep-all` keeps CJK
runs whole as words. Segments longer than the width break at cell
boundaries (`overflow-wrap: anywhere`). **Deviation**: the rest
of UAX #14 is not modeled (the platform exposes no line-break
segmenter): a `?` before a letter breaks in every engine, a `/` in
Firefox, and neither in the grid.

## Borders: glyph mapping

`border-style` selects the glyph table, `border-width` its weight
(above). Styles and colors are per-side (`border-t-cyan-400`,
`[border-top-style:double]`): each edge uses its own style's glyphs and its
own color. A corner or junction takes its glyph by each arm's line —
light, heavy or double, as the line glyph its band draws reads — so
where the arms draw unlike lines it takes Unicode's mixed glyph for
them (glyphs.ts `mixedJunction`): light × heavy completely (`┍ ┑ ┝ ┿
╂ …`), single × double wherever each axis's arms share a line (`╒ ╓ ╞
╤ ╪ ╫ …`); a cp437 set, whose heavy band is double, draws `╒═╤═╕`.
Where the arms draw alike, where heavy meets double (Unicode has none)
or a set's lines are no box drawing (`ascii`, `blocks`), the corner
takes the style both edges share, else solid, at the heavier weight; a
glyph the themed font declares missing (`--mw-missing-glyphs`, theming.md)
falls back the same way. Corner color comes from the horizontal
(top/bottom) edge.

| style           | H   | V   | corners       | junctions       |
| --------------- | --- | --- | ------------- | --------------- |
| `solid` (light) | `─` | `│` | `┌ ┐ └ ┘`     | `├ ┤ ┬ ┴ ┼`     |
| `solid`, heavy  | `━` | `┃` | `┏ ┓ ┗ ┛`     | `┣ ┫ ┳ ┻ ╋`     |
| `double`        | `═` | `║` | `╔ ╗ ╚ ╝`     | `╠ ╣ ╦ ╩ ╬`     |
| `dashed`        | `╌` | `╎` | light corners | light junctions |
| `dashed`, heavy | `╍` | `╏` | heavy corners | heavy junctions |
| `dotted`        | `┄` | `┊` | light corners | light junctions |
| `dotted`, heavy | `┉` | `┋` | heavy corners | heavy junctions |

- Unicode has no dashed/dotted corners or junctions; solid-light stands in
  (standard TUI convention).
- `border-radius` picks each corner's glyph: a corner's radius, in cells
  on the spacing scale (unrounded; a percentage counts as infinite, an
  elliptical pair as its smaller radius), selects the corner glyph the
  owner's glyph set registers NEAREST it, ties to the larger radius —
  the plain corner is the registration at 0, and the defaults register
  the arcs `╭ ╮ ╰ ╯` at one cell for the light-line styles (solid,
  dashed, dotted), so `rounded-xs` (half a cell) and up round and
  `rounded-[1px]` stays square; double and heavy have no arcs. Where a
  weight band draws rings, a ring inside loses a cell of radius, as
  CSS's inner edge does. A set registers its own bands per style
  (`theming.md`); a collapsed lattice ignores radius, as CSS does.
- **Weight comes from `border-width`**: a glyph set registers WEIGHT
  bands per style (`theming.md`), each a role table plus a thickness
  in `cells` (1 unless said), keyed by a width in px; a border draws
  the band nearest its width, ties to the wider, the plain table at
  1px and one cell counting as a band. The defaults register the heavy
  tables above from 2px for solid, dashed, and dotted, one cell thick;
  double has no heavier weight and keeps `═ ║` at any width. A set
  without heavy glyphs registers what its hardware had instead — two
  rings of its lines (`single`, `ascii`, `rounded`), double lines (`cp437`, as
  DOS interfaces emphasized), two cells of blocks (`blocks`). A heavy
  corner has no arc, so `rounded-*` leaves it square, like double. In
  a collapsed lattice the wider border wins a shared edge, as CSS
  collapses, and its band draws the line at the band's thickness; a
  corner or junction where weights meet takes each arm's line, as
  above.

## Text alignment

`text-align: left | right | start | end | center` are honored, quantized
to whole cells (normalized LTR: `right`/`end` → end). Per line, with
`leftover = container_width − line_length`:

- `end`: offset by `leftover` cells (exact — character width equals cell
  width in monospace).
- `center`: offset by `floor(leftover / 2)` cells (**deviation**: the
  browser's own centering is fractional when leftover is odd; the GRID
  paints the quantized offset, and the browser's half-cell-off copy is
  invisible under the unified render — only native form-control ink
  shows browser centering). Selection is painted on the grid from the
  DOM range and text-mode drags are routed by cell
  (specs/wide-characters.md), so the native copy's half-cell drift
  never shows.
- A line at or over the content width stays at start, matching
  truncation. `renderPlainText` mirrors the same offsets.
- A line's atomic inline boxes — inline-blocks, buttons, inputs — move
  with its text: the alignment offset and the first-line indent place
  the box's cells as they place the characters' (layout.ts
  `lineStart`, shared with the paint), so the grid and the native box
  agree on where the box is.

`text-align: justify` fills each line but a paragraph's last — the
leaf's, or one before a hard break — sharing its leftover cells among
its gaps (spaces, no-break ones too): each word takes the cell nearest
where an even share puts it, a half rounding up, so the gaps' cells
differ by one at most (layout.ts `lineStart`'s `spread`, read by the
paint, the hit and the atomic boxes' placement). The native copy
justifies itself, fractionally, each word within half a cell of the
grid's. Firefox, alone, gives the gap right after an atomic inline box
one and a half shares of a justified line's leftover (probed on plain
pages 2026-09-28), so there the words after it sit up to a cell off
their grid cells. **Deviation**: `text-align-last` is not read, a
paragraph's last line keeping to the start.

## Text indent

`text-indent` is honored on text leaves, quantized to whole cells and
signed, a percentage resolving once against the leaf's content width:
the first formatted line wraps at `width − indent` and paints `indent`
cells in, a negative indent hanging it left of the content box and
widening it (`-indent-6 pl-12`: the first line six cells in, the rest
twelve); `<br>` lines don't re-indent, per CSS, and alignment and
truncation act on the line's width. Min- and max-content count a
length indent on the first line and its first segment, a negative one
narrowing them, a percentage none. A mixed container's anonymous runs
take its indent on its first formatted line alone: the first run's, a
run after a block child starting at 0, as in CSS. The companion
rewrites the native value in cells (`--mw-ti × --mw-cw`, always set —
the custom property inherits, so an `indent-0` child under an indented
ancestor must pin its own 0) so the selectable light-DOM copy sits
under the grid's glyphs; an authored `1rem` would otherwise resolve
against the font size, not the cell width.

## Opacity and translucency

CSS paints a translucent color over what lies beneath it, and
`opacity` renders an element with its whole subtree as one group,
composited over what lies beneath the element. The grid does both in
its cells: the engine blends every translucent color and every
translucent group into the cells it lands on, source-over on
gamma-encoded sRGB as browsers blend, wherever an opaque color lies
beneath to blend with. What no opaque color lies under keeps its
alpha — a group's cell its group's opacity, on its span — and the
browser composites it over what shows through the cell — the host's
background, the page behind the host — as it composites what it draws
itself: a layer's box, a `::backdrop`, the host. A cell carries one
background and one glyph color, final, the glyph's drawn over the
cell's own background, and at most one opacity, its span's.

**Painting a cell.** A cell holds a background and at most one glyph
with its color, painted in paint order:

- A **background** — a box's fill (`background-color` or a
  gradient's cell, inside the box `background-clip` names), an inline
  element's background under its text and padding cells — composites
  over the cell's background and hides its glyph, whatever its alpha:
  the cell is blank beneath it (deviation 11). Over some but not all
  cells of a wide cluster, it blanks the cluster, as any paint over
  part of one does.
- A **glyph** replaces the cell's glyph — a text run's space replaces
  it with a blank — and its color is drawn over the cell's
  background: blended into it where that background is opaque
  (`text-white/50` on `bg-blue-600` is their mix, opaque), kept as it
  is over a translucent background or none, for the browser to draw.
  The glyph beneath is gone (deviation 11).
- A color at **zero alpha** is no paint: a background there leaves
  the cell's as it was, an unpainted one unpainted, and a glyph's
  color over an opaque background is that background exactly, as
  written (`text-transparent` over a gradient shows each cell's color
  unclipped).
- **`currentColor`** is the element's computed `color` by the time
  the grid reads it — in a border, a shadow, a gradient stop,
  `text-current/50` — and a glyph with no color of its own is in the
  host's ink ("The ground").
- A color the engine cannot read is **taken as opaque** and painted as
  written. In a browser every color reads: each form an engine
  computes, and through the shadow the `var()`s the engine writes
  itself.

**Opacity is a group.** An element whose `opacity` is below 1 paints
its subtree — its shadows, fill, borders, text, and descendants, a
fixed one included — onto a transparent grid of its own, blended
there by the rules above, and that grid composites at the element's
opacity `α` over every cell it touched, as CSS composites a group:
the group's glyph, or the blank its background leaves, replaces the
cell's, and the group's background, its glyph drawn over it, lands at
`α` over what the cell held. Over an opaque background the engine
blends them into it — the cell's background becomes `α ×` the
group's over the cell's, its glyph's color the group's glyph over the
group's background at `α` over the cell's — and over a translucent
one likewise, keeping the alpha, but for a glyph over the group's own
background: that cell is the two as CSS composites them, its glyph's
color opaque and its span's opacity the alpha the glyph reaches, its
background beneath at the same. Where nothing lies beneath, the cell
keeps the group's own paint and takes `α` as its span's `opacity`,
for the browser to composite over the host's background and the page.
A later paint over a cell with an opacity lands over its colors at
that opacity. Groups nest innermost first, so opacities multiply as
CSS nests them, a span's too, and a filled button at `opacity-50`
shows its label at half over what lies beneath the button, not over
its own fill. A translucent color inside a group is translucent
within it: `bg-black/50` in an `opacity-50` box is a quarter of black
over what lies beneath, and `text-white/50` there keeps its own alpha
inside the span's opacity.

**Inline elements** are groups too. A `<span>`'s opacity composites
its glyphs, its background, and its padding cells over its block's
cells, inside its inline ancestors' groups as they nest, each
ancestor's background beneath what it holds. What it holds that is
no character — an atomic inline box, an out-of-flow box, a block it
splits around ("Inline content") — composites as a group of its own,
at its own opacity times its inline ancestors'. An inline ancestor a
block splits holds no entry of its own in the runs beside the block
(deviation 16).

**The ground.** Beneath the main grid lies the host's ground: what a
cell no background has reached shows — the host's background and
whatever lies behind the host, an image, a gradient, page content —
which the browser composites, as it composites the translucent paint
and the groups over such a cell. Where one color must stand for the
ground — a selected translucent cell ("Selection") — it is the host's
`--mw-bg` as computed on the host (theming.md): derived from the
host's own background composited over those behind it down to an
opaque one, `Canvas` past the root, or an author's own value, which
names the ground where the derivation cannot see it. The ink is
`--mw-fg`; each is resolved to a color every layout. A translucent
host background shows denser than CSS paints it (deviation 15).
`bg-clear` wipes its cells to the ground — background and glyph,
through any group it sits in — and the group's own paint then
composites over it.

**Gradients** are a background per cell. A gradient cell composites
over the element's own `background-color`, then over the cell, so a
translucent stop shows what lies beneath. A translucent color or a
group over gradient cells blends with each cell's color, one span
still carrying a row's colors (gradients.md). Clipped to `text`, the
gradient colors the box's glyphs, each glyph's own color over the
gradient's at its cell. That is the glyph's color, which an inline
element's opacity composites as a group like any other.

**The top layer** composites over everything painted before it, at
its own opacity alone: its ancestors' groups don't reach it, as the
top layer renders outside them (top-layer.md).

**Layers** (layers.md) are the browser's to composite. A layer root's
opacity, times that of the groups between it and the enclosing
layer's root (or the grid), is its box's native `opacity`, and its
cells paint unfaded inside the box: CSS's group opacity, exactly. A
layer's grid blends as the main grid does: an unpainted cell shows
what lies beneath the box, a group's cell there taking its opacity on
its span, and a `bg-clear` there wipes its cells to transparent. A
top-layer element with a backdrop is such a layer; its `::backdrop`
is a box the browser fades at its own opacity.

**Selection** swaps a cell's final colors — the glyph color and
background, a translucent one composited over the ground first, the
theme's ink and ground for a cell with none of its own — so the
highlight is what the eye sees, reversed, at the span's opacity, as
CSS draws a selection in a faded element.

**`opacity: 0`** still paints its glyphs. At zero alpha each is
invisible — over an opaque background, that background's color
exactly, its span at zero opacity over none — while its characters
stay in the grid, so `select="grid"` selects and copies them (unlike
`invisible`), a grid drag highlighting them in the theme invert
where they are blended (wide-characters.md "Deviations"). Its
backgrounds are no paint: the cells keep theirs.

**Line and block glyphs** join their rows and cells by drawing past
their cell (wide-characters.md), where a translucent color would
composite twice. One drawn translucent — its color, or its span's
opacity, with no opaque background under it, on the main grid or in
a layer — draws each cell once: a stroke is boxed to its cell (the
tiling fit's clip), a band's run cell by cell, and a shade draws
every pixel of its box once in any color (wide-characters.md "A
shade keeps its lattice").
One blended opaque joins its rows as any glyph.

**A color emoji** takes no color from CSS, only an alpha: its color is
never blended into what lies beneath, for the browser to draw as it
draws that color. Its groups fade it by their opacity, over nothing
on its span with the rest of the group; where its cell blends, on its
glyph alone — a span of its own at that opacity, its underline in it,
as WebKit draws a color emoji whole at any color alpha above 0 — so it
fades over its cell's final background (deviation 13). A cell of it a
later glyph blanks takes its color blended at that opacity, as a
faded glyph's.

**What stays native.** The light DOM keeps the authored opacity: a
form control's own ink and an outline fade with their elements over
the blended cells, and the host's own opacity fades the whole grid.
Opacity animates by re-blending with no relayout: each sampled frame
("Animation") repaints the last layout, compositing the cells at that
frame's opacity — a span over nothing takes it as its own, the one
property the frame writes on it — and a layer's box takes the frame's
opacity natively.

**Deviations**: 11–16 of the running list ("Deviations from CSS").

## Effects

A transform or a filter makes its element a layer root: its subtree
paints into a grid of its own, a box in the shadow viewport carrying
the native transform and filter — see specs/layers.md.

## Outlines

`outline` is native, an escape hatch: the browser draws it around the
element's engine-sized box, above the grid, in its own px (`outline-2`
is two pixels, `outline-offset-*` likewise) — it is never quantized to
cells and never painted on the grid. Nothing locks it: the companion's
focus invert sets `outline: none` at a specificity a
`focus-visible:outline-*` utility outranks, so an author's focus ring
draws together with the invert, and a static `outline-*` draws as
authored. The invert itself skips an ARIA composite's container
("Pointer states"), a menu's or a listbox's, whose focus indication is
its highlighted item (styled through its own state attribute). Verified in three engines (`keyboard.spec.ts`: the focused
control's ring).

## Animation

Transitions of the SAMPLED properties — `color`, the `border-*-color`
longhands, and `opacity` — animate the grid with the browser's own
interpolated values and land exactly on the target. A `color`
transition's `transitionrun` on the host starts a per-frame relayout
loop (element.ts) that re-reads computed styles while one runs: the
color reaches what inherits it, which a layout snapshots; the frame
after its last lays out once more, landing it. Each frame reads what
runs under the host (specs/animations.md "Reading"), so a transition
ends there however it ends — an element removed mid-fade included,
whose cancel reaches the host no more. A light element's own
`opacity` or border color inherits into no other node, so its
transition is sampled as its keyframe animation is
(specs/animations.md): each frame reads the live value onto the
element's node and repaints the last layout, a layer root's opacity
going to its box, and the frame after its end repaints its landed
value — no layout of its own. A transition on the host itself, other
than `color`'s, is the browser's alone — its opacity, border colors
and transform are native, the grid fading and moving with the host —
as the host's own animation is; its end reads the grid's place
afresh, where a pointer held still now points. A layer root's
`transform`, `translate`, `rotate`, `scale`, and `filter` are sampled
too, onto its box (specs/layers.md "Animation is sampled"): a
transition of one of them alone re-copies the computed values per
frame, the layout untouched until the loop's last. A frame lays out
once: a
layout scheduled for it and the loop's relayout are one, whichever
the frame runs first — the other finds the frame laid out (element.ts
`#performLayout` cancels the pending request; the loop's tick skips a
frame the request laid out).

This works because the text-visibility lock is
`-webkit-text-fill-color: transparent`, NOT `color: transparent` — the
computed `color` stays live and authored transitions actually run on
it (the native decoration ink takes its own transparent lock, on
`text-decoration-color`; the grid's decoration, its `currentcolor`
resolved on its box at each read, follows `color`).
A light element's gate is its own flag — `data-mw-measuring`, set on
every light element as the layout sets the host's `measuring`, then
`data-mw-settling` on the elements that settle — never the host's
attribute read through a descendant combinator: any rule of that shape
makes each flip of the host's attribute walk its whole subtree, the
shadow grid's every span included (0.85 µs a span a flip in Chromium,
4 ms of a border-heavy page's relayout), where an element's own flag
invalidates the element alone. The host's `measuring` and `settling`
gate its own rules. An element inserted since the last layout carries
no flag and takes the locks until its first.
Under `[measuring]` — and `[settling]`, which replaces it for one
forced style flush at the end of a layout — `transition-property` is
forced to the sampled set: lock-owned properties (backgrounds,
decoration color, geometry) snap instead of animating a lock toggle,
while in-flight fades of sampled properties survive the pass. The
settling flush matters — without it, the snap from the measured real
background back to the lock's transparent would commit with the
authored list live and start a NATIVE fade (transitions beat
`!important` in the cascade) that paints the light-DOM element's box
on top of the grid. Every unmasked commit — frame ends included — then
sees no lock delta, so the authored list is fully respected there:
`transition-colors` does not make `opacity` fade. Only an element with
a transition to start settles: a non-zero duration or delay in any
entry of its lists, the host's own included, read after the reads
while the style is clean. Every other element drops its flag with no
settling flag, before the flush so a settling element snaps against
its parent's locks, and a layout where nothing settles forces no
flush at all, the snap-back committing at the frame's own style
update. Pseudo-elements are never masked.

`background-color` has NO native timeline at all (the lock holds the
light-DOM bg transparent at every unmasked commit), so the engine
SYNTHESIZES its transitions (animate.ts): a read that sees the value
change on an element whose authored `transition` covers
background-color arms a fade the browser eases: a target-less
`Animation` carries the authored duration, delay, and timing function,
backwards-filling as a CSS transition does (the delay shows the
easing's start), and each sample reads its progress. The colors
interpolate premultiplied in OKLAB (sRGB for legacy rgb pairs, per
css-color-4) from each end's own value, written unclipped
(`color(srgb …)` past sRGB), and the fade drives the same per-frame
loop. The
config resolves after the settling flush, where the authored
`transition-property` is readable again and the reads themselves can
start nothing. CSS `animation` keyframes are sampled by the same loop,
per element by what their properties need — a repaint for live
paint-only ones, a box placement for a layer's effects, a relayout for
the rest (specs/animations.md). **Deviation**: transitions of other
non-sampled properties (geometry, a decoration's own color, say) flip
to their target on the next relayout instead of fading.

## Selection

The grid's rows run the grid's full width — every row, blank ones
included — so the `<pre>` is a rectangle of cells: a drag's highlight
sweeps whole rows like a terminal instead of stopping at the last
glyph, a copy is exactly the visible rectangle (alignment survives a
paste into a fixed-width context), and a cell's flat text offset is
read off the painted rows' cell strings (a wide cluster's continuation
cells hold no code units, specs/wide-characters.md). `renderPlainText`
(the Node renderer, `toPlainText`) trims trailing blanks — goldens stay
tidy there.

A light-DOM selection — a text-mode drag, a semantic gesture in
either mode, a keyboard extension, a select-all — is painted on the
grid too: the engine maps the live range to cells and paints them as
reverse video, each cell's own color and background swapped (theme
colors where a cell has none), while the browser's own highlight on
the invisible native text stays invisible (specs/wide-characters.md
"The grid paints the selection"). A grid-mode drag on the `<pre>`
keeps the browser's highlight — the theme invert — so colored text
highlights differently there than under any other selection, a
documented deviation.

A live grid selection survives repaints, by preserving node identity
(paint.ts). A paint whose STRUCTURE matches the last one — same
segment texts, same span/bare split, as during fades, which change
only colors — patches span styles in place: no node churn, so
Selections AND an in-flight drag's browser-internal anchor survive
untouched in every engine. A STRUCTURAL change rebuilds the nodes: the
selection is captured as flat character offsets (via
`Selection.getComposedRanges`, with Chromium's
`ShadowRoot.getSelection()` as the legacy fallback) and restored with
`setBaseAndExtent` after — and while a primary press holds a
selection anchor in the grid, the rebuild is deferred to release
instead, because even a restored rebuild collapses Chromium's drag —
a NATIVE drag's, that is: an engine-driven grid drag
(specs/semantic-selection.md) re-derives its points from flat offsets
and needs no hold, so a press that blurs a focused control inside the
host is taken over by one and the focus invert repaints at mousedown,
not on release.
Any API surprise degrades to the old behavior (selection collapses),
never an error. While a drag that began on the grid is in flight the
host carries `data-mw-dragging`, under which interactive light elements
drop their pointer events too, so the native sweep passes through their
cells instead of stalling at their edge until the pointer is past them.
**Deviations**: a selection reaching OUTSIDE the grid
(e.g. select-all across the page) is not restored across structural
rebuilds; restore assumes a forwards selection where the engine
doesn't expose `Selection.direction`. Multi-click gestures on the grid
are specified in `semantic-selection.md`.

## Observation

The host lays out again on any change to its light DOM's tree or
text, and on a change to an attribute that can change what the grid
shows: `class` and `style`; `id`, a popover's implicit anchor
(anchor-positioning.md) and a `#id` style's hook, `role` and
`tabindex`, which mark the interactives and the composites the focus
invert skips ("Pointer states"), and an invoker's
`popovertarget` or `commandfor`; HTML's rendering attributes — the
states and the presentation the UA styles and Tailwind's variants
read, from `hidden` and `open` to the form controls' `disabled`,
`value`, and validity bounds and the table spans; the ARIA states an
`aria-*` variant styles (`aria-expanded`, `aria-selected`, …); every
`data-*`, which a `data-*:` variant styles; and on a leaf
(leaf-renderers.md) any attribute, which its renderer reads — the list
is observed.ts. An attribute outside it — a `name`, a relation such as
`aria-controls`, a value read by assistive technology alone such as
`aria-valuenow` — changes no rendering and schedules no layout, so a
control updating one on a timer schedules no layout; a style hung on one
through an arbitrary variant paints on the next layout something else
brings. The engine's
own writes never count: those made in a layout are drained before
observation resumes, its `data-mw-*` marks are filtered by name, and
the grid's origin for the top layer lives in the shadow; on the host
itself only `class` and `style` count, `select` relaying out through
the attribute callback and `focus` needing no layout. Above the host,
a `class` or `style` change on any ancestor (past a shadow root, its
host) and a change of the color scheme schedule a layout as well,
since the cascade brings them into what the cells show — a theme
class on the page, the derived tokens' colors (theming.md).

A resize lays the host out again where the layout reads it: the host's
own box at a size other than the one its last layout gave it (a
narrower container shrinks the capped host), a box around it — its
parent or a sibling — at another width ("Host sizing"), and the cell
probe measuring a cell other than the last layout's (a font matched
late, which fires no font event). The resizes a layout causes
schedule nothing: the host's own height and capped width, and a box
around it growing or shrinking in height with it. A box around the
host that changes height only moves the grid, as a page scroll does:
the top layer's origin follows it (top-layer.md), and the pointer's
states re-derive under a pointer held still ("Pointer states"). Fonts settling — `document.fonts`'
`ready`, and `loadingdone` for every later batch — lay the host out
again only where the cell measures differently or a glyph the grid's
boxes were fit from draws differently (wide-characters.md), so a page
whose fonts are already in place loads with one layout — two where a
host holds a textarea, whose value wraps at the width a layout before
gave it ("Form controls").

## Pointer states

Under `select="grid"`, non-interactive light-DOM elements are
`pointer-events: none` (drag-selection lands on the grid), so
`:hover`/`:active` can never match on them. Interactive means the
natively interactive — links, buttons, form controls, labels,
summaries, editable regions, anything with a `tabindex` (a `-1` marks
a focus target, a dialog's or a popover's content, whose text stays the
grid's to select) unless it is an ARIA
composite's container (`role` `grid`, `listbox`, `menu`, `menubar`,
`radiogroup`, `tablist`, `tree`, `treegrid`), whose items are the
widgets and whose own cells stay the grid's — and the ARIA widgets an
accessible component is
built from: `role="button"`, menu items, options, tabs, tree items,
checkboxes, radios, switches, sliders, links, and comboboxes. A grid
press over a focus target, or with a control inside the host focused,
is the engine's, and moves the focus as the click would have: onto the
nearest `tabindex` above the cell's element, else off the focused
control. The engine synthesizes
both (pointer.ts + element.ts): pointer events stay on the grid, the
pointer's cell is hit-tested against the layout tree, and the cell's
element plus its ancestors — the same chain native `:hover` marks, the
inline elements over the cell's character included, innermost last —
carry `data-mw-hover` (`data-mw-active` between press and release,
kept native-faithful: only while the pointer stays over the pressed
element). variants.css redefines the Tailwind `hover:`/`active:` variants
to match either the pseudo-class or the attribute, preserving
Tailwind's own `(hover: hover)` media gate; `group-*` and `peer-*`
compose from the redefined variants automatically. A change of the
hover chain lays the page out, so an inline element joins it only
where its hover can restyle something: it or an ancestor names a hover
variant (a class holding `hover`: `hover:`, `group-hover:`,
`has-hover:`, …), or it is a `group` or a `peer` (pointer.ts
`REACTS_TO_HOVER`; deviation 28); the press chain and the cursor take
every one. The hovered
element's computed `cursor` is mirrored onto the grid so
`cursor-pointer` shows. An `inert` subtree is absent for interaction,
as natively: the chain stops at it (its ancestor is what hovers), and
so do wheel routing, thumb drags, arrow-key focus
(specs/focus-navigation.md), and the semantic gestures. Hover synthesis runs only under
`select="grid"` on hover-capable pointers; active synthesis is not
hover-gated (touch presses count). The chain re-derives on scroll,
after every layout, and when a box around the host moves the grid
("Observation"), so content moving under a stationary pointer
updates like native `:hover`, and a press there lands on what the
grid shows under it.

**The engine marks the interactives.** Each layout, before its read,
marks every light element the list above makes interactive
`data-mw-interactive`, and a composite's container `data-mw-composite`
(element.ts): the companion's grid-mode opt-in and text cursor and the
focus invert's exclusion key on the marks, the invert's read seeing
them. What decides them — `role`, `tabindex`, `contenteditable` — is
observed ("Observation"), so a change applies from the layout it
schedules; an element inserted since the last layout, which the grid
does not show yet, takes no pointer events until its first.

**An element the grid covers takes no pointer.** What the browser's
own hit test lands on an element the grid does not show at that cell —
another box paints over it there, and that box is `pointer-events:
none`, so the hit test saw through it — belongs to the cell, hover and
cursor included. The element gives up its own pointer events while the
pointer stays off its cells (`data-mw-covered`, element.ts, its own
subtree with it), so the browser stops matching its `:hover`, stops
showing its cursor, and hands the press to the grid; the Tailwind
`hover:` variant drops that element's `:hover` too (variants.css), so
the style goes in the frame where the browser's own hover state lags —
Chromium and Firefox re-run theirs in the frame, WebKit about a fifth
of a second later (probed 2026-09-20), which hand-written `:hover`
CSS, native-only by the deviations below, waits out in Safari. A press
that reaches the element anyway — a tap, which no hover precedes —
takes neither the focus nor the activation (element.ts
`#isCoveredTarget`). The cell's own element is the hit test's
innermost, and an element it contains is not covered: an inline one —
a link in a paragraph — is no box of its own, so its cells are its
block's. A mark lasts no longer than the pointer's stay in the
element's own box, the browser hitting it no more: an element the
pointer left holds none, or a press that never hovered it first would
find it deaf. Only a real pointer hit is corrected: a script's
`click()`, a key's activation, and a label's click forwarded to its
control address their element, as they do natively — a key's
activation counts no click (`detail` 0), at the element's centre in
WebKit and the viewport's origin in Chromium and Firefox, and a
label's lands at the label's point, outside the control's box
(counting one click in Chromium and Firefox, none in WebKit; probed
2026-09-23) — and a modal dialog's subtree is the light DOM's
(top-layer.md deviation 7).

**`pointer-events: none` passes the pointer through.** The engine's hit
test takes no box whose computed `pointer-events` is `none`: the cell
falls to what is beneath it, and a descendant that takes pointer events
again (`pointer-events-auto`) is hit, its ancestors in the chain as
natively — a badge laid over a button's corner leaves the press, the
hover and the cursor there to the button, and a link that takes them
again inside a paragraph that takes none holds its own characters'
cells, the paragraph's for the chain. A transformed element that takes
none passes the pointer to what lies beneath where it is drawn, not
where it was laid out (layers.md). The value read is the one written
inside the host, with the grid-mode locks off — each element's
measuring flag — over an `auto` the shadow states: on a grid-mode
host's top-level elements, past its slot's `none`, and on a text-mode
host's slot while the host reads. A lock the page sets above the host
(a modal's, on the body) stays the page's, and the host's own text
takes the pointer whatever the host's value; a nested host passes its
own value down like any element of the outer one, a grid-mode one's
top-level elements stating `auto` as above. An element whose value is
`none` carries `data-mw-pointer-none`, which the
grid-mode opt-in of the interactive elements leaves be: a link the
utility disables takes no press from the browser either (the keyboard
still reaches an `<a href>`; `aria-disabled` without `href` is the
disabled link).

Consumers who redefine `@custom-variant hover` themselves win (last
definition counts) — their selector must include `[data-mw-hover]`
(block form, keeping the media gate) or grid-mode hover stops working;
the README carries the snippet. **Deviations**: only the Tailwind
variants (and selectors written against the data attributes)
participate — raw `:hover` in hand-written CSS stays native-only;
overlaps resolve by grid paint order; native `title` tooltips and JS
pointer/click handlers on non-interactive elements still need a real
hit target — `pointer-events-auto!` is the escape hatch, at the cost
of grid selection over that element.

## Intrinsic sizing keywords

`width: min-content | max-content | fit-content` (`w-min` / `w-max` /
`w-fit`) are supported:

- **min-content**: the longest unbreakable unit — the longest breakable
  segment under normal wrapping (words split at their break
  opportunities, "Line breaking", `word-break` included), a whole hard
  line under `nowrap`. A nowrap flex row sums its
  items' min-content (plus gaps); wrapping rows and block/column containers
  take the widest child.
- **max-content**: the unwrapped intrinsic width (same measure used for
  shrink-to-fit sizing).
- **fit-content**: CSS shrink-to-fit — `min(max-content, max(min-content,
available))`. Its contributions to a parent's intrinsic width are auto's
  — its min-content width at min-content, its max-content width at
  max-content (css-sizing-3) — so a `w-fit` label keeps its shrink-wrapped
  parent (a flex item, a float, a popover) one line wide.

All are outer (border-box) widths, valid both as `width` and as min/max
limits (`max-w-max`, `min-w-max`, `max-w-fit`, …). On `height` (and height
limits) these keywords size as the content height, as `auto` does
(content height is already intrinsic) — though, not being `auto`, a
height keyword keeps a flex or grid item from stretching, per CSS. Detection uses Typed OM;
the Firefox pre-157 fallback scans the class list for `w-min`/`w-max`/
`w-fit` — and `size-*`, which sets both axes, in every form
(getComputedStyle would return the browser's used px width, which is not
on the spacing scale).

The classic centering idiom works: `w-min mx-auto` (or `w-fit mx-auto`)
shrinks the box, then block-flow auto margins center it. Per CSS, `mx-auto`
alone on an auto-width block does nothing — the box fills its container.

## Aspect ratio

`aspect-ratio` (`aspect-square`, `aspect-video`, `aspect-3/2`) is
physical: an `aspect-square` box looks square, as viewport units,
shadows and gradients do. The computed `w / h` (`auto w / h` alike;
`auto`, or a zero term, is none) becomes columns per row through the
measured cell, `(w / h) × cell height ÷ cell width` (`2 × w / h` in a
1:2 cell, the default without metrics), and each size derived from it
rounds once to the nearest cell. A derived size so follows the font
and the line height, as a QR code's modules do: `aspect-square w-20`
is 10 rows in a 1:2 cell, and `size-20` is not square. It sizes the
border box of every box the engine lays out, containers, tables,
floats, atomic inline boxes and absolute boxes included; an inline
element and a table's cells, rows and groups ignore it, as in CSS, and
the host's own box sizes as "Host sizing" says. The shapes below ("as
tall as it is wide") are physical.

- **The derived axis.** With a width and a height both set, the ratio
  does nothing. With one set, the other derives from it:
  `w-20 aspect-square` is as tall as it is wide, and
  `h-10 aspect-video` takes its width from its height, not from the
  fill. With neither, the width is found as without the ratio (the
  fill, or shrink-to-fit for a float, an atomic inline box or an
  absolute box) and the height derives from it. A percent height the
  containing block leaves indefinite counts as unset.
- **Limits.** The derived axis clamps to its own min and max. With
  neither size set, the height's limits also pass through the ratio to
  the width before it resolves: `aspect-square max-h-12` is as wide as
  12 rows are tall, and a `min-h-*` past the fill widens the box past
  its container, as in all three engines. A limit never passes onto a
  set size: `w-20 min-h-40 aspect-video` is 20 wide and 40 tall.
- **Automatic minimum.** While the box is no scroll container (its
  overflow visible or `clip`) and its min on the derived axis is
  `auto`, that axis floors at the content,
  capped by its max: a derived height at the content's height (text
  taller than the ratio grows the box), a derived width at the
  min-content width (a word longer than the width a short box
  derives). `overflow-hidden`, `truncate` and `min-h-0` or `min-w-0`
  keep the ratio.
- **Definite.** A derived height is definite, as a set one is: a
  child's `h-full` resolves against it.
- **Intrinsic width.** A box with a set height contributes the width it
  derives to its parent's min- and max-content widths (an `auto` grid
  column, a `w-max` parent).
- **Flex items, grid items, absolute boxes**: flex.md "Aspect ratio",
  grid.md "Items in their areas", positioning.md "Absolute layout".

Where the engines differ, the grid follows the CSS specs: a table
takes the ratio, which exempts only inline and table-internal boxes,
as in Chromium and Firefox (WebKit sizes it otherwise), and the flex
and grid items follow the rules their specs cite.

## White-space and truncation

`white-space` is read per element:

- **`normal`** (default): text soft-wraps per the greedy word-wrap in
  `wrap.ts`.
- **`nowrap`** and **`pre`**: no soft wrapping. The leaf's content
  height is its **hard-line count** (`<br>` still breaks, per CSS); its
  intrinsic width is the longest hard line (same as normal). `pre`
  keeps the source's spaces and newlines, tabs expanding to their
  stops.
- **`pre-line`**: as `normal`, but each source newline breaks as a
  `<br>` does, the white space around it collapsing away.
- **`pre-wrap`** and **`break-spaces`**: spaces and newlines are kept as
  under `pre` (tabs to their stops), and lines wrap, a hard line's
  leading spaces taking their cells, a break after a space run.
  `pre-wrap`'s spaces at a soft break hang: out of the fit and the
  alignment, and on no line, as a collapsed space at a break is; the
  next line starts at its text. `break-spaces`' every space takes its
  cell, with a break after it, so spaces past the width wrap as a
  word's letters do. A trailing space run counts in the max-content
  width under both (probed).

The companion stylesheet locks `white-space: normal` on all
descendants (so browser wrapping matches the engine's), gated on the
element's measuring flag so the style reader sees the authored value.
Nowrap elements get the engine-owned `data-mw-nowrap` attribute, which
switches the lock to `nowrap`; a companion rule restores `pre` and the
three wrapping values on the leaf and its inline descendants from the
box's `--mw-ws`, which a restoring box, and each box inside one,
carries with its own value, so a box
inside one keeps its own and the browser breaks the text where the grid
does. The leaf's value decides for its whole run (deviation 7).

`text-wrap-style` chooses where a wrapping leaf's lines break:
`balance` takes the lines of the narrowest width that keeps their
count, for a leaf of up to six lines (Chromium's limit; Firefox
balances up to ten), as Chromium and Firefox search for it; `pretty`,
whose choice CSS leaves to the browser, keeps a last line from holding
one word, moving the word before it down where the two fit — as
Chromium does for such a line; Firefox wraps greedily, and WebKit
re-breaks the whole paragraph. **Deviation**: beside a float, the
lines keep their greedy breaks.

**Truncation** (Tailwind `truncate` = `overflow: hidden; text-overflow:
ellipsis; white-space: nowrap`) is paint-only: the engine sizes the box at
one hard line tall, and the browser clips and draws the `…` ellipsis
itself. The ellipsis lands on-grid (U+2026 is one monospace glyph; the clip
edge is the content edge, always a whole cell). For a nowrap element that
clips on both axes, the companion stylesheet keeps `overflow: hidden`
rather than `clip`, because only a scroll container can be
scrolled to what the ellipsis hides: focus a link past the cut and
Chromium and Firefox bring it into view under `hidden` and neither does
under `clip` (WebKit under neither). `text-overflow` itself draws the
same either way in all three. The plain-text renderer mirrors truncation:
a clipped nowrap line is cut at the content width, with `…` in the last
visible cell when `text-overflow: ellipsis` is set.

**Line clamps** (Tailwind `line-clamp-*` = a vertical `-webkit-box` with
`-webkit-line-clamp`, which Chromium and Firefox compute as `flow-root`):
a text leaf's lines past the clamp are cut, its box as tall as the lines
it keeps, and the last kept line ends in `…`, cut as truncation cuts a
line where the `…` would not fit after it — where each engine cuts,
given the host's sub-pixel headroom (probed 2026-09-28). **Deviation**:
a clamp counts a leaf's own lines; a container's block children are
not clamped.

## Form controls

`<input>`, `<textarea>`, and `<select>` render their value, caret,
selection, and IME **natively** — the tree builder treats them as empty
leaves (never descending into a `<select>`'s options), and the light-DOM
color-transparent lock exempts them so their native ink shows on top of
the grid's borders and backgrounds; their selection swaps their own
colors, as the grid swaps a selected cell's, by a rule of their own
reading the ink and ground the engine writes on them
(`wide-characters.md` "The grid paints the selection"). Placeholders
(`::placeholder`, and `select:invalid` for a required select on its
empty option) paint at half the themed color.

Intrinsic sizes mirror the native ones:

- `<input>`: the `size` attribute (default 20) in content cells; a
  `submit`, `reset` or `button` input, its label's: its `value`, else
  the browser's own ("Submit" in Chromium and WebKit, "Submit Query"
  in Firefox), read off its native box where nothing sizes it.
- `<textarea>`: `cols` (default 20) wide; tall enough for
  `max(rows, wrapped value lines)` — the value is wrapped by the engine
  against the content width from the PREVIOUS layout (snapshotted by
  the host before the measuring pass), so the box grows and shrinks
  with typing and reflow. A layout that gives a textarea a width other
  than the one its value was wrapped at — its first, with no width to
  snapshot yet, or one after its width changed — lays the host out
  again, once, at the new width. `field-sizing: content` drops the `rows`
  floor to 1. A trailing newline shows its empty line (where the caret
  sits), unlike `<br>`. Line-gap rows from `leading-*` apply as on any
  leaf; the wrap itself is deviation 17. The box grows to fit its value
  unless a height is set (`h-*`, `max-h-*`), which clips it: a
  textarea never scrolls (`overflow: clip`) and has no resize handle.
- `<select>`: the longest option label; the SELECTED option's label
  under `field-sizing: content`.

Relayouts are held while a focused select's picker is open (Chromium
dismisses the picker on style churn; detected via `select:open`), and
run synchronously when focus moves onto or off a select so the
focus-invert never shows stale. A press on a text field (a textarea,
an input with a value) lays out at once, and so does the focus it
moves, both before the browser begins the drag selecting the field's
value; a layout scheduled after waits for the release. A layout's
measuring pass rebuilds the field's box, which ends that drag in
Firefox and moves its anchor in WebKit; its press and focus states
still show at the press.

Screen-reader-only elements (absolutely positioned with a zero `clip`
rect or a clipped ≤1px box — Tailwind `sr-only`) build no layout node:
no grid ink, no layout footprint, still read by assistive tech.
Renderer leaves are exempt from the clipped-box half (their natural
browser size is 0x0 before the engine sizes them from the renderer's
lines); the explicit zero `clip` rect still drops them.

## Deviations from CSS (running list)

1. No parent–child / empty-box margin collapsing (sibling collapsing works
   per CSS: `max` for two positives, `min` for two negatives, sum for mixed).
2. All lengths round to whole cells (rule above).
3. Font family and size are root-only.
4. Border-width is a weight the glyph set draws ("Box model"), not a
   length on the spacing scale.
5. An inline element's borders, sizes and margins do nothing: an
   authored border warns, and its native width is zeroed, so the
   browser draws none off the grid.
6. An anonymous run's bare text in a mixed FLEX, GRID, or MULTICOL
   container is laid out on the grid but stays where the browser flows
   it natively (see Inline content — a block container's flow children
   put it right), so its native line boxes, the hit boxes of its inline
   elements, and find-in-page highlights sit off the grid there.
7. A leaf's `white-space` is its whole run's: an inline descendant's
   own value (`nowrap`, `pre`, `pre-wrap`, …) is ignored, on the grid
   and natively ("White-space and truncation").
8. Glyph widths are the `wcwidth` table's, not the font's
   (specs/wide-characters.md): East Asian wide and emoji-presentation
   clusters take two cells, ambiguous-width symbols one; a cluster the
   font draws off its cell count is scaled into a cell-sized box on the
   grid, and the transparent native text keeps the font's advances (its
   selection and drags are the engine's, so the drift never shows).
9. A FLOW CHILD's `position: relative` insets move it on the grid only:
   natively its insets are the engine's, so the browser's flow places
   it (see Inline content), and the relative offset never reaches the
   light DOM. A float is a flow child natively too (specs/float.md).
10. Floats deviate as specs/float.md lists: every container is a BFC
    root (it contains its floats and steps aside from a sibling's), a
    float directly in a multicol container is ignored and warned, and
    `shape-outside` is ignored.
11. One glyph per cell, owned by the front paint ("Opacity and
    translucency"). A glyph (a faded one, a text run's space, an
    `opacity: 0` element's) and a background of any alpha hide the
    glyph beneath, a layer's cells included. CSS shows the lower glyph
    through the upper's gaps, under a faded upper at 1 − α, and
    through a translucent background. The reason: a cell is one
    character on one background, and what covers it owns it.
12. A layer inside a faded group composites over the group's blended
    cells rather than over what lay beneath the group.
13. A color emoji a group fades where its cell blends fades over its
    cell's final background, not over what lay beneath its group: the
    group's own background shows through it. The cause: the emoji has
    no color to blend, and the cell one background.
14. A blend clips each color to sRGB per channel first, as every
    engine blends on an sRGB screen (`bg-yellow-400/50` over white:
    blue 128 against the browser's 127 in all three; probed
    2026-09-23), and a color no blend touches is written unclipped,
    `color(srgb …)` past sRGB. On a wide-gamut screen a browser blends
    in the screen's space, so there a translucent color outside sRGB
    blends duller than the browser's own.
15. A translucent host background paints three times under the grid —
    on the host, then on the shadow's viewport and grid, which inherit
    it so that the grid's overflow past the host carries it — so a
    cell no background has reached, and the translucent paint over it,
    show it denser than CSS, which paints it once. The cause: the
    shadow repaints the background it inherits.
16. An inline element a block splits is no entry above the split
    elements inside it: in `<em>x<span>a<p>b</p>c</span></em>`, `a` and
    `c` fold `span`'s entry alone, `em`'s background is not painted
    beneath them, and `em`'s opacity multiplies into `span`'s rather
    than nesting as a group — exact while `em` has no background.
17. A textarea's row count wraps its value as `pre-wrap` at the table
    widths alone, ignoring its `letter-spacing` and another
    `white-space` (`nowrap`, `pre`, `wrap="off"`), which its native
    text follows.
18. Every box lays out left to right: `direction` is not read, and a
    logical side (`ms-auto`, `inset-s-*`, `float-start`) takes the side
    it has in a left-to-right box.
19. Overflow alignment is always `safe`: what overflows its alignment
    container — a flex line, an item larger than its line or grid
    area, a flex container's bare text wider or taller than its box,
    tracks wider than the grid, an out-of-flow box's static position —
    aligns to the start edge whatever the keyword, where CSS
    centers or ends it past the start edge unless the value says
    `safe` (a `*-safe` class reads its keyword and changes nothing).
    The cause: scroll ranges start at 0 and the grid has no cells left
    of or above the host, so content past the start edge would be
    unreachable — a reversed scroll container, a chat pane's
    `flex-col-reverse overflow-y-auto`, would lose its overflow.
20. `text-transform: full-width` and `full-size-kana` show the authored
    characters, where Firefox and WebKit draw the full-width and
    full-size forms (Chromium draws neither, and Tailwind has no
    utility for them).
21. A host's `min-h-*` floor above its content is definite to the root
    ("Host sizing"): a child's `h-full` fills it, where CSS leaves a
    floor indefinite. The cause: the engine reads the height CSS gives
    the host, not which rule gave it.
22. Tab stops under `tracking-*` count the grid's columns, where the
    browser's letter-spaced tabs may stop elsewhere.
23. An atomic inline box's margin box narrower than a cell advances
    one ("Atomic inline boxes"): after a `w-0` box, or one whose
    negative margin reaches its width, the text that follows sits a
    cell further on than CSS puts it. The cause: a character of no
    advance reads as a cluster's continuation.
24. `overflow: hidden` clips and never scrolls: `scrollTop`,
    `scrollIntoView` and focus leave a hidden box's content where it
    is, where CSS scrolls it programmatically ("Overflow"). The cause:
    the engine scrolls only `auto` and `scroll`.
25. `leading-*` on an inline element is ignored ("Line height on the
    grid").
26. An inline element's percent padding reads as 0 ("Inline content").
27. A block-level element nested inside a run is skipped with a
    warning ("Atomic inline boxes").
28. An inline element that neither names a hover variant nor sits
    under one that does, and is no `group` or `peer`, is never hovered
    for a variant reaching it from elsewhere: a sibling's
    `[&:has(+_span:hover)]:`, or a custom variant named without
    `hover` ("Pointer states"). The cause: each hover chain change lays
    the page out, and a plain span would join and leave it at every
    edge the pointer crosses.
29. Text fills its cells in the order it is stored: the engine runs no
    Unicode bidirectional algorithm, so a right-to-left run (Hebrew,
    Arabic) starts at its first character's cell, where CSS draws it
    reversed. The browser then reorders each drawn row on its own: a
    lone right-to-left word reads right while its cells, and so hits
    and selections, keep the stored order, and runs of two boxes
    joined by a neutral character, a border's `│` or a space, reorder
    as one, trading the boxes' text (`│אב│גד│` draws `│דג│בא│`,
    Chromium).

## Touch points on implementation

For "Opacity and translucency":

- plain-text.ts: `CellPaint.opacity`, a span's group opacity, which
  `applyCellPaint` writes, and `emojiOpacity`, a blended emoji's; the
  palette (`createPalette`: each color read once, a `readColor` for
  the forms the parser leaves alone, one it cannot read opaque, each
  blend memoized, a written color read back exact, a zero-alpha color
  no paint, `selected` for the swap over the ground, a blended emoji's
  color at its opacity, and `composite`, a translucent or faded paint
  over a cell's background: kept at its opacity over none, blended
  over an opaque one, a glyph faded with its own background over a
  translucent one as one opaque color at the alpha the two reach, a
  color emoji's color kept); the store's `merge` (the cell's
  background at its opacity beneath, none at zero, the fast path
  keeping an opaque paint's strings, any other through `composite`,
  `put` telling it a color emoji) and `release` (a blanked emoji
  cell's color blended); `WIPE` for `bg-clear`; `openGroup` on the `recorder`
  it shares with `openLayer`, its close putting each cell at the
  group's opacity; `inlinePaint`, an inline element's chain folded
  through `composite`, a color emoji's apart; `PaintedLayer.alpha`;
  `rowSegments` telling the boxing predicate a glyph drawn
  translucent.
- paint.ts: `placeLayer` writes a layer box's `opacity`; the boxing
  predicate takes a line glyph drawn translucent, and boxes a
  translucent band cell by cell; `rowNodes` puts a blended emoji's
  text on a span of its own, which `applySegment` fades with its
  underline and `rowStructureMatches` rebuilds as the fade comes or
  goes; `paintRows` patches a span whose opacity alone changed with
  that one property.
- element.ts: `#writeTokens` composites a translucent host background
  down to an opaque one — the backgrounds `#readSurroundings` reads in
  its one walk of the boxes behind the host — and `#readGround` reads
  the ground and ink back through the shadow's color probe
  (`#colorProbe`), which also resolves `#readColor`'s colors, a
  contextual one (`CONTEXTUAL_COLOR`: a `var()`, `currentcolor`, a
  system color, a vendor-prefixed one, `light-dark()`) read again each
  layout; an opacity transition samples as its animation
  (`transitionSampling`), its frames the repaint path's.
- shadow.css: the viewport and grid inheriting the host's background
  (deviation 15).
- tree.ts: an inline entry's own opacity and its `parent` entry; a
  split element's entry (`collectRunNodes`), its split ancestors'
  opacity multiplied in (`splitOpacity`, deviation 16).
- color.ts: `parseColor`, `lab()`, `lch()` and every `color()` space
  read through css-color-4's conversions (prophoto-rgb's D50 white
  adapted to D65); `colorAlpha`, 1 for a form it cannot read;
  `compositeColors`, clipping to sRGB as it blends, a zero-alpha color
  giving the color beneath as it is, and `serializeColor`, unclipped.
- width.ts: `isColorEmoji`.

For "Typography":

- tree.ts: each box's and entry's decoration, its ancestors' lines
  added (`propagateDecorations`, `withPropagated`).
- types.ts: `TextDecoration`, one object per value, an empty or `none`
  line none (`decorationOf`).
- style.ts: `readDecoration`.
- plain-text.ts: `applyDecoration`, onto a cell's span.

For "Engine variables":

- styles.css: the resets, plain, in the rule every light element
  matches (`mono-wind :not([data-mw-measuring])`, the lock layer);
  cascade.test.ts sorts render.ts's variables into their classes, and
  checks a pseudo-element's reads against its kind's writes.
- render.ts: every write, `setVar` removing a variable (null) where
  the reset stands for it, against its last write there
  (`forgetWrites` forgetting what a page's mutation may have changed,
  element.ts calling it from its observer and as a layout starts);
  `render` clears an earlier layout's box
  writes (`BOX_NAMES`) and inline insets from the elements this one
  wrote none on (`clearUnwritten`), and a pseudo-element's
  (`PSEUDO_NAMES`), and `positionElement` an inline element's padding
  cells from a box.

For "Aspect ratio":

- style.ts: `readAspectRatio`, columns per row through the measured
  cell, none on a table-internal box; `readLimit` reads a ratio box's
  `auto` minimum where a block's resolves to `0px` (`autoMinimum`).
- layout.ts: `ratioSize`, every derived size rounded once;
  `layoutNode` derives an unset height from the width, definite,
  floored at the content; `ratioWidth` an unset width from a given
  height, or the height's limits through the ratio; `ratioWidthFloor`;
  `widthContribution` the width a set height derives.
- flex.ts: `flexBaseOuterWidth` and `flexItemMinWidth` over a row
  item's `definiteHeight`; the column pass's base from the width and
  its re-layout deriving or keeping the width.
- grid.ts: `alignsNormal` (`CellStyle.alignItemsNormal`), and the
  block-axis pass deriving the width from an explicit stretch.
- positioning.ts: `placeByInsets` deriving the axis its insets and
  sizes leave open.

For "Host sizing":

- shadow.css: the slot out of the host's flow but under
  `:host([measuring])`, and the viewport, whose `min-height` and
  `min-width` are the spacer, the width lifted under
  `:host([measuring])`.
- element.ts: the height read before `measuring` (`sizedHeight`), the
  rows it gives the root where it is not the spacer's (`sizedRows`),
  the spacer written from the root's natural content rows
  (`#spacerHeight`) and the columns laid out (the viewport's
  `min-width`), and `#laidOutSize`, the height the resize
  observer compares.
- layout.ts: `layoutRoot`'s `rows`, the root's forced height.
