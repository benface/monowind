# Spec: layers — transforms and filters

Status: **implemented** (2026-09-13; `plain-text.ts` opens a layer per
root, `paint.ts` gives it nodes and maps the pointer, `element.ts`
samples its transitions). Cell-unit
fundamentals live in `cell-model.md`; the paint walk and the grid in
`wide-characters.md` "The grid paints the selection"; opacity, which
this may later absorb, in `cell-model.md` "Opacity".

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
to the grid) is a **layer root**. The `backdrop-filter` is kept
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
  instead of the main one, in the same paint order and with the same
  clipping; the main grid gets nothing from the subtree, so the cells
  the subtree occupies show what the ancestors painted beneath
  (as CSS shows what is behind a transformed box). The layer is sized
  to the subtree's painted extent — the root's border box grown by
  whatever overflows it (shadows, visible overflow) — and positioned
  in the shadow viewport at that extent's origin, in cells. Its node
  is a box (`<div class="layer">`) holding the `<pre>`.
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
- **Animation is sampled**, like color and opacity today: `transform`,
  `translate`, `rotate`, `scale`, and `filter` join the sampled
  transition properties, so a `transition-transform` re-copies the
  computed values every frame and the layer follows the browser's own
  easing; the layout runs once, at the settle when the transition
  ends.
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
  native pointer events on the light elements already do. A layer's
  blank cell past its root's border box (a shadow's, an overflowing
  child's) is see-through: the point falls to what is beneath.
- **Opacity is unchanged in this milestone.** It stays a per-cell
  paint field; making an opacity root a layer, for true group
  compositing, is a possible follow-up on the same mechanism.

## Deviations from CSS (summary)

1. A clipping ancestor culls a layer's cells before the transform, on
   their layout positions; CSS clips the transformed result.
2. A 3D transform draws as the browser draws it on the box, the
   pointer mapping flattened to 2D (a rotate about x or y is ignored
   there).
3. Where `user-select: contain` is unsupported, a grid-mode drag that
   crosses a layer's edge selects in DOM order.
4. A form control's native ink follows the browser's transform of the
   control itself, which coincides with the layer's while the two
   transforms agree (they are the same computed value).
5. The layer's text is the browser's rendering at the transformed
   size: glyphs off the grid's rounding (a 0.9 scale) are its
   antialiasing, as intended for an escape hatch.
6. A `backdrop-filter` transition snaps to its target at the next
   layout: the companion's lock on the light element keeps it off the
   sampled list, or every layout's lock toggle would ease.
7. A `bg-clear` inside a layer is transparent: the layer's box shows
   the main grid through its unpainted cells, as a transformed box
   shows what is behind it, so the wipe of ancestor decorations the
   marker means on the main grid has nothing to wipe there.
8. No engine probed (Chromium, Firefox, WebKit) supports a contained
   `user-select`, so deviation 3 is the shipped behavior everywhere
   for now: the declaration stands for the engines that will.
9. Layers paint above the whole main grid: a box walked after a layer
   with a higher `z-index` (an overlay, a modal's backdrop) paints
   beneath the layer, where CSS paints it over. `z-index` orders the
   layers among themselves.
10. CSS `animation` keyframes of a layer's effects are not sampled
    (`animate-spin` holds the angle of the last layout), as for color:
    transitions only, per cell-model.md "Animation".

## Testing

- Node: the read (each effect, identities, the carried
  `backdrop-filter`); the paint split — a transformed subtree's cells
  absent from the main grid and present in its layer at the layer's
  origin, with its extent grown by an overflowing child and cut to
  the visible part under a clipping ancestor; nested layers; a layer
  in and as a scroll container; the transcript unchanged, wide
  clusters included; the boxes — placement, origin offset, node reuse
  in place, removal, re-placement from changed effects — and the
  pointer mapping through a scale, a rotation, nested layers, and off
  see-through cells.
- Storybook: a dialog scaled with a transition (its layer's scale
  equals the light element's mid-way and at rest); the native button
  inside a scaled dialog under the pointer where the layer shows it;
  a text-mode drag across a scaled dialog and across a rotated badge
  selecting the characters under the pointer; `blur`, `grayscale`,
  and `backdrop-blur` filters; a percentage translate; a layer inside
  a scroll container following the scroll; three-engine agreement of
  the layer's box and the element's box (the story's play runs in
  every engine).
- Visual: goldens of the resting states, and of a text-mode and a
  grid-mode drag across a scaled layer in every engine.

## Touch points on implementation

- style.ts / types.ts: `readLayer` and `CellStyle.layer` (`Layer`
  carries the `backdrop-filter`); styles.css carries the leading lift
  in `top` so the transforms and `filter` stay the author's, and locks
  `backdrop-filter` on the light element.
- plain-text.ts `walk` / paint.ts `paintGrid`: the layer open/close
  around a root's subtree; per-layer grids and node reuse; the boxes'
  geometry and copied properties (`placeLayer`, `syncLayers`) and the
  pointer mapping (`layerAt`).
- element.ts: the layer container in the shadow viewport; the sampled
  transition regex gains `transform`, `translate`, `rotate`, `scale`,
  and `filter`; `#cellAt` maps a point through the layers under it.
- cell-model.md: "Animation" lists the new sampled properties; an
  "Effects" pointer to this spec.
