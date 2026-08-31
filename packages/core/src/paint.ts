import { applyCellPaint, isBarePaint, renderCellSegments } from "./plain-text.ts";
import type { CellSegment } from "./plain-text.ts";
import type { LayoutNode } from "./types.ts";

/**
 * Paint the laid-out tree into the shadow's `#grid` (a `<pre>`): each
 * text line is a cell row, same-paint runs coalesce into spans.
 *
 * Idempotent — skips the DOM write when the segments match the last
 * paint. That preserves the user's live text Selection across pointer-
 * triggered relayouts (a Range holds Node references that
 * `replaceChildren` would invalidate).
 */
const lastPaintSignature = new WeakMap<HTMLElement, string>();

export function paintGrid(root: LayoutNode, target: HTMLElement): void {
  const rows = renderCellSegments(root);
  const signature = signatureOf(rows);
  if (lastPaintSignature.get(target) === signature) return;
  lastPaintSignature.set(target, signature);
  const fragment = document.createDocumentFragment();
  for (let y = 0; y < rows.length; y++) {
    if (y > 0) fragment.appendChild(document.createTextNode("\n"));
    for (const segment of rows[y]!) {
      if (isBarePaint(segment)) {
        fragment.appendChild(document.createTextNode(segment.text));
        continue;
      }
      const span = document.createElement("span");
      applyCellPaint(segment, span.style);
      span.textContent = segment.text;
      fragment.appendChild(span);
    }
  }
  target.replaceChildren(fragment);
}

function signatureOf(rows: CellSegment[][]): string {
  const parts: string[] = [];
  for (const row of rows) {
    for (const s of row) {
      parts.push(
        s.text,
        s.color ?? "",
        s.backgroundColor ?? "",
        s.fontWeight ?? "",
        s.fontStyle ?? "",
        s.textDecorationLine ?? "",
      );
    }
    parts.push("\n");
  }
  return parts.join("\x1f");
}
