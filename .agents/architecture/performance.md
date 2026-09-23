# Performance

## The benchmark

`pnpm bench` (`scripts/bench.mjs`) times a page of 300 bordered boxes
— the shape that stresses the grid hardest, since every border cell is
a glyph the font may draw off its row
(`specs/wide-characters.md`). It reports the median of five runs of:

- **interactive** — navigation until the host sets `data-mw-ready`,
- **style recalc** and **layout** — Chromium's own counters,
- **grid spans** — what the shadow `#grid` holds.

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

## Where it stands

Taken together on one machine (Apple silicon, 2026-09-21). Two builds
of one commit taken minutes apart gave 323 ms and 327 ms, so read a
difference under about 5 ms as the harness talking.

`pnpm bench` — 300 bordered boxes, where every border cell is a stroke:

| build  | interactive | style    | layout  | grid spans |
| ------ | ----------- | -------- | ------- | ---------- |
| v0.3.0 | 166 ms      | 50.9 ms  | 9.8 ms  | 1500       |
| v0.3.1 | 338 ms      | 107.6 ms | 37.2 ms | 7880       |
| main   | 231 ms      | 58.3 ms  | 25.6 ms | 7880       |

(`main` has moved since: "Visibility and the anchor extras" below.
The blocks table below is the same sitting's.)

`pnpm bench --shape blocks --count 40` — rows of one block glyph each,
where a run shares a box:

| build  | interactive | style   | layout  | grid spans |
| ------ | ----------- | ------- | ------- | ---------- |
| v0.3.0 | 131 ms      | 35.5 ms | 15.1 ms | 1600       |
| v0.3.1 | 108 ms      | 22.8 ms | 13.0 ms | 781        |
| main   | 92 ms       | 11.1 ms | 11.2 ms | 781        |

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

**The open one: 166 ms against 231 ms on the strokes** (2026-09-21's
`main`; see "Visibility and the anchor extras" for where it moved). Six of the
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
runs a row, two rounds (load average about 2–4):

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
rounds (load 4–7):

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

## What the last round bought

None of these changed a pixel; the goldens this commit moves, it
moves for the fills/strokes split and the overhang.

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
them too.

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
