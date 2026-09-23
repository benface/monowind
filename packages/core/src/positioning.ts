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
import { alignedOffset, effectiveAlign, effectiveJustify, mainAxisOffsets } from "./flex.ts";
import { roundHalfAwayFromZero } from "./metrics.ts";
import { clipBounds, inlineElementRects } from "./plain-text.ts";
import type { Clip } from "./plain-text.ts";
import { setAnchorSize } from "./style.ts";
import { SIDES } from "./types.ts";
import type {
  AnchorInset,
  AnchorSize,
  AnchorSizeProperty,
  AreaSide,
  CellLength,
  CellStyle,
  Flip,
  LayoutNode,
  NullableInsets,
  PerSide,
  PositionArea,
  Rect,
  Side,
} from "./types.ts";

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

/** A box that clips, with its clip in unscrolled cells. */
interface ClipFrame {
  node: LayoutNode;
  bounds: Clip;
}

/** An anchor as the boxes after it see it: its border box in the
 * host's cells as laid out, and the scroll containers above it, whose
 * offsets move it (specs/anchor-positioning.md). */
interface Anchor {
  rect: Rect;
  scrollers: LayoutNode[];
  /** The boxes above it that clip, outermost first (for
   * `position-visibility`). */
  clips: ClipFrame[];
  /** Whether it paints nothing of its own: `visibility`, or a
   * `position-visibility` hiding it or a box above. */
  hidden: boolean;
}

/** A box's last successful placement (specs/anchor-positioning.md):
 * its index among the box's placements, the base 0, and the styles it
 * fit under, whose change forgets it. */
export interface Remembered {
  key: string;
  option: number;
}

/** What a positioning pass carries down the tree. */
interface Pass {
  cache: IntrinsicCache;
  anchors: Map<string, Anchor>;
  remembered: Map<Element, Remembered>;
  /** The boxes with placements to remember, the rest forgotten. */
  placed: Set<Element>;
  /** The scroll offsets under a box, synced as the pass sizes it. */
  syncScroll: ((node: LayoutNode) => void) | undefined;
}

/** Places the out-of-flow boxes under `root`; `remembered` keeps each
 * anchored box's last successful placement from one pass to the next,
 * a box no pass places again forgotten. A placed box's scroll offsets
 * are synced before the anchors inside it are read (`syncScroll`). */
export function positionOutOfFlow(
  root: LayoutNode,
  cache: IntrinsicCache,
  remembered: Map<Element, Remembered> = new Map(),
  syncScroll?: (node: LayoutNode) => void,
): void {
  const pass: Pass = { cache, anchors: new Map(), remembered, placed: new Set(), syncScroll };
  walkPositioned(root, 0, 0, [{ node: root, absX: 0, absY: 0 }], pass);
  for (const element of remembered.keys()) {
    if (!pass.placed.has(element)) remembered.delete(element);
  }
}

function walkPositioned(
  node: LayoutNode,
  absX: number,
  absY: number,
  ancestors: Frame[],
  pass: Pass,
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
      placeAbsolute(child, node, absX, absY, ancestors, pass);
      pass.syncScroll?.(child);
    }
    const x = absX + child.localRect.x;
    const y = absY + child.localRect.y;
    recordAnchors(child, x, y, ancestors, pass.anchors);
    walkPositioned(child, x, y, [...ancestors, { node: child, absX: x, absY: y }], pass);
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
  // A fixed box paints from the host, outside the scrolls and clips above.
  const frames = child.style.position === "fixed" ? [] : ancestors;
  const scrollers = scrollersOf(frames);
  const clips = clipsOf(frames);
  const hiddenAbove =
    child.forceHidden === true || ancestors.some((frame) => frame.node.forceHidden === true);
  const rect = { x: absX, y: absY, width: child.localRect.width, height: child.localRect.height };
  const hidden = hiddenAbove || !child.style.visible;
  for (const name of child.style.anchorNames) anchors.set(name, { rect, scrollers, clips, hidden });
  if (!inline) return;
  const named = new Map<Element, { names: string[]; hidden: boolean }>();
  for (const entry of child.inlineElements!) {
    if (entry.anchorNames.length > 0 && !named.has(entry.element)) {
      named.set(entry.element, { names: entry.anchorNames, hidden: hiddenAbove || !entry.visible });
    }
  }
  for (const { element, rect } of inlineElementRects(child, absX, absY)) {
    const entry = named.get(element);
    if (entry === undefined) continue;
    for (const name of entry.names) {
      anchors.set(name, { rect, scrollers, clips, hidden: entry.hidden });
    }
    named.delete(element);
  }
}

/** The frames whose scroll and clip reach a box: from its nearest fixed
 * ancestor on, which paints from the host outside those above it
 * (specs/positioning.md). */
function reachingFrames(ancestors: Frame[]): Frame[] {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    if (ancestors[i]!.node.style.position === "fixed") return ancestors.slice(i);
  }
  return ancestors;
}

/** The boxes among a box's ancestors that clip it, with their clips. */
function clipsOf(ancestors: Frame[]): ClipFrame[] {
  const out: ClipFrame[] = [];
  for (const { node, absX, absY } of reachingFrames(ancestors)) {
    const bounds = clipBounds(node, absX, absY);
    if (bounds) out.push({ node, bounds });
  }
  return out;
}

/** Whether an anchor is clipped out of view by a box that clips it and
 * not the positioned box (specs/anchor-positioning.md): the anchor as
 * that box shows it — moved by the scroll of the clipping boxes inside
 * it — meets none of its window, the clip moved by its own scroll. */
function anchorClipped(anchor: Anchor, boxClips: LayoutNode[]): boolean {
  const { rect, clips } = anchor;
  // Overlap on an axis; a zero-size anchor needs its edge inside.
  const meets = (start: number, size: number, from: number, to: number): boolean =>
    size > 0 ? start + size > from && start < to : start >= from && start <= to;
  // Inside out, the scroll of the clips passed accumulating.
  let dx = 0;
  let dy = 0;
  for (let i = clips.length - 1; i >= 0; i--) {
    const { node, bounds } = clips[i]!;
    const scrollX = node.scroll?.x ?? 0;
    const scrollY = node.scroll?.y ?? 0;
    if (!boxClips.includes(node)) {
      const shown =
        meets(rect.x - dx, rect.width, bounds.x0 + scrollX, bounds.x1 + scrollX) &&
        meets(rect.y - dy, rect.height, bounds.y0 + scrollY, bounds.y1 + scrollY);
      if (!shown) return true;
    }
    dx += scrollX;
    dy += scrollY;
  }
  return false;
}

/** The scroll containers among a box's ancestors, whose offsets move
 * it (specs/scrolling.md). */
function scrollersOf(ancestors: Frame[]): LayoutNode[] {
  return reachingFrames(ancestors)
    .map((frame) => frame.node)
    .filter((box) => box.scroll);
}

/** The containing block's padding box, in absolute cells: the nearest
 * positioned ancestor, or the host for `fixed` / when none exists —
 * for a top-layer element, the host's cells the viewport shows, since
 * the platform resolves the top layer against the viewport and a
 * dialog centered in a host taller than the window would open out of
 * sight (specs/top-layer.md). */
function containingBlock(ancestors: Frame[], fixed: boolean, topLayer = false): Rect {
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
  const box = {
    x: host.absX,
    y: host.absY,
    width: host.node.localRect.width,
    height: host.node.localRect.height,
  };
  const visible = topLayer ? host.node.visibleCells : undefined;
  if (!visible) return box;
  const x = Math.max(box.x, visible.x);
  const y = Math.max(box.y, visible.y);
  const width = Math.min(box.x + box.width, visible.x + visible.width) - x;
  const height = Math.min(box.y + box.height, visible.y + visible.height) - y;
  // A host scrolled entirely out of view leaves the element its own.
  return width > 0 && height > 0 ? { x, y, width, height } : box;
}

function placeAbsolute(
  child: LayoutNode,
  parent: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  ancestors: Frame[],
  pass: Pass,
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
      : containingBlock(ancestors, fixed, style.topLayer);
  // Read before the anchor sizes resolve into the styles it keys.
  const key = style.positionTryFallbacks.length > 0 ? fallbackKey(style) : "";
  resolveAnchorSizes(style, pass.anchors);
  const root = ancestors[0]!.node;
  let boxScrollers: LayoutNode[] | undefined;
  /** An anchor's rect as this box sees it, the scrollers moving it under
   * the box noted for their scroll's relayout. */
  const seen = (name: string | null): Rect | undefined => {
    const anchor = name === null ? undefined : pass.anchors.get(name);
    if (!anchor) return undefined;
    // A fixed box, painted from the host, escapes every scroll.
    boxScrollers ??= fixed ? [] : scrollersOf(ancestors);
    const { rect, movers } = anchorRectFor(anchor, boxScrollers);
    noteAnchorScrollers(root, movers);
    return rect;
  };
  const fits = placeTrying(child, parent, parentAbsX, parentAbsY, cb, seen, key, pass);
  // `position-visibility` (specs/anchor-positioning.md), its scroll
  // relaying out a box whose anchor scrolled out of view.
  const conditions = style.positionVisibility;
  const name = style.positionAnchor;
  const anchor = name === null ? undefined : pass.anchors.get(name);
  let invisible = false;
  if (conditions.anchorVisible && anchor) {
    const boxClips = fixed ? [] : clipsOf(ancestors).map((clip) => clip.node);
    invisible = anchor.hidden || anchorClipped(anchor, boxClips);
    noteAnchorScrollers(
      root,
      anchor.clips
        .filter((clip) => clip.node.scroll && !boxClips.includes(clip.node))
        .map((clip) => clip.node),
    );
  }
  child.forceHidden =
    (conditions.anchorValid && !anchor && needsDefaultAnchor(style)) ||
    invisible ||
    (conditions.noOverflow && !fits);
  // The walks paint and hit a fixed box from the host's origin
  // (specs/positioning.md).
  if (fixed) {
    child.hostRect = { x: parentAbsX + child.localRect.x, y: parentAbsY + child.localRect.y };
  }
}

/** The styles a box's last successful placement was found under
 * (specs/anchor-positioning.md "The placement that fit is kept"). */
function fallbackKey(style: CellStyle): string {
  return JSON.stringify([
    style.position,
    style.positionAnchor,
    style.positionArea,
    style.positionTryFallbacks,
    style.positionTryOrder,
    style.insets,
    style.anchorInsets,
    style.margin,
    style.width,
    style.height,
    style.minWidth,
    style.minHeight,
    style.maxWidth,
    style.maxHeight,
    style.anchorSizes,
    style.justifySelf,
    style.alignSelf,
    style.anchorCenter,
  ]);
}

/** A box's `anchor-size()`s in cells, from the anchors placed before it
 * — the one it names, else its own — each property's initial value
 * where none resolves (specs/anchor-positioning.md). */
function resolveAnchorSizes(style: CellStyle, anchors: Map<string, Anchor>): void {
  const sizes = Object.entries(style.anchorSizes) as [AnchorSizeProperty, AnchorSize][];
  for (const [property, size] of sizes) {
    const name = size.anchor ?? style.positionAnchor;
    const rect = name === null ? undefined : anchors.get(name)?.rect;
    setAnchorSize(style, property, rect?.[size.dimension], size.fallback);
  }
}

/** Whether a box refers to its default anchor: by an area,
 * `anchor-center`, or an anchor function naming none. */
function needsDefaultAnchor(style: CellStyle): boolean {
  return (
    style.positionArea !== null ||
    style.anchorCenter.x ||
    style.anchorCenter.y ||
    Object.values(style.anchorInsets).some((inset) => inset.anchor === null) ||
    Object.values(style.anchorSizes).some((size) => size.anchor === null)
  );
}

/** Notes on the root the scroll containers whose scroll moves an anchor
 * under a box, for their scroll's relayout. */
function noteAnchorScrollers(root: LayoutNode, scrollers: LayoutNode[]): void {
  if (scrollers.length === 0) return;
  root.anchorScrollers ??= new Set();
  for (const scroller of scrollers) root.anchorScrollers.add(scroller.source);
}

/** A box's insets under a tactic's flips, its `anchor()`s resolved in
 * cells from the containing block's edge (specs/anchor-positioning.md
 * "`anchor()` is a point of the anchor"), the fallback where no anchor
 * resolves one. */
function resolvedInsets(
  style: CellStyle,
  cb: Rect,
  seen: (name: string | null) => Rect | undefined,
  flips: Flip[],
): PerSide<CellLength | null> {
  const insets = flips.length > 0 ? flipSides(style.insets, flips) : { ...style.insets };
  const authored = Object.entries(style.anchorInsets) as [Side, AnchorInset][];
  for (const [authoredSide, { anchor, fraction, fallback }] of authored) {
    const { side, mirrored } = flipSide(authoredSide, flips);
    const rect = fraction === null ? undefined : seen(anchor ?? style.positionAnchor);
    if (rect === undefined || fraction === null) {
      insets[side] = fallback ?? null;
      continue;
    }
    const vertical = side === "top" || side === "bottom";
    const start = vertical ? rect.y : rect.x;
    const size = vertical ? rect.height : rect.width;
    // Rounded from the edge it is measured from, the far one mirrored,
    // so a flip mirrors the cell too.
    const cells = roundHalfAwayFromZero(fraction * size);
    const at = mirrored ? start + size - cells : start + cells;
    insets[side] = {
      top: at - cb.y,
      right: cb.x + cb.width - at,
      bottom: cb.y + cb.height - at,
      left: at - cb.x,
    }[side];
  }
  return insets;
}

/** The block a box's insets leave in its containing block, an auto
 * inset as zero; negative where they cross. */
function insetBlock(cb: Rect, insets: PerSide<CellLength | null>): Rect {
  const inset = (side: Side, basis: number): number => {
    const length = insets[side];
    return length === null ? 0 : resolveLength(length, basis);
  };
  const left = inset("left", cb.width);
  const top = inset("top", cb.height);
  return {
    x: cb.x + left,
    y: cb.y + top,
    width: cb.width - left - inset("right", cb.width),
    height: cb.height - top - inset("bottom", cb.height),
  };
}

/** Whether a placed box's margin box lies inside a block, one crossed
 * into a negative size holding none (specs/anchor-positioning.md). */
function fitsIn(
  child: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  block: Rect,
  margin: NullableInsets,
): boolean {
  if (block.width < 0 || block.height < 0) return false;
  const x = parentAbsX + child.localRect.x;
  const y = parentAbsY + child.localRect.y;
  return (
    x - (margin.left ?? 0) >= block.x &&
    y - (margin.top ?? 0) >= block.y &&
    x + child.localRect.width + (margin.right ?? 0) <= block.x + block.width &&
    y + child.localRect.height + (margin.bottom ?? 0) <= block.y + block.height
  );
}

/** An absolute box placed by its insets and margins in its containing
 * block, its static position where both an axis's insets are auto, or
 * under `anchor-center` centered on its anchor in the block its insets
 * leave, auto insets and margins as zero; its margins, resolved. */
function placeByInsets(
  child: LayoutNode,
  parent: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  cb: Rect,
  insets: PerSide<CellLength | null>,
  margins: PerSide<CellLength | null>,
  anchor: Rect | undefined,
  flips: Flip[],
  cache: IntrinsicCache,
): NullableInsets {
  const style = child.style;
  delete child.anchorArea;
  const self = flipSelf(style, flips);
  const centerX = self.x === "anchor-center" && anchor !== undefined;
  const centerY = self.y === "anchor-center" && anchor !== undefined;
  const margin = resolveMargin(margins, cb.width);
  if (centerX) {
    margin.left ??= 0;
    margin.right ??= 0;
  }
  if (centerY) {
    margin.top ??= 0;
    margin.bottom ??= 0;
  }
  const inset = (side: Side, basis: number, centered: boolean): number | null => {
    const length = insets[side];
    if (length === null) return centered ? 0 : null;
    return resolveLength(length, basis);
  };
  const left = inset("left", cb.width, centerX);
  const right = inset("right", cb.width, centerX);
  const top = inset("top", cb.height, centerY);
  const bottom = inset("bottom", cb.height, centerY);
  const marginLeft = margin.left ?? 0;
  const marginRight = margin.right ?? 0;
  const marginTop = margin.top ?? 0;
  const marginBottom = margin.bottom ?? 0;

  // Used width, per CSS in priority order: an explicit width resolves
  // against the CONTAINING BLOCK (percent included); opposing insets with
  // an auto width stretch the box between them; otherwise shrink-to-fit
  // (fit-content) within the space the insets and margins leave. All
  // clamped by the element's min/max against the containing block. A
  // centered box shrinks to fit the block its insets leave.
  const heightAuto = style.height === undefined || style.height.kind === "auto";
  const across = marginLeft + marginRight;
  const forced: { width?: number; height?: number } = {
    width: centerX
      ? absoluteWidth(child, cb.width, null, null, across + left! + right!, cache)
      : absoluteWidth(child, cb.width, left, right, across, cache),
  };
  if (top !== null && bottom !== null && heightAuto && !centerY) {
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
  if (centerX) {
    const blockWidth = cb.width - left! - right!;
    x = alignInArea(
      "center",
      cb.x + left!,
      blockWidth,
      anchor!.x,
      anchor!.width,
      width,
      marginLeft,
      marginRight,
      "anchor-center",
    );
  } else if (left !== null && right !== null) {
    x =
      cb.x +
      left +
      insetMarginOffset(margin.left, margin.right, cb.width - left - right, width, "x");
  } else if (left !== null) {
    x = cb.x + left + marginLeft;
  } else if (right !== null) {
    x = cb.x + cb.width - right - width - marginRight;
  } else {
    x = staticPositionX(child, parent, parentAbsX, width);
  }
  let y: number;
  if (centerY) {
    const blockHeight = cb.height - top! - bottom!;
    y = alignInArea(
      "center",
      cb.y + top!,
      blockHeight,
      anchor!.y,
      anchor!.height,
      height,
      marginTop,
      marginBottom,
      "anchor-center",
    );
  } else if (top !== null && bottom !== null) {
    y =
      cb.y +
      top +
      insetMarginOffset(margin.top, margin.bottom, cb.height - top - bottom, height, "y");
  } else if (top !== null) {
    y = cb.y + top + marginTop;
  } else if (bottom !== null) {
    y = cb.y + cb.height - bottom - height - marginBottom;
  } else {
    y = staticPositionY(child, parent, parentAbsY, height);
  }

  child.localRect = { ...child.localRect, x: x - parentAbsX, y: y - parentAbsY };
  return margin;
}

/** A box's offset in the space two insets leave, where a margin (`null`)
 * is auto (CSS 2 §10.3.7, §10.6.4): one auto margin takes what is left,
 * negative included; two split it, negative only vertically — an
 * over-wide box starts at the left. */
function insetMarginOffset(
  before: number | null,
  after: number | null,
  space: number,
  size: number,
  axis: "x" | "y",
): number {
  if (before !== null && after !== null) return before;
  if (before === null && after === null) {
    const split = Math.floor((space - size) / 2);
    return axis === "x" ? Math.max(0, split) : split;
  }
  return before ?? space - size - after!;
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

/** One of a box's placements (specs/anchor-positioning.md): in an area
 * of its default anchor, or by its insets, under a tactic's flips;
 * `option` its index among them, the base 0. */
interface Attempt {
  option: number;
  area: PositionArea | null;
  flips: Flip[];
}

/** An absolute box placed, and whether its margin box fits the block it
 * is placed in: a plain one by its insets, one with fallbacks as CSS
 * tries them (specs/anchor-positioning.md "Fallbacks flip" and "The
 * placement that fit is kept"). */
function placeTrying(
  child: LayoutNode,
  parent: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  cb: Rect,
  seen: (name: string | null) => Rect | undefined,
  key: string,
  pass: Pass,
): boolean {
  const style = child.style;
  const fallbacks = style.positionTryFallbacks;
  const centered = style.anchorCenter.x || style.anchorCenter.y;
  const areas = style.positionArea !== null || fallbacks.some((fallback) => !("flips" in fallback));
  const anchor = areas || centered ? seen(style.positionAnchor) : undefined;
  const base: Attempt = { option: 0, area: anchor ? style.positionArea : null, flips: [] };
  const options = [base];
  fallbacks.forEach((fallback, i) => {
    if ("flips" in fallback) {
      const area = base.area && flipArea(base.area, fallback.flips);
      options.push({ option: i + 1, area, flips: fallback.flips });
    } else if (anchor) {
      options.push({ option: i + 1, area: fallback, flips: [] });
    }
  });
  const blocks = new Map<Attempt, { block: Rect; insets: PerSide<CellLength | null> }>();
  /** The block an attempt places the box in — its area, or what its
   * insets leave — with those insets. */
  const blockOf = (attempt: Attempt): { block: Rect; insets: PerSide<CellLength | null> } => {
    let entry = blocks.get(attempt);
    if (!entry) {
      if (attempt.area) {
        entry = { block: areaBlock(attempt.area, cb, anchor!), insets: style.insets };
      } else {
        const insets = resolvedInsets(style, cb, seen, attempt.flips);
        entry = { block: insetBlock(cb, insets), insets };
      }
      blocks.set(attempt, entry);
    }
    return entry;
  };
  const place = (attempt: Attempt): boolean => {
    const { block, insets } = blockOf(attempt);
    const margins = flipSides(style.margin, attempt.flips);
    const margin = attempt.area
      ? placeInArea(
          child,
          parentAbsX,
          parentAbsY,
          block,
          anchor!,
          attempt.area,
          attempt.flips,
          margins,
          pass.cache,
        )
      : placeByInsets(
          child,
          parent,
          parentAbsX,
          parentAbsY,
          cb,
          insets,
          margins,
          anchor,
          attempt.flips,
          pass.cache,
        );
    return fitsIn(child, parentAbsX, parentAbsY, block, margin);
  };
  if (options.length === 1) return place(base);
  if (style.positionTryOrder !== "normal") {
    const axis = style.positionTryOrder === "most-width" ? "width" : "height";
    options.sort((a, b) => blockOf(b).block[axis] - blockOf(a).block[axis]);
  }
  pass.placed.add(child.source);
  const remembered = pass.remembered.get(child.source);
  const current =
    remembered?.key === key
      ? options.find((attempt) => attempt.option === remembered.option)
      : undefined;
  if (current && place(current)) return true;
  for (const attempt of options) {
    if (attempt === current || !place(attempt)) continue;
    pass.remembered.set(child.source, { key, option: attempt.option });
    return true;
  }
  const standing = current ?? base;
  place(standing);
  pass.remembered.set(child.source, { key, option: standing.option });
  return false;
}

/** An area's block: a cell of the anchor's 3×3 grid over the
 * containing block. */
function areaBlock(area: PositionArea, cb: Rect, anchor: Rect): Rect {
  const [x, width] = areaSpan(area.x, cb.x, cb.width, anchor.x, anchor.width);
  const [y, height] = areaSpan(area.y, cb.y, cb.height, anchor.y, anchor.height);
  return { x, y, width, height };
}

/** A box laid out with an area as its containing block and aligned
 * toward the anchor, its self-alignment under the tactic's flips; its
 * margins, resolved. */
function placeInArea(
  child: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  region: Rect,
  anchor: Rect,
  area: PositionArea,
  flips: Flip[],
  margins: PerSide<CellLength | null>,
  cache: IntrinsicCache,
): NullableInsets {
  const margin = resolveMargin(margins, region.width);
  const across = (margin.left ?? 0) + (margin.right ?? 0);
  layoutNode(child, region.width, region.height, 0, 0, "shrink", cache, {
    width: absoluteWidth(child, region.width, null, null, across, cache),
  });
  const { width, height } = child.localRect;
  const self = flipSelf(child.style, flips);
  const x = alignInArea(
    area.x,
    region.x,
    region.width,
    anchor.x,
    anchor.width,
    width,
    margin.left ?? 0,
    margin.right ?? 0,
    self.x,
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
    self.y,
  );
  child.localRect = { ...child.localRect, x: x - parentAbsX, y: y - parentAbsY };
  child.anchorArea = area;
  return margin;
}

type SelfAlign = CellStyle["alignSelf"] | "anchor-center";

/** A box's self-alignment on each axis under a tactic's flips, as CSS
 * flips it: `start` and `end` trade on a mirrored axis, the two axes
 * under `flip-start`. */
function flipSelf(style: CellStyle, flips: Flip[]): { x: SelfAlign; y: SelfAlign } {
  return flipAxes<SelfAlign>(
    style.anchorCenter.x ? "anchor-center" : style.justifySelf,
    style.anchorCenter.y ? "anchor-center" : style.alignSelf,
    flips,
    (self) => (self === "start" ? "end" : self === "end" ? "start" : self),
  );
}

/** A value per axis under a tactic's flips, in their order: `block`
 * mirrors y, `inline` x, and `start` swaps the two. */
function flipAxes<T>(x: T, y: T, flips: Flip[], mirror: (value: T) => T): { x: T; y: T } {
  for (const flip of flips) {
    if (flip === "block") y = mirror(y);
    else if (flip === "inline") x = mirror(x);
    else [x, y] = [y, x];
  }
  return { x, y };
}

/** Where a side lands under a tactic's flips, in their order, and
 * whether its axis was mirrored on the way. */
function flipSide(side: Side, flips: Flip[]): { side: Side; mirrored: boolean } {
  let at = side;
  let mirrored = false;
  for (const flip of flips) {
    const vertical = at === "top" || at === "bottom";
    if (flip === "start") {
      at = ({ top: "left", left: "top", bottom: "right", right: "bottom" } as const)[at];
    } else if ((flip === "block") === vertical) {
      at = ({ top: "bottom", bottom: "top", left: "right", right: "left" } as const)[at];
      mirrored = !mirrored;
    }
  }
  return { side: at, mirrored };
}

/** Per-side values — margins, insets — under a tactic's flips, each
 * moved to its mirrored side as CSS moves them, so a gap or a shift set
 * on the anchor's side follows the box. */
function flipSides<T>(sides: PerSide<T>, flips: Flip[]): PerSide<T> {
  if (flips.length === 0) return sides;
  const flipped = { ...sides };
  for (const side of SIDES) flipped[flipSide(side, flips).side] = sides[side];
  return flipped;
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
  self: SelfAlign,
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

/** An area under a tactic's flips (`flipAxes`). */
function flipArea(area: PositionArea, flips: Flip[]): PositionArea {
  return flipAxes(area.x, area.y, flips, (side) => MIRRORED[side]);
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
  return isMain
    ? soleItemMainOffset(effectiveJustify(parent.style), inner, size + before + after) + before
    : alignedOffset(effectiveAlign(child, parent), before, after, inner, size);
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
  return alignedOffset(align, before, after, inner, size);
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
