import { applyCellPaint, isBarePaint, renderCellSegments, samePaint } from "./plain-text.ts";
import type { CellSegment } from "./plain-text.ts";
import { selectionRangeThrough } from "./selection.ts";
import type { LayoutNode } from "./types.ts";

/**
 * Paint the laid-out tree into the shadow's `#grid` (a `<pre>`): each
 * text line is a cell row, same-paint runs coalesce into spans.
 *
 * Node identity is preserved wherever possible (specs/cell-model.md
 * "Selection"): an unchanged paint skips the write entirely, and a
 * paint whose STRUCTURE (segment texts and span/bare split) matches
 * the last one only patches span styles in place — no node churn, so
 * live Selections (and an in-flight drag's anchor, which no engine
 * lets us restore) survive animation frames untouched. A structural
 * change rebuilds the nodes: the selection is captured as flat
 * character offsets before the swap and restored after, and while a
 * primary press is down with a selection anchor in the grid the
 * rebuild is HELD for release instead (element.ts) — even restored
 * nodes collapse Chromium's drag.
 */
const lastPaintSignature = new WeakMap<HTMLElement, string>();
interface PaintedRows {
  nodes: (Text | HTMLElement)[][];
  segments: CellSegment[][];
}
const lastPaint = new WeakMap<HTMLElement, PaintedRows>();

/** True when a Selection boundary (a collapsed press anchor counts —
 * the drag it starts must survive) lies inside the grid. */
function hasSelectionInside(target: HTMLElement): boolean {
  return captureSelection(target, true) !== null;
}

/** Returns false when the paint was HELD: the caller asked to defer
 * structural rebuilds (a primary press is down) and a selection
 * anchor is in the grid — repeat the paint on release. */
export function paintGrid(root: LayoutNode, target: HTMLElement, holdStructural = false): boolean {
  const rows = renderCellSegments(root);
  const signature = signatureOf(rows);
  if (lastPaintSignature.get(target) === signature) return true;

  // Style-only pass: same texts in the same span/bare segmentation —
  // patch the spans whose paint actually changed and leave every
  // node's identity alone.
  const previous = lastPaint.get(target);
  if (previous && structureMatches(target, previous.nodes, rows)) {
    lastPaintSignature.set(target, signature);
    for (let y = 0; y < rows.length; y++) {
      for (let i = 0; i < rows[y]!.length; i++) {
        const segment = rows[y]![i]!;
        if (isBarePaint(segment) || samePaint(segment, previous.segments[y]![i])) continue;
        const span = previous.nodes[y]![i]! as HTMLElement;
        span.style.cssText = "";
        applyCellPaint(segment, span.style);
      }
    }
    previous.segments = rows;
    return true;
  }

  if (holdStructural && hasSelectionInside(target)) return false;
  lastPaintSignature.set(target, signature);
  const fragment = document.createDocumentFragment();
  const nodes: (Text | HTMLElement)[][] = [];
  for (let y = 0; y < rows.length; y++) {
    if (y > 0) fragment.appendChild(document.createTextNode("\n"));
    const rowNodes: (Text | HTMLElement)[] = [];
    for (const segment of rows[y]!) {
      if (isBarePaint(segment)) {
        const text = document.createTextNode(segment.text);
        rowNodes.push(text);
        fragment.appendChild(text);
        continue;
      }
      const span = document.createElement("span");
      applyCellPaint(segment, span.style);
      span.textContent = segment.text;
      rowNodes.push(span);
      fragment.appendChild(span);
    }
    nodes.push(rowNodes);
  }
  lastPaint.set(target, { nodes, segments: rows });
  const saved = captureSelection(target, false);
  target.replaceChildren(fragment);
  if (saved) restoreSelection(target, saved);
  return true;
}

function structureMatches(
  target: HTMLElement,
  previous: (Text | HTMLElement)[][],
  rows: CellSegment[][],
): boolean {
  if (previous.length !== rows.length) return false;
  for (let y = 0; y < rows.length; y++) {
    const prevRow = previous[y]!;
    const row = rows[y]!;
    if (prevRow.length !== row.length) return false;
    for (let i = 0; i < row.length; i++) {
      const node = prevRow[i]!;
      const bare = isBarePaint(row[i]!);
      if (bare !== (node.nodeType === Node.TEXT_NODE)) return false;
      if (node.textContent !== row[i]!.text) return false;
      // A node detached from the grid can't be patched.
      if (node.parentNode !== target) return false;
    }
  }
  return true;
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
    const start = flatOffset(target, range.startContainer, range.startOffset);
    const end = flatOffset(target, range.endContainer, range.endOffset);
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
    const start = nodeAtOffset(target, saved.start);
    const end = nodeAtOffset(target, saved.end);
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

/** Boundary point → offset into the grid's flat text; null when the
 * point is outside the grid (the selection reaches past it — restoring
 * only our half would corrupt it). A Range does the flattening: its
 * string is exactly the text between the grid's start and the point. */
function flatOffset(target: HTMLElement, container: Node, offset: number): number | null {
  if (!target.contains(container)) return null;
  const range = target.ownerDocument.createRange();
  range.selectNodeContents(target);
  range.setEnd(container, offset);
  return range.toString().length;
}

export function nodeAtOffset(target: HTMLElement, offset: number): [Text, number] | null {
  let remaining = offset;
  let last: [Text, number] | null = null;
  for (const text of textNodesOf(target)) {
    if (remaining <= text.data.length) return [text, remaining];
    remaining -= text.data.length;
    last = [text, text.data.length];
  }
  // Offset past the new content (the grid shrank): clamp to the end.
  return last;
}

function* textNodesOf(target: HTMLElement): Generator<Text> {
  const walker = target.ownerDocument.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    yield node as Text;
    node = walker.nextNode();
  }
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
        s.opacity ?? "",
      );
    }
    parts.push("\n");
  }
  return parts.join("\x1f");
}
