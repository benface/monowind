import { paintOrderedChildren } from "./borders.ts";
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
      if (
        col >= cx &&
        col < cx + child.localRect.width &&
        row >= cy &&
        row < cy + child.localRect.height
      ) {
        hit = child;
      }
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

/** The hit stack's elements — what the synthesized states mark. */
export function hitChain(root: LayoutNode, col: number, row: number): Element[] {
  return hitStack(root, col, row).map((entry) => entry.node.source);
}
