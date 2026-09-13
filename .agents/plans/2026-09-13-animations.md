# Animations implementation plan

Status: **implemented** (2026-09-13; every phase green). What shipped
differently: the classification lives in `animation.ts` with the node
index; the tick re-classifies every animated element per frame through
`getAnimations()`, which drops paused, finished, and cancelled ones;
`animationiteration` joins `animationstart` as an entry and every end
or cancel lands with a layout, since a resumed animation fires no
start (the reads' finds per layout cover it too); the tracker yields
to a running `background-color` animation alone, and a
`backdrop-filter` keyframe reads through the relayout; the valve
stays the transitions'. Spec: `animations.md` — normative;
`cell-model.md` "Animation" for the loop it joins and `layers.md`
"Animation is sampled" for the box copy; this plan only sequences
them.

## Shape

The transition loop already re-lays-out per frame; animations join
it through their own events and a per-element classification of
what each frame needs. Three things are new: the animated set and
its liveness (`getAnimations()`), the repaint path for live
paint-only properties, and the read treating a running effect
animation as an effect. The rest is the loop's existing branches.

## Phases (each ends green: `pnpm check` + the visual sweep)

### 0. Probe

A temporary `zz-probe` story, deleted after: a `[measuring]` toggle
mid-animation neither restarts nor skips it (the computed value keeps
advancing across a forced layout); a `background-color` keyframe reads
its animated value under `[measuring]` and the lock's transparent
outside it; `getAnimations()` keyframes name properties in camelCase
across the three engines; happy-dom has no `getAnimations`.

### 1. The animated set and the loop

- element.ts: an `animationstart` listener; an `#animated: Map<Element,
Path>` (the target's classification); the start classifies through
  `getAnimations()` and starts the loop; each tick re-classifies every
  element (dropping those with nothing running) and ends the loop when
  the set and the transition counters are empty, with the settle
  layout as today.
- The classification: `Path = "box" | "paint" | "layout"` from the
  union of the running animations' keyframe properties; a layout node
  is looked up per element on `#lastLayout` for the paint path (an
  element that is no node — an inline span — takes the layout path).
- Tests: `element.test.ts`-level or a small `animations.test.ts` with
  a stubbed `getAnimations` on happy-dom elements: the set's
  bookkeeping and the classification.

### 2. The repaint path

- element.ts: `#resampleAndPaint(elements)`: for each paint-path
  element, read `color`, the border colors, and `opacity` from
  computed style into its node's `CellStyle` (the fields the walk
  reads) and call `#paint(this.#lastLayout)` once; the `placed` memo
  keeps layer boxes untouched.
- Tests: a node test that a repaint after a style change on the node
  repaints the cells with the new opacity and color (paint.ts is
  unchanged; the test guards the field names the resample writes).

### 3. Layer roots while animating

- style.ts `readLayer`: with `animation-name` other than `none`, an
  animation whose keyframes touch a layer effect makes the element a
  layer root regardless of the computed value's identity.
- animate.ts `trackBackground`: an element with `animation-name`
  other than `none` gets no synthesized fade.
- Tests: the read with a stubbed `getAnimations`; the tracker with a
  running animation.

### 4. Stories, goldens, docs

- `effects.stories.ts`: an `Animations` story (spin, pulse, ping,
  bounce, an enter keyframe, a background keyframe) with plays
  sampling frames and counting layouts per path; the story opts out
  of the sweep (`!golden`): Playwright's disabled animations leave an
  infinite one at no fixed frame.
- cell-model.md "Animation" and layers.md deviation 10 updated; the
  README gains the utilities in its feature paragraph; the spec's
  status.
