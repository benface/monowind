/**
 * The top layer (specs/top-layer.md): which light elements are in it
 * and in what order, kept per host from the toggle events it sees and
 * assigned onto each layout's tree as the order the stack paints and
 * hit-tests in.
 */

import type { LayoutNode, TopLayerEntry } from "./types.ts";

/** Whether `el` is in the platform's top layer: an open popover or a
 * modal dialog, the only candidates asked. A headless DOM without the
 * pseudo-classes throws: none there. */
export function isTopLayer(el: Element): boolean {
  if (!el.hasAttribute("popover") && el.localName !== "dialog") return false;
  try {
    return el.matches(":popover-open, :modal");
  } catch {
    return false;
  }
}

/** A host's top-layer stack: its elements in the order they entered
 * the top layer. */
export class TopLayer {
  #rank = new Map<Element, number>();
  #next = 0;

  /** An element's entry, from its toggle; one already ranked keeps its
   * place. */
  enter(el: Element): void {
    if (!this.#rank.has(el)) this.#rank.set(el, this.#next++);
  }

  /** The stack onto a laid-out tree: its top-layer nodes ranked — an
   * element found open without a record enters here, in tree order —
   * and listed on the root in stack order with their ancestors; an
   * element the tree no longer holds leaves. */
  assign(root: LayoutNode): void {
    const seen = new Set<Element>();
    const entries: TopLayerEntry[] = [];
    const chain: LayoutNode[] = [];
    const visit = (node: LayoutNode): void => {
      if (chain.length > 0 && !node.anonymous) {
        if (node.style.topLayer) this.enter(node.source);
        // A stack element paints from its host rect: a fixed box's.
        const rank = node.hostRect ? this.#rank.get(node.source) : undefined;
        if (rank === undefined) delete node.topLayerRank;
        else {
          node.topLayerRank = rank;
          seen.add(node.source);
          entries.push({ node, ancestors: chain.slice() });
        }
      }
      chain.push(node);
      for (const child of node.children) visit(child);
      chain.pop();
    };
    visit(root);
    for (const el of this.#rank.keys()) if (!seen.has(el)) this.#rank.delete(el);
    entries.sort((a, b) => a.node.topLayerRank! - b.node.topLayerRank!);
    if (entries.length > 0) root.topLayer = entries;
    else delete root.topLayer;
  }
}
