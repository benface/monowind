import { percentToCells } from "./metrics.ts";
import { gapRuleRuns, ruleBandSegments } from "./borders.ts";
import type { GapSegment, GapStrip, RuleSegment } from "./borders.ts";
import {
  autoMarginOffset,
  boxChrome,
  clampSize,
  contentOrigin,
  fixedMargins,
  intrinsicOuterWidth,
  isInFlowBox,
  isOutOfFlow,
  layoutNode,
  resolveGap,
  resolveLimit,
  resolveMargin,
  resolveSizeAgainst,
  resolveWidthLimit,
} from "./layout.ts";
import type { IntrinsicCache, SizingMode } from "./layout.ts";
import type { CellStyle, LayoutNode, NullableInsets } from "./types.ts";

/**
 * Flexbox (specs/flex.md): row and column algorithms, CSS §9.7 flexible
 * length resolution, and the shared distribution/alignment helpers. See
 * layout.ts for the deliberate import cycle between the layout modules.
 */

interface FlexLine {
  row: { node: LayoutNode }[];
}

/** The gaps between a line's adjacent item rects along `axis`, in visual
 * order (whatever gap, justify, and margins produced), origin-relative. */
function lineGapRanges(
  items: readonly { node: LayoutNode }[],
  origin: number,
  axis: "x" | "y",
): { start: number; end: number }[] {
  const size = axis === "x" ? "width" : "height";
  const rects = items.map((item) => item.node.localRect).sort((a, b) => a[axis] - b[axis]);
  const ranges: { start: number; end: number }[] = [];
  for (let i = 1; i < rects.length; i++) {
    const start = rects[i - 1]![axis] + rects[i - 1]![size] - origin;
    const end = rects[i]![axis] - origin;
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

/** Segments of the row-gap band above line `r`: under `rule-break:
 * intersection` the band breaks at the union of the two adjacent lines'
 * column gaps (probed in Chromium — a T from either side counts);
 * otherwise one full-width segment. */
function rowBandSegments(
  node: LayoutNode,
  lines: FlexLine[],
  r: number,
  originX: number,
  innerWidth: number,
): GapSegment[] {
  if (node.style.ruleBreak !== "intersection") return [{ start: 0, end: innerWidth }];
  const crossings = [lines[r - 1]!, lines[r]!]
    .flatMap((line) => lineGapRanges(line.row, originX, "x"))
    .sort((a, b) => a.start - b.start);
  // Item strips (the complement of the merged crossings) feed the shared
  // segmenter; every strip is plain occupied track.
  const occupiedStrip = (start: number, end: number): GapStrip => ({
    start,
    end,
    spanned: false,
    beforeOccupied: true,
    afterOccupied: true,
  });
  const strips: GapStrip[] = [];
  let cursor = 0;
  for (const crossing of crossings) {
    if (crossing.start > cursor) strips.push(occupiedStrip(cursor, crossing.start));
    cursor = Math.max(cursor, crossing.end);
  }
  if (cursor < innerWidth) strips.push(occupiedStrip(cursor, innerWidth));
  return ruleBandSegments(strips, "intersection", "all", node.style.ruleInset === "overlap-join");
}

export function layoutFlexRow(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  definiteInnerHeight: number | undefined,
  cache: IntrinsicCache,
): number {
  const gapX = resolveGap(node.style, "x", innerWidth);
  const gapY = resolveGap(node.style, "y", innerHeight);
  const items = flexOrderedChildren(node).map((child) => {
    const base = flexBaseOuterWidth(child, innerWidth, cache);
    const max = resolveWidthLimit(child.style.maxWidth, innerWidth, child, cache);
    const min = Math.max(
      flexItemMinWidth(child, innerWidth, max, cache),
      boxChrome(child.style, "x", innerWidth),
    );
    return {
      node: child,
      base,
      grow: child.style.flexGrow,
      shrink: child.style.flexShrink,
      min,
      max,
      hypothetical: Math.max(0, clampSize(base, min, max)),
      margin: resolveMargin(child.style.margin, innerWidth),
    };
  });

  // The first item on a row is always placed, as CSS does.
  const rows: (typeof items)[] = [];
  if (node.style.flexWrap === "wrap") {
    let current: typeof items = [];
    let used = 0;
    for (const item of items) {
      const itemWidth = item.hypothetical + fixedMargins(item.margin, "x");
      const next = current.length === 0 ? itemWidth : used + gapX + itemWidth;
      if (current.length > 0 && next > innerWidth) {
        rows.push(current);
        current = [];
        used = 0;
      }
      current.push(item);
      used = current.length === 1 ? itemWidth : used + gapX + itemWidth;
    }
    if (current.length > 0) rows.push(current);
    // wrap-reverse stacks the lines from the cross-end (bottom-up); items
    // within each line keep their main-axis order.
    if (node.style.wrapReverse) rows.reverse();
  } else {
    rows.push(items);
  }

  const { x: originX, y: originY } = contentOrigin(node);

  // Phase A: resolve each line's item widths, lay the items out, and take
  // the line's natural height (tallest item, fixed cross margins in).
  const lines = rows.map((row) => {
    const totalGap = gapX * Math.max(0, row.length - 1);
    const fixedMarginTotal = row.reduce((sum, item) => sum + fixedMargins(item.margin, "x"), 0);
    // Auto margins count as 0 while the lengths flex, and share what
    // flexing leaves (CSS §8.1) — below, as the leftover.
    const availableForItems = Math.max(0, innerWidth - totalGap - fixedMarginTotal);
    const widths = resolveFlexMainAxis(row, availableForItems);
    for (let i = 0; i < row.length; i++) {
      layoutNode(row[i]!.node, innerWidth, definiteInnerHeight, 0, 0, "fill", cache, {
        width: widths[i]!,
      });
    }
    const height = row.reduce(
      (h, item) => Math.max(h, item.node.localRect.height + fixedMargins(item.margin, "y")),
      0,
    );
    return { row, widths, availableForItems, height };
  });

  // Line heights and cross offsets (specs/flex.md step 9). A single nowrap
  // line's cross size IS a definite inner height (css-flexbox §9.4.8 —
  // stretched items shrink to it, content overflowing), and stretches to
  // a min-height floor so items-center / items-end have the enforced size
  // to align against. A wrap-enabled ("multi-line", per CSS — even with
  // one line) container distributes bounded leftover cross space per
  // `align-content`: `stretch` grows the lines; the other keywords offset
  // them with the shared justify math.
  const rowHeights = lines.map((line) => line.height);
  const totalGapY = gapY * Math.max(0, lines.length - 1);
  let lineOffsets: number[];
  if (node.style.flexWrap === "nowrap") {
    if (definiteInnerHeight !== undefined) rowHeights[0] = definiteInnerHeight;
    else if (Number.isFinite(innerHeight))
      rowHeights[0] = Math.max(innerHeight, rowHeights[0] ?? 0);
    lineOffsets = [0];
  } else {
    const linesExtent = rowHeights.reduce((s, h) => s + h, 0) + totalGapY;
    // Lines overflow a definite height only: a min-height floor grows.
    const leftover =
      definiteInnerHeight === undefined
        ? Number.isFinite(innerHeight)
          ? Math.max(0, innerHeight - linesExtent)
          : 0
        : definiteInnerHeight - linesExtent;
    if (node.style.alignContent === "stretch" && leftover > 0) {
      const shares = distributeInteger(
        Array.from({ length: lines.length }, () => 1),
        leftover,
      );
      for (let i = 0; i < rowHeights.length; i++) rowHeights[i]! += shares[i]!;
      lineOffsets = mainAxisOffsets("start", rowHeights, 0);
    } else {
      const alignContent = effectiveAlignContent(node.style, lines.length);
      lineOffsets = mainAxisOffsets(alignContent, rowHeights, leftover);
    }
  }

  // Phase B: per line, stretch items to the (possibly grown) line height
  // and place them.
  for (let rowIndex = 0; rowIndex < lines.length; rowIndex++) {
    const { row, widths, availableForItems } = lines[rowIndex]!;
    const rowHeight = rowHeights[rowIndex]!;
    const y = lineOffsets[rowIndex]! + rowIndex * gapY;

    // Stretch phase: any item whose effective cross alignment is `stretch`
    // (no explicit height, no auto cross-axis margins) takes the row's
    // height — grown or shrunk (`min-height: auto` is 0 in the cross
    // axis; content overflows). Re-run layoutNode with the height forced
    // so nested content that depends on the parent's height sees it.
    for (let i = 0; i < row.length; i++) {
      const child = row[i]!.node;
      const align = effectiveAlign(child, node);
      const itemMargin = row[i]!.margin;
      const hasCrossAutoMargin = itemMargin.top === null || itemMargin.bottom === null;
      if (
        align === "stretch" &&
        !hasCrossAutoMargin &&
        child.style.height === undefined &&
        rowHeight !== child.localRect.height
      ) {
        const marginTop = itemMargin.top ?? 0;
        const marginBottom = itemMargin.bottom ?? 0;
        // Per CSS, a stretched cross size is still clamped by the item's own
        // min/max-height (percent resolved against the container's inner
        // height when definite).
        const crossBasis = Number.isFinite(innerHeight) ? innerHeight : undefined;
        const stretchedHeight = clampSize(
          Math.max(0, rowHeight - marginTop - marginBottom),
          resolveLimit(child.style.minHeight, crossBasis) ?? 0,
          resolveLimit(child.style.maxHeight, crossBasis),
        );
        if (stretchedHeight === child.localRect.height) continue;
        layoutNode(child, innerWidth, definiteInnerHeight, 0, 0, "fill", cache, {
          width: widths[i]!,
          height: stretchedHeight,
        });
      }
    }
    const justify = effectiveJustify(node.style, row.length);
    const positions = mainAxisPositions(justify, row, widths, availableForItems, gapX, "x");
    for (let i = 0; i < row.length; i++) {
      const item = row[i]!;
      const child = item.node;
      child.localRect = {
        ...child.localRect,
        x: originX + positions[i]!,
        y:
          originY +
          y +
          alignedOffset(
            lineAlign(child, node),
            item.margin.top,
            item.margin.bottom,
            rowHeight,
            child.localRect.height,
          ),
      };
    }
  }

  const totalOccupied = rowHeights.reduce((s, h) => s + h, 0) + totalGapY;
  const contentHeight = Number.isFinite(innerHeight)
    ? Math.max(innerHeight, totalOccupied)
    : totalOccupied;

  // Gap rules (specs/gap-decorations.md): vertical bands between the
  // items of each line (visual order — the space between adjacent
  // rects, whatever justify/margins/reverse produced it), horizontal
  // bands between lines, full content width.
  if (node.style.ruleX || node.style.ruleY) {
    const vertical: RuleSegment[] = [];
    const horizontal: RuleSegment[] = [];
    for (let r = 0; r < lines.length; r++) {
      const top = lineOffsets[r]! + r * gapY;
      for (const gap of lineGapRanges(lines[r]!.row, originX, "x")) {
        vertical.push({
          bandStart: gap.start,
          bandSize: gap.end - gap.start,
          start: top,
          end: top + rowHeights[r]!,
        });
      }
      if (r > 0) {
        const prevBottom = lineOffsets[r - 1]! + (r - 1) * gapY + rowHeights[r - 1]!;
        if (top > prevBottom) {
          for (const segment of rowBandSegments(node, lines, r, originX, innerWidth)) {
            horizontal.push({ bandStart: prevBottom, bandSize: top - prevBottom, ...segment });
          }
        }
      }
    }
    // `normal` behaves as `none` in flex and visibility-items is
    // grid/multicol-only (css-gaps), so beyond intersection breaks the
    // bands only honor rule-inset (specs/gap-decorations.md "Segments").
    node.decorationRuns = gapRuleRuns(
      node,
      vertical,
      horizontal,
      innerWidth,
      definiteInnerHeight ?? contentHeight,
    );
  }

  recordFlexStaticSlots(node, originX, originY, innerWidth, contentHeight);
  // The lines' natural heights, a flex parent's read of the box's content
  // height: the height or min-height floor they stretched into is the
  // caller's to apply.
  return lines.reduce((sum, line) => sum + line.height, 0) + totalGapY;
}

/** Static slots for a flex container's out-of-flow children — the content
 * box plus alignment context, so the positioning pass can apply the CSS
 * "as if it were the sole flex item" rule once the box is sized. */
function recordFlexStaticSlots(
  node: LayoutNode,
  originX: number,
  originY: number,
  innerWidth: number,
  contentHeight: number,
): void {
  for (const child of node.children) {
    if (!isOutOfFlow(child.style)) continue;
    child.staticSlot = {
      kind: "flex",
      direction: node.style.flexDirection,
      originX,
      originY,
      innerWidth,
      innerHeight: contentHeight,
    };
  }
}

export function layoutFlexColumn(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  definiteInnerHeight: number | undefined,
  cache: IntrinsicCache,
): number {
  const gapY = resolveGap(node.style, "y", innerHeight);
  const finiteInner = Number.isFinite(innerHeight);

  const items = flexOrderedChildren(node).map((child) => {
    const margin = resolveMargin(child.style.margin, innerWidth);
    const availableWidth = Math.max(0, innerWidth - fixedMargins(margin, "x"));
    // The cross-axis (width) stretch: the item's own align-self, else the
    // parent's align-items — a `self-start` item shrinks to fit.
    const widthMode: SizingMode = effectiveAlign(child, node) === "stretch" ? "fill" : "shrink";
    // First pass at intrinsic height along the main axis. A definite
    // container height is the basis for the child's percent height.
    layoutNode(child, availableWidth, definiteInnerHeight, 0, 0, widthMode, cache);
    const limitBasis = finiteInner ? innerHeight : undefined;
    // The base main size (flex-basis, else the item's height): cells, or
    // a percent of a definite container height; anything else — auto, an
    // intrinsic keyword, a percent of an indefinite height — is the
    // content height (§7.2.3). Unclamped: the freeze loop applies min/max.
    const basis = child.style.flexBasis ?? child.style.height;
    const naturalHeight = child.naturalContentHeight;
    const base =
      basis?.kind === "cells"
        ? basis.value
        : basis?.kind === "percent" && definiteInnerHeight !== undefined
          ? percentToCells(basis.value, definiteInnerHeight)
          : naturalHeight;
    // The automatic minimum is capped by the item's first-pass height: its
    // own height as its max leaves it.
    const min = Math.max(
      child.style.minHeight === "auto"
        ? automaticMinimum(
            child.style.overflow.y,
            () => naturalHeight,
            child.localRect.height,
            undefined,
          )
        : (resolveLimit(child.style.minHeight, limitBasis) ?? 0),
      boxChrome(child.style, "y", availableWidth),
    );
    const max = resolveLimit(child.style.maxHeight, limitBasis);
    return {
      node: child,
      base,
      grow: child.style.flexGrow,
      shrink: child.style.flexShrink,
      min,
      max,
      hypothetical: Math.max(0, clampSize(base, min, max)),
      margin,
      availableWidth,
      widthMode,
    };
  });

  const totalGap = gapY * Math.max(0, items.length - 1);
  const fixedMarginTotal = items.reduce((sum, item) => sum + fixedMargins(item.margin, "y"), 0);
  const hypotheticalTotal = items.reduce((sum, item) => sum + item.hypothetical, 0);
  const containerSpace = finiteInner
    ? Math.max(0, innerHeight - totalGap - fixedMarginTotal)
    : hypotheticalTotal;
  // A min-height-only container size is a floor, not a cap: it can hand
  // extra space to flex-grow, but content larger than the floor keeps its
  // hypothetical size (no flex-shrink) and the container grows to fit.
  const availableForItems =
    definiteInnerHeight === undefined
      ? Math.max(containerSpace, hypotheticalTotal)
      : containerSpace;

  // Without distribution, items take their HYPOTHETICAL sizes (base clamped
  // by min/max) — stacking with raw bases would disagree with the heights
  // the boxes actually get (e.g. a min-h child would overlap its follower).
  const finalHeights = finiteInner
    ? resolveFlexMainAxis(items, availableForItems)
    : items.map((item) => item.hypothetical);
  // If a child's main-axis size changed, re-run its layout with the new
  // height forced so any nested content that depends on the parent's height
  // (items-center/end in a nested flex, percent heights) sees the final size.
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const height = finalHeights[i]!;
    if (height !== item.node.localRect.height) {
      layoutNode(item.node, item.availableWidth, height, 0, 0, item.widthMode, cache, { height });
    }
  }

  const { x: originX, y: originY } = contentOrigin(node);
  const justify = effectiveJustify(node.style, items.length);
  const positions = mainAxisPositions(justify, items, finalHeights, availableForItems, gapY, "y");
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const child = item.node;
    child.localRect = {
      ...child.localRect,
      x:
        originX +
        alignedOffset(
          lineAlign(child, node),
          item.margin.left,
          item.margin.right,
          innerWidth,
          child.localRect.width,
        ),
      y: originY + positions[i]!,
    };
  }

  const totalUsed = finalHeights.reduce((s, h) => s + h, 0);
  const totalOccupied = totalUsed + totalGap + fixedMarginTotal;
  const contentHeight = finiteInner ? Math.max(innerHeight, totalOccupied) : totalOccupied;

  // Gap rules: horizontal bands between stacked items, full content
  // width (the single column's cross extent), retracted by rule-inset.
  if (node.style.ruleY && items.length > 1) {
    const horizontal = lineGapRanges(items, originY, "y").map((gap): RuleSegment => ({
      bandStart: gap.start,
      bandSize: gap.end - gap.start,
      start: 0,
      end: innerWidth,
    }));
    node.decorationRuns = gapRuleRuns(
      node,
      [],
      horizontal,
      innerWidth,
      definiteInnerHeight ?? contentHeight,
    );
  }

  recordFlexStaticSlots(node, originX, originY, innerWidth, contentHeight);
  // What the items need at their hypothetical sizes, a flex parent's read
  // of the box's content height: the height or min-height floor they
  // flexed in is the caller's to apply.
  return hypotheticalTotal + totalGap + fixedMarginTotal;
}

/** A box's offset in `space` along one axis under self-alignment (a flex
 * item's cross axis, a grid item in its area): auto margins take the free
 * space, else the fixed leading margin plus the margin box's alignment
 * offset (`stretch` as `start`: the stretch happened in sizing). */
export function alignedOffset(
  align: CellStyle["alignItems"],
  before: number | null,
  after: number | null,
  space: number,
  size: number,
): number {
  return (
    autoMarginOffset(before, after, space, size) ??
    before! + alignCrossOffset(align, space, size + before! + after!)
  );
}

/** A flex line's item positions along the main axis, content-box
 * relative: auto margins share what flexing leaves (CSS §8.1) and then
 * override justify-content, which aligns an overflowing line too;
 * fixed margins and the gap step between. */
function mainAxisPositions(
  justify: CellStyle["justifyContent"],
  items: readonly { margin: NullableInsets }[],
  sizes: number[],
  available: number,
  gap: number,
  axis: "x" | "y",
): number[] {
  const [before, after] =
    axis === "x" ? (["left", "right"] as const) : (["top", "bottom"] as const);
  const leftover = available - sizes.reduce((s, v) => s + v, 0);
  const autoCount = items.reduce(
    (n, { margin }) => n + (margin[before] === null ? 1 : 0) + (margin[after] === null ? 1 : 0),
    0,
  );
  const shares =
    autoCount > 0 && leftover > 0
      ? distributeInteger(
          Array.from({ length: autoCount }, () => 1),
          leftover,
        )
      : undefined;
  const offsets = shares
    ? mainAxisOffsets("start", sizes, 0)
    : mainAxisOffsets(justify, sizes, leftover);
  let shareIndex = 0;
  let marginOffset = 0;
  return items.map(({ margin }, i) => {
    marginOffset += margin[before] ?? (shares ? shares[shareIndex++]! : 0);
    const position = offsets[i]! + i * gap + marginOffset;
    marginOffset += margin[after] ?? (shares ? shares[shareIndex++]! : 0);
    return position;
  });
}

/**
 * Position each item along the main axis given its size and leftover
 * space. Returns the offset from container inner origin for each item.
 * Overflow alignment is always safe: a negative leftover aligns as start
 * (specs/cell-model.md deviation 21).
 */
export function mainAxisOffsets(
  justify: CellStyle["justifyContent"],
  sizes: number[],
  freeSpace: number,
): number[] {
  const leftover = Math.max(0, freeSpace);
  const count = sizes.length;
  if (count === 0) return [];

  const offsets: number[] = [];
  let cursor = 0;

  if (justify === "space-between" && count > 1 && leftover > 0) {
    const gapBase = Math.floor(leftover / (count - 1));
    const extra = leftover - gapBase * (count - 1);
    for (let i = 0; i < count; i++) {
      offsets.push(cursor);
      cursor += sizes[i]! + gapBase + (i < extra ? 1 : 0);
    }
    return offsets;
  }

  // space-around: every item gets equal space on both sides, so the edge
  // gaps are half the inner ones (weights 1,2,…,2,1 over the n+1 gap
  // slots). space-evenly: all n+1 gaps equal. Integer-distributed with the
  // shared remainder rule, so the result is deterministic.
  if ((justify === "space-around" || justify === "space-evenly") && leftover > 0) {
    const weights = Array.from({ length: count + 1 }, (_, i) =>
      justify === "space-evenly" || i === 0 || i === count ? 1 : 2,
    );
    const gaps = distributeInteger(weights, leftover);
    for (let i = 0; i < count; i++) {
      cursor += gaps[i]!;
      offsets.push(cursor);
      cursor += sizes[i]!;
    }
    return offsets;
  }

  if (justify === "center") cursor = Math.floor(leftover / 2);
  else if (justify === "end" || justify === "flex-end") cursor = leftover;

  for (let i = 0; i < count; i++) {
    offsets.push(cursor);
    cursor += sizes[i]!;
  }
  return offsets;
}

/**
 * Resolve flex main-axis sizes per CSS Flexbox §9.7 ("Resolving Flexible
 * Lengths"), adapted to integers: distribute free space proportionally to
 * grow factors (or shrink weights = base × shrink), clamp each result to the
 * item's own min/max, FREEZE the items whose clamp fired, and redistribute
 * among the rest — repeating until nothing new violates. Without the
 * redistribution rounds, an item clamped up to `min-w-*` would keep space
 * its neighbors were already told they could use, and boxes would overlap.
 *
 * `min`/`max` are outer main sizes in cells, already resolved from percent,
 * and `hypothetical` the base clamped by them. When clamps bind, the
 * returned sizes may sum to less or more than `available` — that's CSS
 * (`justify-content` sees the underfill; overflow handles the excess).
 */
export function resolveFlexMainAxis(
  items: ReadonlyArray<{
    base: number;
    grow: number;
    shrink: number;
    min?: number | undefined;
    max?: number | undefined;
    hypothetical: number;
  }>,
  available: number,
): number[] {
  const count = items.length;
  const clamp = (value: number, index: number) =>
    Math.max(0, clampSize(value, items[index]!.min ?? 0, items[index]!.max));
  const base = items.map((i) => i.base);
  // Grow vs shrink is decided from the HYPOTHETICAL sizes (clamped bases),
  // per CSS; distribution then starts from the raw bases.
  const hypotheticalTotal = items.reduce((s, item) => s + item.hypothetical, 0);
  const growing = available >= hypotheticalTotal;

  const sizes: number[] = Array.from({ length: count }, () => 0);
  const frozen: boolean[] = Array.from({ length: count }, () => false);
  // Pre-freeze inflexible items, and items whose base already violates in
  // the flex direction (max-violation when growing, min-violation when
  // shrinking), at their hypothetical size. A base merely BELOW its min
  // while growing stays flexible — it grows from the raw base and the
  // violation loop enforces the min afterwards.
  for (let i = 0; i < count; i++) {
    const hypothetical = items[i]!.hypothetical;
    const flexFactor = growing ? items[i]!.grow : items[i]!.shrink;
    if (
      flexFactor === 0 ||
      (growing && base[i]! > hypothetical) ||
      (!growing && base[i]! < hypothetical)
    ) {
      sizes[i] = hypothetical;
      frozen[i] = true;
    }
  }

  // Each round freezes at least one item, so this terminates within `count`
  // iterations.
  for (;;) {
    const unfrozen: number[] = [];
    for (let i = 0; i < count; i++) if (!frozen[i]) unfrozen.push(i);
    if (unfrozen.length === 0) break;

    const frozenTotal = sizes.reduce((s, v, i) => (frozen[i] ? s + v : s), 0);
    const unfrozenBaseTotal = unfrozen.reduce((s, i) => s + base[i]!, 0);
    const freeSpace = available - frozenTotal - unfrozenBaseTotal;
    const amount = growing ? Math.max(0, freeSpace) : Math.max(0, -freeSpace);

    const weights = unfrozen.map((i) => (growing ? items[i]!.grow : base[i]! * items[i]!.shrink));
    const shares = distributeInteger(weights, amount);
    const tentative = unfrozen.map((i, k) => base[i]! + (growing ? shares[k]! : -shares[k]!));
    const clamped = unfrozen.map((i, k) => clamp(tentative[k]!, i));
    const totalViolation = clamped.reduce((s, v, k) => s + (v - tentative[k]!), 0);

    if (totalViolation === 0) {
      for (let k = 0; k < unfrozen.length; k++) sizes[unfrozen[k]!] = clamped[k]!;
      break;
    }
    // Freeze only the violators on the dominant side (min violations when
    // the total is positive, max violations when negative) and go again.
    for (let k = 0; k < unfrozen.length; k++) {
      const violation = clamped[k]! - tentative[k]!;
      if (totalViolation > 0 ? violation > 0 : violation < 0) {
        sizes[unfrozen[k]!] = clamped[k]!;
        frozen[unfrozen[k]!] = true;
      }
    }
  }
  return sizes;
}

/**
 * Distribute `total` integer units across N slots proportionally to `weights`,
 * with the remainder (from flooring) given to the slots with the largest
 * fractional part — deterministic, document order for ties.
 */
export function distributeInteger(weights: number[], total: number): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const floored = raw.map(Math.floor);
  let deficit = total - floored.reduce((s, v) => s + v, 0);
  if (deficit > 0) {
    const order = raw
      .map((v, i) => [i, v - Math.floor(v)] as const)
      .sort((a, b) => (b[1] === a[1] ? a[0] - b[0] : b[1] - a[1]));
    for (const [i] of order) {
      if (deficit <= 0) break;
      floored[i]! += 1;
      deficit -= 1;
    }
  }
  return floored;
}

/** A flex item's cross alignment: its own align-self, else the parent's
 * align-items. */
export function effectiveAlign(child: LayoutNode, parent: LayoutNode): CellStyle["alignItems"] {
  return child.style.alignSelf === "auto" ? parent.style.alignItems : child.style.alignSelf;
}

/** Where a flex item sits in its line, or an out-of-flow child's static
 * position (`inLine` false): `stretch` as its fallback `flex-start`. */
export function lineAlign(
  child: LayoutNode,
  parent: LayoutNode,
  inLine = true,
): CellStyle["alignItems"] {
  const align = effectiveAlign(child, parent);
  const edge = align === "stretch" ? "flex-start" : align;
  return resolveFlexEdge(edge, parent.style.wrapReverse, inLine);
}

/** An item's cross offset in `container`: center floors the half
 * leftover and end takes it all — an overflowing item at the start, as
 * mainAxisOffsets aligns. */
export function alignCrossOffset(
  align: CellStyle["alignItems"],
  container: number,
  child: number,
): number {
  const leftover = Math.max(0, container - child);
  if (align === "center") return Math.floor(leftover / 2);
  if (align === "end" || align === "flex-end" || align === "last baseline") return leftover;
  return 0;
}

/**
 * A flex-row item's base main size, per CSS `flex-basis`: an explicit basis
 * if set, else the item's explicit width (cells, percent, or an intrinsic
 * keyword), else its max-content size. Percentages resolve against the
 * container's content box (`innerWidth`). The raw base: distribution
 * starts from it per CSS §9.7 (the freeze/violation loop clamps), which
 * keeps `flex-1` columns equal where their content minimums allow.
 */
function flexBaseOuterWidth(child: LayoutNode, innerWidth: number, cache: IntrinsicCache): number {
  const basis = child.style.flexBasis ?? child.style.width;
  return basis === undefined
    ? intrinsicOuterWidth(child, "max", cache)
    : resolveSizeAgainst(basis, innerWidth, child, cache);
}

/**
 * Flex item order: stable sort by CSS `order` (document order breaks
 * ties), then reversed for `row-reverse` / `column-reverse` — the main
 * axis runs backwards, so laying reversed children in a normal row with
 * flipped justify start/end is equivalent.
 */
function flexOrderedChildren(node: LayoutNode): LayoutNode[] {
  const children = node.children.filter(isInFlowBox).sort((a, b) => a.style.order - b.style.order);
  if (node.style.flexReverse) children.reverse();
  return children;
}

/** `flex-start` and `flex-end` as the start and end of an axis, swapped
 * where it runs backwards (the collection order is already reversed); a
 * baseline as them for an item in a flex line, its fallback elsewhere. */
export function resolveFlexEdge<T extends string>(
  value: T,
  backwards: boolean,
  inLine = false,
): T | "start" | "end" {
  if (value === "baseline" && !inLine) return "start";
  if (value === "last baseline" && !inLine) return "end";
  if (value === "flex-start" || value === "baseline") return backwards ? "end" : "start";
  if (value === "flex-end" || value === "last baseline") return backwards ? "start" : "end";
  return value;
}

/** A distribution over `count` subjects as its `flex-start` fallback
 * (css-align): `stretch`'s, and `space-between`'s for a sole one. */
function flexStartFallback<T extends string>(value: T, count: number): T | "flex-start" {
  return value === "stretch" || (value === "space-between" && count < 2) ? "flex-start" : value;
}

function effectiveAlignContent(style: CellStyle, lines: number): CellStyle["alignContent"] {
  return resolveFlexEdge(flexStartFallback(style.alignContent, lines), style.wrapReverse);
}

export function effectiveJustify(style: CellStyle, items: number): CellStyle["justifyContent"] {
  return resolveFlexEdge(flexStartFallback(style.justifyContent, items), style.flexReverse);
}

/**
 * The automatic minimum (`min-width/height: auto`, the CSS default) of a
 * flex or grid item on one axis (css-flexbox §4.5, css-grid §6.6): its
 * content size, capped by its specified size and its max; 0 for a scroll
 * container, which `truncate` makes too.
 */
export function automaticMinimum(
  overflow: CellStyle["overflow"]["x"],
  content: () => number,
  specified: number | undefined,
  max: number | undefined,
): number {
  if (overflow !== "visible") return 0;
  return Math.min(content(), specified ?? Infinity, max ?? Infinity);
}

/**
 * A flex-row item's used minimum width: an explicit `min-w-*`, else the
 * automatic minimum over its min-content width — which is why text in a
 * flex row stops shrinking at its longest segment instead of
 * disappearing. `max` is its resolved max-width.
 */
function flexItemMinWidth(
  child: LayoutNode,
  innerWidth: number,
  max: number | undefined,
  cache: IntrinsicCache,
): number {
  const { minWidth, width, overflow } = child.style;
  if (minWidth !== "auto") return resolveWidthLimit(minWidth, innerWidth, child, cache) ?? 0;
  const specified =
    width === undefined ? undefined : resolveSizeAgainst(width, innerWidth, child, cache);
  return automaticMinimum(
    overflow.x,
    () => intrinsicOuterWidth(child, "min", cache),
    specified,
    max,
  );
}
