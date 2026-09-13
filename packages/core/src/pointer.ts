import { paintOrderedChildren } from "./borders.ts";
import { clipBounds, leafLineCovers } from "./plain-text.ts";
import type { LayoutNode, Rect } from "./types.ts";

/**
 * Cell hit-testing for the synthesized pointer states
 * (specs/cell-model.md "Pointer states"): under select="grid" the
 * light DOM is pointer-events: none, so :hover/:active can never
 * match — the engine derives them from the pointer's cell instead,
 * leaving every event on the grid (selection stays intact).
 */

export interface HitEntry {
  node: LayoutNode;
  /** The node's PAINTED border-box origin, in absolute cells
   * (ancestor scroll offsets applied). */
  x: number;
  y: number;
}

/** A node's hit rect in absolute cells (specs/scrolling.md
 * "Hit-testing follows the ink"): its border box, grown to a text
 * leaf's ink where an unwrapped line runs past it on a visible axis. */
export function hitRect(node: LayoutNode, x: number, y: number): Rect {
  let { width, height } = node.localRect;
  const ink = node.textExtent;
  if (ink) {
    const { border, overflow } = node.style;
    const padding = node.resolvedPadding;
    if (overflow.x === "visible") width = Math.max(width, border.left + padding.left + ink.width);
    if (overflow.y === "visible") height = Math.max(height, border.top + padding.top + ink.rows);
  }
  return { x, y, width, height };
}

/** The nodes under a cell with their painted origins, outermost
 * first: the innermost node whose hit rect covers the cell, plus its
 * ancestors — native :hover marks the whole chain, so the synthesized
 * attribute does too. Overlapping siblings resolve to the TOPMOST in
 * paint order (z-index, document-order ties), matching what the grid
 * shows at that cell; the descent stops where a clipping container's
 * paint does, a fixed box hit from the host's origin past it. The
 * top-layer stack is tried first, from the top (specs/top-layer.md):
 * a hit in it is the element's ancestors, then the element and its
 * own descent. */
export function hitStack(root: LayoutNode, col: number, row: number): HitEntry[] {
  const top = root.topLayer ?? [];
  for (let i = top.length - 1; i >= 0; i--) {
    const { node, ancestors } = top[i]!;
    const { x, y } = node.hostRect!;
    if (!covers(hitRect(node, x, y), col, row)) continue;
    const stack: HitEntry[] = [];
    let ax = root.localRect.x;
    let ay = root.localRect.y;
    for (const ancestor of ancestors.slice(1)) {
      ax += ancestor.localRect.x + (ancestor.stickyShift?.x ?? 0);
      ay += ancestor.localRect.y + (ancestor.stickyShift?.y ?? 0);
      stack.push({ node: ancestor, x: ax, y: ay });
      ax -= ancestor.scroll?.x ?? 0;
      ay -= ancestor.scroll?.y ?? 0;
    }
    stack.push({ node, x, y });
    descend(node, x, y, col, row, stack);
    return stack;
  }
  const stack: HitEntry[] = [];
  descend(root, root.localRect.x, root.localRect.y, col, row, stack);
  return stack;
}

/** The hit entries under `node`, painted at `x`, `y`, onto `stack`:
 * the topmost covering child and its own descent, a fixed child from
 * the host's origin, the stack's elements left to the stack. */
function descend(
  node: LayoutNode,
  x: number,
  y: number,
  col: number,
  row: number,
  stack: HitEntry[],
): void {
  const clip = clipBounds(node, x, y);
  const past =
    clip !== null && (col < clip.x0 || col >= clip.x1 || row < clip.y0 || row >= clip.y1);
  // Children paint (and therefore hit) shifted by the node's scroll
  // offset (specs/scrolling.md).
  const childX = x - (node.scroll?.x ?? 0);
  const childY = y - (node.scroll?.y ?? 0);
  const children = paintOrderedChildren(node);
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]!;
    if (child.tableHidden || child.topLayerRank !== undefined) continue;
    const hoisted = child.hostRect;
    if (past && !hoisted) continue;
    const cx = hoisted ? hoisted.x : childX + child.localRect.x + (child.stickyShift?.x ?? 0);
    const cy = hoisted ? hoisted.y : childY + child.localRect.y + (child.stickyShift?.y ?? 0);
    // A paragraph-flow multicol child shares the container's box with
    // its siblings; its ink is where its line fragments are.
    const inside = child.multicolFlow
      ? leafLineCovers(child, cx, cy, col, row)
      : covers(hitRect(child, cx, cy), col, row);
    if (!inside) continue;
    stack.push({ node: child, x: cx, y: cy });
    descend(child, cx, cy, col, row, stack);
    return;
  }
}

function covers(rect: Rect, col: number, row: number): boolean {
  return col >= rect.x && col < rect.x + rect.width && row >= rect.y && row < rect.y + rect.height;
}

/** Inside an `inert` subtree: absent for user interaction, as natively
 * — no hover, no wheel routing, no thumb drag, no focus, no text
 * selection. */
export function isInert(element: Element): boolean {
  // Optional call: layout tests build nodes on bare stub sources.
  return element.closest?.("[inert]") != null;
}

/** The hit stack's elements — what the synthesized states mark — cut
 * at the first inert one, where native :hover stops too. */
export function hitChain(root: LayoutNode, col: number, row: number): Element[] {
  const chain: Element[] = [];
  for (const entry of hitStack(root, col, row)) {
    if (isInert(entry.node.source)) break;
    // An anonymous run's element is its container, already in the chain.
    if (!entry.node.anonymous) chain.push(entry.node.source);
  }
  return chain;
}

/** The cells a scroller moves toward a pointer past its box
 * (specs/wide-characters.md "auto-scrolls"): the distance past each
 * edge in whole cells, rounded up; zero on an axis the pointer is
 * inside. */
export function scrollStep(
  box: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
  point: { x: number; y: number },
  cell: { width: number; height: number },
): { x: number; y: number } {
  const past = (before: number, after: number, size: number): number =>
    before > 0 ? -Math.ceil(before / size) : after > 0 ? Math.ceil(after / size) : 0;
  return {
    x: past(box.left - point.x, point.x - box.right, cell.width),
    y: past(box.top - point.y, point.y - box.bottom, cell.height),
  };
}

/** The cells to try for the character nearest `(col, row)`, in the
 * order the browser's closest-position rule would (specs/
 * wide-characters.md): the cell itself, then its row leftward — a hit
 * there is the point AFTER that character — and rightward (BEFORE it),
 * then the rows above and below, farther out each step, an upper row
 * from its end and a lower one from its start, all inside a box of
 * `width × height` cells the cell is clamped into. */
export function* nearestCells(
  width: number,
  height: number,
  col: number,
  row: number,
): Generator<{ x: number; y: number; edge: "self" | "start" | "end" }> {
  if (width <= 0 || height <= 0) return;
  const c = Math.max(0, Math.min(col, width - 1));
  const r = Math.max(0, Math.min(row, height - 1));
  yield { x: c, y: r, edge: "self" };
  for (let x = c - 1; x >= 0; x--) yield { x, y: r, edge: "end" };
  for (let x = c + 1; x < width; x++) yield { x, y: r, edge: "start" };
  for (let d = 1; d < height; d++) {
    if (r - d >= 0) for (let x = width - 1; x >= 0; x--) yield { x, y: r - d, edge: "end" };
    if (r + d < height) for (let x = 0; x < width; x++) yield { x, y: r + d, edge: "start" };
  }
}
