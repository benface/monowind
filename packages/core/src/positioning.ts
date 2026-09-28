import {
  clampSize,
  containsAbsolute,
  edges,
  fixedMargins,
  isPositioned,
  layoutNode,
  resolveLength,
  resolveLimit,
  resolveMargin,
  resolveSizeAgainst,
  resolveWidthLimit,
} from "./layout.ts";
import type { IntrinsicCache } from "./layout.ts";
import {
  alignedOffset,
  effectiveAlign,
  effectiveJustify,
  lineAlign,
  mainAxisOffsets,
  resolveFlexEdge,
} from "./flex.ts";
import { roundHalfAwayFromZero } from "./metrics.ts";
import { clipBounds, inlineElementRects } from "./plain-text.ts";
import { scrollportOf, stickyShift } from "./sticky.ts";
import { IMPLICIT_ANCHOR, setAnchorSize } from "./style.ts";
import { SIDES } from "./types.ts";
import type {
  AnchorInset,
  AnchorScope,
  AnchorSize,
  AnchorSizeProperty,
  AreaSide,
  CellLength,
  CellStyle,
  Flip,
  InlineElement,
  LayoutNode,
  NullableInsets,
  PerSide,
  Position,
  PositionArea,
  Rect,
  Side,
} from "./types.ts";

/** Positioning pass (specs/positioning.md): after flow layout, place
 * out-of-flow boxes against their containing blocks and apply relative
 * offsets, top-down so ancestor rects are final first (layout.ts has the
 * import cycle between the layout modules). */

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

/** An element naming an anchor, as the boxes that look it up see it
 * (specs/anchor-positioning.md). */
interface Anchor {
  /** Its border box in the host's cells as laid out, its sticky boxes stuck. */
  rect: Rect;
  /** The frames on its containing-block chain, from the host, whose
   * scroll moves it and whose clip hides it. */
  chain: Frame[];
  /** The sticky boxes on its chain, each with its scroll container and
   * the shift it adds to `rect`. */
  stuck: { box: LayoutNode; scroller: LayoutNode; x: number; y: number }[];
  /** Whether it paints nothing of its own: `visibility`, or a
   * `position-visibility` hiding it or a box above. */
  hidden: boolean;
  /** Its tree order, a tie the later recorded's. */
  order: number;
  topLayer: boolean;
  /** The element whose `anchor-scope` keeps its name, if one does. */
  scope: object | null;
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
  /** Each name's anchors, the last acceptable one a box's. */
  anchors: Map<string, Anchor[]>;
  /** The tree order recorded: an outermost absolute box's for all it holds. */
  order: number;
  remembered: Map<Element, Remembered>;
  /** The boxes with placements to remember, the rest forgotten. */
  placed: Set<Element>;
  /** The scroll offsets under a box, synced as the pass sizes it. */
  syncScroll: ((node: LayoutNode) => void) | undefined;
  /** The boxes between an absolute box and its containing block. */
  crossed: Set<LayoutNode>;
}

/** Places the out-of-flow boxes under `root`; `remembered` keeps each
 * anchored box's last successful placement from one pass to the next,
 * a box no pass places again forgotten. A placed box's scroll offsets
 * are synced before the anchors inside it are read (`syncScroll`).
 * Returns the boxes an absolute box crosses to its containing block. */
export function positionOutOfFlow(
  root: LayoutNode,
  cache: IntrinsicCache,
  remembered: Map<Element, Remembered> = new Map(),
  syncScroll?: (node: LayoutNode) => void,
): ReadonlySet<LayoutNode> {
  const pass: Pass = {
    cache,
    anchors: new Map(),
    order: 0,
    remembered,
    placed: new Set(),
    syncScroll,
    crossed: new Set(),
  };
  const deferred: (() => void)[] = [];
  const host = [{ node: root, absX: 0, absY: 0 }];
  for (const child of root.children) walk(child, host, pass, deferred);
  for (const place of deferred) place();
  for (const element of remembered.keys()) {
    if (!pass.placed.has(element)) remembered.delete(element);
  }
  return pass.crossed;
}

/** Offsets a box or places an absolute one, records its anchors, then
 * walks its children, in tree order; the first walk defers each
 * outermost absolute box, so an anchor later in flow is there for it. */
function walk(child: LayoutNode, ancestors: Frame[], pass: Pass, deferred?: (() => void)[]): void {
  const { node: parent, absX, absY } = ancestors.at(-1)!;
  const absolute = effectivePosition(child.style) === "absolute";
  if (deferred) {
    const order = (pass.order += 1);
    if (absolute) {
      deferred.push(() => {
        pass.order = order;
        walk(child, ancestors, pass);
      });
      return;
    }
  }
  if (absolute) {
    placeAbsolute(child, parent, absX, absY, ancestors, pass);
    pass.syncScroll?.(child);
    for (let i = ancestors.length - 1; i > 0 && child.style.position === "absolute"; i--) {
      if (containsAbsolute(ancestors[i]!.node.style)) break;
      pass.crossed.add(ancestors[i]!.node);
    }
  } else {
    offsetRelative(child, parent);
  }
  const x = absX + child.localRect.x;
  const y = absY + child.localRect.y;
  recordAnchors(child, x, y, ancestors, pass);
  const frames = [...ancestors, { node: child, absX: x, absY: y }];
  for (const grandchild of child.children) walk(grandchild, frames, pass, deferred);
}

/** A relative box's offset: a pure visual shift, percent insets against
 * the parent's content box, `top` over `bottom` and `left` over `right`
 * (LTR). */
function offsetRelative(child: LayoutNode, parent: LayoutNode): void {
  if (effectivePosition(child.style) !== "relative") return;
  const { border } = parent.style;
  const { insets } = child.style;
  const contentW = parent.localRect.width - edges(border, parent.resolvedPadding, "x");
  const contentH = parent.localRect.height - edges(border, parent.resolvedPadding, "y");
  child.localRect.x += relativeOffset(insets.left, insets.right, contentW);
  child.localRect.y += relativeOffset(insets.top, insets.bottom, contentH);
}

function relativeOffset(start: CellLength | null, end: CellLength | null, basis: number): number {
  if (start !== null) return resolveLength(start, basis);
  if (end !== null) return -resolveLength(end, basis);
  return 0;
}

/** A box's names, or a named inline element's in its runs, its first
 * fragment's box, each with what a lookup weighs; recorded as the box
 * is laid out or placed, so an anchor inside an absolute box is there
 * for the boxes after it alone. */
function recordAnchors(
  child: LayoutNode,
  absX: number,
  absY: number,
  ancestors: Frame[],
  pass: Pass,
): void {
  const inline = child.inlineElements?.filter((entry) => entry.anchorNames.length > 0) ?? [];
  if (child.style.anchorNames.length === 0 && inline.length === 0) return;
  const { position } = child.style;
  const boxes = [...ancestors.map((frame) => frame.node), child];
  const chain = containingChain(ancestors, position);
  // An inline anchor's chain goes on into its box, whose scroll and clip
  // (`truncate`) reach it.
  const inner = [...chain, { node: child, absX, absY }];
  const stuck = stuckOn(inner);
  const stuckX = stuck.reduce((sum, { x }) => sum + x, 0);
  const stuckY = stuck.reduce((sum, { y }) => sum + y, 0);
  const { order } = pass;
  const topLayer = boxes.some((box) => box.style.topLayer);
  const hiddenAbove = boxes.some((box) => box.forceHidden === true);
  const record = (names: string[], at: Rect, hidden: boolean, owner?: InlineElement): void => {
    const rect = { ...at, x: at.x + stuckX, y: at.y + stuckY };
    for (const name of names) {
      const scope = scopeOf(name, boxes, owner);
      const anchor = { rect, chain: owner ? inner : chain, stuck, hidden, order, topLayer, scope };
      const list = pass.anchors.get(name);
      if (list) list.push(anchor);
      else pass.anchors.set(name, [anchor]);
    }
  };
  const rect = { x: absX, y: absY, width: child.localRect.width, height: child.localRect.height };
  record(child.style.anchorNames, rect, hiddenAbove || !child.style.visible);
  if (inline.length === 0) return;
  const named = new Map(inline.map((entry) => [entry.element, entry]));
  // As laid out: unscrolled, and whole where a truncation cuts it.
  const { x, y } = child.scroll ?? { x: 0, y: 0 };
  for (const { element, rect } of inlineElementRects(child, absX + x, absY + y, false)) {
    const entry = named.get(element);
    if (entry === undefined) continue;
    record(entry.anchorNames, rect, hiddenAbove || !entry.visible, entry);
    named.delete(element);
  }
}

/** The sticky boxes on a containing-block chain, `frames`, each with
 * its scroll container and the shift it puts on the chain's last where
 * the scroll shows it (specs/anchor-positioning.md). */
function stuckOn(frames: Frame[]): Anchor["stuck"] {
  const stuck: Anchor["stuck"] = [];
  let scroller: LayoutNode | undefined;
  let table: LayoutNode | null = null;
  frames.forEach(({ node: box }, i) => {
    const port = box.style.position === "sticky" ? scroller : undefined;
    if (port) {
      const { x, y } = port.scroll ?? { x: 0, y: 0 };
      // Where each box paints: inside the scroller, moved by its scroll.
      const at = (node: LayoutNode) => {
        const { absX, absY } = frames.find((frame) => frame.node === node)!;
        return node === port ? { x: absX, y: absY } : { x: absX - x, y: absY - y };
      };
      const view = scrollportOf(port, at);
      const shift = view && stickyShift(box, frames[i - 1]!.node, view, table, at);
      if (shift) stuck.push({ box, scroller: port, ...shift });
    }
    if (box.scrollRange) scroller = box;
    if (box.style.display === "table") table = box;
  });
  return stuck;
}

/** The innermost element whose `anchor-scope` keeps a name, from an
 * inline `owner` out through `boxes`, innermost last; none for an
 * invoker's name, which no scope reaches. */
function scopeOf(name: string, boxes: LayoutNode[], owner?: InlineElement): object | null {
  if (!authored(name)) return null;
  const keeps = (scope: AnchorScope | undefined) => scope === "all" || scope?.includes(name);
  if (owner && keeps(owner.anchorScope)) return owner.element;
  for (let i = boxes.length - 1; i >= 0; i--) {
    if (keeps(boxes[i]!.style.anchorScope)) return boxes[i]!;
  }
  return null;
}

/** A box's anchor for a name: the last in tree order acceptable to it
 * (specs/anchor-positioning.md "Locked decisions") — recorded, so any
 * absolute box it lies in is placed and before the box; inside the
 * box's containing block, the block itself aside (anywhere, for a fixed
 * box's); in the box's scope for the name; and in the top layer only
 * for a box there too. */
function anchorFor(
  name: string,
  child: LayoutNode,
  ancestors: Frame[],
  pass: Pass,
): Anchor | undefined {
  const boxes = [...ancestors.map((frame) => frame.node), child];
  const block = child.style.position === "fixed" ? null : containingFrame(ancestors).node;
  const scope = scopeOf(name, boxes);
  const topLayer = boxes.some((box) => box.style.topLayer);
  let found: Anchor | undefined;
  for (const anchor of pass.anchors.get(name) ?? []) {
    if (anchor.scope !== scope || (anchor.topLayer && !topLayer)) continue;
    if (block !== null && !anchor.chain.some((frame) => frame.node === block)) continue;
    if (!found || anchor.order >= found.order) found = anchor;
  }
  return found;
}

/** The elements of a tree naming an anchor by an authored `anchor-name`,
 * and whether a box in it is anchored by such a name: what `anchor-scope`
 * changes the read of (specs/anchor-positioning.md "Reading"). */
export function namedAnchors(root: LayoutNode): { named: Set<Element>; anchored: boolean } {
  const named = new Set<Element>();
  let anchored = false;
  const visit = (node: LayoutNode): void => {
    if (!node.anonymous && node.style.anchorNames.some(authored)) named.add(node.source);
    for (const entry of node.inlineElements ?? []) {
      if (entry.anchorNames.some(authored)) named.add(entry.element);
    }
    anchored ||= anchoredByName(node.style);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return { named, anchored };
}

/** Whether a name is an author's: the engine's (an invoker's) start with `IMPLICIT_ANCHOR`. */
function authored(name: string | null): boolean {
  return name !== null && !name.startsWith(IMPLICIT_ANCHOR);
}

/** Whether a box's `position-anchor`, `anchor()` or `anchor-size()` names an authored anchor. */
function anchoredByName(style: CellStyle): boolean {
  return (
    authored(style.positionAnchor) ||
    Object.values(style.anchorInsets).some((inset) => authored(inset.anchor)) ||
    Object.values(style.anchorSizes).some((size) => authored(size.anchor))
  );
}

/** The frames on a box's containing-block chain, whose scroll and clip
 * reach it (specs/positioning.md "Paint order"): its parent's for an
 * in-flow box, the nearest positioned one or layer root's for an
 * absolute box, and none above a fixed box, which paints from the
 * host; each on in turn. */
function containingChain(ancestors: Frame[], position: Position): Frame[] {
  const chain: Frame[] = [];
  let reach = position;
  for (let i = ancestors.length - 1; i >= 0 && reach !== "fixed"; i--) {
    const frame = ancestors[i]!;
    const { style } = frame.node;
    if (reach === "absolute" && i > 0 && !containsAbsolute(style)) continue;
    chain.unshift(frame);
    reach = style.position;
  }
  return chain;
}

/** Whether an anchor is clipped out of view by a box that clips it and
 * not the positioned box (specs/anchor-positioning.md): the anchor as
 * that box shows it — moved by the scroll of the clipping boxes inside
 * it — meets none of its window, the clip moved by its own scroll. */
function anchorClipped(anchor: Anchor, boxChain: LayoutNode[]): boolean {
  const { rect, chain } = anchor;
  // Overlap on an axis; a zero-size anchor needs its edge inside.
  const meets = (start: number, size: number, from: number, to: number): boolean =>
    size > 0 ? start + size > from && start < to : start >= from && start <= to;
  // Inside out, the scroll of the clips passed accumulating.
  let dx = 0;
  let dy = 0;
  for (let i = chain.length - 1; i >= 0; i--) {
    const { node, absX, absY } = chain[i]!;
    const bounds = clipBounds(node, absX, absY);
    if (!bounds) continue;
    const scrollX = node.scroll?.x ?? 0;
    const scrollY = node.scroll?.y ?? 0;
    if (!boxChain.includes(node)) {
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

/** The frame of a box's containing block: its nearest positioned
 * ancestor's, else the host's, a fixed box's always. */
function containingFrame(ancestors: Frame[], fixed = false): Frame {
  if (!fixed) {
    for (let i = ancestors.length - 1; i > 0; i--) {
      if (isPositioned(ancestors[i]!.node.style)) return ancestors[i]!;
    }
  }
  return ancestors[0]!;
}

/** The containing block's padding box, in absolute cells: the nearest
 * positioned ancestor, or the host for `fixed` / when none exists —
 * for a top-layer element, the host's cells the viewport shows, since
 * the platform resolves the top layer against the viewport and a
 * dialog centered in a host taller than the window would open out of
 * sight (specs/top-layer.md). */
function containingBlock(ancestors: Frame[], fixed: boolean, topLayer = false): Rect {
  const frame = containingFrame(ancestors, fixed);
  if (frame !== ancestors[0]) {
    const b = frame.node.style.border;
    return {
      x: frame.absX + b.left,
      y: frame.absY + b.top,
      width: Math.max(0, frame.node.localRect.width - b.left - b.right),
      height: Math.max(0, frame.node.localRect.height - b.top - b.bottom),
    };
  }
  const box = {
    x: frame.absX,
    y: frame.absY,
    width: frame.node.localRect.width,
    height: frame.node.localRect.height,
  };
  const visible = topLayer ? frame.node.visibleCells : undefined;
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
  const anchorOf = (name: string | null): Anchor | undefined =>
    name === null ? undefined : anchorFor(name, child, ancestors, pass);
  const sizes = (swap: boolean): void => resolveAnchorSizes(style, anchorOf, swap);
  const root = ancestors[0]!.node;
  const boxChain = containingChain(ancestors, style.position).map((frame) => frame.node);
  /** An anchor's rect as this box sees it, the scrollers moving it under
   * the box noted for their scroll's relayout. */
  const seen = (name: string | null): Rect | undefined => {
    const anchor = anchorOf(name);
    if (!anchor) return undefined;
    const { rect, movers } = anchorRectFor(anchor, boxChain);
    noteAnchorScrollers(root, movers);
    return rect;
  };
  const fits = placeTrying(child, parent, parentAbsX, parentAbsY, cb, seen, sizes, key, pass);
  // `position-visibility` (specs/anchor-positioning.md), its scroll
  // relaying out a box whose anchor scrolled out of view.
  const conditions = style.positionVisibility;
  const anchor = anchorOf(style.positionAnchor);
  let invisible = false;
  if (conditions.anchorVisible && anchor) {
    invisible = anchor.hidden || anchorClipped(anchor, boxChain);
    noteAnchorScrollers(
      root,
      anchor.chain.flatMap(({ node }) => (node.scroll && !boxChain.includes(node) ? [node] : [])),
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

/** A box's `anchor-size()`s in cells, from its anchors — the one it
 * names, else its own — each property's initial value where none
 * resolves (specs/anchor-positioning.md); each the other dimension
 * where `swap`. */
function resolveAnchorSizes(
  style: CellStyle,
  anchorOf: (name: string | null) => Anchor | undefined,
  swap: boolean,
): void {
  const sizes = Object.entries(style.anchorSizes) as [AnchorSizeProperty, AnchorSize][];
  for (const [property, { anchor, dimension, fallback }] of sizes) {
    const rect = anchorOf(anchor ?? style.positionAnchor)?.rect;
    const other = dimension === "width" ? "height" : "width";
    setAnchorSize(style, property, rect?.[swap ? other : dimension], fallback);
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
  const anchorInsets = Object.entries(style.anchorInsets) as [Side, AnchorInset][];
  for (const [authoredSide, { anchor, fraction, fallback }] of anchorInsets) {
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

/** An axis's sides, start then end, and its extent. */
const AXES = {
  x: { start: "left", end: "right", size: "width" },
  y: { start: "top", end: "bottom", size: "height" },
} as const;
type Axis = keyof typeof AXES;

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
  const margin = resolveMargin(margins, cb.width);
  /** An axis's insets in cells, auto as null — as zero, its auto margins
   * too, where it centers on the anchor. */
  const axisInsets = (axis: Axis) => {
    const { start, end, size } = AXES[axis];
    const centered = self[axis] === "anchor-center" && anchor !== undefined;
    if (centered) {
      margin[start] ??= 0;
      margin[end] ??= 0;
    }
    const inset = (side: Side): number | null => {
      const length = insets[side];
      if (length === null) return centered ? 0 : null;
      return resolveLength(length, cb[size]);
    };
    return { centered, start: inset(start), end: inset(end) };
  };
  const x = axisInsets("x");
  const y = axisInsets("y");

  // A centered box shrinks to fit the block its insets leave. With an
  // aspect ratio, a width its insets or size give derives the height,
  // else a height they give derives the width (specs/positioning.md).
  const across = fixedMargins(margin, "x");
  const stretchesY =
    y.start !== null && y.end !== null && style.height === undefined && !y.centered;
  const widthGiven =
    style.width !== undefined || (x.start !== null && x.end !== null && !x.centered);
  const derivesWidth =
    style.aspectRatio !== null && !widthGiven && (stretchesY || style.height !== undefined);
  const forced: { width?: number; height?: number } = {};
  if (!derivesWidth) {
    forced.width = x.centered
      ? absoluteWidth(child, cb.width, null, null, across + x.start! + x.end!, cache)
      : absoluteWidth(child, cb.width, x.start, x.end, across, cache);
  }
  if (stretchesY && (style.aspectRatio === null || derivesWidth)) {
    forced.height = clampSize(
      Math.max(0, cb.height - y.start! - y.end! - fixedMargins(margin, "y")),
      resolveLimit(style.minHeight, cb.height) ?? 0,
      resolveLimit(style.maxHeight, cb.height),
    );
  }
  layoutNode(child, cb.width, cb.height, 0, 0, "shrink", cache, forced);

  // Both insets and auto margins center (`inset-0 m-auto` idiom); one
  // auto margin takes what is left, negative included, two split it
  // negative only vertically — an over-wide box starts at the left (CSS
  // 2 §10.3.7, §10.6.4).
  const place = (axis: Axis, parentAbs: number): number => {
    const { centered, start, end } = axis === "x" ? x : y;
    const size = child.localRect[AXES[axis].size];
    if (centered) {
      const block = insetBlock(cb, insets);
      return alignInArea(axis, "center", block, anchor!, size, margin, "anchor-center");
    }
    if (start === null && end === null) return staticPosition(child, parent, axis, parentAbs, size);
    const cbStart = cb[axis];
    const cbSize = cb[AXES[axis].size];
    const before = margin[AXES[axis].start];
    const after = margin[AXES[axis].end];
    if (end === null) return cbStart + start! + (before ?? 0);
    if (start === null) return cbStart + cbSize - end - size - (after ?? 0);
    const space = cbSize - start - end;
    if (before === null && after === null) {
      const split = Math.floor((space - size) / 2);
      return cbStart + start + (axis === "x" ? Math.max(0, split) : split);
    }
    return cbStart + start + (before ?? space - size - after!);
  };
  child.localRect = {
    ...child.localRect,
    x: place("x", parentAbsX) - parentAbsX,
    y: place("y", parentAbsY) - parentAbsY,
  };
  return margin;
}

/** An anchor's rect as a box on `boxChain` sees it: moved by the scroll
 * of the scroll containers that move the anchor and not the box, and
 * back by those that move the box alone — the movers, whose scroll
 * takes a relayout — and by the stick of a sticky box the two share,
 * which moves both where they paint. */
function anchorRectFor(
  anchor: Anchor,
  boxChain: LayoutNode[],
): { rect: Rect; movers: LayoutNode[] } {
  let dx = 0;
  let dy = 0;
  const movers: LayoutNode[] = [];
  for (const { node: scroller } of anchor.chain) {
    if (!scroller.scroll || boxChain.includes(scroller)) continue;
    dx -= scroller.scroll.x;
    dy -= scroller.scroll.y;
    movers.push(scroller);
  }
  for (const scroller of boxChain) {
    if (!scroller.scroll || anchor.chain.some((frame) => frame.node === scroller)) continue;
    dx += scroller.scroll.x;
    dy += scroller.scroll.y;
    movers.push(scroller);
  }
  for (const { box, scroller, x, y } of anchor.stuck) {
    if (boxChain.includes(box)) {
      dx -= x;
      dy -= y;
    } else movers.push(scroller);
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
  const available = Math.max(0, cbWidth - (left ?? 0) - (right ?? 0) - margins);
  const width =
    style.width !== undefined
      ? resolveSizeAgainst(style.width, cbWidth, child, cache)
      : left !== null && right !== null
        ? available
        : resolveSizeAgainst({ kind: "fit-content" }, available, child, cache);
  return clampSize(
    width,
    resolveWidthLimit(style.minWidth, cbWidth, child, cache) ?? 0,
    resolveWidthLimit(style.maxWidth, cbWidth, child, cache),
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
  sizes: (swap: boolean) => void,
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
  /** The block an attempt places the box in — what its insets leave of
   * its area, its containing block there, or of the box's — with those
   * insets. */
  const blockOf = (attempt: Attempt): { block: Rect; insets: PerSide<CellLength | null> } => {
    let entry = blocks.get(attempt);
    if (!entry) {
      const within = attempt.area ? areaBlock(attempt.area, cb, anchor!) : cb;
      const insets = resolvedInsets(style, within, seen, attempt.flips);
      entry = { block: insetBlock(within, insets), insets };
      blocks.set(attempt, entry);
    }
    return entry;
  };
  const place = (attempt: Attempt): boolean => {
    // `flip-start` swaps the sizes with the axes, `anchor-size()`'s
    // dimension with them (css-anchor-position-1).
    const swapped = attempt.flips.filter((flip) => flip === "start").length % 2 === 1;
    sizes(swapped);
    if (swapped) swapSizes(style);
    const fits = placeIn(attempt);
    if (swapped) swapSizes(style);
    return fits;
  };
  const placeIn = (attempt: Attempt): boolean => {
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

/** A box's width and height traded, their limits with them. */
function swapSizes(style: CellStyle): void {
  [style.width, style.height] = [style.height, style.width];
  [style.minWidth, style.minHeight] = [style.minHeight, style.minWidth];
  [style.maxWidth, style.maxHeight] = [style.maxHeight, style.maxWidth];
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
  const across = fixedMargins(margin, "x");
  layoutNode(child, region.width, region.height, 0, 0, "shrink", cache, {
    width: absoluteWidth(child, region.width, null, null, across, cache),
  });
  const { width, height } = child.localRect;
  const self = flipSelf(child.style, flips);
  const x = alignInArea("x", area.x, region, anchor, width, margin, self.x);
  const y = alignInArea("y", area.y, region, anchor, height, margin, self.y);
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
    style.anchorCenter.x ? "anchor-center" : resolveFlexEdge(style.justifySelf, false),
    style.anchorCenter.y ? "anchor-center" : resolveFlexEdge(style.alignSelf, false),
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
  axis: Axis,
  side: AreaSide,
  region: Rect,
  anchor: Rect,
  size: number,
  margin: NullableInsets,
  self: SelfAlign,
): number {
  const { start, end, size: extent } = AXES[axis];
  const before = margin[start] ?? 0;
  const after = margin[end] ?? 0;
  const centerIn = (box: Rect) =>
    box[axis] + Math.floor((box[extent] - size - before - after) / 2) + before;
  const atStart = region[axis] + before;
  const atEnd = region[axis] + region[extent] - after - size;
  if (self === "start") return atStart;
  if (self === "end") return atEnd;
  if (self === "center") return centerIn(region);
  if (self !== "anchor-center") {
    if (side === "start" || side === "span-start") return atEnd;
    if (side === "end" || side === "span-end") return atStart;
  }
  return Math.max(atStart, Math.min(centerIn(anchor), atEnd));
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

/** The hypothetical sole-item box includes the element's fixed margins
 * (auto margins count as 0 in the static position, per CSS §10.1). */
function flexStaticOffset(
  child: LayoutNode,
  parent: LayoutNode,
  slot: { direction: "row" | "column"; innerWidth: number; innerHeight: number },
  axis: Axis,
  size: number,
): number {
  const margin = resolveMargin(child.style.margin, slot.innerWidth);
  const before = margin[AXES[axis].start] ?? 0;
  const after = margin[AXES[axis].end] ?? 0;
  const inner = axis === "x" ? slot.innerWidth : slot.innerHeight;
  const outer = size + before + after;
  return (slot.direction === "row") === (axis === "x")
    ? mainAxisOffsets(effectiveJustify(parent.style, 1), [outer], inner - outer)[0]! + before
    : alignedOffset(lineAlign(child, parent, false), before, after, inner, size);
}

/** The grid static position (specs/grid.md §10.1): the sole item of the
 * recorded static area, self-aligned (`justify-self` / `align-self`,
 * stretch behaving as start) with its fixed margins in the box. */
function gridStaticOffset(
  child: LayoutNode,
  parent: LayoutNode,
  area: Rect,
  axis: Axis,
  size: number,
): number {
  const margin = resolveMargin(child.style.margin, area.width);
  const { justifySelf } = child.style;
  const align =
    axis === "y"
      ? effectiveAlign(child, parent)
      : justifySelf === "auto"
        ? parent.style.justifyItems
        : justifySelf;
  const { start, end, size: extent } = AXES[axis];
  return alignedOffset(align, margin[start] ?? 0, margin[end] ?? 0, area[extent], size);
}

/** Where a box without insets on an axis sits, in absolute cells: the
 * static position its parent's layout recorded (`staticSlot`). */
function staticPosition(
  child: LayoutNode,
  parent: LayoutNode,
  axis: Axis,
  parentAbs: number,
  size: number,
): number {
  const slot = child.staticSlot;
  if (slot === undefined) return parentAbs;
  if (slot.kind === "block") return parentAbs + slot[axis];
  if (slot.kind === "grid") {
    const area = slot.staticArea;
    return parentAbs + area[axis] + gridStaticOffset(child, parent, area, axis, size);
  }
  const origin = axis === "x" ? slot.originX : slot.originY;
  return parentAbs + origin + flexStaticOffset(child, parent, slot, axis, size);
}
