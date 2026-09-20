import type { GlyphBoxes } from "./glyph-box.ts";
import { DEFAULT_CELL } from "./gradient.ts";
import type { CellSize } from "./gradient.ts";
import {
  applyCellPaint,
  isBarePaint,
  layerShows,
  renderGridRows,
  samePaint,
} from "./plain-text.ts";
import type { CellSegment, LayerRows, PaintedLayer, RenderOptions } from "./plain-text.ts";
import { selectionRangeThrough, textOffsetOf, textPositionAt } from "./selection.ts";
import type { LayoutNode, Backdrop } from "./types.ts";

/**
 * Paint the laid-out tree into the shadow's `#grid` (a `<pre>`) and
 * the layers' grids (specs/layers.md): each
 * text line is a cell row, same-paint runs coalesce into spans, and a
 * cluster the font draws off its cell count gets a cell-sized box
 * (specs/wide-characters.md).
 *
 * Node identity is preserved wherever possible (specs/cell-model.md
 * "Selection"): an unchanged paint skips the write entirely, and a row
 * whose STRUCTURE (segment texts and span/bare split) matches the last
 * one only patches span styles in place — no node churn, so live
 * Selections (and an in-flight drag's anchor, which no engine lets us
 * restore) survive animation frames untouched, and a selection paint
 * touches only the rows it changed. A structural change rebuilds that
 * row's nodes: the selection is captured as flat character offsets
 * before the swap and restored after, and while a primary press is
 * down with a selection anchor in the grid the rebuild is HELD for
 * release instead (element.ts) — even restored nodes collapse
 * Chromium's drag.
 */
const lastPaintSignature = new WeakMap<HTMLElement, string>();
interface PaintedRow {
  nodes: (Text | HTMLElement)[];
  segments: CellSegment[];
  /** The newline text node after the row; none after the last. */
  newline: Text | null;
  /** Code units in the row (its cell strings joined). */
  units: number;
}
interface PaintedRows {
  rows: PaintedRow[];
  cells: string[][];
}
const lastPaint = new WeakMap<HTMLElement, PaintedRows>();

/** What the painter asks of the glyph cache. */
export type PaintGlyphs = Pick<GlyphBoxes, "box" | "shift">;

export interface PaintOptions {
  /** Defer structural rebuilds while a primary press is down. */
  holdStructural?: boolean;
  glyphs?: PaintGlyphs;
  selection?: RenderOptions["selection"];
  cell?: RenderOptions["cell"];
  /** Where the layers' nodes go (specs/layers.md): a positioned box
   * at the grid's origin. */
  layers?: HTMLElement;
  /** False leaves every layer's box as placed, for a caller that
   * places them once the light elements settle (`syncLayers`). */
  placeLayers?: boolean;
}

/** True when a Selection boundary (a collapsed press anchor counts —
 * the drag it starts must survive) lies inside the grid. */
function hasSelectionInside(target: HTMLElement): boolean {
  return captureSelection(target, true) !== null;
}

/** Returns false when the paint was HELD: the caller asked to defer
 * structural rebuilds (a primary press is down) and a selection
 * anchor is in the grid — repeat the paint on release. */
export function paintGrid(
  root: LayoutNode,
  target: HTMLElement,
  options: PaintOptions = {},
): boolean {
  const glyphs = options.glyphs;
  const render: RenderOptions = {};
  // A translucent line or block glyph is boxed too: rows are separate
  // spans, and its vertical overshoot — what joins rows at full opacity
  // — would composite twice at the join (specs/cell-model.md "Opacity").
  if (glyphs) {
    render.boxed = (cluster, cells, paint, resampled) => {
      // In a resampled layer a box's clip edge is antialiased at every
      // row, a seam the overshooting glyph covers unboxed.
      const box = glyphs.box(cluster, cells, paint);
      if (box !== null && (!box.past || !resampled)) return true;
      return paint?.opacity !== undefined && isLineGlyph(cluster);
    };
  }
  if (options.selection) render.selection = options.selection;
  if (options.cell) render.cell = options.cell;
  const { segments, cells, layers } = renderGridRows(root, render);
  if (!paintRows(target, segments, cells, options)) return false;
  const size = { width: cells[0]?.length ?? 0, height: cells.length };
  return options.layers ? paintLayers(options.layers, layers, options, size) : true;
}

/** A layer's nodes (specs/layers.md): a positioned box carrying the
 * root's transform and filter, the grid of its cells inside, and — for
 * a layer under a clipping ancestor — a clipping box around it, kept
 * per root element across paints — the grid's node identity survives
 * like the main grid's — with the box's geometry in px of its parent's
 * space, the clip's likewise, and the inverse of its transform, for
 * the pointer. */
interface LayerNodes {
  box: HTMLElement;
  grid: HTMLElement;
  clipNode: HTMLElement | null;
  /** A top-layer element's backdrop box, just beneath its own
   * (specs/top-layer.md). */
  backdrop: HTMLElement | null;
  layer: PaintedLayer;
  parent: LayerNodes | null;
  left: number;
  top: number;
  width: number;
  height: number;
  clip: { left: number; top: number; width: number; height: number } | null;
  inverse: DOMMatrix | null;
  /** The last placement written, to skip an unchanged one. */
  placed: string;
}
/** A container's layers: by root element, and in paint order. */
interface LayerSet {
  nodes: Map<Element, LayerNodes>;
  order: LayerNodes[];
  cell: CellSize;
}
const layerSets = new WeakMap<HTMLElement, LayerSet>();

/** Every layer's box placed again from its root's computed effects,
 * for a transition of one of them (specs/layers.md "Animation is
 * sampled"): the copy alone, the cells as they are. */
export function syncLayers(container: HTMLElement): void {
  const set = layerSets.get(container);
  if (set) for (const nodes of set.order) placeLayer(nodes, set.cell);
}

/** A cell with the grid it is painted in — a layer's, at `x`, `y` of
 * the main grid, or the main grid itself at 0, 0 — in main-grid
 * cells. */
export interface CellHit {
  col: number;
  row: number;
  grid: HTMLElement;
  x: number;
  y: number;
}

/** The cell of a layer under the pointer (specs/layers.md): `x`, `y`
 * in px from the grid's origin, taken through the layers' transforms
 * — the one painted last first — to the cell of the layer's grid it
 * lands on; null over none — a layer's blank cell past its root's
 * border box (a shadow's, an overflowing child's), a cell covered by
 * later ink, and a cell past the layer's clip are see-through. */
export function layerAt(container: HTMLElement, x: number, y: number): CellHit | null {
  const set = layerSets.get(container);
  if (!set) return null;
  for (let i = set.order.length - 1; i >= 0; i--) {
    const nodes = set.order[i]!;
    const local = localPoint(nodes, x, y);
    if (!local || local.x < 0 || local.y < 0 || local.x >= nodes.width || local.y >= nodes.height)
      continue;
    const { layer } = nodes;
    const col = Math.floor(local.x / set.cell.width);
    const row = Math.floor(local.y / set.cell.height);
    if (layer.holes.has(row * layer.width + col)) continue;
    const { box } = layer;
    const inBox =
      col >= box.x - layer.x &&
      col < box.x - layer.x + box.width &&
      row >= box.y - layer.y &&
      row < box.y - layer.y + box.height;
    if (!inBox && (paintedCell(nodes.grid, col, row) ?? " ") === " ") continue;
    return { col: layer.x + col, row: layer.y + row, grid: nodes.grid, x: layer.x, y: layer.y };
  }
  return null;
}

/** The grid of the layer painted last over a cell, in main-grid
 * cells, with its origin; null off every layer. */
export function layerGridAt(
  container: HTMLElement,
  col: number,
  row: number,
): { grid: HTMLElement; x: number; y: number } | null {
  const set = layerSets.get(container);
  if (!set) return null;
  for (let i = set.order.length - 1; i >= 0; i--) {
    const { layer, grid } = set.order[i]!;
    if (
      col >= layer.x &&
      col < layer.x + layer.width &&
      row >= layer.y &&
      row < layer.y + layer.height &&
      layerShows(layer, col, row)
    )
      return { grid, x: layer.x, y: layer.y };
  }
  return null;
}

/** A point of the grid's space in a layer box's own, through its
 * ancestors' transforms then its own; null past the layer's clip. */
function localPoint(nodes: LayerNodes, x: number, y: number): { x: number; y: number } | null {
  const outer = nodes.parent ? localPoint(nodes.parent, x, y) : { x, y };
  if (!outer || !nodes.inverse) return null;
  const { clip } = nodes;
  if (
    clip &&
    (outer.x < clip.left ||
      outer.x >= clip.left + clip.width ||
      outer.y < clip.top ||
      outer.y >= clip.top + clip.height)
  )
    return null;
  const point = nodes.inverse.transformPoint({ x: outer.x - nodes.left, y: outer.y - nodes.top });
  return { x: point.x, y: point.y };
}

/** Every layer's box placed in the container — a nested one in its
 * parent's box — in paint order, its cells painted; a layer painted no
 * more loses its nodes. */
function paintLayers(
  container: HTMLElement,
  layers: LayerRows[],
  options: PaintOptions,
  size: { width: number; height: number },
): boolean {
  let set = layerSets.get(container);
  if (!set) layerSets.set(container, (set = { nodes: new Map(), order: [], cell: DEFAULT_CELL }));
  set.cell = options.cell ?? DEFAULT_CELL;
  set.order = [];
  const last = new Map<HTMLElement, HTMLElement>();
  let held = false;
  for (const { layer, segments } of layers) {
    const source = layer.node.source;
    let nodes = set.nodes.get(source);
    if (!nodes) {
      const box = document.createElement("div");
      box.className = "layer";
      const grid = document.createElement("pre");
      grid.className = "grid";
      grid.setAttribute("aria-hidden", "true");
      box.appendChild(grid);
      nodes = {
        box,
        grid,
        clipNode: null,
        backdrop: null,
        layer,
        parent: null,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        clip: null,
        inverse: null,
        placed: "",
      };
      set.nodes.set(source, nodes);
    }
    nodes.layer = layer;
    nodes.parent = layer.parent ? set.nodes.get(layer.parent.node.source)! : null;
    set.order.push(nodes);
    // A clipping box around a clipped layer, the box moved in or out
    // as the clip comes and goes.
    if (layer.clip && !nodes.clipNode) {
      nodes.clipNode = document.createElement("div");
      nodes.clipNode.className = "clip";
      nodes.clipNode.appendChild(nodes.box);
    } else if (!layer.clip && nodes.clipNode) {
      nodes.clipNode.replaceWith(nodes.box);
      nodes.clipNode = null;
    }
    const outer = nodes.clipNode ?? nodes.box;
    // A backdrop box beneath a top-layer element's, over the whole
    // grid, the box moved in or out as the backdrop comes and goes.
    const backdrop = layer.node.style.backdrop;
    if (backdrop && !nodes.backdrop) {
      nodes.backdrop = document.createElement("div");
      nodes.backdrop.className = "backdrop";
    } else if (!backdrop && nodes.backdrop) {
      nodes.backdrop.remove();
      nodes.backdrop = null;
    }
    // In paint order: after the previous sibling layer's, else first
    // — past a parent box's own grid.
    const parent = nodes.parent?.box ?? container;
    const previous = last.get(parent);
    const first = nodes.parent ? nodes.parent.grid.nextSibling : parent.firstChild;
    let anchor = previous ? previous.nextSibling : first;
    if (nodes.backdrop) {
      if (nodes.backdrop !== anchor) parent.insertBefore(nodes.backdrop, anchor);
      anchor = nodes.backdrop.nextSibling;
    }
    if (outer !== anchor) parent.insertBefore(outer, anchor);
    last.set(parent, outer);
    if (nodes.backdrop && backdrop) placeBackdrop(nodes.backdrop, backdrop, size, set.cell);
    if (options.placeLayers !== false) placeLayer(nodes, set.cell);
    if (!paintRows(nodes.grid, segments, layer.grid, options)) held = true;
  }
  const painted = new Set(set.order);
  for (const [source, nodes] of set.nodes) {
    if (painted.has(nodes)) continue;
    (nodes.clipNode ?? nodes.box).remove();
    nodes.backdrop?.remove();
    set.nodes.delete(source);
  }
  return !held;
}

/** The backdrop box over the grid, in px of the measured cell, with
 * the `::backdrop`'s look as read. */
function placeBackdrop(
  box: HTMLElement,
  backdrop: Backdrop,
  size: { width: number; height: number },
  cell: CellSize,
): void {
  const style = box.style;
  style.width = `${size.width * cell.width}px`;
  style.height = `${size.height * cell.height}px`;
  style.backgroundColor = backdrop.backgroundColor;
  style.backgroundImage = backdrop.backgroundImage;
  style.backdropFilter = backdrop.backdropFilter;
  style.opacity = backdrop.opacity;
}

/** The box at the layer's extent, in px of the measured cell, with
 * the root's effects as the browser computes them now — the origin
 * moved by the extent's offset from the border box, so the box turns
 * about the point the light element does, a translate percentage
 * resolved against the border box — the backdrop filter from the
 * read, and their inverse; the clipping box at the layer's clip, the
 * box inside it. */
function placeLayer(nodes: LayerNodes, cell: CellSize): void {
  const { layer } = nodes;
  const cs = getComputedStyle(layer.node.source);
  const [ox = "0", oy = "0"] = cs.transformOrigin.split(" ");
  const originX = (parseFloat(ox) || 0) + (layer.box.x - layer.x) * cell.width;
  const originY = (parseFloat(oy) || 0) + (layer.box.y - layer.y) * cell.height;
  const [tx = 0, ty = 0] = cs.translate
    .split(" ")
    .map((part, axis) =>
      part.endsWith("%")
        ? (parseFloat(part) / 100) *
          (axis === 0 ? layer.box.width * cell.width : layer.box.height * cell.height)
        : parseFloat(part) || 0,
    );
  const transform = cs.transform || "none";
  const rotate = cs.rotate || "none";
  const scale = cs.scale || "none";
  const filter = cs.filter || "none";
  const { backdropFilter } = layer.node.style.layer!;
  const origin = layer.parent ?? { x: 0, y: 0 };
  nodes.left = (layer.x - origin.x) * cell.width;
  nodes.top = (layer.y - origin.y) * cell.height;
  nodes.width = layer.width * cell.width;
  nodes.height = layer.height * cell.height;
  const { clip } = layer;
  nodes.clip = clip && {
    left: (clip.x0 - origin.x) * cell.width,
    top: (clip.y0 - origin.y) * cell.height,
    width: (clip.x1 - clip.x0) * cell.width,
    height: (clip.y1 - clip.y0) * cell.height,
  };
  const placed = [
    nodes.left,
    nodes.top,
    nodes.width,
    nodes.height,
    nodes.clip && [nodes.clip.left, nodes.clip.top, nodes.clip.width, nodes.clip.height],
    originX,
    originY,
    tx,
    ty,
    transform,
    rotate,
    scale,
    filter,
    backdropFilter,
  ].join("|");
  if (nodes.placed === placed) return;
  nodes.placed = placed;
  const style = nodes.box.style;
  if (nodes.clip && nodes.clipNode) {
    const clipStyle = nodes.clipNode.style;
    clipStyle.left = `${nodes.clip.left}px`;
    clipStyle.top = `${nodes.clip.top}px`;
    clipStyle.width = `${nodes.clip.width}px`;
    clipStyle.height = `${nodes.clip.height}px`;
  }
  style.left = `${nodes.left - (nodes.clip?.left ?? 0)}px`;
  style.top = `${nodes.top - (nodes.clip?.top ?? 0)}px`;
  style.width = `${nodes.width}px`;
  style.height = `${nodes.height}px`;
  style.transformOrigin = `${originX}px ${originY}px`;
  style.translate = cs.translate === "none" ? "none" : `${tx}px ${ty}px`;
  style.rotate = rotate;
  style.scale = scale;
  style.transform = transform;
  style.filter = filter;
  style.backdropFilter = backdropFilter;
  nodes.inverse = inverseOf(originX, originY, tx, ty, rotate, scale, transform);
}

/** The inverse of the box's transform, composed as CSS composes the
 * properties — about the origin: the translate, the rotate (about z;
 * another axis flattens to none, deviation 2), the scale, then the
 * transform list — or null where the platform has no matrices. */
function inverseOf(
  originX: number,
  originY: number,
  tx: number,
  ty: number,
  rotate: string,
  scale: string,
  transform: string,
): DOMMatrix | null {
  if (typeof DOMMatrix !== "function") return null;
  try {
    const turn = rotate.split(" ");
    const axis = turn.slice(0, -1).join(" ");
    const angle = axis === "" || axis === "z" ? parseFloat(turn.at(-1)!) || 0 : 0;
    const [sx = 1, sy = sx] = scale === "none" ? [] : scale.split(" ").map(Number);
    const matrix = new DOMMatrix()
      .translate(originX, originY)
      .translate(tx, ty)
      .rotate(angle)
      .scale(sx, sy)
      .multiply(transform === "none" ? new DOMMatrix() : new DOMMatrix(transform))
      .translate(-originX, -originY);
    const inverse = matrix.inverse();
    // A singular transform (a zero scale) inverts to NaNs.
    return Number.isFinite(inverse.a) ? inverse : null;
  } catch {
    return null;
  }
}

/** The rows into `target`, a `<pre>`: false when held. */
function paintRows(
  target: HTMLElement,
  rows: CellSegment[][],
  cells: string[][],
  options: PaintOptions,
): boolean {
  const glyphs = options.glyphs;
  const signature = signatureOf(rows);
  if (lastPaintSignature.get(target) === signature) return true;

  const previous = lastPaint.get(target);
  const rebuild = new Set<number>();
  if (previous && previous.rows.length === rows.length) {
    for (let y = 0; y < rows.length; y++) {
      if (!rowStructureMatches(target, previous.rows[y]!.nodes, rows[y]!)) rebuild.add(y);
    }
  }
  if (rebuild.size > 0 || !previous || previous.rows.length !== rows.length) {
    if (options.holdStructural && hasSelectionInside(target)) return false;
  }
  lastPaintSignature.set(target, signature);

  if (!previous || previous.rows.length !== rows.length) {
    const fragment = document.createDocumentFragment();
    const painted: PaintedRow[] = [];
    for (let y = 0; y < rows.length; y++) {
      const { nodes, units } = rowNodes(rows[y]!, glyphs, y);
      for (const node of nodes) fragment.appendChild(node);
      const newline = y < rows.length - 1 ? document.createTextNode("\n") : null;
      if (newline) fragment.appendChild(newline);
      painted.push({ nodes, segments: rows[y]!, newline, units });
    }
    lastPaint.set(target, { rows: painted, cells });
    const saved = captureSelection(target, false);
    target.replaceChildren(fragment);
    if (saved) restoreSelection(target, saved);
    return true;
  }

  // Style-only rows: patch the spans whose paint actually changed and
  // leave every node's identity alone. Rebuilt rows swap their nodes
  // in place, between the neighbors' newlines.
  const saved = rebuild.size > 0 ? captureSelection(target, false) : null;
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    const painted = previous.rows[y]!;
    if (rebuild.has(y)) {
      const fresh = rowNodes(row, glyphs, y);
      for (const node of fresh.nodes) target.insertBefore(node, painted.newline);
      for (const node of painted.nodes) node.remove();
      painted.nodes = fresh.nodes;
      painted.segments = row;
      painted.units = fresh.units;
      continue;
    }
    for (let i = 0; i < row.length; i++) {
      const segment = row[i]!;
      if (isBarePaint(segment) || sameSegment(segment, painted.segments[i]!)) continue;
      applySegment(painted.nodes[i]! as HTMLElement, segment, glyphs, y);
    }
    painted.segments = row;
  }
  previous.cells = cells;
  if (saved) restoreSelection(target, saved);
  return true;
}

/** A box-drawing or block-element glyph (U+2500–U+259F). */
function isLineGlyph(cluster: string): boolean {
  const code = cluster.codePointAt(0) ?? 0;
  return code >= 0x2500 && code <= 0x259f;
}

/** A row's nodes: bare text for unpainted runs, a span per painted one. */
function rowNodes(
  row: CellSegment[],
  glyphs: PaintGlyphs | undefined,
  y: number,
): { nodes: (Text | HTMLElement)[]; units: number } {
  const nodes: (Text | HTMLElement)[] = [];
  let units = 0;
  for (const segment of row) {
    units += segment.text.length;
    if (isBarePaint(segment) && !segment.box) {
      nodes.push(document.createTextNode(segment.text));
      continue;
    }
    const span = document.createElement("span");
    applySegment(span, segment, glyphs, y);
    span.textContent = segment.text;
    nodes.push(span);
  }
  return { nodes, units };
}

/** The painted cell strings, for callers walking the grid by cell. */
export function paintedCell(target: HTMLElement, col: number, row: number): string | undefined {
  return lastPaint.get(target)?.cells[row]?.[col];
}

/** A span's paint, and its box when the segment is one: an inline
 * block of exactly its cells, the glyph scaled to fill it and clipped
 * to the row (specs/wide-characters.md). */
function applySegment(
  span: HTMLElement,
  segment: CellSegment,
  glyphs: PaintGlyphs | undefined,
  row: number,
): void {
  span.style.cssText = "";
  delete span.dataset.shade;
  applyCellPaint(segment, span.style);
  if (!segment.box) return;
  const cells = segment.cells ?? 1;
  const box = glyphs?.box(segment.text, cells, segment);
  const style = span.style;
  style.display = "inline-block";
  style.padding = "0";
  style.width = `calc(${cells} * var(--mw-cw, 1ch))`;
  style.height = "var(--mw-ch, 1lh)";
  style.overflow = "hidden";
  style.verticalAlign = "top";
  style.textAlign = "center";
  if (box && box.scale !== 1) style.fontSize = `${Math.round(box.scale * 1000) / 10}%`;
  // A tiling glyph pinned to the row's top by its own line box, the
  // overshoot clipped; a shade's line box also moves the glyph by the
  // row's shift (twice it), and copies a period above and below fill
  // the box (the shadow's `[data-shade]` rules).
  if (box?.lineHeight !== undefined) {
    let lineHeight = box.lineHeight;
    if (box.period && glyphs) {
      span.dataset.shade = segment.text;
      style.setProperty("--mw-period", `${box.period}px`);
      lineHeight += 2 * glyphs.shift(box, row);
    }
    style.lineHeight = `${lineHeight}px`;
  }
}

function sameSegment(a: CellSegment, b: CellSegment): boolean {
  return (
    samePaint(a, b) &&
    a.box === b.box &&
    a.cells === b.cells &&
    a.backgrounds?.join(",") === b.backgrounds?.join(",") &&
    a.colors?.join(",") === b.colors?.join(",")
  );
}

function rowStructureMatches(
  target: HTMLElement,
  previous: (Text | HTMLElement)[],
  row: CellSegment[],
): boolean {
  if (previous.length !== row.length) return false;
  for (let i = 0; i < row.length; i++) {
    const node = previous[i]!;
    const segment = row[i]!;
    const bare = isBarePaint(segment) && !segment.box;
    if (bare !== (node.nodeType === Node.TEXT_NODE)) return false;
    if (node.textContent !== segment.text) return false;
    // A node detached from the grid can't be patched.
    if (node.parentNode !== target) return false;
  }
  return true;
}

/** The grid's flat text offset of a cell (cell-model.md "Selection"):
 * rows are joined by newlines, and a cell's code units are its cluster's
 * — none for a continuation cell. Clamped to the grid. */
export function gridOffsetAt(target: HTMLElement, col: number, row: number): number {
  const painted = lastPaint.get(target);
  if (!painted || painted.rows.length === 0) return 0;
  const y = Math.max(0, Math.min(row, painted.rows.length - 1));
  let offset = 0;
  for (let i = 0; i < y; i++) offset += painted.rows[i]!.units + 1;
  const cells = painted.cells[y]!;
  const x = Math.max(0, Math.min(col, cells.length));
  for (let i = 0; i < x; i++) offset += cells[i]!.length;
  return offset;
}

/* === Selection preservation ========================================== */

interface SavedSelection {
  start: number; // flat character offsets into the grid's textContent
  end: number;
  backward: boolean;
}

/** Anything unexpected degrades to the old behavior (selection lost),
 * never an error. */
function captureSelection(target: HTMLElement, allowCollapsed: boolean): SavedSelection | null {
  try {
    const selection = target.ownerDocument.getSelection();
    if (!selection) return null;
    const shadowRoot = target.getRootNode();
    if (!(shadowRoot instanceof ShadowRoot)) return null;
    const range = selectionRangeThrough(shadowRoot);
    if (!range) return null;
    // Null when a point is outside the grid (the selection reaches past
    // it — restoring only our half would corrupt it).
    const start = textOffsetOf(target, range.startContainer, range.startOffset);
    const end = textOffsetOf(target, range.endContainer, range.endOffset);
    if (start === null || end === null) return null;
    if (start === end && !allowCollapsed) return null;
    // `direction` is unsupported in some engines; forward is the safe
    // default (a restored backward drag then extends from its focus
    // end — visible only if the user keeps dragging).
    const direction = (selection as { direction?: string }).direction;
    return { start, end, backward: direction === "backward" };
  } catch {
    return null;
  }
}

function restoreSelection(target: HTMLElement, saved: SavedSelection): void {
  try {
    const start = textPositionAt(target, saved.start);
    const end = textPositionAt(target, saved.end);
    if (!start || !end) return;
    // Chromium: restore through the shadow root's own selection — the
    // document-level restore leaves a live drag's internal anchor on
    // the detached nodes and the next mousemove collapses it.
    const shadowRoot = target.getRootNode() as { getSelection?: () => Selection | null };
    const selection = shadowRoot.getSelection?.() ?? target.ownerDocument.getSelection();
    if (saved.backward) {
      selection?.setBaseAndExtent(end[0], end[1], start[0], start[1]);
    } else {
      selection?.setBaseAndExtent(start[0], start[1], end[0], end[1]);
    }
  } catch {
    // Leave whatever the browser collapsed the selection to.
  }
}

function signatureOf(rows: CellSegment[][]): string {
  const parts: string[] = [];
  for (const row of rows) {
    for (const s of row) {
      parts.push(
        s.text,
        s.color ?? "",
        s.backgroundColor ?? "",
        s.backgrounds?.join(",") ?? "",
        s.colors?.join(",") ?? "",
        s.fontWeight ?? "",
        s.fontStyle ?? "",
        s.textDecorationLine ?? "",
        s.opacity ?? "",
        s.selected ? "s" : "",
        s.box ? `b${s.cells}` : "",
      );
    }
    parts.push("\n");
  }
  return parts.join("\x1f");
}
