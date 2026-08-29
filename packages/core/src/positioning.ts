import {
  clampSize,
  intrinsicOuterWidth,
  isPositioned,
  layoutNode,
  minContentOuterWidth,
  resolveLength,
  resolveLimit,
  resolveMargin,
  resolveSizeAgainst,
  resolveWidthLimit,
} from "./layout.ts";
import type { IntrinsicCache } from "./layout.ts";
import { alignCrossOffset, effectiveAlign, effectiveJustify, mainAxisOffsets } from "./flex.ts";
import type { CellLength, CellStyle, LayoutNode, Rect } from "./types.ts";

/**
 * Positioning pass (specs/positioning.md): after flow layout, place
 * out-of-flow (absolute/fixed) boxes against their containing blocks and
 * apply relative offsets. Runs top-down so ancestor rects are final
 * first. See layout.ts for the deliberate import cycle between the layout
 * modules.
 */

type Effective = "static" | "relative" | "absolute";

/** sticky behaves as relative (no scrolling yet); fixed as absolute. */
function effectivePosition(style: CellStyle): Effective {
  if (style.position === "absolute" || style.position === "fixed") return "absolute";
  if (style.position === "relative" || style.position === "sticky") return "relative";
  return "static";
}

interface Frame {
  node: LayoutNode;
  absX: number;
  absY: number;
}

export function walkPositioned(
  node: LayoutNode,
  absX: number,
  absY: number,
  ancestors: Frame[],
  cache: IntrinsicCache,
): void {
  for (const child of node.children) {
    const effective = effectivePosition(child.style);
    if (effective === "relative") {
      // Pure visual offset; percent insets resolve against the parent's
      // content box. `top` wins over `bottom`, `left` over `right` (LTR).
      const contentW =
        node.localRect.width -
        node.style.border.left -
        node.style.border.right -
        node.resolvedPadding.left -
        node.resolvedPadding.right;
      const contentH =
        node.localRect.height -
        node.style.border.top -
        node.style.border.bottom -
        node.resolvedPadding.top -
        node.resolvedPadding.bottom;
      child.localRect.x += relativeOffset(
        child.style.insets.left,
        child.style.insets.right,
        contentW,
      );
      child.localRect.y += relativeOffset(
        child.style.insets.top,
        child.style.insets.bottom,
        contentH,
      );
    } else if (effective === "absolute") {
      placeAbsolute(child, node, absX, absY, ancestors, cache);
    }
    walkPositioned(
      child,
      absX + child.localRect.x,
      absY + child.localRect.y,
      [
        ...ancestors,
        { node: child, absX: absX + child.localRect.x, absY: absY + child.localRect.y },
      ],
      cache,
    );
  }
}

function relativeOffset(start: CellLength | null, end: CellLength | null, basis: number): number {
  if (start !== null) return resolveLength(start, basis);
  if (end !== null) return -resolveLength(end, basis);
  return 0;
}

/** The containing block's padding box, in absolute cells: the nearest
 * positioned ancestor, or the host for `fixed` / when none exists. */
function containingBlock(ancestors: Frame[], fixed: boolean): Rect {
  if (!fixed) {
    for (let i = ancestors.length - 1; i > 0; i--) {
      const frame = ancestors[i]!;
      if (!isPositioned(frame.node.style)) continue;
      const b = frame.node.style.border;
      return {
        x: frame.absX + b.left,
        y: frame.absY + b.top,
        width: Math.max(0, frame.node.localRect.width - b.left - b.right),
        height: Math.max(0, frame.node.localRect.height - b.top - b.bottom),
      };
    }
  }
  const host = ancestors[0]!;
  return {
    x: host.absX,
    y: host.absY,
    width: host.node.localRect.width,
    height: host.node.localRect.height,
  };
}

function placeAbsolute(
  child: LayoutNode,
  parent: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  ancestors: Frame[],
  cache: IntrinsicCache,
): void {
  const style = child.style;
  const cb = containingBlock(ancestors, style.position === "fixed");
  const left = style.insets.left === null ? null : resolveLength(style.insets.left, cb.width);
  const right = style.insets.right === null ? null : resolveLength(style.insets.right, cb.width);
  const top = style.insets.top === null ? null : resolveLength(style.insets.top, cb.height);
  const bottom =
    style.insets.bottom === null ? null : resolveLength(style.insets.bottom, cb.height);
  const margin = resolveMargin(style.margin, cb.width);
  const marginLeft = margin.left ?? 0;
  const marginRight = margin.right ?? 0;
  const marginTop = margin.top ?? 0;
  const marginBottom = margin.bottom ?? 0;

  // Used width, per CSS in priority order: an explicit width resolves
  // against the CONTAINING BLOCK (percent included); opposing insets with
  // an auto width stretch the box between them; otherwise shrink-to-fit
  // (fit-content) within the space the insets and margins leave. All
  // clamped by the element's min/max against the containing block.
  const widthAuto = style.width === undefined || style.width.kind === "auto";
  const heightAuto = style.height === undefined || style.height.kind === "auto";
  const minW = resolveWidthLimit(style.minWidth, cb.width, child, cache) ?? 0;
  const maxW = resolveWidthLimit(style.maxWidth, cb.width, child, cache);
  const forced: { width?: number; height?: number } = {};
  if (!widthAuto) {
    forced.width = clampSize(resolveSizeAgainst(style.width!, cb.width, child, cache), minW, maxW);
  } else if (left !== null && right !== null) {
    forced.width = clampSize(
      Math.max(0, cb.width - left - right - marginLeft - marginRight),
      minW,
      maxW,
    );
  } else {
    const available = Math.max(0, cb.width - (left ?? 0) - (right ?? 0) - marginLeft - marginRight);
    forced.width = clampSize(
      Math.min(
        intrinsicOuterWidth(child, cache),
        Math.max(minContentOuterWidth(child, cache), available),
      ),
      minW,
      maxW,
    );
  }
  if (top !== null && bottom !== null && heightAuto) {
    forced.height = clampSize(
      Math.max(0, cb.height - top - bottom - marginTop - marginBottom),
      resolveLimit(style.minHeight, cb.height) ?? 0,
      resolveLimit(style.maxHeight, cb.height),
    );
  }
  layoutNode(child, cb.width, cb.height, 0, 0, "shrink", cache, forced);
  const width = child.localRect.width;
  const height = child.localRect.height;

  // Horizontal placement. Both insets + auto margins center (`inset-0
  // m-auto` idiom); a single auto margin absorbs the slack on its side.
  let x: number;
  if (left !== null && right !== null) {
    const slack = Math.max(0, cb.width - left - right - width - marginLeft - marginRight);
    const bothAuto = margin.left === null && margin.right === null;
    x =
      cb.x +
      left +
      marginLeft +
      (bothAuto ? Math.floor(slack / 2) : margin.left === null ? slack : 0);
  } else if (left !== null) {
    x = cb.x + left + marginLeft;
  } else if (right !== null) {
    x = cb.x + cb.width - right - width - marginRight;
  } else {
    x = staticPositionX(child, parent, parentAbsX, width);
  }
  let y: number;
  if (top !== null && bottom !== null) {
    const slack = Math.max(0, cb.height - top - bottom - height - marginTop - marginBottom);
    const bothAuto = margin.top === null && margin.bottom === null;
    y =
      cb.y + top + marginTop + (bothAuto ? Math.floor(slack / 2) : margin.top === null ? slack : 0);
  } else if (top !== null) {
    y = cb.y + top + marginTop;
  } else if (bottom !== null) {
    y = cb.y + cb.height - bottom - height - marginBottom;
  } else {
    y = staticPositionY(child, parent, parentAbsY, height);
  }

  child.localRect = { ...child.localRect, x: x - parentAbsX, y: y - parentAbsY };
}

/** The sole-item static position along the main axis is exactly where a
 * single in-flow item would land — reuse the canonical justify math, which
 * already encodes the CSS content-distribution fallbacks. */
function soleItemMainOffset(
  justify: CellStyle["justifyContent"],
  inner: number,
  size: number,
): number {
  return mainAxisOffsets(justify, [size], Math.max(0, inner - size))[0]!;
}

/** Cross alignment for the sole-item rule; stretch behaves as start. */
function soleItemCrossOffset(
  child: LayoutNode,
  parent: LayoutNode,
  inner: number,
  size: number,
): number {
  return alignCrossOffset(effectiveAlign(child, parent), inner, size);
}

/** The hypothetical sole-item box includes the element's fixed margins
 * (auto margins count as 0 in the static position, per CSS §10.1). */
function flexStaticOffset(
  child: LayoutNode,
  parent: LayoutNode,
  slot: { direction: "row" | "column"; innerWidth: number; innerHeight: number },
  axis: "x" | "y",
  size: number,
): number {
  const margin = resolveMargin(child.style.margin, slot.innerWidth);
  const [before, after, inner, isMain] =
    axis === "x"
      ? ([margin.left ?? 0, margin.right ?? 0, slot.innerWidth, slot.direction === "row"] as const)
      : ([
          margin.top ?? 0,
          margin.bottom ?? 0,
          slot.innerHeight,
          slot.direction === "column",
        ] as const);
  const outer = size + before + after;
  const offset = isMain
    ? soleItemMainOffset(effectiveJustify(parent.style), inner, outer)
    : soleItemCrossOffset(child, parent, inner, outer);
  return offset + before;
}

function staticPositionX(
  child: LayoutNode,
  parent: LayoutNode,
  parentAbsX: number,
  width: number,
): number {
  const slot = child.staticSlot;
  if (slot === undefined) return parentAbsX;
  if (slot.kind === "block") return parentAbsX + slot.x;
  return parentAbsX + slot.originX + flexStaticOffset(child, parent, slot, "x", width);
}

function staticPositionY(
  child: LayoutNode,
  parent: LayoutNode,
  parentAbsY: number,
  height: number,
): number {
  const slot = child.staticSlot;
  if (slot === undefined) return parentAbsY;
  if (slot.kind === "block") return parentAbsY + slot.y;
  return parentAbsY + slot.originY + flexStaticOffset(child, parent, slot, "y", height);
}
