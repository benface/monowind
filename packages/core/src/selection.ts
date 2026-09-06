import { leafRendererFor } from "./leaf.ts";
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

/** A custom leaf's transcript: the node its `selectionTarget` names
 * when that node holds the leaf's text verbatim (specs/leaf-renderers.md)
 * — a text-mode drag, the painted highlight, and the copy then read
 * positions in it as indices into `leaf.text`. */
export function transcriptOf(leaf: LayoutNode): Node | null {
  const target = leafRendererFor(leaf.source.tagName)?.selectionTarget?.(leaf.source) ?? null;
  return target && target.textContent === leaf.text ? target : null;
}

/** The text node and offset `offset` code units into `container`'s
 * text; past the end, the last node's end. */
export function textPositionAt(container: Node, offset: number): [Text, number] | null {
  let remaining = offset;
  let last: [Text, number] | null = null;
  for (const text of textNodesOf(container)) {
    if (remaining <= text.data.length) return [text, remaining];
    remaining -= text.data.length;
    last = [text, text.data.length];
  }
  return last;
}

/** A boundary point inside `container` as code units into its text —
 * a Range does the flattening: its string is exactly the text between
 * the container's start and the point. Null outside it. */
export function textOffsetOf(container: Node, node: Node, offset: number): number | null {
  if (!container.contains(node)) return null;
  const range = container.ownerDocument!.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, offset);
  return range.toString().length;
}

function* textNodesOf(container: Node): Generator<Text> {
  const walker = container.ownerDocument!.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    yield node as Text;
    node = walker.nextNode();
  }
}

/** The index into `leaf.text` of the character at or after a DOM
 * boundary point: a point inside a collapsed whitespace run is that
 * run's space, a point past a node's mapped characters is the next
 * mapped index (or `text.length`), a point inside an atomic inline
 * box's subtree is the box's U+FFFC marker, and a point in a custom
 * leaf's transcript its offset there. */
export function charIndexAt(leaf: LayoutNode, container: Node, offset: number): number {
  if (!leaf.charSource) {
    const transcript = transcriptOf(leaf);
    return (transcript && textOffsetOf(transcript, container, offset)) ?? 0;
  }
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
 * ending there) — in a custom leaf's transcript when it has one; null
 * for a character with no source position. */
export function positionOf(leaf: LayoutNode, index: number): { node: Text; offset: number } | null {
  if (!leaf.charSource) {
    const transcript = transcriptOf(leaf);
    const at = transcript && textPositionAt(transcript, index);
    return at && { node: at[0], offset: at[1] };
  }
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
 * and the `leafRoots` (`getComposedRanges` on Firefox/WebKit and
 * standards-path Chromium; `ShadowRoot.getSelection()` as the legacy
 * Chromium fallback — verified 2026-09-01). A selection inside a shadow
 * root not listed comes back retargeted onto that root's host, which
 * is exactly the light-tree range around it; listing a custom leaf's
 * transcript root keeps the points inside it. Any API surprise reads
 * as no selection, never an error. */
export function selectionRangeThrough(
  shadowRoot: ShadowRoot,
  leafRoots: ShadowRoot[] = [],
): BoundaryPoints | null {
  try {
    const selection = shadowRoot.ownerDocument.getSelection();
    if (!selection) return null;
    if (selection.getComposedRanges) {
      const ranges = selection.getComposedRanges({ shadowRoots: [shadowRoot, ...leafRoots] });
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
  if (withinHost(host, start) && withinHost(host, end)) return "light";
  return "outside";
}

/** `contains` through the shadow boundaries of the host's descendants:
 * a node inside a custom leaf's shadow is within the host that holds
 * the leaf; a node in the host's own shadow (the grid) is not. */
function withinHost(host: Element, node: Node): boolean {
  for (let current: Node | null = node; current;) {
    if (host.contains(current)) return true;
    const root = current.getRootNode();
    current = root instanceof ShadowRoot && root.host !== host ? root.host : null;
  }
  return false;
}

/** The shadow roots of the custom leaves with transcripts under
 * `root`, for `selectionRangeThrough`. */
export function leafShadowRoots(root: LayoutNode): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  const visit = (node: LayoutNode): void => {
    const shadow = transcriptOf(node)?.getRootNode();
    if (shadow instanceof ShadowRoot) roots.push(shadow);
    for (const child of node.children) visit(child);
  };
  visit(root);
  return roots;
}

/** A range whose points lie inside a custom leaf's transcript: the
 * leaf and the character range, or null for a light-tree range. */
function transcriptRange(
  root: LayoutNode,
  points: BoundaryPoints,
): { leaf: LayoutNode; start: number; end: number } | null {
  const shadow = points.startContainer.getRootNode();
  if (!(shadow instanceof ShadowRoot) || shadow.host === root.source) return null;
  let found: LayoutNode | null = null;
  const visit = (node: LayoutNode): void => {
    if (found) return;
    if (node.source === shadow.host) found = node;
    else for (const child of node.children) visit(child);
  };
  visit(root);
  if (!found) return null;
  const leaf: LayoutNode = found;
  const start = charIndexAt(leaf, points.startContainer, points.startOffset);
  const end = charIndexAt(leaf, points.endContainer, points.endOffset);
  return { leaf, start: Math.min(start, end), end: Math.max(start, end) };
}

/* === Painted selection =============================================== */

/** The text leaves a light-DOM range reaches, each with the character
 * range the paint inverts (specs/wide-characters.md "The grid paints
 * the selection"): a leaf inside the range whole, a boundary leaf from
 * or to the point's character, a renderer leaf whole. */
export function selectedRanges(
  root: LayoutNode,
  points: BoundaryPoints,
): Map<LayoutNode, { start: number; end: number }> {
  const inTranscript = transcriptRange(root, points);
  if (inTranscript) {
    const { leaf, start, end } = inTranscript;
    return end > start ? new Map([[leaf, { start, end }]]) : new Map();
  }
  const range = root.source.ownerDocument!.createRange();
  range.setStart(points.startContainer, points.startOffset);
  range.setEnd(points.endContainer, points.endOffset);
  const ranges = new Map<LayoutNode, { start: number; end: number }>();
  const visit = (node: LayoutNode): void => {
    if (node.tableHidden || !rangeMeets(node, range)) return;
    if (isTextLeaf(node)) {
      const { text } = node;
      let start = 0;
      let end = text.length;
      if (node.charSource) {
        if (leafHolds(node, range.startContainer)) {
          start = charIndexAt(node, range.startContainer, range.startOffset);
        }
        if (leafHolds(node, range.endContainer)) {
          end = charIndexAt(node, range.endContainer, range.endOffset);
        }
      }
      if (end > start) ranges.set(node, { start, end });
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  return ranges;
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
  const inTranscript = transcriptRange(root, points);
  if (inTranscript) return inTranscript.leaf.text.slice(inTranscript.start, inTranscript.end);
  const range = root.source.ownerDocument!.createRange();
  range.setStart(points.startContainer, points.startOffset);
  range.setEnd(points.endContainer, points.endOffset);
  const items: TextItem[] = [];
  collectItems(root, range, items);
  return assemble(items);
}

function collectItems(node: LayoutNode, range: Range, items: TextItem[]): void {
  if (node.tableHidden || !rangeMeets(node, range)) return;
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
  // A run in a <p> is an anonymous block: one break, as innerText gives.
  return node.source.tagName === "P" && !node.anonymous ? 2 : 1;
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

/** The light DOM an anonymous run owns — its text nodes, inline
 * elements, and children (atomic boxes, out-of-flow elements) — since
 * its `source` is the container it shares with its siblings. */
function runNodes(leaf: LayoutNode): Node[] {
  return [
    ...(leaf.charSource ?? []).map((run) => run.node),
    ...(leaf.inlineElements ?? []).map((inline) => inline.element),
    ...leaf.children.map((child) => child.source),
  ];
}

/** Whether the range reaches the node's light DOM. */
function rangeMeets(node: LayoutNode, range: Range): boolean {
  if (!node.anonymous) return range.intersectsNode(node.source);
  return runNodes(node).some((own) => range.intersectsNode(own));
}

/** Whether a range endpoint's node is the leaf's — the container
 * itself included, since a point between a run's nodes sits on it
 * (`charIndexAt` clamps one beyond the run to its ends). */
function leafHolds(leaf: LayoutNode, node: Node): boolean {
  if (!leaf.anonymous) return leaf.source.contains(node);
  return leaf.source === node || runNodes(leaf).some((own) => own === node || own.contains(node));
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
    if (leafHolds(leaf, range.startContainer)) {
      start = charIndexAt(leaf, range.startContainer, range.startOffset);
    }
    if (leafHolds(leaf, range.endContainer)) {
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
