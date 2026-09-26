import type { GlyphBox, GlyphBoxes } from "./glyph-box.ts";
import { DEFAULT_CELL } from "./gradient.ts";
import type { CellSize } from "./gradient.ts";
import {
  applyCellPaint,
  isBarePaint,
  PAINT_FIELDS,
  renderGridRows,
  samePaint,
} from "./plain-text.ts";
import type {
  CellPaint,
  CellSegment,
  LayerRows,
  PaintedLayer,
  RenderOptions,
} from "./plain-text.ts";
import { selectionRangeThrough, textOffsetOf, textPositionAt } from "./selection.ts";
import { readOpacity } from "./style.ts";
import type { LayoutNode, Backdrop } from "./types.ts";

/**
 * Paint the laid-out tree into the shadow's `#grid` (a `<pre>`) and the
 * layers' grids (specs/layers.md): a cell row per line, same-paint runs
 * coalesced into spans, and a box for a cluster the font draws off its
 * cell count (specs/wide-characters.md).
 *
 * Node identity survives where it can (specs/cell-model.md
 * "Selection"), as an in-flight drag's anchor survives nothing else: an
 * unchanged paint writes nothing, a row of the same structure patches
 * its spans' styles in place, and a rebuilt row restores the selection
 * around the swap, or waits for release while a press holds a
 * selection anchor in the grid (element.ts).
 */
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
  /** The glyph cache's generation the boxes were fit under, and whether
   * the cells were drawn resampled, which declines some fits. */
  generation: number;
  resampled: boolean;
}
const lastPaint = new WeakMap<HTMLElement, PaintedRows>();

/** What the painter asks of the glyph cache. */
type PaintGlyphs = Pick<GlyphBoxes, "box" | "shift" | "generation">;

/** The render's options — its fits the glyph cache's (`glyphs`) — and
 * the painter's own. */
interface PaintOptions extends Omit<RenderOptions, "boxed"> {
  /** Defer structural rebuilds while a primary press is down. */
  holdStructural?: boolean;
  glyphs?: PaintGlyphs;
  /** Where the layers' nodes go (specs/layers.md): a positioned box
   * at the grid's origin. */
  layers?: HTMLElement;
  /** False leaves every layer's box as placed, for a caller that
   * places them once the light elements settle (`syncLayers`). */
  placeLayers?: boolean;
}

/** Returns false when the paint was HELD: the caller asked to defer
 * structural rebuilds (a primary press is down) and a selection
 * anchor is in the grid — repeat the paint on release. */
export function paintGrid(
  root: LayoutNode,
  target: HTMLElement,
  options: PaintOptions = {},
): boolean {
  const { glyphs, selection, cell, ground, ink, readColor } = options;
  const render: RenderOptions = { selection, cell, ground, ink, readColor };
  // A line or block glyph drawn translucent, by its color or its span's
  // opacity, is boxed too: rows are separate spans, and its vertical
  // overshoot, what joins rows of an opaque color, would composite
  // twice at the join (specs/cell-model.md "Opacity and translucency").
  if (glyphs) {
    render.boxed = (cluster, cells, paint, resampled, translucent) => {
      const box = fitOf(glyphs, cluster, cells, paint, resampled);
      // A band's run overdraws its joints, twice over in a translucent color.
      if (box !== null) return UNIFORM_BLOCK.test(cluster) && !translucent ? box : true;
      return translucent && isLineGlyph(cluster);
    };
  }
  const { segments, cells, layers } = renderGridRows(root, render);
  if (!paintRows(target, segments, cells, options)) return false;
  const size = { width: cells[0]?.length ?? 0, height: cells.length };
  return options.layers ? paintLayers(options.layers, layers, options, size) : true;
}

/** A layer's nodes, kept per root element across paints
 * (specs/layers.md): a box carrying the root's effects around its grid,
 * a clipping box around that under a clipping ancestor, their geometry
 * in px of the parent's space, and the inverse transform for the pointer. */
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
 * cells, and the layer's root, null on the main grid. */
export interface CellHit {
  col: number;
  row: number;
  grid: HTMLElement;
  x: number;
  y: number;
  layerRoot: LayoutNode | null;
}

/** The cells of the layers under the pointer (specs/layers.md), the
 * one painted last first: `x`, `y` in px from the grid's origin, taken
 * through each layer's transform to the cell of its grid it lands on.
 * A layer's blank cell past its root's border box (a shadow's, an
 * overflowing child's), a cell covered by later ink, and a cell past
 * the layer's clip are see-through. */
export function* layersAt(
  container: HTMLElement,
  x: number,
  y: number,
): Generator<CellHit & { layerRoot: LayoutNode }> {
  const set = layerSets.get(container);
  if (!set) return;
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
    // A hidden root's box is no ink of its own, its visible
    // descendants' fills still are (specs/visibility.md).
    const own =
      inBox &&
      (layer.node.style.visible || layer.paints[row]?.[col]?.backgroundColor !== undefined);
    if (!own && (paintedCell(nodes.grid, col, row) ?? " ") === " ") continue;
    yield {
      col: layer.x + col,
      row: layer.y + row,
      grid: nodes.grid,
      x: layer.x,
      y: layer.y,
      layerRoot: layer.node,
    };
  }
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
  for (const { layer, segments, resampled } of layers) {
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
    if (!paintRows(nodes.grid, segments, layer.grid, options, resampled)) held = true;
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
  const backdropFilter = layer.node.style.visible ? layer.node.style.layer!.backdropFilter : "none";
  // The root's live opacity, times its faded ancestors' (specs/layers.md).
  const opacity = layer.alpha * readOpacity(cs.opacity);
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
    opacity,
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
  style.opacity = opacity < 1 ? String(opacity) : "";
  nodes.inverse = inverseOf(originX, originY, tx, ty, rotate, scale, transform);
}

/** The inverse of the box's transform, composed as CSS composes the
 * properties — about the origin: the translate, the rotate (about z;
 * another axis flattens to none, layers.md deviation 2), the scale,
 * then the transform list — or null where the platform has no
 * matrices. */
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

/** The rows into `target`, a `<pre>`, its cells drawn `resampled` or
 * not: false when held. */
function paintRows(
  target: HTMLElement,
  rows: CellSegment[][],
  cells: string[][],
  options: PaintOptions,
  resampled = false,
): boolean {
  prototypes.clear();
  const glyphs = options.glyphs;
  const generation = glyphs?.generation ?? 0;
  const previous = lastPaint.get(target);
  // A refit (a font loaded, the cell changed, the layer's resampling
  // turned) restyles every box, the rows unchanged or not.
  const refit =
    previous !== undefined &&
    (previous.generation !== generation || previous.resampled !== resampled);
  if (previous && !refit && sameRows(previous.rows, rows)) return true;

  const rebuild = new Set<number>();
  if (previous && previous.rows.length === rows.length) {
    for (let y = 0; y < rows.length; y++) {
      if (!rowStructureMatches(target, previous.rows[y]!.nodes, rows[y]!)) rebuild.add(y);
    }
  }
  // A Selection boundary in the grid holds the rebuild; a collapsed press
  // anchor counts, as the drag it starts must survive.
  if (rebuild.size > 0 || !previous || previous.rows.length !== rows.length) {
    if (options.holdStructural && captureSelection(target, true) !== null) return false;
  }

  if (!previous || previous.rows.length !== rows.length) {
    const fragment = document.createDocumentFragment();
    const painted: PaintedRow[] = [];
    for (let y = 0; y < rows.length; y++) {
      const { nodes, units } = rowNodes(rows[y]!, glyphs, y, resampled);
      for (const node of nodes) fragment.appendChild(node);
      const newline = y < rows.length - 1 ? document.createTextNode("\n") : null;
      if (newline) fragment.appendChild(newline);
      painted.push({ nodes, segments: rows[y]!, newline, units });
    }
    lastPaint.set(target, { rows: painted, cells, generation, resampled });
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
      const fresh = rowNodes(row, glyphs, y, resampled);
      for (const node of fresh.nodes) target.insertBefore(node, painted.newline);
      for (const node of painted.nodes) node.remove();
      painted.nodes = fresh.nodes;
      painted.segments = row;
      painted.units = fresh.units;
      continue;
    }
    for (let i = 0; i < row.length; i++) {
      const segment = row[i]!;
      const last = painted.segments[i]!;
      const stale = refit && segment.box;
      if (!stale && (isTextSegment(segment) || sameSegment(segment, last))) continue;
      const span = painted.nodes[i]! as HTMLElement;
      // A group fading over nothing changes its spans' opacity alone.
      if (!stale && sameSegment({ ...last, opacity: segment.opacity }, segment)) {
        span.style.opacity = segment.opacity === undefined ? "" : String(segment.opacity);
        continue;
      }
      applySegment(span, segment, glyphs, y, boxOf(segment, glyphs, resampled));
    }
    painted.segments = row;
  }
  previous.cells = cells;
  previous.generation = generation;
  previous.resampled = resampled;
  if (saved) restoreSelection(target, saved);
  return true;
}

/** The glyphs a run may share a box with: one horizontal band across
 * the cell (U+2580-U+2588, U+2594), where the ink a fit pushes past a
 * cell's edge is the ink its neighbor draws there anyway
 * (specs/wide-characters.md). A half, a quadrant or a shade would
 * spill into what its neighbor leaves blank, and a stroke's ends
 * overdraw into a dot per joint. */
const UNIFORM_BLOCK = /^[\u2580-\u2588\u2594]$/;

/** A bare, unboxed run is a text node; any other a span to patch. */
function isTextSegment(segment: CellSegment): boolean {
  return isBarePaint(segment) && !segment.box;
}

/** A box-drawing or block-element glyph (U+2500–U+259F). */
function isLineGlyph(cluster: string): boolean {
  const code = cluster.codePointAt(0) ?? 0;
  return code >= 0x2500 && code <= 0x259f;
}

/** Boxes repeat: a page of borders is one span over and over, so it
 * is built once and the rest are clones of it. Keyed by its segment,
 * and a shade's row too; cleared per paint, the fits being the same
 * throughout one. */
const prototypes = new Map<string, HTMLElement>();

/** A row's nodes: bare text for unpainted runs, a span per painted one. */
function rowNodes(
  row: CellSegment[],
  glyphs: PaintGlyphs | undefined,
  y: number,
  resampled: boolean,
): { nodes: (Text | HTMLElement)[]; units: number } {
  const nodes: (Text | HTMLElement)[] = [];
  let units = 0;
  for (const segment of row) {
    units += segment.text.length;
    if (isTextSegment(segment)) {
      nodes.push(document.createTextNode(segment.text));
      continue;
    }
    const box = boxOf(segment, glyphs, resampled);
    // Only a shade's style answers to its row, its lattice shifting with
    // it; every other box is the same on every row, so one prototype
    // serves the page rather than one per row.
    const key = segment.box
      ? box?.period
        ? `${segmentKey(segment)}\x1f${y}`
        : segmentKey(segment)
      : null;
    const prototype = key === null ? undefined : prototypes.get(key);
    let span: HTMLElement;
    if (prototype) {
      span = prototype.cloneNode(true) as HTMLElement;
    } else {
      span = document.createElement("span");
      const holder = segment.emojiOpacity === undefined ? span : document.createElement("span");
      holder.textContent = segment.text;
      if (holder !== span) span.append(holder);
      applySegment(span, segment, glyphs, y, box);
      if (key !== null) prototypes.set(key, span.cloneNode(true) as HTMLElement);
    }
    nodes.push(span);
  }
  return { nodes, units };
}

/** The painted cell strings, for callers walking the grid by cell. */
export function paintedCell(target: HTMLElement, col: number, row: number): string | undefined {
  return lastPaint.get(target)?.cells[row]?.[col];
}

/** The fit a boxed segment wears: a shared box repeats one single-cell
 * cluster (plain-text.ts), so the fit it holds is the first
 * character's. */
function boxOf(
  segment: CellSegment,
  glyphs: PaintGlyphs | undefined,
  resampled: boolean,
): GlyphBox | null {
  const clusterCells = segment.box;
  if (!clusterCells || !glyphs) return null;
  const clusters = (segment.cells ?? 1) / clusterCells;
  const cluster = clusters === 1 ? segment.text : segment.text[0]!;
  return fitOf(glyphs, cluster, clusterCells, segment, resampled);
}

/** The glyph cache's fit for a cluster, but a past-the-row one in a
 * resampled layer: a box's clip edge is antialiased there at every row,
 * a seam the overshooting glyph covers unboxed (specs/wide-characters.md). */
function fitOf(
  glyphs: PaintGlyphs,
  cluster: string,
  cells: number,
  paint: CellPaint | undefined,
  resampled: boolean,
): GlyphBox | null {
  const box = glyphs.box(cluster, cells, paint);
  return box?.past && resampled ? null : box;
}

/** A span's paint, and its box when the segment is one: an inline
 * block of exactly its cells, the glyph scaled to fill it and clipped
 * to the row, a repeated one kept on its cells by the box's own
 * tracking (specs/wide-characters.md). */
function applySegment(
  span: HTMLElement,
  segment: CellSegment,
  glyphs: PaintGlyphs | undefined,
  row: number,
  box: GlyphBox | null,
): void {
  span.style.cssText = "";
  delete span.dataset.shade;
  delete span.dataset.box;
  applyCellPaint(segment, span.style);
  // WebKit draws a color emoji whole at any color alpha above 0, so its
  // groups' opacity goes on its own span, the underline in it to fade too.
  const emoji = span.firstElementChild;
  if (emoji instanceof HTMLElement) {
    span.style.textDecoration = "";
    emoji.style.opacity = String(segment.emojiOpacity);
    emoji.style.textDecoration = segment.textDecorationLine ?? "";
  }
  if (!segment.box) return;
  const cells = segment.cells ?? 1;
  const clusterCells = segment.box;
  const clusters = cells / clusterCells;
  const style = span.style;
  // Through `--mw-cw`, so a box keeps its cells when a root font size
  // changes them and no row's text changed to repaint it.
  style.width = `calc(${cells} * var(--mw-cw, 1ch))`;
  // An indent places the glyph where centering would round it short of
  // the clip's edge (specs/wide-characters.md); a box without a fit centers.
  span.dataset.box = box ? "" : "center";
  if (box) {
    const half = clusters === 1 ? "50%" : `50% / ${clusters}`;
    style.textIndent = `calc(${half} - ${box.advance / 2}px)`;
    // Each cluster on its own cells, where the grid's tracking is the font's.
    if (clusters > 1) {
      style.letterSpacing = `calc(${clusterCells} * var(--mw-cw, 1ch) - ${box.advance}px)`;
    }
  }
  if (box && box.scale !== 1) style.fontSize = `${Math.round(box.scale * 1000) / 10}%`;
  // A tiling glyph pinned to its row by its own line box; a shade drawn
  // by the shadow's `[data-shade]` rules at the row's phase.
  if (box?.lineHeight !== undefined) {
    style.lineHeight = `${box.lineHeight}px`;
    if (box.period && glyphs) {
      span.dataset.shade = segment.text;
      style.setProperty("--mw-period", `${box.period}px`);
      style.setProperty("--mw-phase", `${glyphs.shift(box, row)}px`);
    }
  }
}

function sameSegment(a: CellSegment, b: CellSegment): boolean {
  return samePaint(a, b) && a.box === b.box && a.cells === b.cells;
}

/** A boxed segment's paint as a string, its prototype's key. */
function segmentKey(segment: CellSegment): string {
  let key = `${segment.text}\x1f${segment.cells}`;
  for (const field of PAINT_FIELDS) key += `\x1f${segment[field] ?? ""}`;
  return key;
}

function sameRows(painted: PaintedRow[], rows: CellSegment[][]): boolean {
  return (
    painted.length === rows.length &&
    rows.every((row, y) => {
      const was = painted[y]!.segments;
      return (
        was.length === row.length &&
        row.every((segment, i) => segment.text === was[i]!.text && sameSegment(segment, was[i]!))
      );
    })
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
    if (isTextSegment(segment) !== (node.nodeType === Node.TEXT_NODE)) return false;
    if (node.textContent !== segment.text) return false;
    if ((segment.emojiOpacity !== undefined) !== node.firstChild instanceof HTMLElement) {
      return false;
    }
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
