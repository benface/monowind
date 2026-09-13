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
import { inlineElementRects } from "./plain-text.ts";
import type { AreaSide, CellLength, CellStyle, LayoutNode, PositionArea, Rect } from "./types.ts";

/**
 * Positioning pass (specs/positioning.md): after flow layout, place
 * out-of-flow (absolute/fixed) boxes against their containing blocks and
 * apply relative offsets. Runs top-down so ancestor rects are final
 * first. See layout.ts for the deliberate import cycle between the layout
 * modules.
 */

type Effective = "static" | "relative" | "absolute";

/** Sticky lays out as static — its shift is the paint's (specs/sticky.md);
 * fixed as absolute. */
function effectivePosition(style: CellStyle): Effective {
  if (style.position === "absolute" || style.position === "fixed") return "absolute";
  if (style.position === "relative") return "relative";
  return "static";
}

interface Frame {
  node: LayoutNode;
  absX: number;
  absY: number;
}

/** An anchor as the boxes after it see it: its border box in the
 * host's cells as laid out, and the scroll containers above it, whose
 * offsets move it (specs/anchor-positioning.md). */
interface Anchor {
  rect: Rect;
  scrollers: LayoutNode[];
}

export function walkPositioned(
  node: LayoutNode,
  absX: number,
  absY: number,
  ancestors: Frame[],
  cache: IntrinsicCache,
  anchors: Map<string, Anchor> = new Map(),
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
      placeAbsolute(child, node, absX, absY, ancestors, cache, anchors);
    }
    recordAnchors(child, absX + child.localRect.x, absY + child.localRect.y, ancestors, anchors);
    walkPositioned(
      child,
      absX + child.localRect.x,
      absY + child.localRect.y,
      [
        ...ancestors,
        { node: child, absX: absX + child.localRect.x, absY: absY + child.localRect.y },
      ],
      cache,
      anchors,
    );
  }
}

function relativeOffset(start: CellLength | null, end: CellLength | null, basis: number): number {
  if (start !== null) return resolveLength(start, basis);
  if (end !== null) return -resolveLength(end, basis);
  return 0;
}

/** A placed box's names, for the boxes after it in tree order
 * (specs/anchor-positioning.md): its border box, or for a named inline
 * element in its runs the element's first fragment, with the scroll
 * containers above whose offsets move it. */
function recordAnchors(
  child: LayoutNode,
  absX: number,
  absY: number,
  ancestors: Frame[],
  anchors: Map<string, Anchor>,
): void {
  const inline = child.inlineElements?.some((entry) => entry.anchorNames.length > 0) ?? false;
  if (child.style.anchorNames.length === 0 && !inline) return;
  const scrollers = scrollersOf(ancestors);
  const { width, height } = child.localRect;
  for (const name of child.style.anchorNames) {
    anchors.set(name, { rect: { x: absX, y: absY, width, height }, scrollers });
  }
  if (!inline) return;
  const named = new Map<Element, string[]>();
  for (const entry of child.inlineElements!) {
    if (entry.anchorNames.length > 0 && !named.has(entry.element)) {
      named.set(entry.element, entry.anchorNames);
    }
  }
  for (const { element, rect } of inlineElementRects(child, absX, absY)) {
    const names = named.get(element);
    if (names === undefined) continue;
    for (const name of names) anchors.set(name, { rect, scrollers });
    named.delete(element);
  }
}

/** The scroll containers among a box's ancestors, whose offsets move
 * it (specs/scrolling.md). */
function scrollersOf(ancestors: Frame[]): LayoutNode[] {
  return ancestors.map((frame) => frame.node).filter((box) => box.scroll);
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
  anchors: Map<string, Anchor>,
): void {
  const style = child.style;
  const fixed = style.position === "fixed";
  const slot = child.staticSlot;
  // A positioned GRID parent's absolute child is contained by its grid
  // area (specs/grid.md §10.1), not the parent's padding box.
  const cb: Rect =
    slot?.kind === "grid" && !fixed && isPositioned(parent.style)
      ? {
          x: parentAbsX + slot.area.x,
          y: parentAbsY + slot.area.y,
          width: slot.area.width,
          height: slot.area.height,
        }
      : containingBlock(ancestors, fixed);
  const anchor = style.positionAnchor === null ? undefined : anchors.get(style.positionAnchor);
  if (style.positionArea && anchor) {
    // A fixed box, painted from the host, escapes every scroll.
    const { rect, movers } = anchorRectFor(anchor, fixed ? [] : scrollersOf(ancestors));
    if (movers.length > 0) {
      const root = ancestors[0]!.node;
      root.anchorScrollers ??= new Set();
      for (const scroller of movers) root.anchorScrollers.add(scroller.source);
    }
    placeAnchored(child, parentAbsX, parentAbsY, cb, rect, style.positionArea, cache);
  } else {
    placeByInsets(child, parent, parentAbsX, parentAbsY, cb, cache);
  }
  // The walks paint and hit a fixed box from the host's origin
  // (specs/positioning.md).
  if (fixed) {
    child.hostRect = { x: parentAbsX + child.localRect.x, y: parentAbsY + child.localRect.y };
  }
}

/** An absolute box placed by its insets and margins in its containing
 * block, its static position where both an axis's insets are auto. */
function placeByInsets(
  child: LayoutNode,
  parent: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  cb: Rect,
  cache: IntrinsicCache,
): void {
  const style = child.style;
  delete child.anchorArea;
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
  const heightAuto = style.height === undefined || style.height.kind === "auto";
  const forced: { width?: number; height?: number } = {
    width: absoluteWidth(child, cb.width, left, right, marginLeft + marginRight, cache),
  };
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

/** An anchor's rect as a box sees it: moved by the scroll of the
 * scroll containers that move the anchor and not the box, and back by
 * those that move the box alone — the movers, whose scroll takes a
 * relayout. */
function anchorRectFor(
  anchor: Anchor,
  boxScrollers: LayoutNode[],
): { rect: Rect; movers: LayoutNode[] } {
  let dx = 0;
  let dy = 0;
  const movers: LayoutNode[] = [];
  for (const scroller of anchor.scrollers) {
    if (boxScrollers.includes(scroller)) continue;
    dx -= scroller.scroll!.x;
    dy -= scroller.scroll!.y;
    movers.push(scroller);
  }
  for (const scroller of boxScrollers) {
    if (anchor.scrollers.includes(scroller)) continue;
    dx += scroller.scroll!.x;
    dy += scroller.scroll!.y;
    movers.push(scroller);
  }
  return { rect: { ...anchor.rect, x: anchor.rect.x + dx, y: anchor.rect.y + dy }, movers };
}

/** An absolute box's used width, per CSS: its own, resolved and clamped
 * against the containing block; else the space between two set insets
 * and the margins; else shrink-to-fit in the space they leave. */
function absoluteWidth(
  child: LayoutNode,
  cbWidth: number,
  left: number | null,
  right: number | null,
  margins: number,
  cache: IntrinsicCache,
): number {
  const style = child.style;
  const minW = resolveWidthLimit(style.minWidth, cbWidth, child, cache) ?? 0;
  const maxW = resolveWidthLimit(style.maxWidth, cbWidth, child, cache);
  if (style.width !== undefined && style.width.kind !== "auto") {
    return clampSize(resolveSizeAgainst(style.width, cbWidth, child, cache), minW, maxW);
  }
  if (left !== null && right !== null) {
    return clampSize(Math.max(0, cbWidth - left - right - margins), minW, maxW);
  }
  const available = Math.max(0, cbWidth - (left ?? 0) - (right ?? 0) - margins);
  return clampSize(
    Math.min(
      intrinsicOuterWidth(child, cache),
      Math.max(minContentOuterWidth(child, cache), available),
    ),
    minW,
    maxW,
  );
}

/** An anchored box (specs/anchor-positioning.md): laid out with its
 * area — a cell of the anchor's 3×3 grid over the containing block —
 * as its containing block and aligned toward the anchor, the fallbacks
 * tried in order until one fits, the first standing when none does. */
function placeAnchored(
  child: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  cb: Rect,
  anchor: Rect,
  first: PositionArea,
  cache: IntrinsicCache,
): void {
  const style = child.style;
  const tries = [
    first,
    ...style.positionTryFallbacks.map((fallback) =>
      "flipBlock" in fallback ? flipArea(first, fallback) : fallback,
    ),
  ];
  const place = (area: PositionArea): boolean => {
    const [x0, width0] = areaSpan(area.x, cb.x, cb.width, anchor.x, anchor.width);
    const [y0, height0] = areaSpan(area.y, cb.y, cb.height, anchor.y, anchor.height);
    const region: Rect = { x: x0, y: y0, width: width0, height: height0 };
    const margin = resolveMargin(style.margin, region.width);
    const across = (margin.left ?? 0) + (margin.right ?? 0);
    const down = (margin.top ?? 0) + (margin.bottom ?? 0);
    layoutNode(child, region.width, region.height, 0, 0, "shrink", cache, {
      width: absoluteWidth(child, region.width, null, null, across, cache),
    });
    const { width, height } = child.localRect;
    const x = alignInArea(
      area.x,
      region.x,
      region.width,
      anchor.x,
      anchor.width,
      width,
      margin.left ?? 0,
      margin.right ?? 0,
      style.anchorCenter.x ? "anchor-center" : style.justifySelf,
    );
    const y = alignInArea(
      area.y,
      region.y,
      region.height,
      anchor.y,
      anchor.height,
      height,
      margin.top ?? 0,
      margin.bottom ?? 0,
      style.anchorCenter.y ? "anchor-center" : style.alignSelf,
    );
    child.localRect = { ...child.localRect, x: x - parentAbsX, y: y - parentAbsY };
    child.anchorArea = area;
    return width + across <= region.width && height + down <= region.height;
  };
  for (const area of tries) if (place(area)) return;
  place(first);
}

/** One axis of an area, as its start and size: the span the side
 * names, an anchor edge past the containing block leaving it empty. */
function areaSpan(
  side: AreaSide,
  cbStart: number,
  cbSize: number,
  anchorStart: number,
  anchorSize: number,
): [number, number] {
  const cbEnd = cbStart + cbSize;
  const anchorEnd = anchorStart + anchorSize;
  switch (side) {
    case "start":
      return [cbStart, Math.max(0, anchorStart - cbStart)];
    case "end":
      return [anchorEnd, Math.max(0, cbEnd - anchorEnd)];
    case "center":
      return [anchorStart, anchorSize];
    case "span-start":
      return [cbStart, Math.max(0, anchorEnd - cbStart)];
    case "span-end":
      return [anchorStart, Math.max(0, cbEnd - anchorStart)];
    case "span-all":
      return [cbStart, cbSize];
  }
}

/** The box's start on one axis of its area: against the anchor from a
 * side, along the edge a span keeps, centered on it (inside the area)
 * under `center`, `span-all`, and `anchor-center`, or where
 * `justify-self`/`align-self` says. */
function alignInArea(
  side: AreaSide,
  regionStart: number,
  regionSize: number,
  anchorStart: number,
  anchorSize: number,
  size: number,
  before: number,
  after: number,
  self: CellStyle["alignSelf"] | "anchor-center",
): number {
  const atStart = regionStart + before;
  const atEnd = regionStart + regionSize - after - size;
  if (self === "start") return atStart;
  if (self === "end") return atEnd;
  if (self === "center") {
    return regionStart + Math.floor((regionSize - size - before - after) / 2) + before;
  }
  if (self !== "anchor-center") {
    if (side === "start" || side === "span-start") return atEnd;
    if (side === "end" || side === "span-end") return atStart;
  }
  const centered = anchorStart + Math.floor((anchorSize - size - before - after) / 2) + before;
  return Math.max(atStart, Math.min(centered, atEnd));
}

/** A side mirrored across the anchor. */
const MIRRORED: Record<AreaSide, AreaSide> = {
  start: "end",
  end: "start",
  center: "center",
  "span-start": "span-end",
  "span-end": "span-start",
  "span-all": "span-all",
};

/** An area under a fallback's tactics: the block axis mirrored, the
 * inline one, the two swapped. */
function flipArea(
  area: PositionArea,
  tactic: { flipBlock: boolean; flipInline: boolean; flipStart: boolean },
): PositionArea {
  let { x, y } = area;
  if (tactic.flipBlock) y = MIRRORED[y];
  if (tactic.flipInline) x = MIRRORED[x];
  if (tactic.flipStart) [x, y] = [y, x];
  return { x, y };
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

/** The grid static position (specs/grid.md §10.1): the sole item of the
 * recorded static area, self-aligned (`justify-self` / `align-self`,
 * stretch behaving as start) with its fixed margins in the box. */
function gridStaticOffset(
  child: LayoutNode,
  parent: LayoutNode,
  area: Rect,
  axis: "x" | "y",
  size: number,
): number {
  const margin = resolveMargin(child.style.margin, area.width);
  const justify =
    child.style.justifySelf === "auto"
      ? parent.style.justifyItems
      : (child.style.justifySelf as CellStyle["alignItems"]);
  const [before, after, inner, align] =
    axis === "x"
      ? ([margin.left ?? 0, margin.right ?? 0, area.width, justify] as const)
      : ([
          margin.top ?? 0,
          margin.bottom ?? 0,
          area.height,
          effectiveAlign(child, parent),
        ] as const);
  return alignCrossOffset(align, inner, size + before + after) + before;
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
  if (slot.kind === "grid") {
    return (
      parentAbsX + slot.staticArea.x + gridStaticOffset(child, parent, slot.staticArea, "x", width)
    );
  }
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
  if (slot.kind === "grid") {
    return (
      parentAbsY + slot.staticArea.y + gridStaticOffset(child, parent, slot.staticArea, "y", height)
    );
  }
  return parentAbsY + slot.originY + flexStaticOffset(child, parent, slot, "y", height);
}
