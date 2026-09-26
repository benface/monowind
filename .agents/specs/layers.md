# Spec: layers — transforms and filters

Status: **implemented** (2026-09-13; `plain-text.ts` opens a layer per
root, `paint.ts` gives it nodes and maps the pointer, `element.ts`
samples its transitions). Cell-unit
fundamentals live in `cell-model.md`; the paint walk and the grid in
`wide-characters.md` "The grid paints the selection"; opacity, a
layer root's on its box, in `cell-model.md` "Opacity and
translucency".

## Motivation

A dialog that scales in gently as it opens, a menu that slides, a
badge tilted a few degrees, a disabled panel greyed with `grayscale`
or softened with `blur`: `transform` and `filter` are how CSS says
these, and Tailwind ships them (`scale-*`, `rotate-*`, `translate-*`,
`blur-*`, `grayscale`, …). The grid can't take them as it is: every
glyph the engine paints lives in the shadow `<pre>`'s shared rows,
and the light element's own ink is transparent, so a transform or
filter on the element moves or tints nothing the viewer sees.

A layer gives such an element a `<pre>` of its own: its cells paint
there, the native transform or filter applies to that node, and the
browser does the rest — rotation, scale, skew, blur, at pixel
precision, as an escape hatch from the cell model where the author
asked for one. The layout stays on the grid: a transform never moves
a box's cells, as CSS never moves its layout.

## Reading

Read per element during the measure pass: `transform`, the individual
`translate`, `rotate`, and `scale`, `filter`, and `backdrop-filter` —
an element with any of them other than `none` (an identity — a unit
matrix, `scale: 1`, `rotate: 0deg`, `translate: 0px` — counts as
none, so a dialog resting at `scale-100` after its transition returns
to the grid) is a **layer root**; so is one whose effect is in
transition or animation, through the identity it leaves from or
passes (specs/animations.md). The `backdrop-filter` is kept
from this read: the companion locks it on the light element, whose
backdrop would take in the layer's own cells beneath it. The other
effects and `transform-origin` the layer's box copies from the
element's computed style once the light elements have settled after
a layout, when the origin's and translate's percentages resolve
against the element's final box; the companion locks none of them
(the leading lift rides in `top`). `perspective` is left to the
browser; a 3D `transform` or `rotate` is copied as computed and drawn
flat, the pointer mapping taking the rotate about z (Deviations).

## Locked decisions

- **A layer root's subtree paints into its own `<pre>`.** The paint
  walk, reaching a layer root, opens a layer: the root's own
  decorations and every descendant's cells go to the layer's grid
  instead of the main one, in the same paint order; the main grid
  gets nothing from the subtree, so the cells the subtree occupies
  show what the ancestors painted beneath (as CSS shows what is
  behind a transformed box). The layer is sized to the subtree's
  painted extent — the root's border box grown by whatever overflows
  it (shadows, visible overflow), within the grid — and positioned in
  the shadow viewport at that extent's origin, in cells. Its node is
  a box (`<div class="layer">`) holding the `<pre>`.
- **An ancestor's clip applies after the transform, as in CSS.** A
  layer under a clipping ancestor paints its cells unclipped and sits
  in a clipping box (`<div class="clip">`, `overflow: clip`) at the
  ancestors' clips intersected, so the browser clips the transformed
  result: a card scaled on hover in a scrolling list is cut at the
  list's edge, a drawer sliding in from an `overflow-hidden` shell's
  edge is hidden past it. A nested layer's box carries the clips
  between its root and the enclosing layer's root alone, in the
  enclosing layer's own space; the clips above are the enclosing
  layer's box's. The pointer and the glyph search stop at the clips;
  the transcript, with no transform to clip after, culls the layer's
  cells on their layout positions.
- **The native transform and filter go on the layer's box.** Once a
  layout settles, and each frame of a layer transition, the box takes
  the root's computed `transform`, `translate` (a percentage resolved
  against the border box, in px), `rotate`, `scale`, `filter`, and
  `backdrop-filter`, and a `transform-origin` moved by the extent's
  offset from the border box, so the layer transforms about the same
  point the light element does. The light element keeps its authored
  transform: it is invisible, but its native hit-testing follows the
  transform, so a button inside a scaled dialog is clickable where
  the layer shows it.
- **Layers stack in paint order and nest.** A layer's box is appended
  to the viewport's layer container in the order the walk opens it,
  above the main grid; a layer root inside another's subtree opens
  its layer inside the outer layer's box, so transforms compose as
  they do in CSS. `z-index` orders siblings through the same
  paint-order walk the grid already uses.
- **Later ink covers a layer.** A put painted after a layer closed, on
  one of the layer's cells, blanks that cell in the layer's grid (a
  nested layer's through its parent's) and paints its own in the
  grid it belongs to, so a modal's overlay covers a rotated sticker
  as it covers everything else — the front paint wins a cell
  outright, as always. A covered cell is see-through for the pointer,
  and the transcript shows the covering ink.
- **Animation is sampled** (cell-model.md "Animation"): `transform`,
  `translate`, `rotate`, `scale`, and `filter` are sampled transition
  properties, their computed values copied onto the box every frame
  with no layout, so a `transition-transform` follows the browser's
  own easing; a layout at the transition's start opens the layer, on the
  identity it may leave from, for an element the last layout did not
  make a layer root (one that is already starts with no layout: its box
  is there to copy onto), and its end is the next frame's copy, the
  loop's last layout landing a resting identity. A keyframe animation of an effect samples the same way; either
  keeps its element a layer root through identity frames
  (specs/animations.md). A layer root's opacity, in transition or
  animation, is copied onto its box the same way, its cells as they
  are.
- **Selection and copy see the grid, not the transform.** A layer's
  cells are grid cells at their layout positions: the text-mode
  selection paints on them, the transcript reads them, copy yields
  their text. The grid-mode selection (the browser's own on a
  `<pre>`) is one `<pre>`'s: a layer's `<pre>` takes a contained
  `user-select` where the engine supports it, so a drag started in
  the main grid stops at a layer's edge and one started inside stays
  inside, instead of a DOM-order selection sweeping the rows between.
- **The layer's extent is tracked as it paints**: the walk keeps every
  put into the layer and its bounds; at close the puts land in a grid
  of the extent, the box is positioned and sized from it, and the
  origin offset follows.
- **Scrolling composes.** A layer root inside a scroll container paints
  at its scrolled cells like anything else; a scroll container that is
  itself a layer root paints its gutters, bars, and clipped content
  inside its layer.
- **Engine hit-testing maps the pointer through the layer.** A client
  point over a layer's box is taken through the inverse of the box's
  placed transform (the translate, rotate, scale, and transform list
  about the placed origin, nested layers composed) before the cell
  lookup, so text-mode drags, word and paragraph gestures, and the
  synthesized pointer states land on the cell the viewer sees, as
  native pointer events on the light elements already do. A box
  painted after the layer that covers the point where the layer is
  drawn is above it natively, ink or none — a stretched link over a
  card, a transparent popover, a fixed header — and takes the point.
  Otherwise the hit through the layer answers from its root's
  ancestors, all of them as native hover climbs them, their boxes at
  the laid-out cells aside (the layer's box took the point through
  their clips where it is drawn: a carousel's translated track in a
  clipped view), and from its own subtree (a nested layer's aside) —
  another box laid out at those cells is drawn elsewhere. The layer
  takes the point only where that hit lands in its subtree: where the
  subtree takes no pointer events (`pointer-events: none`), the point
  falls to the layers beneath, then to the main grid, where the layer is
  drawn, not where it was laid out. A layer's blank cell past its root's
  border box (a shadow's, an overflowing child's) is see-through
  likewise. A point that lands on no layer is the main grid's, where no
  layer's subtree answers for the cell — its untransformed box included.
- **Opacity is the box's.** A layer root's `opacity`, times that
  of the faded ancestors between it and the enclosing layer's root
  (or the grid), goes on its box natively beside the effects, and
  its cells paint unfaded: the browser composites the layer as one
  group, as CSS composites an opacity root. A layer's grid blends as
  the main grid does (cell-model.md "Opacity and translucency"): its
  unpainted cells show what lies beneath the box, a translucent color
  over one keeps its alpha and a group its opacity, on its span, and
  a `bg-clear` inside it wipes its cells to transparent, the main
  grid's paint showing through.

## Deviations from CSS (summary)

1. The transcript culls a clipped layer's cells on their layout
   positions, as it shows no transform; a grid-mode copy inside a
   clipped layer includes its cells past the clip, as a native copy
   includes scrolled-out content.
2. A 3D transform draws as the browser draws it on the box, the
   pointer mapping flattened to 2D (a rotate about x or y is ignored
   there).
3. Where `user-select: contain` is unsupported — every engine probed
   (Chromium, Firefox, WebKit), so everywhere for now — a grid-mode
   drag that crosses a layer's edge selects in DOM order; the
   declaration stands for the engines that will support it.
4. A form control's native ink follows the browser's transform of the
   control itself, which coincides with the layer's while the two
   transforms agree (they are the same computed value).
5. The layer's text is the browser's rendering at the transformed
   size: glyphs off the grid's rounding (a 0.9 scale) are its
   antialiasing, as intended for an escape hatch.
6. A `backdrop-filter` transition snaps to its target at the next
   layout: the companion's lock on the light element keeps it off the
   sampled list, or every layout's lock toggle would ease.
7. Later ink covers a layer's cells on their layout positions, before
   the transform: a partial cover cuts on cell boundaries and turns
   with the layer. That it covers them whole — a translucent overlay
   hiding them, a later text run's blank spaces covering too — is the
   grid's one glyph per cell (cell-model.md deviation 13).

## Testing

- Node: the read (each effect, identities, the carried
  `backdrop-filter`); the paint split — a transformed subtree's cells
  absent from the main grid and present in its layer at the layer's
  origin, with its extent grown by an overflowing child and kept past
  a clipping ancestor, the clip carried through every one and a
  nested layer's the clips inside its parent alone; the box's opacity,
  the root's times its faded ancestors', its cells unfaded and a
  blend's alpha kept over its unpainted cells; nested layers; a
  layer in and as a scroll container, one scrolled out of view left
  empty; later ink covering a layer's cells, a nested layer's through
  its parent's, and ink walked before it left beneath; the transcript
  unchanged, wide clusters included; the
  boxes — placement, the clipping box, origin offset, node reuse in
  place, removal, re-placement from changed effects — and the pointer
  mapping through a scale, a rotation, nested layers, and off
  see-through, covered, and clipped cells; a layer that takes no
  pointer events passing the point to the box beneath where it is
  drawn, a box at a layer's laid-out cells answering none of its
  points, a box painted after a layer and a top-layer box over one
  taking the point where the layer is drawn, and a layer drawn into
  its clipping ancestor's view from past its clip.
- Storybook: a dialog scaled with a transition (its layer's scale
  equals the light element's mid-way and at rest); the native button
  inside a scaled dialog under the pointer where the layer shows it;
  a text-mode drag across a scaled dialog and across a rotated badge
  selecting the characters under the pointer; `blur`, `grayscale`,
  and `backdrop-blur` filters; a percentage translate; a layer inside
  a scroll container following the scroll, its box clipped to the
  container's padding box; a sticker under a modal's
  overlay, its covered cells blank and the pointer over the overlay
  reaching the overlay; three-engine agreement of the layer's box and
  the element's box (the story's play runs in every engine).
- Visual: goldens of the resting states, and of a text-mode and a
  grid-mode drag across a scaled layer in every engine.

## Touch points on implementation

- style.ts: `readLayer`, a root's effects read into `CellStyle.layer`.
- types.ts: `Layer`, carrying the `backdrop-filter` and whether the
  effects resample the cells (`resampled`, which the tiling fit reads,
  specs/wide-characters.md).
- styles.css: the leading lift in `top`, so the transforms and
  `filter` stay the author's; `backdrop-filter` locked on the light
  element.
- plain-text.ts: `walk`'s layer open and close around a root's
  subtree, on the `recorder` a group shares, the opacity of the groups
  it opened under kept (`PaintedLayer.alpha`).
- paint.ts: `paintGrid`'s per-layer grids and node reuse; the boxes'
  geometry and copied properties (`placeLayer`, `syncLayers`, the
  box's `opacity` among them); the pointer mapping (`layersAt`, every
  layer's cell under a point).
- pointer.ts: `cellAtPoint`, the layer a point lands on and takes —
  nothing painted after it covering the point, by the layout's paint
  order (`indexTree`) — else the main grid's cell, with the hit stack
  it found; `hitStack` through a layer (`through`): its root's
  ancestor path, then its subtree; `pointKey`, what a hit is a
  function of.
- element.ts: the layer container in the shadow viewport; a
  transition of an effect starting the sampling loop, its start
  laying out only for an element not yet a layer root
  (`#onTransitionRun`); `#cellAt` hands a client point to
  `cellAtPoint`, and the hover's same-cell skip compares `pointKey`s,
  no hit test run.
- animation.ts: `EFFECTS`, the properties a layer's box samples.
- cell-model.md's "Animation" names these properties among the
  sampled ones, and its "Effects" points here.
