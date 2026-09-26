# Incremental reads implementation plan

Status: **planned 2026-09-24** (written 2026-09-23, revised
2026-09-24 per "Decisions"). The spec, `../specs/incremental-reads.md`,
is proposed and is reviewed before any code. Lever 4 of
`2026-09-23-performance-levers.md`. What it waited on has landed:
levers 1–3, the opacity model (`2026-09-24-one-opacity-model.md`) and
the painted-origin pass. `2026-09-24-textarea-one-layout.md` lands
before milestone 3, so the relayout path carries no textarea
widths.

## Decisions (2026-09-24)

1. **No stylesheet reading.** The engine reads computed styles, never
   the author's CSS (core-architecture.md D1), so the scan, its facts
   and its fingerprint are gone. A change reads its wider unit
   (subtree, following siblings, ancestors read and compared), states
   come from a fixed list of pseudo-classes queried in the host, and a
   selector reaching past the unit is a documented limit. `:has()` and
   an unreadable sheet no longer force full reads; a container does,
   seen in the computed `container-type`.
2. **Opt-in, through `updates`.** `full` (the default) reads in full
   as today; `incremental` reads incrementally, with full reads on the
   triggers that name no changes.
3. **The catch-up read is `recheck`**, on only under
   `updates="incremental recheck"`.
4. **CI**: verify and the differential fuzz run in Chromium on every
   push and in all three engines before a release.
5. **The pointer reads no siblings.** An element the pointer alone
   changed (`:hover`, `:active`, `data-mw-hover`, `data-mw-active`,
   `data-mw-covered`) reads no following sibling, so a hover across
   blocks reads two blocks; `peer-hover:`, `peer-active:` and
   hand-written `:hover ~ …` and `:hover + …` rules are a limit.
6. **Siblings before the change stay a limit.** No change reads its
   parent's whole subtree; a `group-has-*` target ahead of the changed
   element, where no listed state brings the group in, waits for the
   next full read.

## What the prototype measured, and what it left out

The prototype (`scratchpad/dramatic/incr-src` of the 2026-09-23
session, not kept) measured per relayout, main-thread CPU in Chromium
153, builds round-robin: prose hover 97.8 → 30.1 ms (style 40.3 →
5.6), typing into an `<input>` 98.4 → 28.9, boxes hover 56.7 → 37.2.
It checked three pages' final grids against the base by hash, after
hovering six links or typing.

It took `pointerover` and `input` targets and the synthesized chains'
flips as dirty elements, mapped each to its nearest node, flagged the
unit subtrees and their ancestors, spliced `buildTree(unit)` in at the
old index with `inlineBox` copied, then laid out, rendered and painted
in full. Each of these gaps is a rule in the spec now:

1. Its nesting test (`el.contains(other)`) dropped the ancestor and
   kept the descendant. A hovered container whose block child also
   flipped kept its stale style; on the test pages every descendant
   was an inline element of the same leaf, which hid it.
2. A dirty element whose nearest node was the root (a host leaf, text
   in the host) found no unit, so nothing was read again.
3. A unit gone `display: none` kept its old node, and a role change
   was spliced in place though its parent's classification depends on
   it.
4. It spliced atomic inline boxes in place, leaving the leaf's marker
   advance and intrinsic width stale, and did not derive
   `inlineOpacity` again.
5. It passed the textarea widths empty, so a textarea in a unit falls
   back to its hard lines. Typing was only tested in an `<input>`.
6. It skipped half of the full relayout: the interactivity marks, the
   fade holds, the metrics and columns (cached), the visible cells,
   the grid's and host's size and `--mw-host-w` (a hover or keystroke
   that changes the height leaves the host wrong), the found
   animations and pending fades (a `hover:bg-* transition-colors`
   never fades, and its pend leaks into a later layout), and the
   surroundings.
7. In text mode, `pointerover` named its target and related target,
   not native `:hover`'s chain between them.
8. It modelled no selector dependencies (`peer-*`, `has-*`,
   `:focus-within`, structural pseudo-classes, container queries).
9. A flagged anchored box saw the names of unflagged anchors.
10. Layout on reused nodes was never audited. Layout mutates the
    marker advances that min-content reads, `root.anchorScrollers`
    only grows, and `root.visibleCells` is never cleared.
11. It read only event targets, so records still pending when a
    relayout runs synchronously would be missed.

## Milestones

Each lands green on its own: `pnpm check`, `pnpm test`, the story
suite in three engines. Goldens run only where paint moves, and none
should.

### 0. The measuring tools

- `scripts/bench.mjs --relayout hover|type|toggle`: per-relayout
  main-thread CPU, style and script from CDP, with builds alternated
  round-robin and a spare page opened first; `hover` measures a move
  within a paragraph and one across paragraphs apart. Several
  `--bundle`s alternate per round, and `--updates full|incremental`
  sets the host's attribute, which a build before it ignores. This
  brings the levers plan's `hover-rr.mjs` into the repo. performance.md
  records the baseline.
- The verify switch, internal: a host connecting without `updates`
  under it reads incrementally (the spec's "The invariant"). Nothing
  reads less yet.

### 1. The derivation, checked against full reads

- dirty.ts: the state list and the state sets and control values per
  relayout, and the changed elements from records, marks, states and
  values, mapped to units with the rises, the following siblings and
  the nesting. The ancestors' comparison runs against the full read's
  own reads.
- element.ts: under verify, the triggers feed the pending set and the
  relayout takes the observer's records first. Every relayout still
  reads in full.
- Verify checks soundness: after each full relayout that derived a
  set, every node whose build fields changed lies in a unit.
- The verify run: `test:verify` in apps/storybook sets `MW_VERIFY=1`,
  on which vitest.config.ts provides the switch to
  `.storybook/vitest.setup.ts` and runs the `verify`-tagged stories
  and the `fuzz` ones; `pnpm test` excludes `fuzz`. A story whose play
  hits a limit carries `!verify` and names the limit. ci.yml's `check`
  job runs it in Chromium after `pnpm test`; release.yml's `publish`
  job runs it in all three engines after `pnpm test`, before the
  publish. The jobs' timeouts (15 and 20 minutes) are checked against
  the measured runs. `verify` joins `.storybook/preview.ts`'s default
  tags. AGENTS.md "Testing" gains the command.
- The fuzz's checked driver runs with full reads.
- Behavior doesn't change, so this lands early and runs a while before
  anything reads less.

### 2. Layout safe on reused nodes

- The audit: every field layout writes on a node is either cleared at
  the node's entry or written on every pass. The marker advances live
  apart from the run's. The root's fields are set per layout, and
  `tableHidden` and `hostRect` are cleared.
- `layout.test.ts`: take a corpus of trees (block, flex, grid, table,
  multicol, floats, positioned, anchored, atomic inline boxes, scroll
  containers, sticky, top layer). A second `layoutRoot` on the same
  nodes, and one after a subtree is replaced by a fresh copy, must
  equal a fresh tree's layout in every field. A Node fuzz of random
  trees does the same.
- Behavior doesn't change.

### 3. The splice, the partial unlock and `updates`

- tree.ts: a child rebuilt by its parent's path, the role classifier
  exported, and the reads kept of the inline elements that hold a
  node.
- style.ts: the `container-type` a read reports.
- element.ts: one relayout path that takes a unit list, or none for a
  full read. It runs the flags, marks, textarea widths and settle over
  the units and their ancestors, reads and compares the ancestors
  with a second round for those that differ, and flags the anchors
  where a unit holds an anchored box. Then the splice, and the
  full-read fallbacks, the container restart among them.
- `updates` in `HOST_KEYWORDS` with its three values: the check
  becomes membership in the list, the warning names every value, and
  a change schedules no layout. Under `incremental`, the pointer's
  relayouts (the chains' flips, the pointer events) and attribute
  records read incrementally; every other trigger reads in full.
- `cascade.test.ts`: every lock keys the measuring flag on its own
  subject. `element.test.ts`: `updates`' reflection and warning.
- Verify exercises it: the story suite with incremental reads on, and
  both fuzz drivers.

### 4. `recheck`, the bench and the docs

- `recheck`, and the fuzz's limit driver.
- The hover bench against the targets below. performance.md records
  it.
- packages/core/README.md documents `updates`, its limits and
  `recheck`; core-architecture.md D3 names it among the host's
  attributes.
- The spec's touch points, mapping the code as it landed.
- Pointers to the spec, each saying what a relayout reads:
  core-architecture.md D3's host attributes and "The measure/write
  cycle", cell-model.md "Observation", "Pointer states" and
  "Animation", animations.md "Paused stays put", anchor-positioning.md
  "Reading", and performance.md.

### 5. Every trigger that can name its changes, and the full benchmark

- Tree and text records, focus, key activation, `input` and `change`
  read incrementally, using the full state and value diffs.
- The typing bench against its target.
- The full benchmark, recorded in performance.md: every shape
  `pnpm bench` has (boxes, blocks, prose, faded) to interactive, and
  the per-step costs of `--relayout` (a relayout from an attribute
  change, a hover within and across paragraphs and between boxes,
  typing into an `<input>` and a `<textarea>`), each under
  `updates="full"` and `updates="incremental"`, on the new build
  against v0.3.2, v0.3.1 and v0.3.0. Each tag is exported with
  `git archive` into a scratch dir and its `cdn.js` built there, the
  tracked tree never checked out; a tag predates `updates` and ignores
  it, so its two columns both read in full and show the noise. The
  builds alternate round-robin, with a second copy of the new build as
  noise control, and each result gives the median and the spread
  (min–max) of its rounds.

### 6. Later, each its own decision

- The sampling loop's elements as its relayouts' units: transition
  targets, the animated set, the synthesized fades. A
  `transition-colors` hover would then fade at incremental cost.
- Relayouts with nothing to read lay out with an empty set: an
  anchor's scroll, the cells under a centered dialog, a held paint.
- A toggle of an element outside the top layer (`<details>`).
- An ancestor restyled in place: where only fields no descendant and
  no parent's build read differ (a background), its node takes the
  fresh style and its subtree is not read.

## Test strategy

- **The oracle is the spec's invariant**, as two checks: soundness of
  the derivation on full relayouts, and idempotence after incremental
  ones (a full relayout right after writes and repaints nothing).
  Both hold outside the limits only; verify cannot tell a limit from a
  bug, so the corpus and the checked streams stay clear of them.
- **The corpus is the story suite under verify**, but for the stories
  tagged `!verify`. Every play's hovers, presses, typing, focus moves,
  toggles and DOM changes become cases.
- **The differential fuzz** is a story file run in vitest browser
  mode like every story: `Test / Incremental reads`, tagged `!dev`,
  `!golden` and `fuzz`.
  - Trees: seeded (mulberry32), at most 4 deep and 40 elements, from
    divs, paragraphs, spans, links, buttons, labels, inputs,
    textareas, selects, lists, tables and details. Classes come from a
    vocabulary written out in the file so Tailwind generates it:
    displays, positions, spacing, borders, colors, `hover:` `active:`
    `focus-visible:` `focus-within:`, `group` and `group-hover:`, `peer`
    and `peer-checked:`, `has-*` on the changed element's ancestors,
    `odd:` `first:`, `data-[state=on]:`, `aria-expanded:`, `rtl:`
    under `dir="auto"`, `invisible`, `opacity-50`, `overflow-auto`,
    `truncate`, `whitespace-pre`, `tracking-wide`, `leading-loose`,
    `pointer-events-none`, `inline-block`, and anchored boxes.
  - Limit streams add the limits' patterns: `group-has-checked:` and
    `group-has-data-*:` on a target before the change, `peer-hover:`,
    `peer-active:`, `peer-has-*`,
    `has-[+_…]:`, a `has-*` that sets only a custom property,
    `nth-last-[…_of_…]:`. Container streams (`@container`, `@md:`)
    must fall back and match at every step.
  - Ops: toggle a class; set or remove `data-state`, `aria-expanded`,
    `hidden`, `disabled`, `dir` or `open`; insert, remove or move an
    element; edit a text, whitespace to text included; set a control's
    value, checkedness or selection by script alone; hover a random
    cell by synthesized pointer, and leave; focus and blur; click a
    checkbox; type into a textarea; mutate, then focus a `<select>` in
    the same task, a synchronous relayout (the pending-records rule).
  - The mirrored driver: two grid-mode hosts, `updates="full"` and
    `updates="incremental"`, take the same DOM ops and synthesized
    pointer (each host keeps its own chain). After every step they are
    compared cell by cell: each painted cell's character and style in
    the grid and the layers, every light element's engine vars and
    flags, the host's size. Consecutive incremental relayouts pile up
    here with nothing to reset them.
  - The checked driver: one verified host takes every op, including
    the native states two hosts cannot share (focus, native hover,
    typing).
  - The limit driver: an `updates="incremental recheck"` host and a
    `full` one take a limit stream, and match a second after each
    burst.
  - A failure prints the seed and the op log. A shrinker replays the
    log, dropping ops, down to the shortest failing stream.
- **Node (happy-dom)**: `dirty.test.ts`, `tree.test.ts`,
  `layout.test.ts` and `element.test.ts`, as the spec's "Testing"
  lists them.
- **Where it runs**: locally, Chromium on every change. The verify run
  is a browser suite like the others, never beside another. In CI, the
  verify run and the fuzz run in Chromium on every push (ci.yml
  `check`) and in all three engines before a release (release.yml
  `publish`, which re-runs the checks before publishing).

## Bench targets

Measured with `--relayout`, builds alternated, with a second copy of
the base build to show the noise, under `updates="incremental"`. The
targets are ratios to a full relayout on the same build, since levers
1–3 move the base first:

- prose hover within a paragraph and across paragraphs, and typing
  into an `<input>` and a `<textarea>`: at most a third of a full
  relayout's main-thread CPU (the prototype: 30.1 of 97.8, 28.9 of
  98.4), style recalc at most a fifth (5.6 of 40.3);
- boxes hover, between boxes: at most 70% (37.2 of 56.7);
- under `updates="full"`, a full relayout and a page load: within the
  build before's noise, the mode gathering nothing;
- under `incremental`, a full relayout: at most 1 ms more than under
  `full` on prose, for the state query and the value record;
- blocks: unchanged.

A missed target is traced in a profile to its extra (the state query,
the ancestors' reads and second round, the anchor flags, the ancestor
chain's restyle). The spec is then changed on purpose, never bent to
fit the bench.

## Risks

- **A dependency past the wider unit** paints stale until the next
  full read: the spec's limits. The mode is opt-in, `recheck` bounds
  the wait to a second after the burst, and the soundness check and
  the fuzz check that nothing outside the limits is missed.
- **The sibling rule's reach**: every change but the pointer's reads
  its following siblings, so a class toggled or a focus moved high in
  a long list reads the rest of it, and the half rule turns it full.
- **A story whose play hits a limit leaves the corpus** (`!verify`).
  None does today: `Features / Interactive`'s `group-has-focus-visible:`
  labels are read when focus enters their group's `:focus-within`. The
  fuzz's limit driver covers the limits under `recheck`.
- **Layout state on reused nodes**: milestone 2's audit, and the
  reuse test, which catches the next layout field added without the
  rule.
- **An unlocked ancestor restyles its descendants** for its inherited
  properties, and every relayout now reads the chain too. The
  prototype paid 5.6 ms of style on prose with the chain unlocked; a
  deep page whose hovers flip long chains pays more.
- **Near-full relayouts**: entering the host, or a `:focus-within`
  move across the page, dirties top-level chains and their following
  siblings, and falls to full by the half rule. That is no worse than
  today.
- **The other levers**:
  - Lever 1 must ignore the resizes the engine causes, or every
    incremental relayout that changes the host's height is followed
    by a full one through the ResizeObserver. Landed: a resize lays
    out again only where the layout reads it (cell-model.md
    "Observation").
  - Lever 2's settle selection intersects the flagged set. Landed:
    the settling elements are read after the build, from the
    flagged set.
  - Lever 3's `anchor-scope` shape decides whether the anchors need
    flags. Landed as `data-mw-anchor` under the measuring flag, so
    they do; an anchor named since the last layout has the tree read
    again (anchor-positioning.md "Reading"), which an incremental
    relayout must do for its units too.
- **The opacity model** — settled: it landed keeping `inlineOpacity`
  (a box's group opacity) and giving each inline entry its own opacity
  and its parent entry, which the rebuild path derives again.
- **The recheck** costs one full relayout per burst in idle time. A
  user who resumes in that frame gets one slow frame.
