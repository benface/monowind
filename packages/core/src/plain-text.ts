import { collectBorderRuns, collectShadowRuns, paintOrderedChildren } from "./borders.ts";
import { resolveLattice } from "./lattice.ts";
import type { BorderRun } from "./borders.ts";
import { compositeColors, parseColor, serializeColor } from "./color.ts";
import type { Rgba } from "./color.ts";
import { DEFAULT_CELL, gradientCells } from "./gradient.ts";
import type { CellSize } from "./gradient.ts";
import { leafLineGeometry } from "./layout.ts";
import { glyphSetFor, scrollGlyphs } from "./glyphs.ts";
import { advanceOf, INLINE_PAD, lineAdvance, OBJECT_REPLACEMENT } from "./wrap.ts";
import type { LineSpan } from "./wrap.ts";
import { zeroInsets } from "./types.ts";
import type { Insets, LayoutNode, Rect } from "./types.ts";
import { clusterWidth } from "./width.ts";

/**
 * Render a laid-out tree as plain text ("ASCII art", though the border
 * glyphs are Unicode box drawing): leaf text word-wrapped inside its
 * content box, everything else as spaces.
 *
 * This is the engine's "screenshot without a browser": deterministic,
 * font-independent, and diffable — used for golden regression tests and as
 * a debugging/agent-inspection tool. It intentionally renders geometry the
 * way the browser would paint it (same border-run and word-wrap code), minus
 * colors and fonts.
 *
 * The grid covers the layout's ink extent (layoutRoot grows the root
 * to it); ink above or left of the origin has no cells and is dropped.
 * A wide cluster (specs/wide-characters.md) sits in its first cell with
 * empty continuation cells after it, so a joined row reads at the
 * width a terminal shows it.
 */
export function renderPlainText(root: LayoutNode): string {
  const { store, layers } = renderGrids(root, {});
  compositeLayers(store, layers);
  return store.grid.map((row) => row.join("").trimEnd()).join("\n");
}

/** Per-cell paint; every field optional so spans only carry what
 * differs from the host's inherited text style. `color` paints the
 * glyph, `backgroundColor` fills the cell (the light DOM's own bg is
 * neutralized in styles.css so the grid owns backgrounds outright). */
export interface CellPaint {
  color?: string;
  /** `string | undefined` (not just optional): a bg-clear fill merges
   * an EXPLICIT undefined over the cell to erase the bg beneath. */
  backgroundColor?: string | undefined;
  /** The cell's background (`fill`) or glyph color (`text`) is a
   * gradient's color for the cell (specs/gradients.md): such cells
   * join into one run. A later fill merges an EXPLICIT undefined over
   * the cell to clear it. */
  gradient?: "fill" | "text" | undefined;
  /** A background, or a glyph color, per cell of a run of gradient
   * cells: one span, its cells' colors as hard stops of a background
   * (shown through the glyphs for `colors`), in place of a span per
   * cell. */
  backgrounds?: string[];
  colors?: string[];
  fontWeight?: string;
  fontStyle?: string;
  textDecorationLine?: string;
  /** Effective opacity (ancestor product, baked by the walk) as a CSS
   * value — the span composites against the page, so translucency
   * blends with what's behind the HOST, never with covered cells.
   * `"0"` still paints: the glyphs stay selectable in grid mode. */
  opacity?: string;
  /** The cell is inside a light-DOM selection (specs/wide-characters.md
   * "The grid paints the selection"): painted with its color and
   * background swapped. */
  selected?: true;
}

/** One row of same-paint runs. Joining every segment's text gives the
 * row at the grid's full width (specs/cell-model.md "Selection"): the
 * <pre> is a rectangle of cells, so a drag's highlight sweeps whole
 * rows and a copy is the visible rectangle. A boxed segment is one
 * cluster the font does not draw at its cell count, to be painted in a
 * box of exactly `cells` cells. */
export interface CellSegment extends CellPaint {
  text: string;
  cells?: number;
  box?: true;
}

/** What the DOM adapter knows and the plain-text model does not: which
 * clusters its font draws off their cell count (`boxed`), and which
 * leaves hold the light-DOM selection, as character ranges. */
export interface RenderOptions {
  boxed?: (cluster: string, cells: number, paint: CellPaint | undefined) => boolean;
  selection?: Map<LayoutNode, { start: number; end: number }>;
  /** The cell in px, for paint that measures — a gradient's geometry
   * (specs/gradients.md); a 1:2 cell without. */
  cell?: CellSize;
}

/** Row-major cell segments. Each row is `rowSegments(grid[y],
 * paints[y])` — the DOM adapter (paint.ts) uses this, and tests
 * assert paint fields against it. */
export function renderCellSegments(root: LayoutNode, options: RenderOptions = {}): CellSegment[][] {
  return renderGridRows(root, options).segments;
}

/** A layer (specs/layers.md): a layer root's subtree painted into a
 * grid of its own — its cells' extent, the root's border box grown by
 * what overflows it, at `x`, `y` of the main grid — in the order the
 * walk opened it, `parent` the layer it opened inside. */
export interface PaintedLayer {
  node: LayoutNode;
  /** The root's border box, in main-grid cells. */
  box: Rect;
  x: number;
  y: number;
  width: number;
  height: number;
  grid: string[][];
  paints: (CellPaint | undefined)[][];
  /** The cells the ink painted after the layer covers, as `row × width
   * + col`: blank in the grid, see-through for the pointer. */
  holes: Set<number>;
  /** The clips between the layer's root and the enclosing layer's (the
   * grid's edge at the top), intersected, in main-grid cells, for the
   * box the browser clips the transformed layer to; null unclipped.
   * The clips above are the enclosing layer's. */
  clip: Clip | null;
  parent: PaintedLayer | null;
}

/** A layer's rows of segments, with the layer they were built from. */
export interface LayerRows {
  layer: PaintedLayer;
  segments: CellSegment[][];
}

/** The segments plus the cell strings they were built from — the cell ↔
 * code-unit map a row needs once a cluster spans cells or code units —
 * and the layers' likewise, each apart from the main grid. */
export function renderGridRows(
  root: LayoutNode,
  options: RenderOptions = {},
): { segments: CellSegment[][]; cells: string[][]; layers: LayerRows[] } {
  const { store, layers } = renderGrids(root, options);
  const segmentsOf = (grid: string[][], paints: (CellPaint | undefined)[][]) =>
    grid.map((row, y) => rowSegments(row, paints[y]!, options.boxed));
  return {
    segments: segmentsOf(store.grid, store.paints),
    cells: store.grid,
    layers: layers.map((layer) => ({ layer, segments: segmentsOf(layer.grid, layer.paints) })),
  };
}

/** One rendered row → its same-paint runs. Painted spaces stay in
 * their run (underline spans an inline run's inner spaces; a
 * borderless focus-invert fill is nothing but spaces). A continuation
 * cell (`""`) rides with the wide cluster before it; a cluster the
 * caller boxes closes its own segment. */
function rowSegments(
  row: string[],
  paints: (CellPaint | undefined)[],
  boxed?: RenderOptions["boxed"],
): CellSegment[] {
  const segments: CellSegment[] = [];
  let lastCells = 0;
  for (let x = 0; x < row.length; x++) {
    const cell = row[x]!;
    if (cell === "") continue;
    const paint = paints[x];
    let cells = 1;
    while (row[x + cells] === "") cells++;
    if (boxed && (cell.length > 1 || cell.charCodeAt(0) >= 0x80) && boxed(cell, cells, paint)) {
      segments.push({ text: cell, cells, box: true, ...paint });
      lastCells = 0;
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && !last.box && samePaint(last, paint)) {
      last.text += cell;
      lastCells += cells;
    } else if (
      last &&
      !last.box &&
      paint &&
      (last.backgrounds || last.backgroundColor !== undefined) &&
      joinsGradientRun(last, paint, "backgroundColor")
    ) {
      // Gradient cells apart only in background join as one run of them.
      last.backgrounds ??= Array.from({ length: lastCells }, () => last.backgroundColor!);
      delete last.backgroundColor;
      last.text += cell;
      lastCells += cells;
      for (let k = 0; k < cells; k++) last.backgrounds.push(paint.backgroundColor!);
    } else if (
      last &&
      !last.box &&
      paint &&
      paint.backgroundColor === undefined &&
      (last.colors || last.color !== undefined) &&
      joinsGradientRun(last, paint, "color")
    ) {
      // Gradient-colored glyphs apart only in color, likewise — with no
      // background of their own: the run's text clip would clip it
      // away, and Firefox draws no per-layer clip.
      last.colors ??= Array.from({ length: lastCells }, () => last.color!);
      delete last.color;
      last.text += cell;
      lastCells += cells;
      for (let k = 0; k < cells; k++) last.colors.push(paint.color!);
    } else {
      segments.push({ text: cell, ...paint });
      lastCells = cells;
    }
  }
  return segments;
}

/** Whether a gradient cell joins the run before it: both painted by
 * a gradient in `field` (the background of a fill, the glyph color of
 * a text clip), unselected (a selected cell swaps its colors, so it
 * stays a run of its own), alike in everything but that field. */
function joinsGradientRun(
  run: CellSegment,
  paint: CellPaint,
  field: "backgroundColor" | "color",
): boolean {
  const kind = field === "color" ? "text" : "fill";
  const other = field === "color" ? "backgroundColor" : "color";
  return (
    run.gradient === kind &&
    paint.gradient === kind &&
    paint[field] !== undefined &&
    run.selected === undefined &&
    paint.selected === undefined &&
    run[other] === paint[other] &&
    run.fontWeight === paint.fontWeight &&
    run.fontStyle === paint.fontStyle &&
    run.textDecorationLine === paint.textDecorationLine &&
    run.opacity === paint.opacity
  );
}

export function samePaint(a: CellPaint, b: CellPaint | undefined): boolean {
  return (
    a.color === b?.color &&
    a.backgroundColor === b?.backgroundColor &&
    a.gradient === b?.gradient &&
    a.backgrounds === b?.backgrounds &&
    a.colors === b?.colors &&
    a.fontWeight === b?.fontWeight &&
    a.fontStyle === b?.fontStyle &&
    a.textDecorationLine === b?.textDecorationLine &&
    a.opacity === b?.opacity &&
    a.selected === b?.selected
  );
}

/** Apply a `CellPaint` to a `CSSStyleDeclaration`. Kept in this file
 * alongside samePaint / textPaint so the paint schema has one home. A
 * selected cell swaps its colors — the theme's, for an unstyled cell. */
export function applyCellPaint(paint: CellPaint, style: CSSStyleDeclaration): void {
  if (paint.selected) {
    style.color = paint.backgroundColor ?? "var(--mw-bg, canvas)";
    style.backgroundColor = paint.color ?? "var(--mw-fg, canvastext)";
  } else {
    if (paint.color !== undefined) style.color = paint.color;
    if (paint.backgroundColor !== undefined) style.backgroundColor = paint.backgroundColor;
    if (paint.backgrounds) {
      style.backgroundImage = `linear-gradient(to right, ${cellStops(paint.backgrounds)})`;
    }
    if (paint.colors) {
      style.backgroundImage = `linear-gradient(to right, ${cellStops(paint.colors)})`;
      style.webkitBackgroundClip = "text";
      style.backgroundClip = "text";
      style.color = "transparent";
    }
  }
  if (paint.fontWeight !== undefined) style.fontWeight = paint.fontWeight;
  if (paint.fontStyle !== undefined) style.fontStyle = paint.fontStyle;
  if (paint.textDecorationLine !== undefined) style.textDecoration = paint.textDecorationLine;
  if (paint.opacity !== undefined) style.opacity = paint.opacity;
}

/** The glyph paint of a box clipped to `text` (specs/gradients.md):
 * a glyph's own color composited over the background's color at its
 * cell — the gradient through `text-transparent`, an opaque color
 * as it is — for a color the parser reads; any other stays. */
function glyphTint(
  colors: (string | null)[][],
  boxX: number,
  boxY: number,
): (paint: CellPaint | undefined, x: number, y: number) => CellPaint | undefined {
  const parsed = new Map<string, Rgba | null>();
  return (paint, x, y) => {
    const under = colors[y - boxY]?.[x - boxX];
    if (under === null || under === undefined || paint?.color === undefined) return paint;
    let own = parsed.get(paint.color);
    if (own === undefined) parsed.set(paint.color, (own = parseColor(paint.color)));
    if (own === null || own.a >= 1) return paint;
    const ground = parseColor(under);
    if (!ground) return paint;
    return { ...paint, color: serializeColor(compositeColors(own, ground)), gradient: "text" };
  };
}

/** The cells a box's padding box or content box sits inside from its
 * border box, per side. */
function paddingBoxInset(node: LayoutNode, clip: "padding-box" | "content-box"): Insets {
  const { border } = node.style;
  if (clip === "padding-box") return border;
  const padding = node.resolvedPadding;
  return {
    top: border.top + padding.top,
    right: border.right + padding.right,
    bottom: border.bottom + padding.bottom,
    left: border.left + padding.left,
  };
}

/** A run's colors as hard stops in the grid's cell width, each from
 * the stop before it (a start of 0 floors to it) to its last cell. */
function cellStops(colors: string[]): string {
  const stops: string[] = [];
  for (let i = 0; i < colors.length; i++) {
    const color = colors[i]!;
    if (colors[i + 1] === color) continue;
    stops.push(`${color} 0 calc(var(--mw-cw, 1ch) * ${i + 1})`);
  }
  return stops.join(", ");
}

/** True when a segment carries no paint — the DOM adapter emits a bare
 * text node for these instead of an empty <span>. */
export function isBarePaint(paint: CellPaint): boolean {
  return (
    paint.color === undefined &&
    paint.backgroundColor === undefined &&
    paint.backgrounds === undefined &&
    paint.colors === undefined &&
    paint.fontWeight === undefined &&
    paint.fontStyle === undefined &&
    paint.textDecorationLine === undefined &&
    paint.opacity === undefined &&
    paint.selected === undefined
  );
}

/** A grid of cells and the put that paints it: a glyph at a cell, a
 * cluster over `cells` cells, culled at the edges. The wide cluster
 * owning each cell is kept so a later paint on any of its cells
 * blanks the rest — a half-overwritten wide character is spaces, as
 * in a terminal. `clear` blanks a cell outright, its paint with it.
 * A put covers the closed layers' cells it lands on (`covers`). */
interface CellStore {
  grid: string[][];
  paints: (CellPaint | undefined)[][];
  put: PutGlyph;
  clear: (x: number, y: number) => void;
}

function cellStore(width: number, height: number, covers?: Covers): CellStore {
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => " "),
  );
  const paints: (CellPaint | undefined)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, (): CellPaint | undefined => undefined),
  );
  const owners: ({ x: number; cells: number } | undefined)[][] = Array.from(
    { length: height },
    () => Array.from({ length: width }, () => undefined),
  );
  const inside = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;
  const release = (x: number, y: number) => {
    const owner = owners[y]![x];
    if (!owner) return;
    for (let dx = 0; dx < owner.cells; dx++) {
      grid[y]![owner.x + dx] = " ";
      owners[y]![owner.x + dx] = undefined;
    }
  };
  const mergePaint = (x: number, y: number, paint: CellPaint | undefined) => {
    // A put owns its cell's text fields and keeps the fill beneath: a
    // glyph paints its color on the box's background, and a heading
    // stuck over an italic run paints upright.
    const existing = paints[y]![x];
    paints[y]![x] = existing
      ? {
          backgroundColor: existing.backgroundColor,
          gradient: existing.gradient === "fill" ? "fill" : undefined,
          ...paint,
        }
      : paint;
  };
  const clear = (x: number, y: number): void => {
    if (!inside(x, y)) return;
    release(x, y);
    grid[y]![x] = " ";
    paints[y]![x] = undefined;
  };
  const put: PutGlyph = (x, y, glyph, paint, cells = 1) => {
    if (y < 0 || y >= height) return;
    if (covers) coverCells(covers, x, y, cells);
    if (cells === 1) {
      if (!inside(x, y)) return;
      release(x, y);
      grid[y]![x] = glyph;
      mergePaint(x, y, paint);
      return;
    }
    // A cluster losing cells past the grid's edge is blanked whole.
    const whole = inside(x, y) && inside(x + cells - 1, y);
    for (let dx = 0; dx < cells; dx++) {
      if (!inside(x + dx, y)) continue;
      release(x + dx, y);
      grid[y]![x + dx] = whole ? (dx === 0 ? glyph : "") : " ";
      if (whole) owners[y]![x + dx] = { x, cells };
      mergePaint(x + dx, y, paint);
    }
  };
  return { grid, paints, put, clear };
}

/** A closed layer's extent, for the ink painted after it in the same
 * grid (specs/layers.md): a put on one of its cells covers the
 * layer's cell there, as a later box covers what it overlaps. */
interface Cover {
  x0: number;
  x1: number;
  cover: (x: number, y: number) => void;
}

/** The covers of a grid, by row, so a put checks the few on its own. */
type Covers = Map<number, Cover[]>;

function addCover(covers: Covers, extent: Clip, cover: Cover["cover"]): void {
  for (let y = extent.y0; y < extent.y1; y++) {
    let row = covers.get(y);
    if (!row) covers.set(y, (row = []));
    row.push({ x0: extent.x0, x1: extent.x1, cover });
  }
}

function coverCells(covers: Covers, x: number, y: number, cells: number): void {
  const row = covers.get(y);
  if (!row) return;
  for (const { x0, x1, cover } of row) {
    if (x >= x1 || x + cells <= x0) continue;
    for (let dx = Math.max(x, x0); dx < Math.min(x + cells, x1); dx++) cover(dx, y);
  }
}

/** What the walk carries besides its node: the layers opened so far,
 * in order, the one it is inside, the layers closed in the grid it
 * paints into, and the main grid's size — a layer's extent stays
 * within it. */
interface Walk {
  options: RenderOptions;
  layers: PaintedLayer[];
  layer: PaintedLayer | null;
  covers: Covers;
  width: number;
  height: number;
  /** The grid's own put, unclipped: a fixed box paints through it past
   * its ancestors' clips. */
  put: PutGlyph;
}

function renderGrids(
  root: LayoutNode,
  options: RenderOptions,
): { store: CellStore; layers: PaintedLayer[] } {
  const width = Math.max(0, root.localRect.width);
  const height = Math.max(0, root.localRect.height);
  const covers: Covers = new Map();
  const store = cellStore(width, height, covers);
  const walking: Walk = { options, layers: [], layer: null, covers, width, height, put: store.put };
  walk(root, 0, 0, walking, walking.put);
  // The stack after the tree (specs/top-layer.md), each element with
  // its own opacity alone: the top layer escapes its ancestors'.
  for (const { node } of root.topLayer ?? []) {
    walk(node, 0, 0, walking, walking.put, node.style.opacity);
  }
  return { store, layers: walking.layers };
}

/** The layers back onto the main grid at their layout positions, in
 * order — every cell a layer painted (a glyph, or a background under a
 * space) over the main cell — so the transcript sees one grid
 * (specs/layers.md). */
function compositeLayers(store: CellStore, layers: PaintedLayer[]): void {
  for (const layer of layers) {
    for (let dy = 0; dy < layer.height; dy++) {
      const row = layer.grid[dy]!;
      for (let dx = 0; dx < layer.width; dx++) {
        const glyph = row[dx]!;
        if (glyph === "" || !layerShows(layer, layer.x + dx, layer.y + dy)) continue;
        const paint = layer.paints[dy]![dx];
        if (glyph === " " && paint?.backgroundColor === undefined && !paint?.backgrounds) continue;
        let cells = 1;
        while (row[dx + cells] === "") cells++;
        store.put(layer.x + dx, layer.y + dy, glyph, paint, cells);
      }
    }
  }
}

/** The cells the ancestors' overflow leaves visible (specs/scrolling.md):
 * their clips intersected; null where nothing clips. */
export type Clip = { x0: number; y0: number; x1: number; y1: number };

export const inClip = (clip: Clip | null, x: number, y: number): boolean =>
  clip === null || (x >= clip.x0 && x < clip.x1 && y >= clip.y0 && y < clip.y1);

/** Whether a main-grid cell of a layer lies inside its clip and every
 * enclosing layer's. */
export function layerShows(layer: PaintedLayer, x: number, y: number): boolean {
  for (let at: PaintedLayer | null = layer; at; at = at.parent) {
    if (!inClip(at.clip, x, y)) return false;
  }
  return true;
}

const intersect = (a: Clip | null, b: Clip): Clip =>
  a === null
    ? b
    : {
        x0: Math.max(a.x0, b.x0),
        y0: Math.max(a.y0, b.y0),
        x1: Math.min(a.x1, b.x1),
        y1: Math.min(a.y1, b.y1),
      };

/** A layer opened at `node` (specs/layers.md): its put records every
 * cell of the subtree within the grid — the root's own decorations
 * included, the ancestors' clips left to the layer's box — and grows
 * the extent from the border box, and `close` lays the cells out in a
 * grid of the extent and hands the layer to the enclosing grid's
 * covers, so the ink painted after it covers its cells — a nested
 * layer's through its parent's. */
function openLayer(
  walking: Walk,
  node: LayoutNode,
  box: Rect,
  clip: Clip | null,
): { put: PutGlyph; close: () => void; layer: PaintedLayer; covers: Covers } {
  const layer: PaintedLayer = {
    node,
    box,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    grid: [],
    paints: [],
    holes: new Set(),
    clip: clip && intersect(clip, { x0: 0, y0: 0, x1: walking.width, y1: walking.height }),
    parent: walking.layer,
  };
  walking.layers.push(layer);
  const covers: Covers = new Map();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x: number, y: number, width: number, height: number): boolean => {
    const ax = Math.max(0, x);
    const bx = Math.min(walking.width, x + width);
    const ay = Math.max(0, y);
    const by = Math.min(walking.height, y + height);
    if (ax >= bx || ay >= by) return false;
    x0 = Math.min(x0, ax);
    y0 = Math.min(y0, ay);
    x1 = Math.max(x1, bx);
    y1 = Math.max(y1, by);
    return true;
  };
  grow(box.x, box.y, box.width, box.height);
  const puts: Parameters<PutGlyph>[] = [];
  const put: PutGlyph = (x, y, glyph, paint, cells = 1) => {
    coverCells(covers, x, y, cells);
    if (grow(x, y, cells, 1)) puts.push([x, y, glyph, paint, cells]);
  };
  const close = (): void => {
    if (x0 === Infinity) return;
    // Wholly past its clip (scrolled out of view), a layer shows
    // nothing: its cells stay unlaid.
    const { clip: shown } = layer;
    if (shown && (x1 <= shown.x0 || x0 >= shown.x1 || y1 <= shown.y0 || y0 >= shown.y1)) return;
    const width = x1 - x0;
    const { grid, paints, put, clear } = cellStore(width, y1 - y0);
    for (const [x, y, glyph, paint, cells] of puts) put(x - x0, y - y0, glyph, paint, cells);
    Object.assign(layer, { x: x0, y: y0, width, height: y1 - y0, grid, paints });
    addCover(walking.covers, { x0, y0, x1, y1 }, (x, y) => {
      clear(x - x0, y - y0);
      layer.holes.add((y - y0) * width + (x - x0));
      coverCells(covers, x, y, 1);
    });
  };
  return { put, close, layer, covers };
}

/** A put culled by `clipped`: a cluster cut by the clip edge is
 * blanked, its visible cells as spaces. */
function clipPut(put: PutGlyph, clipped: (x: number, y: number) => boolean): PutGlyph {
  return (x, y, glyph, paint, cells = 1) => {
    if (cells === 1) {
      if (!clipped(x, y)) put(x, y, glyph, paint);
      return;
    }
    let whole = true;
    for (let dx = 0; dx < cells; dx++) if (clipped(x + dx, y)) whole = false;
    if (whole) put(x, y, glyph, paint, cells);
    else for (let dx = 0; dx < cells; dx++) if (!clipped(x + dx, y)) put(x + dx, y, " ", paint);
  };
}

/** Non-default text styling only, so unstyled runs stay bare.
 * `backgroundColor` rides along for INLINE elements (a leaf's own bg
 * paints via the border-box fill instead), and `background` false
 * leaves it out: a leaf's glyphs over its gradient keep the fill's
 * colors. */
function textPaint(
  source: {
    color: string | undefined;
    backgroundColor?: string | undefined;
    fontWeight: string;
    fontStyle: string;
    textDecorationLine: string;
  },
  background = true,
): CellPaint {
  const paint: CellPaint = {};
  if (source.color) paint.color = source.color;
  if (background && source.backgroundColor) paint.backgroundColor = source.backgroundColor;
  if (source.fontWeight !== "400" && source.fontWeight !== "normal" && source.fontWeight !== "")
    paint.fontWeight = source.fontWeight;
  if (source.fontStyle !== "normal" && source.fontStyle !== "") paint.fontStyle = source.fontStyle;
  if (source.textDecorationLine !== "none" && source.textDecorationLine !== "")
    paint.textDecorationLine = source.textDecorationLine;
  return paint;
}

/** Paint `glyph` at a cell — a cluster over `cells` cells from it. */
type PutGlyph = (
  x: number,
  y: number,
  glyph: string,
  paint: CellPaint | undefined,
  cells?: number,
) => void;

function walk(
  node: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
  parentWalk: Walk,
  parentPut: PutGlyph,
  alpha = 1,
  parentClip: Clip | null = null,
): void {
  if (node.tableHidden) return;
  // A fixed box, a top-layer element's included, paints from the host's
  // origin, outside its ancestors' scroll and clips
  // (specs/positioning.md, specs/top-layer.md).
  const hoisted = node.hostRect;
  const absX = hoisted ? hoisted.x : parentAbsX + node.localRect.x + (node.stickyShift?.x ?? 0);
  const absY = hoisted ? hoisted.y : parentAbsY + node.localRect.y + (node.stickyShift?.y ?? 0);
  const style = node.style;
  const { options } = parentWalk;
  // A layer root's own paint and its subtree's go to a grid of the
  // layer's own (specs/layers.md), the main grid untouched beneath;
  // the ancestors' clips go to the layer's box, so the subtree starts
  // unclipped.
  const box = { x: absX, y: absY, width: node.localRect.width, height: node.localRect.height };
  const opened = style.layer ? openLayer(parentWalk, node, box, parentClip) : null;
  const put = opened ? opened.put : hoisted ? parentWalk.put : parentPut;
  const clip = opened || hoisted ? null : parentClip;
  const walking = opened
    ? { ...parentWalk, layer: opened.layer, covers: opened.covers, put: opened.put }
    : parentWalk;
  // Effective opacity (specs/cell-model.md "Opacity"): ancestors
  // multiply (CSS nests, it doesn't inherit) and the value rides on
  // every paint this node produces — including an opacity of 0, whose
  // glyphs must stay in the grid for select="grid" selection.
  const alphaPaint = (paint: CellPaint | undefined): CellPaint | undefined =>
    alpha >= 1 ? paint : { ...paint, opacity: String(Math.round(alpha * 1000) / 1000) };

  // Shadows (specs/box-shadow.md): the outer ones before the box's own
  // fill, behind it and over what painted before; the inset ones after
  // the fill, over its background and under its borders and text.
  const paintShadows = (inset: boolean): void => {
    const runs: BorderRun[] = [];
    collectShadowRuns(style, box, inset, runs);
    for (const run of runs) {
      put(
        run.x,
        run.y,
        run.glyph,
        alphaPaint(run.color === undefined ? undefined : { color: run.color }),
      );
    }
  };
  paintShadows(false);

  // Fill the border-box with painted spaces so this element's bg
  // wipes ancestor decoration glyphs at these cells; own borders /
  // text / decoration paint after and layer on top. `bg-clear` wipes
  // first, with an EXPLICIT undefined so the merge in put() strips the
  // cell's painted background too — the wipe covers ancestor
  // backgrounds, not just their glyphs. Gradient layers then fill a
  // color per cell, composited over the plain color, inside the box
  // `background-clip` names, a cell they leave clear as it was; clipped
  // to `text`, the colors go to the glyphs instead (`tint`, below), the
  // plain color with them.
  const layers = style.backgroundImage;
  const textClip = style.backgroundClip === "text";
  const cellSize = options.cell ?? DEFAULT_CELL;
  const fill = (paint: CellPaint | undefined): void => {
    const own: CellPaint = { gradient: undefined, ...paint };
    for (let dy = 0; dy < node.localRect.height; dy++) {
      for (let dx = 0; dx < node.localRect.width; dx++) put(absX + dx, absY + dy, " ", own);
    }
  };
  if (style.backgroundClear) fill({ backgroundColor: undefined });
  let tint: ReturnType<typeof glyphTint> | null = null;
  if (textClip && (layers.length > 0 || style.backgroundColor !== undefined)) {
    const { width, height } = node.localRect;
    tint = glyphTint(
      gradientCells(layers, style.backgroundColor, width, height, cellSize),
      absX,
      absY,
    );
  } else if (layers.length > 0) {
    const { width, height } = node.localRect;
    const colors = gradientCells(layers, style.backgroundColor, width, height, cellSize);
    const clip = style.backgroundClip;
    const inset =
      clip === "padding-box" || clip === "content-box" ? paddingBoxInset(node, clip) : zeroInsets();
    for (let dy = inset.top; dy < height - inset.bottom; dy++) {
      for (let dx = inset.left; dx < width - inset.right; dx++) {
        const color = colors[dy]![dx];
        if (color)
          put(absX + dx, absY + dy, " ", alphaPaint({ backgroundColor: color, gradient: "fill" }));
      }
    }
  } else if (style.backgroundColor !== undefined) {
    fill(alphaPaint({ backgroundColor: style.backgroundColor }));
  }
  paintShadows(true);

  const borderRuns: BorderRun[] = [];
  collectBorderRuns(
    style,
    { x: absX, y: absY, width: node.localRect.width, height: node.localRect.height },
    borderRuns,
  );
  for (const run of borderRuns) {
    const paint = alphaPaint(run.color === undefined ? undefined : { color: run.color });
    for (let i = 0; i < run.length; i++) put(run.x + i, run.y, run.glyph, paint);
  }
  if (node.decorationRuns) {
    for (const run of node.decorationRuns) {
      const paint = alphaPaint(run.color === undefined ? undefined : { color: run.color });
      for (let i = 0; i < run.length; i++) put(absX + run.x + i, absY + run.y, run.glyph, paint);
    }
  }
  // A collapsed table's lattice, resolved for its parts' sticky shifts
  // (lattice.ts): a shifted part is handed its cells to paint in its
  // turn, over what it slid onto; the table paints its own after its
  // rows and cells, over their backgrounds, as CSS layers collapsed
  // borders.
  const lattice = node.lattice
    ? resolveLattice(node, node.lattice, (x, y) => inClip(clip, absX + x, absY + y))
    : null;
  if (node.lattice && lattice) {
    for (const part of node.lattice.handed ?? []) delete part.latticeRuns;
    node.lattice.handed = [...lattice.parts.keys()];
    for (const [part, own] of lattice.parts) {
      part.latticeRuns = own.map((run) => ({ ...run, x: absX + run.x, y: absY + run.y }));
    }
  }
  if (node.latticeRuns) {
    for (const run of node.latticeRuns) {
      put(
        run.x,
        run.y,
        run.glyph,
        alphaPaint(run.color === undefined ? undefined : { color: run.color }),
      );
    }
  }

  // Overflow (specs/scrolling.md): a clipping/scrolling axis culls the
  // node's CONTENT ink (text and children — own decorations paint
  // unclipped) at the PADDING box, per CSS: padding cells sit blank at
  // the scroll extremes but content flows through them mid-scroll. A
  // reserved gutter cell stays excluded (the bar owns it). Nested
  // containers compose: the wrapped put chains to the parent's.
  const scrolledX = absX - (node.scroll?.x ?? 0);
  const scrolledY = absY - (node.scroll?.y ?? 0);
  let contentPut = put;
  let contentClip = clip;
  const own = clipBounds(node, absX, absY);
  if (own) {
    contentClip = intersect(clip, own);
    contentPut = clipPut(put, (x, y) => !inClip(own, x, y));
  }

  const hasInFlowChildren = node.children.some(
    (child) =>
      !child.inlineBox && child.style.position !== "absolute" && child.style.position !== "fixed",
  );
  if (!hasInFlowChildren && node.text) {
    // The plain color rides along only where it filled the box.
    const leafPaint = alphaPaint(textPaint(style, layers.length === 0 && !tint));
    const inlinePaints = node.inlineElements?.map((entry) => alphaPaint(textPaint(entry)));
    const selection = options.selection?.get(node);
    type Entry = NonNullable<LayoutNode["inlineElements"]>[number];
    const paintCell = (
      k: number,
      length: number,
      x: number,
      y: number,
      entry: Entry | undefined,
      paint: CellPaint | undefined,
    ): void => {
      // INLINE_PAD marks a blank inline-padding cell: no glyph, but
      // its element's background still fills it.
      if (node.text[k] === INLINE_PAD) {
        if (entry?.backgroundColor) {
          contentPut(x, y, " ", alphaPaint({ backgroundColor: entry.backgroundColor }));
        }
        return;
      }
      const cluster = length === 1 ? node.text[k]! : node.text.slice(k, k + length);
      const cells = clusterWidth(cluster);
      if (cells > 0) contentPut(x, y, cluster, tint ? tint(paint, x, y) : paint, cells);
    };
    // A sticky inline element's glyphs paint after the rest of the
    // leaf's, over the line they were shifted onto (specs/sticky.md).
    const shifted: Parameters<typeof paintCell>[] = [];
    forEachLeafCell(
      node,
      scrolledX,
      scrolledY,
      (k, length, x, y) => {
        const inlineIndex = node.charInline?.[k] ?? -1;
        const entry = inlineIndex >= 0 ? node.inlineElements![inlineIndex] : undefined;
        let paint = entry ? inlinePaints![inlineIndex] : leafPaint;
        if (selection && k >= selection.start && k < selection.end) {
          paint = { ...paint, selected: true };
        }
        if (entry?.stickyShift) shifted.push([k, length, x, y, entry, paint]);
        else paintCell(k, length, x, y, entry, paint);
      },
      (x, y) => contentPut(x, y, "…", leafPaint),
    );
    for (const args of shifted) paintCell(...args);
  }

  for (const child of paintOrderedChildren(node)) {
    // The stack paints after the tree (specs/top-layer.md).
    if (child.topLayerRank !== undefined) continue;
    walk(
      child,
      scrolledX,
      scrolledY,
      walking,
      contentPut,
      alpha * child.style.opacity,
      contentClip,
    );
  }
  if (lattice) {
    for (const run of lattice.runs) {
      const paint = alphaPaint(run.color === undefined ? undefined : { color: run.color });
      put(absX + run.x, absY + run.y, run.glyph, paint);
    }
  }

  // Scrollbars last, over content (specs/scrolling.md): every
  // reserved gutter paints track + thumb (full-length when nothing
  // overflows — the `scroll` case; an `auto` gutter exists only with
  // overflow). The shared corner cell of two bars stays blank.
  const range = node.scrollRange;
  const gutter = node.scrollGutterCells;
  if (range && gutter && (gutter.right > 0 || gutter.bottom > 0)) {
    const { track, thumb } = scrollGlyphs(glyphSetFor(style.glyphSet));
    // `scrollbar-color: auto` means the container's own color (its
    // currentColor, like borders) — not the inherited grid default.
    const barPaint = (color: string | undefined): CellPaint | undefined =>
      alphaPaint(color ? { color } : undefined);
    const trackPaint = barPaint(style.scrollbarColor?.track ?? style.color);
    const thumbPaint = barPaint(style.scrollbarColor?.thumb ?? style.color);
    const bars = scrollbarGeometry(node, absX, absY);
    if (bars.y) {
      const { col, row, thick, len } = bars.y;
      const { at, len: thumbLen } = thumbSpan(len, range.sizeY, range.maxY, node.scroll?.y ?? 0);
      for (let dx = 0; dx < thick; dx++) {
        for (let i = 0; i < len; i++) {
          const isThumb = i >= at && i < at + thumbLen;
          put(col + dx, row + i, isThumb ? thumb : track, isThumb ? thumbPaint : trackPaint);
        }
      }
    }
    if (bars.x) {
      const { col, row, thick, len } = bars.x;
      const { at, len: thumbLen } = thumbSpan(len, range.sizeX, range.maxX, node.scroll?.x ?? 0);
      for (let dy = 0; dy < thick; dy++) {
        for (let i = 0; i < len; i++) {
          const isThumb = i >= at && i < at + thumbLen;
          put(col + i, row + dy, isThumb ? thumb : track, isThumb ? thumbPaint : trackPaint);
        }
      }
    }
  }
  opened?.close();
}

/** The cells a leaf's text occupies: the per-line placement — line
 * geometry (a multicol leaf's stored fragmentation, else recomputed),
 * first-line indent, alignment, truncation, inline relative shifts,
 * per-character advances — in ONE place, so mapping a cell back to a
 * character (charIndexAtCell) cannot drift from the paint. `absX/absY`
 * is the leaf's border-box origin with its own scroll applied; U+FFFC
 * markers are skipped (their boxes paint themselves). Visits are per
 * CLUSTER: `index` is its first code unit, `length` its code units
 * (the following 0-advance units ride along, a 0-width cluster with
 * the cluster before it), `advance` its cells with tracking. */
function forEachLeafCell(
  node: LayoutNode,
  absX: number,
  absY: number,
  onChar: (index: number, length: number, x: number, y: number, advance: number) => void,
  onEllipsis?: (x: number, y: number) => void,
): void {
  const style = node.style;
  const padding = node.resolvedPadding;
  const contentX = absX + style.border.left + padding.left;
  const contentY = absY + style.border.top + padding.top;
  const contentWidth =
    node.localRect.width - style.border.left - style.border.right - padding.left - padding.right;
  const multicol = node.multicolGeometry;
  const { spans, textY } = multicol ?? leafLineGeometry(node, contentWidth);
  // Alignment and truncation act within one column of a multicol leaf,
  // against the tracked wrap width — the browser's own alignment
  // includes the trailing letter-spacing gap, so the engine ends lines
  // at `width − tracking` to sit under it.
  const alignWidth = multicol ? Math.max(1, multicol.columnWidth - style.tracking) : contentWidth;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    const row = contentY + textY[i]!;
    // A line beside a float aligns within its band (specs/float.md),
    // from the band's edge.
    const band = node.lineBands?.[i];
    const lineAlignWidth = band ? band.width : alignWidth;
    // First-line indent reduces the usable width and shifts the origin
    // (per CSS, `<br>` doesn't re-indent, so only spans[0] is charged).
    const indent = i === 0 ? style.textIndent : 0;
    const truncated =
      style.whiteSpace !== "normal" && style.overflow.x === "clip"
        ? truncateSpan(node.text, span, lineAlignWidth - indent, node.advances, style)
        : { end: span.end, ellipsis: false };
    // `text-align: end` offsets each line to the content box's right
    // edge; `center` to floor((W − line) / 2). Whole cells; a line at
    // or over the width stays at start, matching truncation.
    const lineWidth = lineAdvance(node.text, span.start, span.end, node.advances, style.tracking);
    const leftover = Math.max(0, lineAlignWidth - indent - lineWidth);
    const alignOffset =
      style.textAlign === "end"
        ? leftover
        : style.textAlign === "center"
          ? Math.floor(leftover / 2)
          : 0;
    let x = contentX + (multicol?.lineX[i] ?? 0) + (band?.x ?? 0) + alignOffset + indent;
    const advances = node.advances;
    for (let k = span.start; k < truncated.end;) {
      const advance = advanceOf(k, k + 1, advances);
      let length = 1;
      if (advances) while (k + length < truncated.end && advances[k + length] === 0) length++;
      if (node.text[k] !== OBJECT_REPLACEMENT && advance > 0) {
        // Inline relative shifts, whole cells (specs/positioning.md):
        // the over-constrained sides resolve like CSS (top/left win);
        // a sticky element's shift for the scroll (specs/sticky.md).
        const entry = node.inlineElements?.[node.charInline?.[k] ?? -1];
        const insets = entry?.insets;
        const dx =
          (insets ? (insets.left ?? (insets.right !== null ? -insets.right : 0)) : 0) +
          (entry?.stickyShift?.x ?? 0);
        const dy =
          (insets ? (insets.top ?? (insets.bottom !== null ? -insets.bottom : 0)) : 0) +
          (entry?.stickyShift?.y ?? 0);
        onChar(k, length, x + dx, row + dy, advance);
      }
      x += advance;
      k += length;
    }
    if (truncated.ellipsis) onEllipsis?.(x, row);
  }
}

/** The cells a clipping container's content shows through, in
 * absolute cells (specs/scrolling.md): its padding box on each
 * clipping axis, the gutter excluded, unbounded on a visible axis;
 * null for a container clipping neither. The paint culls ink here and
 * hit-testing stops descending here. */
export function clipBounds(node: LayoutNode, absX: number, absY: number): Clip | null {
  const { overflow, border } = node.style;
  const clipsX = overflow.x !== "visible";
  const clipsY = overflow.y !== "visible";
  if (!clipsX && !clipsY) return null;
  const gutter = node.scrollGutterCells;
  const { width, height } = node.localRect;
  return {
    x0: clipsX ? absX + border.left : -Infinity,
    y0: clipsY ? absY + border.top : -Infinity,
    x1: clipsX ? absX + width - border.right - (gutter?.right ?? 0) : Infinity,
    y1: clipsY ? absY + height - border.bottom - (gutter?.bottom ?? 0) : Infinity,
  };
}

/** Whether a cell lies on one of a fragmented leaf's line boxes — the
 * hit test for paragraph-flow multicol children, whose `localRect` is
 * the shared container box (specs/multicol.md): each line covers its
 * column's width and the rows down to the next line in that column
 * (its own line box when it is the column's last). */
export function leafLineCovers(
  node: LayoutNode,
  absX: number,
  absY: number,
  col: number,
  row: number,
): boolean {
  const geometry = node.multicolGeometry;
  if (!geometry) return false;
  const style = node.style;
  const padding = node.resolvedPadding;
  const x = col - (absX + style.border.left + padding.left);
  const y = row - (absY + style.border.top + padding.top);
  const { lineX, lineY } = geometry;
  for (let i = 0; i < lineY.length; i++) {
    if (x < lineX[i]! || x >= lineX[i]! + geometry.columnWidth) continue;
    const next = i + 1 < lineY.length && lineX[i + 1] === lineX[i] ? lineY[i + 1]! : undefined;
    const bottom = next ?? lineY[i]! + 1 + style.lineGap;
    if (y >= lineY[i]! && y < bottom) return true;
  }
  return false;
}

/** The index into `node.text` of the character painted at a cell, or
 * null for a blank cell (specs/semantic-selection.md). `absX/absY` is
 * the leaf's painted border-box origin as hitStack reports it. */
export function charIndexAtCell(
  node: LayoutNode,
  absX: number,
  absY: number,
  col: number,
  row: number,
): number | null {
  let found: number | null = null;
  forEachLeafCell(
    node,
    absX - (node.scroll?.x ?? 0),
    absY - (node.scroll?.y ?? 0),
    (k, _length, x, y, advance) => {
      if (y !== row || col < x || col >= x + advance) return;
      // A sticky inline element's glyph paints over the line it was
      // shifted onto, so it is the one at the cell.
      const sticky = node.inlineElements?.[node.charInline?.[k] ?? -1]?.stickyShift !== undefined;
      if (found === null || sticky) found = k;
    },
  );
  return found;
}

/** The cells a leaf's inline elements cover, one rect per element per
 * row — the span of its characters and pad cells there, an outer
 * element's including its inline descendants' — in run order then row
 * order, elements without a cell left out (specs/focus-navigation.md).
 * `absX/absY` as for charIndexAtCell. */
export function inlineElementRects(
  node: LayoutNode,
  absX: number,
  absY: number,
): { element: Element; rect: Rect }[] {
  const entries = node.inlineElements;
  if (!entries || !node.charInline) return [];
  // Each entry's own index plus the indices of the entries containing
  // it: a character belongs to its innermost element and every ancestor.
  const owners = entries.map((entry, i) =>
    entries.flatMap((outer, j) => (j === i || outer.element.contains(entry.element) ? [j] : [])),
  );
  const rows = entries.map(() => new Map<number, { x0: number; x1: number }>());
  forEachLeafCell(
    node,
    absX - (node.scroll?.x ?? 0),
    absY - (node.scroll?.y ?? 0),
    (k, _length, x, y, advance) => {
      const inner = node.charInline![k] ?? -1;
      if (inner < 0) return;
      for (const i of owners[inner]!) {
        const span = rows[i]!.get(y);
        if (!span) rows[i]!.set(y, { x0: x, x1: x + advance });
        else {
          span.x0 = Math.min(span.x0, x);
          span.x1 = Math.max(span.x1, x + advance);
        }
      }
    },
  );
  return entries.flatMap((entry, i) =>
    [...rows[i]!]
      .sort(([a], [b]) => a - b)
      .map(([y, span]) => ({
        element: entry.element,
        rect: { x: span.x0, y, width: span.x1 - span.x0, height: 1 },
      })),
  );
}

/** Where a container's bars paint, in absolute cells from its
 * border-box origin (specs/scrolling.md): each bar sits at the inner
 * edge of its reserved band (`scrollbar-inset` moves it inward, the
 * freed cells stay blank), `thick` cells across; its track starts
 * inset from its own edge and ends against the other axis's band, or
 * inset from the far edge when there is none. Shared with thumb
 * dragging (element.ts). */
export function scrollbarGeometry(
  node: LayoutNode,
  absX: number,
  absY: number,
): { y?: Scrollbar; x?: Scrollbar } {
  const gutter = node.scrollGutterCells;
  if (!gutter) return {};
  const { border, scrollbarSize: size, scrollbarInset: inset } = node.style;
  const innerTop = absY + border.top;
  const innerLeft = absX + border.left;
  const innerBottom = absY + node.localRect.height - border.bottom;
  const innerRight = absX + node.localRect.width - border.right;
  // A track ends against the other axis's band when there is one (the
  // corner cell between the bars stays blank), else inset from the edge.
  const bottomEnd = gutter.bottom > 0 ? innerBottom - gutter.bottom : innerBottom - inset.y;
  const rightEnd = gutter.right > 0 ? innerRight - gutter.right : innerRight - inset.x;
  const bars: { y?: Scrollbar; x?: Scrollbar } = {};
  if (gutter.right > 0) {
    bars.y = {
      col: innerRight - gutter.right,
      row: innerTop + inset.y,
      thick: Math.min(size.y, gutter.right),
      len: Math.max(0, bottomEnd - innerTop - inset.y),
    };
  }
  if (gutter.bottom > 0) {
    bars.x = {
      col: innerLeft + inset.x,
      row: innerBottom - gutter.bottom,
      thick: Math.min(size.x, gutter.bottom),
      len: Math.max(0, rightEnd - innerLeft - inset.x),
    };
  }
  return bars;
}

/** One bar: the cell its track starts at, its thickness across, and
 * its length along its axis. */
export interface Scrollbar {
  col: number;
  row: number;
  thick: number;
  len: number;
}

/** Thumb geometry on a bar `trackLen` cells long: proportional to the
 * visible fraction, but shrunk until every scroll offset gets its own
 * thumb position (`trackLen − max` cells at most, one at least) — so a
 * scrollable bar always shows track, and each step moves the thumb
 * while the track has room. Shared with thumb dragging (element.ts). */
export function thumbSpan(
  trackLen: number,
  size: number,
  max: number,
  offset: number,
): { at: number; len: number } {
  const frac = size > 0 ? Math.min(1, trackLen / size) : 1;
  let len = Math.max(1, Math.round(frac * trackLen));
  if (max > 0) len = Math.max(1, Math.min(len, trackLen - max));
  const at = max > 0 ? Math.round((Math.min(offset, max) / max) * (trackLen - len)) : 0;
  return { at, len };
}

/**
 * Mirror of what the browser paints for a clipped nowrap line: cut at the
 * content width, with `…` in the last visible cell when `text-overflow:
 * ellipsis` is set (the ellipsis reserves one cell).
 */
function truncateSpan(
  text: string,
  span: LineSpan,
  contentWidth: number,
  advances: number[] | undefined,
  style: LayoutNode["style"],
): { end: number; ellipsis: boolean } {
  const { textOverflow, tracking } = style;
  if (lineAdvance(text, span.start, span.end, advances, tracking) <= contentWidth) {
    return { end: span.end, ellipsis: false };
  }
  const limit = textOverflow === "ellipsis" ? contentWidth - 1 : contentWidth;
  let end = span.start;
  while (end < span.end && lineAdvance(text, span.start, end + 1, advances, tracking) <= limit)
    end++;
  return { end, ellipsis: textOverflow === "ellipsis" && contentWidth > 0 };
}
