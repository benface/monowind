import type { GlyphBox, GlyphBoxes } from "./glyph-box.ts";
import { DEFAULT_CELL } from "./gradient.ts";
import type { CellSize } from "./gradient.ts";
import {
  applyCellPaint,
  applyDecoration,
  copyGrids,
  glyphKey,
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
import { rangeOf, selectionRangeThrough, textOffsetOf, textPositionAt } from "./selection.ts";
import type { BoundaryPoints, PointRange } from "./selection.ts";
import { readOpacity } from "./style.ts";
import { boxKey, decorationKey } from "./types.ts";
import type { LayoutNode, Backdrop, ImageSource } from "./types.ts";
import {
  contentCells,
  pictureFit,
  pictureGrid,
  placePicture,
  reducePicture,
  samplePicture,
} from "./image.ts";
import type { Bitmap, Place } from "./image.ts";

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
  return options.layers ? paintLayers(options.layers, target, layers, options, size) : true;
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
  /** An image's canvas (specs/images.md). */
  picture: Picture | null;
}
/** A container's layers: by root box (`boxKey`), and in paint order. */
interface LayerSet {
  nodes: Map<object, LayerNodes>;
  order: LayerNodes[];
  cell: CellSize;
}

const layerSets = new WeakMap<HTMLElement, LayerSet>();

/** A picture's layer key, apart from its image's own layer's. */
const pictureKeys = new WeakMap<object, object>();
function pictureKey(node: LayoutNode): object {
  const box = boxKey(node);
  let key = pictureKeys.get(box);
  if (!key) pictureKeys.set(box, (key = {}));
  return key;
}

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
  main: HTMLElement,
  layers: LayerRows[],
  options: PaintOptions,
  size: { width: number; height: number },
): boolean {
  let set = layerSets.get(container);
  if (!set) {
    set = { nodes: new Map(), order: [], cell: DEFAULT_CELL };
    layerSets.set(container, set);
  }
  set.cell = options.cell ?? DEFAULT_CELL;
  // The grid selection as it stands once a picture's grid is painted, a
  // row rebuilt under it restoring it.
  const spanOf = spansOf(() => {
    const root = container.getRootNode();
    return root instanceof ShadowRoot ? selectionRangeThrough(root) : null;
  });
  set.order = [];
  const last = new Map<HTMLElement, HTMLElement>();
  let held = false;
  for (const { layer, segments, resampled } of layers) {
    const source = layer.picture ? pictureKey(layer.node) : boxKey(layer.node);
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
        picture: null,
      };
      set.nodes.set(source, nodes);
    }
    nodes.layer = layer;
    nodes.parent = layer.parent ? set.nodes.get(boxKey(layer.parent.node))! : null;
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
    // A picture's layer has no cells — its box's are the grid's beneath
    // — so its grid stays empty: a drag over the picture selects the
    // grid's text beneath.
    if (!layer.picture && !paintRows(nodes.grid, segments, layer.grid, options, resampled)) {
      held = true;
    }
    if (layer.picture && layer.node.image) {
      const whole = options.selection?.has(layer.node) ?? false;
      paintPicture(nodes, layer.node.image, set.cell, nodes.parent?.grid ?? main, whole, spanOf);
    }
  }
  const painted = new Set(set.order);
  for (const [source, nodes] of set.nodes) {
    if (painted.has(nodes)) continue;
    nodes.picture?.frames?.stop();
    (nodes.clipNode ?? nodes.box).remove();
    nodes.backdrop?.remove();
    set.nodes.delete(source);
  }
  return !held;
}

/** An image's sampled pixels, by what they were drawn from: a layout
 * that changes none of it samples nothing (specs/images.md "Repaint");
 * null for an image whose pixels its origin keeps from the page. */
const pictures = new WeakMap<
  HTMLImageElement,
  { key: string; pixels: Bitmap | null; place: Place }
>();

/** Whether the engine can read pixels, found once. */
let sampling: boolean | undefined;

/** The source at the picture's scale: halved by the engine while at
 * least four times the place, then read; null where the image is
 * cross-origin and unshared, or a canvas is refused. */
function sourcePixels(
  image: CanvasImageSource,
  natural: { width: number; height: number },
  place: Place,
): Bitmap | null {
  // An engine without a 2D context (a DOM in Node) samples nothing.
  sampling ??=
    typeof OffscreenCanvas !== "undefined" && new OffscreenCanvas(1, 1).getContext("2d") !== null;
  if (!sampling) return null;
  let source = image;
  let { width, height } = natural;
  let canvas: OffscreenCanvas | null = null;
  try {
    while (width >= place.width * 4 && height >= place.height * 4 && width >= 2 && height >= 2) {
      canvas = new OffscreenCanvas(Math.floor(width / 2), Math.floor(height / 2));
      canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
      ({ width, height } = canvas);
      source = canvas;
    }
    if (!canvas) {
      canvas = new OffscreenCanvas(width, height);
      canvas.getContext("2d")!.drawImage(image, 0, 0);
    }
    return { width, height, data: canvas.getContext("2d")!.getImageData(0, 0, width, height).data };
  } catch {
    return null;
  }
}

/** A picture's pixels from its source's: sampled to its grid at its
 * place, reduced. */
function gridPixels(
  source: Bitmap,
  place: Place,
  columns: number,
  rows: number,
  color: ImageSource["color"],
): Bitmap {
  const pixels = samplePicture(source, { width: columns, height: rows * 2 }, place);
  if (color) reducePicture(pixels, color);
  return pixels;
}

/** The picture's pixels and its place in them: sampled, reduced. */
function pictureOf(image: ImageSource, columns: number, rows: number, cell: CellSize) {
  const { element, natural, fit, position, color } = image;
  const key = [
    element.currentSrc,
    image.columns,
    columns,
    rows,
    cell.width,
    cell.height,
    fit,
    position.x,
    position.y,
    JSON.stringify(color),
  ].join("|");
  const cached = pictures.get(element);
  if (cached?.key === key) return cached;
  const width = image.columns * cell.width;
  const own = { width, height: (width * natural.height) / natural.width };
  const box = { width: columns * cell.width, height: rows * cell.height };
  const place = pictureGrid(
    placePicture(own, box, pictureFit(fit, natural, box, cell), position),
    cell,
  );
  const source = sourcePixels(element, natural, place);
  const pixels = source && gridPixels(source, place, columns, rows, color);
  const picture = { key, pixels, place };
  pictures.set(element, picture);
  return picture;
}

/** An image's canvas: the key of what it last drew, whether that was
 * a source the page may not read, the last paint's geometry, which each
 * frame is drawn to, and its frames decoded from its bytes. */
interface Picture {
  canvas: HTMLCanvasElement;
  drawn: string;
  tainted: boolean;
  painted: {
    image: ImageSource;
    /** What its pixels are a function of, its source aside (`pictureOf`). */
    key: string;
    columns: number;
    rows: number;
    place: Place;
    holes: number[];
    /** The grid holding its cells, and its first cell there. */
    grid: HTMLElement;
    col: number;
    row: number;
    /** Selected whole, by a selection in the light DOM. */
    whole: boolean;
    /** Its cells a selection holds, inverted. */
    selected: Run[];
  };
  frames: Frames | null;
}

/** An image's picture on its layer's box: a canvas over the content
 * box, drawn again only when what it shows changes, the cells later
 * ink covers cleared (specs/images.md "Paint"). */
function paintPicture(
  nodes: LayerNodes,
  image: ImageSource,
  cell: CellSize,
  grid: HTMLElement,
  whole: boolean,
  spanOf: SpanOf,
): void {
  const { layer } = nodes;
  const content = contentCells(layer.node);
  const left = layer.box.x - layer.x + content.x;
  const top = layer.box.y - layer.y + content.y;
  const { columns, rows } = content;
  const { element } = image;
  if (columns <= 0 || rows <= 0 || element.naturalWidth === 0) {
    nodes.picture?.frames?.stop();
    nodes.picture?.canvas.remove();
    nodes.picture = null;
    return;
  }
  // A new source loading: the picture shown stays until it loads.
  if (!element.complete) return;
  const holes: number[] = [];
  for (const hole of layer.holes) {
    const x = (hole % layer.width) - left;
    const y = Math.floor(hole / layer.width) - top;
    if (x >= 0 && x < columns && y >= 0 && y < rows) holes.push(y * columns + x);
  }
  const picture = pictureOf(image, columns, rows, cell);
  const painted = {
    image,
    key: picture.key,
    columns,
    rows,
    place: picture.place,
    holes,
    grid,
    col: layer.box.x + content.x - (layer.parent?.x ?? 0),
    row: layer.box.y + content.y - (layer.parent?.y ?? 0),
    whole,
    selected: [] as Run[],
  };
  painted.selected = selectedCells(painted, spanOf);
  if (!nodes.picture) {
    const canvas = document.createElement("canvas");
    canvas.className = "picture";
    canvas.setAttribute("aria-hidden", "true");
    nodes.box.appendChild(canvas);
    nodes.picture = { canvas, drawn: "", tainted: false, painted, frames: null };
  }
  // The cells it shows selected, which a grid selection may have moved.
  const shown = nodes.picture.painted.selected.join(",");
  nodes.picture.painted = painted;
  const { frames } = nodes.picture;
  if (frames?.src !== element.currentSrc) {
    frames?.stop();
    nodes.picture.frames = new Frames(nodes.picture, element.currentSrc, picture.pixels !== null);
  }
  const drawn = [picture.key, left, top, holes.join(",")].join("|");
  if (nodes.picture.drawn === drawn && painted.selected.join(",") === shown) return;
  nodes.picture.drawn = drawn;
  const { canvas } = nodes.picture;
  canvas.width = columns;
  canvas.height = rows * 2;
  Object.assign(canvas.style, {
    left: `${left * cell.width}px`,
    top: `${top * cell.height}px`,
    width: `${columns * cell.width}px`,
    height: `${rows * cell.height}px`,
  });
  redraw(nodes.picture);
}

/** A picture drawn again from what it shows: its frame, else its
 * sampled pixels. */
function redraw(picture: Picture): void {
  if (picture.frames?.draw()) return;
  drawPicture(picture, pictures.get(picture.painted.image.element)?.pixels ?? null);
}

/** A row's selected cells, its columns `from` to `to`. */
type Run = [row: number, from: number, to: number];

/** A picture's cells a selection holds, a run a row: all of them where a
 * light-DOM selection reaches the image, else those whose characters a
 * grid selection spans in the grid holding them. */
function selectedCells(painted: Picture["painted"], spanOf: SpanOf): Run[] {
  const { columns, rows, grid, col, row, whole } = painted;
  if (whole) return Array.from({ length: rows }, (_, y): Run => [y, 0, columns]);
  const span = spanOf(grid);
  if (!span) return [];
  const offset = (x: number, y: number): number => gridOffsetAt(grid, col + x, row + y);
  const runs: Run[] = [];
  for (let y = 0; y < rows; y++) {
    const first = offset(0, y);
    const last = offset(columns - 1, y);
    if (last < span.start || first >= span.end) continue;
    // A row's offsets only rise: its cells in the span are one run.
    let from = 0;
    while (offset(from, y) < span.start) from++;
    let to = from;
    while (to < columns && offset(to, y) < span.end) to++;
    if (to > from) runs.push([y, from, to]);
  }
  return runs;
}

/** The grid selection, its pictures' cells under it inverted
 * (specs/images.md "Paint"): each picture whose cells it changes drawn
 * again, with no layout or other paint, as a drag moves it. */
export function selectPictures(container: HTMLElement, points: BoundaryPoints | null): void {
  const set = layerSets.get(container);
  if (!set) return;
  const spanOf = spansOf(() => points);
  for (const { picture } of set.order) {
    // Selected whole by the light DOM until the next paint.
    if (!picture || picture.painted.whole) continue;
    const selected = selectedCells(picture.painted, spanOf);
    if (selected.join(",") === picture.painted.selected.join(",")) continue;
    picture.painted.selected = selected;
    redraw(picture);
  }
}

/** An image's row of cells at main-grid row `row`, clamped to it, as
 * the points around the text it spans in the grid holding them, as far
 * as its clip shows them; null for an image with no picture shown. */
export function pictureRow(
  container: HTMLElement,
  node: LayoutNode,
  row: number,
): PointRange | null {
  const nodes = layerSets.get(container)?.nodes.get(pictureKey(node));
  const painted = nodes?.picture?.painted;
  if (!painted) return null;
  const { grid, col, columns, rows } = painted;
  const { clip, parent } = nodes.layer;
  // Its first row in main-grid cells, as `row` is.
  const top = painted.row + (parent?.y ?? 0);
  const y = painted.row + Math.max(0, Math.min(rows - 1, row - top));
  // As far as its clip shows it.
  const from = clip ? Math.max(col, clip.x0 - (parent?.x ?? 0)) : col;
  const to = clip ? Math.min(col + columns, clip.x1 - (parent?.x ?? 0)) : col + columns;
  if (to <= from) return null;
  const start = textPositionAt(grid, gridOffsetAt(grid, from, y));
  const end = textPositionAt(grid, gridOffsetAt(grid, to, y));
  if (!start || !end) return null;
  return { start: { node: start[0], offset: start[1] }, end: { node: end[0], offset: end[1] } };
}

/** The text a grid selection copies where it spans a picture's cells:
 * the copy's render between its points, each image's alt in its cells
 * (specs/images.md "The light DOM"); null for one that spans none, the
 * browser's own copy. */
export function gridCopy(
  container: HTMLElement,
  root: LayoutNode,
  points: BoundaryPoints,
): string | null {
  const set = layerSets.get(container);
  const span = set && gridSpan(container, points);
  if (!span) return null;
  const spanOf = spansOf(() => points);
  const spans = set.order.some(
    ({ picture }) => picture && selectedCells(picture.painted, spanOf).length > 0,
  );
  if (!spans) return null;
  const grids = copyGrids(root);
  const layer = set.order.find((nodes) => nodes.grid === span.grid)?.layer.node;
  const cells = layer
    ? grids.layers.find((painted) => painted.node === layer && !painted.picture)?.grid
    : grids.cells;
  if (!cells) return null;
  const start = gridCellAt(span.grid, span.start);
  const end = gridCellAt(span.grid, span.end);
  const rows: string[] = [];
  for (let row = start.row; row <= end.row; row++) {
    const from = row === start.row ? start.col : 0;
    const to = row === end.row ? end.col : undefined;
    rows.push((cells[row] ?? []).slice(from, to).join(""));
  }
  return rows.join("\n");
}

/** The cell a text offset of a painted grid is at, `gridOffsetAt`'s
 * inverse: the row, and the cells before the offset in it. */
function gridCellAt(target: HTMLElement, offset: number): { col: number; row: number } {
  const painted = lastPaint.get(target);
  let rest = offset;
  for (let row = 0; painted && row < painted.rows.length; row++) {
    const units = painted.rows[row]!.units;
    if (rest <= units) {
      const cells = painted.cells[row]!;
      let col = 0;
      while (col < cells.length && rest >= cells[col]!.length && rest > 0)
        rest -= cells[col++]!.length;
      return { col, row };
    }
    rest -= units + 1;
  }
  return { col: 0, row: painted?.rows.length ?? 0 };
}

/** A selection's span in the shadow grid holding both its points; null
 * for one elsewhere, or across two grids. */
function gridSpan(
  container: HTMLElement,
  points: BoundaryPoints,
): (Span & { grid: HTMLElement }) | null {
  const gridOf = (node: Node): HTMLElement | null => {
    const grid = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
      ".grid",
    );
    return grid?.getRootNode() === container.getRootNode() ? grid : null;
  };
  const grid = gridOf(points.startContainer);
  if (!grid || gridOf(points.endContainer) !== grid) return null;
  const span = spanIn(grid, points);
  return span && { grid, ...span };
}

/** A selection's text offsets in a grid. */
type Span = { start: number; end: number };

/** A selection's span in each grid, read once a grid. */
type SpanOf = (grid: HTMLElement) => Span | null;

function spansOf(read: () => BoundaryPoints | null): SpanOf {
  const spans = new Map<HTMLElement, Span | null>();
  return (grid) => {
    let span = spans.get(grid);
    if (span === undefined) {
      const selection = read();
      spans.set(grid, (span = selection && spanIn(grid, selection)));
    }
    return span;
  };
}

/** A selection's text offsets in a grid: from its start, else the
 * grid's, to its end, else past the grid's — a select-all's runs across
 * the viewport's grids; null where it misses the grid. */
function spanIn(grid: HTMLElement, points: BoundaryPoints): Span | null {
  const range = rangeOf(grid.ownerDocument, points);
  if (!range.intersectsNode(grid)) return null;
  // A point outside the grid is before or past it.
  return {
    start: textOffsetOf(grid, range.startContainer, range.startOffset) ?? 0,
    end: textOffsetOf(grid, range.endContainer, range.endOffset) ?? Infinity,
  };
}

/** The picture's pixels on its canvas, the cells later ink covers
 * cleared; with none, the browser scales the image, unreduced. */
function drawPicture(picture: Picture, pixels: Bitmap | null): void {
  if (pixels && picture.tainted) {
    // A canvas a source the page may not read was drawn on stays
    // unreadable to the page: readable pixels take a fresh one.
    const fresh = picture.canvas.cloneNode() as HTMLCanvasElement;
    picture.canvas.replaceWith(fresh);
    picture.canvas = fresh;
    picture.tainted = false;
  }
  const context = picture.canvas.getContext("2d");
  if (!context) return;
  const { image, columns, place, holes } = picture.painted;
  if (pixels) {
    const { data, width, height } = pixels;
    context.putImageData(new ImageData(data, width, height), 0, 0);
  } else {
    context.clearRect(0, 0, picture.canvas.width, picture.canvas.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image.element, place.x, place.y, place.width, place.height);
    picture.tainted = true;
  }
  for (const hole of holes) context.clearRect(hole % columns, Math.floor(hole / columns) * 2, 1, 2);
  if (picture.painted.selected.length > 0) invertCells(picture, context);
}

/** A picture's selected cells in reverse video, as selected text is:
 * white's difference inverts each color, and the picture's own alpha,
 * restored from a copy, keeps a bare pixel bare — drawing alone, so a
 * picture the page may not read inverts too. */
function invertCells(picture: Picture, context: CanvasRenderingContext2D): void {
  const { canvas } = picture;
  const { selected } = picture.painted;
  const copy = new OffscreenCanvas(canvas.width, canvas.height);
  copy.getContext("2d")!.drawImage(canvas, 0, 0);
  context.save();
  context.beginPath();
  for (const [y, from, to] of selected) context.rect(from, y * 2, to - from, 2);
  context.clip();
  context.globalCompositeOperation = "difference";
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(copy, 0, 0);
  context.restore();
}

/** An image's frames decoded from its bytes where the engine can, and
 * the server lets the page read them (specs/images.md "Paint"): an
 * animated image's, each drawn at its own time through a still one's
 * sampling and colors, its loop count kept, the first alone under
 * `prefers-reduced-motion`; a still image's where the page may not read
 * it from its element, a server sharing it over CORS. */
class Frames {
  readonly src: string;
  #picture: Picture;
  /** Whether the page reads the still picture from its element. */
  #readable: boolean;
  #stopped = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  /** The frame showing at its picture's scale, drawn again on a
   * repaint: each decoded frame is closed once read, as one at its
   * natural size may weigh tens of megabytes. */
  #source: Bitmap | null = null;
  /** The natural size the frame showing was read from. */
  #natural = { width: 0, height: 0 };
  /** The frame showing sampled to its picture as last painted. */
  #sampled: { source: Bitmap; key: string; pixels: Bitmap | null } | null = null;
  /** A still read once, and again as its picture grows past it. */
  #still = false;
  #rereading = false;
  /** Whether the picture is on screen, and the loop waiting for it to
   * be: frames are drawn where they show. */
  #observer: IntersectionObserver | null = null;
  #visible = false;
  #reveal: (() => void) | null = null;

  constructor(picture: Picture, src: string, readable: boolean) {
    this.src = src;
    this.#picture = picture;
    this.#readable = readable;
    // A source the page may not fetch, or the engine decode, stays still.
    if (typeof ImageDecoder !== "undefined") this.#run().catch(() => this.stop());
  }

  /** The frame showing drawn to the picture as last painted; false
   * before the first. */
  draw(): boolean {
    const source = this.#source;
    if (!source) return false;
    const { image, key, columns, rows, place } = this.#picture.painted;
    // Sampled once for its inputs: a move's repaint or a selection's
    // redraw reuses it.
    if (this.#sampled?.source !== source || this.#sampled.key !== key) {
      const pixels = gridPixels(source, place, columns, rows, image.color);
      this.#sampled = { source, key, pixels };
    }
    drawPicture(this.#picture, this.#sampled.pixels);
    // Read for a smaller place: read again for this one, drawn meanwhile.
    const coarse =
      source.width < Math.min(this.#natural.width, place.width) ||
      source.height < Math.min(this.#natural.height, place.height);
    if (this.#still && coarse && !this.#rereading) {
      this.#rereading = true;
      this.#run()
        .catch(() => {})
        .finally(() => (this.#rereading = false));
    }
    return true;
  }

  stop(): void {
    this.#stopped.abort();
    clearTimeout(this.#timer);
    this.#observer?.disconnect();
    this.#source = null;
    this.#sampled = null;
  }

  async #run(): Promise<void> {
    const { signal } = this.#stopped;
    const response = await fetch(this.src, { mode: "cors", cache: "force-cache", signal });
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !response.body || !(await ImageDecoder.isTypeSupported(type))) return;
    if (signal.aborted) return;
    // Streamed, so a still image's header alone is read; its bytes kept
    // for the passes after the first where it animates.
    const bytes = response.clone();
    // Firefox reports a decoder's completion rejected by its closing as
    // unhandled, where the others mark it handled.
    const open = (data: ReadableStream<Uint8Array> | ArrayBuffer): ImageDecoder => {
      const opened = new ImageDecoder({ data, type });
      opened.completed.catch(() => {});
      return opened;
    };
    let decoder: ImageDecoder | null = open(response.body);
    // Once: WebKit throws closing a closed decoder.
    const close = (): void => {
      decoder?.close();
      decoder = null;
      signal.removeEventListener("abort", close);
    };
    signal.addEventListener("abort", close);
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    // One frame, however many loops: a still.
    if (!track?.animated || track.frameCount <= 1) {
      void bytes.body?.cancel();
      this.#still = true;
      if (!this.#readable) await this.#show(decoder, 0);
      return close();
    }
    await decoder.completed;
    const data = await bytes.arrayBuffer();
    if (signal.aborted) return;
    const { frameCount } = track;
    this.#observer = new IntersectionObserver((entries) => {
      this.#visible = entries.at(-1)!.isIntersecting;
      if (this.#visible) this.#reveal?.();
    });
    this.#observer.observe(this.#picture.painted.image.element);
    // WebKit counts a loop without end as -1.
    const loops = track.repetitionCount < 0 ? Infinity : track.repetitionCount;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    for (let index = 0, shown = -1, passes = 0, duration = 0; passes <= loops;) {
      if (reduced.matches) index = 0;
      if (index !== shown) {
        if (!this.#visible) await new Promise<void>((resolve) => (this.#reveal = resolve));
        // Firefox breaks a frame decoded again once one of its index
        // closed: a decoder takes each frame once, in order.
        if (index < shown) {
          close();
          decoder = open(data);
        }
        duration = await this.#show(decoder, index);
        if (signal.aborted) return;
        shown = index;
      }
      const still = reduced.matches;
      // Browsers hold a frame of 10 ms or less for 100 ms.
      const delay = duration / 1000;
      await new Promise<void>((resolve) => {
        if (still) reduced.addEventListener("change", () => resolve(), { once: true, signal });
        else this.#timer = setTimeout(resolve, delay > 10 ? delay : 100);
      });
      if (still) continue;
      index = (index + 1) % frameCount;
      if (index === 0) passes++;
    }
    this.#observer.disconnect();
    close();
  }

  /** Frame `index` decoded, read at its picture's scale, closed and
   * drawn; its duration, in µs. */
  async #show(decoder: ImageDecoder, index: number): Promise<number> {
    const { image } = await decoder.decode({ frameIndex: index });
    const { displayWidth: width, displayHeight: height, duration } = image;
    let source: Bitmap | null;
    try {
      source = sourcePixels(image, { width, height }, this.#picture.painted.place);
    } finally {
      image.close();
    }
    if (!this.#stopped.signal.aborted) {
      this.#source = source;
      this.#natural = { width, height };
      this.draw();
    }
    return duration ?? 0;
  }
}

/** Every image's frames of a container stopped, its host leaving the
 * document: the next paint starts each again. */
export function stopFrames(container: HTMLElement): void {
  for (const { picture } of layerSets.get(container)?.order ?? []) {
    if (!picture) continue;
    picture.frames?.stop();
    picture.frames = null;
  }
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
  // A picture takes none of its image's effects: a layer root's own
  // layer carries them, and its opacity is in its alpha.
  const cs = layer.picture
    ? null
    : getComputedStyle(layer.node.source, layer.node.generated?.pseudo);
  const [ox = "0", oy = "0"] = cs?.transformOrigin.split(" ") ?? [];
  const originX = (parseFloat(ox) || 0) + (layer.box.x - layer.x) * cell.width;
  const originY = (parseFloat(oy) || 0) + (layer.box.y - layer.y) * cell.height;
  const translate = cs?.translate || "none";
  const [tx = 0, ty = 0] = translate
    .split(" ")
    .map((part, axis) =>
      part.endsWith("%")
        ? (parseFloat(part) / 100) *
          (axis === 0 ? layer.box.width * cell.width : layer.box.height * cell.height)
        : parseFloat(part) || 0,
    );
  const transform = cs?.transform || "none";
  const rotate = cs?.rotate || "none";
  const scale = cs?.scale || "none";
  const filter = cs?.filter || "none";
  const backdropFilter =
    (cs && layer.node.style.visible && layer.node.style.layer?.backdropFilter) || "none";
  // A root's live opacity, times its faded ancestors' (specs/layers.md).
  const opacity = layer.alpha * (cs ? readOpacity(cs.opacity) : 1);
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
  style.translate = translate === "none" ? "none" : `${tx}px ${ty}px`;
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
    span.style.textDecorationThickness = "";
    emoji.style.cssText = `opacity: ${segment.emojiOpacity}`;
    if (segment.decoration) applyDecoration(segment.decoration, emoji.style);
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
  for (const field of PAINT_FIELDS) {
    const value =
      field === "glyph"
        ? glyphKey(segment.glyph)
        : field === "decoration"
          ? segment.decoration && decorationKey(segment.decoration)
          : segment[field];
    key += `\x1f${value ?? ""}`;
  }
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
