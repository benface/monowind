import { percentToCells } from "./metrics.ts";
import { collectGapRuleRuns } from "./borders.ts";
import type { RuleSegment } from "./borders.ts";
import {
  clampSize,
  intrinsicOuterWidth,
  isOutOfFlow,
  layoutNode,
  minContentOuterWidth,
  resolveGap,
  resolveLength,
  resolveLimit,
  resolveMargin,
  resolveSizeAgainst,
} from "./layout.ts";
import type { IntrinsicCache } from "./layout.ts";
import type { CellStyle, Insets, LayoutNode, NullableInsets } from "./types.ts";

/**
 * Flexbox (specs/flex.md): row and column algorithms, CSS §9.7 flexible
 * length resolution, and the shared distribution/alignment helpers. See
 * layout.ts for the deliberate import cycle between the layout modules.
 */

export function layoutFlexRow(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  definiteInnerHeight: number | undefined,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const gapX = resolveGap(node.style, "x", innerWidth);
  const gapY = resolveGap(node.style, "y", innerHeight);
  const items = flexOrderedChildren(node).map((child) => {
    const margin = resolveMargin(child.style.margin, innerWidth);
    return {
      node: child,
      base: flexBaseOuterWidth(child, innerWidth, cache),
      grow: child.style.flexGrow,
      shrink: child.style.flexShrink,
      min: flexItemMinWidth(child, innerWidth, cache),
      max: resolveLimit(child.style.maxWidth, innerWidth),
      margin,
    };
  });

  // Break into rows greedily. With gap, an item breaks when `used + gap +
  // fixedMargins + base` exceeds innerWidth. The first item on a row is
  // always placed even if it alone overflows, matching CSS.
  const rows: (typeof items)[] = [];
  if (node.style.flexWrap === "wrap") {
    let current: typeof items = [];
    let used = 0;
    for (const item of items) {
      // Placement uses the hypothetical size (base clamped by min/max).
      const hypothetical = Math.max(0, clampSize(item.base, item.min, item.max));
      const itemWidth = hypothetical + (item.margin.left ?? 0) + (item.margin.right ?? 0);
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

  const originX = border.left + padding.left;
  const originY = border.top + padding.top;

  // Phase A: resolve each line's item widths, lay the items out, and take
  // the line's natural height (tallest item).
  const lines = rows.map((row) => {
    const totalGap = gapX * Math.max(0, row.length - 1);
    const fixedMarginTotal = row.reduce(
      (sum, item) => sum + (item.margin.left ?? 0) + (item.margin.right ?? 0),
      0,
    );
    const availableForItems = Math.max(0, innerWidth - totalGap - fixedMarginTotal);
    // Per CSS: if there's positive free space and any main-axis auto margin,
    // auto margins absorb the leftover BEFORE flex-grow. Detect that case and
    // keep items at their base size — the auto-margin loop below will
    // then distribute the leftover space itself.
    const rowHasAutoMainMargin = row.some(
      (item) => item.margin.left === null || item.margin.right === null,
    );
    const totalRowBase = row.reduce((s, i) => s + i.base, 0);
    const skipGrowForAutoMargins = rowHasAutoMainMargin && totalRowBase <= availableForItems;
    // When the distribution loop doesn't run, items take their HYPOTHETICAL
    // sizes (base clamped by min/max) — placement must agree with the sizes
    // the boxes actually get, not the raw bases.
    const widths = skipGrowForAutoMargins
      ? row.map((i) => Math.max(0, clampSize(i.base, i.min, i.max)))
      : resolveFlexMainAxis(row, availableForItems);
    for (let i = 0; i < row.length; i++) {
      layoutNode(row[i]!.node, innerWidth, definiteInnerHeight, 0, 0, "fill", cache, {
        width: widths[i]!,
      });
    }
    const height = row.reduce((h, item) => Math.max(h, item.node.localRect.height), 0);
    return { row, widths, availableForItems, height };
  });

  // Line heights and cross offsets (specs/flex.md step 9). A single nowrap
  // line stretches to a bounded inner height so items-center / items-end
  // have the enforced size to align against. A wrap-enabled ("multi-line",
  // per CSS — even with one line) container distributes bounded leftover
  // cross space per `align-content`: `stretch` grows the lines; the other
  // keywords offset them with the shared justify math.
  const rowHeights = lines.map((line) => line.height);
  const totalGapY = gapY * Math.max(0, lines.length - 1);
  let lineOffsets: number[];
  if (node.style.flexWrap === "nowrap") {
    if (Number.isFinite(innerHeight)) rowHeights[0] = Math.max(innerHeight, rowHeights[0] ?? 0);
    lineOffsets = [0];
  } else {
    const naturalTotal = rowHeights.reduce((s, h) => s + h, 0);
    const leftover = Number.isFinite(innerHeight)
      ? Math.max(0, innerHeight - naturalTotal - totalGapY)
      : 0;
    const alignContent = effectiveAlignContent(node.style);
    if (alignContent === "stretch" && leftover > 0) {
      const shares = distributeInteger(
        Array.from({ length: lines.length }, () => 1),
        leftover,
      );
      for (let i = 0; i < rowHeights.length; i++) rowHeights[i]! += shares[i]!;
      lineOffsets = mainAxisOffsets("start", rowHeights, 0);
    } else {
      lineOffsets = mainAxisOffsets(
        alignContent === "stretch" ? "start" : alignContent,
        rowHeights,
        leftover,
      );
    }
  }

  // Phase B: per line, stretch items to the (possibly grown) line height
  // and place them.
  for (let rowIndex = 0; rowIndex < lines.length; rowIndex++) {
    const { row, widths, availableForItems } = lines[rowIndex]!;
    const rowHeight = rowHeights[rowIndex]!;
    const y = lineOffsets[rowIndex]! + rowIndex * gapY;

    // Stretch phase: any item whose effective cross alignment is `stretch`
    // (no explicit height, no auto cross-axis margins) grows to fill the
    // row. Re-run layoutNode with the height forced so nested content that
    // depends on the parent's height sees the final size.
    for (let i = 0; i < row.length; i++) {
      const child = row[i]!.node;
      const align = effectiveAlign(child, node);
      const itemMargin = row[i]!.margin;
      const hasCrossAutoMargin = itemMargin.top === null || itemMargin.bottom === null;
      // Treat `{kind: "auto"}` as no explicit height (Typed OM returns this
      // for elements that don't set a height; only `cells`/`percent` counts
      // as an author-set size that stretch should respect).
      const hasExplicitHeight =
        child.style.height !== undefined && child.style.height.kind !== "auto";
      if (
        align === "stretch" &&
        !hasCrossAutoMargin &&
        !hasExplicitHeight &&
        rowHeight > child.localRect.height
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
    const totalUsed = widths.reduce((s, w) => s + w, 0);
    const leftover = Math.max(0, availableForItems - totalUsed);

    // Auto margins on the main axis absorb leftover space (each gets an
    // equal share). If any exist, they override justify-content.
    const autoCount = row.reduce(
      (n, item) => n + (item.margin.left === null ? 1 : 0) + (item.margin.right === null ? 1 : 0),
      0,
    );
    const autoMarginBefore: number[] = Array.from({ length: row.length }, () => 0);
    const autoMarginAfter: number[] = Array.from({ length: row.length }, () => 0);
    let offsets: number[];
    if (autoCount > 0 && leftover > 0) {
      const shares = distributeInteger(
        Array.from({ length: autoCount }, () => 1),
        leftover,
      );
      let shareIndex = 0;
      for (let i = 0; i < row.length; i++) {
        if (row[i]!.margin.left === null) autoMarginBefore[i] = shares[shareIndex++]!;
        if (row[i]!.margin.right === null) autoMarginAfter[i] = shares[shareIndex++]!;
      }
      offsets = mainAxisOffsets("start", widths, 0);
    } else {
      offsets = mainAxisOffsets(effectiveJustify(node.style), widths, leftover);
    }

    let cumulativeExtraOffset = 0;
    for (let i = 0; i < row.length; i++) {
      const item = row[i]!;
      const child = item.node;
      const fixedLeft = item.margin.left ?? 0;
      const fixedRight = item.margin.right ?? 0;
      cumulativeExtraOffset += autoMarginBefore[i]! + fixedLeft;
      child.localRect = {
        ...child.localRect,
        x: originX + offsets[i]! + i * gapX + cumulativeExtraOffset,
        y: originY + y + crossAxisOffset(child, node.style.alignItems, rowHeight, item.margin),
      };
      cumulativeExtraOffset += autoMarginAfter[i]! + fixedRight;
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
      const rects = lines[r]!.row.map((item) => item.node.localRect).sort((a, b) => a.x - b.x);
      for (let i = 1; i < rects.length; i++) {
        const bandStart = rects[i - 1]!.x + rects[i - 1]!.width - originX;
        const bandSize = rects[i]!.x - originX - bandStart;
        if (bandSize > 0)
          vertical.push({ bandStart, bandSize, start: top, end: top + rowHeights[r]! });
      }
      if (r > 0) {
        const prevBottom = lineOffsets[r - 1]! + (r - 1) * gapY + rowHeights[r - 1]!;
        if (top > prevBottom)
          horizontal.push({
            bandStart: prevBottom,
            bandSize: top - prevBottom,
            start: 0,
            end: innerWidth,
          });
      }
    }
    node.decorationRuns = collectGapRuleRuns({
      ruleX: node.style.ruleX,
      ruleY: node.style.ruleY,
      vertical,
      horizontal,
      contentWidth: innerWidth,
      contentHeight,
      border,
      borderStyle: node.style.borderStyle,
      borderColor: node.style.borderColor,
      padding,
    });
  }

  recordFlexStaticSlots(node, border, padding, innerWidth, contentHeight);
  return contentHeight;
}

/** Static slots for a flex container's out-of-flow children — the content
 * box plus alignment context, so the positioning pass can apply the CSS
 * "as if it were the sole flex item" rule once the box is sized. */
function recordFlexStaticSlots(
  node: LayoutNode,
  border: Insets,
  padding: Insets,
  innerWidth: number,
  contentHeight: number,
): void {
  for (const child of node.children) {
    if (!isOutOfFlow(child.style)) continue;
    child.staticSlot = {
      kind: "flex",
      direction: node.style.flexDirection,
      originX: border.left + padding.left,
      originY: border.top + padding.top,
      innerWidth,
      innerHeight: contentHeight,
    };
  }
}

export function layoutFlexColumn(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  heightIsDefinite: boolean,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const gapY = resolveGap(node.style, "y", innerHeight);

  const items = flexOrderedChildren(node).map((child) => {
    const margin = resolveMargin(child.style.margin, innerWidth);
    const availableChildWidth = Math.max(0, innerWidth - (margin.left ?? 0) - (margin.right ?? 0));
    // Per-item cross-axis (width) stretch decision: parent's alignItems is
    // the default, but a child's own alignSelf wins if set. So an item with
    // `self-start` inside a stretch parent shrinks to intrinsic, not fills.
    const childStretch = effectiveAlign(child, node) === "stretch";
    // First pass at intrinsic height along the main axis. A definite
    // container height is the basis for the child's percent height.
    layoutNode(
      child,
      availableChildWidth,
      heightIsDefinite && Number.isFinite(innerHeight) ? innerHeight : undefined,
      0,
      0,
      childStretch ? "fill" : "shrink",
      cache,
    );
    const limitBasis = Number.isFinite(innerHeight) ? innerHeight : undefined;
    // Base main size per CSS flex-basis: an explicit basis (cells, or
    // percent against a definite container height) wins; otherwise the
    // first-pass height BEFORE min/max clamping — distribution starts from
    // raw bases, the freeze loop enforces the limits.
    const basis = child.style.flexBasis;
    const base =
      basis === undefined || basis.kind === "auto"
        ? child.unclampedHeight
        : basis.kind === "cells"
          ? basis.value
          : basis.kind === "percent" && limitBasis !== undefined
            ? percentToCells(basis.value, limitBasis)
            : child.unclampedHeight;
    // `min-height: auto` on a column item is the automatic minimum: its
    // content height (the first-pass laid-out height), unless overflow is
    // non-visible. Same rule as the row's min-content width.
    const autoMin =
      child.style.minHeight === "auto"
        ? child.style.overflow === "visible"
          ? child.localRect.height
          : 0
        : undefined;
    return {
      node: child,
      base,
      grow: child.style.flexGrow,
      shrink: child.style.flexShrink,
      min: autoMin ?? resolveLimit(child.style.minHeight, limitBasis) ?? 0,
      max: resolveLimit(child.style.maxHeight, limitBasis),
      margin,
    };
  });

  const totalGap = gapY * Math.max(0, items.length - 1);
  const fixedMarginTotal = items.reduce(
    (sum, item) => sum + (item.margin.top ?? 0) + (item.margin.bottom ?? 0),
    0,
  );
  const finiteInner = Number.isFinite(innerHeight);
  const totalBaseHeight = items.reduce((s, i) => s + i.base, 0);
  const definiteAvailable = finiteInner
    ? Math.max(0, innerHeight - totalGap - fixedMarginTotal)
    : totalBaseHeight;
  // A min-height-only container size is a floor, not a cap: it can hand
  // extra space to flex-grow, but content larger than the floor keeps its
  // intrinsic size (no flex-shrink) and the container grows to fit.
  const availableForItems = heightIsDefinite
    ? definiteAvailable
    : Math.max(definiteAvailable, totalBaseHeight);

  // Same CSS rule as flex-row: auto margins on the main axis absorb positive
  // leftover before flex-grow gets to it.
  const columnHasAutoMainMargin = items.some(
    (item) => item.margin.top === null || item.margin.bottom === null,
  );
  const skipGrowForAutoMargins =
    finiteInner && columnHasAutoMainMargin && totalBaseHeight <= availableForItems;
  // Without distribution, items take their HYPOTHETICAL sizes (base clamped
  // by min/max) — stacking with raw bases would disagree with the heights
  // the boxes actually get (e.g. a min-h child would overlap its follower).
  const finalHeights =
    finiteInner && !skipGrowForAutoMargins
      ? resolveFlexMainAxis(items, availableForItems)
      : items.map((i) => Math.max(0, clampSize(i.base, i.min, i.max)));
  // If a child's main-axis size changed, re-run its layout with the new
  // height forced so any nested content that depends on the parent's height
  // (items-center/end in a nested flex, percent heights) sees the final size.
  for (let i = 0; i < items.length; i++) {
    if (finalHeights[i] !== items[i]!.node.localRect.height) {
      const item = items[i]!;
      const availableChildWidth = Math.max(
        0,
        innerWidth - (item.margin.left ?? 0) - (item.margin.right ?? 0),
      );
      const childStretch = effectiveAlign(item.node, node) === "stretch";
      layoutNode(
        item.node,
        availableChildWidth,
        finalHeights[i]!,
        0,
        0,
        childStretch ? "fill" : "shrink",
        cache,
        { height: finalHeights[i]! },
      );
    }
  }

  const totalUsed = finalHeights.reduce((s, h) => s + h, 0);
  const leftover = Math.max(0, availableForItems - totalUsed);

  const autoCount = items.reduce(
    (n, item) => n + (item.margin.top === null ? 1 : 0) + (item.margin.bottom === null ? 1 : 0),
    0,
  );
  const autoMarginBefore: number[] = Array.from({ length: items.length }, () => 0);
  const autoMarginAfter: number[] = Array.from({ length: items.length }, () => 0);
  let offsets: number[];
  if (autoCount > 0 && leftover > 0) {
    const shares = distributeInteger(
      Array.from({ length: autoCount }, () => 1),
      leftover,
    );
    let shareIndex = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i]!.margin.top === null) autoMarginBefore[i] = shares[shareIndex++]!;
      if (items[i]!.margin.bottom === null) autoMarginAfter[i] = shares[shareIndex++]!;
    }
    offsets = mainAxisOffsets("start", finalHeights, 0);
  } else {
    offsets = mainAxisOffsets(effectiveJustify(node.style), finalHeights, leftover);
  }

  const originX = border.left + padding.left;
  const originY = border.top + padding.top;
  let cumulativeExtraOffset = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const child = item.node;
    const fixedTop = item.margin.top ?? 0;
    const fixedBottom = item.margin.bottom ?? 0;
    cumulativeExtraOffset += autoMarginBefore[i]! + fixedTop;
    child.localRect = {
      ...child.localRect,
      x: originX + crossAxisOffsetX(child, node.style.alignItems, innerWidth, item.margin),
      y: originY + offsets[i]! + i * gapY + cumulativeExtraOffset,
    };
    cumulativeExtraOffset += autoMarginAfter[i]! + fixedBottom;
  }

  const totalOccupied = totalUsed + totalGap + fixedMarginTotal;
  const contentHeight = finiteInner ? Math.max(innerHeight, totalOccupied) : totalOccupied;

  // Gap rules: horizontal bands between stacked items, full content
  // width (the single column's cross extent).
  if (node.style.ruleY && items.length > 1) {
    const horizontal: RuleSegment[] = [];
    const rects = items
      .map((item) => item.node.localRect)
      .slice()
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < rects.length; i++) {
      const bandStart = rects[i - 1]!.y + rects[i - 1]!.height - originY;
      const bandSize = rects[i]!.y - originY - bandStart;
      if (bandSize > 0) horizontal.push({ bandStart, bandSize, start: 0, end: innerWidth });
    }
    node.decorationRuns = collectGapRuleRuns({
      ruleX: null,
      ruleY: node.style.ruleY,
      vertical: [],
      horizontal,
      contentWidth: innerWidth,
      contentHeight,
      border,
      borderStyle: node.style.borderStyle,
      borderColor: node.style.borderColor,
      padding,
    });
  }

  recordFlexStaticSlots(node, border, padding, innerWidth, contentHeight);
  return contentHeight;
}

/**
 * Compute a child's cross-axis (vertical) offset inside a flex row, honoring
 * align-self override, cross-axis auto margins, and fixed cross-axis margins.
 */
function crossAxisOffset(
  child: LayoutNode,
  parentAlign: CellStyle["alignItems"],
  rowHeight: number,
  m: NullableInsets,
): number {
  const align = child.style.alignSelf === "auto" ? parentAlign : child.style.alignSelf;
  const marginTop = m.top ?? 0;
  const marginBottom = m.bottom ?? 0;
  const crossAvailable = rowHeight - child.localRect.height;
  const bothAuto = m.top === null && m.bottom === null;
  const oneAutoTop = m.top === null && m.bottom !== null;
  const oneAutoBottom = m.bottom === null && m.top !== null;
  if (bothAuto) return Math.floor(crossAvailable / 2);
  if (oneAutoTop) return crossAvailable - marginBottom;
  if (oneAutoBottom) return marginTop;
  return marginTop + alignCrossOffset(align, rowHeight, child.localRect.height);
}

/**
 * Symmetric helper for flex-column: cross axis is horizontal, so auto/fixed
 * margins on `left`/`right` participate.
 */
function crossAxisOffsetX(
  child: LayoutNode,
  parentAlign: CellStyle["alignItems"],
  containerWidth: number,
  m: NullableInsets,
): number {
  const align = child.style.alignSelf === "auto" ? parentAlign : child.style.alignSelf;
  const marginLeft = m.left ?? 0;
  const marginRight = m.right ?? 0;
  const crossAvailable = containerWidth - child.localRect.width;
  const bothAuto = m.left === null && m.right === null;
  const oneAutoLeft = m.left === null && m.right !== null;
  const oneAutoRight = m.right === null && m.left !== null;
  if (bothAuto) return Math.floor(crossAvailable / 2);
  if (oneAutoLeft) return crossAvailable - marginRight;
  if (oneAutoRight) return marginLeft;
  return marginLeft + alignCrossOffset(align, containerWidth, child.localRect.width);
}

/**
 * Position each item along the main axis given its size and leftover space.
 * Returns the offset from container inner origin for each item.
 */
export function mainAxisOffsets(
  justify: CellStyle["justifyContent"],
  sizes: number[],
  leftover: number,
): number[] {
  const count = sizes.length;
  if (count === 0) return [];

  const offsets: number[] = [];
  let cursor = 0;

  if (justify === "space-between" && count > 1) {
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
  else if (justify === "end") cursor = leftover;

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
 * `min`/`max` are outer main sizes in cells, already resolved from percent.
 * When clamps bind, the returned sizes may sum to less or more than
 * `available` — that's CSS (`justify-content` sees the underfill; overflow
 * handles the excess).
 */
export function resolveFlexMainAxis(
  items: ReadonlyArray<{
    base: number;
    grow: number;
    shrink: number;
    min?: number | undefined;
    max?: number | undefined;
  }>,
  available: number,
): number[] {
  const count = items.length;
  const clamp = (value: number, index: number) =>
    Math.max(0, clampSize(value, items[index]!.min ?? 0, items[index]!.max));
  const base = items.map((i) => i.base);
  // Grow vs shrink is decided from the HYPOTHETICAL sizes (clamped bases),
  // per CSS; distribution then starts from the raw bases.
  const hypotheticalTotal = base.reduce((s, b, i) => s + clamp(b, i), 0);
  const growing = available >= hypotheticalTotal;

  const sizes: number[] = Array.from({ length: count }, () => 0);
  const frozen: boolean[] = Array.from({ length: count }, () => false);
  // Pre-freeze inflexible items, and items whose base already violates in
  // the flex direction (max-violation when growing, min-violation when
  // shrinking), at their hypothetical size. A base merely BELOW its min
  // while growing stays flexible — it grows from the raw base and the
  // violation loop enforces the min afterwards.
  for (let i = 0; i < count; i++) {
    const hypothetical = clamp(base[i]!, i);
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
  return child.style.alignSelf === "auto"
    ? parent.style.alignItems
    : (child.style.alignSelf as CellStyle["alignItems"]);
}

export function alignCrossOffset(
  align: CellStyle["alignItems"],
  container: number,
  child: number,
): number {
  if (align === "center") return Math.max(0, Math.floor((container - child) / 2));
  if (align === "end") return Math.max(0, container - child);
  return 0;
}

/**
 * A flex-row item's base main size, per CSS `flex-basis`: an explicit basis
 * if set, else the item's explicit width (cells, percent, or an intrinsic
 * keyword), else its max-content size. Percentages resolve against the
 * container's content box (`innerWidth`). NOT clamped by min/max —
 * distribution starts from the raw base per CSS §9.7 (clamping happens via
 * the freeze/violation loop); pre-clamping would e.g. leave `flex-1`
 * columns unequal at their content minimums.
 */
function flexBaseOuterWidth(child: LayoutNode, innerWidth: number, cache: IntrinsicCache): number {
  const basis = child.style.flexBasis;
  const width = child.style.width;
  if (basis !== undefined && basis.kind !== "auto") {
    return resolveSizeAgainst(basis, innerWidth, child, cache);
  }
  if (width !== undefined && width.kind !== "auto") {
    return resolveSizeAgainst(width, innerWidth, child, cache);
  }
  return intrinsicOuterWidth(child, cache);
}

/**
 * Flex item order: stable sort by CSS `order` (document order breaks
 * ties), then reversed for `row-reverse` / `column-reverse` — the main
 * axis runs backwards, so laying reversed children in a normal row with
 * flipped justify start/end is equivalent.
 */
function flexOrderedChildren(node: LayoutNode): LayoutNode[] {
  const children = node.children
    .filter((c) => !isOutOfFlow(c.style))
    .sort((a, b) => a.style.order - b.style.order);
  if (node.style.flexReverse) children.reverse();
  return children;
}

/** wrap-reverse runs the cross axis backwards: start/end swap, the
 * symmetric values are unaffected (the line order is already reversed at
 * collection time). */
function effectiveAlignContent(style: CellStyle): CellStyle["alignContent"] {
  if (!style.wrapReverse) return style.alignContent;
  if (style.alignContent === "start") return "end";
  if (style.alignContent === "end") return "start";
  return style.alignContent;
}

export function effectiveJustify(style: CellStyle): CellStyle["justifyContent"] {
  // `stretch` (CSS `normal`/`stretch`) behaves as `start` in flex, per
  // css-align — normalize before the reverse flip so `row-reverse` still
  // packs from the main-start (right) edge under the default value.
  const justify = style.justifyContent === "stretch" ? "start" : style.justifyContent;
  if (!style.flexReverse) return justify;
  if (justify === "start") return "end";
  if (justify === "end") return "start";
  return justify;
}

/**
 * A flex-row item's used minimum width. `min-width: auto` (the CSS default)
 * is the automatic minimum: the item's min-content size — which is why text
 * in a flex row stops shrinking at its longest segment instead of
 * disappearing. It only applies while overflow is visible: `overflow` set
 * to anything else (e.g. via `truncate`) or an explicit `min-w-*` opts out.
 */
function flexItemMinWidth(child: LayoutNode, innerWidth: number, cache: IntrinsicCache): number {
  if (child.style.minWidth === "auto") {
    return child.style.overflow === "visible" ? minContentOuterWidth(child, cache) : 0;
  }
  return resolveLimit(child.style.minWidth, innerWidth) ?? 0;
}
