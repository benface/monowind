import type { GlyphBoxes } from "./glyph-box.ts";
import { applyCellPaint, isBarePaint, renderGridRows, samePaint } from "./plain-text.ts";
import type { CellSegment, RenderOptions } from "./plain-text.ts";
import { selectionRangeThrough } from "./selection.ts";
import type { LayoutNode } from "./types.ts";

/**
 * Paint the laid-out tree into the shadow's `#grid` (a `<pre>`): each
 * text line is a cell row, same-paint runs coalesce into spans, and a
 * cluster the font draws off its cell count gets a cell-sized box
 * (specs/wide-characters.md).
 *
 * Node identity is preserved wherever possible (specs/cell-model.md
 * "Selection"): an unchanged paint skips the write entirely, and a row
 * whose STRUCTURE (segment texts and span/bare split) matches the last
 * one only patches span styles in place — no node churn, so live
 * Selections (and an in-flight drag's anchor, which no engine lets us
 * restore) survive animation frames untouched, and a selection paint
 * touches only the rows it changed. A structural change rebuilds that
 * row's nodes: the selection is captured as flat character offsets
 * before the swap and restored after, and while a primary press is
 * down with a selection anchor in the grid the rebuild is HELD for
 * release instead (element.ts) — even restored nodes collapse
 * Chromium's drag.
 */
const lastPaintSignature = new WeakMap<HTMLElement, string>();
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
}
const lastPaint = new WeakMap<HTMLElement, PaintedRows>();

export interface PaintOptions {
  /** Defer structural rebuilds while a primary press is down. */
  holdStructural?: boolean;
  glyphs?: GlyphBoxes;
  selection?: RenderOptions["selection"];
}

/** True when a Selection boundary (a collapsed press anchor counts —
 * the drag it starts must survive) lies inside the grid. */
function hasSelectionInside(target: HTMLElement): boolean {
  return captureSelection(target, true) !== null;
}

/** Returns false when the paint was HELD: the caller asked to defer
 * structural rebuilds (a primary press is down) and a selection
 * anchor is in the grid — repeat the paint on release. */
export function paintGrid(
  root: LayoutNode,
  target: HTMLElement,
  options: PaintOptions = {},
): boolean {
  const glyphs = options.glyphs;
  const render: RenderOptions = {};
  if (glyphs) render.boxed = (cluster, cells, paint) => glyphs.box(cluster, cells, paint) !== null;
  if (options.selection) render.selection = options.selection;
  const { segments: rows, cells } = renderGridRows(root, render);
  const signature = signatureOf(rows);
  if (lastPaintSignature.get(target) === signature) return true;

  const previous = lastPaint.get(target);
  const rebuild = new Set<number>();
  if (previous && previous.rows.length === rows.length) {
    for (let y = 0; y < rows.length; y++) {
      if (!rowStructureMatches(target, previous.rows[y]!.nodes, rows[y]!)) rebuild.add(y);
    }
  }
  if (rebuild.size > 0 || !previous || previous.rows.length !== rows.length) {
    if (options.holdStructural && hasSelectionInside(target)) return false;
  }
  lastPaintSignature.set(target, signature);

  if (!previous || previous.rows.length !== rows.length) {
    const fragment = document.createDocumentFragment();
    const painted: PaintedRow[] = [];
    for (let y = 0; y < rows.length; y++) {
      const { nodes, units } = rowNodes(rows[y]!, glyphs);
      for (const node of nodes) fragment.appendChild(node);
      const newline = y < rows.length - 1 ? document.createTextNode("\n") : null;
      if (newline) fragment.appendChild(newline);
      painted.push({ nodes, segments: rows[y]!, newline, units });
    }
    lastPaint.set(target, { rows: painted, cells });
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
      const fresh = rowNodes(row, glyphs);
      for (const node of fresh.nodes) target.insertBefore(node, painted.newline);
      for (const node of painted.nodes) node.remove();
      painted.nodes = fresh.nodes;
      painted.segments = row;
      painted.units = fresh.units;
      continue;
    }
    for (let i = 0; i < row.length; i++) {
      const segment = row[i]!;
      if (isBarePaint(segment) || sameSegment(segment, painted.segments[i]!)) continue;
      applySegment(painted.nodes[i]! as HTMLElement, segment, glyphs);
    }
    painted.segments = row;
  }
  previous.cells = cells;
  if (saved) restoreSelection(target, saved);
  return true;
}

/** A row's nodes: bare text for unpainted runs, a span per painted one. */
function rowNodes(
  row: CellSegment[],
  glyphs: GlyphBoxes | undefined,
): { nodes: (Text | HTMLElement)[]; units: number } {
  const nodes: (Text | HTMLElement)[] = [];
  let units = 0;
  for (const segment of row) {
    units += segment.text.length;
    if (isBarePaint(segment) && !segment.box) {
      nodes.push(document.createTextNode(segment.text));
      continue;
    }
    const span = document.createElement("span");
    applySegment(span, segment, glyphs);
    span.textContent = segment.text;
    nodes.push(span);
  }
  return { nodes, units };
}

/** The painted cell strings, for callers walking the grid by cell. */
export function paintedCell(target: HTMLElement, col: number, row: number): string | undefined {
  return lastPaint.get(target)?.cells[row]?.[col];
}

/** A span's paint, and its box when the segment is one: an inline
 * block of exactly its cells, the glyph scaled to fill it and clipped
 * to the row (specs/wide-characters.md). */
function applySegment(
  span: HTMLElement,
  segment: CellSegment,
  glyphs: GlyphBoxes | undefined,
): void {
  span.style.cssText = "";
  applyCellPaint(segment, span.style);
  if (!segment.box) return;
  const box = glyphs?.box(segment.text, segment.cells ?? 1, segment);
  const style = span.style;
  style.display = "inline-block";
  style.width = `calc(${segment.cells ?? 1} * var(--mw-cw, 1ch))`;
  style.overflow = "hidden";
  style.verticalAlign = "top";
  style.textAlign = "center";
  if (box && box.scale !== 1) style.fontSize = `${Math.round(box.scale * 1000) / 10}%`;
}

function sameSegment(a: CellSegment, b: CellSegment): boolean {
  return samePaint(a, b) && a.box === b.box && a.cells === b.cells;
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
    const bare = isBarePaint(segment) && !segment.box;
    if (bare !== (node.nodeType === Node.TEXT_NODE)) return false;
    if (node.textContent !== segment.text) return false;
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
        s.selected ? "s" : "",
        s.box ? `b${s.cells}` : "",
      );
    }
    parts.push("\n");
  }
  return parts.join("\x1f");
}
