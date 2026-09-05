import { paintOrderedChildren } from "./borders.ts";
import { leafLineCovers } from "./plain-text.ts";
import type { LayoutNode } from "./types.ts";

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

/** The nodes under a cell with their painted origins, outermost
 * first: the innermost node whose border-box covers the cell, plus
 * its ancestors — native :hover marks the whole chain, so the
 * synthesized attribute does too. Overlapping siblings resolve to the
 * TOPMOST in paint order (z-index, document-order ties), matching
 * what the grid shows at that cell. */
export function hitStack(root: LayoutNode, col: number, row: number): HitEntry[] {
  const stack: HitEntry[] = [];
  let node = root;
  let x = root.localRect.x;
  let y = root.localRect.y;
  for (;;) {
    let hit: LayoutNode | null = null;
    for (const child of paintOrderedChildren(node)) {
      if (child.tableHidden) continue;
      const cx = x + child.localRect.x;
      const cy = y + child.localRect.y;
      // A paragraph-flow multicol child shares the container's box with
      // its siblings; its ink is where its line fragments are.
      const inside = child.multicolFlow
        ? leafLineCovers(child, cx, cy, col, row)
        : col >= cx &&
          col < cx + child.localRect.width &&
          row >= cy &&
          row < cy + child.localRect.height;
      if (inside) hit = child;
    }
    if (!hit) return stack;
    stack.push({ node: hit, x: x + hit.localRect.x, y: y + hit.localRect.y });
    // Descend with the hit's scroll applied: its children paint (and
    // therefore hit) shifted by the offset (specs/scrolling.md).
    x += hit.localRect.x - (hit.scroll?.x ?? 0);
    y += hit.localRect.y - (hit.scroll?.y ?? 0);
    node = hit;
  }
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
    chain.push(entry.node.source);
  }
  return chain;
}

/** The cells to try for the character nearest `(col, row)`, in the
 * order the browser's closest-position rule would (specs/
 * wide-characters.md): the cell itself, then its row leftward — a hit
 * there is the point AFTER that character — and rightward (BEFORE it),
 * then the rows above and below, farther out each step, an upper row
 * from its end and a lower one from its start. The cell is clamped to
 * the grid, so a pointer past the host runs to the text's ends. */
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
