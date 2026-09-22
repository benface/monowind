# Spec: animations — keyframes sampled like transitions

Status: **implemented** (2026-09-13; `animation.ts` classifies the
running animations, `element.ts` runs the three paths, `style.ts`
keeps an animating effect a layer root). Transitions, the
sampling loop, and the synthesized background fades live in
`cell-model.md` "Animation"; the layer's box and its per-frame copy in
`layers.md` "Animation is sampled".

## Motivation

`animate-spin` on a loading glyph, `animate-pulse` on a skeleton,
`animate-bounce` on a hint, and the `animate-in`/`animate-out`
keyframes the Tailwind animation plugins give menus and dialogs: CSS
animations are the other half of motion, and today the grid holds
whatever value the last layout read — a spinner frozen at an angle, a
skeleton stuck at one opacity, a dialog that appears at its end state.
The browser runs the animation on the invisible light element; the
engine has only to sample it, as it samples transitions.

## Reading

The measure pass reads, per element, only whether to ask: an
`animation-name` other than none, or a `transition-duration` other
than zero, has `getAnimations()` say what runs on the element, for
the layer root it keeps (Locked decisions). `animationstart` bubbles
from the light elements to the host; the target's `getAnimations()`
gives its running `CSSAnimation`s, each with its keyframes' property
names and its play state. A **sampled animation** is one whose keyframes touch a sampled
property: `color`, the `border-*-color` longhands, `opacity`,
`background-color`, or a layer effect (`transform`, `translate`,
`rotate`, `scale`, `filter`, `backdrop-filter`). Any other keyframe
property (geometry, decoration color) is sampled by the same loop,
through the relayout it drives.

## Locked decisions

- **An animation drives the sampling loop as a transition does.** An
  `animationstart` (or an `animationiteration`, for one resumed or
  begun before the host listened) whose target is the host's own light
  element adds it to the host's animated set and starts the loop; so
  does a measure pass that reads a running animation, the sure
  sighting of one resumed from a pause. Each tick asks the element's
  `getAnimations()` what still runs and re-picks its path from that,
  and the element leaves the set when nothing of its runs — an end, a
  cancel, a pause, a removal alike. The loop runs while the set has an
  element: an infinite animation keeps it going for as long as the
  element is on the page; the 30s valve is the transitions' alone. A
  settle layout follows the end, as for transitions, and every end or
  cancel lands its state with a layout of its own: the value it leaves
  beside an animation still running, or a resumed one-shot's the loop
  never followed, is that layout's to read.
- **Each frame does the least that shows the value.** Per animated
  element, the keyframes' properties pick the path: effects alone →
  the layer's box is placed again from the computed values, as a
  transition of them does; `color`, border colors, and `opacity`
  alone on a laid-out element → the node's style takes the computed
  values and the grid repaints from the last layout, with no measure
  and no layout — a `color` only on a leaf without inline elements,
  since what its children and inline runs inherited is a snapshot, a
  border color off a collapsed table, whose lattice took its colors at
  layout; anything else (a `background-color`, a `backdrop-filter`,
  which the companion locks on the light element, a geometry property,
  an inline element's color, a mix that includes one) → a relayout,
  which reads every animated value under `[measuring]` as the
  transition loop does. The three combine per frame: one relayout serves every
  element that needs one.
- **An element animating an effect is a layer root while it animates**,
  identity frames included, so `animate-spin` keeps its box through
  `rotate(0)` and a scale that passes through 1 stays a layer: the
  read treats a running animation of a layer effect as an effect, and
  a running transition of one the same, so the layout at a
  transition's start opens the layer on the identity a dialog leaves
  from. At its end the element returns to the grid like any resting
  identity.
- **The animated value is the browser's.** A read during an animation
  takes the computed value as it is: the synthesized background fade
  yields to a running animation of `background-color`, and no easing
  is re-derived — the browser's timing, direction, fill mode, delay,
  and iteration count are in the value.
- **Paused stays put.** `animation-play-state: paused` shows as a
  stopped play state: the element leaves the set and the loop ends
  when nothing else runs; the grid holds the paused frame. Resuming
  fires no event, so sampling resumes at the animation's next
  iteration, or at the next layout, whichever comes first.

## Deviations from CSS (summary)

1. An animation resumed from `paused` shows its frames again from its
   next iteration or the next layout; until then the grid holds the
   paused frame.
2. The transcript and the plain-text renderer see whatever value the
   last layout read, as for transitions: an animation has no place in
   a text snapshot.
3. A reduced-motion preference is the author's to honour in CSS
   (`motion-safe:`, `motion-reduce:`); the engine samples whatever the
   browser runs.

## Testing

- Node: the keyframe classification into the three paths, a lattice's
  border and a backdrop filter included; the read treating a running
  animation or transition of an effect as an effect through a stubbed
  `getAnimations`, and noting an animation's find for the host; the
  background tracker yielding to a background keyframe alone; the
  paint-style resample; the node index leaving an anonymous run to its
  element.
- Storybook: `animate-spin` on a glyph — the layer's rotation changes
  across frames and the box never disappears at the identity;
  `animate-pulse` on a skeleton — the cells' opacity changes across
  frames with no layout between them; `animate-ping` — both paths at
  once; `animate-bounce` — a translate per frame; a one-shot
  `animate-in`-style keyframe (opacity and scale) landing exactly on
  its end state with a settle, and a `forwards` one holding its end;
  a background-color keyframe sampled through the relayout path with
  a `transition-colors` on the same element; a paused animation
  holding and turning again once resumed; a one-shot ending beside an
  infinite animation landing its value; a host's own animation left to
  the browser.
- Visual: none — the story's infinite animations have no still state
  a golden could pin, so it opts out of the sweep (`!golden`).

## Touch points on implementation

- element.ts: the animation listeners (start and iteration as entries,
  end and cancel as landings); the animated set beside the transition
  counters, re-classified per tick and joined by the reads' finds per
  layout; the tick's three paths (`syncLayers`, a repaint after a style
  resample, the relayout).
- style.ts `readLayer`: a running animation or transition of a layer
  effect counts as an effect (`getAnimations()` on elements with an
  `animation-name` or a `transition-duration`).
- animate.ts `trackBackground`: a running `background-color` animation
  ends a synthesized fade and reads as it is.
- paint.ts / plain-text.ts: none (the repaint path writes
  `CellStyle.color`/`opacity`/`borderColor` on the node and calls
  `paintGrid` on the last layout).
- cell-model.md "Animation" and layers.md: both defer to this spec for
  keyframe sampling rather than listing it as a deviation.
