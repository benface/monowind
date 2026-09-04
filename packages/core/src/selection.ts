import { inlineBoxesOf } from "./types.ts";
import type { LayoutNode } from "./types.ts";
import { INLINE_PAD, OBJECT_REPLACEMENT } from "./wrap.ts";

/**
 * Character ↔ DOM position mapping over a leaf's `charSource` runs
 * (specs/semantic-selection.md): word boundaries map forward to
 * `setBaseAndExtent` points, and a Range's boundary points map
 * backward to slices of the leaf's layout text.
 */

/** Negative when point `a` precedes point `b` in DOM order, 0 when equal. */
export function comparePoints(aNode: Node, aOffset: number, bNode: Node, bOffset: number): number {
  const document = aNode.ownerDocument!;
  const a = document.createRange();
  a.setStart(aNode, aOffset);
  a.collapse(true);
  const b = document.createRange();
  b.setStart(bNode, bOffset);
  b.collapse(true);
  return a.compareBoundaryPoints(a.START_TO_START, b);
}

/** The index into `leaf.text` of the character at or after a DOM
 * boundary point: a point inside a collapsed whitespace run is that
 * run's space, a point past a node's mapped characters is the next
 * mapped index (or `text.length`), and a point inside an atomic inline
 * box's subtree is the box's U+FFFC marker. */
export function charIndexAt(leaf: LayoutNode, container: Node, offset: number): number {
  const boxes = inlineBoxesOf(leaf);
  const boxIndex = boxes.findIndex((box) => box.source.contains(container));
  if (boxIndex >= 0) {
    let marker = -1;
    for (let i = 0; i <= boxIndex; i++) marker = leaf.text.indexOf(OBJECT_REPLACEMENT, marker + 1);
    if (marker >= 0) return marker;
  }
  const runs = leaf.charSource ?? [];
  // Runs are in DOM order: the last one starting at or before the point.
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const run = runs[mid]!;
    if (comparePoints(run.node, run.offset, container, offset) <= 0) low = mid + 1;
    else high = mid;
  }
  if (low === 0) return 0;
  const run = runs[low - 1]!;
  if (container === run.node && offset < run.offset + run.length) {
    return run.index + (offset - run.offset);
  }
  return run.index + run.length;
}

/** The DOM position of `leaf.text[index]` (or of the end of the run
 * ending there); null for a character with no source position. */
export function positionOf(leaf: LayoutNode, index: number): { node: Text; offset: number } | null {
  const runs = leaf.charSource ?? [];
  let low = 0;
  let high = runs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (runs[mid]!.index <= index) low = mid + 1;
    else high = mid;
  }
  const run = runs[low - 1];
  if (!run) return null;
  const delta = index - run.index;
  return delta <= run.length ? { node: run.node, offset: run.offset + delta } : null;
}

/* === Selection location ============================================= */

export interface BoundaryPoints {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
}

/** The document Selection's first range as seen through `shadowRoot`
 * (`getComposedRanges` on Firefox/WebKit and standards-path Chromium;
 * `ShadowRoot.getSelection()` as the legacy Chromium fallback —
 * verified 2026-09-01). A selection inside some OTHER shadow root (a
 * custom leaf's transcript) comes back retargeted onto that root's
 * host, which is exactly the light-tree range around the leaf. Any API
 * surprise reads as no selection, never an error. */
export function selectionRangeThrough(shadowRoot: ShadowRoot): BoundaryPoints | null {
  try {
    const selection = shadowRoot.ownerDocument.getSelection();
    if (!selection) return null;
    if (selection.getComposedRanges) {
      const ranges = selection.getComposedRanges({ shadowRoots: [shadowRoot] });
      return ranges[0] ?? null;
    }
    const shadowSelection = (
      shadowRoot as { getSelection?: () => Selection | null }
    ).getSelection?.();
    if (!shadowSelection || shadowSelection.rangeCount === 0) return null;
    return shadowSelection.getRangeAt(0);
  } catch {
    return null;
  }
}

/** Where a selection lives relative to a host: in its shadow `grid`,
 * in its light DOM (both points, the host's own child list included),
 * or anywhere else — including straddling the two. */
export type SelectionKind = "grid" | "light" | "outside";

export function classifySelection(
  host: Element,
  grid: Element,
  range: BoundaryPoints,
): SelectionKind {
  const { startContainer: start, endContainer: end } = range;
  if (grid.contains(start) && grid.contains(end)) return "grid";
  if (host.contains(start) && host.contains(end)) return "light";
  return "outside";
}

/* === Copy serialization ============================================== */

/** A required line break count (collapses with neighbors, dropped at
 * the ends) or literal text (a leaf's slice, a table's tab or row
 * newline) — the HTML `innerText` rendered-text items. */
type TextItem = { text: string } | { breaks: number };

/** `text/plain` for a light-DOM selection (specs/semantic-selection.md
 * "Copy serialization"): every node the range intersects, in tree
 * order, laid out by the `innerText` rules — a `<p>` surrounded by a
 * blank line, any other block-level box by one line break, table cells
 * separated by tabs and rows by newlines — over each leaf's layout
 * text. The browsers' own serializers lose block breaks for the
 * engine's out-of-flow boxes; this restores what they would have
 * produced in flow. */
export function serializeSelection(root: LayoutNode, points: BoundaryPoints): string {
  const range = root.source.ownerDocument!.createRange();
  range.setStart(points.startContainer, points.startOffset);
  range.setEnd(points.endContainer, points.endOffset);
  const items: TextItem[] = [];
  collectItems(root, range, items);
  return assemble(items);
}

function collectItems(node: LayoutNode, range: Range, items: TextItem[]): void {
  if (node.tableHidden || !range.intersectsNode(node.source)) return;
  const breaks = requiredBreaks(node);
  if (breaks) items.push({ breaks });
  if (node.style.tableRole === "row") {
    collectRow(node, range, items);
  } else if (node.style.display === "table") {
    const rows = tableRows(node);
    for (const child of node.children) {
      if (child.style.tableRole === "row" || isRowGroup(child)) continue;
      collectItems(child, range, items); // captions
    }
    // Separators only between rows the range reaches, like the
    // browsers' own partial-table copies.
    let emitted = false;
    for (const row of rows) {
      if (!range.intersectsNode(row.source)) continue;
      if (emitted) items.push({ text: "\n" });
      collectItems(row, range, items);
      emitted = true;
    }
  } else {
    if (isTextLeaf(node)) items.push({ text: leafSlice(node, range) });
    for (const child of node.children) {
      if (!child.inlineBox) collectItems(child, range, items);
    }
  }
  if (breaks) items.push({ breaks });
}

function collectRow(row: LayoutNode, range: Range, items: TextItem[]): void {
  let emitted = false;
  for (const cell of row.children) {
    if (cell.style.tableRole !== "cell" || cell.tableHidden) continue;
    if (!range.intersectsNode(cell.source)) continue;
    if (emitted) items.push({ text: "\t" });
    collectItems(cell, range, items);
    emitted = true;
  }
}

function isRowGroup(node: LayoutNode): boolean {
  const role = node.style.tableRole;
  return role === "header-group" || role === "row-group" || role === "footer-group";
}

function tableRows(table: LayoutNode): LayoutNode[] {
  const rows: LayoutNode[] = [];
  for (const child of table.children) {
    if (child.style.tableRole === "row") rows.push(child);
    else if (isRowGroup(child)) {
      for (const row of child.children) if (row.style.tableRole === "row") rows.push(row);
    }
  }
  return rows;
}

/** `innerText`: a `<p>` gets two required breaks, any other block-level
 * box (a caption included) one; inline boxes and table internals none. */
function requiredBreaks(node: LayoutNode): number {
  if (node.inlineBox) return 0;
  const role = node.style.tableRole;
  if (role === "row" || role === "cell" || isRowGroup(node)) return 0;
  if (role === "column" || role === "column-group") return 0;
  return node.source.tagName === "P" ? 2 : 1;
}

interface Point {
  node: Node;
  offset: number;
}

/** The DOM extent of a leaf's run — its first mapped character or
 * inline box through its last; null for a run with neither. */
export function leafExtent(leaf: LayoutNode): { start: Point; end: Point } | null {
  const points: { start: Point; end: Point }[] = [];
  const runs = leaf.charSource ?? [];
  if (runs.length > 0) {
    const first = runs[0]!;
    const last = runs[runs.length - 1]!;
    points.push({
      start: { node: first.node, offset: first.offset },
      end: { node: last.node, offset: last.offset + last.length },
    });
  }
  for (const box of inlineBoxesOf(leaf)) {
    const parent = box.source.parentNode;
    if (!parent) continue;
    const index = Array.prototype.indexOf.call(parent.childNodes, box.source);
    points.push({
      start: { node: parent, offset: index },
      end: { node: parent, offset: index + 1 },
    });
  }
  if (points.length === 0) return null;
  const before = (a: Point, b: Point) => comparePoints(a.node, a.offset, b.node, b.offset) < 0;
  let { start, end } = points[0]!;
  for (const point of points.slice(1)) {
    if (before(point.start, start)) start = point.start;
    if (before(end, point.end)) end = point.end;
  }
  return { start, end };
}

/** A node whose text is painted: text and no in-flow children (the
 * paint walk's own test); renderer leaves included. */
export function isTextLeaf(node: LayoutNode): boolean {
  if (node.text.length === 0) return false;
  return !node.children.some(
    (child) =>
      !child.inlineBox && child.style.position !== "absolute" && child.style.position !== "fixed",
  );
}

/** The part of a leaf's layout text the range covers — all of it for a
 * renderer leaf (its text has no source positions) — with inline
 * boxes spliced in for their U+FFFC markers and padding markers
 * dropped. A final newline (a trailing `<br>`, which the wrap layer
 * drops) goes too. */
function leafSlice(leaf: LayoutNode, range: Range): string {
  const { text } = leaf;
  let start = 0;
  let end = text.length;
  if (leaf.charSource) {
    if (leaf.source.contains(range.startContainer)) {
      start = charIndexAt(leaf, range.startContainer, range.startOffset);
    }
    if (leaf.source.contains(range.endContainer)) {
      end = charIndexAt(leaf, range.endContainer, range.endOffset);
    }
  }
  let slice = text.slice(start, end);
  if (end === text.length && slice.endsWith("\n")) slice = slice.slice(0, -1);
  const boxes = inlineBoxesOf(leaf);
  let boxIndex = text.slice(0, start).split(OBJECT_REPLACEMENT).length - 1;
  slice = slice.replaceAll(OBJECT_REPLACEMENT, () => {
    const box = boxes[boxIndex++];
    if (!box || !range.intersectsNode(box.source)) return "";
    const items: TextItem[] = [];
    collectItems(box, range, items);
    return assemble(items);
  });
  return slice.replaceAll(INLINE_PAD, "");
}

/** Required breaks collapse to the largest of a run and vanish at
 * either end; text items concatenate. */
function assemble(items: TextItem[]): string {
  let out = "";
  let pending = 0;
  for (const item of items) {
    if ("breaks" in item) {
      pending = Math.max(pending, item.breaks);
      continue;
    }
    if (item.text.length === 0) continue;
    if (out.length > 0 && pending > 0) out += "\n".repeat(pending);
    pending = 0;
    out += item.text;
  }
  return out;
}

/* === Words ============================================================ */

const segmenters = new Map<string, Intl.Segmenter | null>();

/** The word containing `leaf.text[index]` — the `Intl.Segmenter`
 * segment (word-like or not) within the run of text between markers
 * and newlines, in the element's language. null off a character, at a
 * marker, or without a Segmenter. */
export function wordAt(leaf: LayoutNode, index: number): { start: number; end: number } | null {
  const { text } = leaf;
  if (index < 0 || index >= text.length || isWordBoundary(text[index]!)) return null;
  let start = index;
  while (start > 0 && !isWordBoundary(text[start - 1]!)) start--;
  let end = index;
  while (end < text.length && !isWordBoundary(text[end]!)) end++;
  const segmenter = segmenterFor(leaf.source.closest?.("[lang]")?.getAttribute("lang") ?? "");
  if (!segmenter) return null;
  for (const segment of segmenter.segment(text.slice(start, end))) {
    const from = start + segment.index;
    const to = from + segment.segment.length;
    if (index >= from && index < to) return { start: from, end: to };
  }
  return null;
}

function isWordBoundary(ch: string): boolean {
  return ch === "\n" || ch === OBJECT_REPLACEMENT || ch === INLINE_PAD;
}

/** One Segmenter per language, cached (construction is not free and
 * word extension asks per pointermove); an invalid tag falls back to
 * the default locale. */
function segmenterFor(lang: string): Intl.Segmenter | null {
  let segmenter = segmenters.get(lang);
  if (segmenter === undefined) {
    segmenter = createSegmenter(lang) ?? createSegmenter("");
    segmenters.set(lang, segmenter);
  }
  return segmenter;
}

function createSegmenter(lang: string): Intl.Segmenter | null {
  if (typeof Intl.Segmenter !== "function") return null;
  try {
    return new Intl.Segmenter(lang || undefined, { granularity: "word" });
  } catch {
    return null;
  }
}
