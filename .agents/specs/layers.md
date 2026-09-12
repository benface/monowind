# Spec: layers — transforms and filters

Status: **proposed** (2026-09-12), awaiting review. Cell-unit
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

Read per element during the measure pass (the companion locks
neither): `transform` (the computed matrix, `none` when identity),
the individual `translate`, `rotate`, `scale`, and `transform-origin`;
`filter` (the computed list, `none` when empty). An element with any
of them set is a **layer root**. `backdrop-filter`, `perspective`,
and 3D transforms are read as their 2D projection where the browser
gives one and otherwise ignored (Deviations).

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
  in the shadow viewport at that extent's origin, in cells.
- **The native transform and filter go on the layer node.** Each
  paint copies the root's computed `transform`, `translate`,
  `rotate`, `scale`, `filter`, and a `transform-origin` moved by the
  extent's offset from the border box, so the layer transforms about
  the same point the light element does. The light element keeps its
  authored transform: it is invisible, but its native hit-testing
  follows the transform, so a button inside a scaled dialog is
  clickable where the layer shows it.
- **Layers stack in paint order and nest.** A layer's `<pre>` is
  appended to the viewport in the order the walk opens it, above the
  main grid; a layer root inside another's subtree opens its layer
  inside the outer layer's node, so transforms compose as they do in
  CSS. `z-index` orders siblings through the same paint-order walk the
  grid already uses.
- **Animation is sampled**, like color and opacity today: `transform`
  and `filter` join the sampled transition properties, so a
  `transition-transform` re-copies the computed value every frame and
  the layer follows the browser's own easing; the layout never runs
  for it, only the copy.
- **Selection and copy see the grid, not the transform.** A layer's
  cells are grid cells at their layout positions: the text-mode
  selection paints on them, the transcript reads them, copy yields
  their text. The grid-mode selection (the browser's own on a
  `<pre>`) is one `<pre>`'s: a layer's node takes `user-select:
contain` where the engine supports it, so a drag started in the
  main grid stops at a layer's edge and one started inside stays
  inside, instead of a DOM-order selection sweeping the rows between.
- **The layer's extent is tracked as it paints**: the walk records the
  bounds of every cell put into the layer, so no second pass is
  needed; the node is positioned and sized from them after the
  subtree, and the origin offset follows.
- **Scrolling composes.** A layer root inside a scroll container paints
  at its scrolled cells like anything else; a scroll container that is
  itself a layer root paints its gutters, bars, and clipped content
  inside its layer.
- **Engine hit-testing maps the pointer through the layer.** A client
  point over a layer's node is taken through the inverse of that
  node's current transform (`getComputedStyle(layer).transform`,
  nested layers composed) before the cell lookup, so text-mode drags,
  word and paragraph gestures, and the synthesized pointer states
  land on the cell the viewer sees, as native pointer events on the
  light elements already do.
- **Opacity is unchanged in this milestone.** It stays a per-cell
  paint field; making an opacity root a layer, for true group
  compositing, is a possible follow-up on the same mechanism.

## Deviations from CSS (summary)

1. A clipping ancestor culls a layer's cells before the transform, on
   their layout positions; CSS clips the transformed result.
2. `backdrop-filter` is ignored; 3D transforms flatten to 2D.
3. Where `user-select: contain` is unsupported, a grid-mode drag that
   crosses a layer's edge selects in DOM order.
4. A form control's native ink follows the browser's transform of the
   control itself, which coincides with the layer's while the two
   transforms agree (they are the same computed value).
5. The layer's text is the browser's rendering at the transformed
   size: glyphs off the grid's rounding (a 0.9 scale) are its
   antialiasing, as intended for an escape hatch.

## Testing

- Node: the paint split — a transformed subtree's cells absent from
  the main grid and present in its layer at the layer's origin, with
  its extent grown by an overflowing child; nested layers; the
  transcript unchanged.
- Storybook: a dialog scaled with a transition (its layer transform
  equals the light element's, before and after; the native button
  inside stays clickable); a rotated badge, a text-mode drag across it
  selecting the glyphs under the pointer; `blur` and `grayscale`
  filters; a layer inside a scroll container following the scroll;
  three-engine agreement of the layer's box and the element's box.
- Visual: goldens of the resting states.

## Touch points on implementation

- style.ts / types.ts: the transform and filter reads on `CellStyle`.
- plain-text.ts `walk` / paint.ts `paintGrid`: the layer open/close
  around a root's subtree; per-layer grids and node reuse; the layer
  nodes' geometry and copied properties (render step).
- element.ts: layer nodes in the shadow viewport; the sampled
  transition regex gains `transform` and `filter`; `#cellAt` maps a
  point through the layers under it.
- cell-model.md: "Animation" lists the new sampled properties; an
  "Effects" pointer to this spec.
