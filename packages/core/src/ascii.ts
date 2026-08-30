import { collectBorderRuns, paintOrderedChildren } from "./borders.ts";
import type { BorderRun } from "./borders.ts";
import { leafLineGeometry } from "./layout.ts";
import { advanceOf, INLINE_PAD, lineAdvance, OBJECT_REPLACEMENT } from "./wrap.ts";
import type { LineSpan } from "./wrap.ts";
import type { LayoutNode } from "./types.ts";

/**
 * Render a laid-out tree as plain-text ASCII art: borders as box-drawing
 * glyphs, leaf text word-wrapped inside its content box, everything else as
 * spaces.
 *
 * This is the engine's "screenshot without a browser": deterministic,
 * font-independent, and diffable — used for golden regression tests and as
 * a debugging/agent-inspection tool. It intentionally renders geometry the
 * way the browser would paint it (same border-run and word-wrap code), minus
 * colors and fonts.
 *
 * Content that overflows the root box is clipped at the grid edges.
 */
export function renderAscii(root: LayoutNode): string {
  const width = root.localRect.width;
  const height = root.localRect.height;
  if (width <= 0 || height <= 0) return "";

  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => " "),
  );
  const put = (x: number, y: number, glyph: string) => {
    if (x >= 0 && x < width && y >= 0 && y < height) grid[y]![x] = glyph;
  };

  walk(root, 0, 0, put);

  return grid.map((row) => row.join("").trimEnd()).join("\n");
}

type PutGlyph = (x: number, y: number, glyph: string) => void;

function walk(node: LayoutNode, parentAbsX: number, parentAbsY: number, put: PutGlyph): void {
  if (node.tableHidden) return;
  const absX = parentAbsX + node.localRect.x;
  const absY = parentAbsY + node.localRect.y;
  const style = node.style;

  const borderRuns: BorderRun[] = [];
  collectBorderRuns(
    style,
    { x: absX, y: absY, width: node.localRect.width, height: node.localRect.height },
    borderRuns,
  );
  for (const run of borderRuns) {
    for (let i = 0; i < run.length; i++) put(run.x + i, run.y, run.glyph);
  }
  if (node.decorationRuns) {
    for (const run of node.decorationRuns)
      for (let i = 0; i < run.length; i++) put(absX + run.x + i, absY + run.y, run.glyph);
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
          put(x, row, node.text[k]!);
        }
        x += advanceOf(k, k + 1, node.advances);
      }
      if (truncated.ellipsis) put(x, row, "…");
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
