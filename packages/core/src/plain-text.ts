import { collectBorderRuns, collectShadowRuns } from "./borders.ts";
import { resolveLattice } from "./lattice.ts";
import { glyphTurns, inlineOpacity, paintOrder } from "./stacking.ts";
import type { PaintVisitor } from "./stacking.ts";
import type { BorderRun } from "./borders.ts";
import { compositeColors, parseColor, serializeColor } from "./color.ts";
import type { Rgba } from "./color.ts";
import { DEFAULT_CELL, gradientCells } from "./gradient.ts";
import type { CellSize } from "./gradient.ts";
import {
  contentOrigin,
  edges,
  firstLineStart,
  gapShare,
  isGap,
  isInFlowBox,
  lineStart,
  spreadBefore,
} from "./layout.ts";
import type { Spread } from "./layout.ts";
import { glyphSetFor, scrollGlyphs } from "./glyphs.ts";
import {
  advanceOf,
  INLINE_PAD,
  lineAdvance,
  OBJECT_REPLACEMENT,
  showsHyphen,
  SOFT_HYPHEN,
  WBR_MARKER,
} from "./wrap.ts";
import type { LineSpan } from "./wrap.ts";
import { clipsAxis, GLYPH_PROPERTIES, NO_DECORATION, softWraps, zeroInsets } from "./types.ts";
import type {
  CellStyle,
  Clip,
  GlyphProperty,
  GlyphValues,
  InlineElement,
  Insets,
  LayoutNode,
  Rect,
  TextDecoration,
} from "./types.ts";
import { clusterWidth, isColorEmoji } from "./width.ts";

/**
 * Render a laid-out tree as plain text: the cells paint.ts draws, minus
 * colors and fonts, a blank cell as a space — the engine's
 * deterministic, diffable screenshot. Ink above or left of the origin
 * is dropped; a wide cluster sits in its first cell, empty
 * continuation cells after it (specs/wide-characters.md).
 */
export function renderPlainText(root: LayoutNode): string {
  const { store, layers } = renderGrids(root, {});
  compositeLayers(store, layers);
  return store.grid.map((row) => row.join("").trimEnd()).join("\n");
}

/** Per-cell paint, each field optional so a span carries only what
 * differs from the host's text style; its colors are final
 * (specs/cell-model.md "Opacity and translucency"). */
export interface CellPaint {
  color?: string | undefined;
  backgroundColor?: string | undefined;
  /** The opacity of the groups over a cell without an opaque background: the span's. */
  opacity?: number | undefined;
  /** A color emoji's groups' opacity over a blended cell: its glyph's alone. */
  emojiOpacity?: number | undefined;
  /** The background (`fill`) or glyph color (`text`) is a gradient's
   * (specs/gradients.md): such cells join into one run. */
  gradient?: "fill" | "text" | undefined;
  /** A gradient run's colors, one per cell, as one span's hard stops. */
  backgrounds?: string[];
  colors?: string[];
  /** Its glyph properties unlike the host's (`glyphStyle`). */
  glyph?: GlyphStyle;
  decoration?: TextDecoration;
  /** Inside a light-DOM selection: painted swapped (specs/wide-characters.md). */
  selected?: true;
}

/** CellPaint's fields: comparing or keying paints reads each. */
export const PAINT_FIELDS = [
  "color",
  "backgroundColor",
  "opacity",
  "emojiOpacity",
  "gradient",
  "backgrounds",
  "colors",
  "glyph",
  "decoration",
  "selected",
] as const satisfies readonly (keyof CellPaint)[];

/** One of a row's same-paint runs, which join at the grid's full width
 * (specs/cell-model.md "Selection"); a boxed one is painted in a box of
 * exactly `cells` cells (specs/wide-characters.md). */
export interface CellSegment extends CellPaint {
  text: string;
  cells?: number;
  /** The cells one cluster of the box takes. */
  box?: number;
}

/** What the DOM adapter adds to the model: its font's fits, the
 * selection's character ranges, the cell, and the host's colors. */
export interface RenderOptions {
  /** The caller's fit for a cluster (specs/wide-characters.md): falsy
   * unboxed, `true` boxed alone, any other shared by identical one-cell
   * neighbors on the same fit. */
  boxed?: (
    cluster: string,
    cells: number,
    paint: CellPaint | undefined,
    resampled: boolean,
    translucent: boolean,
  ) => unknown;
  selection?: Map<LayoutNode, { start: number; end: number }> | undefined;
  /** The cell in px, for a gradient's geometry; a 1:2 cell without. */
  cell?: CellSize | undefined;
  /** The host's ground and ink (specs/cell-model.md); white and black without. */
  ground?: Rgba | undefined;
  ink?: Rgba | undefined;
  /** A color the parser leaves alone, resolved where the spans inherit it. */
  readColor?: ((value: string) => Rgba | null) | undefined;
}

/** Row-major cell segments, as the DOM adapter paints them. */
export function renderCellSegments(root: LayoutNode, options: RenderOptions = {}): CellSegment[][] {
  return renderGridRows(root, options).segments;
}

/** A layer (specs/layers.md): a root's subtree painted into a grid of
 * its own at `x`, `y` of the main grid, `parent` the one it opened in. */
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
  /** The clips between the root and the enclosing layer's, intersected,
   * in main-grid cells; null unclipped. */
  clip: Clip | null;
  parent: PaintedLayer | null;
  /** The opacity of the groups between the root and the enclosing
   * layer's root, its own inline ancestors' included (specs/cell-model.md). */
  alpha: number;
}

/** A layer's rows of segments, with the layer they were built from and
 * whether its cells are drawn resampled. */
export interface LayerRows {
  layer: PaintedLayer;
  segments: CellSegment[][];
  resampled: boolean;
}

/** The segments with the cell strings they were built from, each
 * layer's apart. */
export function renderGridRows(
  root: LayoutNode,
  options: RenderOptions = {},
): { segments: CellSegment[][]; cells: string[][]; layers: LayerRows[] } {
  const { store, layers, palette } = renderGrids(root, options);
  const segmentsOf = (grid: string[][], paints: (CellPaint | undefined)[][], resampled: boolean) =>
    grid.map((row, y) => rowSegments(row, paints[y]!, options.boxed, resampled, palette));
  return {
    segments: segmentsOf(store.grid, store.paints, false),
    cells: store.grid,
    layers: layers.map((layer) => {
      const resampled = layerResampled(layer);
      return { layer, segments: segmentsOf(layer.grid, layer.paints, resampled), resampled };
    }),
  };
}

/** Whether a layer's cells are drawn resampled, by its own effects or an
 * enclosing layer's (specs/wide-characters.md). */
function layerResampled(layer: PaintedLayer): boolean {
  for (let at: PaintedLayer | null = layer; at; at = at.parent) {
    if (at.node.style.layer?.resampled) return true;
  }
  return false;
}

/** One rendered row → its same-paint runs, painted spaces included: a
 * continuation cell rides with its wide cluster, and a boxed cluster
 * opens a box its neighbors on the same fit share. */
function rowSegments(
  row: string[],
  paints: (CellPaint | undefined)[],
  boxed: RenderOptions["boxed"],
  resampled: boolean,
  palette: Palette,
): CellSegment[] {
  const segments: CellSegment[] = [];
  let lastCells = 0;
  let lastFit: unknown;
  // The paint read last, translucent or not: a run of one paint reads once.
  let read: CellPaint | undefined;
  let translucent = false;
  // The loop is forEachCluster's, inline: the hottest in the paint.
  for (let x = 0; x < row.length; x++) {
    const cell = row[x]!;
    if (cell === "") continue;
    let paint = paints[x];
    if (paint?.selected) paint = palette.selected(paint);
    let cells = 1;
    while (row[x + cells] === "") cells++;
    let fit: unknown;
    if (boxed && (cell.length > 1 || cell.charCodeAt(0) >= 0x80)) {
      if (paint !== read) {
        read = paint;
        translucent =
          paint !== undefined &&
          (paint.opacity !== undefined ||
            (paint.color !== undefined && !palette.opaque(paint.color)));
      }
      fit = boxed(cell, cells, paint, resampled, translucent);
    }
    const last = segments[segments.length - 1];
    // A run of one single-cell cluster on one fit shares a box, whose
    // neighbor draws the ink a fit pushes past each cell.
    const joins =
      last?.box === 1 &&
      cells === 1 &&
      cell === last.text[0] &&
      fit !== true &&
      fit === lastFit &&
      samePaint(last, paint);
    if (joins) {
      last.text += cell;
      last.cells = last.cells! + 1;
      continue;
    }
    if (fit) {
      segments.push({ text: cell, cells, box: cells, ...paint });
      lastCells = 0;
      lastFit = fit;
      continue;
    }
    if (
      last &&
      !last.box &&
      (samePaint(last, paint) ||
        (paint !== undefined && joinGradient(last, paint, lastCells, cells)))
    ) {
      last.text += cell;
      lastCells += cells;
    } else {
      segments.push({ text: cell, ...paint });
      lastCells = cells;
    }
  }
  return segments;
}

/** Each cluster of a row, at the cell it starts, with the cells it
 * takes: a wide one's continuation cells (`""`) ride with it. */
function forEachCluster(
  row: string[],
  visit: (x: number, cluster: string, cells: number) => void,
): void {
  for (let x = 0; x < row.length; x++) {
    const cluster = row[x]!;
    if (cluster === "") continue;
    let cells = 1;
    while (row[x + cells] === "") cells++;
    visit(x, cluster, cells);
  }
}

/** Joins a gradient cell to the run before it, its color one more of
 * the run's list, where both are unselected, alike in all else, and
 * painted in one gradient field — a text clip's only without a
 * background, which Firefox's clip would take away. */
function joinGradient(
  run: CellSegment,
  paint: CellPaint,
  runCells: number,
  cells: number,
): boolean {
  const fill = run.gradient === "fill";
  const field = fill ? "backgroundColor" : "color";
  const other = fill ? "color" : "backgroundColor";
  const list = fill ? "backgrounds" : "colors";
  // Field by field, as samePaint: this runs per cell of a gradient.
  const joins =
    run.gradient !== undefined &&
    paint.gradient === run.gradient &&
    paint[field] !== undefined &&
    (fill || paint.backgroundColor === undefined) &&
    (run[list] !== undefined || run[field] !== undefined) &&
    run.selected === undefined &&
    paint.selected === undefined &&
    run[other] === paint[other] &&
    run.opacity === paint.opacity &&
    run.emojiOpacity === paint.emojiOpacity &&
    run.glyph === paint.glyph &&
    run.decoration === paint.decoration;
  if (!joins) return false;
  const colors = (run[list] ??= Array.from({ length: runCells }, () => run[field]!));
  delete run[field];
  for (let k = 0; k < cells; k++) colors.push(paint[field]!);
  return true;
}

/** Two paints alike, field by field: a row compares one per cell, where
 * reading PAINT_FIELDS by key costs the paint a third again. */
export function samePaint(a: CellPaint, b: CellPaint | undefined): boolean {
  return (
    a.color === b?.color &&
    a.backgroundColor === b?.backgroundColor &&
    a.opacity === b?.opacity &&
    a.emojiOpacity === b?.emojiOpacity &&
    a.gradient === b?.gradient &&
    sameList(a.backgrounds, b?.backgrounds) &&
    sameList(a.colors, b?.colors) &&
    a.glyph === b?.glyph &&
    a.decoration === b?.decoration &&
    a.selected === b?.selected
  );
}

/** Two per-cell lists alike: the one list, as a paint's cells share
 * it, or its values, as a repaint's arrive anew. */
function sameList(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, i) => value === b[i]);
}

/** A paint onto a span's style, a selected one's colors swapped — the
 * theme's, for an unstyled cell — at its opacity. */
export function applyCellPaint(paint: CellPaint, style: CSSStyleDeclaration): void {
  if (paint.opacity !== undefined) style.opacity = String(paint.opacity);
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
  if (paint.glyph) {
    for (const property in paint.glyph) {
      style.setProperty(property, paint.glyph[property as GlyphProperty]!);
    }
  }
  if (paint.decoration) applyDecoration(paint.decoration, style);
}

/** A decoration onto a span's style, its initial values unwritten. */
export function applyDecoration(decoration: TextDecoration, style: CSSStyleDeclaration): void {
  const { line, style: kind, color, thickness } = decoration;
  let value = line;
  if (kind !== NO_DECORATION.style) value += ` ${kind}`;
  if (color !== NO_DECORATION.color) value += ` ${color}`;
  style.textDecoration = value;
  if (thickness !== NO_DECORATION.thickness) style.textDecorationThickness = thickness;
}

/** The cells the box `background-clip` names sits inside the border
 * box, per side; none for the border box and for text. */
function backgroundInset(node: LayoutNode): Insets {
  const { backgroundClip: clip, border } = node.style;
  if (clip === "padding-box") return border;
  if (clip !== "content-box") return zeroInsets();
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

/** Whether a segment carries no paint: a bare text node in the DOM. */
export function isBarePaint(paint: CellPaint): boolean {
  return PAINT_FIELDS.every((field) => paint[field] === undefined);
}

/** Paints a cluster over `cells` cells at `alpha`, a closing group's
 * opacity (specs/cell-model.md "Opacity and translucency"). */
type PutGlyph = (
  x: number,
  y: number,
  glyph: string,
  paint: CellPaint | undefined,
  cells?: number,
  alpha?: number,
) => void;

/** `bg-clear`'s paint: a put of it wipes its cell to the ground,
 * background and glyph, through every group it sits in. */
const WIPE: CellPaint = {};

type Palette = ReturnType<typeof createPalette>;

/** A render's colors, each read once, and its blends, each computed
 * once (specs/cell-model.md "Opacity and translucency"). */
function createPalette(options: RenderOptions) {
  const read = new Map<string, Rgba | null>();
  const rgba = (value: string): Rgba | null => {
    let color = read.get(value);
    if (color === undefined) {
      color = parseColor(value) ?? options.readColor?.(value) ?? null;
      read.set(value, color);
    }
    return color;
  };
  // A written string reads back as the color that wrote it, so a blend
  // of blends rounds once.
  const write = (color: Rgba): string => {
    const value = serializeColor(color);
    if (!read.has(value)) read.set(value, color);
    return value;
  };
  /** A color's alpha, 1 for one it cannot read. */
  const alphaOf = (value: string): number => rgba(value)?.a ?? 1;
  const opaque = (value: string): boolean => alphaOf(value) >= 1;
  const blends = new Map<number, Map<string, Map<string, string>>>();
  /** `over` at `alpha` composited over `under`, as written: `under`
   * itself at zero alpha, `over` as authored where it cannot be read. */
  const blend = (over: string, alpha: number, under?: string): string => {
    if (alpha === 1 && (under === undefined || opaque(over))) return over;
    let byUnder = blends.get(alpha);
    if (!byUnder) blends.set(alpha, (byUnder = new Map()));
    let byOver = byUnder.get(under ?? "");
    if (!byOver) byUnder.set(under ?? "", (byOver = new Map()));
    let value = byOver.get(over);
    if (value === undefined) {
      const top = rgba(over);
      if (top === null) value = over;
      else if (top.a * alpha === 0 && under !== undefined) value = under;
      else {
        const faded = { ...top, a: top.a * alpha };
        const base = under === undefined ? null : rgba(under);
        value = write(base === null ? faded : compositeColors(faded, base));
      }
      byOver.set(over, value);
    }
    return value;
  };
  const alphas = new Map<string, Map<number, string>>();
  /** `value` at `alpha`, its channels kept. */
  const withAlpha = (value: string, alpha: number): string => {
    let byAlpha = alphas.get(value);
    if (!byAlpha) alphas.set(value, (byAlpha = new Map()));
    let result = byAlpha.get(alpha);
    if (result === undefined) {
      const color = rgba(value);
      result = color === null ? value : write({ ...color, a: alpha });
      byAlpha.set(alpha, result);
    }
    return result;
  };
  const ground = write(options.ground ?? { r: 1, g: 1, b: 1, a: 1 });
  const ink = write(options.ink ?? { r: 0, g: 0, b: 0, a: 1 });
  /** Whether a paint's colors, those it has, are opaque. */
  const opaquePaint = ({ backgroundColor, color }: CellPaint): boolean =>
    (backgroundColor === undefined || opaque(backgroundColor)) &&
    (color === undefined || opaque(color));
  const swaps = new Map<CellPaint, CellPaint>();
  /** A selected cell's colors as they show, for the swap: a translucent
   * one over the ground, a blended emoji's at its opacity. */
  const selected = (paint: CellPaint): CellPaint => {
    const { backgroundColor, color, emojiOpacity = 1 } = paint;
    if (emojiOpacity === 1 && opaquePaint(paint)) return paint;
    let shown = swaps.get(paint);
    if (!shown) {
      const beneath = backgroundColor === undefined ? ground : blend(backgroundColor, 1, ground);
      const glyph = color === undefined ? undefined : blend(color, emojiOpacity, beneath);
      swaps.set(paint, (shown = { ...paint, backgroundColor: beneath, color: glyph }));
    }
    return shown;
  };
  /** `paint` at `alpha` over a cell of background `under` and gradient
   * mark `fill`, as specs/cell-model.md "Opacity and translucency"
   * composites it. */
  const composite = (
    under: string | undefined,
    fill: "fill" | undefined,
    paint: CellPaint,
    alpha: number,
    glyph: boolean,
    emoji: boolean,
  ): CellPaint => {
    const faded = alpha * (paint.opacity ?? 1);
    if (under === undefined && faded < 1) {
      return alpha === 1 ? paint : { ...paint, opacity: faded };
    }
    const own = paint.backgroundColor;
    const over = own !== undefined && alphaOf(own) * faded > 0 ? own : undefined;
    const mark = over !== undefined || paint.gradient !== "fill" ? paint.gradient : undefined;
    let backgroundColor = over === undefined ? under : blend(over, faded, under);
    // A background blended over a gradient's cell stays one of its run's stops.
    const gradient = backgroundColor === over ? mark : (mark ?? fill);
    let color = paint.color;
    if (color === undefined && faded < 1 && glyph) color = ink;
    let opacity: number | undefined;
    if (color !== undefined && !emoji && over !== undefined && faded < 1) {
      color = blend(blend(color, 1, over), faded, under);
      if (!opaque(under!)) {
        opacity = alphaOf(color);
        color = withAlpha(color, 1);
        backgroundColor = withAlpha(backgroundColor!, alphaOf(backgroundColor!) / opacity);
      }
    } else if (color !== undefined && !emoji) {
      color = blend(color, faded);
      if (backgroundColor !== undefined && opaque(backgroundColor)) {
        color = blend(color, 1, backgroundColor);
      }
    }
    const cell: CellPaint = { ...paint, backgroundColor, gradient, color };
    if (opacity !== undefined || paint.opacity !== undefined) cell.opacity = opacity;
    if (emoji && faded < 1) cell.emojiOpacity = (paint.emojiOpacity ?? 1) * faded;
    return cell;
  };
  return { opaque, opaquePaint, blend, selected, composite };
}

type CellStore = ReturnType<typeof cellStore>;

const PAINTED = 1;
const WIPED = 2;

/** A grid of cells and its put, culled at the edges: a wide cluster a
 * later paint half-covers is blanked whole, as in a terminal;
 * `touched`, a group's, marks the cells puts and wipes reach. */
function cellStore(width: number, height: number, palette: Palette, touched?: Uint8Array) {
  // Rows copied from one blank row: a group's store is made at each close.
  const blank = " ".repeat(width).split("");
  const unpainted = blank.map((): CellPaint | undefined => undefined);
  const grid: string[][] = [];
  const paints: (CellPaint | undefined)[][] = [];
  for (let y = 0; y < height; y++) {
    grid.push(blank.slice());
    paints.push(unpainted.slice());
  }
  // A row's owners, made once a wide cluster lands on it.
  const owners: (({ x: number; cells: number } | undefined)[] | undefined)[] = [];
  const inside = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height;
  const release = (x: number, y: number) => {
    const owner = owners[y]?.[x];
    if (!owner) return;
    for (let at = owner.x; at < owner.x + owner.cells; at++) {
      grid[y]![at] = " ";
      owners[y]![at] = undefined;
      // A blank takes the emoji's color blended, as a faded glyph's is.
      const { emojiOpacity, ...paint } = paints[y]![at] ?? {};
      if (emojiOpacity === undefined || paint.color === undefined) continue;
      paint.color = palette.blend(paint.color, emojiOpacity, paint.backgroundColor);
      paints[y]![at] = paint;
    }
  };
  // The paint put last, opaque or not: a run of one paint reads once.
  let last: CellPaint | undefined;
  let lastOpaque = true;
  const opaque = (paint: CellPaint): boolean => {
    if (paint !== last) {
      last = paint;
      lastOpaque = paint.opacity === undefined && palette.opaquePaint(paint);
    }
    return lastOpaque;
  };
  /** A cell's paint once `paint` lands on it at `alpha`
   * (specs/cell-model.md "Opacity and translucency"). */
  const merge = (
    old: CellPaint | undefined,
    paint: CellPaint | undefined,
    glyph: string,
    alpha: number,
    emoji: boolean,
    index: number,
  ): CellPaint | undefined => {
    if (touched) touched[index] = touched[index]! | PAINTED;
    const faded = old?.opacity;
    let under = old?.backgroundColor;
    // A zero-alpha color is no paint.
    if (under !== undefined && faded !== undefined) {
      under = faded > 0 ? palette.blend(under, faded) : undefined;
    }
    const fill = old?.gradient === "fill" ? "fill" : undefined;
    if (alpha < 1 || (paint !== undefined && !opaque(paint))) {
      const glyphed = glyph !== " " && glyph !== "";
      return palette.composite(under, fill, paint ?? {}, alpha, glyphed, emoji);
    }
    // An opaque glyph color holds whatever background it lands on.
    if (paint?.backgroundColor !== undefined || under === undefined) return paint;
    return { backgroundColor: under, gradient: fill, ...paint };
  };
  const clear = (x: number, y: number): void => {
    if (!inside(x, y)) return;
    release(x, y);
    grid[y]![x] = " ";
    paints[y]![x] = undefined;
    if (touched) touched[y * width + x] = WIPED;
  };
  const put: PutGlyph = (x, y, glyph, paint, cells = 1, alpha = 1) => {
    if (y < 0 || y >= height) return;
    if (paint === WIPE) {
      for (let dx = 0; dx < cells; dx++) clear(x + dx, y);
      return;
    }
    if (cells === 1) {
      if (!inside(x, y)) return;
      release(x, y);
      grid[y]![x] = glyph;
      paints[y]![x] = merge(paints[y]![x], paint, glyph, alpha, false, y * width + x);
      return;
    }
    // A cluster losing cells past the grid's edge is blanked whole.
    const whole = inside(x, y) && inside(x + cells - 1, y);
    const emoji =
      whole && (alpha < 1 || (paint !== undefined && !opaque(paint))) && isColorEmoji(glyph);
    for (let at = x; at < x + cells; at++) {
      if (!inside(at, y)) continue;
      release(at, y);
      grid[y]![at] = whole ? (at === x ? glyph : "") : " ";
      if (whole) (owners[y] ??= [])[at] = { x, cells };
      const cluster = whole ? glyph : " ";
      paints[y]![at] = merge(paints[y]![at], paint, cluster, alpha, emoji, y * width + at);
    }
  };
  return { grid, paints, put, clear };
}

/** A closed layer's extent, whose cells a later put in its grid covers
 * (specs/layers.md). */
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

/** `place`, covering the closed layers where it lands. */
const covering =
  (covers: Covers, place: PutGlyph): PutGlyph =>
  (x, y, glyph, paint, cells = 1, alpha) => {
    coverCells(covers, x, y, cells);
    place(x, y, glyph, paint, cells, alpha);
  };

/** What the walk carries besides its node: the layers so far, the one
 * it is in, its grid's closed layers, and the main grid's size. */
interface Walk {
  options: RenderOptions;
  palette: Palette;
  layers: PaintedLayer[];
  layer: PaintedLayer | null;
  covers: Covers;
  width: number;
  height: number;
  /** The grid's own put, unclipped: each box's clips cut it. */
  put: PutGlyph;
  /** The same, covering no layer: a group's close places its cells
   * through it, its puts having covered as they arrived. */
  place: PutGlyph;
  /** The opacity of the groups open since the enclosing layer's root
   * (or the grid): a layer opened under them takes it on its box. */
  alpha: number;
}

function renderGrids(
  root: LayoutNode,
  options: RenderOptions,
): { store: CellStore; layers: PaintedLayer[]; palette: Palette } {
  const width = Math.max(0, root.localRect.width);
  const height = Math.max(0, root.localRect.height);
  const covers: Covers = new Map();
  const palette = createPalette(options);
  const store = cellStore(width, height, palette);
  const put = covering(covers, store.put);
  const walking: Walk = {
    options,
    palette,
    layers: [],
    layer: null,
    covers,
    width,
    height,
    put,
    place: store.put,
    alpha: 1,
  };
  paintOrder(root, painter(walking, root));
  return { store, layers: walking.layers, palette };
}

/** The layers back onto the main grid, in order, so the transcript sees
 * one grid (specs/layers.md). */
function compositeLayers(store: CellStore, layers: PaintedLayer[]): void {
  for (const layer of layers) {
    layer.grid.forEach((row, dy) =>
      forEachCluster(row, (dx, glyph, cells) => {
        const paint = layer.paints[dy]![dx];
        if (glyph === " " && paint?.backgroundColor === undefined) return;
        if (layerShows(layer, layer.x + dx, layer.y + dy)) {
          store.put(layer.x + dx, layer.y + dy, glyph, paint, cells);
        }
      }),
    );
  }
}

export const inClip = (clip: Clip | null, x: number, y: number): boolean =>
  clip === null || (x >= clip.x0 && x < clip.x1 && y >= clip.y0 && y < clip.y1);

/** The clips that cut a box's own ink, its chain's: none for a layer
 * root, which paints unclipped in its layer, the layer cut by them. */
export const inkClip = (node: LayoutNode): Clip | null =>
  node.style.layer ? null : (node.paintClip ?? null);

/** Whether a main-grid cell of a layer lies inside its clip and every
 * enclosing layer's. */
function layerShows(layer: PaintedLayer, x: number, y: number): boolean {
  for (let at: PaintedLayer | null = layer; at; at = at.parent) {
    if (!inClip(at.clip, x, y)) return false;
  }
  return true;
}

export const intersect = (a: Clip | null, b: Clip): Clip =>
  a === null
    ? b
    : {
        x0: Math.max(a.x0, b.x0),
        y0: Math.max(a.y0, b.y0),
        x1: Math.min(a.x1, b.x1),
        y1: Math.min(a.y1, b.y1),
      };

/** The puts a layer or a group records: `put` covers the closed layers
 * as it arrives, `place` alone, and `lay` replays them into a store of
 * their extent. */
function recorder(walking: Walk, covers: Covers) {
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
  const puts: Parameters<PutGlyph>[] = [];
  const place: PutGlyph = (x, y, glyph, paint, cells = 1, alpha) => {
    if (grow(x, y, cells, 1)) puts.push([x, y, glyph, paint, cells, alpha]);
  };
  return {
    put: covering(covers, place),
    place,
    grow,
    extent: (): Clip | null => (x0 === Infinity ? null : { x0, y0, x1, y1 }),
    lay: (touched?: Uint8Array): CellStore => {
      const store = cellStore(x1 - x0, y1 - y0, walking.palette, touched);
      for (const [x, y, glyph, paint, cells, alpha] of puts) {
        store.put(x - x0, y - y0, glyph, paint, cells, alpha);
      }
      return store;
    },
  };
}

/** A layer's or a group's walk, and what ends it once its subtree has
 * painted. */
interface Scope {
  walking: Walk;
  close: () => void;
}

/** A layer opened at `node` (specs/layers.md): its subtree recorded
 * unclipped, laid out at close in a grid of its extent, which the ink
 * painted after it covers. */
function openLayer(
  walking: Walk,
  node: LayoutNode,
  box: Rect,
  clip: Clip | null,
  alpha: number,
): Scope {
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
    alpha,
  };
  walking.layers.push(layer);
  const covers: Covers = new Map();
  const recording = recorder(walking, covers);
  recording.grow(box.x, box.y, box.width, box.height);
  const close = (): void => {
    const extent = recording.extent();
    if (!extent) return;
    // Wholly past its clip (scrolled out of view), a layer shows
    // nothing: its cells stay unlaid.
    const { x0, y0, x1, y1 } = extent;
    const { clip: shown } = layer;
    if (shown && (x1 <= shown.x0 || x0 >= shown.x1 || y1 <= shown.y0 || y0 >= shown.y1)) return;
    const width = x1 - x0;
    const { grid, paints, clear } = recording.lay();
    Object.assign(layer, { x: x0, y: y0, width, height: y1 - y0, grid, paints });
    addCover(walking.covers, extent, (x, y) => {
      clear(x - x0, y - y0);
      layer.holes.add((y - y0) * width + (x - x0));
      coverCells(covers, x, y, 1);
    });
  };
  const { put, place } = recording;
  return { walking: { ...walking, layer, covers, put, place, alpha: 1 }, close };
}

/** A group (specs/cell-model.md "Opacity and translucency"): its
 * subtree recorded, and put at close at `alpha` over the cells
 * beneath, its wipes first. */
function openGroup(walking: Walk, alpha: number): Scope {
  const recording = recorder(walking, walking.covers);
  const close = (): void => {
    const extent = recording.extent();
    if (!extent) return;
    const { x0, y0, x1, y1 } = extent;
    const width = x1 - x0;
    const touched = new Uint8Array(width * (y1 - y0));
    const { grid, paints } = recording.lay(touched);
    const { place } = walking;
    for (let i = 0; i < touched.length; i++) {
      if (touched[i]! & WIPED) place(x0 + (i % width), y0 + Math.floor(i / width), " ", WIPE);
    }
    grid.forEach((row, y) =>
      forEachCluster(row, (x, glyph, cells) => {
        if (!(touched[y * width + x]! & PAINTED)) return;
        place(x0 + x, y0 + y, glyph, paints[y]![x], cells, alpha);
      }),
    );
  };
  const { put, place } = recording;
  return { walking: { ...walking, put, place, alpha: walking.alpha * alpha }, close };
}

/** `put` culled to `clip`, itself where nothing clips: a cluster cut by
 * the clip edge is blanked, its visible cells as spaces. */
function clipPut(put: PutGlyph, clip: Clip | null): PutGlyph {
  if (clip === null) return put;
  return (x, y, glyph, paint, cells = 1, alpha) => {
    if (cells === 1) {
      if (inClip(clip, x, y)) put(x, y, glyph, paint, 1, alpha);
      return;
    }
    let whole = true;
    for (let dx = 0; dx < cells; dx++) if (!inClip(clip, x + dx, y)) whole = false;
    if (whole) put(x, y, glyph, paint, cells, alpha);
    else {
      for (let dx = 0; dx < cells; dx++) {
        if (inClip(clip, x + dx, y)) put(x + dx, y, " ", paint, 1, alpha);
      }
    }
  };
}

const barPaint = (color: string | undefined): CellPaint | undefined =>
  color ? { color } : undefined;

/** The text styling a paint carries. */
type TextFont = Pick<CellStyle, "glyph" | "textDecoration">;

/** Glyph properties unlike the host's, one object per distinct set, so
 * paints compare them by identity. */
export type GlyphStyle = Readonly<Partial<Record<GlyphProperty, string>>>;

/** At most 256, as an animation's values are endless. */
const glyphStyles = new Map<string, GlyphStyle>();

/** Each value set's style against the base it was last taken for. */
const glyphStyleOf = new WeakMap<GlyphValues, { base: GlyphValues; style?: GlyphStyle }>();

/** `source`'s glyph properties that differ from `base`'s, none where
 * none does. */
function glyphStyle(source: GlyphValues, base: GlyphValues): GlyphStyle | undefined {
  if (source === base) return undefined;
  const known = glyphStyleOf.get(source);
  if (known?.base === base) return known.style;
  const differing = GLYPH_PROPERTIES.filter((property) => source[property] !== base[property]);
  let style: GlyphStyle | undefined;
  if (differing.length > 0) {
    const own = Object.fromEntries(differing.map((property) => [property, source[property]]));
    const key = glyphKey(own);
    style = glyphStyles.get(key);
    if (!style) {
      if (glyphStyles.size === 256) glyphStyles.clear();
      glyphStyles.set(key, (style = own));
    }
  }
  glyphStyleOf.set(source, style ? { base, style } : { base });
  return style;
}

/** A glyph style as a string, in the table's order. */
export function glyphKey(style: GlyphStyle | undefined): string {
  let key = "";
  for (const property of GLYPH_PROPERTIES) {
    if (style?.[property] !== undefined) key += `${property}:${style[property]};`;
  }
  return key;
}

/** `color` and `source`'s text styling unlike the grid's own, which it
 * inherits from the host (`base`, the root's), so a run like the host
 * stays bare. */
function textPaint(source: TextFont, color: string | undefined, base: TextFont): CellPaint {
  const paint: CellPaint = {};
  if (color) paint.color = color;
  const glyph = glyphStyle(source.glyph, base.glyph);
  if (glyph) paint.glyph = glyph;
  if (source.textDecoration !== NO_DECORATION) paint.decoration = source.textDecoration;
  return paint;
}

/** An inline element's paint, its inline ancestors' opacities and
 * backgrounds folded as nested groups (specs/cell-model.md "Opacity and
 * translucency"); `color` stands in for its own, a tint's. */
function inlinePaint(
  entries: InlineElement[],
  index: number,
  palette: Palette,
  base: TextFont,
  color = entries[index]!.color,
  emoji = false,
): CellPaint {
  const entry = entries[index]!;
  let paint = textPaint(entry, color, base);
  if (entry.backgroundColor !== undefined) paint.backgroundColor = entry.backgroundColor;
  // Each paint here is this call's own. The walk stops before reading
  // `entries[-1]`, a slow lookup.
  for (let i = index; i >= 0; i = entries[i]!.parent) {
    const { opacity, parent } = entries[i]!;
    if (opacity < 1) paint.opacity = (paint.opacity ?? 1) * opacity;
    const beneath = parent >= 0 ? entries[parent]!.backgroundColor : undefined;
    if (beneath !== undefined) paint = palette.composite(beneath, undefined, paint, 1, true, emoji);
  }
  return paint;
}

/** The paint's visitor (stacking.ts): each box's ink, a leaf's glyphs,
 * a table's lattice and a scroller's bars, put through the walk of the
 * group or layer they paint in, under the box's own clips. */
function painter(root: Walk, tree: LayoutNode): PaintVisitor {
  let walking = root;
  // Each open turn's scope, null for none, and the walk it opened in.
  const scopes: (Scope | null)[] = [];
  const outers: Walk[] = [];
  // Every table's lattice, resolved at the first table or part painted.
  let lattices: Map<LayoutNode, BorderRun[]> | null = null;
  const clipped = new Map<Clip, { base: PutGlyph; put: PutGlyph }>();
  /** The walk's put cut to a box's ink clip, made once per clip and walk. */
  const putOf = (node: LayoutNode): PutGlyph => {
    const clip = inkClip(node);
    if (!clip) return walking.put;
    let cut = clipped.get(clip);
    if (cut?.base !== walking.put) {
      clipped.set(clip, (cut = { base: walking.put, put: clipPut(walking.put, clip) }));
    }
    return cut.put;
  };
  // A leaf walks its glyphs once, at its first turn, holding its later turns'.
  const heldGlyphs = new Map<LayoutNode, [number, ...Parameters<PutGlyph>][]>();
  /** A leaf's glyphs of `member`'s turn, -1 its own, under its content clip. */
  const glyphs = (node: LayoutNode, member: number): void => {
    if (node.children.some(isInFlowBox)) return;
    const own = clipBounds(node, node.paintOrigin.x, node.paintOrigin.y);
    const put = clipPut(putOf(node), own);
    const held = heldGlyphs.get(node);
    if (held) {
      for (const [turn, ...args] of held) if (turn === member) put(...args);
      return;
    }
    const later: [number, ...Parameters<PutGlyph>][] = [];
    if (node.inlineMembers) heldGlyphs.set(node, later);
    paintText(node, walking, tree.style, (turn, x, y, glyph, paint, cells) => {
      if (turn === member) put(x, y, glyph, paint, cells);
      else later.push([turn, x, y, glyph, paint, cells]);
    });
  };
  return {
    enter(node) {
      const inline = inlineOpacity(node);
      const opacity = node.style.opacity * inline;
      // A layer root paints into a grid of its own, its opacity on the
      // box (specs/layers.md); any other box below 1 opacity paints as a
      // group.
      let scope: Scope | null = null;
      if (node.style.layer) {
        const { x, y } = node.paintOrigin;
        const box = { x, y, width: node.localRect.width, height: node.localRect.height };
        scope = openLayer(walking, node, box, node.paintClip ?? null, walking.alpha * inline);
      } else if (opacity < 1) scope = openGroup(walking, opacity);
      scopes.push(scope);
      outers.push(walking);
      if (scope) walking = scope.walking;
    },
    leave() {
      scopes.pop()?.close();
      walking = outers.pop()!;
    },
    box(node) {
      if (!lattices && (node.lattice || node.style.tableRole !== "none")) {
        resolveLattices(tree, (lattices = new Map()));
      }
      paintBox(node, putOf(node), walking);
    },
    lattice(node) {
      const runs = lattices?.get(node);
      if (runs && node.style.visible) {
        putRuns(putOf(node), runs, node.paintOrigin.x, node.paintOrigin.y);
      }
    },
    text: glyphs,
    marker(node) {
      const { style, marker } = node;
      if (!style.visible) return;
      const { x, y } = node.paintOrigin;
      const put = clipPut(putOf(node), clipBounds(node, x, y));
      // An inside marker takes the lines its item propagates, an outside one none.
      const font = {
        glyph: marker!.style.glyph,
        textDecoration: marker!.style.inside ? style.textDecoration : NO_DECORATION,
      };
      const paint = textPaint(font, marker!.style.color ?? style.color, tree.style);
      forEachMarkerCell(
        node,
        x - (node.scroll?.x ?? 0),
        y - (node.scroll?.y ?? 0),
        (k, length, at, row, advance) => {
          const cluster = marker!.text.slice(k, k + length);
          const cells = clusterWidth(cluster);
          if (cells === 0) return;
          put(at, row, cluster, paint, cells);
          if (paint.decoration) for (let c = cells; c < advance; c++) put(at + c, row, " ", paint);
        },
        (at, row) => put(at, row, "…", paint),
      );
    },
    bars(node) {
      paintBars(node, putOf(node));
    },
  };
}

/** Each shown collapsed table's lattice (lattice.ts), its own runs kept
 * in `lattices` and its parts' handed to them: all at once, as a part's
 * turn comes before its table's where it is a negative member. */
function resolveLattices(node: LayoutNode, lattices: Map<LayoutNode, BorderRun[]>): void {
  if (node.tableHidden || node.forceHidden) return;
  if (node.lattice) {
    const { x: absX, y: absY } = node.paintOrigin;
    const clip = inkClip(node);
    const lattice = resolveLattice(node, node.lattice, (x, y) => inClip(clip, absX + x, absY + y));
    for (const part of node.lattice.handed ?? []) delete part.latticeRuns;
    // The lattice is the table's ink, handed only while the table shows.
    node.lattice.handed = node.style.visible ? [...lattice.parts.keys()] : [];
    for (const part of node.lattice.handed) {
      const own = lattice.parts.get(part)!;
      part.latticeRuns = own.map((run) => ({ ...run, x: absX + run.x, y: absY + run.y }));
    }
    lattices.set(node, lattice.runs);
  }
  for (const child of node.children) resolveLattices(child, lattices);
}

/** Glyph runs in their colors, `dx`, `dy` from the grid's origin. */
function putRuns(put: PutGlyph, runs: readonly BorderRun[], dx = 0, dy = 0): void {
  for (const run of runs) {
    const paint = run.color === undefined ? undefined : { color: run.color };
    for (let i = 0; i < run.length; i++) put(dx + run.x + i, dy + run.y, run.glyph, paint);
  }
}

/** A box's own ink: its shadows, fill, borders and rules, a table part's
 * lattice lines. */
function paintBox(node: LayoutNode, put: PutGlyph, walking: Walk): void {
  const { x: absX, y: absY } = node.paintOrigin;
  const style = node.style;
  const { top, height } = node.tableBox ?? { top: 0, height: node.localRect.height };
  const box = { x: absX, y: absY + top, width: node.localRect.width, height };
  // A hidden box's own ink stays unpainted, its subtree walking on
  // (specs/visibility.md).
  const visible = style.visible;
  if (visible) {
    // Shadows (specs/box-shadow.md): the outer ones before the box's own
    // fill, behind it and over what painted before; the inset ones after
    // the fill, over its background and under its borders and text.
    const shadows = (inset: boolean): void => {
      const runs: BorderRun[] = [];
      collectShadowRuns(style, box, inset, runs);
      putRuns(put, runs);
    };
    shadows(false);
    // The box `background-clip` names fills with painted spaces,
    // `bg-clear` wiping the border box first; gradient layers fill a
    // color per cell over the plain color (specs/gradients.md), a
    // `text` clip's tint going to the glyphs instead.
    const { width } = box;
    const layers = style.backgroundImage;
    const fill = (paint: CellPaint, within: Insets): void => {
      for (let dy = within.top; dy < height - within.bottom; dy++) {
        for (let dx = within.left; dx < width - within.right; dx++) {
          put(box.x + dx, box.y + dy, " ", paint);
        }
      }
    };
    if (style.backgroundClear) fill(WIPE, zeroInsets());
    if (style.backgroundClip !== "text" && layers.length > 0) {
      const cellSize = walking.options.cell ?? DEFAULT_CELL;
      const colors = gradientCells(layers, style.backgroundColor, width, height, cellSize);
      const inset = backgroundInset(node);
      for (let dy = inset.top; dy < height - inset.bottom; dy++) {
        for (let dx = inset.left; dx < width - inset.right; dx++) {
          const color = colors[dy]![dx];
          if (color) put(box.x + dx, box.y + dy, " ", { backgroundColor: color, gradient: "fill" });
        }
      }
    } else if (style.backgroundClip !== "text" && style.backgroundColor !== undefined) {
      fill({ backgroundColor: style.backgroundColor }, backgroundInset(node));
    }
    shadows(true);

    const borderRuns: BorderRun[] = [];
    collectBorderRuns(style, box, borderRuns);
    putRuns(put, borderRuns);
    if (node.decorationRuns) putRuns(put, node.decorationRuns, absX, absY);
  }
  if (node.latticeRuns) putRuns(put, node.latticeRuns);
}

/** A leaf's glyphs through `put`, each with the glyph turn that paints
 * it (stacking.ts `glyphTurns`), -1 the leaf's own; `base` is the
 * host's text styling, which the grid inherits. */
function paintText(
  node: LayoutNode,
  walking: Walk,
  base: TextFont,
  put: (turn: number, ...args: Parameters<PutGlyph>) => void,
): void {
  const { options, palette } = walking;
  const { x: absX, y: absY } = node.paintOrigin;
  const style = node.style;
  const visible = style.visible;
  // Clipped to `text`, the background tints the glyphs (specs/gradients.md).
  const tint =
    visible &&
    style.backgroundClip === "text" &&
    (style.backgroundImage.length > 0 || style.backgroundColor !== undefined)
      ? gradientCells(
          style.backgroundImage,
          style.backgroundColor,
          node.localRect.width,
          node.localRect.height,
          options.cell ?? DEFAULT_CELL,
        )
      : null;
  const leaf = textPaint(style, style.color, base);
  const entries = node.inlineElements ?? [];
  const inlines = entries.map((_, index) => inlinePaint(entries, index, palette, base));
  const selection = options.selection?.get(node);
  const owners = node.inlineOwners;
  const paintCell = (
    k: number,
    length: number,
    x: number,
    y: number,
    index: number,
    selected: boolean,
    advance: number,
  ): void => {
    const turn = owners && index >= 0 ? owners[index]! : -1;
    // INLINE_PAD marks a blank inline-padding cell: no glyph, but
    // its element's background, alone, still fills it.
    if (node.text[k] === INLINE_PAD) {
      const pad = inlines[index];
      if (pad?.backgroundColor !== undefined) {
        put(turn, x, y, " ", { backgroundColor: pad.backgroundColor, opacity: pad.opacity });
      }
      return;
    }
    const cluster =
      node.text[k] === SOFT_HYPHEN
        ? "-"
        : length === 1
          ? node.text[k]!
          : node.text.slice(k, k + length);
    const cells = clusterWidth(cluster);
    if (cells === 0) return;
    // Clipped to `text`, a glyph's own color composites over the
    // background's at its cell (specs/gradients.md).
    const color = index >= 0 ? entries[index]!.color : style.color;
    const under = tint?.[y - absY]?.[x - absX];
    const tinted = under && color !== undefined ? palette.blend(color, 1, under) : color;
    // A color emoji keeps its color through its chain (inlinePaint).
    const emoji = index >= 0 && cells > 1 && isColorEmoji(cluster);
    let paint = index >= 0 ? inlines[index]! : leaf;
    if (tinted !== color || emoji) {
      paint =
        index >= 0
          ? inlinePaint(entries, index, palette, base, tinted, emoji)
          : textPaint(style, tinted, base);
      if (tinted !== color) paint = { ...paint, gradient: "text" };
    }
    const shown = selected ? { ...paint, selected: true as const } : paint;
    put(turn, x, y, cluster, shown, cells);
    // The cells past the glyph — tracking, a justified gap's share — are
    // its element's: its background, decoration and selection fill them.
    if (shown.backgroundColor === undefined && !shown.decoration && !shown.selected) return;
    for (let c = cells; c < advance; c++) put(turn, x + c, y, " ", shown, 1);
  };
  forEachLeafCell(
    node,
    absX - (node.scroll?.x ?? 0),
    absY - (node.scroll?.y ?? 0),
    (k, length, x, y, advance) => {
      const index = node.charInline?.[k] ?? -1;
      const entry = index >= 0 ? entries[index] : undefined;
      // An inline element's own visibility, else the leaf's: its cells
      // stay blank, their space kept.
      if (!(entry ? entry.visible : visible)) return;
      const selected = selection !== undefined && k >= selection.start && k < selection.end;
      paintCell(k, length, x, y, index, selected, advance);
    },
    (x, y) => {
      if (visible) put(-1, x, y, "…", leaf);
    },
  );
}

/** A scroll container's bars, over its content (specs/scrolling.md), the
 * corner cell of two bars blank. */
function paintBars(node: LayoutNode, put: PutGlyph): void {
  const range = node.scrollRange;
  const gutter = node.scrollGutterCells;
  const style = node.style;
  if (!style.visible || !range || !gutter || (gutter.right === 0 && gutter.bottom === 0)) return;
  const { track, thumb } = scrollGlyphs(glyphSetFor(style.glyphSet));
  // `scrollbar-color: auto` is the container's own color, as a border's.
  const trackPaint = barPaint(style.scrollbarColor?.track ?? style.color);
  const thumbPaint = barPaint(style.scrollbarColor?.thumb ?? style.color);
  const bars = scrollbarGeometry(node, node.paintOrigin.x, node.paintOrigin.y);
  for (const axis of ["y", "x"] as const) {
    const bar = bars[axis];
    if (!bar) continue;
    const vertical = axis === "y";
    const { at, len } = vertical
      ? thumbSpan(bar.len, range.sizeY, range.maxY, node.scroll?.y ?? 0)
      : thumbSpan(bar.len, range.sizeX, range.maxX, node.scroll?.x ?? 0);
    for (let across = 0; across < bar.thick; across++) {
      for (let i = 0; i < bar.len; i++) {
        const isThumb = i >= at && i < at + len;
        const x = bar.col + (vertical ? across : i);
        const y = bar.row + (vertical ? i : across);
        put(x, y, isThumb ? thumb : track, isThumb ? thumbPaint : trackPaint);
      }
    }
  }
}

/** A leaf laid out with no text. */
const NO_LINES = { spans: [], textY: [] };

/** The cells a leaf's text occupies: the per-line placement — the
 * lines its layout wrapped (a multicol leaf's fragmentation, else
 * `lines`), first-line indent, alignment, truncation, inline shifts,
 * per-character advances — in ONE place, so mapping a cell back to a
 * character (charIndexAtCell) cannot drift from the paint. `absX/absY`
 * is the leaf's border-box origin with its own scroll applied; U+FFFC
 * markers are skipped (their boxes paint themselves). Visits are per
 * CLUSTER: `index` is its first code unit, `length` its code units
 * (the following 0-advance units ride along, a 0-width cluster with
 * the cluster before it), `advance` its cells with tracking; the text
 * a truncation cuts is visited too where `truncates` is false. */
function forEachLeafCell(
  node: LayoutNode,
  absX: number,
  absY: number,
  onChar: (index: number, length: number, x: number, y: number, advance: number) => void,
  onEllipsis?: (x: number, y: number) => void,
  truncates = true,
): void {
  const style = node.style;
  const origin = contentOrigin(node);
  const contentX = absX + origin.x;
  const contentY = absY + origin.y;
  const contentWidth = node.localRect.width - edges(style.border, node.resolvedPadding, "x");
  const { spans, textY } = node.multicolGeometry ?? node.lines ?? NO_LINES;
  const clamped = node.lines?.clamped === true;
  // Only an inline member and what it holds shift.
  const { inlineElements: entries, inlineMembers } = node;
  const shifts = inlineMembers && entries?.map((_, index) => inlineShift(entries, index));
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;
    const row = contentY + textY[i]!;
    // The truncation acts within the line's width past its indent.
    const full = lineStart(node, i, span, contentWidth);
    const clamp = clamped && i === spans.length - 1;
    const truncated =
      truncates && truncatesLine(node, clamp)
        ? truncateSpan(node.text, span, full.width - full.indent, node.advances, style, clamp)
        : { end: span.end, ellipsis: false };
    const advances = node.advances;
    // A clamped line is placed as the text it keeps and its ellipsis,
    // unspread and unhyphenated.
    const line = clamp
      ? {
          ...lineStart(
            node,
            i,
            span,
            contentWidth,
            lineAdvance(node.text, span.start, truncated.end, advances, style.tracking) +
              (truncated.ellipsis ? 1 : 0),
          ),
          spread: undefined,
        }
      : full;
    let x = contentX + line.x + (line.spread ? spreadBefore(line.spread, line.spread.before) : 0);
    let gap = line.spread?.before ?? 0;
    // A soft hyphen shows as a cell's `-` where its line breaks.
    const hyphen =
      !clamp && truncated.end === span.end && showsHyphen(node.text, span.end) ? span.end - 1 : -1;
    for (let k = span.start; k < truncated.end;) {
      const advance = k === hyphen ? 1 : advanceOf(k, k + 1, advances);
      let length = 1;
      // A cluster's later units ride its first; a `<wbr>` is none of them.
      if (advances) {
        while (
          k + length < truncated.end &&
          advances[k + length] === 0 &&
          k + length !== hyphen &&
          node.text[k + length] !== WBR_MARKER
        )
          length++;
      }
      // A justified gap's cells are its own.
      const cells =
        advance + (line.spread && isGap(node.text[k]) ? gapShare(line.spread, gap++) : 0);
      if (node.text[k] !== OBJECT_REPLACEMENT && advance > 0) {
        const inline = node.charInline?.[k] ?? -1;
        const shift = shifts && inline >= 0 ? shifts[inline] : undefined;
        onChar(k, length, x + (shift?.x ?? 0), row + (shift?.y ?? 0), cells);
      }
      x += cells;
      k += length;
    }
    if (truncated.ellipsis) onEllipsis?.(x, row);
  }
}

/** Whether a leaf's line truncates: a clamp's last, or any where its
 * text never wraps and its box clips it. */
const truncatesLine = (node: LayoutNode, clamp: boolean): boolean =>
  clamp || (!softWraps(node.style.whiteSpace) && clipsAxis(node.style.overflow.x));

/** A marker's cells (specs/lists.md), visited per cluster as a leaf's
 * are: an outside one's where its item's layout put it; an inside one's
 * before its leaf's first line, spread with it, and cut as its text is
 * (its `text-overflow`) where the line truncates in less room past its
 * `text-indent` than the marker needs. */
export function forEachMarkerCell(
  node: LayoutNode,
  absX: number,
  absY: number,
  onCluster: (index: number, length: number, x: number, y: number, advance: number) => void,
  onEllipsis?: (x: number, y: number) => void,
): void {
  const marker = node.marker;
  if (!marker) return;
  let x = absX + (marker.x ?? 0);
  let y = absY + (marker.y ?? 0);
  let spread: Spread | undefined;
  let room = Infinity;
  if (marker.style.inside) {
    const line = firstLineStart(node);
    if (!line) return;
    const origin = contentOrigin(node);
    x = absX + origin.x + line.x - marker.width;
    y = absY + origin.y + line.row;
    spread = line.spread;
    if (truncatesLine(node, false)) room = line.width - line.indent + marker.width;
  }
  const cut = room < marker.width;
  const ellipsis = cut && node.style.textOverflow === "ellipsis" && room > 0;
  const limit = cut ? room - (ellipsis ? 1 : 0) : Infinity;
  const { text, advances } = marker;
  let used = 0;
  let gap = 0;
  for (let k = 0; k < text.length;) {
    let length = 1;
    while (k + length < text.length && advances[k + length] === 0) length++;
    const advance = advances[k]!;
    if (used + advance > limit) break;
    const cells = advance + (spread && isGap(text[k]) ? gapShare(spread, gap++) : 0);
    onCluster(k, length, x, y, cells);
    x += cells;
    used += advance;
    k += length;
  }
  if (ellipsis) onEllipsis?.(x, y);
}

/** Whether a marker's cells hold one `test` takes, where its node paints. */
function someMarkerCell(node: LayoutNode, test: (x: number, y: number) => boolean): boolean {
  const { x, y } = node.paintOrigin;
  let found = false;
  forEachMarkerCell(
    node,
    x - (node.scroll?.x ?? 0),
    y - (node.scroll?.y ?? 0),
    (_index, _length, at, row, advance) => {
      for (let c = 0; c < advance; c++) found ||= test(at + c, row);
    },
    (at, row) => {
      found ||= test(at, row);
    },
  );
  return found;
}

/** Whether a marker's cells cover a cell, for the hit. */
export const markerCovers = (node: LayoutNode, col: number, row: number): boolean =>
  someMarkerCell(node, (x, y) => x === col && y === row);

/** Whether the grid shows any of a marker's cells: inside its node's
 * clips and right of the host's edge. */
export function markerShows(node: LayoutNode): boolean {
  const { x, y } = node.paintOrigin;
  const own = clipBounds(node, x, y);
  const clip = inkClip(node);
  return someMarkerCell(
    node,
    (col, row) => col >= 0 && inClip(clip, col, row) && inClip(own, col, row),
  );
}

/** An inline element's shift in whole cells, its inline ancestors'
 * added: each relative one's insets, the over-constrained sides
 * resolving like CSS (top/left win; specs/positioning.md), and each
 * sticky one's for the scroll (specs/sticky.md). */
export function inlineShift(entries: InlineElement[], index: number): { x: number; y: number } {
  const shift = { x: 0, y: 0 };
  for (let i = index; i >= 0; i = entries[i]!.parent) {
    const { insets, stickyShift } = entries[i]!;
    if (insets) {
      shift.x += insets.left ?? (insets.right !== null ? -insets.right : 0);
      shift.y += insets.top ?? (insets.bottom !== null ? -insets.bottom : 0);
    }
    shift.x += stickyShift?.x ?? 0;
    shift.y += stickyShift?.y ?? 0;
  }
  return shift;
}

/** The cells a clipping container's content shows through, in
 * absolute cells (specs/scrolling.md): its padding box on each
 * clipping axis, the gutter excluded, unbounded on a visible axis;
 * null for a container clipping neither. The paint and the hit cut
 * the content here. */
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
  const origin = contentOrigin(node);
  const x = col - (absX + origin.x);
  const y = row - (absY + origin.y);
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
 * null for a blank cell (specs/semantic-selection.md): the one painted
 * last there, or in the glyph turn `member` alone where it is given
 * (stacking.ts `glyphTurns`). `absX/absY` is the leaf's border-box
 * origin, its `paintOrigin` for the paint's. */
export function charIndexAtCell(
  node: LayoutNode,
  absX: number,
  absY: number,
  col: number,
  row: number,
  member?: number,
): number | null {
  const owners = node.inlineOwners;
  const turns = member === undefined ? glyphTurns(node) : [member];
  let found: number | null = null;
  let latest = -1;
  forEachLeafCell(
    node,
    absX - (node.scroll?.x ?? 0),
    absY - (node.scroll?.y ?? 0),
    (k, _length, x, y, advance) => {
      if (y !== row || col < x || col >= x + advance) return;
      const inline = node.charInline?.[k] ?? -1;
      const turn = turns.indexOf(owners && inline >= 0 ? owners[inline]! : -1);
      if (turn > latest) {
        found = k;
        latest = turn;
      }
    },
  );
  return found;
}

/** The cells a leaf's inline elements cover, one rect per element per
 * row — the span of its characters and pad cells there, an outer
 * element's including its inline descendants' — in run order then row
 * order, elements without a cell left out (specs/focus-navigation.md).
 * `absX/absY` as for charIndexAtCell; `truncates` as for forEachLeafCell. */
export function inlineElementRects(
  node: LayoutNode,
  absX: number,
  absY: number,
  truncates = true,
): { element: Element; rect: Rect }[] {
  const entries = node.inlineElements;
  if (!entries || !node.charInline) return [];
  // Each entry's own index plus the indices of the entries containing
  // it: a character belongs to its innermost element and every ancestor,
  // a pseudo-element's to its element alone, whose rects hold it.
  const owners = entries.map((entry, i) =>
    entries.flatMap((outer, j) =>
      !outer.pseudo && (j === i || outer.element.contains(entry.element)) ? [j] : [],
    ),
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
    undefined,
    truncates,
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
interface Scrollbar {
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
 * ellipsis` is set (the ellipsis reserves one cell). A `clamp`'s last
 * line ends in `…` whether or not it overflows.
 */
function truncateSpan(
  text: string,
  span: LineSpan,
  contentWidth: number,
  advances: number[] | undefined,
  style: LayoutNode["style"],
  clamp = false,
): { end: number; ellipsis: boolean } {
  const { tracking } = style;
  if (!clamp && lineAdvance(text, span.start, span.end, advances, tracking) <= contentWidth) {
    return { end: span.end, ellipsis: false };
  }
  const ellipsis = clamp || style.textOverflow === "ellipsis";
  const limit = ellipsis ? contentWidth - 1 : contentWidth;
  let end = span.start;
  while (end < span.end && lineAdvance(text, span.start, end + 1, advances, tracking) <= limit)
    end++;
  return { end, ellipsis: ellipsis && contentWidth > 0 };
}
