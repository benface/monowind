import { paintOrderedChildren } from "./borders.ts";
import type { LayoutNode } from "./types.ts";

/**
 * Cell hit-testing for the synthesized pointer states
 * (specs/cell-model.md "Pointer states"): under select="grid" the
 * light DOM is pointer-events: none, so :hover/:active can never
 * match — the engine derives them from the pointer's cell instead,
 * leaving every event on the grid (selection stays intact).
 */

/** The elements under a cell, outermost first: the innermost node
 * whose border-box covers the cell, plus its ancestors — native
 * :hover marks the whole chain, so the synthesized attribute does
 * too. Overlapping siblings resolve to the TOPMOST in paint order
 * (z-index, document-order ties), matching what the grid shows at
 * that cell. */
export function hitChain(root: LayoutNode, col: number, row: number): Element[] {
  const chain: Element[] = [];
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
    if (!hit) return chain;
    chain.push(hit.source);
    x += hit.localRect.x;
    y += hit.localRect.y;
    node = hit;
  }
}
