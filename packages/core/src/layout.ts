import { percentToCells } from "./metrics.ts";
import { wrapLineCount } from "./wrap.ts";
import type { CellStyle, Insets, LayoutNode } from "./types.ts";

/**
 * Layout entry point: mutates localRect on the root and each descendant.
 * Coordinates are parent-relative (root's rect is at 0,0).
 */
export function layoutRoot(root: LayoutNode, availableWidth: number): { height: number } {
  const cache: IntrinsicCache = new WeakMap();
  layoutNode(root, availableWidth, undefined, 0, 0, "fill", cache);
  return { height: root.localRect.height };
}

type SizingMode = "fill" | "shrink";
type IntrinsicCache = WeakMap<LayoutNode, number>;

function layoutNode(
  node: LayoutNode,
  availableWidth: number,
  availableHeight: number | undefined,
  parentX: number,
  parentY: number,
  widthMode: SizingMode,
  cache: IntrinsicCache,
  forcedHeight?: number,
): void {
  const style = node.style;

  const outerWidth = resolveWidth(style, availableWidth, widthMode, () =>
    intrinsicOuterWidth(node, cache),
  );
  const outerHeightExplicit = resolveHeight(style, availableHeight);
  // A `forcedHeight` (set by a parent flex-column when grow/shrink assigned a
  // main-axis size) overrides both explicit `height` and `min-height` — the
  // flex algorithm's "used main size" is authoritative. Otherwise, `min-height`
  // is a lower bound so items-center / items-end see the enforced size, not
  // just the natural content size.
  const outerHeightFloor =
    forcedHeight ?? outerHeightExplicit ?? (style.minHeight > 0 ? style.minHeight : undefined);

  const inner = shrinkSize(
    outerWidth,
    outerHeightFloor ?? Number.POSITIVE_INFINITY,
    style.border,
    style.padding,
  );

  let contentHeight: number;
  if (node.children.length === 0) {
    contentHeight = node.text ? wrapLineCount(node.text, inner.width) : node.intrinsicHeight;
  } else if (style.display === "flex" && style.flexDirection === "row") {
    contentHeight = layoutFlexRow(
      node,
      inner.width,
      inner.height,
      style.border,
      style.padding,
      cache,
    );
  } else if (style.display === "flex" && style.flexDirection === "column") {
    contentHeight = layoutFlexColumn(
      node,
      inner.width,
      inner.height,
      style.border,
      style.padding,
      cache,
    );
  } else {
    contentHeight = layoutBlock(node, inner.width, style.border, style.padding, cache);
  }

  const naturalHeight =
    contentHeight +
    style.border.top +
    style.border.bottom +
    style.padding.top +
    style.padding.bottom;
  // Order matters: min-* is a floor, max-* is a ceiling; when both apply,
  // max wins per CSS (min-width < max-width is required, but if the author
  // sets an inconsistent pair CSS clamps to `max(min, min(max, value))`).
  const finalHeight = clampSize(
    forcedHeight ?? outerHeightExplicit ?? naturalHeight,
    style.minHeight,
    style.maxHeight,
  );
  const finalWidth = clampSize(outerWidth, style.minWidth, style.maxWidth);

  node.localRect = { x: parentX, y: parentY, width: finalWidth, height: finalHeight };
}

function clampSize(value: number, min: number, max: number | undefined): number {
  const clamped = max !== undefined ? Math.min(value, max) : value;
  return Math.max(min, clamped);
}

/**
 * Lay out children in vertical block flow. Returns content height (rows used).
 *
 * - Vertical (main-axis) margins on adjacent siblings **collapse** — the
 *   effective gap is `max(prev.bottom, curr.top)` for two positives, `min`
 *   for two negatives, and the sum for mixed signs (standard CSS rule).
 *   Parent–child collapsing is intentionally NOT implemented (see the cell-
 *   model spec's Deviations section).
 * - Horizontal (cross-axis) margins position the child; `auto` on either
 *   side centers or end-aligns as CSS does.
 */
function layoutBlock(
  node: LayoutNode,
  innerWidth: number,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const originX = border.left + padding.left;
  const startY = border.top + padding.top;
  let y = startY;
  let previousMarginBottom: number | null = null;
  for (const child of node.children) {
    const childMargin = child.style.margin;
    const marginTop = childMargin.top ?? 0;
    const marginBottom = childMargin.bottom ?? 0;
    const marginLeft = childMargin.left ?? 0;
    const marginRight = childMargin.right ?? 0;
    layoutNode(
      child,
      Math.max(0, innerWidth - marginLeft - marginRight),
      undefined,
      0,
      0,
      "fill",
      cache,
    );
    const crossAvailable = innerWidth - child.localRect.width;
    const bothAutoX = childMargin.left === null && childMargin.right === null;
    const oneAutoLeft = childMargin.left === null && childMargin.right !== null;
    const oneAutoRight = childMargin.right === null && childMargin.left !== null;
    let crossOffset: number;
    if (bothAutoX) crossOffset = Math.floor(crossAvailable / 2);
    else if (oneAutoLeft) crossOffset = crossAvailable - marginRight;
    else if (oneAutoRight) crossOffset = marginLeft;
    else crossOffset = marginLeft;

    // `y` tracks the position where the next child's top edge goes. Margins
    // are added JUST BEFORE placing each child, then only the child's height
    // afterwards — the child's own bottom margin waits until the next
    // sibling (or the end-of-container) so we can collapse them properly.
    y +=
      previousMarginBottom === null ? marginTop : collapseMargins(previousMarginBottom, marginTop);
    child.localRect = { ...child.localRect, x: originX + crossOffset, y };
    y += child.localRect.height;
    previousMarginBottom = marginBottom;
  }
  if (previousMarginBottom !== null) y += previousMarginBottom;
  return y - startY;
}

/**
 * CSS margin-collapsing rule for two adjacent block-flow margins:
 * - both positive → the larger absorbs the smaller.
 * - both negative → the more negative absorbs the less negative.
 * - mixed → they sum (positive shrunk by the negative).
 */
function collapseMargins(a: number, b: number): number {
  if (a >= 0 && b >= 0) return Math.max(a, b);
  if (a <= 0 && b <= 0) return Math.min(a, b);
  return a + b;
}

function layoutFlexRow(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const gapX = node.style.gapX;
  const gapY = node.style.gapY;
  const items = node.children.map((child) => ({
    node: child,
    intrinsic: intrinsicOuterWidth(child, cache),
    grow: child.style.flexGrow,
    shrink: child.style.flexShrink,
    marginLeft: child.style.margin.left,
    marginRight: child.style.margin.right,
  }));

  // Break into rows greedily. With gap, an item breaks when `used + gap +
  // fixedMargins + intrinsic` exceeds innerWidth. The first item on a row is
  // always placed even if it alone overflows, matching CSS.
  const rows: (typeof items)[] = [];
  if (node.style.flexWrap === "wrap") {
    let current: typeof items = [];
    let used = 0;
    for (const item of items) {
      const itemWidth = item.intrinsic + (item.marginLeft ?? 0) + (item.marginRight ?? 0);
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
  } else {
    rows.push(items);
  }

  const originX = border.left + padding.left;
  const originY = border.top + padding.top;
  let y = 0;
  let totalRowHeight = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]!;
    const totalGap = gapX * Math.max(0, row.length - 1);
    const fixedMarginTotal = row.reduce(
      (sum, item) => sum + (item.marginLeft ?? 0) + (item.marginRight ?? 0),
      0,
    );
    const availableForItems = Math.max(0, innerWidth - totalGap - fixedMarginTotal);
    // Per CSS: if there's positive free space and any main-axis auto margin,
    // auto margins absorb the leftover BEFORE flex-grow. Detect that case and
    // keep items at their intrinsic size — the auto-margin loop below will
    // then distribute the leftover space itself.
    const rowHasAutoMainMargin = row.some(
      (item) => item.marginLeft === null || item.marginRight === null,
    );
    const totalRowIntrinsic = row.reduce((s, i) => s + i.intrinsic, 0);
    const skipGrowForAutoMargins = rowHasAutoMainMargin && totalRowIntrinsic <= availableForItems;
    const widths = skipGrowForAutoMargins
      ? row.map((i) => i.intrinsic)
      : resolveFlexMainAxis(row, availableForItems);
    for (let i = 0; i < row.length; i++) {
      layoutNode(row[i]!.node, widths[i]!, undefined, 0, 0, "fill", cache);
    }
    const maxChildHeight = row.reduce((h, item) => Math.max(h, item.node.localRect.height), 0);
    // For a nowrap single row, the row can stretch to the container's inner
    // height (from min-h or explicit height) so items-center / items-end
    // have the enforced size to align against. With wrap, each row's height
    // is just its tallest child.
    const rowHeight =
      rows.length === 1 && Number.isFinite(innerHeight)
        ? Math.max(innerHeight, maxChildHeight)
        : maxChildHeight;

    // Stretch phase: any item whose effective cross alignment is `stretch`
    // (no explicit height, no auto cross-axis margins) grows to fill the
    // row. Re-run layoutNode with `forcedHeight` so nested content that
    // depends on the parent's height sees the final size.
    for (let i = 0; i < row.length; i++) {
      const child = row[i]!.node;
      const effectiveAlign =
        child.style.alignSelf === "auto" ? node.style.alignItems : child.style.alignSelf;
      const hasCrossAutoMargin =
        child.style.margin.top === null || child.style.margin.bottom === null;
      // Treat `{kind: "auto"}` as no explicit height (Typed OM returns this
      // for elements that don't set a height; only `cells`/`percent` counts
      // as an author-set size that stretch should respect).
      const hasExplicitHeight =
        child.style.height !== undefined && child.style.height.kind !== "auto";
      if (
        effectiveAlign === "stretch" &&
        !hasCrossAutoMargin &&
        !hasExplicitHeight &&
        rowHeight > child.localRect.height
      ) {
        const marginTop = child.style.margin.top ?? 0;
        const marginBottom = child.style.margin.bottom ?? 0;
        const stretchedHeight = Math.max(0, rowHeight - marginTop - marginBottom);
        layoutNode(child, widths[i]!, undefined, 0, 0, "fill", cache, stretchedHeight);
      }
    }
    const totalUsed = widths.reduce((s, w) => s + w, 0);
    const leftover = Math.max(0, availableForItems - totalUsed);

    // Auto margins on the main axis absorb leftover space (each gets an
    // equal share). If any exist, they override justify-content.
    const autoCount = row.reduce(
      (n, item) => n + (item.marginLeft === null ? 1 : 0) + (item.marginRight === null ? 1 : 0),
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
        if (row[i]!.marginLeft === null) autoMarginBefore[i] = shares[shareIndex++]!;
        if (row[i]!.marginRight === null) autoMarginAfter[i] = shares[shareIndex++]!;
      }
      offsets = mainAxisOffsets("start", widths, 0);
    } else {
      offsets = mainAxisOffsets(node.style.justifyContent, widths, leftover);
    }

    let cumulativeExtraOffset = 0;
    for (let i = 0; i < row.length; i++) {
      const item = row[i]!;
      const child = item.node;
      const fixedLeft = item.marginLeft ?? 0;
      const fixedRight = item.marginRight ?? 0;
      cumulativeExtraOffset += autoMarginBefore[i]! + fixedLeft;
      child.localRect = {
        ...child.localRect,
        x: originX + offsets[i]! + i * gapX + cumulativeExtraOffset,
        y: originY + y + crossAxisOffset(child, node.style.alignItems, rowHeight),
      };
      cumulativeExtraOffset += autoMarginAfter[i]! + fixedRight;
    }
    const rowSpacing = rowIndex < rows.length - 1 ? gapY : 0;
    y += rowHeight + rowSpacing;
    totalRowHeight += rowHeight + rowSpacing;
  }

  return Number.isFinite(innerHeight) ? Math.max(innerHeight, totalRowHeight) : totalRowHeight;
}

function layoutFlexColumn(
  node: LayoutNode,
  innerWidth: number,
  innerHeight: number,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const gapY = node.style.gapY;

  const items = node.children.map((child) => {
    const marginLeft = child.style.margin.left ?? 0;
    const marginRight = child.style.margin.right ?? 0;
    const availableChildWidth = Math.max(0, innerWidth - marginLeft - marginRight);
    // Per-item cross-axis (width) stretch decision: parent's alignItems is
    // the default, but a child's own alignSelf wins if set. So an item with
    // `self-start` inside a stretch parent shrinks to intrinsic, not fills.
    const effectiveAlign =
      child.style.alignSelf === "auto" ? node.style.alignItems : child.style.alignSelf;
    const childStretch = effectiveAlign === "stretch";
    // First pass at intrinsic height along the main axis.
    layoutNode(
      child,
      availableChildWidth,
      undefined,
      0,
      0,
      childStretch ? "fill" : "shrink",
      cache,
    );
    return {
      node: child,
      intrinsic: child.localRect.height,
      grow: child.style.flexGrow,
      shrink: child.style.flexShrink,
      marginTop: child.style.margin.top,
      marginBottom: child.style.margin.bottom,
      marginLeft,
      marginRight,
    };
  });

  const totalGap = gapY * Math.max(0, items.length - 1);
  const fixedMarginTotal = items.reduce(
    (sum, item) => sum + (item.marginTop ?? 0) + (item.marginBottom ?? 0),
    0,
  );
  const finiteInner = Number.isFinite(innerHeight);
  const totalIntrinsicHeight = items.reduce((s, i) => s + i.intrinsic, 0);
  const availableForItems = finiteInner
    ? Math.max(0, innerHeight - totalGap - fixedMarginTotal)
    : totalIntrinsicHeight;

  // Same CSS rule as flex-row: auto margins on the main axis absorb positive
  // leftover before flex-grow gets to it.
  const columnHasAutoMainMargin = items.some(
    (item) => item.marginTop === null || item.marginBottom === null,
  );
  const skipGrowForAutoMargins =
    finiteInner && columnHasAutoMainMargin && totalIntrinsicHeight <= availableForItems;
  const finalHeights =
    finiteInner && !skipGrowForAutoMargins
      ? resolveFlexMainAxis(items, availableForItems)
      : items.map((i) => i.intrinsic);
  // If a child's main-axis size changed, re-run its layout with the new
  // height forced so any nested content that depends on the parent's height
  // (items-center/end in a nested flex, percent heights) sees the final size.
  for (let i = 0; i < items.length; i++) {
    if (finalHeights[i] !== items[i]!.intrinsic) {
      const item = items[i]!;
      const availableChildWidth = Math.max(0, innerWidth - item.marginLeft - item.marginRight);
      const effectiveAlign =
        item.node.style.alignSelf === "auto" ? node.style.alignItems : item.node.style.alignSelf;
      const childStretch = effectiveAlign === "stretch";
      layoutNode(
        item.node,
        availableChildWidth,
        finalHeights[i]!,
        0,
        0,
        childStretch ? "fill" : "shrink",
        cache,
        finalHeights[i],
      );
    }
  }

  const totalUsed = finalHeights.reduce((s, h) => s + h, 0);
  const leftover = Math.max(0, availableForItems - totalUsed);

  const autoCount = items.reduce(
    (n, item) => n + (item.marginTop === null ? 1 : 0) + (item.marginBottom === null ? 1 : 0),
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
      if (items[i]!.marginTop === null) autoMarginBefore[i] = shares[shareIndex++]!;
      if (items[i]!.marginBottom === null) autoMarginAfter[i] = shares[shareIndex++]!;
    }
    offsets = mainAxisOffsets("start", finalHeights, 0);
  } else {
    offsets = mainAxisOffsets(node.style.justifyContent, finalHeights, leftover);
  }

  const originX = border.left + padding.left;
  const originY = border.top + padding.top;
  let cumulativeExtraOffset = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const child = item.node;
    const fixedTop = item.marginTop ?? 0;
    const fixedBottom = item.marginBottom ?? 0;
    cumulativeExtraOffset += autoMarginBefore[i]! + fixedTop;
    child.localRect = {
      ...child.localRect,
      x: originX + crossAxisOffsetX(child, node.style.alignItems, innerWidth),
      y: originY + offsets[i]! + i * gapY + cumulativeExtraOffset,
    };
    cumulativeExtraOffset += autoMarginAfter[i]! + fixedBottom;
  }

  const totalOccupied = totalUsed + totalGap + fixedMarginTotal;
  return finiteInner ? Math.max(innerHeight, totalOccupied) : totalOccupied;
}

/**
 * Compute a child's cross-axis (vertical) offset inside a flex row, honoring
 * align-self override, cross-axis auto margins, and fixed cross-axis margins.
 */
function crossAxisOffset(
  child: LayoutNode,
  parentAlign: CellStyle["alignItems"],
  rowHeight: number,
): number {
  const align = child.style.alignSelf === "auto" ? parentAlign : child.style.alignSelf;
  const m = child.style.margin;
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
): number {
  const align = child.style.alignSelf === "auto" ? parentAlign : child.style.alignSelf;
  const m = child.style.margin;
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
function mainAxisOffsets(
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

  if (justify === "center") cursor = Math.floor(leftover / 2);
  else if (justify === "end") cursor = leftover;

  for (let i = 0; i < count; i++) {
    offsets.push(cursor);
    cursor += sizes[i]!;
  }
  return offsets;
}

/**
 * Resolve final main-axis sizes for flex items given the available space.
 *
 * - Extra space is distributed to items with `flex-grow > 0`, proportionally.
 * - Missing space (overflow) is distributed to items with `flex-shrink > 0`,
 *   proportionally to `intrinsic * shrink`. Items with `flex-shrink: 0` keep
 *   their intrinsic size (row can then overflow — that's real CSS behavior).
 * - Neither grows nor shrinks: items keep intrinsic sizes.
 */
export function resolveFlexMainAxis(
  items: ReadonlyArray<{ intrinsic: number; grow: number; shrink: number }>,
  available: number,
): number[] {
  const totalIntrinsic = items.reduce((s, i) => s + i.intrinsic, 0);
  const diff = available - totalIntrinsic;
  if (diff === 0) return items.map((i) => i.intrinsic);

  if (diff > 0) {
    const totalGrow = items.reduce((s, i) => s + i.grow, 0);
    if (totalGrow === 0) return items.map((i) => i.intrinsic);
    const growths = distributeInteger(
      items.map((i) => i.grow),
      diff,
    );
    return items.map((i, idx) => i.intrinsic + growths[idx]!);
  }

  const totalShrinkWeight = items.reduce((s, i) => s + i.intrinsic * i.shrink, 0);
  if (totalShrinkWeight === 0) return items.map((i) => i.intrinsic);
  const shortfall = -diff;
  const weights = items.map((i) => i.intrinsic * i.shrink);
  const shrinks = distributeInteger(weights, shortfall);
  return items.map((i, idx) => Math.max(0, i.intrinsic - shrinks[idx]!));
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

function alignCrossOffset(
  align: CellStyle["alignItems"],
  container: number,
  child: number,
): number {
  if (align === "center") return Math.max(0, Math.floor((container - child) / 2));
  if (align === "end") return Math.max(0, container - child);
  return 0;
}

function resolveWidth(
  style: CellStyle,
  available: number,
  mode: SizingMode,
  intrinsic: () => number,
): number {
  if (style.width?.kind === "cells") return style.width.value;
  if (style.width?.kind === "percent") return percentToCells(style.width.value, available);
  return mode === "shrink" ? Math.min(available, intrinsic()) : available;
}

function resolveHeight(style: CellStyle, available: number | undefined): number | undefined {
  if (style.height?.kind === "cells") return style.height.value;
  if (style.height?.kind === "percent" && available != null)
    return percentToCells(style.height.value, available);
  return undefined;
}

/** Content-based intrinsic outer width (border + padding + intrinsic content). */
function intrinsicOuterWidth(node: LayoutNode, cache: IntrinsicCache): number {
  const cached = cache.get(node);
  if (cached !== undefined) return cached;
  const style = node.style;
  const inner = intrinsicInnerWidth(node, cache);
  const result =
    inner + style.border.left + style.border.right + style.padding.left + style.padding.right;
  cache.set(node, result);
  return result;
}

function intrinsicInnerWidth(node: LayoutNode, cache: IntrinsicCache): number {
  if (node.children.length === 0) return node.intrinsicWidth;
  if (node.style.display === "flex" && node.style.flexDirection === "row") {
    const gap = node.style.gapX * Math.max(0, node.children.length - 1);
    return node.children.reduce((sum, c) => sum + intrinsicOuterWidth(c, cache), 0) + gap;
  }
  return node.children.reduce((max, c) => Math.max(max, intrinsicOuterWidth(c, cache)), 0);
}

function shrinkSize(
  width: number,
  height: number,
  border: Insets,
  padding: Insets,
): { width: number; height: number } {
  return {
    width: Math.max(0, width - border.left - border.right - padding.left - padding.right),
    height: Math.max(0, height - border.top - border.bottom - padding.top - padding.bottom),
  };
}
