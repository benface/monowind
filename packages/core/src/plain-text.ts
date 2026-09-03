import { collectBorderRuns, paintOrderedChildren } from "./borders.ts";
import type { BorderRun } from "./borders.ts";
import { leafLineGeometry } from "./layout.ts";
import { glyphSetFor, scrollGlyphs } from "./glyphs.ts";
import { advanceOf, INLINE_PAD, lineAdvance, OBJECT_REPLACEMENT } from "./wrap.ts";
import type { LineSpan } from "./wrap.ts";
import type { LayoutNode } from "./types.ts";

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
 */
export function renderPlainText(root: LayoutNode): string {
  return renderGrids(root)
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
}

/** One row of same-paint runs. Joining every segment's text reproduces
 * the `renderPlainText` row, so a copy from the DOM adapter (paint.ts)
 * still yields the pure text. */
export interface CellSegment extends CellPaint {
  text: string;
}

/** Row-major cell segments. Each row is `rowSegments(grid[y],
 * paints[y])` — the DOM adapter (paint.ts) uses this, and tests
 * assert paint fields against it. */
export function renderCellSegments(root: LayoutNode): CellSegment[][] {
  const { grid, paints } = renderGrids(root);
  return grid.map((row, y) => rowSegments(row, paints[y]!));
}

/** One rendered row → its same-paint runs. Trims the blank tail so it
 * doesn't emit useless spans — but a trailing space with a painted
 * BACKGROUND is visible ink (a borderless focus-invert fill is nothing
 * but spaces) and must stay. Painted spaces INSIDE a run stay too
 * (underline spans an inline run's inner spaces). */
function rowSegments(row: string[], paints: (CellPaint | undefined)[]): CellSegment[] {
  let end = row.length;
  while (end > 0 && row[end - 1] === " " && paints[end - 1]?.backgroundColor === undefined) end--;
  const segments: CellSegment[] = [];
  for (let x = 0; x < end; x++) {
    const paint = paints[x];
    const last = segments[segments.length - 1];
    if (last && samePaint(last, paint)) last.text += row[x]!;
    else segments.push({ text: row[x]!, ...paint });
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
    a.opacity === b?.opacity
  );
}

/** Apply a `CellPaint` to a `CSSStyleDeclaration`. Kept in this file
 * alongside samePaint / textPaint so the paint schema has one home. */
export function applyCellPaint(paint: CellPaint, style: CSSStyleDeclaration): void {
  if (paint.color !== undefined) style.color = paint.color;
  if (paint.backgroundColor !== undefined) style.backgroundColor = paint.backgroundColor;
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
    paint.opacity === undefined
  );
}

function renderGrids(root: LayoutNode): {
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
  walk(root, 0, 0, (x, y, glyph, paint) => {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      grid[y]![x] = glyph;
      // Merge paints per field: a later glyph over an earlier fill
      // keeps the fill's fields (bg-fill's backgroundColor survives
      // when text paints its color on top). Same-field overlaps still
      // last-wins.
      const existing = paints[y]![x];
      paints[y]![x] = existing ? { ...existing, ...paint } : paint;
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

type PutGlyph = (x: number, y: number, glyph: string, paint: CellPaint | undefined) => void;

function walk(
  node: LayoutNode,
  parentAbsX: number,
  parentAbsY: number,
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
  const padding = node.resolvedPadding;
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
    contentPut = (x, y, glyph, paint) => {
      if (clipsX && (x < x0 || x >= x1)) return;
      if (clipsY && (y < y0 || y >= y1)) return;
      put(x, y, glyph, paint);
    };
  }

  const hasInFlowChildren = node.children.some(
    (child) =>
      !child.inlineBox && child.style.position !== "absolute" && child.style.position !== "fixed",
  );
  if (!hasInFlowChildren && node.text) {
    const contentX = scrolledX + style.border.left + padding.left;
    const contentY = scrolledY + style.border.top + padding.top;
    const contentWidth =
      node.localRect.width - style.border.left - style.border.right - padding.left - padding.right;
    // A multicol leaf paints its layout-computed fragmentation (line →
    // column map); other leaves recompute the single-column geometry.
    const multicol = node.multicolGeometry;
    const { spans, textY } = multicol ?? leafLineGeometry(node, contentWidth);
    // Alignment and truncation act within one column of a multicol leaf,
    // against the tracked wrap width — the browser's own alignment
    // includes the trailing letter-spacing gap, so the engine ends lines
    // at `width − tracking` to sit under it.
    const alignWidth = multicol ? Math.max(1, multicol.columnWidth - style.tracking) : contentWidth;
    const leafPaint = alphaPaint(textPaint(style));
    const inlinePaints = node.inlineElements?.map((entry) => alphaPaint(textPaint(entry)));
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      const row = contentY + textY[i]!;
      // First-line indent: reduces usable width for truncation and
      // alignment, and shifts the paint origin by the same amount (per
      // CSS, `<br>` doesn't re-indent, so only spans[0] is charged).
      const indent = i === 0 ? style.textIndent : 0;
      const truncated =
        style.whiteSpace !== "normal" && style.overflow.x === "clip"
          ? truncateSpan(node.text, span, alignWidth - indent, node.advances, style)
          : { end: span.end, ellipsis: false };
      // Each character advances by its own cell count (tracking gaps).
      // `text-align: end` offsets each line to the content box's right
      // edge; `center` to floor((W − line) / 2). Whole cells; a line
      // at or over the width stays at start, matching truncation.
      const lineWidth = lineAdvance(span.start, span.end, node.advances, style.tracking);
      const leftover = Math.max(0, alignWidth - indent - lineWidth);
      const alignOffset =
        style.textAlign === "end"
          ? leftover
          : style.textAlign === "center"
            ? Math.floor(leftover / 2)
            : 0;
      let x = contentX + (multicol?.lineX[i] ?? 0) + alignOffset + indent;
      for (let k = span.start; k < truncated.end; k++) {
        // U+FFFC marks an embedded inline box (its cells are drawn by
        // the box's own walk). INLINE_PAD marks a blank inline-padding
        // cell: no glyph, but its element's background still fills it.
        if (node.text[k] !== OBJECT_REPLACEMENT) {
          const inlineIndex = node.charInline?.[k] ?? -1;
          const entry = inlineIndex >= 0 ? node.inlineElements![inlineIndex] : undefined;
          // Inline relative shifts, whole cells (specs/positioning.md):
          // the over-constrained sides resolve like CSS (top/left win).
          const insets = entry?.insets;
          const dx = insets ? (insets.left ?? (insets.right !== null ? -insets.right : 0)) : 0;
          const dy = insets ? (insets.top ?? (insets.bottom !== null ? -insets.bottom : 0)) : 0;
          if (node.text[k] === INLINE_PAD) {
            if (entry?.backgroundColor) {
              contentPut(
                x + dx,
                row + dy,
                " ",
                alphaPaint({ backgroundColor: entry.backgroundColor }),
              );
            }
          } else {
            contentPut(
              x + dx,
              row + dy,
              node.text[k]!,
              entry ? inlinePaints![inlineIndex] : leafPaint,
            );
          }
        }
        x += advanceOf(k, k + 1, node.advances);
      }
      if (truncated.ellipsis) contentPut(x, row, "…", leafPaint);
    }
  }

  for (const child of paintOrderedChildren(node)) {
    walk(child, scrolledX, scrolledY, contentPut, alpha * child.style.opacity);
  }

  // Scrollbars last, over content (specs/scrolling.md): every
  // reserved gutter paints track + thumb (full-length when nothing
  // overflows — the `scroll` case; an `auto` gutter exists only with
  // overflow). The shared corner cell of two bars stays blank.
  const range = node.scrollRange;
  if (range && gutter && (gutter.right > 0 || gutter.bottom > 0)) {
    const { track, thumb } = scrollGlyphs(glyphSetFor(style.glyphSet));
    const innerTop = absY + style.border.top;
    const innerLeft = absX + style.border.left;
    const innerBottom = absY + node.localRect.height - style.border.bottom;
    const innerRight = absX + node.localRect.width - style.border.right;
    // `scrollbar-color: auto` means the container's own color (its
    // currentColor, like borders) — not the inherited grid default.
    const barPaint = (color: string | undefined): CellPaint | undefined =>
      alphaPaint(color ? { color } : undefined);
    const trackPaint = barPaint(style.scrollbarColor?.track ?? style.color);
    const thumbPaint = barPaint(style.scrollbarColor?.thumb ?? style.color);
    if (gutter.right > 0) {
      const trackLen = innerBottom - innerTop - gutter.bottom;
      const { at: thumbAt, len: thumbLen } = thumbSpan(
        trackLen,
        range.sizeY,
        range.maxY,
        node.scroll?.y ?? 0,
      );
      for (let dx = 0; dx < gutter.right; dx++) {
        const x = innerRight - gutter.right + dx;
        for (let i = 0; i < trackLen; i++) {
          const isThumb = i >= thumbAt && i < thumbAt + thumbLen;
          put(x, innerTop + i, isThumb ? thumb : track, isThumb ? thumbPaint : trackPaint);
        }
      }
    }
    if (gutter.bottom > 0) {
      const trackLen = innerRight - innerLeft - gutter.right;
      const { at: thumbAt, len: thumbLen } = thumbSpan(
        trackLen,
        range.sizeX,
        range.maxX,
        node.scroll?.x ?? 0,
      );
      for (let dy = 0; dy < gutter.bottom; dy++) {
        const y = innerBottom - gutter.bottom + dy;
        for (let i = 0; i < trackLen; i++) {
          const isThumb = i >= thumbAt && i < thumbAt + thumbLen;
          put(innerLeft + i, y, isThumb ? thumb : track, isThumb ? thumbPaint : trackPaint);
        }
      }
    }
  }
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
  if (lineAdvance(span.start, span.end, advances, tracking) <= contentWidth) {
    return { end: span.end, ellipsis: false };
  }
  const limit = textOverflow === "ellipsis" ? contentWidth - 1 : contentWidth;
  let end = span.start;
  while (end < span.end && lineAdvance(span.start, end + 1, advances, tracking) <= limit) end++;
  return { end, ellipsis: textOverflow === "ellipsis" && contentWidth > 0 };
}
