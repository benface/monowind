import type { CellSize } from "./gradient.ts";
import { layersAt } from "./paint.ts";
import type { CellHit } from "./paint.ts";
import {
  charIndexAtCell,
  clipBounds,
  inClip,
  inkClip,
  inlineShift,
  leafLineCovers,
  markerCovers,
} from "./plain-text.ts";
import { paintIndex } from "./stacking.ts";
import type { PaintEntry, PaintIndex } from "./stacking.ts";
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
  return { x, y, width: hitWidth(node), height: hitHeight(node) };
}

function hitWidth(node: LayoutNode): number {
  const { width } = node.localRect;
  const ink = node.textExtent;
  if (!ink || node.style.overflow.x !== "visible") return width;
  return Math.max(width, node.style.border.left + node.resolvedPadding.left + ink.width);
}

function hitHeight(node: LayoutNode): number {
  const { height } = node.localRect;
  const ink = node.textExtent;
  if (!ink || node.style.overflow.y !== "visible") return height;
  return Math.max(height, node.style.border.top + node.resolvedPadding.top + ink.rows);
}

/** What is under a cell: the nodes, outermost first — the box painted
 * last there (stacking.ts `paintIndex`), inside its own clips, that
 * takes pointer events, plus its ancestors — and the glyph taking it,
 * whose inline elements the chains take (chainOf; specs/positioning.md
 * "Paint order"). */
export interface Hit {
  stack: LayoutNode[];
  /** The leaf and character taking the cell, where a glyph does. */
  glyph: { node: LayoutNode; index: number } | undefined;
}

/** The hit at a cell. The top-layer stack paints last, so it is tried
 * first. `through` is the root of the layer whose grid the cell is in
 * (cellAtPoint), null for the main grid: a layer's subtree answers in
 * its own grid alone, where its transform draws it (specs/layers.md). */
function hitAt(root: LayoutNode, col: number, row: number, through: LayoutNode | null): Hit {
  return hitOf(root, lastTaking(root, through, col, row));
}

/** The hit of the entry taking a cell. */
function hitOf(root: LayoutNode, { order, index }: Taking): Hit {
  const entry = paintIndex(root).entries[order];
  return {
    stack: stackOf(root, order),
    glyph: entry?.kind === "text" && index >= 0 ? { node: entry.node, index } : undefined,
  };
}

/** An element whose hover can restyle something: it or an ancestor
 * names a hover variant, or it is a group or a peer, whose variants
 * compose from its hover (variants.css). */
const REACTS_TO_HOVER =
  '[class*="hover"], [class*="hover"] *, .group, .peer, [class*="group/"], [class*="peer/"]';

/** The inline elements over a hit's character, outermost first; for
 * the hover chain, those whose hover can restyle something. */
function inlineOf({ glyph }: Hit, hovering: boolean): Element[] {
  const inline: Element[] = [];
  if (!glyph) return inline;
  const elements = glyph.node.inlineElements!;
  for (let at = glyph.node.charInline?.[glyph.index] ?? -1; at >= 0; at = elements[at]!.parent) {
    const { element } = elements[at]!;
    if (!hovering || element.matches(REACTS_TO_HOVER)) inline.unshift(element);
  }
  return inline;
}

/** The entry taking a cell: its place in the paint order, -1 for none,
 * and a glyph's character, -1 for a box. */
interface Taking {
  order: number;
  index: number;
}

const NONE_TAKING: Taking = { order: -1, index: -1 };

/** The last entry that takes the cell on the grid of the layer
 * `through` roots (null the main grid): a nested layer's cells are its
 * own grid's, its span passed whole. */
function lastTaking(
  root: LayoutNode,
  through: LayoutNode | null,
  col: number,
  row: number,
): Taking {
  const index = paintIndex(root);
  const layer = through && sameElement(index, through);
  const span = layer ? index.spans.get(layer) : { start: 0, end: index.entries.length };
  if (!span) return NONE_TAKING;
  for (let i = span.end - 1; i >= span.start; i--) {
    const entry = index.entries[i]!;
    if (entry.layer !== layer) {
      i = index.spans.get(entry.layer!)!.start;
      continue;
    }
    const taken = takes(entry, col, row);
    if (taken !== undefined) return { order: i, index: taken };
  }
  return NONE_TAKING;
}

/** A layer root's node in this layout: itself, or for a layer painted
 * from an earlier layout (a held paint, element.ts), its element's. */
function sameElement(index: PaintIndex, node: LayoutNode): LayoutNode {
  if (index.spans.has(node)) return node;
  for (const candidate of index.spans.keys()) {
    if (candidate.source === node.source) return candidate;
  }
  return node;
}

/** The node painted at `order` and its ancestors below the root,
 * outermost first; none for -1. A layer's are its root's ancestors
 * whatever their boxes there: the layer's box took the point through
 * their clips where it is drawn (paint.ts). */
function stackOf(root: LayoutNode, order: number): LayoutNode[] {
  const { entries, parents } = paintIndex(root);
  const stack: LayoutNode[] = [];
  for (let at = entries[order]?.node; at && at !== root; at = parents.get(at)) stack.unshift(at);
  return stack;
}

/** Whether an entry takes a cell for the hit — undefined where not, a
 * glyph's character index, -1 for a box: a box's ink where it covers
 * the cell, visible and taking pointer events; a leaf's glyph there,
 * its inline element's or its own visibility and pointer events
 * deciding. Either inside its clips (specs/visibility.md: a hidden box
 * passes the cell to what is beneath it). */
function takes(entry: PaintEntry, col: number, row: number): number | undefined {
  const node = entry.node;
  const { x, y } = node.paintOrigin;
  if (entry.kind === "marker") {
    // A marker's cells are its item's (specs/lists.md "Hit").
    const taken =
      node.style.visible &&
      node.style.pointerEvents &&
      inClip(inkClip(node), col, row) &&
      inClip(clipBounds(node, x, y), col, row) &&
      markerCovers(node, col, row);
    return taken ? -1 : undefined;
  }
  if (entry.kind === "box") {
    // A paragraph-flow multicol child shares the container's box with
    // its siblings; its ink is where its line fragments are.
    if (node.multicolFlow ? !leafLineCovers(node, x, y, col, row) : !inHitRect(node, col, row)) {
      return undefined;
    }
    const taken = inClip(inkClip(node), col, row) && node.style.visible && node.style.pointerEvents;
    return taken ? -1 : undefined;
  }
  // A turn's glyphs lie in the leaf's hit rect, moved by its member's shift.
  const shift = entry.member < 0 ? null : inlineShift(node.inlineElements!, entry.member);
  if (!inHitRect(node, col - (shift?.x ?? 0), row - (shift?.y ?? 0))) return undefined;
  if (!inClip(inkClip(node), col, row) || !inClip(clipBounds(node, x, y), col, row)) {
    return undefined;
  }
  const index = charIndexAtCell(node, x, y, col, row, entry.member);
  if (index === null) return undefined;
  const at = node.charInline?.[index] ?? -1;
  const inline = at >= 0 ? node.inlineElements![at] : undefined;
  const { visible, pointerEvents } = inline ?? node.style;
  return visible && pointerEvents ? index : undefined;
}

function inHitRect(node: LayoutNode, col: number, row: number): boolean {
  const { x, y } = node.paintOrigin;
  return col >= x && row >= y && col < x + hitWidth(node) && row < y + hitHeight(node);
}

/** Inside an `inert` subtree: absent for user interaction, as natively
 * — no hover, no wheel routing, no thumb drag, no focus, no text
 * selection. */
export function isInert(element: Element): boolean {
  // Optional call: layout tests build nodes on bare stub sources.
  return element.closest?.("[inert]") != null;
}

/** A cell under the pointer, with the hit there where finding the
 * cell took it. */
export interface PointerHit extends CellHit {
  hit?: Hit;
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
  // The main grid's hit, its place in the paint order.
  let main: Taking | undefined;
  for (const layer of layersAt(layers, x, y)) {
    if (!root) return layer;
    const index = paintIndex(root);
    const count = index.entries.length;
    const end = index.spans.get(sameElement(index, layer.layerRoot))?.end ?? count;
    if (end < count) {
      main ??= lastTaking(root, null, col, row);
      if (main.order >= end) continue;
    }
    const taking = lastTaking(root, layer.layerRoot, layer.col, layer.row);
    if (taking.order >= 0) return { ...layer, hit: hitOf(root, taking) };
  }
  const found = main === undefined ? {} : { hit: hitOf(root!, main) };
  return { col, row, grid, x: 0, y: 0, layerRoot: null, ...found };
}

/** The hit at a pointer's cell, found once. */
function pointerHit(root: LayoutNode, at: PointerHit): Hit {
  return (at.hit ??= hitAt(root, at.col, at.row, at.layerRoot));
}

/** The hit stack at a pointer's cell. */
export const stackAt = (root: LayoutNode, at: PointerHit): LayoutNode[] =>
  pointerHit(root, at).stack;

/** The chain at a pointer's cell (chainOf). */
export const chainAt = (root: LayoutNode, at: PointerHit): Element[] =>
  chainOf(pointerHit(root, at));

/** The chain the hover marks at a pointer's cell: an inline element in
 * it where its classes react to a hover, as a chain change lays the
 * page out (specs/cell-model.md "Pointer states"). */
export const hoverChainAt = (root: LayoutNode, at: PointerHit): Element[] =>
  chainOf(pointerHit(root, at), true);

/** What a point's hit is a function of until the next paint: its
 * main-grid cell and every layer's cell under it, for a pointer's
 * same-cell moves to skip without a hit test. */
export function pointKey(layers: HTMLElement, x: number, y: number, cell: CellSize): unknown[] {
  const key: unknown[] = [Math.floor(x / cell.width), Math.floor(y / cell.height)];
  for (const hit of layersAt(layers, x, y)) key.push(hit.layerRoot, hit.col, hit.row);
  return key;
}

/** A hit's elements — what the synthesized states mark — cut at the
 * first inert one, where native :hover stops too. An anonymous run's
 * element is its container, already in the chain. */
function chainOf(hit: Hit, hovering = false): Element[] {
  const boxes = hit.stack.filter((node) => !node.anonymous).map((node) => node.source);
  const chain = [...boxes, ...inlineOf(hit, hovering)];
  const inert = chain.findIndex(isInert);
  return inert < 0 ? chain : chain.slice(0, inert);
}

export const hitStack = (...args: Parameters<typeof hitAt>): LayoutNode[] => hitAt(...args).stack;

export const hitChain = (...args: Parameters<typeof hitAt>): Element[] => chainOf(hitAt(...args));

export const hitHoverChain = (...args: Parameters<typeof hitAt>): Element[] =>
  chainOf(hitAt(...args), true);

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
