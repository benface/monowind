# Textareas: one layout, native scrolling, CSS sizing

Status: **planned 2026-09-24**. Lever 1 of
`2026-09-23-performance-levers.md` (performance.md "One load layout")
left one exception: a host holding a `<textarea>` lays out twice on
load. Steps 1-3 wrap the value inside the layout that sizes the box, so
one layout suffices. Steps 4-5 carry the user's decisions of
2026-09-24 ("Decisions"): a textarea scrolls natively and sizes as CSS
does.

Line numbers are the working tree's on 2026-09-24. element.ts and
types.ts are under edit, so re-grep them before editing. The work
lands after that element.ts work, and before milestone 3 of
`2026-09-24-incremental-reads.md`, whose relayout path would otherwise
carry the widths.

## Decisions (the user, 2026-09-24)

1. **Tracking counts.** A textarea's rows count its letter-spacing, as
   its native text does.
2. **A textarea scrolls natively**, the way an `<input>` already
   scrolls its text while the grid paints only the box:
   - `overflow: auto` replaces the companion's `overflow: clip`;
   - the native scrollbar is hidden (`scrollbar-width: none` and the
     WebKit pseudo-element);
   - there is no resize handle.
3. **It sizes as CSS does.**
   - It is `rows` tall, or its authored height, and scrolls past it.
   - It grows with its value only under `field-sizing: content`. So
     the engine counts wrapped lines only for those textareas.
4. **`wrap="off"`, `white-space: nowrap` and `white-space: pre` are
   respected.**
   - Rows count hard lines where rows follow the value
     (`field-sizing: content`).
   - The text scrolls horizontally.
   - This replaces the "always wraps" deviation decided earlier the
     same day, which is dropped.
5. **The scroll lands on whole rows.**
   - `scrollTop` snaps to a row multiple at `scrollend`, and a
     caret-driven scroll ends on rows too.
   - The `leading-*` phantom range, the reason for `clip`, is designed
     out.
6. **Horizontal scrolling stays native and unsnapped**, as an input's
   does.
7. **Under `field-sizing: content`, the width follows CSS.** This is
   the user's rule: follow CSS as far as is reasonable.
   - Max-content is the longest hard line, plus the caret's cell if
     step 0's probe confirms it.
   - The width stops at the max-width, and past that the value wraps.

## Today (verified in the code)

- **The build counts every textarea's rows.**
  - `buildLeaf` wraps the value with `wrapLineCount` at
    `context.textareaWidths.get(textarea)` (tree.ts:292-322).
  - It stores `max(rows floor, lines)` as `intrinsicHeight`, line gaps
    included. With no width it counts hard lines (tree.ts:312-314).
  - It ignores `white-space` and tracking (tree.ts:309-311).
- **The width is the DOM's, read before the layout.**
  - `#performLayout` reads each textarea's `clientWidth` less its
    padding, in cells, before the measuring flags go on
    (element.ts:2784-2804).
  - The tree is built under the flags, and under them the companion's
    width rule is off (tree.ts:30-34). So the width is the last
    layout's, or none.
  - On load the host has no `--mw-cw` yet (the first layout writes it,
    element.ts:2841), so the map is empty.
  - A textarea new since the last layout has no engine width yet.
  - A layout that changes a textarea's width wraps at the old one.
- **A second layout fixes the rows up.**
  - After the paint, `#rewrapsTextareas` (element.ts:1285-1302, called
    at 2933-2935) schedules another layout wherever the new width
    differs from the snapshot.
  - `#textareaCells` (element.ts:592-594) guards it against looping.
  - The host is revealed after the first layout, so for a frame the
    textarea shows its hard lines.
- **Layout already has the width.**
  - `layoutNode` resolves the border box's width (layout.ts:216-220)
    and takes the border and padding off into `inner.width`
    (layout.ts:235-240).
  - It passes that to `layoutTextLeaf` as `innerWidth`
    (layout.ts:263-267).
  - A textarea's leaf has no text (collectRun, tree.ts:677-680), so
    `layoutTextLeaf` returns `intrinsicHeight` (layout.ts:473-475).
    That is the only place it is read.
- **Textareas never scroll.**
  - The companion's `overflow: clip` stays on in the measuring pass
    too (styles.css:136-145), so the engine reads `clip` and writes
    `data-mw-clip` (render.ts:315), which forces `clip` again
    (styles.css:922-927).
  - The comment gives the reason for `clip`: under `leading-*`, the
    last line's half-leading is a phantom scroll range.
  - The box always fits the value (cell-model.md "Form controls").
- **The native wrap disagrees with the rows in two places.** Both were
  traced in the code, not probed in a browser:
  - **Tracking.** render.ts:291 writes a `tracking-*` textarea's
    `--mw-ls`, and the lock spaces its native text (styles.css:490),
    but the rows count untracked advances.
  - **No wrap.** `whitespace-nowrap` and `whitespace-pre` set
    `data-mw-nowrap` and `data-mw-pre` (render.ts:294, 310), which
    stop the native wrap (styles.css:565-567, 574-579). `wrap="off"`
    presumably arrives the same way, through the UA's `white-space:
pre`. Meanwhile the rows count the wrap.

## What "never scrolls" reaches

- cell-model.md "Form controls" states it, along with the growth and
  the intrinsic sizes. Steps 3-5 rewrite that bullet.
- styles.css's textarea rule and its comment (136-145) change in
  step 4.
- The engine's own scroll machinery never sees a textarea:
  - `#scrollTarget` takes only `data-mw-scroll` elements
    (element.ts:1042-1047).
  - `#captureScrollState` and `#restoreScrollPositions` walk only the
    engine's scroll nodes (element.ts:976-1022).
  - Step 4 adds textareas to the capture, the restore and the settle,
    but not to the containers' range, bars or paint.
- These do not change:
  - render.ts's ink and ground for an editable's native selection
    (`syncEditableColors`, render.ts:126-130) color the selection
    wherever it scrolls to.
  - The grid's selection holds no textarea text, since the leaf has
    none.
  - focus.ts keeps all four arrows native in a textarea
    (focus.ts:157).
  - scrolling.md's keyboard hold already counts a textarea as keeping
    every key (scrolling.md:345-346).
- Stories that assume growth: interactive.stories.ts `Textarea`
  (rows="1" boxes grown to 3 and 3+gap), wide.stories.ts `Wide`, and
  host.stories.ts `TextareaRows`. Each holds its look under
  `field-sizing-content` (step 5).
- The playground's textarea (apps/play/index.html:101) is the editor,
  outside any host.

## Design

### Steps 1-3: the wrap moves into layout

Only a `field-sizing: content` textarea (after step 5) has rows that
depend on its width. This part keeps its mechanism and narrows its
reach.

- **Why the wrap can move.**
  - A textarea's width never depends on its rows. Its min- and
    max-content come from `cols` (tree.ts:273; layout.ts:1234-1240), or
    from its value's lines after step 5. The width resolves first, and
    the rows follow from it.
  - Every height a parent reads is laid out at a resolved width: flex
    (flex.ts:201), grid (grid.ts:463), tables (table.ts:670), multicol,
    and an inline box's line (layout.ts:387-392).
  - The `rows` attribute and `field-sizing` stay build-time reads; they
    give the floor.
- **tree.ts** keeps the value unwrapped:
  - `textareaValue: { text, advances }` holds the value and
    `clusterAdvances(value)`.
  - `intrinsicHeight` becomes the rows floor: `rows` lines (2 by
    default, 1 under `field-sizing: content`) with the gaps between.
  - `TextareaWidths`, the `buildTree`/`buildRoot` parameter,
    `BuildContext.textareaWidths` and the `wrapLineCount` import go.
- **layout.ts**: in `layoutTextLeaf`'s branch for a leaf with no text,
  a textarea with a `textareaValue` takes the larger of two heights:
  - `intrinsicHeight`;
  - the value's height at `innerWidth`: `wrapLineCount` lines, plus one
    after a trailing newline, with `lineGap` rows between.

  At a width of 0 or less, the value wraps to one line per hard line
  (wrap.ts:249-253).

- **element.ts** removes:
  - the snapshot (2784-2804), keeping `hostStyle` and `#syncTokens`;
  - `#textareaCells`;
  - `#rewrapsTextareas` and its call;
  - `buildRoot`'s fourth argument (2894, 2896);
  - the `TextareaWidths` import.
- **types.ts** adds `textareaValue` on `LayoutNode`.
- **No memo.** A leaf's text is wrapped again on every
  `layoutTextLeaf` call, and so is the value.

### Step 4: a textarea scrolls natively, on whole lines

- **The native box scrolls.** styles.css's textarea rule becomes:
  - `overflow: auto`, `scrollbar-width: none`, `scroll-behavior: auto`
    and `resize: none`, all `!important`, plus
    `::-webkit-scrollbar { display: none }`.
  - The rule applies in the measuring pass too. A textarea that stops
    being a scroll container loses its position.
- **The engine never makes a textarea a scroll container.**
  - The build reads a textarea's `overflow` as `visible` on both axes.
    It holds no engine content, and its range is the browser's.
  - So render.ts writes neither `data-mw-scroll` (no range spacer, no
    bar, no gutter) nor `data-mw-clip`.
- **Its range is whole lines.**
  - Under `leading-*` the native box holds `rows` whole line boxes
    (`rows × (1 + gap)` rows), while the engine's box is
    `rows + (rows − 1) × gap` rows (cell-model.md "Line height on the
    grid").
  - The companion makes a textarea's native box `gap` rows taller than
    the engine's (`--mw-h + --mw-lh − 1`). It is lifted by the
    existing `--mw-lhs` (styles.css:625-627), so it overhangs the
    engine's box by half a gap at each edge.
  - Then `scrollHeight − clientHeight` is a whole number of lines, and
    at the bottom the last line sits on the last row. That is how
    scrolling.md's range spacer pins a container's range, done here by
    the box, since a textarea renders no `::after`.
  - With no leading, the gap is 0 and nothing changes.
- **The scroll settles on lines.** Textareas join the containers'
  settle (`#onScroll`, `#onScrollEnd`, element.ts:1049-1077), with its
  `scrollend`, its quiesce delay and its fallback timer where no
  `scrollend` comes:
  - A textarea's settle snaps `scrollTop` to the nearest multiple of
    the line pitch (`(1 + gap)` rows; with no leading, a row).
  - "At the native ceiling reads as max" (scrolling.md) carries over.
  - A textarea's scroll needs no repaint, because the grid paints
    nothing inside it.
- **A caret scroll ends on lines.**
  - A caret reveal scrolls to the caret's rect. That rect is at most
    half a leading off the line box, which is less than half a pitch.
  - So the nearest line is the one that shows the caret, and the
    settle lands there.
- **Positions survive relayouts.**
  - The measuring pass reverts a textarea to its UA size, which can
    clamp its `scrollTop`.
  - `#captureScrollState` and `#restoreScrollPositions` take the
    host's textareas beside the scroll nodes. They write back only a
    position the clamp moved, as they do for containers.
- **Horizontal scrolling** stays native and unsnapped, like an input's
  (decision 6). A `wrap="off"`, `nowrap` or `pre` textarea's text may
  sit off the columns by a fraction while it is scrolled.

### Step 5: sizing as CSS does

- **tree.ts** sets `textareaValue` only under `field-sizing: content`.
  Any other textarea is `intrinsicHeight` tall, its rows floor, and
  its value scrolls. An explicit height already wins in `layoutNode`.
- **layout.ts** counts rows the way the native text lays out:
  - The wrap counts tracking: `clusterAdvances(value, style.tracking)`,
    with `tracking` passed to `wrapLineCount`, as a text leaf wraps.
    The companion's trailing-gap allowance (styles.css:674-690) gives
    the native line the same room.
  - Where `whiteSpace` is not `normal`, it counts hard lines, as
    `layoutTextLeaf` does for text. render.ts's nowrap and pre flags
    stop the native wrap as they do today, and the text scrolls
    horizontally.
- **The width follows the value** under `field-sizing: content`
  (decision 7). `cols` no longer applies there, as in CSS:
  - **tree.ts**: `intrinsicWidth` is the longest hard line's advance,
    tracking included, plus the caret's cell where step 0 confirms it.
    An empty value takes its placeholder's lines where step 0
    confirms that too, and otherwise one cell.
  - **layout.ts**: `intrinsicInnerWidth` gives such a textarea's
    min-content as a text leaf's, the longest unbreakable segment
    (`longestSegmentAdvance`) plus the same caret cell. Under
    `nowrap` or `pre` it is the longest hard line.
  - Shrink-to-fit then gives the width that CSS gives: the value's
    widest line, stopped by `max-width` or the available width. Past
    that, the in-layout wrap adds rows. An explicit width still wins.

## Steps

Each step lands green: `pnpm check`, the core unit tests, and the
story suite in all three engines. Every test is seen failing first, on
the tree before its step, in all three engines. A case that passes
there in some engine is reported, not dropped.

0. **Probes** (no code; a scratch page in all three engines, under the
   companion's rules). They settle the design's native assumptions:
   - a textarea at `overflow: auto` with `scrollbar-width: none` and
     the WebKit pseudo-element shows no bar (`clientWidth` is the
     padding box);
   - the lock `white-space: normal` keeps the value's newlines, and
     whether it collapses runs of spaces;
   - the computed `white-space` of a `wrap="off"` textarea;
   - under `leading-loose`, with the box grown by the gap:
     `scrollHeight − clientHeight` is a whole number of lines, and at
     the bottom the last line lands on the last row;
   - where a caret reveal leaves `scrollTop`, and whether a `scrollend`
     follows it;
   - whether a measuring pass clamps a scrolled textarea whose width
     reverts;
   - for a native `field-sizing: content` textarea outside a host,
     measured in cells:
     - whether its width is its longest line plus a cell for the caret;
     - whether an empty one takes its placeholder's width;
     - whether, in a container narrower than its line, it wraps at the
       container (the min-content rule) or overflows.
1. **The wrap in layout** (tree.ts, layout.ts, types.ts, element.ts).
   Every textarea still grows here, as today, so no story changes.
2. **The layout counts** (host.stories.ts). Seen failing in a worktree
   of the tree before step 1.
3. **The docs for 1-2**:
   - cell-model.md "Form controls": the value wraps at the width the
     layout gives the box, in that same layout.
   - performance.md: a dated paragraph closing "One load layout".
   - incremental-reads.md: a unit's read takes no textarea widths
     ("What an incremental relayout does", "Each unit's subtree is
     read"; its touch points once written). Its plan's gap 5 and
     milestone 3 say so.
   - `2026-09-23-performance-levers.md` lever 1 points here.
4. **Native scrolling** (styles.css, tree.ts, element.ts). Textareas
   still grow here, so only an explicit height or `max-h` scrolls.
   Docs:
   - cell-model.md "Form controls": "Textareas never scroll" becomes the
     scrolling rule, with two deviations:
     - no scrollbar shows, as on an input;
     - the text settles on whole lines after a scroll, and until then
       it may sit off the rows (scrolling.md's own mid-gesture
       deviation, on the visible text here).
   - The styles.css comment follows the rule.
   - scrolling.md gains an "Interactions" bullet: textareas share the
     settle and the relayout snapshot, not the range, bars or paint.
5. **CSS sizing** (tree.ts, layout.ts): the rows, and the width under
   `field-sizing: content`. Existing stories are edited here. Each of
   these textareas has an explicit width, which still wins:
   - interactive.stories.ts `Textarea`: its two textareas that hold
     values gain `field-sizing-content`, so they keep their grown
     boxes and the golden.
   - wide.stories.ts `Wide` and host.stories.ts `TextareaRows`: their
     textareas gain `field-sizing-content`. The `Math.max(2, …)` floor
     in `Wide` becomes 1.

   Docs:
   - cell-model.md "Form controls" gains:
     - the sizing rule;
     - under `field-sizing: content`, the width from the value's lines
       (its caret cell and placeholder as step 0 found);
     - tracking;
     - respected `white-space` and `wrap="off"`.
   - wide-characters.md:130: "a `field-sizing: content` textarea's row
     count".

## Tests

- **Unit, steps 1-2** (packages/core/test, happy-dom, which computes
  `field-sizing`). "Red" means seen failing on a scratch copy of the
  tree before, in the prototype run. The textareas are
  `field-sizing: content`:
  - plain-text.test.ts:669-675 and 690-696 read the laid-out height
    instead of `intrinsicHeight`: `rows="1"` over four hard lines is 4
    rows, and the leading case is 3.
  - plain-text.test.ts:677-688 becomes "wraps its value at the content
    width its layout gives it". `alpha beta gamma` at six content cells
    is 3 rows, and 4 with a trailing newline. Red: 1 and 2.
  - A `display: block` textarea grown in a flex row wraps at its grown
    width, not at `cols`. Red. The block display is needed because
    happy-dom does not blockify flex items.
  - A textarea whose padding takes its whole width counts hard lines.
    This guards the fallback and is green before.
  - wide.test.ts:67 is named for a textarea but checks only a select.
    It gains the textarea: `日本語のテキストが折り返す` at ten content
    cells is 3 rows. Red: 1.
  - element.test.ts: a host holding a textarea lays out as many times
    on load as the same host without it. Red: four against two.
- **Stories, step 2**:
  - `LoadLayouts` gains a third host holding a plain textarea and a
    `field-sizing-content` one, each with a value that wraps: `[1, 1,
1]`. Red: `[1, 1, 2]`.
  - `TextareaRows` counts layouts for a `field-sizing-content w-full`
    textarea: one on load, one per insertion, one when its container
    narrows (both textareas rewrapped). Typing grows its rows to the
    wrap. Red: two layouts each on load, on insertion and on resize.
- **Unit, step 4**:
  - A textarea with `overflow: auto` builds with `overflow` visible,
    and after `render` carries neither `data-mw-scroll` nor
    `data-mw-clip`. Red: the flags.
- **Stories, step 4**: host.stories.ts `TextareaScroll` (`!dev`,
  `!golden`), `w-12 border` textareas.
  - An explicit `h-3` over a long value:
    - the box is 3 rows plus the border;
    - `scrollHeight` exceeds `clientHeight`;
    - a `scrollTop` of 1.4 rows settles to a row multiple within
      0.5 px.

    Red: `scrollTop` stays 0 under `clip`.

  - A `leading-loose` `h-*` box over a long value:
    `scrollHeight − clientHeight` is a whole number of lines (2 rows
    each). Typing at the end settles at the max, with the last line on
    the last content row. Red: no scroll.
  - The position survives a relayout. A textarea narrower than its
    `cols`, scrolled to its max, keeps `scrollTop` across a relayout (a
    sibling's class toggled). Red.
  - No native bar: `offsetWidth − clientWidth` is the border alone.
    This passes before too; it guards the rule.
- **Unit, step 5**:
  - plain-text.test.ts:669-675 gains a plain twin of its four hard
    lines. A plain textarea is `rows` tall whatever its value, so
    `rows="1"` is 1 row. Red: 4.
  - A `field-sizing: content` textarea with `letter-spacing: 0.4px`
    (one cell of tracking), `ab cd ef` at six cells, is 3 rows. Red: 2.
  - A `field-sizing: content` textarea under `white-space: nowrap`, and
    one under `pre`: `alpha beta gamma` at six cells is 1 row. Red: 3.
  - The width of a `field-sizing: content` textarea with no width set:
    - `one two\nthree` in a wide container is its longest line wide:
      5 cells, 6 with the caret's cell. Red: 20 (`cols`).
    - `alpha beta gamma` in an inline-block, in a six-cell container,
      fits the container and wraps to 3 rows (the min-content rule).
      Red: 20 wide, overflowing.
    - Under `nowrap` it is the longest hard line wide.
    - An empty one is its placeholder's width, or one cell, as step 0
      found (plus the caret's cell if confirmed).
- **Stories, step 5**, added to `TextareaScroll`:
  - `field-sizing-content` sets the width, in all three engines:
    - with no width set, `one two` is 7 cells wide (plus the caret's
      cell), plus the border;
    - typing a longer line widens it;
    - under `max-w-12` a long value stops at 12 cells and its rows
      grow.

    Red: 20 cells wide throughout.

  - A long value with `rows="3"` is 3 rows plus the border. Typing at
    the end settles at the max, a row multiple, with the last line on
    the last row. Red: the box grows to fit.
  - `field-sizing-content` grows: typing a line break adds a row in one
    layout, and deleting it takes the row back. This is green before
    too (it guards the growth); its single layout is red in
    `TextareaRows`.
  - `wrap="off"` and `whitespace-nowrap` over a long line:
    `scrollWidth` exceeds `clientWidth`, a `scrollLeft` of three cells
    holds, and the box stays `rows` tall. Red: the box grows to the
    wrapped count.
  - `tracking-wide` under `field-sizing-content`: the native line
    count (`scrollHeight` over the row height) equals the grid's rows.
    Red: more native lines.
- **Unchanged and green**: focus.stories.ts's arrows in a textarea.
- **Goldens**: `features-interactive--textarea` holds through every
  step (its textareas keep their boxes under `field-sizing-content`).
  Run it scoped after steps 4 and 5; no full run.
- At the end, once: `pnpm check`, `pnpm test`, and the story suite in
  all three engines.

## Size

- **Core source, about ±0 lines in all:**
  - steps 1-3, −60: element.ts −47, tree.ts −30, layout.ts +8,
    types.ts +4;
  - step 4, +47: element.ts +35 (the textarea branch of the settle, the
    target test, the capture and restore), styles.css +10, tree.ts +2;
  - step 5, +14:
    - tree.ts +7: the value only under `field-sizing`, the width from
      its lines, the placeholder, the caret;
    - layout.ts +7: tracking, hard lines, the min-content branch.
- **Tests, about +265 lines:**
  - steps 1-2, +70;
  - step 4: unit +15, `TextareaScroll` +80;
  - step 5: unit +60, `TextareaScroll` +35, the existing stories +5.

## Risks

- **The native box rendered at a different width than the engine's.**
  After step 1, a `field-sizing` textarea's rows follow the engine's
  width where they once followed the native one. No such case is
  known. `Wide` and `TextareaRows` measure the native box in all three
  engines.
- **Cost per layout.** The wrap runs on every `layoutTextLeaf` call of
  a `field-sizing` textarea, where the build ran it once. It is a leaf
  wrap over the value's length. A one-entry memo by width is the lever
  if a profile asks for it.
- **The visible text off its rows mid-scroll.**
  - A container's native layer is invisible; a textarea's text is what
    the reader sees.
  - It sits off the rows by up to a fraction of a line until the
    settle: after a wheel, and after a keystroke's caret reveal when
    the caret's rect is shorter than the line.
  - The settle comes at `scrollend` plus the quiesce delay, or at
    160 ms.
- **The half-gap overhang under `leading-*`.** The native box reaches
  half a gap past the engine's box at each edge, so mid-scroll text
  can show there and a click there hits the textarea. The top half
  exists today (the lift). The lever is a `clip-path` inset by the
  half gap, applied only where the gap is non-zero, so it leaves a
  focus outline alone.
- **Engines.** Step 0 settles each of these:
  - an engine that applies `wrap="off"` outside the cascade;
  - one whose lock collapses the value's newlines;
  - one whose caret reveal fires no `scrollend` (the fallback timer
    covers it).
- **Behavior change for authors.** A textarea with a long value and no
  `field-sizing-content` stops growing and scrolls instead, as in CSS.
  Pages that relied on the growth add `field-sizing-content`.
- **element.ts is under edit** by other work, and the removed and added
  lines sit in `#performLayout` and the scroll handlers.

## Prototype (scratch copy, not kept)

Steps 1-3's design was prototyped, with element.ts's rewrap call
disabled:

- The core suite fails only the three textarea tests step 1 rewrites.
- The steps 1-2 unit tests fail on the tree before and pass on the
  prototype.
- happy-dom lays out a plain host twice on load (its own triggers).
  With a textarea it lays out four times before and twice after.
- The tracking test fails without the tracking and passes with it.
- happy-dom computes `field-sizing: content` from a style.
