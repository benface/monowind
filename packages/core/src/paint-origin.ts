/** Where each box paints for the current scroll offsets (sticky.ts), and
 * under which clips: those of its containing-block chain
 * (specs/positioning.md "Paint order"). */

import { containsAbsolute } from "./layout.ts";
import { clipBounds, intersect } from "./plain-text.ts";
import { scrollportOf, stick, stickInline } from "./sticky.ts";
import type { Scrollport } from "./sticky.ts";
import type { Clip, LayoutNode } from "./types.ts";

/** A box whose light element a scroll shifts (render.ts), with its parent. */
export interface ShiftedBox {
  node: LayoutNode;
  parent: LayoutNode;
}

/** Where a box's children paint from — its content origin, its scroll
 * applied — under which clips and scrollport, with the scroll offsets
 * passed since the chain began, and the table its parts stick in. */
interface Frame {
  x: number;
  y: number;
  clip: Clip | null;
  port: Scrollport | null;
  scrollX: number;
  scrollY: number;
  table: LayoutNode | null;
}

const HOST: Frame = { x: 0, y: 0, clip: null, port: null, scrollX: 0, scrollY: 0, table: null };

/** Every box's `paintOrigin` and `paintClip`, top-down so a box sticks
 * within ancestors already placed: an in-flow box's from its parent's
 * frame, an absolute box's from its containing block's (the nearest
 * positioned ancestor or layer root, else the root), the scroll between
 * the two taken back, and a fixed box's the host's, clipped only by
 * the layer it paints in. Returns the boxes whose light elements a
 * scroll shifts, a top-layer box's aside. */
export function placePainted(root: LayoutNode): ShiftedBox[] {
  const shifted: ShiftedBox[] = [];
  const visit = (
    node: LayoutNode,
    parent: LayoutNode | null,
    frame: Frame,
    block: Frame,
    fixed: Frame,
  ): void => {
    const origin = node.paintOrigin;
    const { position, layer } = node.style;
    const top = node.topLayerRank !== undefined;
    // A top-layer element escapes every layer, its fixed descendants with it.
    if (top) fixed = HOST;
    const hoisted = node.hostRect;
    // The frame the box's chain continues from.
    const from = hoisted ? fixed : position === "absolute" ? block : frame;
    if (hoisted) {
      origin.x = hoisted.x;
      origin.y = hoisted.y;
    } else {
      origin.x = frame.x + node.localRect.x + frame.scrollX - from.scrollX;
      origin.y = frame.y + node.localRect.y + frame.scrollY - from.scrollY;
    }
    node.paintClip = from.clip;
    let port = from.port;
    const sticky = position === "sticky";
    if (sticky && parent) stick(node, parent, port, frame.table);
    // A scroll container holds its own sticky inline elements too.
    if (node.scrollRange) port = scrollportOf(node);
    const inline = node.inlineElements?.some((entry) => entry.sticky !== undefined) ?? false;
    if (inline) stickInline(node, port);
    // An absolute box escapes the scrollers between it and its containing block.
    const escapes = !hoisted && from.port !== frame.port;
    if (parent && (sticky || inline || (hoisted && !top) || escapes)) {
      shifted.push({ node, parent });
    }
    if (node.children.length === 0) return;
    const scrollX = node.scroll?.x ?? 0;
    const scrollY = node.scroll?.y ?? 0;
    const own = clipBounds(node, origin.x, origin.y);
    // A layer root's children start its layer's clips anew.
    const inside = layer ? null : from.clip;
    const children: Frame = {
      x: origin.x - scrollX,
      y: origin.y - scrollY,
      clip: own ? intersect(inside, own) : inside,
      port,
      scrollX: from.scrollX + scrollX,
      scrollY: from.scrollY + scrollY,
      table: node.style.display === "table" ? node : hoisted ? null : frame.table,
    };
    const childBlock = !parent || containsAbsolute(node.style) ? children : block;
    // A fixed box paints from the host, outside every scroller.
    const childFixed = layer ? { ...HOST, clip: children.clip } : fixed;
    for (const child of node.children) visit(child, node, children, childBlock, childFixed);
  };
  visit(root, null, HOST, HOST, HOST);
  return shifted;
}
