import { percentToCells } from "./metrics.ts";
import { longestSegmentAdvance, wrapLineCount } from "./wrap.ts";
import { layoutFlexColumn, layoutFlexRow } from "./flex.ts";
import { walkPositioned } from "./positioning.ts";
import type {
  CellLength,
  CellStyle,
  Insets,
  LayoutNode,
  NullableInsets,
  PerSide,
  Size,
  SizeLimit,
} from "./types.ts";

/**
 * Core layout: the per-node sizing pipeline, block flow, and the shared
 * sizing/intrinsic machinery. Flex lives in flex.ts, the positioning pass
 * in positioning.ts, each mirroring its spec file. The modules are
 * mutually recursive (children lay out through layoutNode), so the import
 * cycle between them is deliberate — safe because they contain only
 * hoisted function declarations with no top-level cross-module execution.
 */

/**
 * Layout entry point: mutates localRect on the root and each descendant.
 * Coordinates are parent-relative (root's rect is at 0,0).
 */
export function layoutRoot(root: LayoutNode, availableWidth: number): { height: number } {
  const cache: IntrinsicCache = { maxContent: new WeakMap(), minContent: new WeakMap() };
  layoutNode(root, availableWidth, undefined, 0, 0, "fill", cache);
  // Positioning pass (specs/positioning.md): out-of-flow boxes were skipped
  // by flow layout; place them against their containing blocks, and apply
  // relative offsets. Runs top-down so ancestor rects are final first.
  walkPositioned(root, 0, 0, [{ node: root, absX: 0, absY: 0 }], cache);
  return { height: root.localRect.height };
}

/** absolute / fixed boxes are out of normal flow. */
export function isOutOfFlow(style: CellStyle): boolean {
  return style.position === "absolute" || style.position === "fixed";
}

/** A containing block for absolute descendants, per CSS. */
export function isPositioned(style: CellStyle): boolean {
  return style.position !== "static";
}

export type SizingMode = "fill" | "shrink";

export interface IntrinsicCache {
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
export function layoutNode(
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
  const minWidth = resolveWidthLimit(style.minWidth, availableWidth, node, cache) ?? 0;
  const maxWidth = resolveWidthLimit(style.maxWidth, availableWidth, node, cache);
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

  // Whether the height is definite (explicit `height` or a parent-assigned
  // flex size) rather than only a `min-height` floor. Column flex: a floor
  // adds grow space but never triggers shrink. Everywhere: only a DEFINITE
  // content height is the basis for children's percent heights, per CSS.
  const heightIsDefinite = forcedHeight !== undefined || outerHeightExplicit !== undefined;
  const definiteInnerHeight =
    heightIsDefinite && Number.isFinite(inner.height) ? inner.height : undefined;

  let contentHeight: number;
  if (node.children.length === 0) {
    // `white-space: nowrap` text never soft-wraps: its height is the
    // hard-line (`<br>`) count, regardless of width. `leading-*` adds
    // `lineGap` empty rows BETWEEN lines only (specs/cell-model.md).
    if (node.text) {
      const lines =
        style.whiteSpace === "nowrap"
          ? node.text.split("\n").length
          : wrapLineCount(node.text, inner.width, {
              advances: node.advances,
              tracking: style.tracking,
            });
      contentHeight = lines + Math.max(0, lines - 1) * style.lineGap;
    } else {
      contentHeight = node.intrinsicHeight;
    }
  } else if (style.display === "flex" && style.flexDirection === "row") {
    contentHeight = layoutFlexRow(
      node,
      inner.width,
      inner.height,
      definiteInnerHeight,
      style.border,
      padding,
      cache,
    );
  } else if (style.display === "flex" && style.flexDirection === "column") {
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
    contentHeight = layoutBlock(
      node,
      inner.width,
      definiteInnerHeight,
      style.border,
      padding,
      cache,
    );
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

export function clampSize(value: number, min: number, max: number | undefined): number {
  const clamped = max !== undefined ? Math.min(value, max) : value;
  return Math.max(min, clamped);
}

/** Resolve a spacing length to cells against its containing-block basis.
 * An indefinite basis (percent gap in an unbounded axis) resolves to 0. */
export function resolveLength(length: CellLength, basis: number | undefined): number {
  if (typeof length === "number") return length;
  return basis === undefined || !Number.isFinite(basis) ? 0 : percentToCells(length.percent, basis);
}

/** Resolve all four margin sides (preserving `auto` as null) against the
 * parent's content width — the CSS basis for every side. */
export function resolveMargin(margin: PerSide<CellLength | null>, basis: number): NullableInsets {
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

/** Resolve a height limit to cells: percent needs a definite available
 * size; intrinsic keywords behave as "no constraint" on heights. `"auto"`
 * resolves to none here (0 in block flow) — flex main-axis code
 * substitutes the item's content-based automatic minimum itself. */
export function resolveLimit(
  limit: SizeLimit | "auto" | undefined,
  available: number | undefined,
): number | undefined {
  if (limit === undefined || typeof limit === "string") return undefined;
  if (typeof limit === "number") return limit;
  return available === undefined ? undefined : percentToCells(limit.percent, available);
}

/** Resolve a WIDTH limit to cells — like resolveLimit, but intrinsic
 * keywords (`max-w-max` = max-content, …) resolve against the node's
 * content. */
export function resolveWidthLimit(
  limit: SizeLimit | "auto" | undefined,
  available: number,
  node: LayoutNode,
  cache: IntrinsicCache,
): number | undefined {
  if (limit === "min-content" || limit === "max-content" || limit === "fit-content") {
    return resolveSizeAgainst({ kind: limit }, available, node, cache);
  }
  return resolveLimit(limit, available);
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
  definiteInnerHeight: number | undefined,
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
    if (isOutOfFlow(child.style)) {
      // Record the CSS static position (where the box would have started in
      // flow) without consuming space or disturbing margin collapsing.
      child.staticSlot = {
        kind: "block",
        x: originX + marginLeft,
        y:
          y +
          (previousMarginBottom === null
            ? marginTop
            : collapseMargins(previousMarginBottom, marginTop)),
      };
      continue;
    }
    layoutNode(
      child,
      Math.max(0, innerWidth - marginLeft - marginRight),
      definiteInnerHeight,
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

/** Resolve a definite Size against an available extent (`auto` falls back
 * to max-content — callers handle the auto/fill distinction themselves). */
export function resolveSizeAgainst(
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

/** Max-content intrinsic outer width (border + padding + unwrapped content). */
export function intrinsicOuterWidth(node: LayoutNode, cache: IntrinsicCache): number {
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
  const inFlow = node.children.filter((c) => !isOutOfFlow(c.style));
  if (node.style.display === "flex" && node.style.flexDirection === "row") {
    const gap = intrinsicCells(node.style.gapX) * Math.max(0, inFlow.length - 1);
    return inFlow.reduce((sum, c) => sum + intrinsicOuterWidth(c, cache), 0) + gap;
  }
  return inFlow.reduce((max, c) => Math.max(max, intrinsicOuterWidth(c, cache)), 0);
}

/**
 * Min-content intrinsic outer width: the narrowest the box can get without
 * overflow. For a text leaf that's the longest unbreakable unit — a word
 * under normal wrapping, a whole hard line under `nowrap`. A nowrap flex
 * row sums its items (they sit side by side no matter what); wrapping rows
 * and block/column containers take the widest child.
 */
export function minContentOuterWidth(node: LayoutNode, cache: IntrinsicCache): number {
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
    if (!node.text || node.style.whiteSpace === "nowrap") return node.intrinsicWidth;
    return longestSegmentAdvance(node.text, {
      advances: node.advances,
      tracking: node.style.tracking,
    });
  }
  const inFlow = node.children.filter((c) => !isOutOfFlow(c.style));
  if (
    node.style.display === "flex" &&
    node.style.flexDirection === "row" &&
    node.style.flexWrap === "nowrap"
  ) {
    const gap = intrinsicCells(node.style.gapX) * Math.max(0, inFlow.length - 1);
    return inFlow.reduce((sum, c) => sum + minContentOuterWidth(c, cache), 0) + gap;
  }
  return inFlow.reduce((max, c) => Math.max(max, minContentOuterWidth(c, cache)), 0);
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
