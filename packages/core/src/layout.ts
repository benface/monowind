import { percentToCells } from "./metrics.ts";
import { breakableSegments, wrapLineCount } from "./wrap.ts";
import type {
  CellLength,
  CellStyle,
  Insets,
  LayoutNode,
  NullableInsets,
  PerSide,
  Size,
} from "./types.ts";

/**
 * Layout entry point: mutates localRect on the root and each descendant.
 * Coordinates are parent-relative (root's rect is at 0,0).
 */
export function layoutRoot(root: LayoutNode, availableWidth: number): { height: number } {
  const cache: IntrinsicCache = { maxContent: new WeakMap(), minContent: new WeakMap() };
  layoutNode(root, availableWidth, undefined, 0, 0, "fill", cache);
  return { height: root.localRect.height };
}

type SizingMode = "fill" | "shrink";
interface IntrinsicCache {
  maxContent: WeakMap<LayoutNode, number>;
  minContent: WeakMap<LayoutNode, number>;
}

/**
 * `forced` carries flex-assigned ("used") sizes from a parent flex pass —
 * they are authoritative and skip resolution/clamping entirely (the flex
 * loop already applied min/max). With sizes forced, `availableWidth` stays
 * the CONTAINING BLOCK's content width, which percent padding, margins,
 * and min/max resolve against — never the assigned size itself.
 */
function layoutNode(
  node: LayoutNode,
  availableWidth: number,
  availableHeight: number | undefined,
  parentX: number,
  parentY: number,
  widthMode: SizingMode,
  cache: IntrinsicCache,
  forced?: { width?: number | undefined; height?: number | undefined },
): void {
  const style = node.style;
  const forcedHeight = forced?.height;

  // Width is clamped to min/max BEFORE laying out content — wrapping and
  // child sizing must see the constrained width, not the raw resolved one.
  // (Height differs: max-height clamps the final rect after layout, since
  // content height is an output, and overflow handles the spill.)
  // Percent min/max (`max-w-full`) resolve against the available size; a
  // percent height limit with indefinite available height is ignored, per CSS.
  const minWidth = resolveLimit(style.minWidth, availableWidth) ?? 0;
  const maxWidth = resolveLimit(style.maxWidth, availableWidth);
  const minHeight = resolveLimit(style.minHeight, availableHeight) ?? 0;
  const maxHeight = resolveLimit(style.maxHeight, availableHeight);
  // Percent padding resolves against the containing block's width (CSS: all
  // four sides use the inline size) — `availableWidth` is that width here.
  // Stored on the node because the renderers need the resolved cells too.
  const padding: Insets = {
    top: resolveLength(style.padding.top, availableWidth),
    right: resolveLength(style.padding.right, availableWidth),
    bottom: resolveLength(style.padding.bottom, availableWidth),
    left: resolveLength(style.padding.left, availableWidth),
  };
  node.resolvedPadding = padding;
  const outerWidth =
    forced?.width ??
    clampSize(resolveWidth(style, availableWidth, widthMode, node, cache), minWidth, maxWidth);
  const outerHeightExplicit = resolveHeight(style, availableHeight);
  // A `forcedHeight` (set by a parent flex-column when grow/shrink assigned a
  // main-axis size) overrides both explicit `height` and `min-height` — the
  // flex algorithm's "used main size" is authoritative. Otherwise, `min-height`
  // is a lower bound so items-center / items-end see the enforced size, not
  // just the natural content size.
  const outerHeightFloor =
    forcedHeight ?? outerHeightExplicit ?? (minHeight > 0 ? minHeight : undefined);

  const inner = shrinkSize(
    outerWidth,
    outerHeightFloor ?? Number.POSITIVE_INFINITY,
    style.border,
    padding,
  );

  let contentHeight: number;
  if (node.children.length === 0) {
    // `white-space: nowrap` text never soft-wraps: its height is the
    // hard-line (`<br>`) count, regardless of width.
    contentHeight = node.text
      ? style.whiteSpace === "nowrap"
        ? node.text.split("\n").length
        : wrapLineCount(node.text, inner.width)
      : node.intrinsicHeight;
  } else if (style.display === "flex" && style.flexDirection === "row") {
    contentHeight = layoutFlexRow(node, inner.width, inner.height, style.border, padding, cache);
  } else if (style.display === "flex" && style.flexDirection === "column") {
    // Whether the main-axis (height) size is definite (explicit `height` or a
    // parent-assigned flex size) or only a `min-height` floor. A floor adds
    // distributable space for flex-grow but must never trigger flex-shrink —
    // min-height can only make the container taller, not compress content.
    const heightIsDefinite = forcedHeight !== undefined || outerHeightExplicit !== undefined;
    contentHeight = layoutFlexColumn(
      node,
      inner.width,
      inner.height,
      heightIsDefinite,
      style.border,
      padding,
      cache,
    );
  } else {
    contentHeight = layoutBlock(node, inner.width, style.border, padding, cache);
  }

  const naturalHeight =
    contentHeight + style.border.top + style.border.bottom + padding.top + padding.bottom;
  // Order matters: min-* is a floor, max-* is a ceiling; when both apply,
  // max wins per CSS (min-width < max-width is required, but if the author
  // sets an inconsistent pair CSS clamps to `max(min, min(max, value))`).
  // The pre-clamp height is the column flex algorithm's base size (CSS
  // distributes from UNclamped bases; min/max apply via its freeze loop).
  const unclampedHeight = forcedHeight ?? outerHeightExplicit ?? naturalHeight;
  node.unclampedHeight = unclampedHeight;
  const finalHeight = clampSize(unclampedHeight, minHeight, maxHeight);

  node.localRect = { x: parentX, y: parentY, width: outerWidth, height: finalHeight };
}

function clampSize(value: number, min: number, max: number | undefined): number {
  const clamped = max !== undefined ? Math.min(value, max) : value;
  return Math.max(min, clamped);
}

/** Resolve a spacing length to cells against its containing-block basis.
 * An indefinite basis (percent gap in an unbounded axis) resolves to 0. */
function resolveLength(length: CellLength, basis: number | undefined): number {
  if (typeof length === "number") return length;
  return basis === undefined || !Number.isFinite(basis) ? 0 : percentToCells(length.percent, basis);
}

/** Resolve all four margin sides (preserving `auto` as null) against the
 * parent's content width — the CSS basis for every side. */
function resolveMargin(margin: PerSide<CellLength | null>, basis: number): NullableInsets {
  const side = (v: CellLength | null) => (v === null ? null : resolveLength(v, basis));
  return {
    top: side(margin.top),
    right: side(margin.right),
    bottom: side(margin.bottom),
    left: side(margin.left),
  };
}

/** The cells of a CellLength for intrinsic sizing: percentages count as 0,
 * per CSS intrinsic-size contribution rules. */
function intrinsicCells(length: CellLength): number {
  return typeof length === "number" ? length : 0;
}

/** Resolve a CellLength to cells: percent needs a definite available size.
 * `"auto"` resolves to none here (0 in block flow) — flex main-axis code
 * substitutes the item's content-based automatic minimum itself. */
function resolveLimit(
  limit: CellLength | "auto" | undefined,
  available: number | undefined,
): number | undefined {
  if (limit === undefined || limit === "auto") return undefined;
  if (typeof limit === "number") return limit;
  return available === undefined ? undefined : percentToCells(limit.percent, available);
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
    const childMargin = resolveMargin(child.style.margin, innerWidth);
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
  const gapX = resolveLength(node.style.gapX, innerWidth);
  const gapY = resolveLength(node.style.gapY, innerHeight);
  const items = flexOrderedChildren(node).map((child) => {
    const margin = resolveMargin(child.style.margin, innerWidth);
    return {
      node: child,
      intrinsic: flexBaseOuterWidth(child, innerWidth, cache),
      grow: child.style.flexGrow,
      shrink: child.style.flexShrink,
      min: flexItemMinWidth(child, innerWidth, cache),
      max: resolveLimit(child.style.maxWidth, innerWidth),
      margin,
      marginLeft: margin.left,
      marginRight: margin.right,
    };
  });

  // Break into rows greedily. With gap, an item breaks when `used + gap +
  // fixedMargins + intrinsic` exceeds innerWidth. The first item on a row is
  // always placed even if it alone overflows, matching CSS.
  const rows: (typeof items)[] = [];
  if (node.style.flexWrap === "wrap") {
    let current: typeof items = [];
    let used = 0;
    for (const item of items) {
      // Placement uses the hypothetical size (base clamped by min/max).
      const hypothetical = Math.max(0, clampSize(item.intrinsic, item.min, item.max));
      const itemWidth = hypothetical + (item.marginLeft ?? 0) + (item.marginRight ?? 0);
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
      layoutNode(row[i]!.node, innerWidth, undefined, 0, 0, "fill", cache, {
        width: widths[i]!,
      });
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
      const itemMargin = row[i]!.margin;
      const hasCrossAutoMargin = itemMargin.top === null || itemMargin.bottom === null;
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
        layoutNode(child, innerWidth, undefined, 0, 0, "fill", cache, {
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
      offsets = mainAxisOffsets(effectiveJustify(node.style), widths, leftover);
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
        y: originY + y + crossAxisOffset(child, node.style.alignItems, rowHeight, item.margin),
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
  heightIsDefinite: boolean,
  border: Insets,
  padding: Insets,
  cache: IntrinsicCache,
): number {
  const gapY = resolveLength(node.style.gapY, innerHeight);

  const items = flexOrderedChildren(node).map((child) => {
    const margin = resolveMargin(child.style.margin, innerWidth);
    const marginLeft = margin.left ?? 0;
    const marginRight = margin.right ?? 0;
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
      intrinsic: base,
      grow: child.style.flexGrow,
      shrink: child.style.flexShrink,
      min: autoMin ?? resolveLimit(child.style.minHeight, limitBasis) ?? 0,
      max: resolveLimit(child.style.maxHeight, limitBasis),
      margin,
      marginTop: margin.top,
      marginBottom: margin.bottom,
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
  const definiteAvailable = finiteInner
    ? Math.max(0, innerHeight - totalGap - fixedMarginTotal)
    : totalIntrinsicHeight;
  // A min-height-only container size is a floor, not a cap: it can hand
  // extra space to flex-grow, but content larger than the floor keeps its
  // intrinsic size (no flex-shrink) and the container grows to fit.
  const availableForItems = heightIsDefinite
    ? definiteAvailable
    : Math.max(definiteAvailable, totalIntrinsicHeight);

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
        { height: finalHeights[i]! },
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
    offsets = mainAxisOffsets(effectiveJustify(node.style), finalHeights, leftover);
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
      x: originX + crossAxisOffsetX(child, node.style.alignItems, innerWidth, item.margin),
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
    intrinsic: number;
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
  const base = items.map((i) => i.intrinsic);
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
  node: LayoutNode,
  cache: IntrinsicCache,
): number {
  const width = style.width;
  if (width !== undefined && width.kind !== "auto")
    return resolveSizeAgainst(width, available, node, cache);
  return mode === "shrink" ? Math.min(available, intrinsicOuterWidth(node, cache)) : available;
}

function resolveHeight(style: CellStyle, available: number | undefined): number | undefined {
  if (style.height?.kind === "cells") return style.height.value;
  if (style.height?.kind === "percent" && available != null)
    return percentToCells(style.height.value, available);
  return undefined;
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

/** Resolve a definite Size against an available extent (`auto` falls back
 * to max-content — callers handle the auto/fill distinction themselves). */
function resolveSizeAgainst(
  size: Size,
  available: number,
  node: LayoutNode,
  cache: IntrinsicCache,
): number {
  switch (size.kind) {
    case "cells":
      return size.value;
    case "percent":
      return percentToCells(size.value, available);
    case "min-content":
      return minContentOuterWidth(node, cache);
    case "max-content":
      return intrinsicOuterWidth(node, cache);
    case "fit-content":
      return Math.min(
        intrinsicOuterWidth(node, cache),
        Math.max(minContentOuterWidth(node, cache), available),
      );
    case "auto":
      return intrinsicOuterWidth(node, cache);
  }
}

/**
 * Flex item order: stable sort by CSS `order` (document order breaks
 * ties), then reversed for `row-reverse` / `column-reverse` — the main
 * axis runs backwards, so laying reversed children in a normal row with
 * flipped justify start/end is equivalent.
 */
function flexOrderedChildren(node: LayoutNode): LayoutNode[] {
  const children = [...node.children].sort((a, b) => a.style.order - b.style.order);
  if (node.style.flexReverse) children.reverse();
  return children;
}

function effectiveJustify(style: CellStyle): CellStyle["justifyContent"] {
  if (!style.flexReverse) return style.justifyContent;
  if (style.justifyContent === "start") return "end";
  if (style.justifyContent === "end") return "start";
  return style.justifyContent;
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

/** Max-content intrinsic outer width (border + padding + unwrapped content). */
function intrinsicOuterWidth(node: LayoutNode, cache: IntrinsicCache): number {
  const cached = cache.maxContent.get(node);
  if (cached !== undefined) return cached;
  const style = node.style;
  const inner = intrinsicInnerWidth(node, cache);
  const result =
    inner +
    style.border.left +
    style.border.right +
    intrinsicCells(style.padding.left) +
    intrinsicCells(style.padding.right);
  cache.maxContent.set(node, result);
  return result;
}

function intrinsicInnerWidth(node: LayoutNode, cache: IntrinsicCache): number {
  if (node.children.length === 0) return node.intrinsicWidth;
  if (node.style.display === "flex" && node.style.flexDirection === "row") {
    const gap = intrinsicCells(node.style.gapX) * Math.max(0, node.children.length - 1);
    return node.children.reduce((sum, c) => sum + intrinsicOuterWidth(c, cache), 0) + gap;
  }
  return node.children.reduce((max, c) => Math.max(max, intrinsicOuterWidth(c, cache)), 0);
}

/**
 * Min-content intrinsic outer width: the narrowest the box can get without
 * overflow. For a text leaf that's the longest unbreakable unit — a word
 * under normal wrapping, a whole hard line under `nowrap`. A nowrap flex
 * row sums its items (they sit side by side no matter what); wrapping rows
 * and block/column containers take the widest child.
 */
function minContentOuterWidth(node: LayoutNode, cache: IntrinsicCache): number {
  const cached = cache.minContent.get(node);
  if (cached !== undefined) return cached;
  const style = node.style;
  const inner = minContentInnerWidth(node, cache);
  const result =
    inner +
    style.border.left +
    style.border.right +
    intrinsicCells(style.padding.left) +
    intrinsicCells(style.padding.right);
  cache.minContent.set(node, result);
  return result;
}

function minContentInnerWidth(node: LayoutNode, cache: IntrinsicCache): number {
  if (node.children.length === 0) {
    if (!node.text) return node.intrinsicWidth;
    if (node.style.whiteSpace === "nowrap") return node.intrinsicWidth;
    let longest = 0;
    for (const word of node.text.split(/[ \t\r\n\f]+/)) {
      for (const segment of breakableSegments(word)) {
        if (segment.length > longest) longest = segment.length;
      }
    }
    return longest;
  }
  if (
    node.style.display === "flex" &&
    node.style.flexDirection === "row" &&
    node.style.flexWrap === "nowrap"
  ) {
    const gap = intrinsicCells(node.style.gapX) * Math.max(0, node.children.length - 1);
    return node.children.reduce((sum, c) => sum + minContentOuterWidth(c, cache), 0) + gap;
  }
  return node.children.reduce((max, c) => Math.max(max, minContentOuterWidth(c, cache)), 0);
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
