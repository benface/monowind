import { collectBorderRuns, paintOrderedChildren } from "./borders.ts";
import type { BorderRun } from "./borders.ts";
import { leafLineGeometry } from "./layout.ts";
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
 * Content that overflows the root box is clipped at the grid edges.
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
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecorationLine?: string;
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

/** One rendered row → its same-paint runs. Trims trailing whitespace so
 * blank tails don't emit empty painted spans; painted spaces INSIDE a
 * run stay (underline/line-through spans an inline run's inner spaces —
 * filler cells carry no paint and split naturally). */
function rowSegments(row: string[], paints: (CellPaint | undefined)[]): CellSegment[] {
  const trimmed = row.join("").trimEnd();
  const segments: CellSegment[] = [];
  for (let x = 0; x < trimmed.length; x++) {
    const paint = paints[x];
    const last = segments[segments.length - 1];
    if (last && samePaint(last, paint)) last.text += trimmed[x]!;
    else segments.push({ text: trimmed[x]!, ...paint });
  }
  return segments;
}

function samePaint(a: CellPaint, b: CellPaint | undefined): boolean {
  return (
    a.color === b?.color &&
    a.backgroundColor === b?.backgroundColor &&
    a.fontWeight === b?.fontWeight &&
    a.fontStyle === b?.fontStyle &&
    a.textDecorationLine === b?.textDecorationLine
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
}

/** True when a segment carries no paint — the DOM adapter emits a bare
 * text node for these instead of an empty <span>. */
export function isBarePaint(paint: CellPaint): boolean {
  return (
    paint.color === undefined &&
    paint.backgroundColor === undefined &&
    paint.fontWeight === undefined &&
    paint.fontStyle === undefined &&
    paint.textDecorationLine === undefined
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

/** Non-default text styling only, so unstyled runs stay bare. */
function textPaint(source: {
  color: string | undefined;
  fontWeight: string;
  fontStyle: string;
  textDecorationLine: string;
}): CellPaint {
  const paint: CellPaint = {};
  if (source.color) paint.color = source.color;
  if (source.fontWeight !== "400" && source.fontWeight !== "normal" && source.fontWeight !== "")
    paint.fontWeight = source.fontWeight;
  if (source.fontStyle !== "normal" && source.fontStyle !== "") paint.fontStyle = source.fontStyle;
  if (source.textDecorationLine !== "none" && source.textDecorationLine !== "")
    paint.textDecorationLine = source.textDecorationLine;
  return paint;
}

type PutGlyph = (x: number, y: number, glyph: string, paint: CellPaint | undefined) => void;

function walk(node: LayoutNode, parentAbsX: number, parentAbsY: number, put: PutGlyph): void {
  if (node.tableHidden) return;
  const absX = parentAbsX + node.localRect.x;
  const absY = parentAbsY + node.localRect.y;
  const style = node.style;

  // Fill the border-box with painted spaces so this element's bg
  // wipes ancestor decoration glyphs at these cells; own borders /
  // text / decoration paint after and layer on top. `bg-clear` runs
  // the same fill without a visible color.
  if (style.backgroundColor !== undefined || style.backgroundClear) {
    const fillPaint: CellPaint | undefined =
      style.backgroundColor !== undefined ? { backgroundColor: style.backgroundColor } : undefined;
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
    const paint = run.color === undefined ? undefined : { color: run.color };
    for (let i = 0; i < run.length; i++) put(run.x + i, run.y, run.glyph, paint);
  }
  if (node.decorationRuns) {
    for (const run of node.decorationRuns) {
      const paint = run.color === undefined ? undefined : { color: run.color };
      for (let i = 0; i < run.length; i++) put(absX + run.x + i, absY + run.y, run.glyph, paint);
    }
  }

  const hasInFlowChildren = node.children.some(
    (child) =>
      !child.inlineBox && child.style.position !== "absolute" && child.style.position !== "fixed",
  );
  if (!hasInFlowChildren && node.text) {
    const padding = node.resolvedPadding;
    const contentX = absX + style.border.left + padding.left;
    const contentY = absY + style.border.top + padding.top;
    const contentWidth =
      node.localRect.width - style.border.left - style.border.right - padding.left - padding.right;
    const { spans, textY } = leafLineGeometry(node, contentWidth);
    const leafPaint = textPaint(style);
    const inlinePaints = node.inlineElements?.map((entry) => textPaint(entry));
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      const row = contentY + textY[i]!;
      const truncated =
        style.whiteSpace !== "normal" && style.overflow === "clip"
          ? truncateSpan(node.text, span, contentWidth, node.advances, style)
          : { end: span.end, ellipsis: false };
      // Each character advances by its own cell count (tracking gaps).
      // `text-align: end` offsets each line to the content box's right
      // edge (whole cells; a line at or over the width stays at start,
      // matching the truncation path).
      const lineWidth = lineAdvance(span.start, span.end, node.advances, style.tracking);
      let x = contentX + (style.textAlign === "end" ? Math.max(0, contentWidth - lineWidth) : 0);
      for (let k = span.start; k < truncated.end; k++) {
        // U+FFFC marks an embedded inline box (its cells are drawn by the
        // box's own walk); INLINE_PAD marks a blank inline-padding cell —
        // neither is a glyph.
        if (node.text[k] !== OBJECT_REPLACEMENT && node.text[k] !== INLINE_PAD) {
          const inlineIndex = node.charInline?.[k] ?? -1;
          const entry = inlineIndex >= 0 ? node.inlineElements![inlineIndex] : undefined;
          // Inline relative shifts, whole cells (specs/positioning.md):
          // the over-constrained sides resolve like CSS (top/left win).
          const insets = entry?.insets;
          const dx = insets ? (insets.left ?? (insets.right !== null ? -insets.right : 0)) : 0;
          const dy = insets ? (insets.top ?? (insets.bottom !== null ? -insets.bottom : 0)) : 0;
          put(x + dx, row + dy, node.text[k]!, entry ? inlinePaints![inlineIndex] : leafPaint);
        }
        x += advanceOf(k, k + 1, node.advances);
      }
      if (truncated.ellipsis) put(x, row, "…", leafPaint);
    }
  }

  for (const child of paintOrderedChildren(node)) {
    walk(child, absX, absY, put);
  }
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
