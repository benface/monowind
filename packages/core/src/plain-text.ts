import { collectBorderRuns, paintOrderedChildren } from "./borders.ts";
import type { BorderRun } from "./borders.ts";
import { leafLineGeometry } from "./layout.ts";
import { glyphSetFor, scrollGlyphs } from "./glyphs.ts";
import { advanceOf, INLINE_PAD, lineAdvance, OBJECT_REPLACEMENT } from "./wrap.ts";
import type { LineSpan } from "./wrap.ts";
import type { LayoutNode, Rect } from "./types.ts";
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
  return renderGrids(root, {})
    .grid.map((row) => row.join("").trimEnd())
    .join("\n");
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
}

/** Row-major cell segments. Each row is `rowSegments(grid[y],
 * paints[y])` — the DOM adapter (paint.ts) uses this, and tests
 * assert paint fields against it. */
export function renderCellSegments(root: LayoutNode, options: RenderOptions = {}): CellSegment[][] {
  return renderGridRows(root, options).segments;
}

/** The segments plus the cell strings they were built from — the cell ↔
 * code-unit map a row needs once a cluster spans cells or code units. */
export function renderGridRows(
  root: LayoutNode,
  options: RenderOptions = {},
): { segments: CellSegment[][]; cells: string[][] } {
  const { grid, paints } = renderGrids(root, options);
  return {
    segments: grid.map((row, y) => rowSegments(row, paints[y]!, options.boxed)),
    cells: grid,
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
  for (let x = 0; x < row.length; x++) {
    const cell = row[x]!;
    if (cell === "") continue;
    const paint = paints[x];
    let cells = 1;
    while (row[x + cells] === "") cells++;
    if (boxed && (cell.length > 1 || cell.charCodeAt(0) >= 0x80) && boxed(cell, cells, paint)) {
      segments.push({ text: cell, cells, box: true, ...paint });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last && !last.box && samePaint(last, paint)) last.text += cell;
    else segments.push({ text: cell, ...paint });
  }
  return segments;
}

export function samePaint(a: CellPaint, b: CellPaint | undefined): boolean {
  return (
    a.color === b?.color &&
    a.backgroundColor === b?.backgroundColor &&
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
  }
  if (paint.fontWeight !== undefined) style.fontWeight = paint.fontWeight;
  if (paint.fontStyle !== undefined) style.fontStyle = paint.fontStyle;
  if (paint.textDecorationLine !== undefined) style.textDecoration = paint.textDecorationLine;
  if (paint.opacity !== undefined) style.opacity = paint.opacity;
}

/** True when a segment carries no paint — the DOM adapter emits a bare
 * text node for these instead of an empty <span>. */
export function isBarePaint(paint: CellPaint): boolean {
  return (
    paint.color === undefined &&
    paint.backgroundColor === undefined &&
    paint.fontWeight === undefined &&
    paint.fontStyle === undefined &&
    paint.textDecorationLine === undefined &&
    paint.opacity === undefined &&
    paint.selected === undefined
  );
}

function renderGrids(
  root: LayoutNode,
  options: RenderOptions,
): {
  grid: string[][];
  paints: (CellPaint | undefined)[][];
} {
  const width = Math.max(0, root.localRect.width);
  const height = Math.max(0, root.localRect.height);
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => " "),
  );
  const paints: (CellPaint | undefined)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, (): CellPaint | undefined => undefined),
  );
  // The wide cluster owning each cell, so a later paint on any of its
  // cells blanks the rest — a half-overwritten wide character is
  // spaces, as in a terminal.
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
    // Merge paints per field: a later glyph over an earlier fill
    // keeps the fill's fields (bg-fill's backgroundColor survives
    // when text paints its color on top). Same-field overlaps still
    // last-wins.
    const existing = paints[y]![x];
    paints[y]![x] = existing ? { ...existing, ...paint } : paint;
  };
  walk(root, 0, 0, options, (x, y, glyph, paint, cells = 1) => {
    if (y < 0 || y >= height) return;
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
  });
  return { grid, paints };
}

/** Non-default text styling only, so unstyled runs stay bare.
 * `backgroundColor` rides along for INLINE elements (a leaf's own bg
 * paints via the border-box fill instead). */
function textPaint(source: {
  color: string | undefined;
  backgroundColor?: string | undefined;
  fontWeight: string;
  fontStyle: string;
  textDecorationLine: string;
}): CellPaint {
  const paint: CellPaint = {};
  if (source.color) paint.color = source.color;
  if (source.backgroundColor) paint.backgroundColor = source.backgroundColor;
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
  options: RenderOptions,
  put: PutGlyph,
  alpha = 1,
): void {
  if (node.tableHidden) return;
  const absX = parentAbsX + node.localRect.x;
  const absY = parentAbsY + node.localRect.y;
  const style = node.style;
  // Effective opacity (specs/cell-model.md "Opacity"): ancestors
  // multiply (CSS nests, it doesn't inherit) and the value rides on
  // every paint this node produces — including an opacity of 0, whose
  // glyphs must stay in the grid for select="grid" selection.
  const alphaPaint = (paint: CellPaint | undefined): CellPaint | undefined =>
    alpha >= 1 ? paint : { ...paint, opacity: String(Math.round(alpha * 1000) / 1000) };

  // Fill the border-box with painted spaces so this element's bg
  // wipes ancestor decoration glyphs at these cells; own borders /
  // text / decoration paint after and layer on top. `bg-clear` runs
  // the same fill without a visible color.
  if (style.backgroundColor !== undefined || style.backgroundClear) {
    // bg-clear fills with an EXPLICIT undefined so the merge in put()
    // strips the cell's painted background too — the wipe covers
    // ancestor backgrounds, not just their glyphs.
    const fillPaint: CellPaint | undefined =
      style.backgroundColor !== undefined
        ? alphaPaint({ backgroundColor: style.backgroundColor })
        : { backgroundColor: undefined };
    for (let dy = 0; dy < node.localRect.height; dy++) {
      for (let dx = 0; dx < node.localRect.width; dx++) {
        put(absX + dx, absY + dy, " ", fillPaint);
      }
    }
  }

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

  // Overflow (specs/scrolling.md): a clipping/scrolling axis culls the
  // node's CONTENT ink (text and children — own decorations paint
  // unclipped) at the PADDING box, per CSS: padding cells sit blank at
  // the scroll extremes but content flows through them mid-scroll. A
  // reserved gutter cell stays excluded (the bar owns it). Nested
  // containers compose: the wrapped put chains to the parent's.
  const gutter = node.scrollGutterCells;
  const clipsX = style.overflow.x !== "visible";
  const clipsY = style.overflow.y !== "visible";
  const scrolledX = absX - (node.scroll?.x ?? 0);
  const scrolledY = absY - (node.scroll?.y ?? 0);
  let contentPut = put;
  if (clipsX || clipsY) {
    const x0 = absX + style.border.left;
    const y0 = absY + style.border.top;
    const x1 = absX + node.localRect.width - style.border.right - (gutter?.right ?? 0);
    const y1 = absY + node.localRect.height - style.border.bottom - (gutter?.bottom ?? 0);
    const clipped = (x: number, y: number) =>
      (clipsX && (x < x0 || x >= x1)) || (clipsY && (y < y0 || y >= y1));
    contentPut = (x, y, glyph, paint, cells = 1) => {
      if (cells === 1) {
        if (!clipped(x, y)) put(x, y, glyph, paint);
        return;
      }
      // A cluster cut by the clip edge is blanked, its visible cells
      // as spaces.
      let whole = true;
      for (let dx = 0; dx < cells; dx++) if (clipped(x + dx, y)) whole = false;
      if (whole) put(x, y, glyph, paint, cells);
      else for (let dx = 0; dx < cells; dx++) if (!clipped(x + dx, y)) put(x + dx, y, " ", paint);
    };
  }

  const hasInFlowChildren = node.children.some(
    (child) =>
      !child.inlineBox && child.style.position !== "absolute" && child.style.position !== "fixed",
  );
  if (!hasInFlowChildren && node.text) {
    const leafPaint = alphaPaint(textPaint(style));
    const inlinePaints = node.inlineElements?.map((entry) => alphaPaint(textPaint(entry)));
    const selection = options.selection?.get(node);
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
        if (cells > 0) contentPut(x, y, cluster, paint, cells);
      },
      (x, y) => contentPut(x, y, "…", leafPaint),
    );
  }

  for (const child of paintOrderedChildren(node)) {
    walk(child, scrolledX, scrolledY, options, contentPut, alpha * child.style.opacity);
  }

  // Scrollbars last, over content (specs/scrolling.md): every
  // reserved gutter paints track + thumb (full-length when nothing
  // overflows — the `scroll` case; an `auto` gutter exists only with
  // overflow). The shared corner cell of two bars stays blank.
  const range = node.scrollRange;
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
    // First-line indent reduces the usable width and shifts the origin
    // (per CSS, `<br>` doesn't re-indent, so only spans[0] is charged).
    const indent = i === 0 ? style.textIndent : 0;
    const truncated =
      style.whiteSpace !== "normal" && style.overflow.x === "clip"
        ? truncateSpan(node.text, span, alignWidth - indent, node.advances, style)
        : { end: span.end, ellipsis: false };
    // `text-align: end` offsets each line to the content box's right
    // edge; `center` to floor((W − line) / 2). Whole cells; a line at
    // or over the width stays at start, matching truncation.
    const lineWidth = lineAdvance(node.text, span.start, span.end, node.advances, style.tracking);
    const leftover = Math.max(0, alignWidth - indent - lineWidth);
    const alignOffset =
      style.textAlign === "end"
        ? leftover
        : style.textAlign === "center"
          ? Math.floor(leftover / 2)
          : 0;
    let x = contentX + (multicol?.lineX[i] ?? 0) + alignOffset + indent;
    const advances = node.advances;
    for (let k = span.start; k < truncated.end;) {
      const advance = advanceOf(k, k + 1, advances);
      let length = 1;
      if (advances) while (k + length < truncated.end && advances[k + length] === 0) length++;
      if (node.text[k] !== OBJECT_REPLACEMENT && advance > 0) {
        // Inline relative shifts, whole cells (specs/positioning.md):
        // the over-constrained sides resolve like CSS (top/left win).
        const insets = node.inlineElements?.[node.charInline?.[k] ?? -1]?.insets;
        const dx = insets ? (insets.left ?? (insets.right !== null ? -insets.right : 0)) : 0;
        const dy = insets ? (insets.top ?? (insets.bottom !== null ? -insets.bottom : 0)) : 0;
        onChar(k, length, x + dx, row + dy, advance);
      }
      x += advance;
      k += length;
    }
    if (truncated.ellipsis) onEllipsis?.(x, row);
  }
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
      if (found === null && y === row && col >= x && col < x + advance) found = k;
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
