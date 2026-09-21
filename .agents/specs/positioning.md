# Spec: positioning and insets

Status: normative. Written spec-first for the positioning work (Milestone 3
scope, expanded to include `absolute`). Cell-unit fundamentals live in
`cell-model.md`; this spec covers `position` and the inset properties.
Two sibling specs build on it: `anchor-positioning.md` places an
out-of-flow box against a named anchor (`position-area`), and
`top-layer.md` lays out an open popover or a modal dialog as a fixed
box of the host, painted last in a stack.

## Values

`position: static | relative | absolute | fixed | sticky` is read per
element. Behavior:

- **static** (default): normal flow; insets are ignored, per CSS.
- **relative**: normal flow, then a pure visual offset by the resolved
  insets — siblings and the parent's size are unaffected, per CSS. The
  element becomes a containing block for absolute descendants.
- **absolute**: removed from flow (siblings lay out as if it didn't exist;
  it contributes nothing to the parent's content size). Positioned against
  its containing block by the resolved insets. Its `float` computes to
  `none`, per CSS (specs/float.md).
- **fixed**: treated as `absolute` with the `<mono-wind>` host as the
  containing block, and painted and hit-tested from the host's origin,
  outside its ancestors' clips and scroll offsets, as CSS paints a
  fixed box outside its scrollers; a layer root above it captures it
  (specs/layers.md), as a transformed ancestor does in CSS.
  **Deviation** (CSS anchors to the viewport) — a component shouldn't
  escape its host. A top-layer element is the one exception, and only
  for its placement: it resolves in the cells of the host the viewport
  shows, so a dialog opens where the reader is looking
  (specs/top-layer.md).
- **sticky**: normal flow, then a paint-time shift that keeps the box
  inside its scroll container's scrollport by its insets, per
  css-position-3 §3.4 — `sticky.md`. The insets are constraints, not
  offsets: at rest the box is where flow put it. The element becomes a
  containing block for absolute descendants.

## Insets

`top / right / bottom / left` (and the `inset-*` shorthands, which the
browser expands to longhands before we read them) are read as
`CellLength | auto` per side:

- Lengths follow the spacing scale (0.25rem = 1 cell; vertical insets →
  rows, horizontal → columns), rounded per the cell-model rules. Negative
  values are fine.
- Percentages resolve against the **containing block**: width for
  left/right, height for top/bottom, per CSS. A `calc()` of a
  percentage and lengths keeps both, the lengths as cells added once
  the percentage resolves (`cell-model.md` "Mixed-unit calc()").
- Over-constrained axes follow CSS LTR resolution: `top` wins over
  `bottom`, `left` wins over `right` (for relative, the losing side is
  ignored; for absolute with a definite size, the losing inset yields).
- An `auto` side must read as `auto`. On a positioned element
  `getComputedStyle` gives the USED distance instead, which would read
  as an authored inset and stretch the box between its two sides; the
  Typed OM keeps the computed value, and without it (Firefox pre-157)
  a side counts only where an inline style or a utility for THAT side
  authors it (style.ts `readInsets`). The axis shorthands author their
  own axis alone: `inset-y-*` leaves left and right `auto`, as
  `inset-x-*` leaves top and bottom — `inset-*` itself authors all
  four.

## Containing block (per CSS)

The containing block of an absolute element is the **padding box of its
nearest positioned ancestor** (`position` ≠ static — relative, absolute,
fixed, or sticky), or the `<mono-wind>` host's content box when there is
none. The companion stylesheet's own `position: absolute` on laid-out
elements is an implementation detail and does NOT make an element a
containing block — only the author's `position` does.

For a relative element, percent insets resolve against its own parent's
content box (its containing block in flow).

## Absolute layout

- **Width**: explicit width/min/max apply as usual. With `left` and `right`
  both set and width auto → the element stretches between them. Otherwise
  auto width = shrink-to-fit within the containing block, per CSS.
- **Height**: symmetric — `top` + `bottom` with auto height stretches;
  otherwise content height.
- **Static position** (an axis with both insets `auto`): the element sits
  where it would have been in flow, per CSS:
  - Block parent: the flow cursor position at its DOM slot (x: content
    origin + margin; y: where the next in-flow sibling starts).
  - Flex parent: as if it were the **sole flex item** of the container —
    `justify-content` (reverse-aware) / `align-items` (with its own
    `align-self`) applied to its hypothetical box (css-flexbox §4.1),
    whose outer size includes the box's fixed margins (`auto` margins
    count as 0 in the static position).
- Margins apply between the inset edges and the box, per CSS. `auto`
  margins center within the inset-defined space when the size is definite
  (the `inset-0 m-auto` centering idiom).

## Inline elements (`<span class="relative top-1">` in a text run)

Inline descendants of a leaf are browser-rendered, so authored inset
values would paint off-grid (`top-1` = 0.25rem = 4px ≠ 1 row). The engine
detects inline elements whose computed position is relative with non-auto
insets during the measure pass, converts each inset to whole cells, and
rewrites the offset through engine-owned custom properties so the browser
applies a whole-cell shift (`calc(n × cell)`), keeping the author's
`position: relative` itself intact. An inline sticky element's insets are
constraints for its scroll-time shift (`sticky.md`), carried natively
through the same properties.

- Only cell-mappable lengths are supported on inline insets; **percent
  insets on inline elements are treated as 0** (deviation — their CSS
  basis is the containing block of the text run, which the engine doesn't
  model per-line).
- `absolute`/`fixed` on an inline element blockifies it, per CSS: it
  leaves the text run entirely (the text reflows without it) and becomes
  an out-of-flow box positioned like any other. **Deviation:** its static
  position approximates to its leaf's content-box origin rather than
  CSS's hypothetical inline position (the spot mid-text where it would
  have sat).

## Paint order

All laid-out elements are browser-positioned; stacking is DOM order by
default, with `z-*` honored exactly where CSS applies it — positioned
elements and flex/grid items; inert on static block-flow children (the
engine gates the browser side through `--mw-z`, since absolutization
would otherwise activate it everywhere). The renderers walk children in
the same order (stable effective-z sort, document-order ties) so
decoration glyphs and `renderPlainText` agree with the browser at
overlaps — a simplified model: no stacking contexts, and a negative
`z-*` still paints over its parent's own glyphs. Relative/absolute
elements may overlap anything; `overflow` clipping applies natively.

## Plain-text renderer

`renderPlainText` applies relative offsets and absolute placement
(plain rect math), and inline relative shifts too: the run records each
character's inline element, so its whole-cell insets move the glyphs.

## Deviations from CSS (summary)

1. `fixed` anchors to the `<mono-wind>` host, not the viewport.
2. Percent insets on inline elements are treated as 0.
3. An out-of-flow element extracted from a text run takes its leaf's
   content-box origin as its static position, not CSS's hypothetical
   inline position.
4. All cell-model deviations (integer rounding, etc.) apply; sticky's
   own are in `sticky.md`.
