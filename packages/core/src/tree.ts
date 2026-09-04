import { intrinsicOuterWidth, makeIntrinsicCache } from "./layout.ts";
import { leafRendererFor, renderLeafContent } from "./leaf.ts";
import type { LeafRegistration } from "./leaf.ts";
import { pxToCells } from "./metrics.ts";
import { isTransparentColor, readCellStyle, trackingCells } from "./style.ts";
import { zeroInsets } from "./types.ts";
import { warnOnce } from "./warn.ts";
import {
  eachObjectMarker,
  hardLineSpans,
  INLINE_PAD,
  lineAdvance,
  OBJECT_REPLACEMENT,
  wrapLineCount,
} from "./wrap.ts";
import type { CellMetrics, CharSourceRun, LayoutNode, PerSide } from "./types.ts";

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
 * - An element is a **leaf** when it has no IN-FLOW block-level element
 *   children: in-flow inline children (computed `inline`/`inline-*`/
 *   `contents`) are part of the text run, and out-of-flow children
 *   (absolute/fixed — blockified per CSS) hang off the leaf as layout
 *   nodes for the positioning pass. The leaf's `text` is its combined
 *   in-flow text, so text nodes interleaved with inline elements
 *   (`<div>hello <span>world</span></div>`) participate in the wrap
 *   calculation and render correctly.
 * - Elements with at least one in-flow block-level element child become
 *   **containers** and recurse. Direct text nodes on containers (uncommon
 *   in utility-first markup) are not laid out — a documented deviation.
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

  // Form controls are always leaves — descending into a <select>'s
  // <option>s would leak that text into the grid.
  const tag = root.tagName;
  const formControl = isFormControlTag(tag);

  if (!roles.includes("block") || formControl) {
    // Leaf: in-flow inline content forms the text run (atomic inline
    // boxes ride it as U+FFFC markers); out-of-flow children become
    // layout nodes for the positioning pass.
    const run = extractLeafRun(root, style.tracking, {
      rootFontSizePx,
      rootLetterSpacingPx: cellMetrics?.letterSpacing ?? 0,
      cellMetrics,
      textareaWidths,
      preserve: style.whiteSpace === "pre",
      tabSize: style.tabSize,
    });
    const text = run.chars.join("");
    // Intrinsic advances for the box markers use the boxes' max-content
    // widths; layout overwrites them with the laid-out widths per pass.
    if (run.boxes.length > 0) {
      const cache = makeIntrinsicCache();
      eachObjectMarker(run.chars, (charIndex, boxIndex) => {
        run.advances[charIndex] = Math.max(1, intrinsicOuterWidth(run.boxes[boxIndex]!, cache));
      });
    }
    // Form controls with no explicit width would otherwise be 0 cells
    // wide (their leaf is empty; the value renders natively). Intrinsic
    // widths mirror the native ones: input's size attribute, textarea's
    // cols, and a select's option labels — the longest by default, the
    // SELECTED one under `field-sizing: content`, like the browser.
    let intrinsicWidth = longestLineAdvance(text, run.advances, style.tracking);
    if (formControl && intrinsicWidth === 0) {
      // Number(): happy-dom (tests) returns these attributes as strings.
      if (tag === "INPUT") intrinsicWidth = Number((root as HTMLInputElement).size) || 20;
      else if (tag === "TEXTAREA")
        intrinsicWidth = Number((root as HTMLTextAreaElement).cols) || 20;
      else {
        const select = root as HTMLSelectElement;
        // .label ?? .textContent: happy-dom (tests) lacks option.label.
        const labelOf = (option: HTMLOptionElement | undefined) =>
          option?.label || option?.textContent || "";
        const labels =
          getComputedStyle(root).getPropertyValue("field-sizing") === "content"
            ? [labelOf(select.selectedOptions[0])]
            : Array.from(select.options, labelOf);
        intrinsicWidth = Math.max(1, ...labels.map((label) => label.trim().length));
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
          ? wrapLineCount(value, contentCells) + trailingLine
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
    const directBoxes = new Map<Element, LayoutNode>();
    const nestedBoxes: LayoutNode[] = [];
    for (const box of run.boxes) {
      if (box.source.parentElement === root) directBoxes.set(box.source, box);
      else nestedBoxes.push(box);
    }
    const children: LayoutNode[] = [];
    for (let i = 0; i < elementChildren.length; i++) {
      const el = elementChildren[i]!;
      const box = directBoxes.get(el);
      if (box) children.push(box);
      else if (roles[i] === "out-of-flow") {
        const child = buildTree(el, rootFontSizePx, cellMetrics, textareaWidths);
        if (child) children.push(child);
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
      resolvedPadding: zeroInsets(),
    };
    if (run.advances.some((a) => a !== 1) || run.boxes.length > 0) node.advances = run.advances;
    if (run.inlineElements.length > 0) {
      node.inlineElements = run.inlineElements;
      node.charInline = run.chars.map((_, i) => run.inlineIndex[i] ?? -1);
    }
    const charSource = charSourceRuns(run);
    if (charSource.length > 0) node.charSource = charSource;
    return node;
  }

  const children: LayoutNode[] = [];
  for (let i = 0; i < elementChildren.length; i++) {
    if (roles[i] === "none") continue;
    const node = buildTree(elementChildren[i]!, rootFontSizePx, cellMetrics, textareaWidths);
    if (node) children.push(node);
  }
  const container: LayoutNode = {
    source: root,
    style,
    children,
    text: "",
    intrinsicWidth: 0,
    intrinsicHeight: 0,
    localRect: { x: 0, y: 0, width: 0, height: 0 },
    unclampedHeight: 0,
    resolvedPadding: zeroInsets(),
  };
  flagDroppedText(root, container);
  return container;
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
  // One cell per UTF-16 unit — consistent with the run mapping below
  // (astral glyph art is out of scope; fonts are BMP in practice) —
  // plus tracking, applied uniformly so the art stretches coherently
  // (columns stay aligned across rows, like letter-spacing on a pre).
  const advances = Array.from({ length: text.length }, () => 1 + style.tracking);
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
    resolvedPadding: zeroInsets(),
  };
  if (style.tracking > 0) node.advances = advances;
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
      color: run.paint.color,
      backgroundColor: run.paint.backgroundColor,
      fontWeight: run.paint.fontWeight ?? "",
      fontStyle: run.paint.fontStyle ?? "",
      textDecorationLine: run.paint.textDecorationLine ?? "",
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
function childRole(el: Element): "none" | "out-of-flow" | "inline" | "block" {
  const cs = getComputedStyle(el);
  if (cs.display === "none") return "none";
  if (cs.position === "absolute" || cs.position === "fixed") return "out-of-flow";
  // Registered leaf renderers are always block participants — an
  // unstyled custom element computes to `inline`, which would fold
  // its semantic text into the parent's run instead of rendering.
  if (leafRendererFor(el.tagName)) return "block";
  if (isRunInline(el, cs.display) || isAtomicInline(el, cs.display)) return "inline";
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
function extractLeafRun(el: Element, tracking: number, ctx: RunContext): LeafRun {
  const run: LeafRun = {
    chars: [],
    advances: [],
    sourceNode: [],
    sourceOffset: [],
    inlineIndex: [],
    inlineElements: [],
    boxes: [],
  };
  collectRun(el, tracking, ctx, run);
  if (ctx.preserve) {
    // A final newline gets no line box of its own — the wrap layer's
    // dropFinalBreakSpan rule (the HTML parser already ate the one right
    // after the opening tag).
    return run;
  }
  return normalizeRun(run);
}

function collectRun(el: Element, tracking: number, ctx: RunContext, run: LeafRun): void {
  // Cells since the current hard line began — the tab-stop basis.
  const column = (): number => {
    let cells = 0;
    for (let i = run.chars.length - 1; i >= 0 && run.chars[i] !== "\n"; i--) {
      cells += run.advances[i]!;
    }
    return cells;
  };
  // Form controls render their value / caret / selection natively —
  // leave the leaf empty so the grid doesn't double-render, and skip
  // descending into their internals (e.g. <select>'s <option>s).
  if (isFormControlTag(el.tagName)) return;
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (ctx.preserve) {
        // `white-space: pre`: spaces and newlines survive as authored;
        // tabs expand to the next `tabSize` stop (spaces are pushed
        // untracked — tab stops are grid columns, not glyphs).
        const text = node.textContent ?? "";
        let offset = 0;
        for (const ch of text) {
          const at = offset;
          offset += ch.length;
          if (ch === "\r") {
            if (text[offset] === "\n") continue; // CRLF: the LF carries the break
            pushChar(run, "\n", 0, node as Text, at);
          } else if (ch === "\n") {
            pushChar(run, "\n", 0, node as Text, at);
          } else if (ch === "\t") {
            const target = (Math.floor(column() / ctx.tabSize) + 1) * ctx.tabSize;
            for (let cells = column(); cells < target; cells++) {
              pushChar(run, " ", 1, node as Text, at);
            }
          } else {
            pushChar(run, ch, 1 + tracking, node as Text, at);
          }
        }
      } else {
        // Collapsible white space (space/tab/CR/LF/FF) folds to one
        // space that keeps the first collapsed character's offset.
        let offset = 0;
        let inSpace = false;
        for (const ch of node.textContent ?? "") {
          const collapsible =
            ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f";
          if (!collapsible) pushChar(run, ch, 1 + tracking, node as Text, offset);
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
      // Skipped or out-of-flow content never joins the run (a hidden
      // span's text must not render; an absolute span leaves the flow).
      if (cs.display === "none" || cs.position === "absolute" || cs.position === "fixed") continue;
      // An atomic inline box rides the run as ONE unbreakable unit: a
      // U+FFFC marker whose advance layout resolves to the box's width.
      if (isAtomicInline(child, cs.display)) {
        const box = buildTree(child, ctx.rootFontSizePx, ctx.cellMetrics, ctx.textareaWidths);
        if (box) {
          box.inlineBox = true;
          pushChar(run, OBJECT_REPLACEMENT, 1, null, -1);
          run.boxes.push(box);
        }
        continue;
      }
      // A BLOCK-level element nested inside the run can't be laid out
      // from here — skip its subtree and warn, mirroring dropped text.
      if (!isRunInline(child, cs.display)) {
        warnSkippedRunContent(child);
        continue;
      }
      const childTracking = trackingCells(
        cs.letterSpacing,
        parseFloat(cs.fontSize) || ctx.rootFontSizePx,
        ctx.rootLetterSpacingPx,
      );
      // Horizontal padding on an inline element (`px-1` badges), quantized
      // to cells: the run reserves the cells as 1-cell INLINE_PAD markers
      // glued to the element's edges, and the renderer writes the same
      // cells back as real padding (percent padding is unsupported and
      // reads as 0; vertical inline padding never moves layout, per CSS,
      // and passes through untouched).
      const padLeft = inlinePadCells(cs.paddingLeft, ctx.rootFontSizePx);
      const padRight = inlinePadCells(cs.paddingRight, ctx.rootFontSizePx);
      run.inlineElements.push({
        element: child,
        tracking: childTracking,
        padLeft,
        padRight,
        insets: cs.position === "static" ? null : inlineInsets(cs, ctx.rootFontSizePx),
        color: cs.color,
        backgroundColor: isTransparentColor(cs.backgroundColor) ? undefined : cs.backgroundColor,
        fontWeight: cs.fontWeight,
        fontStyle: cs.fontStyle,
        textDecorationLine: cs.textDecorationLine,
      });
      const inlineIndex = run.inlineElements.length - 1;
      // Pad cells belong to the element too (its bg must fill them).
      for (let i = 0; i < padLeft; i++) {
        run.inlineIndex[run.chars.length] = inlineIndex;
        pushChar(run, INLINE_PAD, 1, null, -1);
      }
      const start = run.chars.length;
      collectRun(child, childTracking, ctx, run);
      // Chars the recursion added belong to this element unless a deeper
      // one claimed them first.
      for (let i = start; i < run.chars.length; i++)
        if (run.inlineIndex[i] === undefined) run.inlineIndex[i] = inlineIndex;
      for (let i = 0; i < padRight; i++) {
        run.inlineIndex[run.chars.length] = inlineIndex;
        pushChar(run, INLINE_PAD, 1, null, -1);
      }
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

/** Authored relative insets of an inline (relative/sticky) element,
 * rewritten to whole cells by the renderer (specs/positioning.md).
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
  };
}

function pushChar(run: LeafRun, ch: string, advance: number, source: Text | null, offset: number) {
  run.chars.push(ch);
  run.advances.push(advance);
  run.sourceNode.push(source);
  run.sourceOffset.push(offset);
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
      max = Math.max(max, lineAdvance(lineStart, i, advances, tracking));
      lineStart = i + 1;
    }
  }
  return max;
}

function countHardLines(text: string): number {
  return hardLineSpans(text).length;
}

function warnSkippedRunContent(el: Element): void {
  warnOnce(
    el,
    "A block-level element nested inside a text run can't be laid out and was " +
      "skipped. Give it its own place in the layout instead.",
  );
}

/** True if `el` has any direct text child that isn't just whitespace. */
export function hasDirectText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (child) => child.nodeType === Node.TEXT_NODE && /[^ \t\r\n\f]/.test(child.textContent ?? ""),
  );
}

/** Author-facing warning when direct text can't be laid out alongside
 * block children — shared by the nested-container path here and the
 * host-level path in element.ts. */
export const DIRECT_TEXT_DROPPED =
  "Direct text next to block-level children can't be laid out and was hidden. " +
  "Wrap each text segment in its own element (e.g. a <div>).";

/** True for tags whose value/caret/selection are handled by the browser
 * natively — the tree builder treats them as empty leaves. */
export function isFormControlTag(tag: string): boolean {
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

/** Mixed direct text + in-flow block children: the text can't be laid out
 * (no element to position — cell-model deviation). Hide it (via the
 * renderer) and tell the author how to fix their markup, once. */
function flagDroppedText(el: Element, node: LayoutNode): void {
  if (!hasDirectText(el)) return;
  node.droppedText = true;
  warnOnce(el, DIRECT_TEXT_DROPPED);
}
