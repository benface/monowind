/**
 * Paint order (specs/positioning.md "Paint order", CSS 2.1 Appendix E):
 * each box within its nearest stacking context, in CSS's steps, the
 * in-flow content in its phases. One traversal, whose visitor the
 * paint, the hit index and the lattice each supply.
 */

import type { InlineElement, LayoutNode } from "./types.ts";

/** Whether a box's children are flex or grid items. */
const holdsItems = (node: LayoutNode): boolean =>
  node.style.display === "flex" || node.style.display === "grid";

/** Whether `z-index` applies: a positioned box, or a flex or grid item. */
export function zIndexApplies(node: LayoutNode, parent: LayoutNode): boolean {
  return node.style.position !== "static" || holdsItems(parent);
}

/** The opacity a box's inline ancestors fold into its own, none for a
 * top-layer element (specs/cell-model.md "Opacity and translucency"). */
export function inlineOpacity(node: LayoutNode): number {
  return node.topLayerRank === undefined ? (node.inlineOpacity ?? 1) : 1;
}

/** Whether a box forms a stacking context (the host aside). */
export function formsContext(node: LayoutNode, parent: LayoutNode): boolean {
  const { style } = node;
  if (style.stacking || style.layer || node.topLayerRank !== undefined) return true;
  if (style.position === "fixed" || style.position === "sticky") return true;
  if (style.zIndex !== null && zIndexApplies(node, parent)) return true;
  return style.opacity * inlineOpacity(node) < 1;
}

/** Whether a box paints in its context's positioned step: a member. */
export function inPositionedStep(node: LayoutNode, parent: LayoutNode): boolean {
  return node.style.position !== "static" || formsContext(node, parent);
}

/** Where an in-flow child paints in its context's turn: whole among the
 * floats (specs/float.md), whole among the inline content as an atomic
 * inline box and a flex or grid item do (css-flexbox §5.4, css-grid §9),
 * or as a block; null for a member and for a box out of every walk. */
function phaseOf(child: LayoutNode, parent: LayoutNode): "float" | "atomic" | "block" | null {
  if (skipped(child) || inPositionedStep(child, parent)) return null;
  if (child.inlineBox || holdsItems(parent)) return "atomic";
  return child.style.float !== "none" && parent.style.display === "block" ? "float" : "block";
}

/** A box's children in order-modified document order: a flex or grid
 * container's by their `order`, stably. */
function ordered(node: LayoutNode): LayoutNode[] {
  const { children } = node;
  if (!holdsItems(node) || children.every((child) => child.style.order === 0)) return children;
  return children.slice().sort((a, b) => a.style.order - b.style.order);
}

/** Out of every walk: misparented table content, a box
 * `position-visibility` hides, and a top-layer element, which paints
 * after the tree. */
function skipped(node: LayoutNode): boolean {
  return node.tableHidden === true || node.forceHidden === true || node.topLayerRank !== undefined;
}

/** A context's member: its z where `z-index` applies, 0 elsewhere; an
 * inline element's glyphs where `index` names its entry in `node`, a
 * leaf, -1 for the box itself. */
interface Member {
  node: LayoutNode;
  z: number;
  context: boolean;
  index: number;
}

/** A context's members, stably sorted by z and split at 0. */
interface Members {
  negative: Member[];
  rest: Member[];
}

function sortMembers(found: Member[]): Members {
  // A sort copies the list, which tree order most often leaves sorted.
  if (found.some((member, i) => i > 0 && member.z < found[i - 1]!.z)) {
    found.sort((a, b) => a.z - b.z);
  }
  let split = 0;
  while (split < found.length && found[split]!.z < 0) split++;
  return { negative: found.slice(0, split), rest: split === 0 ? found : found.slice(split) };
}

/** The members of `context`: the boxes in the positioned step reached
 * through in-flow boxes and through positioned boxes that form no
 * context, and their leaves' inline members; null where there are none. */
export function membersOf(context: LayoutNode): Members | null {
  const found = collectMembers(context, null);
  return found && sortMembers(found);
}

function collectMembers(node: LayoutNode, found: Member[] | null): Member[] | null {
  // A leaf's inline members, at its place in tree order.
  if (node.inlineMembers) {
    for (const index of node.inlineMembers) (found ??= []).push(inlineMember(node, index));
  }
  for (const child of ordered(node)) {
    if (skipped(child)) continue;
    const context = formsContext(child, node);
    if (context || child.style.position !== "static") {
      const z = zIndexApplies(child, node) ? (child.style.zIndex ?? 0) : 0;
      (found ??= []).push({ node: child, z, context, index: -1 });
      if (context) continue;
    }
    found = collectMembers(child, found);
  }
  return found;
}

function inlineMember(leaf: LayoutNode, index: number): Member {
  const entry = leaf.inlineElements![index]!;
  return { node: leaf, z: entry.zIndex ?? 0, context: entry.context, index };
}

/** The entries of a leaf's run in the positioned step whose nearest
 * ancestor entry forming a context is `context`, -1 for none: those a
 * leaf's context orders, or one inline context's own. */
export function inlineMembersOf(entries: InlineElement[], context: number): number[] {
  const members: number[] = [];
  entries.forEach((entry, index) => {
    if (!entry.positioned && !entry.context) return;
    let at = entry.parent;
    while (at >= 0 && !entries[at]!.context) at = entries[at]!.parent;
    if (at === context) members.push(index);
  });
  return members;
}

/** Each entry's member: itself or its nearest ancestor in the
 * positioned step, whose turn paints its glyphs; -1 for the leaf's own
 * turn. */
export function inlineOwners(entries: InlineElement[]): number[] {
  return entries.map((entry, index) => {
    for (let at = index; at >= 0; at = entries[at]!.parent) {
      if (entries[at]!.positioned || entries[at]!.context) return at;
    }
    return -1;
  });
}

/** A leaf's glyph turns in paint order: each inline member's entry, -1
 * for its own glyphs. */
export function glyphTurns(leaf: LayoutNode): number[] {
  const turns: number[] = [];
  if (!leaf.inlineMembers) turns.push(-1);
  else glyphTurn(leaf, -1, true, { text: (_, member) => turns.push(member) });
  return turns;
}

/** What a traversal hands its consumer, each box in paint order; a
 * consumer takes what it reads. */
export interface PaintVisitor {
  /** A turn opens: the box paints whole until its `leave` — the root, a
   * member, a float, an atomic inline box or a flex or grid item. */
  enter?(node: LayoutNode): void;
  leave?(node: LayoutNode): void;
  /** A box's own ink: its shadows, fill, borders and rules. */
  box?(node: LayoutNode): void;
  /** A collapsed table's lattice, over its parts' fills. */
  lattice?(node: LayoutNode): void;
  /** A leaf's glyphs of one turn: the inline member's at `member` of its
   * run, with its descendants no member of their own holds, -1 the
   * leaf's own (`glyphTurns`). */
  text?(leaf: LayoutNode, member: number): void;
  /** A list item's marker (specs/lists.md "Paint order"): its item's
   * first inline content, before the text of the node holding it. */
  marker?(node: LayoutNode): void;
  /** An image's picture (specs/images.md): a replaced element's content,
   * in its content's turn, after every block's ink (CSS 2.1 Appendix
   * E). */
  picture?(node: LayoutNode): void;
  /** A native region's contents (specs/native-regions.md "Paint"), in
   * the same turn: the browser draws them as one step. */
  native?(node: LayoutNode): void;
  /** A box's scrollbars, over its content. */
  bars?(node: LayoutNode): void;
}

/** The tree in paint order, then the top-layer stack. */
export function paintOrder(root: LayoutNode, visitor: PaintVisitor): void {
  paintTurn(root, true, visitor);
  for (const { node } of root.topLayer ?? []) {
    if (!node.forceHidden && !node.tableHidden) paintTurn(node, true, visitor);
  }
}

/** One paint of a box in the index: its ink, its marker, or a leaf's
 * glyphs, an inline member's where `member` names its entry (-1 for the
 * rest). */
export interface PaintEntry {
  node: LayoutNode;
  kind: "box" | "marker" | "text";
  member: number;
  /** The layer root it paints in, null on the main grid. */
  layer: LayoutNode | null;
}

/** A layout's paint order, for the hit (pointer.ts). */
export interface PaintIndex {
  entries: PaintEntry[];
  /** Each layer root's entries, `[start, end)`: its subtree's. */
  spans: Map<LayoutNode, { start: number; end: number }>;
  /** Each box's layout parent. */
  parents: Map<LayoutNode, LayoutNode>;
}

const indexes = new WeakMap<LayoutNode, PaintIndex>();

/** The layout's paint index, built once, by its first hit. */
export function paintIndex(root: LayoutNode): PaintIndex {
  const known = indexes.get(root);
  if (known) return known;
  const index: PaintIndex = { entries: [], spans: new Map(), parents: new Map() };
  const { entries, spans, parents } = index;
  const layers: LayoutNode[] = [];
  const add = (node: LayoutNode, kind: PaintEntry["kind"], member = -1): void => {
    entries.push({ node, kind, member, layer: layers.at(-1) ?? null });
  };
  paintOrder(root, {
    enter(node) {
      if (!node.style.layer) return;
      layers.push(node);
      spans.set(node, { start: entries.length, end: entries.length });
    },
    leave(node) {
      if (!node.style.layer) return;
      layers.pop();
      spans.get(node)!.end = entries.length;
    },
    box: (node) => add(node, "box"),
    // A region's contents take its cells in their turn, over the blocks'
    // ink before them.
    native: (node) => add(node, "box"),
    text: (leaf, member) => add(leaf, "text", member),
    marker: (node) => add(node, "marker"),
  });
  const visit = (node: LayoutNode): void => {
    for (const child of node.children) {
      parents.set(child, node);
      visit(child);
    }
  };
  visit(root);
  indexes.set(root, index);
  return index;
}

/** One box's turn: its ink, then, as a stacking context, its negative
 * members, its in-flow boxes' ink, its floats, its in-flow text and
 * atomic boxes, and its other members. A box that forms no context
 * paints the same without members, its own positioned descendants
 * being its context's. */
export function paintTurn(node: LayoutNode, context: boolean, visitor: PaintVisitor): void {
  visitor.enter?.(node);
  visitor.box?.(node);
  const members = context ? membersOf(node) : null;
  if (members) for (const member of members.negative) memberTurn(member, visitor);
  if (boxesOf(node, visitor)) floatsOf(node, visitor);
  contentOf(node, visitor);
  if (members) for (const member of members.rest) memberTurn(member, visitor);
  visitor.leave?.(node);
}

function memberTurn(member: Member, visitor: PaintVisitor): void {
  if (member.index < 0) paintTurn(member.node, member.context, visitor);
  else glyphTurn(member.node, member.index, member.context, visitor);
}

/** An inline member's glyphs, the leaf's own at `index` -1, with the
 * inline members it orders around them where it forms a context. */
function glyphTurn(leaf: LayoutNode, index: number, context: boolean, visitor: PaintVisitor): void {
  const inner = context ? inlineMembersOf(leaf.inlineElements!, index) : null;
  const members = inner && sortMembers(inner.map((at) => inlineMember(leaf, at)));
  if (members) for (const member of members.negative) memberTurn(member, visitor);
  visitor.text?.(leaf, index);
  if (members) for (const member of members.rest) memberTurn(member, visitor);
}

/** The in-flow boxes' ink in tree order, then the node's lattice over
 * it; whether a float was passed. */
function boxesOf(node: LayoutNode, visitor: PaintVisitor): boolean {
  let floated = false;
  for (const child of ordered(node)) {
    const phase = phaseOf(child, node);
    if (phase === "float") floated = true;
    else if (phase === "block") {
      visitor.box?.(child);
      floated = boxesOf(child, visitor) || floated;
    }
  }
  if (node.lattice) visitor.lattice?.(node);
  return floated;
}

function floatsOf(node: LayoutNode, visitor: PaintVisitor): void {
  for (const child of ordered(node)) {
    const phase = phaseOf(child, node);
    if (phase === "float") paintTurn(child, false, visitor);
    else if (phase === "block") floatsOf(child, visitor);
  }
}

function contentOf(node: LayoutNode, visitor: PaintVisitor): void {
  if (node.image) visitor.picture?.(node);
  if (node.native) visitor.native?.(node);
  if (node.marker) visitor.marker?.(node);
  if (node.text !== "") visitor.text?.(node, -1);
  for (const child of ordered(node)) {
    const phase = phaseOf(child, node);
    if (phase === "atomic") paintTurn(child, false, visitor);
    else if (phase === "block") contentOf(child, visitor);
  }
  visitor.bars?.(node);
}
