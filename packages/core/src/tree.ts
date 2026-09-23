import { makeIntrinsicCache, widthContribution } from "./layout.ts";
import { leafRendererFor, renderLeafContent } from "./leaf.ts";
import type { LeafRegistration } from "./leaf.ts";
import { pxToCells } from "./metrics.ts";
import {
  isTransparentColor,
  lineGapRows,
  readAnchorNames,
  readOpacity,
  readVisible,
  readCellStyle,
  readOverflow,
  readTextStyle,
  trackingCells,
} from "./style.ts";
import { defaultCellStyle, zeroInsets } from "./types.ts";
import { warnOnce } from "./warn.ts";
import { clusterAdvance, clusterAdvances, graphemes, textCells } from "./width.ts";
import {
  eachObjectMarker,
  hardLineSpans,
  INLINE_PAD,
  lineAdvance,
  OBJECT_REPLACEMENT,
  wrapLineCount,
} from "./wrap.ts";
import type { CellMetrics, CellStyle, CharSourceRun, LayoutNode, PerSide } from "./types.ts";

/** Per-textarea content width in cells, captured by the host BEFORE
 * the measuring attribute goes on — the engine's width rule is off
 * during measuring, so `textarea.clientWidth` read then would reflect
 * the browser-default width instead of our engine-assigned one (which
 * may itself be constrained by max-width / flex parent). */
export type TextareaWidths = Map<HTMLTextAreaElement, number>;

/**
 * Build a LayoutNode tree from an element subtree.
 *
 * Rules (specs/cell-model.md "Inline detection"):
 * - Elements with computed `display: none` are skipped entirely (their
 *   text never joins a run).
 * - An element is a **leaf** when no IN-FLOW block-level element lies
 *   below it through inline ones: in-flow inline children (computed
 *   `inline`/`inline-*`/`contents`) are part of the text run, and
 *   out-of-flow children (absolute/fixed — blockified per CSS) hang
 *   off the leaf as layout nodes for the positioning pass. The leaf's
 *   `text` is its combined in-flow text, so text nodes interleaved
 *   with inline elements (`<div>hello <span>world</span></div>`)
 *   participate in the wrap calculation and render correctly.
 * - Elements with an in-flow block-level element among their children,
 *   or below an inline one, become **containers** and recurse; the text
 *   beside those children forms anonymous runs, and an inline element
 *   around a block is split there as CSS splits it (`buildChildren`,
 *   `hidesBlock`, specs/cell-model.md "Inline content").
 * - The host follows the same rule through `buildRootLeaf`
 *   (specs/host-leaf.md).
 *
 * `cellMetrics` (measured by the host) is the basis for leading and
 * tracking; absent in headless tests (see readCellStyle).
 */
export function buildTree(
  root: Element,
  rootFontSizePx: number,
  cellMetrics?: CellMetrics,
  textareaWidths?: TextareaWidths,
): LayoutNode | null {
  const style = readCellStyle(root, rootFontSizePx, cellMetrics);
  if (style.display === "none") return null;

  // Registered leaf renderers (specs/leaf-renderers.md) supply their
  // own grid content; children are skipped entirely. The light DOM
  // stays untouched — it keeps the a11y tree and select="text"
  // semantics while the grid shows the rendered content.
  const leaf = leafRendererFor(root.tagName);
  if (leaf) return buildRendererLeaf(root, style, leaf);

  const elementChildren = Array.from(root.children);
  const roles = elementChildren.map(childRole);
  const context = { rootFontSizePx, cellMetrics, textareaWidths };

  // Form controls are always leaves — descending into a <select>'s
  // <option>s would leak that text into the grid.
  if (
    isFormControlTag(root.tagName) ||
    (!roles.includes("block") && !splitsForBlock(elementChildren, roles))
  ) {
    return buildLeaf(root, style, elementChildren, roles, context);
  }

  return {
    source: root,
    style,
    children: buildChildren(
      root,
      Array.from(root.childNodes),
      rootFontSizePx,
      cellMetrics,
      textareaWidths,
    ),
    text: "",
    intrinsicWidth: 0,
    intrinsicHeight: 0,
    localRect: { x: 0, y: 0, width: 0, height: 0 },
    unclampedHeight: 0,
    naturalContentHeight: 0,
    resolvedPadding: zeroInsets(),
  };
}

/** A container's children in document order (specs/cell-model.md
 * "Inline content"): each block-level element a node, and each maximal
 * run of inline content between them — text, inline elements, atomic
 * boxes, any out-of-flow element among them — an anonymous leaf in
 * `runStyle`, the container's own text style unless given (the host's,
 * specs/host-leaf.md). A stretch of nothing but whitespace and
 * out-of-flow elements is no run: those elements are the container's
 * own positioned children. */
export function buildChildren(
  container: Element,
  nodes: ChildNode[],
  rootFontSizePx: number,
  cellMetrics?: CellMetrics,
  textareaWidths?: TextareaWidths,
  runStyle?: CellStyle,
): LayoutNode[] {
  const context = { rootFontSizePx, cellMetrics, textareaWidths };
  const children: LayoutNode[] = [];
  const build = (el: Element): void => {
    const node = buildTree(el, rootFontSizePx, cellMetrics, textareaWidths);
    if (node) children.push(fadedBy(node, splitOpacity(el, container)));
  };
  let style = runStyle;
  let run: ChildNode[] = [];
  let roles: ChildRole[] = [];
  let inline = false;
  const flush = (): void => {
    const elements = run.filter((node): node is Element => node instanceof Element);
    if (!inline) {
      for (const el of elements) build(el);
    } else {
      style ??= leafStyleOf(container, rootFontSizePx, cellMetrics);
      children.push(buildAnonymousLeaf(container, run, elements, roles, context, style));
    }
    run = [];
    roles = [];
    inline = false;
  };
  // Walked by index, a split splicing the inline's children in where
  // it stood: shifting each node off the front would cost the whole
  // list on every step.
  const queue = [...nodes];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!;
    if (node instanceof Element) {
      const role = childRole(node);
      if (role === "none") continue;
      if (role === "block") {
        flush();
        build(node);
        continue;
      }
      // An inline element around a block: CSS splits the inline box
      // there, and taking its children in its place splits it here —
      // the block reaches this loop, and the inline content each side
      // of it falls into the runs around it.
      if (role === "inline" && hidesBlock(node)) {
        queue.splice(index, 1, ...node.childNodes);
        index--;
        continue;
      }
      roles.push(role);
      inline ||= role === "inline";
    } else if (node.nodeType !== Node.TEXT_NODE) {
      continue;
    } else {
      inline ||= /[^ \t\r\n\f]/.test(node.textContent ?? "");
    }
    run.push(node);
  }
  flush();
  return children;
}

/** A run's leaf over exactly the run's nodes, which are its DOM
 * (selection.ts `runNodes`). */
function buildAnonymousLeaf(
  container: Element,
  nodes: ChildNode[],
  elements: Element[],
  roles: ChildRole[],
  context: BuildContext,
  style: CellStyle,
): LayoutNode {
  const leaf = buildLeaf(container, style, elements, roles, context, nodes);
  leaf.anonymous = true;
  return leaf;
}

interface BuildContext {
  rootFontSizePx: number;
  cellMetrics: CellMetrics | undefined;
  textareaWidths: TextareaWidths | undefined;
}

/** The host's own inline content as the ROOT leaf (specs/host-leaf.md):
 * null when an element child is block-level (the host is a container)
 * or there is no inline content at all (the empty root). The metrics
 * probe is never part of the run. */
export function buildRootLeaf(
  host: Element,
  rootFontSizePx: number,
  cellMetrics?: CellMetrics,
  textareaWidths?: TextareaWidths,
): LayoutNode | null {
  const nodes = Array.from(host.childNodes).filter(
    (node) => !(node instanceof Element && node.hasAttribute("data-mw-probe")),
  );
  const elementChildren = nodes.filter((node): node is Element => node instanceof Element);
  const roles = elementChildren.map(childRole);
  if (roles.includes("block") || splitsForBlock(elementChildren, roles)) return null;
  if (!hasDirectText(host) && !roles.includes("inline")) return null;
  const style = hostLeafStyle(host, rootFontSizePx, cellMetrics);
  const context = { rootFontSizePx, cellMetrics, textareaWidths };
  return buildLeaf(host, style, elementChildren, roles, context, nodes);
}

/** The style of the host's own text (specs/host-leaf.md): its text
 * properties on no box, with no tracking or line gap — the host's
 * letter-spacing and line-height are the cell — taking pointer events
 * whatever the host's own value, as the host's top-level elements read
 * them (element.ts). */
export function hostLeafStyle(
  host: Element,
  rootFontSizePx: number,
  metrics?: CellMetrics,
): CellStyle {
  return {
    ...leafStyleOf(host, rootFontSizePx, metrics),
    tracking: 0,
    lineGap: 0,
    pointerEvents: true,
  };
}

/** A leaf's style from an element's text and inherited paint
 * properties, on no box of its own (padding, border, margin, and size
 * stay the element's): the root leaf's and an anonymous run's. */
function leafStyleOf(el: Element, rootFontSizePx: number, metrics?: CellMetrics): CellStyle {
  const cs = getComputedStyle(el);
  const fontSizePx = parseFloat(cs.fontSize) || rootFontSizePx;
  const style: CellStyle = {
    ...defaultCellStyle(),
    ...readTextStyle(el, cs, rootFontSizePx),
    lineGap: lineGapRows(cs.lineHeight, fontSizePx),
    tracking: trackingCells(cs.letterSpacing, fontSizePx, metrics?.letterSpacing ?? 0),
    color: cs.color,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    visible: readVisible(cs, el),
    pointerEvents: cs.pointerEvents !== "none",
  };
  // Truncation needs the clip; any other overflow stays the root's.
  if (readOverflow(cs).x === "clip") style.overflow = { ...style.overflow, x: "clip" };
  return style;
}

/** A leaf over `nodes` (the element's child nodes by default): in-flow
 * inline content forms the text run (atomic inline boxes ride it as
 * U+FFFC markers); out-of-flow children become layout nodes for the
 * positioning pass. */
function buildLeaf(
  root: Element,
  style: CellStyle,
  elementChildren: Element[],
  roles: ChildRole[],
  context: BuildContext,
  nodes?: ChildNode[],
): LayoutNode {
  const { rootFontSizePx, cellMetrics, textareaWidths } = context;
  const tag = root.tagName;
  const formControl = isFormControlTag(tag);
  const run = extractLeafRun(
    root,
    style.tracking,
    {
      rootFontSizePx,
      rootLetterSpacingPx: cellMetrics?.letterSpacing ?? 0,
      cellMetrics,
      textareaWidths,
      preserve: style.whiteSpace === "pre",
      tabSize: style.tabSize,
    },
    nodes,
  );
  const text = run.chars.join("");
  // The run's per-cluster arrays expand to code units, like `text`: a
  // cluster's advance sits on its first unit and its inline index on
  // every unit (specs/wide-characters.md).
  const { advances, charInline } = expandClusters(run);
  // Intrinsic advances for the box markers are the boxes' own width
  // contributions — a sized box counts its width, not its content;
  // layout overwrites them with the laid-out widths per pass.
  if (run.boxes.length > 0) {
    const cache = makeIntrinsicCache();
    eachObjectMarker(text, (charIndex, boxIndex) => {
      advances[charIndex] = Math.max(1, widthContribution(run.boxes[boxIndex]!, "max", cache));
    });
  }
  // Form controls with no explicit width would otherwise be 0 cells
  // wide (their leaf is empty; the value renders natively). Intrinsic
  // widths mirror the native ones: input's size attribute, textarea's
  // cols, and a select's option labels — the longest by default, the
  // SELECTED one under `field-sizing: content`, like the browser.
  let intrinsicWidth = longestLineAdvance(text, advances, style.tracking);
  if (formControl && intrinsicWidth === 0) {
    // Number(): happy-dom (tests) returns these attributes as strings.
    if (tag === "INPUT") intrinsicWidth = Number((root as HTMLInputElement).size) || 20;
    else if (tag === "TEXTAREA") intrinsicWidth = Number((root as HTMLTextAreaElement).cols) || 20;
    else {
      const select = root as HTMLSelectElement;
      // .label ?? .textContent: happy-dom (tests) lacks option.label.
      const labelOf = (option: HTMLOptionElement | undefined) =>
        option?.label || option?.textContent || "";
      const labels =
        getComputedStyle(root).getPropertyValue("field-sizing") === "content"
          ? [labelOf(select.selectedOptions[0])]
          : Array.from(select.options, labelOf);
      intrinsicWidth = Math.max(1, ...labels.map((label) => textCells(label.trim())));
    }
  }
  // Form controls always reserve at least one content row (native
  // shows a caret-height field even empty). CSS `min-height` can't
  // do it — it floors the outer box, which the border already
  // exceeds.
  const contentHeight = text.length > 0 ? countHardLines(text) : 0;
  let intrinsicHeight: number;
  if (tag === "TEXTAREA") {
    const textarea = root as HTMLTextAreaElement;
    const value = textarea.value ?? "";
    // Row count = wrap the value against the textarea's current
    // content-area width in cells (captured by the host pre-
    // measuring so it reflects the engine-assigned width, not the
    // browser default that applies while measuring is on). Pure
    // and monotonic, so the box grows AND shrinks as the width
    // changes — max-w-full under viewport resize, flex reflow,
    // typing that wraps. Fallback for the first-ever layout (no
    // snapshot yet): hard-line count only.
    const contentCells = textareaWidths?.get(textarea);
    // Unlike `<br>` (whose trailing break is dropped, per CSS),
    // a textarea SHOWS the empty line after a trailing `\n` — that
    // extra visible row is where the caret sits after Enter.
    const trailingLine = value.endsWith("\n") ? 1 : 0;
    const wrappedLines =
      contentCells !== undefined && contentCells > 0
        ? wrapLineCount(value, contentCells, { advances: clusterAdvances(value) }) + trailingLine
        : value === ""
          ? 0
          : value.split(/\r\n?|\n/).length;
    const rowsFloor =
      getComputedStyle(root).getPropertyValue("field-sizing") === "content"
        ? 1
        : Number(textarea.rows) || 2;
    const lines = Math.max(rowsFloor, wrappedLines);
    // Leading: N lines occupy N + (N − 1) × gap rows, same as any
    // laid-out leaf (specs/cell-model.md "Line height on the grid").
    intrinsicHeight = lines + Math.max(0, lines - 1) * style.lineGap;
  } else if (formControl) {
    intrinsicHeight = Math.max(1, contentHeight);
  } else {
    intrinsicHeight = contentHeight;
  }
  // `children` in DOCUMENT order: paint-order ties (same z-index)
  // resolve as CSS would — later DOM wins — and the atomic inline
  // boxes come out in U+FFFC marker order (inlineBoxesOf). Direct
  // boxes interleave with out-of-flow siblings by construction; a
  // box nested in an inline ancestor is sorted into place.
  // What the loop below places, which is not always the root's own
  // children: an anonymous leaf takes the run's elements, and a split
  // inline puts its children among them.
  const placed = new Set(elementChildren);
  const directBoxes = new Map<Element, LayoutNode>();
  const nestedBoxes: LayoutNode[] = [];
  for (const box of run.boxes) {
    if (placed.has(box.source)) directBoxes.set(box.source, box);
    else nestedBoxes.push(box);
  }
  // An out-of-flow element the run met below one the loop places: it
  // never reaches that loop, so it joins the nested boxes and sorts
  // into document order with them.
  for (const box of run.positioned) {
    if (!placed.has(box.source)) nestedBoxes.push(box);
  }
  const children: LayoutNode[] = [];
  for (let i = 0; i < elementChildren.length; i++) {
    const el = elementChildren[i]!;
    const box = directBoxes.get(el);
    if (box) children.push(box);
    else if (roles[i] === "out-of-flow") {
      const child = buildTree(el, rootFontSizePx, cellMetrics, textareaWidths);
      if (child) children.push(fadedBy(child, splitOpacity(el, root)));
    }
  }
  if (nestedBoxes.length > 0) {
    children.push(...nestedBoxes);
    children.sort((a, b) =>
      a.source.compareDocumentPosition(b.source) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  }
  const node: LayoutNode = {
    source: root,
    style,
    children,
    text,
    intrinsicWidth,
    intrinsicHeight,
    localRect: { x: 0, y: 0, width: intrinsicWidth, height: intrinsicHeight },
    unclampedHeight: 0,
    naturalContentHeight: 0,
    resolvedPadding: zeroInsets(),
  };
  if (advances.some((a) => a !== 1) || run.boxes.length > 0) node.advances = advances;
  if (run.inlineElements.length > 0) {
    node.inlineElements = run.inlineElements;
    node.charInline = charInline;
  }
  const charSource = charSourceRuns(run);
  if (charSource.length > 0) node.charSource = charSource;
  return node;
}

/** A registered leaf renderer's node (specs/leaf-renderers.md): the
 * renderer's lines become the leaf's preformatted text (white-space
 * styling does not apply — the lines ARE the content), and its paint
 * runs ride the existing inline-run machinery as paint-only entries
 * with neutral geometry, so the painters need no new path. */
function buildRendererLeaf(
  root: Element,
  style: ReturnType<typeof readCellStyle>,
  leaf: LeafRegistration,
): LayoutNode {
  const content = renderLeafContent(leaf, root);
  const lines = content?.lines ?? [];
  const text = lines.join("\n");
  style.whiteSpace = "pre";
  // Replaced-element sizing (like <img>): auto width means intrinsic,
  // not stretch — and it must live HERE, not in companion CSS, because
  // Gecko's computed styles never surface intrinsic keywords (only the
  // class scan would see a `w-max`, and a stylesheet rule has neither).
  if (style.width === undefined || style.width.kind === "auto") {
    style.width = { kind: "max-content" };
  }
  // Cluster widths plus tracking, applied uniformly so the art
  // stretches coherently (columns stay aligned across rows, like
  // letter-spacing on a pre).
  const advances = clusterAdvances(text, style.tracking);
  const intrinsicWidth = longestLineAdvance(text, advances, style.tracking);
  const intrinsicHeight = lines.length;
  const node: LayoutNode = {
    source: root,
    style,
    children: [],
    text,
    intrinsicWidth,
    intrinsicHeight,
    localRect: { x: 0, y: 0, width: intrinsicWidth, height: intrinsicHeight },
    unclampedHeight: 0,
    naturalContentHeight: 0,
    resolvedPadding: zeroInsets(),
  };
  if (advances.some((a) => a !== 1)) node.advances = advances;
  const runs = content?.runs ?? [];
  if (runs.length > 0 && text.length > 0) {
    // Line start offsets into the joined text (newlines included).
    const lineStart: number[] = [0];
    for (const line of lines) lineStart.push(lineStart[lineStart.length - 1]! + line.length + 1);
    const charInline = Array.from({ length: text.length }, () => -1);
    node.inlineElements = runs.map((run) => ({
      element: root,
      tracking: 0,
      padLeft: 0,
      padRight: 0,
      insets: null,
      anchorNames: [],
      // What a run leaves unset is the leaf's, as a span inherits it.
      color: run.paint.color ?? style.color,
      backgroundColor: run.paint.backgroundColor,
      fontWeight: run.paint.fontWeight ?? style.fontWeight,
      fontStyle: run.paint.fontStyle ?? style.fontStyle,
      textDecorationLine: run.paint.textDecorationLine ?? style.textDecorationLine,
      visible: node.style.visible,
      pointerEvents: node.style.pointerEvents,
      opacity: 1,
    }));
    runs.forEach((run, index) => {
      const line = lines[run.line];
      if (line === undefined) return;
      const from = Math.max(0, run.start);
      const to = Math.min(line.length, run.end);
      for (let col = from; col < to; col++) charInline[lineStart[run.line]! + col] = index;
    });
    node.charInline = charInline;
  }
  return node;
}

/**
 * HTML tags whose default display is inline — a FALLBACK for environments
 * whose getComputedStyle returns "" for un-styled elements (happy-dom in
 * the headless tests). Real browsers always resolve a computed display,
 * so there this list is never consulted: computed display decides, and
 * CSS blockification (flex/grid children, absolute positioning) is
 * honored (specs/cell-model.md "Inline detection").
 */
const FALLBACK_INLINE_TAGS = new Set([
  "A",
  "ABBR",
  "B",
  "BDI",
  "BDO",
  "BR",
  "CITE",
  "CODE",
  "DATA",
  "DFN",
  "EM",
  "I",
  "KBD",
  "MARK",
  "Q",
  "S",
  "SAMP",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
  "TIME",
  "U",
  "VAR",
  "WBR",
]);

/** Resolve a computed display, falling back per tag for environments
 * that return "" (happy-dom). */
function resolvedDisplay(el: Element, display: string): string {
  return display || (FALLBACK_INLINE_TAGS.has(el.tagName) ? "inline" : "block");
}

/** True for content that flows WITH the surrounding text (computed
 * `inline` or `contents`). */
function isRunInline(el: Element, display: string): boolean {
  const resolved = resolvedDisplay(el, display);
  return resolved === "inline" || resolved === "contents";
}

/** Atomic inline-level boxes (`inline-flex`/`inline-block`/`inline-grid`)
 * ride the line as single unbreakable units with their own internal
 * layout (specs/cell-model.md). */
function isAtomicInline(el: Element, display: string): boolean {
  const resolved = resolvedDisplay(el, display);
  return resolved.startsWith("inline") && resolved !== "inline";
}

/** Classify a direct child: skipped, out-of-flow box, text-run content
 * (plain inline AND atomic inline boxes), or in-flow block (which forces
 * container mode). */
type ChildRole = "none" | "out-of-flow" | "inline" | "block";

/** A block hiding under a run-inline element, which CSS lays out by
 * splitting the inline box around it (CSS 2.1 block-in-inline): the
 * engine splits by flattening that element into its parent's children,
 * so the block becomes a node of its own and the inline content each
 * side of it an anonymous run. An atomic inline box is its own
 * formatting context and keeps its blocks; an inline element with no
 * element children — nearly all of them — answers before reading a
 * style. */
function hidesBlock(el: Element): boolean {
  if (el.children.length === 0) return false;
  if (!isRunInline(el, getComputedStyle(el).display)) return false;
  for (const child of el.children) {
    const role = childRole(child);
    if (role === "block") return true;
    if (role === "inline" && hidesBlock(child)) return true;
  }
  return false;
}

/** Whether an element's children hold a block below an inline one,
 * which makes their parent a container rather than a leaf. */
function splitsForBlock(children: Element[], roles: ChildRole[]): boolean {
  return children.some((child, index) => roles[index] === "inline" && hidesBlock(child));
}

function childRole(el: Element): ChildRole {
  const cs = getComputedStyle(el);
  const { display, position } = cs;
  if (display === "none") return "none";
  if (position === "absolute" || position === "fixed") return "out-of-flow";
  // A float is block-level whatever its display (specs/float.md): it
  // leaves the text run, which re-wraps around it as anonymous runs.
  if (isFloated(cs.float)) return "block";
  // Registered leaf renderers are always block participants — an
  // unstyled custom element computes to `inline`, which would fold
  // its semantic text into the parent's run instead of rendering.
  if (leafRendererFor(el.tagName)) return "block";
  if (isRunInline(el, display) || isAtomicInline(el, display)) return "inline";
  return "block";
}

interface LeafRun {
  chars: string[];
  /** Cells each character occupies: `1 + tracking` of its innermost element. */
  advances: number[];
  /** Per character: the source Text node and offset (`null`/-1 for
   * `<br>` newlines and markers). Compacted into `charSource` runs. */
  sourceNode: (Text | null)[];
  sourceOffset: number[];
  /** Per character: index into `inlineElements` (-1 = direct leaf text). */
  inlineIndex: number[];
  inlineElements: NonNullable<LayoutNode["inlineElements"]>;
  /** Atomic inline boxes, in run order — each corresponds to one U+FFFC
   * marker in `chars` (layout resolves the marker's advance to the box's
   * laid-out width). */
  boxes: LayoutNode[];
  /** Out-of-flow elements met inside the run, at any depth: they take
   * no character, and the leaf hangs them off itself for the
   * positioning pass the way it does its own. */
  positioned: LayoutNode[];
}

interface RunContext {
  rootFontSizePx: number;
  rootLetterSpacingPx: number;
  cellMetrics: CellMetrics | undefined;
  textareaWidths: TextareaWidths | undefined;
  /** Leaf-level `white-space: pre`: keep the source's spaces and newlines
   * (tabs expand to `tabSize` stops from each hard line's start) instead
   * of collapsing. Applies to the whole run — a `white-space` override on
   * an inline descendant is not honored (specs/cell-model.md). */
  preserve: boolean;
  tabSize: number;
}

/**
 * Walk a leaf's childNodes and produce its text run — with `<br>` emitted as
 * `\n` so the wrap calculation counts the line break the browser will honor
 * — plus per-character advances and the inline elements the renderer must
 * write grid typography (and rewritten relative insets) onto.
 *
 * Whitespace inside text nodes (including literal newlines from source
 * formatting) collapses to single spaces, exactly like the browser under
 * `white-space: normal` — ONLY `<br>` produces a hard `\n`. Whitespace
 * around a hard break is stripped (the browser strips it at line edges too).
 * CSS collapsible white space only (space/tab/CR/LF/FF) — NOT `\s`, which
 * would also eat NBSP (U+00A0); the browser preserves NBSP and never breaks
 * at it. A `white-space: pre` leaf skips all of that: spaces and newlines
 * survive as authored and tabs expand to tab stops (see RunContext).
 */
function extractLeafRun(
  el: Element,
  tracking: number,
  ctx: RunContext,
  nodes?: ChildNode[],
): LeafRun {
  const run: LeafRun = {
    chars: [],
    advances: [],
    sourceNode: [],
    sourceOffset: [],
    inlineIndex: [],
    inlineElements: [],
    boxes: [],
    positioned: [],
  };
  if (nodes) collectRunNodes(el, nodes, tracking, ctx, run);
  else collectRun(el, tracking, ctx, run);
  if (ctx.preserve) {
    // A final newline gets no line box of its own — the wrap layer's
    // dropFinalBreakSpan rule (the HTML parser already ate the one right
    // after the opening tag).
    return run;
  }
  return normalizeRun(run);
}

/** An anonymous run's nodes, those an inline element split around a
 * block left in it (specs/cell-model.md "Inline content") under an
 * entry of that element's, so they keep its style. */
function collectRunNodes(
  container: Element,
  nodes: ChildNode[],
  tracking: number,
  ctx: RunContext,
  run: LeafRun,
): void {
  for (let i = 0; i < nodes.length;) {
    const owner = nodes[i]!.parentElement;
    let end = i + 1;
    while (end < nodes.length && nodes[end]!.parentElement === owner) end++;
    const group = nodes.slice(i, end);
    if (!owner || owner === container) {
      collectNodes(group, tracking, ctx, run);
    } else {
      const outer = splitOpacity(owner, container);
      const entry = inlineEntry(owner, getComputedStyle(owner), 0, 0, ctx, outer);
      collectOwned(run, entry, () => collectNodes(group, entry.tracking, ctx, run, entry.opacity));
    }
    i = end;
  }
}

/** An inline element's entry, and the characters it collects: those a
 * deeper element has not claimed are the entry's. */
function collectOwned(
  run: LeafRun,
  entry: LeafRun["inlineElements"][number],
  collect: () => void,
): void {
  const inlineIndex = run.inlineElements.push(entry) - 1;
  const start = run.chars.length;
  collect();
  for (let i = start; i < run.chars.length; i++) {
    if (run.inlineIndex[i] === undefined) run.inlineIndex[i] = inlineIndex;
  }
}

/** The opacity of the inline elements a block split left between an
 * element and its container (specs/cell-model.md "Inline content"),
 * multiplied; 1 for the container's own child. */
function splitOpacity(el: Element, container: Element): number {
  let opacity = 1;
  for (let at = el.parentElement; at && at !== container; at = at.parentElement) {
    opacity *= readOpacity(getComputedStyle(at).opacity);
  }
  return opacity;
}

/** A box inside inline elements carrying `opacity`, theirs multiplied
 * (LayoutNode `inlineOpacity`). */
function fadedBy(node: LayoutNode, opacity: number): LayoutNode {
  if (opacity < 1) node.inlineOpacity = opacity;
  return node;
}

/** An inline element's entry in its run, from its computed style, its
 * opacity times `outer`, its inline ancestors'. */
function inlineEntry(
  element: Element,
  cs: CSSStyleDeclaration,
  padLeft: number,
  padRight: number,
  ctx: RunContext,
  outer: number,
): LeafRun["inlineElements"][number] {
  const { position, backgroundColor } = cs;
  return {
    element,
    tracking: trackingCells(
      cs.letterSpacing,
      parseFloat(cs.fontSize) || ctx.rootFontSizePx,
      ctx.rootLetterSpacingPx,
    ),
    padLeft,
    padRight,
    insets: position === "relative" ? inlineInsets(cs, ctx.rootFontSizePx) : null,
    ...(position === "sticky" ? { sticky: inlineInsets(cs, ctx.rootFontSizePx) } : {}),
    anchorNames: readAnchorNames(element, cs),
    color: cs.color,
    backgroundColor: isTransparentColor(backgroundColor) ? undefined : backgroundColor,
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    textDecorationLine: cs.textDecorationLine,
    visible: readVisible(cs, element),
    pointerEvents: cs.pointerEvents !== "none",
    opacity: outer * readOpacity(cs.opacity),
  };
}

function collectRun(
  el: Element,
  tracking: number,
  ctx: RunContext,
  run: LeafRun,
  opacity = 1,
): void {
  // Form controls render their value / caret / selection natively —
  // leave the leaf empty so the grid doesn't double-render, and skip
  // descending into their internals (e.g. <select>'s <option>s).
  if (isFormControlTag(el.tagName)) return;
  collectNodes(Array.from(el.childNodes), tracking, ctx, run, opacity);
}

function collectNodes(
  nodes: ChildNode[],
  tracking: number,
  ctx: RunContext,
  run: LeafRun,
  opacity = 1,
): void {
  // Cells since the current hard line began — the tab-stop basis.
  const column = (): number => {
    let cells = 0;
    for (let i = run.chars.length - 1; i >= 0 && run.chars[i] !== "\n"; i--) {
      cells += run.advances[i]!;
    }
    return cells;
  };
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (ctx.preserve) {
        // `white-space: pre`: spaces and newlines survive as authored;
        // tabs expand to the next `tabSize` stop (spaces are pushed
        // untracked — tab stops are grid columns, not glyphs).
        const text = node.textContent ?? "";
        let offset = 0;
        for (const ch of graphemes(text)) {
          const at = offset;
          offset += ch.length;
          if (ch === "\r\n" || ch === "\r" || ch === "\n") {
            // CRLF is one cluster: the LF carries the break.
            pushChar(run, "\n", 0, node as Text, at + ch.length - 1);
          } else if (ch === "\t") {
            const target = (Math.floor(column() / ctx.tabSize) + 1) * ctx.tabSize;
            for (let cells = column(); cells < target; cells++) {
              pushChar(run, " ", 1, node as Text, at);
            }
          } else {
            pushChar(run, ch, clusterAdvance(ch, tracking), node as Text, at);
          }
        }
      } else {
        // Collapsible white space (space/tab/CR/LF/FF) folds to one
        // space that keeps the first collapsed character's offset.
        let offset = 0;
        let inSpace = false;
        for (const ch of graphemes(node.textContent ?? "")) {
          const collapsible =
            ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\r\n";
          if (!collapsible) pushChar(run, ch, clusterAdvance(ch, tracking), node as Text, offset);
          else if (!inSpace) pushChar(run, " ", 1 + tracking, node as Text, offset);
          inSpace = collapsible;
          offset += ch.length;
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (child.tagName === "BR") {
        pushChar(run, "\n", 0, null, -1);
        continue;
      }
      // Reads happen during the measure pass, so authored values are visible.
      const cs = getComputedStyle(child);
      const { display, position } = cs;
      // A hidden span's text must not render.
      if (display === "none") continue;
      // Out-of-flow content leaves the run but not the tree: it takes
      // no character, and the leaf keeps it for the positioning pass
      // (a popover inside an inline element is one, and so is every
      // positioner a custom element wraps).
      if (position === "absolute" || position === "fixed") {
        const box = buildTree(child, ctx.rootFontSizePx, ctx.cellMetrics, ctx.textareaWidths);
        if (box) run.positioned.push(fadedBy(box, opacity));
        continue;
      }
      // An atomic inline box rides the run as ONE unbreakable unit: a
      // U+FFFC marker whose advance layout resolves to the box's width.
      if (isAtomicInline(child, display)) {
        const box = buildTree(child, ctx.rootFontSizePx, ctx.cellMetrics, ctx.textareaWidths);
        if (box) {
          box.inlineBox = true;
          pushChar(run, OBJECT_REPLACEMENT, 1, null, -1);
          run.boxes.push(fadedBy(box, opacity));
        }
        continue;
      }
      // A BLOCK-level element nested inside the run can't be laid out
      // from here — skip its subtree and warn.
      if (!isRunInline(child, display)) {
        warnSkippedRunContent(child);
        continue;
      }
      // Horizontal padding on an inline element (`px-1` badges), quantized
      // to cells: the run reserves the cells as 1-cell INLINE_PAD markers
      // glued to the element's edges, and the renderer writes the same
      // cells back as real padding (percent padding is unsupported and
      // reads as 0; vertical inline padding never moves layout, per CSS,
      // and passes through untouched).
      const padLeft = inlinePadCells(cs.paddingLeft, ctx.rootFontSizePx);
      const padRight = inlinePadCells(cs.paddingRight, ctx.rootFontSizePx);
      warnInlineBorder(child, cs);
      const entry = inlineEntry(child, cs, padLeft, padRight, ctx, opacity);
      // Pad cells belong to the element too (its bg must fill them).
      collectOwned(run, entry, () => {
        for (let i = 0; i < padLeft; i++) pushChar(run, INLINE_PAD, 1, null, -1);
        collectRun(child, entry.tracking, ctx, run, entry.opacity);
        for (let i = 0; i < padRight; i++) pushChar(run, INLINE_PAD, 1, null, -1);
      });
    }
  }
}

/** Quantize an inline element's horizontal padding to cells. Computed
 * padding is px in every browser; a percent that survives (pre-Typed-OM
 * quirk) is unsupported on inline elements and reads as 0. */
function inlinePadCells(value: string, rootFontSizePx: number): number {
  if (!value || value.endsWith("%")) return 0;
  const px = parseFloat(value);
  return Number.isFinite(px) ? Math.max(0, pxToCells(px, rootFontSizePx)) : 0;
}

/** Authored insets of an inline relative element (offsets) or sticky
 * element (constraints, specs/sticky.md), in whole cells
 * (specs/positioning.md).
 * Percent insets on inline elements are unsupported (`null`), a
 * documented deviation. (Absolute/fixed inline elements never reach
 * here — they leave the run as out-of-flow boxes.) */
function inlineInsets(cs: CSSStyleDeclaration, rootFontSizePx: number): PerSide<number | null> {
  const side = (value: string): number | null => {
    if (!value || value === "auto" || value.endsWith("%")) return null;
    const px = parseFloat(value);
    return Number.isFinite(px) ? pxToCells(px, rootFontSizePx) : null;
  };
  return { top: side(cs.top), right: side(cs.right), bottom: side(cs.bottom), left: side(cs.left) };
}

/** Collapse consecutive spaces (also across inline-element boundaries), trim
 * spaces at hard-line edges, and drop leading/trailing blank lines — keeping
 * chars and advances in lockstep. */
function normalizeRun(run: LeafRun): LeafRun {
  const chars: string[] = [];
  const advances: number[] = [];
  const sourceNode: (Text | null)[] = [];
  const sourceOffset: number[] = [];
  const inlineIndex: number[] = [];
  const lineStart = () => {
    let i = chars.length;
    while (i > 0 && chars[i - 1] !== "\n") i--;
    return i;
  };
  const trimLineEnd = () => {
    while (chars.length > lineStart() && chars[chars.length - 1] === " ") {
      chars.pop();
      advances.pop();
      sourceNode.pop();
      sourceOffset.pop();
      inlineIndex.pop();
    }
  };
  for (let i = 0; i < run.chars.length; i++) {
    const ch = run.chars[i]!;
    if (ch === " ") {
      // Skip spaces at a line start and after another space. Collapsing
      // looks THROUGH inline-padding markers: white-space processing is
      // character-based, so padding between two spaces doesn't stop them
      // collapsing (and a space preceded only by padding still counts as
      // line-start, both per CSS).
      let previous = chars.length - 1;
      while (previous >= 0 && chars[previous] === INLINE_PAD) previous--;
      const atLineStart = previous < 0 || chars[previous] === "\n";
      if (atLineStart || chars[previous] === " ") continue;
    } else if (ch === "\n") {
      trimLineEnd();
    }
    chars.push(ch);
    advances.push(run.advances[i]!);
    sourceNode.push(run.sourceNode[i] ?? null);
    sourceOffset.push(run.sourceOffset[i] ?? -1);
    inlineIndex.push(run.inlineIndex[i] ?? -1);
  }
  trimLineEnd();
  // Edge `\n`s stay: every leading <br> creates a line box and all but
  // the final trailing one do (probed, all engines) — the wrap layer
  // drops exactly that last one (dropFinalBreakSpan).
  return {
    chars,
    advances,
    sourceNode,
    sourceOffset,
    inlineIndex,
    inlineElements: run.inlineElements,
    boxes: run.boxes,
    positioned: run.positioned,
  };
}

function pushChar(run: LeafRun, ch: string, advance: number, source: Text | null, offset: number) {
  run.chars.push(ch);
  run.advances.push(advance);
  run.sourceNode.push(source);
  run.sourceOffset.push(offset);
}

/** The run's per-cluster advances and inline indices, expanded to one
 * entry per code unit of the joined text: a cluster's advance on its
 * first unit and 0 on the rest, its inline index on every unit. */
function expandClusters(run: LeafRun): { advances: number[]; charInline: number[] } {
  const advances: number[] = [];
  const charInline: number[] = [];
  for (let i = 0; i < run.chars.length; i++) {
    const inline = run.inlineIndex[i] ?? -1;
    advances.push(run.advances[i]!);
    charInline.push(inline);
    for (let unit = 1; unit < run.chars[i]!.length; unit++) {
      advances.push(0);
      charInline.push(inline);
    }
  }
  return { advances, charInline };
}

/** Compact the per-character source map into runs (`LayoutNode.charSource`):
 * a run grows while the next character continues the same Text node at
 * the next offset. */
function charSourceRuns(run: LeafRun): CharSourceRun[] {
  const runs: CharSourceRun[] = [];
  let index = 0;
  for (let i = 0; i < run.chars.length; i++) {
    const ch = run.chars[i]!;
    const node = run.sourceNode[i];
    const offset = run.sourceOffset[i]!;
    const last = runs[runs.length - 1];
    if (node) {
      if (last && last.node === node && last.offset + last.length === offset)
        last.length += ch.length;
      else runs.push({ index, length: ch.length, node, offset });
    }
    index += ch.length;
  }
  return runs;
}

function longestLineAdvance(text: string, advances: number[], tracking: number): number {
  let max = 0;
  let lineStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "\n") {
      max = Math.max(max, lineAdvance(text, lineStart, i, advances, tracking));
      lineStart = i + 1;
    }
  }
  return max;
}

function countHardLines(text: string): number {
  return hardLineSpans(text).length;
}

/** The inline elements whose border was checked, each once. */
const borderChecked = new WeakSet<Element>();

/** Warns once about an inline element's border, which draws nothing. */
function warnInlineBorder(el: Element, cs: CSSStyleDeclaration): void {
  if (borderChecked.has(el)) return;
  borderChecked.add(el);
  const widths = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth];
  if (!widths.some((width) => parseFloat(width) > 0)) return;
  warnOnce(
    el,
    "A border on an inline element is ignored — the grid draws borders around boxes. " +
      "Give it a box of its own (inline-block, or block) instead.",
  );
}

function warnSkippedRunContent(el: Element): void {
  warnOnce(
    el,
    "A block-level element nested inside a text run can't be laid out and was " +
      "skipped. Give it its own place in the layout instead.",
  );
}

/** True if `el` has any direct text child that isn't just whitespace. */
function hasDirectText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (child) => child.nodeType === Node.TEXT_NODE && /[^ \t\r\n\f]/.test(child.textContent ?? ""),
  );
}

/** A computed `float` that takes the element out of the text run
 * (specs/float.md); `inline-start`/`inline-end` are the logical
 * spellings a browser may report. */
function isFloated(value: string): boolean {
  return value !== "none" && value !== "";
}

/** True for tags whose value/caret/selection are handled by the browser
 * natively — the tree builder treats them as empty leaves. */
export function isFormControlTag(tag: string): boolean {
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}
