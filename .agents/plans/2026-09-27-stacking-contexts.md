# Stacking contexts

Status: **done 2026-09-27**, steps 1–9 with the decisions below (the
in-flow phases, the containing-block chain and inline members in this
batch), then a review pass; "Done" at the end records what landed
where it differs from the design, the review, and the tests. This is
Order item 4 of `2026-09-23-css-deviation-reasons.md`, decided
2026-09-24 to come next, ahead of incremental reads, with overflow
alignment after it. The spec is `../specs/positioning.md` "Paint
order", rewritten spec-first on 2026-09-27; its "Touch points on
implementation" map the code as it landed.

## Today (verified in the code and in a scratch copy)

- borders.ts `paintOrderedChildren(node)` sorts one box's children
  into buckets: negative `z-index`, blocks, floats, atomic inline
  boxes, then positioned boxes (ascending z, stable). plain-text.ts
  `walk`, pointer.ts `descend` and `indexTree`, and lattice.ts
  `coverage` each recurse on it. render.ts iterates it only to write
  `--mw-z`.
- Clips follow the parent chain: `walk`'s `parentClip` and
  `parentPut`, and the `past` test in `descend`. A fixed box escapes
  through `hostRect` (`hoisted`). paint-origin.ts subtracts every
  parent's scroll. positioning.ts `reachingFrames` cuts an anchor's
  scrollers and clips at the nearest fixed ancestor.
- `descend` enters a child only where the child's hit rect covers the
  cell.
- A sticky inline element's glyphs paint after its leaf's other
  glyphs (`shifted`), a special case of the spec's inline rule.
- Run in a scratch copy, the engine gets each of these wrong:
  - an `absolute z-10` menu paints under the next `relative` card,
    and the hit goes to that card;
  - a `-z-1` child paints over its static parent's fill;
  - a menu below its `relative` wrapper is painted, but its hit stack
    is empty;
  - an `absolute` box is clipped by a static `overflow-hidden` box
    between it and its containing block, and scrolls with a static
    scroller there;
  - a `fixed` box paints under a later static block;
  - a `relative` span shifted onto the next paragraph is covered by
    that paragraph's text;
  - a static `opacity` box paints under an earlier `relative` box
    that overlaps it.

## Probes (2026-09-27)

Native CSS in Chromium, Firefox and WebKit, through Playwright:
`elementsFromPoint` and the pixel at the point. The three engines agree
unless a row says otherwise. The scripts ran in scratch and were not
kept.

| Case                                                                            | CSS                         | Engine today       |
| ------------------------------------------------------------------------------- | --------------------------- | ------------------ |
| `absolute z-10` menu in a `relative` card vs a later `relative` card            | menu                        | card               |
| the same menu at `z-auto`                                                       | card (tree order)           | card               |
| the same menu at `z-auto`, the later card static                                | menu                        | menu               |
| `z-auto` absolute in a `relative` parent vs one in a later static parent        | the later one               | the earlier one    |
| `-z-1` in `relative z-0`, vs: an in-flow block's fill, the box's fill, its text | under, over, under          | under, over, over  |
| `-z-1` in a static or `relative z-auto` parent with a fill                      | under the fill              | over it            |
| `-z-1` in a faded parent                                                        | over the fill               | over it            |
| a `z-10` child of static X vs a later `relative z-1` box, X with a trigger (1)  | the box (X forms a context) | the child          |
| the same, X with a non-trigger (2)                                              | the child                   | the child          |
| static X with a trigger vs a later overlapping static block                     | X (positioned step)         | the block          |
| a static `opacity` box vs an earlier overlapping `relative` box                 | the `opacity` box           | the `relative` box |
| stuck `sticky top-0` `<th>` (z-auto) over the scrolled `<tbody>`                | the header                  | the body           |
| sticky `<thead>` and corner vs the body's sticky column, scrolled both ways     | the column's cell (3)       | the corner         |
| `fixed` (z-auto) in a static parent vs a later static block                     | the fixed box               | the block          |
| `absolute` in a static `overflow-hidden` box, containing block above            | not clipped                 | clipped            |
| `absolute` in a scrolled static `overflow-auto` box, containing block above     | not clipped, not moved      | clipped, moved     |
| the first under a transformed containing block, or two escapes deep             | not clipped                 | clipped            |
| `absolute z-10` in a static `opacity-50` box, containing block above            | faded (the group holds it)  | faded              |
| popover vs a `fixed` box at the maximum `z-index`                               | popover                     | popover            |
| overflowing text (by height, negative margin, across parents) vs a later fill   | the text (4)                | the fill           |
| a `relative` span shifted onto a later block's text; a faded span over it       | the span                    | the later text     |
| `relative z-10` span vs a later `relative` block; the span at `z-auto`          | span; block                 | block; block       |
| collapsed borders vs a `relative` row's fill, z-auto or z-1                     | the lines (5)               | the lines          |
| 1000 elements' `opacity` read alone vs with seven more properties               | C 0.3 vs 0.9 ms (6)         | —                  |

1. `opacity`, `transform: scale(1)`, `translate: 0`, `scale: 1`,
   `filter` or `backdrop-filter` at `blur(0)`, `isolate`,
   `mix-blend-mode`, `contain` `paint`/`layout`/`content`,
   `will-change` `transform`/`opacity`, `clip-path`, `mask-image`,
   `perspective`, `transform-style: preserve-3d`, `sticky`, `fixed`,
   `relative z-0`, and a flex item's `z-index`.
2. None, `z-5` on a static block, `will-change: top`, `container-type`
   `inline-size` or `size`, and `relative z-auto`.
3. With `z-10` on the `<thead>`, the corner.
4. The hit varies by engine; the pixel doesn't.
5. Chromium and WebKit; Firefox paints the row's fill over them.
6. Firefox and WebKit at most 1 ms, their timers coarse.

## Design

### One order: stacking.ts

A new module takes over borders.ts's `paintOrderedChildren` and
`paintsInPositionedStep`:

- `zIndexApplies(node, parent)`: the node is positioned, or it is a
  flex or grid item. This is today's `paintsInPositionedStep`, and
  render.ts keeps using it for `--mw-z`.
- `formsContext(node, parent)`: the spec's list. It reads
  `CellStyle.stacking` (step 1), plus position, `z-index`, the
  painted opacity (times `inlineOpacity`) and top-layer membership.
- `inPositionedStep(node, parent)`: the node is positioned or forms a
  context.
- `inFlowChildren(node)`: today's buckets without the positioned and
  negative ones. It returns `node.children` itself where no child is
  deferred and one bucket holds them all.
- `membersOf(context)`: one pre-order walk of the context's subtree.
  It goes through in-flow boxes and through positioned boxes that form
  no context, stops at each context, and skips top-layer elements and
  table-hidden or `forceHidden` subtrees. It returns the members
  stably sorted by z and split at 0, as `{ negative, rest }`, or null
  where there are none.
- `paintSteps(node, turn, content, after, root = false)`: the one
  traversal, and the only one that knows the steps. Where `node` forms
  a context, or `root` says to treat it as one, it runs the negative
  members' `turn(member, true)`, then `content()`, then each in-flow
  child's `turn(child, false)`, then `after()`, then the other
  members' turns. Each `turn` is the caller's own recursion, so every
  consumer shares one order and keeps its own per-box state. A
  traversal rooted at any box gives that box's descendants the order
  they have in the whole tree, since the members of an outer context
  that lie inside the box keep their z and tree order among
  themselves.
- `paintIndex(root)`: the flat order from `paintSteps`, over the tree
  and then the top-layer stack. Each box's entry holds its `order`,
  the `end` of its turn, its layout `parent` and the layer root it
  paints in. It is built once per layout, on the first hit, and
  replaces pointer.ts `indexTree`. A context's turn is contiguous, so
  a layer root's `[order, end)` is its subtree, as `cellAtPoint`'s
  cover test needs.

The common path allocates nothing new. With no member, `membersOf`
returns null and `inFlowChildren` returns `node.children`. Members are
computed on each paint rather than cached, because a fade started
without a layout changes the painted opacity and so which boxes form
contexts.

### What a member carries

paint-origin.ts `placePainted` already writes each box's `paintOrigin`
top-down on every layout and scroll repaint. It will also write
`paintClip`: the clips of the box's containing-block chain. A child
shares its parent's clip object wherever nothing between them clips,
so an object is made only at a clipping box. A layer root's
`paintClip` is its box's clip, and the clips inside restart in the
layer's space. A top-layer element's is null.

The walk keeps threading `contentPut` and `contentClip` to in-flow
children, as today. A member instead paints through
`clipPut(walking.put, member.paintClip)`, where `walking` is its
context's scope. Every group and layer forms a context, so that scope
is always inside every group and layer above the member.
`hoisted` then goes away: a fixed box is a member whose chain starts
at the host, or at its layer's root.

### The consumers

- **Paint** (plain-text.ts `walk`): the box's own ink, then
  `paintSteps`. The leaf's text runs as `content`, and the lattice and
  scrollbars run as `after`. The scope closes after the last member.
  The transcript takes the same path.
- **Hit** (pointer.ts): a reverse scan of `paintIndex`. The winner is
  the first box that paints on the main grid, covers the cell (the
  multicol line test included), lies inside its `paintClip` and takes
  pointer events. The stack is that box with its parents. `layerStack`
  scans its root's span, skipping nested layers' spans. The top layer
  comes last in the index, so the scan tries it first.
- **Lattice** (lattice.ts): ranks come from
  `paintSteps(table, …, root = true)`. `placementOf`'s owner becomes
  the innermost part among cell, row and group that is shifted or in
  the positioned step. So a `relative` row paints its own lines after
  its fill (the spec, Chromium and WebKit), and a stuck part covers
  an earlier one by rank, as today.
- **render.ts** iterates `node.children` and writes `--mw-z` where
  `zIndexApplies`.

### The containing-block chain (step 6)

`placePainted` carries two frames down: the parent's, and the one at
the nearest ancestor that is positioned, is a layer root or is the
root. An absolute box takes its origin, clip and scrollport from the
second frame, and a fixed box from the root or its layer. So the
scroll offsets and clips of the static boxes between an absolute box
and its containing block drop out. The absolute boxes that escape a
scroller join the returned `ShiftedBox` list, so `renderScroll`
rewrites their takeback through the existing generic `writeShift`.
`stick` gets its scrollport from the same frame. positioning.ts
`reachingFrames` becomes `containingChain(ancestors)`, the frames on
the chain, for the anchors' scrollers, clips and `position-visibility`.

### Inline members (step 7)

tree.ts records on each `InlineElement` whether it is positioned, its
`z-index`, and whether it forms a context (the same read as step 1's,
plus `opacity < 1`). It also records per leaf the outermost such
elements (`node.inlineMembers`). `membersOf` takes them as members
`{ leaf, index }`. The leaf's `content` skips their glyphs, and a
member's turn paints them in a second `forEachLeafCell` pass. This
replaces `shifted`. In `paintIndex` an inline member's entry hits
where `charIndexAtCell` finds one of its characters, and its stack is
the leaf's.

## Steps

Each step lands green: `pnpm check`, `pnpm test`, and the story suite
in all three engines, with goldens run where paint moves. Its tests are
seen red first. Steps 3–5 ship in one release, so paint and hit are
never out of step.

0. **Probe.** Done; see above.
1. **The read.** style.ts `readStacking(el, cs, …)` produces
   `CellStyle.stacking`. It covers the eight new properties (a
   `will-change` naming any property that forms a context), the layer
   effects' raw values with identities counted, and
   `animatedProperties(el).has("opacity")`. types.ts defaults it to
   false. style.test.ts: each trigger, a `container-type`, an
   identity, a running opacity transition.
2. **The order.** stacking.ts as above, with borders.ts's two
   functions moved into it; nothing consumes it yet.
   stacking.test.ts:
   - the members and turn order of each probe fixture;
   - on a tree without members, `inFlowChildren(node) === node.children`
     and `membersOf(root) === null`;
   - the order fuzz (Tests).
3. **Paint.** `walk` runs on `paintSteps`, `placePainted` writes
   `paintClip` (still along the parent chain), `hoisted` goes, and
   render.ts moves to `zIndexApplies`. The StickyTable story gets
   `z-10` on its `<thead>`, as CSS requires (probed). sticky.test.ts
   "joins a stuck header's bottom line…" gets `z-index: 1` on its
   thead for the same reason. Tests: plain-text.test.ts gets the
   probe's paint cases; `StickyHeaderCells` now asserts that the
   stuck header row shows its own text in both tables. The paint
   differential runs (Tests).
4. **Hit.** pointer.ts on `paintIndex`; `indexTree` and `descend`
   go. Tests: pointer.test.ts gets the menu below its wrapper, the
   cross-parent cases, a `pointer-events-none` member, a member
   clipped by its chain, and a top-layer hit. The hit and paint
   consistency fuzz, plus the `Stacking` showcase story and
   `StackingAgainstNative` (Tests).
5. **Lattice.** Ranks and owners as above. Tests: a relative row's
   fill under its lines; a z-auto sticky thead covered by the body's
   sticky column, lines included, and the same with a z-index.
6. **The containing-block chain.** As above. Tests:
   - paint and hit for each of the probe's clip rows;
   - an absolute box's `paintOrigin` and `--mw-sy` held through a
     scroll of a static scroller;
   - a sticky box inside an escaping absolute box, sticking to its own
     chain's scroller;
   - an anchored box whose scrollers leave the escaped scroller out;
   - a fixed box inside an `overflow-hidden` layer root, clipped by
     it.

   Stories: `ContainingBlockClip`, a menu escaping an `overflow-hidden`
   card and a scrolled list, grid and light element on the same cells.
   `StackingAgainstNative` gains the clipping and scrolling boxes. The
   anchor stories run.

7. **Inline members.** As above. Tests:
   - a `relative` span over the next paragraph's text;
   - a `relative z-10` span over a later `relative` block;
   - a faded span;
   - a nested pair;
   - the sticky span tests unchanged, and a hit on a member's glyph.
8. **The bench.** Add the `positioned` shape and record the numbers
   (Performance).
9. **Docs.** positioning.md's status and its touch points, written from
   the code. layers.md "Layers stack in paint order and nest" points
   to "Paint order" in place of "siblings through the same paint-order
   walk". float.md's `paintOrderedChildren` sentence and touch point
   change. sticky.md's touch points drop `shifted` and name the owner
   rule. table.md "Rendering" names the positioned parts' lines. The
   README's "Scrolling and position" names stacking contexts. The
   deviation-reasons plan marks Order item 4 done. The
   StickyHeaderCells comment changes.

## Tests

- **Order fuzz** (step 2, committed, Node). Build 500 seeded random
  trees of 3–30 boxes, mixing:
  - positions: static, relative, absolute, fixed and sticky;
  - `z-index`: auto, and −2 to 3;
  - opacity 1 or 0.5, and `stacking`;
  - flex parents, `forceHidden` and top-layer nodes.

  `paintIndex`'s order must equal a sort by a pairwise comparator
  written from Appendix E, independent of `paintSteps`. For two boxes
  it finds their lowest common context and what each lies in there (a
  member, or an in-flow box), then compares their steps, then their z,
  then their tree order.

- **Paint differential** (step 3, and again in step 6). A harness,
  not committed, runs against a scratch worktree of the commit before
  step 3; the tracked tree is never swapped. It renders random trees
  with both engines. Trees without members must paint identical
  grids. Everywhere else, each cell that differs must lie in the ink
  of a member and of a box that the two orders put on opposite sides
  of it. The runs are logged here.
- **Hit and paint agree** (step 4, committed, Node). Over the random
  trees, with every box a distinct opaque fill and no text, the hit's
  innermost box at each cell is the box whose fill the cell shows.
- **`StackingAgainstNative`** (step 4, a test-only story, all three
  engines). It builds 30 seeded layouts of 6–12 boxes, each with a
  distinct opaque background and no text or floats, using the fuzz's
  positions, z-indexes, `opacity-90`, `isolate`, flex parents and
  negative margins. Each layout renders twice: in the host, and as a
  native copy sized at the measured cell inside a `contain: layout`
  box, which gives fixed boxes the host's containing block and the
  host's context. At every cell centre, the grid's background must
  equal the background of native `elementsFromPoint`'s first element.
  Where two boxes share a cell, the synthesized hover's innermost
  element must equal it too. On today's engine it fails.
- **`Stacking`** (step 4, showcase, golden):
  - a card's `absolute z-10` menu over the next card, with a hover
    over it reaching the menu;
  - a `-z-1` shadow under its card's fill;
  - an `opacity-90` card whose `z-10` badge stays under the next
    `relative z-1` card;
  - an `isolate` box doing the same;
  - a stuck header cell over a table body.
- The unit tests each step lists above.

## Goldens

No existing golden is expected to move. StickyTable keeps its picture
because step 3 adds `z-10` to its `<thead>`; without it the corner
would show the body's first-column cell scrolled beneath it, as
browsers do. The
stories with overlapping positioned boxes were checked:

- Absolute, Margin, AbsoluteChildren and the overflow arrows;
- the badges in typography, interactive, ClickThrough and PassThrough;
- blend's overlays, and the effects stories' layers and `frosted` box;
- Anchored and AnchorFunctions;
- the top-layer Fixed story.

In each of them the overlapping boxes are siblings, or overlap only
their own parent's ink, so both orders agree.

Any other move is a finding. A move is right only where a member
overlaps a later sibling's or cousin's ink, and it is checked against
the browsers before its golden is updated. New goldens: `Stacking`
and `ContainingBlockClip`.

## Performance

- **The new `positioned` bench shape**:
  `<div class="h-[80vh] overflow-auto">` holding a `flex flex-wrap`
  of N `relative border px-1` cards. Each card has an
  `absolute -bottom-1 left-1 z-10 bg-clear` badge over the card
  below. Every fifth card is `opacity-90`, and every twentieth is
  preceded by a `sticky top-0 z-20 basis-full bg-clear` heading.
- **What gets measured**:
  - load (interactive, style, layout, spans) for `boxes`, `prose`,
    `faded` and `positioned`;
  - the relayout and hover-step CPU for `boxes` and `positioned`, as
    performance.md "Where it stands" takes them;
  - a scroll repaint of `positioned`.

  Builds alternate against the commit before step 3 (built from
  `git archive`).

- **Targets**. `boxes`, `prose` and `faded` stay within the noise:
  about 5 ms at interactive, and 2% of CPU. `positioned` is recorded.
- **New costs**:
  - `membersOf`'s walk: one more light visit per box per paint,
    allocation-free without members;
  - the index, built per layout on the first hit, where it was built
    only for a hit through a layer;
  - the hit, a scan of the index where `descend` pruned by rect.

  If the hover step moves, the lever is to skip a context's span by
  its ink bounds.

## Touch points (will)

- style.ts will read `CellStyle.stacking` (`readStacking`).
- types.ts will hold `stacking` on `CellStyle`, `paintClip` and
  `inlineMembers` on `LayoutNode`, and `positioned`, `zIndex` and
  `stacking` on `InlineElement`.
- stacking.ts will hold `zIndexApplies`, `formsContext`,
  `inPositionedStep`, `inFlowChildren`, `membersOf`, `paintSteps` and
  `paintIndex`.
- borders.ts will lose `paintOrderedChildren` and
  `paintsInPositionedStep`.
- paint-origin.ts: `placePainted` will write `paintClip`, apply scroll
  and scrollport along the chain, and return the absolute boxes that
  escape a scroller.
- plain-text.ts: `walk` will run on `paintSteps`, with a member's put
  from its `paintClip`; `hoisted` and `shifted` will go; inline members
  will paint in their own turns.
- pointer.ts: the hit will scan `paintIndex`, and `cellAtPoint`'s cover
  test will use its spans.
- lattice.ts will take its ranks from `paintSteps`, and `placementOf`
  will pick positioned owners.
- render.ts will write `--mw-z` from `zIndexApplies`.
- positioning.ts will use `containingChain` for the anchors.
- sticky.ts: `stick` will take its scrollport from the chain.
- tree.ts will record an inline element's position, `z-index` and
  context.
- scripts/bench.mjs will gain the `positioned` shape.

## Size

- **Core source, about +230 lines net** (+180 to +300):
  - stacking.ts +150, about 40 of them moved from borders.ts
    (borders.ts −55);
  - paint-origin.ts +35;
  - plain-text.ts +30 (+40 for inline members, −20 for `hoisted` and
    `shifted`);
  - style.ts +25;
  - tree.ts +20;
  - types.ts +12;
  - lattice.ts +10;
  - pointer.ts −10;
  - positioning.ts +5;
  - sticky.ts +5.
- **Tests, about +700 lines**:
  - stacking.test.ts, with the fuzz, +250;
  - the other unit files +200;
  - stories +250 (`StackingAgainstNative` 120, `Stacking` 80,
    `ContainingBlockClip` 40, StickyHeaderCells +10);
  - the harness, about 120, stays in scratch.
- **By step**: steps 1–5 are most of it. Steps 6 and 7 are medium each
  and separable.

## Risks

- **Code that depends on the sibling-only rule.**
  - StickyTable and sticky.test.ts "joins a stuck header's bottom
    line…" rely on a z-auto `<thead>` covering the body's sticky column,
    which CSS doesn't do; step 3 gives each a z-index.
  - plain-text.test.ts "negative z-index paints under static siblings"
    and "honors z-index…" still hold.
  - pointer.test.ts's hand-built trees need `paintClip`, which defaults
    to null.
  - float.md and layers.md name the old function and walk; step 9
    updates them.
- **Paint and hit on different orders** between steps 3 and 4: they
  ship together.
- **Overflow alignment** (`2026-09-25-overflow-alignment.md`) comes
  next, and its reversed scroll origin rewrites the same scroll
  subtraction in paint-origin.ts that step 6 moves onto the chain. It
  rebases on this plan. Its negative offsets are indifferent to the
  order.
- **Order item 4's first step** ("lift z-indexed descendants through
  z-index: auto ancestors") is subsumed. Every member, z-indexed or
  not, is lifted through every ancestor that forms no context.
- **Frames.** Members follow the painted opacity on every paint. The
  index is per layout, so a hit during the first frames of a fade that
  started without a layout may use the pre-fade order.
- **Layers** open in the new order. A static layer root now opens after
  its in-flow siblings, so its box's DOM position moves once, and
  `syncLayers` may rebuild it.
- **Native divergence** (the light DOM stacking as absolute boxes) is
  unchanged in kind, but step 6 adds cases to it: a native control
  past a clip it escapes on the grid.
- **Incremental reads** take in the new style fields (`stacking`, the
  inline ones) in their build-field comparison and splice.

## Decisions (2026-09-27)

1. **In-flow phases, in this batch.** Each stacking context paints
   CSS's phases (Appendix E): every in-flow box's shadows, fill and
   borders first, then the floats, then the in-flow text and atomic
   inline boxes. The spec-first deviation for an in-flow box painting
   whole goes. The hit index takes the same phases: a box's entry where its
   fill paints, a leaf's text entry where its glyphs paint. Tests, red
   first: a block's overflowing text over a later block's fill (the
   probe case), in a unit test and in a story compared against the
   browser.
2. **Steps 6 and 7 in this batch**: the containing-block chain for
   clip, scroll, sticky and the anchors (a `ContainingBlockClip`
   story), and inline members, retiring the sticky spans' special
   path.
3. **No performance regressions.** Before (a copy of the tree taken
   before the first edit) against after, alternated with a
   noise-control copy of before: `bench.mjs` on `boxes`, `blocks`,
   `prose`, `faded` and the new `positioned` shape, the relayout and
   hover-step CPU, and the Node paint time. Every existing shape stays
   within the noise; a measure that moves is traced and fixed before
   going on.
4. **The library's size is tracked**: before the first edit and after
   each step, `gzip -9c` bytes of core's `dist/cdn.js` and of the npm
   build's `dist/index.js` minified by esbuild, and core src physical
   and code lines. The table goes in the Done notes and in
   `../architecture/performance.md`.

## Done (2026-09-27)

Steps 1–9 landed, each green, with decisions 1–4. Where the code
differs from the design above:

- **One traversal, a visitor.** The phases split a box's turn, so
  `paintSteps(node, turn, content, after)` became `paintOrder` and
  `paintTurn` over a `PaintVisitor` (`enter`, `leave`, `box`,
  `lattice`, `text` by glyph turn, `bars`), which the paint,
  `paintIndex` and the lattice's ranks each supply. `inFlowChildren` went: the
  phases walk the children themselves (`boxesOf`, `floatsOf`,
  `contentOf`), allocating nothing where there are no members.
- **Flex and grid items paint as inline blocks** (css-flexbox §5.4,
  css-grid §9): whole, among the inline content, in order-modified
  document order. `StackingAgainstNative` found it, a flex item's
  overflowing child over a later block's fill.
- **The index keeps a leaf's glyphs apart from its box**: a box takes
  a cell in the phase its fill paints in, a leaf's glyphs where they
  paint, an inline member's where its own do.
- **The grid's ink extent follows the chain** (`contentExtent`): an
  absolute box past a static clipping box grows the grid, and no
  scroll range (scrolling.md, Deviations, as before). It looks inside
  a box clipping both axes only where an absolute box crossed it
  (`crossed`): looking inside every one cost a scroller of 150
  `overflow-hidden` cards 32% of its layout.
- **Inline elements form contexts by what their entry reads**: sticky,
  a `z-index`, an opacity below 1 or running. The step-1 read of the
  seven effect properties cost 1.3 ms of a prose relayout's script
  (2.8%); the grid draws none of those effects on an inline element,
  so they are positioning.md deviation 6. `InlineElement.context`
  names the flag, `CellStyle.stacking` being the other properties
  alone.
- **A fixed box keeps its origin at the host's**, its clip its
  layer's; `positioning.ts` keeps a fixed box's chain empty.

The per-step work, tests seen red first (on the tree before the step,
or the pre-edit copy where the step's code was new):

1. **The read** (style.ts `readStacking`, `readLayer` counting an
   identity; types.ts): style.test.ts's triggers and non-triggers,
   animation.test.ts's running opacity — red on `stacking` undefined.
2. **The order** (stacking.ts): stacking.test.ts, the probe's cases as
   fixtures and the order fuzz (500 trees committed; 20,000 run once).
   The fuzz was red once: an atomic inline box flagged a float was in
   no phase.
3. **Paint** (plain-text.ts's `painter`, paint-origin.ts's
   `paintClip`, render.ts's `zIndexApplies`): plain-text.test.ts, five
   stacking cases and three phases, red on the pre-edit copy;
   StickyTable's `<thead>` `z-10`, sticky.test.ts's thead
   `z-index: 1`; StickyHeaderCells asserts each table's header row,
   red on the pre-edit copy.
4. **Hit** (pointer.ts on `paintIndex`): pointer.test.ts's menu below
   its wrapper, cross-parent order, overflowing text, a
   `pointer-events-none` member, a member cut at its chain's clip, the
   top layer, and the hit-and-paint agreement fuzz (300 trees) — red
   on the step-3 tree. Stories: `Stacking` (golden),
   `StackingAgainstNative` (32 layouts, three engines; red on the
   pre-edit copy), `StackingTwins` with `visual/stacking.spec.ts`, the
   text phases' pixels against the browser's in three engines (red on
   the pre-edit copy).
5. **Lattice** (lattice.ts ranks from `paintTurn`, the positioned
   owner; borders.ts's two functions gone): sticky.test.ts's relative
   row's lines over its fill and the z-auto header's corner under the
   stuck column, red on the step-4 tree.
6. **The chain** (paint-origin.ts's frames, positioning.ts's
   `containingChain`, layout.ts's extent, stacking.ts's flex and grid
   items): plain-text.test.ts (a static clipper and scroller skipped,
   two escapes deep, a layer root ending the chain, a fixed box in a
   clipping layer; a flex item over a later fill), pointer.test.ts,
   render.test.ts's takeback through a scroll repaint, sticky.test.ts's
   heading in an escaping box, anchor.test.ts's escaped scroller and
   visibility — each red before the step. `ContainingBlockClip`
   (golden); `StackingAgainstNative` gained clipping and scrolling
   boxes. Two anchor fixtures took a `relative` scroller, to stay the
   box's containing block.
7. **Inline members** (tree.ts's entries and `inlineMembers`,
   stacking.ts's inline turns, plain-text.ts's `paintText` by turn and
   `charIndexAtCell` by turn; `shifted` gone): plain-text.test.ts's
   span over the next paragraph, z-ordered span, faded span, nested
   pair; pointer.test.ts's hit on a member's glyph — red before the
   step; the sticky span tests unchanged.
8. **The bench** (`positioned` in bench.mjs) and three fixes the
   measures traced (performance.md "Stacking contexts").
9. **Docs**: positioning.md's status, phases, hit, chain, inline
   members, deviations and touch points; layers.md, float.md,
   sticky.md, table.md, anchor-positioning.md, cell-model.md
   "Overflow", the README, the deviation-reasons plan's item 4.

**Paint differential** (scratch harness, the pre-edit core against
this one on random trees, each differing cell classified by the pair
of ink sources the two orders put on opposite sides of it, a clip the
chain moved, or a grid grown by an escaping box): 5,000 trees, 3,505
identical; 13,104 differing cells — 10,742 member order, 373 in-flow
phases, 659 containing-block clips, 1,330 in the 27 trees whose grid
grew — and none unexplained.

**Deviations** in positioning.md "Paint order": the committed spec
had one, unnumbered (no stacking contexts); the spec-first rewrite
5–8 (four); after, 5–8 (four). Gone: an in-flow box painting whole.
Kept, each with its cause: the light DOM stacking as absolute boxes,
an inline element's context holding its glyphs alone (now also the
order of an inline member before its leaf's out-of-flow boxes), only
`position` making a containing block. New: an inline element's own
effects forming no context (deviation 6), for the read's cost.

**Goldens**: the full visual run moved none of the existing goldens
(867 passed), StickyTable's included with its `<thead>`'s `z-10`, as
this plan expected. `Stacking` and `ContainingBlockClip` have new
ones, inspected: the `relative` card's `z-10` badge over the next
card's border and the `opacity-90` and `isolate` cards' under it, the
`-z-1` shadow under its card, the stuck header row over the body, the
overflowing text over the later fill; the menu whole past its
clipping card, the held box past the scrolled list's edge.
`visual/stacking.spec.ts` passes in all three engines.

**Review pass** (the same day, a fresh read of the batch against a copy
of the tree taken before it):

- Two bugs, each test red on that copy:
  - a table part with a negative `z-index` paints before its table,
    which resolved the lattice in its own box's paint: the part's lines
    were missing from the first paint and stale after a scroll. The
    lattices now resolve all at once at the first table or part
    painted (plain-text.ts `resolveLattices`; sticky.test.ts "hands a
    negative row its lines…");
  - `charIndexAtCell` without a turn ranked a leaf's first non-negative
    inline member level with the leaf's own glyphs, so a selection
    gesture on a shifted `relative` span's glyph took the character
    beneath it. It now searches the leaf's turns from the top
    (stacking.ts `glyphTurns`; plain-text.test.ts "finds a z-auto
    member's glyph…").
- Simplified, no other change in behavior: the visitor's methods
  optional (the lattice's and the ranks' no-op visitors gone), `after`
  named `bars`; one `phaseOf` for the three phase walks, the lattice
  call in `boxesOf`, a leaf's inline members in `collectMembers`; the
  index's spans for layer roots alone and its parents without the
  top-layer override; one scan for the hit (`lastTaking`); `inkClip`,
  `inlineOpacity` and `containsAbsolute` for rules two or three files
  each spelled out; the frames' scroller count replaced by the
  scrollport's identity, and no frame built for a leaf; `placementOf`'s
  own sticky test gone, a sticky part being in the positioned step; the
  clipped puts cached by the painter, one lookup a box.
- Checked against that copy: a scratch harness over 1,000 random DOM
  trees (spans, tables, scrollers, layers) and 3,000 node trees (top
  layers) compared every origin, clip, shifted box, paint (grid and
  layers), index entry, hit stack at every cell, through every layer,
  and `charIndexAtCell` at every cell by turn and without: identical
  but for the two fixes — 96 characters, each the one the paint order
  puts on top, and, over 300 more trees with negative rows, the first
  paint's lattice cells in 41 of them. The paint differential against
  the core before the batch gave the same 13,104 cells; the layout
  fuzz, 4,000 trees identical; the order fuzz at 20,000 trees and the
  agreement fuzz at 5,000 passed; the story suite in three engines,
  `pnpm check`, `pnpm test`, and the full visual run with no golden
  moved (869 passed).
- Size: cdn.js 159,164 bytes gzipped (−295 against the batch as it
  landed, +1,698 against before it), index.js 88,415 (−299, +1,625),
  core source 23,909 lines (−77, +447), 17,174 of them code (−78,
  +327).
- Performance, against the batch as it landed, alternated with a copy
  of one bundle ("spread", the two copies' gap in the same run): every
  measure within the noise.

  | measure (ms)                | batch | review | spread |
  | --------------------------- | ----- | ------ | ------ |
  | boxes 300 load, interactive | 174   | 173    | 4      |
  | blocks 40 load, interactive | 91    | 88     | 2      |
  | prose 300 load, interactive | 190   | 191    | 1      |
  | faded 300 load, interactive | 197   | 199    | 1      |
  | positioned 300 load         | 185   | 181    | 1      |
  | boxes relayout, CPU         | 27.6  | 28.0   | 0.6    |
  | prose relayout, CPU         | 61.6  | 62.0   | 1.3    |
  | positioned relayout, CPU    | 54.4  | 54.7   | 0.8    |
  | boxes hover step, CPU       | 48.5  | 49.0   | 0.3    |
  | prose hover step, CPU       | 65.0  | 65.1   | 0.4    |
  | positioned hover step, CPU  | 57.2  | 56.5   | 1.1    |
  | positioned scroll step, CPU | 21.4  | 21.4   | 0.1    |
  | Node paint, faded           | 3.69  | 3.71   | 0.05   |
  | Node paint, blocks          | 2.57  | 2.59   | 0.01   |
  | Node paint, faded bare      | 3.64  | 3.67   | 0.01   |

  In Node, over 100 alternated rounds: `placePainted` 30% faster on the
  positioned shape, the index's build 25–40%, a hit on boxes 20%,
  level on the positioned shape, its paint level with a copy of the
  batch. Two first cuts slowed the positioned paint and were redone:
  the clipped puts keyed by walk then clip (+8%) and a lattice walk
  before every paint (+2%).

**Second review** (the same day, whole files, four areas), each fix's
test red on a copy without it:

- The hit ran `charIndexAtCell` for every inline member's glyph entry
  the scan passed: 144 hits over 150 paragraphs, each with a faded
  span, took 385 ms against HEAD's 2.6. A turn is tried against the
  leaf's hit rect moved by its member's shift first: 14.5 ms.
- A leaf with inline members wrapped and walked its text once a turn;
  `paintText` walks it once, the painter holding the later turns'
  glyphs: its paint 5.6 → 3.8 ms (HEAD 3.1).
- An inline element's descendants stayed put under its shift (older
  than the batch, which the turns now rely on): the shift adds its
  inline ancestors' (`inlineShift`; plain-text.test.ts "moves an inline
  element's descendants with its shift", pointer.test.ts "hits a
  static element's glyph where its relative span moves it").
- A top-layer element's fixed descendants took the clip of a layer
  root it escapes, and the first paint after a layout clipped the
  element itself: `layoutRoot` placed the boxes before the stack was
  assigned. It assigns the stack first now (top-layer.test.ts "paints
  an element in a clipping layer root from its layout's first
  paint…").
- `contentExtent` under clipping boxes (above), and a grid's
  `justify-content: right` read as `start` (style.ts, not this plan's).
- Stories: `StackingTwins`' native float case sat beside the float, so
  its check passed on nothing (`flow-root` now); `Stacking`'s play held
  at some widths only; `StackingAgainstNative` took `data-test` hooks.

The hit then still scanned the index at 2–4× HEAD's cost a hit, and
the paint of a leaf with members ran 20% over HEAD's. A last pass
(performance.md "The hit and the paint, leaner") tests each entry
without allocating, its rect first; paints and hits by the lines the
layout wrapped; records a leaf's glyph owners at build; and walks an
entry's ancestors without reading `entries[-1]`. Every paint, place
and hit identical over 1,000 DOM and 3,000 node trees.

Size and performance of the batch: performance.md "Stacking contexts
(2026-09-27)".
