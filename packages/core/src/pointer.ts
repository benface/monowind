import { paintOrderedChildren } from "./borders.ts";
import type { CellSize } from "./gradient.ts";
import { layersAt } from "./paint.ts";
import type { CellHit } from "./paint.ts";
import { charIndexAtCell, clipBounds, leafLineCovers } from "./plain-text.ts";
import type { LayoutNode, Rect } from "./types.ts";

/**
 * Cell hit-testing for the synthesized pointer states
 * (specs/cell-model.md "Pointer states"): under select="grid" the
 * light DOM is pointer-events: none, so :hover/:active can never
 * match — the engine derives them from the pointer's cell instead,
 * leaving every event on the grid (selection stays intact).
 */

/** A node's hit rect in absolute cells (specs/scrolling.md
 * "Hit-testing follows the ink"): its border box where it paints,
 * grown to a text leaf's ink where an unwrapped line runs past it on a
 * visible axis. */
export function hitRect(node: LayoutNode): Rect {
  const { x, y } = node.paintOrigin;
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

/** The nodes under a cell, outermost first: the innermost node whose
 * hit rect covers the cell, plus its ancestors — native :hover marks
 * the whole chain, so the synthesized attribute does too. Overlapping
 * siblings resolve to the TOPMOST in paint order (z-index,
 * document-order ties), matching what the grid shows at that cell; the
 * descent stops where a clipping container's paint does, a fixed box
 * hit past it. The top-layer stack is tried first, from the top
 * (specs/top-layer.md): a hit in it is the element's ancestors, then
 * the element and its own descent. `through` is the root of the layer
 * whose grid the cell is in (cellAtPoint), null for the main grid: a
 * layer's subtree answers in its own grid alone, where its transform
 * draws it (specs/layers.md). */
export function hitStack(
  root: LayoutNode,
  col: number,
  row: number,
  through: LayoutNode | null,
): LayoutNode[] {
  return through ? (layerStack(root, col, row, through) ?? []) : mainStack(root, col, row);
}

function mainStack(root: LayoutNode, col: number, row: number): LayoutNode[] {
  const top = root.topLayer ?? [];
  for (let i = top.length - 1; i >= 0; i--) {
    const { node, ancestors } = top[i]!;
    if (node.forceHidden || node.style.layer) continue;
    if (!covers(hitRect(node), col, row)) continue;
    const stack = [...ancestors.slice(1), node];
    if (descend(node, col, row, stack) || shows(node, col, row)) return stack;
  }
  const stack: LayoutNode[] = [];
  descend(root, col, row, stack);
  return stack;
}

/** The hit through a layer at a cell of its laid-out subtree: its
 * root's ancestors whatever their boxes there — the layer's box took
 * the point through their clips where it is drawn (paint.ts) — then
 * the root and its own descent; null where nothing of the subtree
 * takes the cell. */
function layerStack(
  root: LayoutNode,
  col: number,
  row: number,
  through: LayoutNode,
): LayoutNode[] | null {
  const { places } = indexTree(root);
  const layer = places.has(through) ? through : sameElement(places, through);
  const stack: LayoutNode[] = [];
  let up: LayoutNode | null | undefined = layer;
  while (up && up !== root) {
    stack.unshift(up);
    up = places.get(up)?.parent;
  }
  return descend(layer, col, row, stack) || shows(layer, col, row) ? stack : null;
}

/** The node of this layout for a layer painted from an earlier one (a
 * held paint, element.ts), by its element. */
function sameElement(places: Map<LayoutNode, Placement>, node: LayoutNode): LayoutNode {
  for (const candidate of places.keys()) if (candidate.source === node.source) return candidate;
  return node;
}

/** A node's place in its layout: its parent, and its span in the
 * grid's paint order — its own index, and the index past its subtree. */
interface Placement {
  parent: LayoutNode | null;
  order: number;
  end: number;
}

interface TreeIndex {
  places: Map<LayoutNode, Placement>;
  /** The nodes painted. */
  count: number;
}

const treeIndexes = new WeakMap<LayoutNode, TreeIndex>();

/** Every node's place, in the order the grid walk paints them
 * (plain-text.ts): each box, then its children in paint order, the
 * top-layer stack last. Built once per layout, by its first hit
 * through a layer. */
function indexTree(root: LayoutNode): TreeIndex {
  const known = treeIndexes.get(root);
  if (known) return known;
  const places = new Map<LayoutNode, Placement>();
  let count = 0;
  const visit = (node: LayoutNode, parent: LayoutNode | null): void => {
    const place = { parent, order: count++, end: 0 };
    places.set(node, place);
    for (const child of paintOrderedChildren(node)) {
      if (child.topLayerRank === undefined) visit(child, node);
    }
    place.end = count;
  };
  visit(root, null);
  for (const { node, ancestors } of root.topLayer ?? []) visit(node, ancestors.at(-1) ?? null);
  const index = { places, count };
  treeIndexes.set(root, index);
  return index;
}

/** The nodes under `node` onto `stack`: the topmost covering child
 * and its own descent, a fixed child past the node's clip; whether
 * something that shows took the cell. A hidden box stays on the stack
 * only under what shows of it, else the cell falls to what is beneath
 * it (specs/visibility.md). A layer root's subtree is drawn where its
 * transform puts it, its own hit (layerStack). */
function descend(node: LayoutNode, col: number, row: number, stack: LayoutNode[]): boolean {
  const clip = clipBounds(node, node.paintOrigin.x, node.paintOrigin.y);
  const past =
    clip !== null && (col < clip.x0 || col >= clip.x1 || row < clip.y0 || row >= clip.y1);
  const children = paintOrderedChildren(node);
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]!;
    if (child.tableHidden || child.forceHidden || child.topLayerRank !== undefined) continue;
    if (child.style.layer) continue;
    if (past && !child.hostRect) continue;
    // A paragraph-flow multicol child shares the container's box with
    // its siblings; its ink is where its line fragments are.
    const inside = child.multicolFlow
      ? leafLineCovers(child, child.paintOrigin.x, child.paintOrigin.y, col, row)
      : covers(hitRect(child), col, row);
    if (!inside) continue;
    stack.push(child);
    if (descend(child, col, row, stack) || shows(child, col, row)) return true;
    stack.pop();
  }
  return false;
}

/** Whether a box takes a cell for the hit: a visible one that takes
 * pointer events anywhere in its rect; else a leaf where the character
 * painted is an inline element's that is visible and takes them. A box
 * that takes none is passed through, its descendants still hit
 * (descend). */
function shows(node: LayoutNode, col: number, row: number): boolean {
  if (node.style.visible && node.style.pointerEvents) return true;
  const takes = (entry: { visible: boolean; pointerEvents: boolean }): boolean =>
    entry.visible && entry.pointerEvents;
  if (!node.inlineElements?.some(takes)) return false;
  const index = charIndexAtCell(node, node.paintOrigin.x, node.paintOrigin.y, col, row);
  const entry = index === null ? undefined : node.inlineElements[node.charInline?.[index] ?? -1];
  return entry !== undefined && takes(entry);
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

/** A cell under the pointer, with the hit stack there where finding
 * the cell took it (stackAt). */
export interface PointerHit extends CellHit {
  stack?: LayoutNode[];
}

/** The grid cell under a point `x`, `y` px from the grid's origin, with
 * the grid it is painted in (specs/layers.md): a layer's, through its
 * transform, where one shows there, nothing painted after it covers
 * the point — natively above it, ink or none — and something of its
 * subtree takes the cell; else the main `grid`'s. */
export function cellAtPoint(
  root: LayoutNode | null,
  layers: HTMLElement,
  grid: HTMLElement,
  x: number,
  y: number,
  cell: CellSize,
): PointerHit {
  const col = Math.floor(x / cell.width);
  const row = Math.floor(y / cell.height);
  let main: LayoutNode[] | undefined;
  for (const hit of layersAt(layers, x, y)) {
    if (!root) return hit;
    const { places, count } = indexTree(root);
    const end = places.get(hit.layerRoot)?.end ?? count;
    if (end < count) {
      main ??= mainStack(root, col, row);
      const innermost = main.at(-1);
      if (innermost && (places.get(innermost)?.order ?? -1) >= end) continue;
    }
    const stack = layerStack(root, hit.col, hit.row, hit.layerRoot);
    if (stack) return { ...hit, stack };
  }
  return { col, row, grid, x: 0, y: 0, layerRoot: null, ...(main ? { stack: main } : {}) };
}

/** The hit stack at a pointer's cell, found once. */
export function stackAt(root: LayoutNode, hit: PointerHit): LayoutNode[] {
  return (hit.stack ??= hitStack(root, hit.col, hit.row, hit.layerRoot));
}

/** What a point's hit is a function of until the next paint: its
 * main-grid cell and every layer's cell under it, for a pointer's
 * same-cell moves to skip without a hit test. */
export function pointKey(layers: HTMLElement, x: number, y: number, cell: CellSize): unknown[] {
  const key: unknown[] = [Math.floor(x / cell.width), Math.floor(y / cell.height)];
  for (const hit of layersAt(layers, x, y)) key.push(hit.layerRoot, hit.col, hit.row);
  return key;
}

/** The hit stack's elements — what the synthesized states mark — cut
 * at the first inert one, where native :hover stops too. */
export function chainOf(stack: LayoutNode[]): Element[] {
  const chain: Element[] = [];
  for (const node of stack) {
    if (isInert(node.source)) break;
    // An anonymous run's element is its container, already in the chain.
    if (!node.anonymous) chain.push(node.source);
  }
  return chain;
}

export function hitChain(
  root: LayoutNode,
  col: number,
  row: number,
  through: LayoutNode | null,
): Element[] {
  return chainOf(hitStack(root, col, row, through));
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
