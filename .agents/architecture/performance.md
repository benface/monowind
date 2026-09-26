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
translucency").

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
Record what moves here.

## Where it stands (2026-09-24)

Every release since v0.3.0 against `main`, the uncommitted tree on
v0.3.2's commit (`51809d9`) with every round below. Chromium 153
headless, six rounds alternated, medians. The machine was loaded (8–19)
through the run, so the absolute numbers run high, but the builds
alternate; two copies of the `main` build agreed within about 2%. The
v0.3.0 and v0.3.1 bundles were built from their tags with the day's
`node_modules`.

| measure (ms)                         | v0.3.0 | v0.3.1 | v0.3.2 | main |
| ------------------------------------ | ------ | ------ | ------ | ---- |
| prose 300 load, interactive          | 346    | 348    | 339    | 203  |
| boxes 300 load, interactive          | 185    | 367    | 252    | 196  |
| blocks 40 load, interactive          | 151    | 129    | 101    | 98   |
| faded 300 load, interactive          | 275    | 377    | 264    | 191  |
| prose relayout, CPU                  | 102.2  | 103.7  | 96.9   | 68.8 |
| boxes relayout, CPU                  | 39.3   | 72.9   | 39.0   | 32.7 |
| prose hover step, CPU                | 106.2  | 108.7  | 103.1  | 72.5 |
| boxes hover step, CPU                | 52.4   | 95.7   | 62.8   | 55.5 |
| 2 s fade (150 boxes), CPU per frame  | 130.4  | 159.8  | 141.3  | 51.2 |
| 2 s fade, frames in its middle 1.2 s | 10     | 8      | 10     | 25   |

Boxes load and boxes hover remain slightly behind v0.3.0: the open
raster gap, 7,880 grid spans against 1,500 ("Against v0.3.0 and
v0.3.1"). The fade's total CPU is flat; `main` spends it on two and a
half times the frames.

## Against v0.3.0 and v0.3.1 (2026-09-21)

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

## Visibility and the anchor extras (2026-09-22)

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

## Pointer events and the hit through a layer (2026-09-23)

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

## The editables' negations (2026-09-23)

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

## The interactives as marks (2026-09-23)

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

## One load layout (2026-09-23)

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

## Settling only what transitions (2026-09-23)

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

## Two style rules Chromium could not cache (2026-09-23)

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

## One opacity model (2026-09-23)

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
relaying out (below).

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

## Shades drawn once (2026-09-25)

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

## A group over nothing on its spans (2026-09-25)

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

## Against v0.3.2 (2026-09-24)

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

## Tiling glyph boxes (2026-09-20 and 2026-09-21)

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

## What the last round bought (0195883, 2026-09-21)

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

## What a box is for, and what it costs to skip one

Four fifths of this page's spans are `─`, one box a cell. In the
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
