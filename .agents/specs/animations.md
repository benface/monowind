# Spec: animations — keyframes sampled like transitions

Status: **implemented** (2026-09-13; `animation.ts` classifies the
running animations and the transitions sampled as them, `element.ts`
runs the three paths, `style.ts` keeps an animating effect a layer
root). Transitions, the
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

What runs under the host is one query: the host's
`getAnimations({ subtree: true })` gives every running `CSSAnimation`,
with its keyframes' property names and its play state, and every
running `CSSTransition`, with its property — one call, where an
element's own scans the document's animations in Chromium, a pass
over many elements costing the square of their count. A layout pass
asks it once, before its mask, which keeps every animation the
reads take, and hands the reads each element's running properties: the
layer root it keeps (Locked decisions), and the synthesized
background fade a running background animation ends; a pass run inside
another's reads (another host's plain text a leaf renderer asks for)
hands the outer pass its own back. The frames of the sampling loop
read the last query's animations, each one's play state showing an
end, a pause, a cancel or a removal, and ask afresh after an
`animationstart`, an `animationiteration` or a `transitionrun`, which
bubble from the light elements to the host: Gecko walks every node of
the subtree for the query, where a play state costs nothing. A **sampled animation** is one whose keyframes touch a sampled
property: `color`, the `border-*-color` longhands, `opacity`,
`background-color`, or a layer effect (`transform`, `translate`,
`rotate`, `scale`, `filter`, `backdrop-filter`). Any other keyframe
property (geometry, decoration color) is sampled by the same loop,
through the relayout it drives.

## Locked decisions

- **An animation drives the sampling loop as a transition does.** An
  `animationstart` (or an `animationiteration`, for one resumed or
  begun before the host listened) whose target is the host's own light
  element starts the loop; so does a layout pass whose query finds
  anything running, the sure sighting of an animation resumed from a
  pause. Each tick asks what runs under the host (Reading) and picks
  each animated element's path from that, and an element leaves the
  set when nothing of its runs — an end, a cancel, a pause, a removal
  alike, a removed element's cancel reaching the host no more. The
  loop runs while anything sampled runs: an infinite animation keeps
  it going for as long as the element is on the page. What leaves the
  set lands in the next frame by the path that showed it — a repaint
  reads its paint-only values once more, a layer's box is placed every
  frame, and a frame after a relayout lays out once more — and the
  loop's last layout lands everything, a layer root back at a resting
  identity leaving the layers there; an end or cancel is no layout of
  its own. One with no loop running to land it, a resumed one-shot's
  that no event announced, lays out.
- **A transition of a property no other node inherits is sampled as
  its animation is.** A light element's own `opacity`, border-color,
  or layer-effect transition starts the loop at its `transitionrun`,
  takes the path the same keyframes would, and lands its value as the
  animation does. A transition on the host itself, other than
  `color`'s, is the browser's, as the host's own animation is: its
  opacity, border, and transform are native, the grid fading and
  moving with it, so nothing is sampled, its start and end included;
  the end of either reads the grid's place afresh, where a pointer
  held still now points.
  A `color` transition relays out each frame (cell-model.md
  "Animation"), the host's among them: its children and inline runs
  hold snapshots of what they inherited. A pseudo-element's opacity or
  border or text color relays out too: the one the engine draws,
  `::backdrop`, reaches the grid through its box, whose look a layout
  reads (top-layer.md), and neither a repaint nor a box placement
  reads a pseudo-element's style. One rule classifies them, for the
  events and the frames alike (animation.ts `transitionSampling`).
- **Each frame does the least that shows the value.** Per animated
  element, the keyframes' properties pick the path: effects alone,
  or with a layer root's opacity → the layer's box is placed again
  from the computed values, as a transition of them does; `color`,
  border colors, and `opacity`
  alone on a laid-out element → the node's style takes the computed
  values and the grid repaints from the last layout, with no measure
  and no layout — a `color` only on a leaf without inline elements,
  since what its children and inline runs inherited is a snapshot, a
  border color off a collapsed table, whose lattice took its colors at
  layout (its opacity repaints: the paint resolves the lattice and
  applies the opacity itself); anything else (a `background-color`, a `backdrop-filter`,
  which the companion locks on the light element, a geometry property,
  an inline element's color, a mix that includes one) → a relayout,
  which reads every animated value under `[measuring]` as the
  transition loop does. The three combine per frame: one relayout serves every
  element that needs one, and a layout scheduled for the same frame is
  that relayout (cell-model.md "Animation").
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
  border, a backdrop filter, a layer root's opacity, and a collapsed
  table part's opacity included; what runs under a host from one
  call — every element's keyframes and the transitions sampled as
  animations (opacity, border colors, effects), a color's and a
  pseudo-element's paint-only transition relaying out, the host's own
  others and its keyframes left to the browser; the read treating a
  running animation or transition of an effect as an effect from the
  pass's query, no element's own asked; the background tracker
  yielding to a background keyframe alone; the paint-style resample;
  the node index leaving an anonymous run to its element; a layout
  asking what runs once, the frames reading its answer until a start
  asks again, and a layout inside another's reads handing the outer
  one its answer back (element.test.ts); styles.css's mask keeping
  exactly the transitions a frame samples (cascade.test.ts).
- Storybook: `animate-spin` on a glyph — the layer's rotation changes
  across frames and the box never disappears at the identity;
  `animate-pulse` on a skeleton — the cells' shown colors change
  across frames with no layout between them; `animate-ping` — a scale
  and a fade on its box; `animate-bounce` — a translate per frame; an
  opacity transition, alone and beside a scale, with no layout between
  its frames and its cells landing at its end, and one beside a color
  change relaying out each frame; a one-shot
  `animate-in`-style keyframe (opacity and scale) landing exactly on
  its end state with a settle, and a `forwards` one holding its end;
  a background-color keyframe sampled through the relayout path with
  a `transition-colors` on the same element; a paused animation
  holding and turning again once resumed; a one-shot ending beside an
  infinite animation landing its value; a host's own animation left to
  the browser, and its own opacity, border-color and scale transitions
  with no layout from the class change's to past their end, its color
  relaying out each frame (host.stories.ts `Transitioned`); an element
  removed mid color transition leaving no layout after its removal's
  (`RemovedMidTransition`); transitions of effects and opacities
  staggered to end one after another, an ended fade's cells at its
  value from the frame after, with no layout at any end
  (`StaggeredTransitions`); the host's own transform ending, a pointer
  held still then over the cells moved under it (host.stories.ts
  `MovedHost`); a
  transform transition on an element already a layer root starting
  with no layout; a color transition beside DOM changes between
  frames and in a frame's callbacks laying out once a frame
  (`OneLayoutAFrame`).
- Visual: none — the story's infinite animations have no still state
  a golden could pin, so it opts out of the sweep (`!golden`).

## Touch points on implementation

- element.ts: the animation listeners (start and iteration as entries
  and a new query, an end with no loop running as a landing, the host's
  own as the grid moved), and the transition listeners (animation.ts
  `transitionSampling`), whose start starts the loop and asks a new
  query; the animated set, classified per tick from `#animations`, the
  last query's; the layout pass's one query, handed to its reads (the
  outer pass's handed back after) and starting the loop where anything
  runs; the tick's three paths (`syncLayers`, a repaint after a style
  resample of what repaints or just left, the relayout, one more after
  the last), skipped in a frame a scheduled layout ran
  (`#laidOutFrame`), and any layout cancelling a pending scheduled one
  (`#layoutRequest`).
- animation.ts: `transitionSampling`, the one rule for transitions;
  `runningUnder`, the query's classification, a removed element's
  animation left out; `readingAnimations`, returning the answer it
  replaces, and `animatedProperties`, the pass's answer to its reads;
  `EFFECTS` and `PAINT_ONLY`, which styles.css's mask lists;
  `animationPath`, a layer root's opacity on the box path.
- style.ts: `readLayer`, where a running animation or transition of a
  layer effect counts as an effect (`animatesEffect`); `readPaintStyle`,
  the paint-only values a frame reads onto an animated element's node
  before element.ts's `#resampleAndPaint` repaints the last layout.
- animate.ts `trackBackground`: a running `background-color` animation
  ends a synthesized fade and reads as it is.
- cell-model.md "Animation" and layers.md: both defer to this spec for
  keyframe sampling rather than listing it as a deviation.
