/**
 * Sticky positioning (specs/sticky.md): a box's paint-time shift from
 * its scroll container's cell-quantized offset — css-position-3 §3.4
 * in cells — computed for the sticky boxes the layout pass collected,
 * each from its ancestor chain, and stored as `node.stickyShift` for
 * the walks (paint, hit-testing, focus) to add where they add the
 * box's own position. A sticky inline element's shift lands on its
 * record for the leaf's cell walk the same way.
 */

import { partExtent } from "./lattice.ts";
import { resolveLength } from "./layout.ts";
import { clipBounds, inlineElementRects } from "./plain-text.ts";
import type { CellLength, LayoutNode, TableLattice } from "./types.ts";

/** A span on one axis, in painted cells: `end` exclusive. */
export interface Span {
  start: number;
  end: number;
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

/** A sticky box, a leaf holding sticky inline elements, or a fixed box
 * off the top-layer stack — whose light element takes its ancestors'
 * scroll back (render.ts) — with its ancestors from the root down,
 * gathered once per layout. */
export interface StickyBox {
  node: LayoutNode;
  ancestors: LayoutNode[];
}

export function collectStickyBoxes(root: LayoutNode): StickyBox[] {
  const out: StickyBox[] = [];
  const chain: LayoutNode[] = [];
  const visit = (node: LayoutNode): void => {
    if (chain.length > 0 && shiftedForScroll(node)) out.push({ node, ancestors: chain.slice() });
    chain.push(node);
    for (const child of node.children) visit(child);
    chain.pop();
  };
  visit(root);
  return out;
}

/** A box whose light element moves for a scroll: a sticky one with
 * the scroll, a fixed one against it. */
function shiftedForScroll(node: LayoutNode): boolean {
  return (
    node.style.position === "sticky" ||
    (node.inlineElements?.some((entry) => entry.sticky !== undefined) ?? false) ||
    (node.hostRect !== undefined && node.topLayerRank === undefined)
  );
}

interface Origin {
  x: number;
  y: number;
}

/** The shifts for the current scroll offsets, in document order so a
 * parent's shift is known before its descendants'. */
export function applyStickyShifts(boxes: StickyBox[]): void {
  for (const box of boxes) applyStickyShift(box);
}

function applyStickyShift({ node, ancestors }: StickyBox): void {
  // Down the chain: each ancestor's painted origin (its own shift on),
  // the scroll container and table on the way, and the origin its
  // children paint from (its scroll off) — the parent's, at the end.
  let origin: Origin = { x: 0, y: 0 };
  let scroller: { node: LayoutNode; origin: Origin } | null = null;
  let table: { node: LayoutNode; origin: Origin } | null = null;
  for (const ancestor of ancestors) {
    const painted = {
      x: origin.x + ancestor.localRect.x + (ancestor.stickyShift?.x ?? 0),
      y: origin.y + ancestor.localRect.y + (ancestor.stickyShift?.y ?? 0),
    };
    origin = { x: painted.x - (ancestor.scroll?.x ?? 0), y: painted.y - (ancestor.scroll?.y ?? 0) };
    if (ancestor.scrollRange) scroller = { node: ancestor, origin: painted };
    if (ancestor.style.display === "table") table = { node: ancestor, origin };
  }
  const parent = ancestors[ancestors.length - 1]!;
  const view = scroller && clipBounds(scroller.node, scroller.origin.x, scroller.origin.y);
  const painted = { x: origin.x + node.localRect.x, y: origin.y + node.localRect.y };

  if (node.style.position === "sticky") {
    delete node.stickyShift;
    if (view) {
      // A table part is kept inside its table; anything else inside its
      // parent — the scroll container's content extended to what it
      // scrolls.
      const owner = node.style.tableRole !== "none" && table ? table : { node: parent, origin };
      const block = contentBox(owner.node, owner.origin, scroller!.node);
      // A table part's box takes in the lattice lines on its edges, which
      // its rect leaves out and which move with it.
      const lines =
        owner === table && table.node.lattice
          ? partLines(table.node.lattice, node)
          : { top: 0, right: 0, bottom: 0, left: 0 };
      const { insets } = node.style;
      const shift = {
        x: stickyShiftAxis(
          { start: painted.x - lines.left, end: painted.x + node.localRect.width + lines.right },
          block.x,
          { start: view.x0, end: view.x1 },
          inset(insets.left, view.x1 - view.x0),
          inset(insets.right, view.x1 - view.x0),
        ),
        y: stickyShiftAxis(
          { start: painted.y - lines.top, end: painted.y + node.localRect.height + lines.bottom },
          block.y,
          { start: view.y0, end: view.y1 },
          inset(insets.top, view.y1 - view.y0),
          inset(insets.bottom, view.y1 - view.y0),
        ),
      };
      if (shift.x !== 0 || shift.y !== 0) node.stickyShift = shift;
    }
  }
  if (node.inlineElements) applyInlineStickyShifts(node, painted, view);
}

/** A leaf's sticky inline elements, each shifted within the leaf's
 * content box where it paints now, from its fragments' bounds before
 * the shift. */
function applyInlineStickyShifts(
  node: LayoutNode,
  painted: Origin,
  view: ReturnType<typeof clipBounds>,
): void {
  const leaf = {
    x: painted.x + (node.stickyShift?.x ?? 0),
    y: painted.y + (node.stickyShift?.y ?? 0),
  };
  const block = contentBox(node, leaf, null);
  for (const entry of node.inlineElements ?? []) {
    if (entry.sticky === undefined) continue;
    delete entry.stickyShift;
    if (!view) continue;
    const rects = inlineElementRects(node, leaf.x, leaf.y)
      .filter(({ element }) => element === entry.element)
      .map(({ rect }) => rect);
    if (rects.length === 0) continue;
    const bounds = {
      x: {
        start: Math.min(...rects.map((r) => r.x)),
        end: Math.max(...rects.map((r) => r.x + r.width)),
      },
      y: {
        start: Math.min(...rects.map((r) => r.y)),
        end: Math.max(...rects.map((r) => r.y + r.height)),
      },
    };
    const shift = {
      x: stickyShiftAxis(
        bounds.x,
        block.x,
        { start: view.x0, end: view.x1 },
        entry.sticky.left,
        entry.sticky.right,
      ),
      y: stickyShiftAxis(
        bounds.y,
        block.y,
        { start: view.y0, end: view.y1 },
        entry.sticky.top,
        entry.sticky.bottom,
      ),
    };
    if (shift.x !== 0 || shift.y !== 0) entry.stickyShift = shift;
  }
}

/** The lattice line cells on a table part's edges (specs/table.md): the
 * lines above and below its rows, and beside a cell's columns — a row
 * or row group already spans the table's width, lines included. */
function partLines(
  lattice: TableLattice,
  part: LayoutNode,
): { top: number; right: number; bottom: number; left: number } {
  const extent = partExtent(lattice, part);
  if (!extent) return { top: 0, right: 0, bottom: 0, left: 0 };
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

/** A node's content box in painted cells, from the origin its children
 * paint from; a scroll container's extends to what it scrolls. */
function contentBox(
  node: LayoutNode,
  origin: Origin,
  scroller: LayoutNode | null,
): { x: Span; y: Span } {
  const { border } = node.style;
  const padding = node.resolvedPadding;
  const x0 = origin.x + border.left + padding.left;
  const y0 = origin.y + border.top + padding.top;
  let width = node.localRect.width - border.left - border.right - padding.left - padding.right;
  let height = node.localRect.height - border.top - border.bottom - padding.top - padding.bottom;
  if (node === scroller && node.scrollRange) {
    width = Math.max(width, node.scrollRange.sizeX);
    height = Math.max(height, node.scrollRange.sizeY);
  }
  return { x: { start: x0, end: x0 + width }, y: { start: y0, end: y0 + height } };
}
