/**
 * A sticky box's shift from its scroll container's cell-quantized offset
 * (specs/sticky.md) — css-position-3 §3.4 in cells — onto its
 * `paintOrigin` as paint-origin.ts places it; a sticky inline element's
 * lands on its record for the leaf's cell walk.
 */

import { partExtent } from "./lattice.ts";
import { edges, resolveLength } from "./layout.ts";
import { clipBounds, inlineElementRects } from "./plain-text.ts";
import type { CellLength, LayoutNode, PerSide, TableLattice } from "./types.ts";

/** A span on one axis, in painted cells: `end` exclusive. */
interface Span {
  start: number;
  end: number;
}

/** A box's span on each axis. */
interface Box {
  x: Span;
  y: Span;
}

/** The shift on one axis: the box's start edge kept at or past the
 * view's start inset and its end edge at or before the view's end
 * inset, the start inset winning when both bind; then the box kept
 * inside its block — none of the shift toward a side the box already
 * crosses. Insets in cells, `null` for `auto`. */
export function stickyShiftAxis(
  box: Span,
  block: Span,
  view: Span,
  startInset: number | null,
  endInset: number | null,
): number {
  let shift = 0;
  if (endInset !== null && box.end > view.end - endInset) shift = view.end - endInset - box.end;
  if (startInset !== null && box.start + shift < view.start + startInset) {
    shift = view.start + startInset - box.start;
  }
  if (shift > 0) return Math.min(shift, Math.max(0, block.end - box.end));
  if (shift < 0) return Math.max(shift, Math.min(0, block.start - box.start));
  return 0;
}

/** A scroll container and the cells its content shows through, where
 * it paints. */
export interface Scrollport {
  node: LayoutNode;
  view: Box;
}

/** A scroll container's scrollport, once its `paintOrigin` is placed. */
export function scrollportOf(node: LayoutNode): Scrollport | null {
  const clip = clipBounds(node, node.paintOrigin.x, node.paintOrigin.y);
  if (!clip) return null;
  return {
    node,
    view: { x: { start: clip.x0, end: clip.x1 }, y: { start: clip.y0, end: clip.y1 } },
  };
}

/** The shift on both axes (`stickyShiftAxis`), undefined for none. */
function shiftWithin(
  box: Box,
  block: Box,
  view: Box,
  insets: PerSide<number | null>,
): { x: number; y: number } | undefined {
  const x = stickyShiftAxis(box.x, block.x, view.x, insets.left, insets.right);
  const y = stickyShiftAxis(box.y, block.y, view.y, insets.top, insets.bottom);
  return x === 0 && y === 0 ? undefined : { x, y };
}

/** A sticky box's shift, onto its `paintOrigin`. */
export function stick(
  node: LayoutNode,
  parent: LayoutNode,
  port: Scrollport | null,
  table: LayoutNode | null,
): void {
  delete node.stickyShift;
  if (!port) return;
  const { view } = port;
  // A table part is kept inside its table; anything else inside its
  // parent — the scroll container's content extended to what it
  // scrolls. A table part's box takes in the lattice lines on its
  // edges, which its rect leaves out and which move with it.
  const part = node.style.tableRole !== "none" ? table : null;
  const lines = part?.lattice ? partLines(part.lattice, node) : NO_LINES;
  const origin = node.paintOrigin;
  const { width, height } = node.localRect;
  const box = {
    x: { start: origin.x - lines.left, end: origin.x + width + lines.right },
    y: { start: origin.y - lines.top, end: origin.y + height + lines.bottom },
  };
  const across = view.x.end - view.x.start;
  const down = view.y.end - view.y.start;
  const { insets } = node.style;
  const shift = shiftWithin(box, contentBox(part ?? parent, port.node), view, {
    top: inset(insets.top, down),
    right: inset(insets.right, across),
    bottom: inset(insets.bottom, down),
    left: inset(insets.left, across),
  });
  if (!shift) return;
  node.stickyShift = shift;
  origin.x += shift.x;
  origin.y += shift.y;
}

/** A leaf's sticky inline elements, each shifted within the leaf's
 * content box where it paints, from its fragments' bounds before any
 * shift. */
export function stickInline(node: LayoutNode, port: Scrollport | null): void {
  const entries = node.inlineElements!;
  for (const entry of entries) if (entry.sticky !== undefined) delete entry.stickyShift;
  if (!port) return;
  const { x, y } = node.paintOrigin;
  const bounds = new Map<Element, Box>();
  for (const { element, rect } of inlineElementRects(node, x, y)) {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const box = bounds.get(element);
    if (!box) {
      bounds.set(element, { x: { start: rect.x, end: right }, y: { start: rect.y, end: bottom } });
      continue;
    }
    box.x.start = Math.min(box.x.start, rect.x);
    box.x.end = Math.max(box.x.end, right);
    box.y.start = Math.min(box.y.start, rect.y);
    box.y.end = Math.max(box.y.end, bottom);
  }
  const block = contentBox(node, port.node);
  for (const entry of entries) {
    const box = entry.sticky && bounds.get(entry.element);
    if (!box) continue;
    const shift = shiftWithin(box, block, port.view, entry.sticky!);
    if (shift) entry.stickyShift = shift;
  }
}

const NO_LINES: Readonly<PerSide<number>> = { top: 0, right: 0, bottom: 0, left: 0 };

/** The lattice line cells on a table part's edges (specs/table.md): the
 * lines above and below its rows, and beside a cell's columns — a row
 * or row group already spans the table's width, lines included. */
function partLines(lattice: TableLattice, part: LayoutNode): Readonly<PerSide<number>> {
  const extent = partExtent(lattice, part);
  if (!extent) return NO_LINES;
  const { r0, r1, c0, c1 } = extent;
  const isCell = part.style.tableRole === "cell";
  return {
    top: lattice.hLines[r0]!,
    bottom: lattice.hLines[r1 + 1]!,
    left: isCell ? lattice.vLines[c0]! : 0,
    right: isCell ? lattice.vLines[c1 + 1]! : 0,
  };
}

/** A sticky inset in cells, a percentage against the scrollport. */
function inset(length: CellLength | null, viewSize: number): number | null {
  return length === null ? null : resolveLength(length, viewSize);
}

/** A node's content box in painted cells, where its children paint, its
 * scroll applied; a scroll container's extends to what it scrolls. */
function contentBox(node: LayoutNode, scroller: LayoutNode): Box {
  const { border } = node.style;
  const padding = node.resolvedPadding;
  const x0 = node.paintOrigin.x - (node.scroll?.x ?? 0) + border.left + padding.left;
  const y0 = node.paintOrigin.y - (node.scroll?.y ?? 0) + border.top + padding.top;
  let width = node.localRect.width - edges(border, padding, "x");
  let height = node.localRect.height - edges(border, padding, "y");
  if (node === scroller && node.scrollRange) {
    width = Math.max(width, node.scrollRange.sizeX);
    height = Math.max(height, node.scrollRange.sizeY);
  }
  return { x: { start: x0, end: x0 + width }, y: { start: y0, end: y0 + height } };
}
