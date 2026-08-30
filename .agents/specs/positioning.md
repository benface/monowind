# Spec: positioning and insets

Status: normative. Written spec-first for the positioning work (Milestone 3
scope, expanded to include `absolute`). Cell-unit fundamentals live in
`cell-model.md`; this spec covers `position` and the inset properties.

## Values

`position: static | relative | absolute | fixed | sticky` is read per
element. Behavior:

- **static** (default): normal flow; insets are ignored, per CSS.
- **relative**: normal flow, then a pure visual offset by the resolved
  insets — siblings and the parent's size are unaffected, per CSS. The
  element becomes a containing block for absolute descendants.
- **absolute**: removed from flow (siblings lay out as if it didn't exist;
  it contributes nothing to the parent's content size). Positioned against
  its containing block by the resolved insets.
- **fixed**: treated as `absolute` with the `<mono-wind>` host as the
  containing block. **Deviation** (CSS anchors to the viewport) — a
  component shouldn't escape its host; revisit only if a real use case
  appears.
- **sticky**: treated as `relative`. This is exactly CSS sticky behavior in
  the absence of scrolling; **proper sticky positioning must be implemented
  with the scrolling milestone** (tracked there).

## Insets

`top / right / bottom / left` (and the `inset-*` shorthands, which the
browser expands to longhands before we read them) are read as
`CellLength | auto` per side:

- Lengths follow the spacing scale (0.25rem = 1 cell; vertical insets →
  rows, horizontal → columns), rounded per the cell-model rules. Negative
  values are fine.
- Percentages resolve against the **containing block**: width for
  left/right, height for top/bottom, per CSS.
- Over-constrained axes follow CSS LTR resolution: `top` wins over
  `bottom`, `left` wins over `right` (for relative, the losing side is
  ignored; for absolute with a definite size, the losing inset yields).

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
detects inline elements whose computed position is relative (or sticky)
with non-auto insets during the measure pass, converts each inset to whole
cells, and rewrites the offset through engine-owned custom properties so
the browser applies a whole-cell shift (`calc(n × cell)`), keeping the
author's `position: relative` itself intact.

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
decoration glyphs and `renderAscii` agree with the browser at
overlaps — a simplified model: no stacking contexts, and a negative
`z-*` still paints over its parent's own glyphs. Relative/absolute
elements may overlap anything; `overflow` clipping applies natively.

## ASCII renderer

`renderAscii` applies relative offsets and absolute placement (they're
plain rect math). **Deviation**: inline relative shifts are not
represented (the leaf text model doesn't track which glyphs belong to
which inline element); visual tests cover them.

## Deviations from CSS (summary)

1. `fixed` anchors to the `<mono-wind>` host, not the viewport.
2. `sticky` behaves as `relative` until the scrolling milestone.
3. Percent insets on inline elements are treated as 0.
4. An out-of-flow element extracted from a text run takes its leaf's
   content-box origin as its static position, not CSS's hypothetical
   inline position.
5. Inline relative shifts don't appear in `renderAscii` output.
6. All cell-model deviations (integer rounding, etc.) apply.
