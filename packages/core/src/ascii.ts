import { collectBorderRuns } from "./borders.ts";
import type { BorderRun } from "./borders.ts";
import { wrapLines } from "./wrap.ts";
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

  if (node.children.length === 0 && node.text) {
    const padding = node.resolvedPadding;
    const contentX = absX + style.border.left + padding.left;
    const contentY = absY + style.border.top + padding.top;
    const contentWidth =
      node.localRect.width - style.border.left - style.border.right - padding.left - padding.right;
    const lines =
      style.whiteSpace === "nowrap"
        ? node.text.split("\n").map((line) => truncateLine(line, contentWidth, style))
        : wrapLines(node.text, contentWidth);
    for (let row = 0; row < lines.length; row++) {
      const line = lines[row]!;
      for (let col = 0; col < line.length; col++) {
        put(contentX + col, contentY + row, line[col]!);
      }
    }
  }

  for (const child of node.children) {
    walk(child, absX, absY, put);
  }
}

/**
 * Mirror of what the browser paints for a nowrap line: a clipping box cuts
 * it at the content width, with `…` in the last visible cell when
 * `text-overflow: ellipsis` is set. A non-clipping nowrap line is left
 * intact — like the browser, it overflows (the grid edge clips it).
 */
function truncateLine(line: string, contentWidth: number, style: LayoutNode["style"]): string {
  if (style.overflow !== "clip" || line.length <= contentWidth) return line;
  if (contentWidth <= 0) return "";
  if (style.textOverflow === "ellipsis") return `${line.slice(0, contentWidth - 1)}…`;
  return line.slice(0, contentWidth);
}
