/** Where each box paints for the current scroll offsets (sticky.ts). */

import { scrollportOf, stick, stickInline } from "./sticky.ts";
import type { Scrollport } from "./sticky.ts";
import type { LayoutNode } from "./types.ts";

/** A box whose light element a scroll shifts (render.ts), with its parent. */
export interface ShiftedBox {
  node: LayoutNode;
  parent: LayoutNode;
}

/** Every box's `paintOrigin`, top-down so a box sticks within ancestors
 * already placed, a fixed box's the host's; returns the boxes whose
 * light elements a scroll shifts, a top-layer box's aside. */
export function placePainted(root: LayoutNode): ShiftedBox[] {
  const shifted: ShiftedBox[] = [];
  // `x`, `y`: the origin the parent's children paint from.
  const visit = (
    node: LayoutNode,
    parent: LayoutNode | null,
    x: number,
    y: number,
    port: Scrollport | null,
    table: LayoutNode | null,
  ): void => {
    const origin = node.paintOrigin;
    const hoisted = node.hostRect;
    origin.x = hoisted ? hoisted.x : x + node.localRect.x;
    origin.y = hoisted ? hoisted.y : y + node.localRect.y;
    if (hoisted) port = table = null;
    const sticky = node.style.position === "sticky";
    if (sticky && parent) stick(node, parent, port, table);
    // A scroll container holds its own sticky inline elements too.
    if (node.scrollRange) port = scrollportOf(node);
    const inline = node.inlineElements?.some((entry) => entry.sticky !== undefined) ?? false;
    if (inline) stickInline(node, port);
    const fixed = hoisted !== undefined && node.topLayerRank === undefined;
    if (parent && (sticky || inline || fixed)) shifted.push({ node, parent });
    const childX = origin.x - (node.scroll?.x ?? 0);
    const childY = origin.y - (node.scroll?.y ?? 0);
    if (node.style.display === "table") table = node;
    for (const child of node.children) visit(child, node, childX, childY, port, table);
  };
  visit(root, null, 0, 0, null, null);
  return shifted;
}
