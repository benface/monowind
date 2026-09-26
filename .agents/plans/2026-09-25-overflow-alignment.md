# Overflow alignment past the start edge

Status: **planned 2026-09-25**. Today every overflowing alignment is
`safe` (cell-model.md deviation 21), as in v0.3.2. This plan makes it
CSS's, and keeps what CSS keeps reachable reachable.

## What CSS does

css-align §4.4 gives every alignment an overflow position. `safe`
aligns an overflowing subject as `start`. `unsafe` honors the keyword,
so `center` and `end` push the subject past the start edge. Without
either keyword, all three engines place it unsafe (probed 2026-09-24):

- an overflowing flex line under `center` or `end`, with the space-*
  keywords falling back to start;
- an item larger than its line, or than its grid area;
- grid tracks wider than the container;
- an out-of-flow box's static position in a flex container, which
  `space-around` and `space-evenly` center.

Under `wrap-reverse`, `stretch` falls back to `flex-start`, which is
the bottom edge, so overflowing lines run past the top (probed
2026-09-25). A reversed flex scroll container (`flex-col-reverse`,
`flex-row-reverse`) flips its scroll origin: the scrollable overflow
reaches toward the start, and the view starts at the end. That is how
a chat pane keeps its history reachable. Tailwind 4 writes `safe` with
the `*-safe` classes, which monowind reads into per-field flags
(`justifyContentSafe`, …) that layout ignores for now.

## What the batch tried, and why it was reverted

The follow-ups batch removed the clamps (`alignCrossOffset`,
`mainAxisPositions`, `align-content`, grid `trackPositions`, the
static position's `soleItemMainOffset`). The review found:

1. **Reversed scroll containers lose their overflow.** A
   `flex-col-reverse h-3 overflow-y-auto` log put its items at
   negative offsets, and its scroll range still started at 0, so the
   overflow could never be scrolled to.
2. **`justify-end` and `justify-center` scroll panes lose their
   start-side content**, for the same reason.
3. **Host-edge ink is dropped more often.** The grid has no cells left
   of or above the host.
4. **Free space from gaps and margins leaks into alignment.** The flex
   row's `availableForItems` (flex.ts ~147) and the column's
   `containerSpace` (~396-398) clamp at 0 before `mainAxisPositions`
   sees them. Their overflow then misses the gaps and margins that
   caused it: an `h-4 justify-end` column holding a `my-3` item places
   it at 2, where browsers put it at 4 − 3 − 1 = 0.
5. **Odd overflows round toward the start.** `center` floors −5 / 2
   to −3, which loses one more cell past the edge.
6. **Gap-rule junctions on overflowing tracks.** A tee was drawn in
   the wrong place and a rule glyph outside the left border. This is
   fixed: a rule joins the ring only on its straight run, with a tee
   where it ends and a cross where it runs on (gap-decorations.md).

## The work

0. **Probe first**, in all three engines:
   - the scroll range and `scrollTop` sign of `flex-col-reverse`,
     `flex-row-reverse` and `wrap-reverse` scroll containers, and
     where each one starts;
   - whether a `justify-end` or `justify-center` scroll container can
     reach its start-side overflow. css-align's default overflow
     alignment keeps a subject out of the unscrollable region, and
     engines may differ from it;
   - a box overflowing the host's left edge.
1. **Reversed scroll origin.** A scroll container whose content
   overflows toward its start takes a scroll range from its smallest
   child extent to its end. The range is pinned to the end, so offset
   0 is the end, as browsers flip the scroll origin. `contentExtent`
   tracks a minimum as well as a maximum. The scroll sync reads the
   native offset's sign (element.ts), and paint, sticky and pointer
   offsets follow (scrolling.md).
2. **Unclamp and consume `safe`.** Remove the clamps from
   `mainAxisOffsets` and `alignCrossOffset`, and add a `safe`
   parameter that clamps. An item's flag comes from its `align-self`,
   or from the parent's `align-items` when that is `auto`, next to
   `effectiveAlign`. `justify-self` works the same way in grid.
3. **Signed free space to alignment only.** Flexing keeps its clamped
   `availableForItems`. Alignment gets the inner size minus the gaps,
   the fixed margins and the sizes.
4. **Round the odd cell toward the end**: a negative leftover centers
   at `-Math.floor(-leftover / 2)`.
5. **Host edge**: decide from the probe whether the grid grows left
   and up or keeps the drop. At the root, CSS cannot scroll there
   either.
6. **Docs**: remove deviation 21. Restore the unsafe wording in
   flex.md steps 7-9, grid.md "Items in their areas" and
   positioning.md's static position. Add the reversed origin to
   scrolling.md.

## Tests

- Flex: an overflowing line under `center` / `end` at −5 / −10, and
  the space-* keywords at 0. An item past its line's start. An
  `align-content: center` overflow. `wrap-reverse` overflowing lines
  at `[0, −2]`.
- `safe`: `justify-center-safe` and `self-center-safe` overflows stay
  at 0, and `self-auto` takes the parent's flag.
- Signed free space: `h-4 justify-end` with a `my-3` item places it
  at 0.
- Rounding: a 21-wide item centered in 10 sits at −5.
- Reversed scroll: a `flex-col-reverse h-3 overflow-y-auto` log of 5
  rows scrolls over all 5, starts showing the end, and keeps its
  offset across relayouts. The same for row-reverse and wrap-reverse.
- Whatever the probe finds for `justify-end` and `justify-center`
  scroll panes.
- Grid: tracks and items past the start. Static positions, with
  space-around centering.
- Gap rules: a rule crossing the left border over tracks overflowing
  the start.
- The host-edge decision.
- The flipped tests pinning deviation 21 (flex, grid,
  positioning.test.ts "starts an overflowing flex static position")
  flip back.
