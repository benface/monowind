# Performance

## The benchmark

`pnpm bench` (`scripts/bench.mjs`) times a page of 300 bordered boxes
— the shape that stresses the grid hardest, since every border cell is
a glyph the font may draw off its row
(`specs/wide-characters.md`). It reports the median of five runs of:

- **interactive** — navigation until the host sets `data-mw-ready`,
- **style recalc** and **layout** — Chromium's own counters,
- **grid spans** — what the shadow `#grid` holds.

`--shape` swaps the page: `blocks` (rows of block glyphs), `prose`
(paragraphs of nested inline elements), `faded` (filled bordered
boxes, every other at `opacity-50`, on a `bg-white/10` card under a
`bg-black/50` overlay — the blending, specs/cell-model.md "Opacity and
translucency"), `positioned` (in a scroller, `relative` cards each
with a `z-10` badge, every fifth `opacity-90`, every twentieth after a
`sticky z-20` heading — the stacking, specs/positioning.md "Paint
order"), `lists` (numbered list items, every tenth holding two
bullets — the counter walk over every element and a `::marker` read
per item, specs/lists.md), `labels` (paragraphs each numbered by a
counter `::before` and its link marked by an `::after` — the rule
scan, two pseudo-element reads an item and the walk,
specs/generated-content.md).

A plain desktop client: 1280×720 at one device pixel per CSS pixel,
Chromium, no throttling. `--count`, `--runs` and `--rate` (CPU
throttling) vary it; `--bundle <path>` measures a `cdn.js` built
elsewhere, which is how a tag is compared:

```
git worktree add -f --detach /tmp/v0.3.0 v0.3.0
(cd /tmp/v0.3.0 && pnpm install && pnpm -C packages/core build)
node scripts/bench.mjs --bundle /tmp/v0.3.0/packages/core/dist/cdn.js
```

Absolute numbers belong to the machine that took them, so a comparison
is only worth reading when every row of it was taken in one sitting.
Record what moves under "History".

## Where it stands (2026-09-29)

Every release since v0.3.0, as npm serves its `dist/cdn.js`, against
`main`, the tree of v0.3.4, and a second copy of `main`'s bundle for
the noise. Chromium 153 headless, one sitting (load 5–8). Loads: six
rounds of five runs alternated, the median of the rounds. Relayouts,
hovers and the fade: every bundle's page open at once, driven in
alternation, the median of 10–12 rounds, relayouts and hovers taken in
both tab orders and averaged.

| measure (ms)                         | v0.3.0 | v0.3.1 | v0.3.2 | v0.3.3 | main | copy |
| ------------------------------------ | ------ | ------ | ------ | ------ | ---- | ---- |
| prose 300 load, interactive          | 308    | 309    | 300    | 179    | 184  | 183  |
| boxes 300 load, interactive          | 163    | 325    | 224    | 172    | 175  | 176  |
| blocks 40 load, interactive          | 130    | 108    | 86     | 80     | 78   | 80   |
| faded 300 load, interactive          | 269    | 379    | 260    | 192    | 197  | 197  |
| positioned 300 load, interactive     | 230    | 269    | 266    | 175    | 176  | 177  |
| prose relayout, CPU                  | 92.8   | 96.0   | 89.6   | 64.6   | 60.5 | 60.7 |
| boxes relayout, CPU                  | 38.5   | 66.2   | 35.1   | 28.0   | 27.3 | 29.6 |
| prose hover step, CPU                | 100.3  | 102.4  | 95.9   | 70.6   | 69.9 | 67.8 |
| boxes hover step, CPU                | 56.4   | 95.0   | 70.4   | 56.8   | 54.1 | 57.2 |
| 2 s fade (150 boxes), CPU per frame  | 146.4  | 187.1  | 143.7  | 49.7   | 48.5 | 47.9 |
| 2 s fade, frames in its middle 1.2 s | 9      | 7      | 9      | 25     | 26   | 26   |

Against v0.3.3, `main` is 6% faster on the prose relayout, and level
within its copy's spread on the boxes relayout, the hovers, the fade
and the blocks and positioned loads. The prose, boxes and faded loads
stay 2–3% behind: the first paint's per-cell writes (clip, layer
covers, group opacity), the reads the range's features add to a first
layout (glyph properties, stacking), and the larger bundle's parse.
The range's reads had put the boxes relayout 9–11% behind too, till
this release's cuts ("0.3.4, leaner").

Boxes load remains behind v0.3.0: the open raster gap, 7,880 grid
spans against 1,500 (the next section; "Against v0.3.0 and v0.3.1"
measured it). The fade's CPU a frame holds since v0.3.3, spent on two
and a half times the frames.

## What a box is for, and what it costs to skip one

Four fifths of the boxes page's spans are `─`, one box a cell. In the
default font `─` is drawn inside its row and on its cell, so it looks
like it needs no clip, and leaving those runs as plain text does take
the page back to 1500 spans and 167 ms. It also SEAMS, which is the
thing to know before trying it again:

- A run of `─` left as text abuts at the font's own advance, while the
  corners and stems beside it stay boxed and stay scaled, so the joint
  between a scaled `╭` and an unscaled `─` shows.
- `█` takes its whole horizontal overhang from its scale, its ink
  being its cell's width to within a hundredth. Trimming that scale to
  the least overhang that seemed to serve `─` seams a shared block run
  between its cells — which is what paints a box-shadow and a
  scrollbar.
- The baseline a box is pinned by cannot be read from one measurement
  per font: engines round a font's ascent and descent at each size, so
  the pair read at scale 1 does not predict the pair at 1.43, and a
  shade's line-height came out 8px wrong.

So the span count and the joints are one question, not two. The lead
worth testing is the one that drops the per-cell element without
changing what any glyph is scaled to: a tile repeated at the cell
pitch as a `mask` over `currentColor`, which measured zero spread on
every row but leaves webfonts, the other two engines, mixed runs and
selection unanswered.

## History

Each round as it was measured, oldest first. A new round goes at the
end, and "Where it stands" is retaken in place.

### Tiling glyph boxes (2026-09-20 and 2026-09-21)

What the tiling fit's boxes cost in nodes (wide-characters.md "A stroke
is boxed one per cell"), in Chromium on macOS, one sitting each, no
second copy for the noise:

- A page of sixty bordered boxes at the macOS defaults, whose glyphs
  run past the row: 360 grid nodes unboxed, 1,260 boxed (2026-09-20).
- A run of one full-width band sharing a box: a page of seven QR
  codes, bordered panels, a scroller and two shade rows paints 2,191
  grid spans against 3,341 with a box a cell, and 220 with nothing
  boxed (2026-09-21).
- The measuring gate, not the boxes, set what the nodes cost a layout
  (2026-09-20): read through descendant rules, the host's `measuring`
  and `settling` flips walked the whole subtree, the shadow grid
  included, four times a layout — 8.4 ms of the boxed page's style
  recalc, 3.3 of the unboxed one's, where the relayout's own row costs
  a fraction of a millisecond. With each light element gated by its
  own flag (cell-model.md "Animation") the flips cost 0.07 ms, and the
  page relays out in 13.2 ms boxed, against 10.7 unboxed and 18.5
  boxed at the old gate (Chromium's own counters, 30 relayouts, three
  rounds).

### Against v0.3.0 and v0.3.1 (2026-09-21)

Taken together on one machine (Apple silicon, 2026-09-21). Two builds
of one commit taken minutes apart gave 323 ms and 327 ms, so read a
difference under about 5 ms as the harness talking.

`pnpm bench` — 300 bordered boxes, where every border cell is a stroke:

| build   | interactive | style    | layout  | grid spans |
| ------- | ----------- | -------- | ------- | ---------- |
| v0.3.0  | 166 ms      | 50.9 ms  | 9.8 ms  | 1500       |
| v0.3.1  | 338 ms      | 107.6 ms | 37.2 ms | 7880       |
| 0195883 | 231 ms      | 58.3 ms  | 25.6 ms | 7880       |

(`0195883`, the tree that day, since moved on: "Where it stands". The
blocks table below is the same sitting's.)

`pnpm bench --shape blocks --count 40` — rows of one block glyph each,
where a run shares a box:

| build   | interactive | style   | layout  | grid spans |
| ------- | ----------- | ------- | ------- | ---------- |
| v0.3.0  | 131 ms      | 35.5 ms | 15.1 ms | 1600       |
| v0.3.1  | 108 ms      | 22.8 ms | 13.0 ms | 781        |
| 0195883 | 92 ms       | 11.1 ms | 11.2 ms | 781        |

Style recalc on the strokes is back within a hair of v0.3.0 on five
times the spans, so what is left of that gap is not the styling:
against v0.3.0 the page rasterizes 94.7 ms against 38.5 and lays out
26.6 against 9.7, which is what 7880 clipped inline-blocks cost the
compositor. A page that is neither shape lands between them: a QR
code's modules alternate, so its runs are short and share less than a
shadow band's.

`pnpm bench --shape prose` — paragraphs whose inline elements nest,
which is what the run walk and the leaf-or-container question cost on
an ordinary page. Added 2026-09-22 with block-in-inline, to measure a
classification that reads a style per inline element that has element
children:

| build                  | interactive | style    | layout  | grid spans |
| ---------------------- | ----------- | -------- | ------- | ---------- |
| before block-in-inline | 309 ms      | 131.4 ms | 18.7 ms | 2400       |
| with it                | 314 ms      | 130.9 ms | 18.9 ms | 2400       |

Inside the noise, and layout — where the new walk lives — does not
move. `hidesBlock` answers on `children.length` before reading a
style, which nearly every inline element on a page satisfies.

Read both builds back to back and check `uptime` first: a loaded
machine read the same bundle at 226 ms and 268 ms an hour apart, so a
number without its pair beside it says nothing.

**The open one: 166 ms against 231 ms on the strokes** (`0195883`;
"Where it stands" has it now). Six of the
seven themes pay none of it: dos, dos-blue, green-phosphor, amber and
bbs draw with the VGA bitmap font and c64 with Pet Me 64, and those
put `│`, `─` and `█` exactly on the cell, so nothing is boxed at all
and the grid is the size it was in v0.3.0. Teletype is the exception —
Courier New is an ordinary outline font and boxes like the default
stack.

### What the last round bought (0195883, 2026-09-21)

None of these changed a pixel; the goldens that commit moved, it
moved for the fills/strokes split and the overhang.

- **A font settling no longer restyles the page.** `document.fonts`
  settles on every page, webfont or not, and `invalidate()` bumped the
  generation for it, which tells a paint its boxes are stale: every
  boxed span was restyled in place (`paint.ts`, `refit`). Every
  `measureText` a cached measurement rests on now records how the font
  drew that glyph, and `invalidate()` measures exactly those again and
  forgets nothing while they all draw as they did. Worth 60 ms of the
  93, at one measurement per cached cluster.
- **`--mw-host-w` does not inherit.** Only `mono-wind:not([measuring])`
  reads it, and the layout writes it after the grid is painted, where
  an inherited custom property restyles every span below. Declared
  `@property { inherits: false }`.
- **A box prototype is shared across rows.** The paint cached one per
  segment AND row, though only a shade's style answers to its row, its
  lattice shifting with it.

What did NOT help, measured: sharing the fits across hosts (unsound
besides — a fit keyed on the font string is wrong for two hosts whose
font name resolves differently), warming the fits before the paint,
moving the baseline probe out of the grid, and replacing five inline
declarations with a class (Chromium shares the style either way; 7880
spans cost 4.7 ms of recalc in isolation).

The three attribute rounds a layout makes over every light element —
`data-mw-measuring` on, swapped for `data-mw-settling`, then off — cost
about 46 ms here and are not removable: the flags are what lift the
engine's locks so the measurement reads authored values. v0.3.0 pays
them too. (The settling round was, for every element without a
transition: "Settling only what transitions".)

### Visibility and the anchor extras (2026-09-22)

Before (`df75985`) against the same tree with `visibility`, the anchor
functions, `position-try-order` and `position-visibility`, the
keyboard-scroll hold, and scrollbar track paging — alternated, seven
runs a row, two rounds (load average about 2–4; no second copy of a
build for the noise, so the two rounds' spread is the only gauge):

| shape       | build     | interactive  | style recalc     | layout         |
| ----------- | --------- | ------------ | ---------------- | -------------- |
| boxes (300) | before    | 235 / 236 ms | 58.8 / 59.3 ms   | 25.7 / 26.6 ms |
| boxes (300) | with them | 228 / 218 ms | 48.7 / 48.0 ms   | 25.7 / 24.9 ms |
| blocks (40) | before    | 91 / 93 ms   | 10.6 / 10.8 ms   | 11.2 / 11.4 ms |
| blocks (40) | with them | 84 / 86 ms   | 6.2 / 6.4 ms     | 10.9 / 11.1 ms |
| prose (300) | before    | 318 / 312 ms | 133.6 / 130.9 ms | 19.0 / 18.0 ms |
| prose (300) | with them | 322 / 309 ms | 132.7 / 126.5 ms | 19.4 / 17.5 ms |

Nothing got slower; grid spans are unchanged. The style-recalc drop is
the stylesheet's alone: the build before with only the new
`styles.css` gives it, and with only the new `[data-mw-force-hidden]`
rule does not, which leaves the host's `visibility` while the engine
reads — the build before kept its pre-ready `hidden` through the first
read (visibility.md). Both builds run two layout passes, eighteen
style recalcs, and ten layouts to interactive (CDP
`Performance.getMetrics`); the same recalcs cost less, and which of
them, and why, is not traced.

The fixes that followed — inline boxes' give-back margin, the last
successful placement, `anchor-center` and fallbacks for boxes placed
by their insets, the host read as visible, the fade hold — measured
level against the tree before them, alternated in a later sitting
(before, then after): boxes 249 / 248 / 255 ms against 248 / 250 /
248, style recalc 52–53 ms in both; blocks 99 / 88 against 99 / 87;
prose 350 / 309 against 345 / 310.

### Pointer events and the hit through a layer (2026-09-23)

Reading each light element's `pointer-events` under measuring
(specs/cell-model.md "Pointer states") and hitting through layers
(specs/layers.md) cost prose 332 → 343 ms in a page-load comparison
against `fa37b24`, style recalc 135 → 142 ms. Page loads could not say
where: on a loaded machine they move more between rounds than that.
What could, measured per relayout: every build's page open at once,
each in its own browser context, driven in alternation — twenty
relayouts forced by a `data-*` toggle, the order reversed each round —
reading Chromium's `ThreadTime` (main-thread CPU) beside its style and
script counters; the trace's `UpdateLayoutTree` element counts; and the
selector stats of `disabled-by-default-blink.debug`, which rule costs
what. One run read the first page the browser opened 30 ms slow a
relayout, so a spare opens first.

What moved:

- **A descendant selector inside `:is()` defeats the ancestor filter.**
  The modal dialog's pointer-events opt-in,
  `:is(dialog:modal, dialog:modal *)`, was split in two by the change,
  and every element on the page walked its ancestors looking for a
  dialog, once a rule. Spelled as plain descendants
  (`dialog:modal :not(…)`), the filter rejects every element outside a
  dialog at once: prose style 41.3 → 39.6 ms a relayout, the whole of
  the style regression. The coarse-pointer pair is spelled the same
  way.
- **A slotted rule keyed on the host's `measuring` restyles the shadow
  tree.** `:host([measuring]) ::slotted(*)` took the elements restyled
  a relayout from 12,028 to 21,634 on prose (+4 ms), four times the
  grid's 2,400 spans: each flip restyles the shadow tree. Keyed on
  `measuring`, the slot's own rule stays one element; grid mode's
  top-level `auto` is a static `::slotted`.
- **`:host([data-mw-measuring]) slot` made every flag flip schedule an
  invalidation**: `setAttribute` and `removeAttribute` self time rose
  0.7 ms a relayout in a CPU profile, and fell back without the rule.
- **The flip itself costs nothing measurable.** Every element reads
  `auto` under measuring and takes the lock's `none` after, but it
  restyles for its flag anyway: the count stays HEAD's, plus the slot.
- **JS reads.** Two more computed reads per inline element
  (`pointer-events`, `opacity`) and one per box, paid back by reading
  once what a function read twice — `position`, `display` and
  `visibility`, and `readCellStyle`'s flex, gap, column and `z-index`
  values. CPU profile self time a relayout: HEAD 82–83 ms, now 79–81.
- **Pointer moves.** The same-cell skip ran a full hit test whenever a
  layer lay under the pointer; it compares the point's cells now
  (`pointKey`) and tests nothing. 3,000 rows with a translated badge,
  a same-cell move: HEAD 2–5 µs, before 90–145 µs, now 3–6 µs; a move
  to another cell over the badge 73 / 420 / 78 µs; over an app inside
  a `grayscale` layer 53 / 256 / 50 µs.

HEAD is `fa37b24`, before the change as the reviewer measured it,
after it with the fixes above. Per relayout, one sitting, twelve
rounds of twenty (medians, ms; a second copy of HEAD's bundle read
87.0 / 39.1 / 39.7 on prose, so read a millisecond as noise):

| shape       | build  | main-thread CPU | style recalc | script |
| ----------- | ------ | --------------- | ------------ | ------ |
| prose (300) | HEAD   | 85.4            | 38.4         | 37.3   |
| prose (300) | before | 88.0            | 40.1         | 39.9   |
| prose (300) | after  | 85.8            | 39.1         | 37.9   |
| boxes (300) | HEAD   | 35.8            | 9.4          | 18.7   |
| boxes (300) | before | 36.3            | 10.0         | 18.7   |
| boxes (300) | after  | 35.3            | 9.7          | 17.9   |
| blocks (40) | HEAD   | 5.0             | 0.44         | 2.29   |
| blocks (40) | before | 5.0             | 0.48         | 2.29   |
| blocks (40) | after  | 5.0             | 0.46         | 2.29   |

`pnpm bench`, four rounds of five runs alternated, medians of the
rounds (load 4–7; no second copy for the noise):

| shape       | build  | interactive | style recalc | layout  |
| ----------- | ------ | ----------- | ------------ | ------- |
| prose (300) | HEAD   | 311 ms      | 128.7 ms     | 18.1 ms |
| prose (300) | before | 316 ms      | 132.5 ms     | 17.8 ms |
| prose (300) | after  | 308 ms      | 128.0 ms     | 17.8 ms |
| boxes (300) | HEAD   | 222 ms      | 48.5 ms      | 25.3 ms |
| boxes (300) | before | 224 ms      | 50.2 ms      | 25.4 ms |
| boxes (300) | after  | 226 ms      | 49.5 ms      | 25.5 ms |
| blocks (40) | HEAD   | 84 ms       | 6.1 ms       | 11.0 ms |
| blocks (40) | before | 84 ms       | 6.3 ms       | 11.1 ms |
| blocks (40) | after  | 85 ms       | 6.2 ms       | 11.1 ms |

Six more boxes rounds put interactive level (after 222–236 ms, HEAD
221–241) and style about a millisecond up (48.7–51.4 against
48.1–50.5), which the relayouts do not show (+0.3): not traced.

The lead this left, the editables' negations, is the next section.

### The editables' negations (2026-09-23)

The three rules that cost most in the selector stats after that round
were the two `::selection` locks and grid mode's `user-select` lock,
each excluding an editable's subtree as `[contenteditable] *` inside a
`:not()`: an ancestor walk for every element, which no filter can
reject. Dropping the argument (a measure, not a fix: an editable's
descendants would lose their own selection) took prose relayouts
2.7 ms of CPU and 2 ms of style.

The subtree's exemption is a rule of its own now, a plain descendant
selector the ancestor filter rejects outside an editable: the
`user-select` lock's reverts the subtree to the layered cascade
(`revert-layer`, which keeps an author's utility), the `::selection`
lock's gives it the editables' swap. The swap rule itself, a
`:where()` list every element tried, is one selector per element kind
(`mono-wind input:not(…)::selection`, …), each matched against its own
elements alone. Every element's computed `user-select` and
`::selection` colors read the same before and after in all three
engines: a paragraph locked; an editable, its descendants, a
`contenteditable="false"` island inside it, and a field swapped; an
author's `select-all` kept inside an editable and locked outside it.
A host that is itself editable, or sits inside an editable, no longer
matches the descendant rules and is locked as any grid-mode text: left
unsupported (wide-characters.md), which two more selectors per rule
would have cost about 0.7 ms of the 2 ms.

Selector stats, prose, per relayout:

| rule                               | before  | after   |
| ---------------------------------- | ------- | ------- |
| the transparent `::selection` lock | 2265 µs | 1585 µs |
| the `user-select` lock             | 1525 µs | 1144 µs |
| the editables' swap                | 1244 µs | —       |
| the subtree's two descendant rules | —       | 366 µs  |
| every selector, summed             | 14.1 ms | 12.1 ms |

Per relayout, prose (medians): style recalc 38.0 → 35.9 ms in one
sitting, and 39.0 → 37.4 and 39.5 → 38.0 for two copies of each build
interleaved in another; a CPU profile's non-idle samples 80.6 and 80.1
→ 78.8 and 78.7 ms (two runs each), the saving landing in idle time.
The harness's main-thread CPU stayed within its own noise — two copies
of one build read 2 ms apart there.

`pnpm bench`, four rounds alternated, medians of the rounds (load 3–5):

| shape       | build  | interactive | style recalc |
| ----------- | ------ | ----------- | ------------ |
| prose (300) | before | 305.5 ms    | 126.9 ms     |
| prose (300) | after  | 300.5 ms    | 120.4 ms     |
| boxes (300) | before | 224.5 ms    | 49.9 ms      |
| boxes (300) | after  | 223.0 ms    | 48.7 ms      |

Tried and left: `:read-write` in place of the attribute pair (13.0 ms
summed, its lock still 1.9 ms: the pseudo-class costs nearly what the
walk did), and an attribute the engine would write on an editable's
descendants (12.5 ms, no cheaper than the plain descendants, and an
element typed into an editable would take the locks until the next
layout). `[contenteditable] *` also matched a host that is itself, or
sits inside, an editable; the rules name islands inside the host,
where covering those two as well takes two more selectors a rule,
about 180 µs each (12.9 ms summed).

The same day's layout and paint review fixes, measured before this
change against the build before them, moved nothing: per relayout,
main-thread CPU prose 86.7 → 83.5 ms (85.6 → 84.4 in another sitting),
boxes 34.1 → 33.9, blocks (40) 5.7 → 5.7; page loads, four rounds
alternated, boxes 227.5 ms both, prose 310 → 308.5, blocks (300)
297.5 → 302.5 with its rounds ±10 ms apart.

### The interactives as marks (2026-09-23)

Grid mode's pointer opt-in and text cursor spelled the interactive
list out as a twenty-way `:is()`, and the focus invert the composites'
roles, so every light element was tried against the lists on each
restyle. The layout now marks the elements (`data-mw-interactive`,
`data-mw-composite`, cell-model.md "Pointer states") and the rules key
on one attribute each. Style recalc drops by about a millisecond a
prose relayout, and the marks pay it back: two `matches()` an element
a layout, about 0.8 ms over prose's 2,400 elements, isolated. Not
traced further; main-thread CPU is level.

Per relayout, twelve rounds of twenty alternated, a second copy of the
build before for the noise (medians, ms; load 6–14):

| shape       | build     | main-thread CPU | style recalc | script |
| ----------- | --------- | --------------- | ------------ | ------ |
| prose (300) | before    | 82.3            | 36.0         | 36.8   |
| prose (300) | before #2 | 81.2            | 35.6         | 36.3   |
| prose (300) | marks     | 82.0            | 34.8         | 37.4   |
| boxes (300) | before    | 33.4            | 9.0          | 17.4   |
| boxes (300) | before #2 | 34.0            | 8.9          | 17.8   |
| boxes (300) | marks     | 33.4            | 8.5          | 17.8   |
| blocks (40) | before    | 6.0             | 0.53         | 2.93   |
| blocks (40) | before #2 | 6.0             | 0.54         | 2.92   |
| blocks (40) | marks     | 6.1             | 0.52         | 2.90   |

`pnpm bench`, two rounds alternated at load 5 (three more at load
20, from background system work, agree on style recalc: prose 121.3 →
118.5, boxes 47.7 → 46.5):

| shape       | build  | interactive | style recalc |
| ----------- | ------ | ----------- | ------------ |
| prose (300) | before | 296 ms      | 119.5 ms     |
| prose (300) | marks  | 294 ms      | 115.9 ms     |
| boxes (300) | before | 218.5 ms    | 47.0 ms      |
| boxes (300) | marks  | 217 ms      | 46.0 ms      |
| blocks (40) | before | 83 ms       | 6.1 ms       |
| blocks (40) | marks  | 82.5 ms     | 6.0 ms       |

### One load layout (2026-09-23)

A page load ran two full layouts, the second a frame or two after
the first, and any one of three triggers forced it: `document.fonts.ready`,
resolved already, scheduled its relayout unconditionally; the glyph
cache's `invalidate()` counted a refit with nothing cached, which
restyles every box a paint holds; and the ResizeObserver reported the
height the layout had just written on the host, its parent growing
with it, and each observed box's first size. Now fonts settling lay
out again only where the probe measures another cell or a cached
glyph draws differently, `invalidate()` forgets nothing with nothing
measured, and a resize lays out again only where the layout reads it
(specs/cell-model.md "Observation"): the host at a size other than
the one its layout wrote, a box around it at another width, the probe
at another cell. `LoadLayouts` (host.stories.ts) counts the host's
`measuring` flips: two on each of its hosts before, one after, in all
three engines. The second layout had hidden one dependency: a
textarea's rows wrap at the width the layout before gave it, which a
first layout has none of, so a host holding one lays out again at the
width it gets (specs/cell-model.md "Form controls"; `TextareaRows`) —
two layouts on load there, one elsewhere.

`pnpm bench`, four rounds of five runs alternated, medians of the
rounds and their range (load 12–13, from background system work;
blocks at the bench's default 300 rows):

| shape        | build  | interactive     | style recalc     |
| ------------ | ------ | --------------- | ---------------- |
| prose (300)  | before | 316.5 (298–348) | 125.5 (119–134)  |
| prose (300)  | after  | 234 (219–248)   | 92.8 (88–97)     |
| boxes (300)  | before | 251 (246–253)   | 52.1 (51.5–53.1) |
| boxes (300)  | after  | 206.5 (203–208) | 41.5 (41.1–42.3) |
| blocks (300) | before | 310.5 (299–325) | 41.2 (40.3–43.3) |
| blocks (300) | after  | 256.5 (248–270) | 38.3 (37.3–39.5) |

Paired within a round the after build is 76–100 ms faster on prose,
41–47 on boxes, 49–62 on blocks. Interactive counts only part of the
second layout, which lands after `data-mw-ready`; the main-thread CPU
through ready plus a second counts all of it (page loads alternated,
eight rounds, a second copy of the before bundle for the noise):

| shape       | build     | interactive | CPU through ready + 1 s |
| ----------- | --------- | ----------- | ----------------------- |
| prose (300) | before    | 306 ms      | 328.3 ms                |
| prose (300) | before #2 | 312 ms      | 336.1 ms                |
| prose (300) | after     | 230 ms      | 244.4 ms                |
| boxes (300) | before    | 230 ms      | 247.7 ms                |
| boxes (300) | before #2 | 225 ms      | 241.8 ms                |
| boxes (300) | after     | 187 ms      | 198.9 ms                |

A relayout costs what it did: nothing on its path changed.

### Settling only what transitions (2026-09-23)

Every layout swapped each light element's measuring flag for a
settling one, forced a style flush, and dropped the settling flags:
three restyles of every element, the middle one there only so a lock's
snap back could not start a native transition. Only an element with a
transition to start needs it — a non-zero duration or delay in any
entry of its lists — and the host likewise; every other element drops
its flag alone, and a layout with nothing to settle forces no flush
(specs/cell-model.md "Animation"). The elements that settle are found
after the reads, while the style is clean: one pass reading two
computed values an element, in isolation 1.1 ms on prose's 2,403
elements (0.4 of it the `getComputedStyle` calls) and 0.3 ms on the
boxes' 603. The build reads no transition for most elements it
visits, and none for the ones it does not (a hidden subtree, a
control's options), so there was no read to reuse. `SettleRound` (effects.stories.ts)
holds that an element without either never takes the flag, the host
without one never takes `settling`, and a layout starts no transition.

Per relayout, ten rounds of twenty alternated, a second copy of the
build before for the noise (medians, ms; load 10–16):

| shape       | build     | main-thread CPU | style recalc | script |
| ----------- | --------- | --------------- | ------------ | ------ |
| prose (300) | before    | 84.1            | 36.7         | 37.5   |
| prose (300) | before #2 | 84.4            | 37.0         | 37.0   |
| prose (300) | after     | 68.8            | 23.4         | 38.1   |
| boxes (300) | before    | 35.1            | 9.0          | 18.4   |
| boxes (300) | before #2 | 35.3            | 9.0          | 18.6   |
| boxes (300) | after     | 32.3            | 6.1          | 18.9   |

A hover onto another link of a prose page whose links take a
`hover:bg-*` (eight rounds of twenty moves): CPU 93.4 and 93.3 → 78.4
ms, style recalc 38.3 and 38.1 → 24.8.

`pnpm bench`, four rounds alternated, medians of the rounds and their
range (load 13–17; no second copy for the noise, the ranges the only
gauge):

| shape        | build  | interactive     | style recalc     |
| ------------ | ------ | --------------- | ---------------- |
| prose (300)  | before | 228 (227–228)   | 91.5 (89.8–91.8) |
| prose (300)  | after  | 202.5 (200–204) | 67.8 (66.8–68.9) |
| boxes (300)  | before | 190.5 (184–191) | 39.2 (37.8–40.4) |
| boxes (300)  | after  | 177 (174–181)   | 29.8 (29.6–30.0) |
| blocks (300) | before | 248.5 (244–250) | 37.3 (35.7–37.9) |
| blocks (300) | after  | 238.5 (228–243) | 36.1 (35.1–37.5) |

### Two style rules Chromium could not cache (2026-09-23)

Two companion rules matched every light element on every restyle and
kept Chromium's style work from shrinking:

- **`anchor-scope: all` on every measured element.** On every element
  the property kept Chromium from sharing any read style between them
  — 4 matched-properties cache hits a prose relayout instead of 2,407.
  It keys on the elements naming an anchor now (`data-mw-anchor`,
  written from the `anchor-name` the read took), under their measuring
  flag as before. An anchor named since the last layout is read
  unscoped once: the layout marks it and, where a box in the tree is
  anchored by name, reads the tree again before laying it out
  (specs/anchor-positioning.md "Reading"). Without that re-read every
  engine placed `AnchorFallbackIsTheEngines`' note by the browser's
  own fallback, below its word, in the layout that first read the
  anchor — its load's only one. A background read twice in one layout
  answers as the first read did, so a fade armed by the first is not
  painted at its target by the second.
- **The transparent `::selection` lock**, which had each restyle
  compute every element's `::selection` too. It holds under the host's
  `data-mw-selection` now: set at a `selectstart` in the host's light
  DOM or on an ancestor of it, held through a press's gesture to its
  release and a key's to its first `selectionchange`, set before the
  engine writes a range of its own, and kept
  while `selectionchange` finds a range in the host
  (specs/wide-characters.md). The flag flips once a selection, so its
  descendant combinator on a host attribute — which restyles the
  subtree at a flip, and which the companion otherwise avoids — costs
  a restyle then. A plain text-mode click flips it none (traced
  2026-09-24, Chromium, the prose shape): the engine takes the press,
  so no `selectstart` fires, and its collapsed range sets nothing; a
  click whose pixel of jitter selects a character flips it once, for
  that selection. Chromium and WebKit hand an element without a
  `::selection` of its own the slot's transparent one (highlight
  inheritance), so there the gate shows only where an author's
  `selection:` color would otherwise paint; Firefox paints its default
  highlight without it. `selectionchange` is a task of its own in all
  three engines, and a frame can render before it: a drag pressed
  outside a text-mode host sets the flag at its first move over the
  host, ahead of the move's extension, and a script's first selection
  in a host, or a key carrying one in, can show the browser's
  highlight for that frame (specs/wide-characters.md, Deviations).

Per relayout, ten rounds of twenty alternated, a second copy of the
build before for the noise (medians, ms; load 4–7):

| shape       | build          | main-thread CPU | style recalc | script |
| ----------- | -------------- | --------------- | ------------ | ------ |
| prose (300) | before         | 68.7            | 23.2         | 37.2   |
| prose (300) | before #2      | 68.6            | 23.5         | 38.0   |
| prose (300) | anchors scoped | 64.6            | 19.8         | 36.2   |
| prose (300) | both           | 61.7            | 17.3         | 36.1   |
| boxes (300) | before         | 30.5            | 5.8          | 17.9   |
| boxes (300) | before #2      | 31.4            | 6.0          | 18.2   |
| boxes (300) | anchors scoped | 29.0            | 4.4          | 17.7   |
| boxes (300) | both           | 28.2            | 3.8          | 17.7   |

A hover onto another link of a prose page whose links take a
`hover:bg-*` (eight rounds of twenty moves): CPU 75.7 and 76.4 → 69.1
ms, style recalc 23.9 and 23.9 → 18.0.

`pnpm bench`, four rounds alternated, medians of the rounds and their
range (load 5; no second copy for the noise, the ranges the only
gauge):

| shape        | build  | interactive     | style recalc     |
| ------------ | ------ | --------------- | ---------------- |
| prose (300)  | before | 197.5 (197–199) | 66.1 (65.9–67.2) |
| prose (300)  | after  | 184 (182–185)   | 52.9 (52.5–53.4) |
| boxes (300)  | before | 175 (174–175)   | 29.2 (29.1–29.4) |
| boxes (300)  | after  | 173.5 (170–176) | 25.2 (25.0–25.5) |
| blocks (300) | before | 238.5 (222–247) | 36.5 (36.3–36.6) |
| blocks (300) | after  | 227.5 (216–242) | 34.1 (33.9–34.7) |

The three rounds above together, page loads against the tree before
them, eight rounds alternated with a second copy of it (medians, ms;
CPU through ready + 1 s):

| shape       | build     | interactive | CPU   | style recalc |
| ----------- | --------- | ----------- | ----- | ------------ |
| prose (300) | before    | 300         | 316.2 | 119.5        |
| prose (300) | before #2 | 302         | 317.3 | 120.3        |
| prose (300) | after     | 183         | 175.6 | 52.7         |
| boxes (300) | before    | 221         | 232.9 | 46.9         |
| boxes (300) | before #2 | 220         | 231.3 | 46.7         |
| boxes (300) | after     | 170         | 176.3 | 25.0         |

### One opacity model (2026-09-23)

The engine blends every translucent color and every faded group into
the cells (specs/cell-model.md "Opacity and translucency") where spans
carried `opacity`. Before is the tree just before it; before #2 a
second copy of that bundle for the noise.

`pnpm bench`, four rounds of five runs alternated, medians of the
rounds and their range (load 5.4–6.2; blocks at the default 300 rows):

| shape        | build     | interactive     | style recalc     |
| ------------ | --------- | --------------- | ---------------- |
| boxes (300)  | before    | 173.5 (169–175) | 25.5 (25.2–26.0) |
| boxes (300)  | before #2 | 169.5 (169–170) | 25.0 (24.9–25.1) |
| boxes (300)  | after     | 169 (167–169)   | 25.2 (25.0–25.3) |
| blocks (300) | before    | 217 (215–236)   | 34.0 (33.7–34.2) |
| blocks (300) | before #2 | 216 (215–239)   | 34.0 (33.9–34.1) |
| blocks (300) | after     | 214.5 (213–233) | 34.0 (33.9–34.3) |
| prose (300)  | before    | 183 (182–187)   | 52.6 (52.4–52.9) |
| prose (300)  | before #2 | 183 (182–184)   | 52.7 (52.2–53.0) |
| prose (300)  | after     | 180.5 (180–181) | 52.9 (51.7–53.1) |
| faded (300)  | before    | 192.5 (192–193) | 27.7 (27.6–27.9) |
| faded (300)  | before #2 | 193 (193–193)   | 27.9 (27.7–28.1) |
| faded (300)  | after     | 188 (188–190)   | 27.7 (27.4–27.8) |

Blocks' runs land on two frames, about 214 and 235 ms, in every build;
an earlier sitting, before the store's rows were copied from a blank
one and the fast path asked each paint's opacity once, put after's
median on the later frame (233 against 215 and 218). The paint alone,
in Node on the same shapes (median of nine rounds of forty paints):
blocks 6.52 → 2.53 ms, the store's rows no longer built cell by cell;
faded 3.79 → 3.80 ms, groups recorded and blended at no extra cost
once a run of one paint asks its opacity once (4.08 without that, 6.45
with the old row building).

A fade frame costs the browser more. Twenty opacity steps on the faded
boxes, a relayout each, ten rounds alternated (per relayout, medians):

| build     | main-thread CPU | style recalc | script |
| --------- | --------------- | ------------ | ------ |
| before    | 173.4           | 65.4         | 75.2   |
| before #2 | 173.1           | 64.8         | 75.6   |
| after     | 181.1           | 61.2         | 66.8   |

The engine's own work drops, and the browser's paint grows: a trace of
ten steps gives main-thread `Paint` 2.1 → 19.0 ms a step, raster 51.5
→ 45.6. A span's `opacity` changes a property of the paint, while a
blended color changes the span, so every faded span is recorded
again. The plan's lever (Decisions 5: an element animating its opacity
a layer root while it animates, the frame a box copy) would take a
sampled fade below both; it is not taken, the layer's other behaviors
being the reason it is not the default. A fade repaints instead of
relaying out ("Opacity transitions repaint").

Trimmed the same day (the plan's "Follow-ups"), its output unchanged
on 5,000 fuzzed trees: the paint in Node faded 3.76 against 3.86 and a
second copy's 3.79 ms, blocks 2.47 against 2.51 / 2.52; page loads
level. The store's rows stay a loop of copies: built with `Array.from`
they cost 0.2 ms of the faded paint. Resetting `--mw-ipl`/`--mw-ipr`
on every light element (the inline padding's own element alone), four
rounds alternated with a second copy of the build before: style
recalc prose 53.2 / 52.7 → 53.0 ms, boxes 25.1 / 25.1 → 25.2;
interactive level. Resetting every variable a rule can read on an
element that didn't write it (cell-model.md "Engine variables",
2026-09-24: ten, `--mw-z`, the inline insets and `--mw-vb` joining
the four), two rounds of seven runs alternated with the four resets:
style recalc prose 53.2 / 52.4 → 54.5 / 54.5 ms, boxes 25.8 / 25.4 →
25.8 / 25.6; interactive 185 / 182 → 186 / 184 ms prose, 174 / 173 →
172 / 173 boxes. Resetting all 21 variables render.ts may remove cost
prose about 2 ms more, for resets no rule can read.

### Against v0.3.2 (2026-09-24)

`main` here is the uncommitted tree on `51809d9` (v0.3.2's commit) as
this section was written: the removal pass, levers 1–3 ("One load
layout", "Settling only what transitions", "Two style rules Chromium
could not cache") and the one opacity model. Against v0.3.2's build
with a second copy of it as the noise control (within 2% of the first
throughout); 8 rounds alternated, medians, ms. "Where it stands"
supersedes it:

| page                    | v0.3.2 | main (uncommitted) |
| ----------------------- | ------ | ------------------ |
| prose 300, interactive  | 314    | 192                |
| boxes 300, interactive  | 238    | 178                |
| blocks 40, interactive  | 87     | 82                 |
| prose 300, per relayout | 85.2   | 59.6               |
| boxes 300, per relayout | 36.6   | 29.6               |
| prose 300, per hover    | 93.9   | 67.9               |
| boxes 300, per hover    | 56.8   | 49.6               |

Style recalc halves on every page (prose relayout 37.3 → 17.7); script
drops on loads (one layout) and barely per relayout, where the reads
remain.

### Opacity transitions repaint (2026-09-24)

An opacity transition relaid out every frame; it now takes its
keyframe animation's path (specs/animations.md): a repaint of the
last layout at the frame's opacity, a layer root's a box copy, one
layout at its end. With 150 elements fading, the tick's per-element
`getAnimations()` was 41% of a frame (Chromium scans the document's
animations for each call), so the tick asks the host once, with
`subtree: true`.

A real transition on the faded shape: a 2 s linear fade of the 150
boxes, ten rounds alternated, medians (load 5.5–7; no second copy for
the noise); `Paint` from a trace of two fades. The builds are v0.3.2
(span `opacity`), the one opacity model with a fade relaying out every frame, and the same
with a fade repainting:

| build                   | middle frames | middle layouts | CPU a frame | style | script | whole fade: frames, layouts | `Paint` a frame |
| ----------------------- | ------------- | -------------- | ----------- | ----- | ------ | --------------------------- | --------------- |
| v0.3.2                  | 9             | 9              | 145.2       | 51.0  | 81.2   | 20, 17                      | 2.1             |
| blended, fades relayout | 9             | 9              | 139.7       | 40.4  | 73.2   | 21, 18                      | 17.0            |
| blended, fades repaint  | 24            | 0              | 52.1        | 14.6  | 19.4   | 46, 2                       | 17.9            |

The middle columns count the frames and layouts from 0.4 s to 1.6 s
into the fade, where neither the class change's layout nor the
landing falls, and their CPU, style, and script are per frame of that
window; the whole fade counts from the opacity's change to three
frames past the last box's `transitionend`, landing included.

The fade's main thread is saturated in every build (2.2–2.3 s of CPU
for the 2 s fade); the repainting build spends it on two and a half
times the frames. The browser's `Paint` stays where the one opacity
model put it: a recolored span is recorded again. Page loads are
level (`pnpm bench`, medians of the rounds' interactive time, load
5.5–7.8):

| shape       | blended, fades relayout | the same, a second copy | blended, fades repaint |
| ----------- | ----------------------- | ----------------------- | ---------------------- |
| boxes (300) | 179.5 (4 rounds)        | 180 (4)                 | 180.5 (4)              |
| faded (300) | 203 (4)                 | 200.5 (4)               | 196 (4)                |
| prose (300) | 191.5 (8)               | 197 (8)                 | 191.5 (8)              |

The repainting build's style recalc lies within 0.4 ms of the first
build's in every shape.

### The host's fades, and one layout a frame (2026-09-24)

The host's own opacity and border-color transitions relaid out every
frame, though the engine reads neither: the grid fades with the host
natively. They are the browser's now, as the host's own animation is.
And a frame whose sampling tick relaid out while a layout was
scheduled for it — a DOM change between frames, or in a frame callback
ahead of the tick — laid out twice; whichever runs first now serves
the other. The prose shape (300 paragraphs), Chromium, over 1.1 s,
medians of six rounds alternated (load 8; no second copy for the
noise):

| transition                                   | build  | frames | layouts | laid out twice | CPU a frame |
| -------------------------------------------- | ------ | ------ | ------- | -------------- | ----------- |
| the host's 1 s opacity fade                  | before | 17     | 16      | 0              | 66.2        |
| the host's 1 s opacity fade                  | after  | 61     | 1       | 0              | 2.5         |
| a 1 s color change, a span's text every 4 ms | before | 12     | 16      | 5              | 92.7        |
| a 1 s color change, a span's text every 4 ms | after  | 17     | 15      | 0              | 65.5        |

The host fade's one layout is its class change's. Page loads are level
(`pnpm bench --shape prose`, eight rounds alternated, medians,
load 7–9): interactive 198.5 → 200 ms, style recalc 55.7 → 55.6.

### One animation query a layout (2026-09-24)

The reads asked each element with an `animation-name` or a
`transition-duration` for its own `getAnimations()`, up to three times
(the layer read, twice, and the background tracker), each call
scanning the document's animations. A layout now asks the host once,
before its mask, which also finds the fades the visibility hold
needs, and hands its reads the answer (specs/animations.md
"Reading"). The tick classifies every running transition from its
own query as well, so an element removed mid-transition, whose cancel
never reaches the host, stops the relayouts at once. Per relayout,
Chromium, ten rounds alternated, medians (ms CPU): 300 bordered boxes
with `transition-colors`, every thirtieth pulsing, 72.6 → 69.8;
prose 62.8 → 61.3, boxes 29.6 → 29.5, a prose hover 67.0 → 66.7.
Loads are level (`pnpm bench`, two rounds of five each alternated):
prose 185/185 → 183/184 ms, boxes 172/172 → 174/174.

### Landings in the loop, the frames' query, the tokens first (2026-09-25)

An effect's, an opacity's or a border color's transition laid out at
its end or cancel: four transitions staggered to end apart laid out
five times from the class change to past the last end, against three
with the frame after an end repainting or placing its box (the
change's layout, the one opening the layers, the loop's last;
specs/animations.md).
The frames read the last query's animations, which Gecko answers by
walking the host's every node: with `animate-spin` beside 300 prose
paragraphs, the engine's frame in Firefox was 0.193 ms at v0.3.2,
0.250 with a query a frame (0.075 of it the query), and 0.198 reading
the last one;
Chromium 0.157, 0.140, 0.146. And the host's tokens are written before
the elements' flags, one style recalc where they change: a relayout
that changes the host's `color` on the prose shape (Chromium, twelve
rounds of twenty, medians, ms CPU) 119.7 → 110.7, style 69.7 → 61.7;
one that changes an attribute (the tokens unchanged) prose 64.9 →
65.1, boxes 27.9 → 27.2. Loads are level (`pnpm bench`, two rounds of
five alternated): prose 184/186 → 182/183 ms, boxes 170/169 →
171/170.

### Shades drawn once (2026-09-25)

A shade's box draws its lattice in its two pseudo-elements, each
clipped to the strip it fills (wide-characters.md "A shade keeps its
lattice"). The blocks page, 300 rows of 40, half of them shades,
holds 6,000 shade boxes, one a cell, and 12,000 copies.

Chromium's matched-properties cache takes no style that reads `attr()`
(`MatchedPropertiesCache::IsStyleCacheable`), so copies whose
`content` read the glyph from `data-shade` were each resolved in full,
every `var()` of their position substituted and parsed anew: the clip
cost style recalc 35.5 → 40.2 ms there. In a three-round sitting of
its own (before 35.6, `attr()` 39.9 ms), the `attr()` build with the
copies' positions fixed read 33.3 ms. Spelled out, one rule a shade,
the glyph leaves the copies' style to the cache: 25.7 ms, and 25.8
with the positions fixed, the `var()`s costing nothing once cached.

`pnpm bench`, six rounds of five runs alternated, a second copy of
v0.3.2's build for the noise (medians of the rounds and their range;
load 7–9). Before is the tree before the clip, `attr()` the clip with
the glyph read from its attribute, literal the clip as it is:

| blocks (300) | interactive     | style recalc     | layout           |
| ------------ | --------------- | ---------------- | ---------------- |
| v0.3.2       | 311 (296–320)   | 41.2 (40.2–42.2) | 55.5 (53.6–57.5) |
| v0.3.2 #2    | 317.5 (313–329) | 41.8 (41.3–42.5) | 57.4 (56.4–58.5) |
| before       | 253.5 (221–259) | 35.5 (34.4–36.2) | 52.1 (51.1–53.9) |
| `attr()`     | 247.5 (234–254) | 40.2 (39.0–40.5) | 55.0 (51.2–58.6) |
| literal      | 233.5 (230–236) | 26.3 (25.7–26.7) | 52.3 (51.8–52.9) |

The shapes without a shade read level across the three builds of the
tree (interactive within 1.5 ms, style recalc within 0.6) and against
v0.3.2 (literal): boxes 233.5 → 181.5 ms, style 49.9 → 26.8; prose
317.5 → 194.5, style 128.4 → 55.9; faded 274.5 → 204, style 55.0 →
29.1.

### A group over nothing on its spans (2026-09-25)

A faded group's cells with nothing opaque beneath keep its own colors
and carry its opacity on their spans, where they were blended over the
ground (specs/cell-model.md "Opacity and translucency"), and a fade's
frame writes a span whose opacity alone changed with that one property
(`paintRows`). Before is the tree just before; control a second copy of
its bundle.

The fade harness: a 2 s opacity transition on every other of 300
boxes, ten rounds alternated, medians per frame of the fade's middle
1.2 s (ms, main-thread CPU; the browser's `Paint` from a trace of two
fades). Over slate is the faded shape; over nothing, the host carries
the slate and the boxes' container no fill (load 8–11):

| page         | build   | frames | CPU  | style | script | `Paint` |
| ------------ | ------- | ------ | ---- | ----- | ------ | ------- |
| over slate   | before  | 24     | 52.3 | 14.9  | 19.9   | 17.0    |
| over slate   | after   | 25     | 50.7 | 13.9  | 19.2   | 17.5    |
| over slate   | control | 24     | 51.8 | 14.3  | 19.6   | 17.5    |
| over nothing | before  | 25     | 50.0 | 14.7  | 17.6   | 17.2    |
| over nothing | after   | 36     | 34.6 | 11.5  | 10.1   | 7.8     |
| over nothing | control | 26     | 48.4 | 14.2  | 17.0   | 16.8    |

Against v0.3.2's build, eight rounds: over slate 127.0 ms a frame
(10 frames, a relayout each) against 49.6 (25), over nothing 125.9
(10) against 33.1 (37); the browser's `Paint` 2.0 against 17.0 and
7.4. Without the one-property patch the fade over nothing was level
in CPU (49.9 against 50.3), its `Paint` already 8.0 against 18.0, and
the engine's script 4 ms up: every span rewritten each frame, where
blended colors rounding alike across frames had skipped some.

The paint alone in Node (median of eleven rounds of forty paints; before,
after, control): faded 3.87, 3.75, 3.87 ms; the same over a
translucent card and no slate 3.56, 3.60, 3.62; over nothing at all
2.72, 2.76, 2.72; blocks 2.56, 2.55, 2.56. The translucent card's one
color at the alpha the two reach cost 40% until `withAlpha` was
memoized (4.92 against 3.47), and closing a group by copying each
cell's paint with its opacity 11% (4.30 against 3.87), so a group's
alpha rides the put. Page loads (`pnpm bench`, four rounds of five
alternated, ten for faded; medians, load 6–8): faded 192 → 193
(control 191.5), prose 186 → 186 (185.5), boxes 174 → 176 (175),
blocks 213 → 214.5 (215.5); style recalc level. Grid spans on the
fade page over nothing: 8,139 → 8,091, 3,992 of them with an opacity.

### Stacking contexts (2026-09-27)

Every box painting in its nearest stacking context, the in-flow
phases, the containing-block chain and inline members
(`../plans/2026-09-27-stacking-contexts.md`). Before is a copy of the
tree taken before the first edit, noise a second copy of its bundle;
the three alternated in every measure. Load: four rounds of five
runs, the median of the 20 and their range. Relayout, hover and
scroll: CPU per step, the median of 10–12 rounds, taken twice with the
tabs' order reversed (the first tab ran about 2 ms slow whichever
bundle it held) and the two averaged.

| measure (ms)                | before        | noise         | after         |
| --------------------------- | ------------- | ------------- | ------------- |
| boxes 300 load, interactive | 171 (169–190) | 173 (169–191) | 173 (165–190) |
| blocks 40 load, interactive | 81 (79–101)   | 82 (79–97)    | 81 (79–97)    |
| prose 300 load, interactive | 180 (178–198) | 181 (178–196) | 181 (177–201) |
| faded 300 load, interactive | 190 (188–207) | 191 (188–205) | 192 (189–204) |
| positioned 300 load         | 171 (168–187) | 171 (167–184) | 173 (169–191) |
| boxes relayout, CPU         | 27.0          | 27.1          | 27.2          |
| prose relayout, CPU         | 58.8          | 58.7          | 58.7          |
| positioned relayout, CPU    | 52.0          | 52.0          | 52.8          |
| boxes hover step, CPU       | 47.9          | 47.2          | 48.2          |
| prose hover step, CPU       | 67.2          | 66.4          | 65.4          |
| positioned hover step, CPU  | 55.1          | 54.9          | 55.8          |
| positioned scroll step, CPU | 21.5          | 21.5          | 21.6          |
| Node paint, faded           | 3.75          | 3.74          | 3.80          |
| Node paint, blocks          | 2.53          | 2.54          | 2.54          |
| Node paint, faded bare      | 3.54          | 3.55          | 3.56          |

(Node paint: `renderGridRows` alone, the median of 21 rounds of forty
paints.) Every existing shape is within the noise. The faded paint's
0.05 ms is the traversal's 0.01–0.03 ms (a CPU profile: the phases'
walks and the members' records) and variance in code the change did
not touch. `positioned` is new: its relayout and hover pay about 0.8
ms for 600 members and their order, recorded.

Three causes were traced and fixed on the way (the same measures,
before these fixes):

- **The hit's text entries.** A leaf's glyph entry walked its lines
  (`charIndexAtCell`) for every entry the reverse scan passed: prose
  hover +5.7 ms of script. It now tries the leaf's hit rect first.
- **The ink extent's lists.** `contentExtent` gave every child a list
  for the absolute boxes escaping it: positioned relayout +2.6 ms, now
  one list a walk.
- **Reading effects on inline elements.** Seven computed properties
  for each of prose's 2100 inline elements cost 1.3 ms of a 47 ms
  relayout's JS (2.8%, three alternated CPU profiles each; a build
  without them matched before within 0.1 ms). The grid draws none of
  those effects on an inline element, so it reads none of them
  (positioning.md deviation 6). Reading every element's unset
  background without a color parse, and an inline element's font size
  only where its letter spacing needs it, took back another 0.5 ms.

Size, built at each step (`gzip -9` of `dist/cdn.js`; `dist/index.js`
minified by esbuild, then `gzip -9`; core `src/*.ts` and `*.css`,
code lines without blank lines and comments):

| after      | cdn.js | index.js | src lines | code lines |
| ---------- | ------ | -------- | --------- | ---------- |
| before     | 157466 | 86790    | 23462     | 16847      |
| 1 the read | 157731 | 87072    | 23509     | 16883      |
| 2 order    | 157731 | 87072    | 23737     | 17048      |
| 3 paint    | 158506 | 87762    | 23802     | 17103      |
| 4 hit      | 158558 | 87823    | 23766     | 17082      |
| 5 lattice  | 158498 | 87736    | 23740     | 17064      |
| 6 chain    | 158818 | 88047    | 23831     | 17132      |
| 7 inline   | 159427 | 88682    | 23985     | 17252      |
| 8 bench    | 159459 | 88714    | 23986     | 17252      |
| review     | 159164 | 88415    | 23909     | 17174      |
| final      | 159671 | 88945    | 24051     | 17287      |

Step 2's module ships from step 3, its first consumer; step 9 is docs
alone. "Final" is the commit's tree: the second review, the last pass
("The hit and the paint, leaner") and the batch's other fixes (the
decoration lines, inline lengths without Typed OM, `justify-content`
off the inline axis). In all, cdn.js grows 2,205 bytes (1.4%),
index.js 2,155 (2.5%), the source 589 lines, 440 of them code.

**The review pass** (the plan's Done notes), against the batch as it
landed, alternated the same way. "Spread" is the gap between two
copies of one bundle in the same run: the batch's for the hover rows
and the positioned relayout, which put the batch and the review at
the ends and the copy between them, the bundle before the batch's for
the rest.

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

All within the noise. In Node, alone and over 100 alternated rounds:
`placePainted` 30% faster on the positioned shape (no frame for a
leaf), the paint index's build 25–40% (spans for layer roots alone),
a hit on boxes 20% (one scan), level on the positioned shape; its
paint level with a copy of the batch. Two first cuts moved the
positioned paint and were redone: the clipped puts keyed by walk then
clip (+8%, now one lookup) and a lattice walk before every paint (+2%,
now only where a table paints).

**The ink extent under clipping boxes**, found by a second review
where no bench shape looks: `contentExtent` had lost its stop at a box
clipping both axes, so a scroller's range walked every subtree under
every `overflow-hidden` box in it. `layoutRoot` in Node, the mean of
four alternated runs of 40-round medians (ms):

| shape                                     | v0.3.3 | batch | now  |
| ----------------------------------------- | ------ | ----- | ---- |
| 150 `overflow-hidden` cards in a scroller | 19.2   | 25.5  | 19.7 |
| `positioned` shape                        | 4.03   | 4.31  | 4.04 |
| every card crossed by an absolute menu    | 21.3   | 28.1  | 23.8 |

It looks inside such a box now only where an absolute box crossed it
on the way to its containing block (`crossed`, positioning.ts).

### The hit and the paint, leaner (2026-09-27)

The hit scanned the paint index testing each entry through a new
`hitRect` object, and a leaf's glyph entries through an `inlineShift`
object and its owners' array; the paint and every glyph hit wrapped
each leaf's text again, though its layout had wrapped it; and the
walks up an inline element's ancestors, and the lookups of a
character's element, read `entries[-1]` at the leaf's own text, a
slow lookup in V8. Now the hit tests an entry's rect first, without
allocating; a leaf keeps the lines its layout wrapped (`lines`) and
its glyph owners (`inlineOwners`, at build); and the walks stop at -1.

Node, the median of 15 alternated rounds; node trees in plain Node,
prose (200 paragraphs, each span nesting two elements) in happy-dom:

| shape                 | hit, µs: v0.3.3 / batch / now | paint, ms: v0.3.3 / batch / now |
| --------------------- | ----------------------------- | ------------------------------- |
| 300 boxes             | 3.1 / 7.8 / 3.4               | 1.10 / 1.13 / 1.05              |
| 400 positioned cards  | 53.6 / 92.4 / 34.9            | 2.06 / 2.38 / 2.14              |
| 150 paragraphs        | 2.0 / 6.8 / 1.8               | 1.53 / 1.59 / 1.10              |
| prose                 | 17.7 / 28.4 / 3.6             | 4.01 / 3.71 / 2.39              |
| prose, a faded span   | 17.2 / 71.3 / 16.3            | 4.08 / 5.03 / 2.95              |
| prose, a shifted span | 17.7 / 74.6 / 18.2            | 4.30 / 5.29 / 2.94              |

A hit right after a placement, as a scroll repaint's is, costs what
the others do. The shifted span's hit tests three entries a paragraph
where v0.3.3 tested one box, a glyph taking the cell where it paints.
The placement of 300 boxes costs 14 µs where v0.3.3's cost 10, each
box's clip and scroll chain, and 97 against 101 µs for the cards.
Every paint, placement and hit read the same as the batch's over
1,000 DOM and 3,000 node trees.

Tried and left: the entries' rects taken once a placement (a hit
after a scroll paid 19–160 µs to take them), frames shared down the
placement until a box changes one (16 µs, slower), one shift object
reused by the scan (0.7 µs of the shifted span's 18), and each glyph
turn walking its leaf again in place of the held glyphs (the faded
paint 20% slower).

### The deviation batch (2026-09-28)

The css-deviations plan's items against the last commit (2110a55),
every bundle's page open at once in Chromium, alternated rounds, two
sittings. Time to interactive (`pnpm bench`, the median of 7 runs,
each bundle run twice):

| shape      | last commit, ms | now, ms  |
| ---------- | --------------- | -------- |
| boxes      | 174, 189        | 173, 173 |
| blocks     | 227, 224        | 230, 231 |
| prose      | 193, 180        | 181, 180 |
| faded      | 191, 190        | 192, 200 |
| positioned | 171, 172        | 175, 175 |

Per relayout (20 a round, 12 rounds) and per hover step (20 a round,
8 rounds), CPU, the median of rounds, the last commit's two bundles
averaged:

| measure                         | last commit, ms | now, ms    |
| ------------------------------- | --------------- | ---------- |
| prose relayout                  | 54.7, 54.5      | 54.2, 53.7 |
| clipped relayout                | 26.6, 26.8      | 26.8, 26.6 |
| positioned relayout             | 59.6, 52.2      | 59.2, 52.8 |
| boxes relayout                  | 26.5, 27.3      | 26.4, 27.6 |
| prose hover, link to link       | 63.1, 66.5      | 63.7, 66.3 |
| prose hover, across plain spans | 33.6, 32.0      | 33.0, 31.7 |

A clipped relayout's style and layout take 0.2 ms more (its script
none): the clip lock, off while the engine reads so the read tells
`hidden` from `clip`, makes each of its 300 `overflow-hidden` boxes a
scroll container and back per read — the price of reading them apart,
and of the lock lifting once the author's overflow goes. Hovering
across plain spans cost 60 ms a step while every inline element joined
the hover chain, each span edge a chain change and so a layout; an
inline element now joins only where its hover can restyle something.
The bundle is 573.2 KB (169.1 KB gzipped), 13.8 KB (6.3 KB) more,
+2.5% (+3.9%). Taken back in review: 1.5–2 ms of a positioned
relayout (a scroller's vars and `scroll-padding` read and written on
scrollers alone, values read twice read once), the white-space var
written on every box (now only inside a box that restores
white-space), justify's spread as arithmetic in place of a map a line,
a hit's character carried from the entry that takes the cell, the
table's baselines grouped in one pass, and a word's segments pushed
straight onto its line's units.

### List markers (2026-09-28)

The last commit's bundle against the working tree's, one sitting a
table, loads alternated (7–9 runs each, medians):

| shape                 | last commit, ms | now, ms       |
| --------------------- | --------------- | ------------- |
| boxes                 | 199, 195        | 200, 196      |
| blocks (40)           | 96, 96, 96      | 89, 93, 87    |
| prose                 | 202, 201, 208   | 204, 205, 203 |
| faded                 | 219, 221        | 220, 216      |
| positioned            | 179, 185        | 182, 178      |
| lists (300 + 60)      | 129, 125, 128   | 140, 137, 135 |
| 1,000 `list-none` lis | 203, 202        | 204, 203      |

A page without lists pays nothing: no item, no `::marker` read, no
walk; preflight's `list-none` items still read their `::marker` (a
`content` would draw), level. The list page's 10 ms are its markers:
the `::marker` reads, the counter walk's three properties an element,
the attachment and the paint, none past a millisecond in a profile.
A bullet first cost 6.4 ms more — `Intl.Segmenter`'s first use, for
`•` — until `graphemes` split the Latin and symbol blocks as it splits
ASCII (width.test.ts checks every code point against the segmenter),
which takes 3–9 ms off the blocks page too. The bundle is 590.2 KB
(176.1 KB gzipped), 16.3 KB (6.8 KB) more: the predefined counter
styles as data, the `@counter-style` reader and the walk.

### Generated content (2026-09-28)

The last commit's bundle against the working tree's: Chromium's own
script, task and style counters, medians of twelve alternated loads
each:

| page      | script, ms  | task, ms      | style, ms   |
| --------- | ----------- | ------------- | ----------- |
| one `<p>` | 10.9 → 11.6 | 51.9 → 52.8   | 1.1 → 1.2   |
| prose     | 74.5 → 75.6 | 193.8 → 195.3 | 56.3 → 56.7 |
| boxes     | 57.4 → 58.1 | 185.8 → 186.1 | 27.1 → 27.1 |
| lists     | 55.0 → 56.3 | 125.9 → 127.4 | 18.6 → 18.8 |
| labels    | 45.6 → 62.3 | 126.2 → 151.1 | 28.3 → 34.2 |

A relayout (twenty a round, eight rounds) of prose, boxes and lists
costs what the last commit's does, within noise: a CPU profile of
prose's gives 88.45 → 88.65 ms, the same `getComputedStyle` calls;
`labels`' script 17.3 → 26.4 ms. A page without generated content
pays about 1 ms a load, at its first layout: the one walk of the
page's sheets (about 0.4 ms, cached per sheet), now on every page
where lists took it only with a marker to number, and the new code's
first run; the bundle's 15.4 KB more (605.7 KB, 180.3 KB gzipped)
loads within noise. `labels`
draws what the last commit left out: a pseudo-element read an item,
the walk, and a run entry each. The rounds found the walk running
once a run, not once a build (639 ms on `labels`); a `q` walking every
element's counters; a leaf's positioned child built twice; a
pseudo-element or marker read twice; and trimmed the rest: a selector
read only from a rule that sets `content` or nests others, the
engine's own spacer rule out of the scan, no DOM read per character
in the source map's compaction; and a pseudo-element's light DOM
written as its own variables for its own compact rules, not renamed
onto every element rule and mapped back — half the CSS, whose parse
had cost every load about 1 ms, and 2 ms a relayout of `labels`.

### 0.3.4, leaner (2026-09-29)

The CDN bundle (`dist/cdn.js`) at each commit since v0.3.3, raw and
gzipped, in KB; Tailwind's in-browser compiler, about 250 KB of it, is
the same throughout:

| commit                        | raw   | gzip  |
| ----------------------------- | ----- | ----- |
| v0.3.3                        | 546.6 | 157.4 |
| stacking contexts             | +6.3  | +2.2  |
| glyph properties, field drags | +1.2  | +0.6  |
| `text-transform`              | +1.5  | +0.7  |
| `aspect-ratio`                | +2.1  | +0.7  |
| the host's own height         | +0.2  | +0.1  |
| anchor positioning            | +1.4  | +0.6  |
| the deviation batch           | +13.8 | +6.3  |
| hidden content, button inputs | +0.7  | +0.2  |
| list markers and counters     | +16.5 | +6.8  |
| generated content             | +15.4 | +4.6  |
| this commit                   | −5.6  | −0.3  |
| 0.3.4                         | 600.1 | 180.0 |

This commit changes no behavior but the leaded atomic inline box's
native lift: the inlined stylesheets' white space trimmed at build
(`scripts/vite-css.mjs`, 4.7 KB raw, 0.4 KB gzipped — white space
compresses well); the predefined counter styles built from code points;
a pointer move's hover chain derived from its chain, not walked again;
the paint index resolved once a point, not once a layer; per-layout
allocations gone from the positioning walk and the anchor records; and
duplicated helpers merged (a junction glyph's mixed arms, the bounded
caches, the selector split).

And the reads the range added, which had put the boxes relayout 2.4–3.2
ms (9–11%) behind v0.3.3: 5,400 more `getPropertyValue` calls a
relayout (six glyph properties on every element, eight stacking
properties and `anchor-scope` on every box, the features' own), and
the host's height read before the reads. Cut: a scan for viewport
utilities that built two regular expressions per call, several times
per element, now one cheap test and each expression built once;
a scroller's bar variables read where an axis scrolls, and a
container's gap-rule settings where it lays out gaps; and `setVar`
comparing against the engine's own last write to an element, not
reading its inline style back — about 9,000 reads a relayout of the
boxes page — a page's own `style` write or an element taken out
forgetting it (cell-model.md "Engine variables"). Relayouts against
v0.3.3, pairwise, both tab orders (task, ms): boxes 30.65 / 28.05 →
29.54 / 27.98, prose 59.49 / 58.84 → 54.20 / 55.60, the prose relayout's
script 3.6 ms less; a CPU profile of the boxes relayout reads 39.65 →
38.99 ms, where it had read 1.7 ms over. Where the engine has made no
write, it writes without comparing, as a first layout does everywhere
(prose loads, six rounds alternated, medians: 186.5 ms comparing
against the style itself, 190.5 against the last write but reading the
style back before the first, 187 writing outright). The loads' rest,
the first paint's per-cell writes (clip, layer covers, group opacity)
the most of it, is "Where it stands". The host's height read before
the reads, 0.4–0.5 ms, stays: kept from the last layout, it goes stale
where the host's height follows what lies in it (`:has()`,
`:focus-within`), which only a read as the layout starts sees.

### Checkboxes and radios (2026-09-29)

v0.3.4's bundle, twice for the noise, against the working tree's: six
rounds of five loads alternated, medians, one sitting on a loaded
machine (load 10–35):

| page (300)                    | v0.3.4, ms | now, ms |
| ----------------------------- | ---------- | ------- |
| prose                         | 197, 198   | 196     |
| boxes                         | 177, 181   | 179     |
| blocks (40)                   | 83, 84     | 86      |
| faded                         | 205, 208   | 211     |
| positioned                    | 180, 180   | 185     |
| labeled checkboxes            | 215, 204   | 228     |
| prose relayout, CPU           | 57.5, 57.4 | 57.0    |
| boxes relayout, CPU           | 27.1, 27.3 | 27.4    |
| prose hover, CPU              | 65.9, 65.9 | 66.2    |
| 150 boxes fading, CPU a frame | 50.4, 50.2 | 49.0    |

A page without a control pays a `querySelectorAll` a layout; its
rounds overlap v0.3.4's copies' on every shape. The checkbox page
(`pnpm bench --shape checkboxes`) draws what v0.3.4 left blank: a
batched read of each control's appearance and transitions under its
flag, one forced style recalculation a layout, and a glyph leaf each.
The bundle is 603.3 KB (181.0 KB gzipped), 3.1 KB (0.9 KB) more.
